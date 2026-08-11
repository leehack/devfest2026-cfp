import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  maskSpeakerEmail,
  normaliseSpeakerEmail,
  primarySpeakerIdOf,
  speakerInvitationPhaseOf,
} from '../shared/coSpeakers';
import {
  coSpeakerInvitationStillTrue,
  coSpeakerSignInInvitationStillTrue,
} from '../functions/src/speakerLifecycle';
import { coSpeakerInvitationRetryEmailUpdate } from '../functions/src/coSpeakers';
import { proposalSelectionQuery } from '../src/lib/proposalLinks';

const snapshot = (data?: Record<string, unknown>) =>
  ({
    exists: data !== undefined,
    get: (field: string) => data?.[field],
    data: () => data,
  }) as FirebaseFirestore.DocumentSnapshot;

describe('co-speaker identity helpers', () => {
  it('uses the immutable primary and falls back to the first legacy speaker', () => {
    expect(primarySpeakerIdOf({ primarySpeakerId: 'lead', speakerIds: ['legacy'] })).toBe('lead');
    expect(primarySpeakerIdOf({ speakerIds: ['legacy', 'guest'] })).toBe('legacy');
    expect(primarySpeakerIdOf({ speakerIds: [] })).toBeNull();
  });

  it('normalises bounded email addresses and masks a mismatched account', () => {
    expect(normaliseSpeakerEmail('  Speaker@Example.ORG ')).toBe('speaker@example.org');
    expect(normaliseSpeakerEmail('not-an-email')).toBeNull();
    expect(normaliseSpeakerEmail(`${'a'.repeat(243)}@example.org`)).toBeNull();
    expect(maskSpeakerEmail('speaker@example.org')).toBe('s******@example.org');
  });

  it('normalises historic invitations to the draft phase', () => {
    expect(speakerInvitationPhaseOf({})).toBe('draft');
    expect(speakerInvitationPhaseOf({ phase: 'draft' })).toBe('draft');
    expect(speakerInvitationPhaseOf({ phase: 'postAcceptance' })).toBe('postAcceptance');
    expect(speakerInvitationPhaseOf({ phase: 'unknown' })).toBeNull();
  });
});

describe('proposal session link parsing', () => {
  it('selects only a bare proposal link and leaves invitation links alone', () => {
    expect(proposalSelectionQuery('?proposal=talk-2')).toBe('talk-2');
    expect(proposalSelectionQuery('?proposal=%20talk-2%20')).toBe('talk-2');
    expect(proposalSelectionQuery('?proposal=talk-2&speakerInvite=invite-2')).toBeNull();
    expect(proposalSelectionQuery('?proposal=talk-2&speakerInvite=')).toBeNull();
    expect(proposalSelectionQuery('?speakerInvite=invite-2')).toBeNull();
    expect(proposalSelectionQuery('?proposal=%20')).toBeNull();
  });
});

describe('co-speaker invitation delivery validity', () => {
  it('clears both terminal timestamps before a retry records its next attempt', () => {
    const update = coSpeakerInvitationRetryEmailUpdate();

    expect(update.status).toBe('queued');
    expect(update.attemptedAt.constructor.name).toBe('DeleteTransform');
    expect(update.sentAt.constructor.name).toBe('DeleteTransform');
    expect(update.retryRequestedAt.constructor.name).toBe('ServerTimestampTransform');
  });

  const future = Timestamp.fromMillis(Date.now() + 60_000);
  const baseInvitation = {
    cfpId: 'event-a',
    proposalId: 'proposal-a',
    invitationId: 'invite-a',
    email: 'guest@example.org',
    status: 'pending',
    expiresAt: future,
  };
  const proposal = snapshot({ status: 'draft' });
  const cfp = snapshot({
    archived: false,
    deleting: false,
    paused: false,
    opensAt: Timestamp.fromMillis(1),
    closesAt: future,
  });

  const valid = (
    invitation = snapshot(baseInvitation),
    proposalSnap = proposal,
    cfpSnap = cfp,
    now = Date.now(),
  ) =>
    coSpeakerInvitationStillTrue(
      'co_speaker_invited',
      'invite-a',
      'event-a',
      'proposal-a',
      'guest@example.org',
      invitation,
      proposalSnap,
      cfpSnap,
      now,
    );

  it('keeps only the exact pending, draft, active invitation sendable', () => {
    expect(valid()).toBe(true);
    expect(valid(snapshot({ ...baseInvitation, status: 'revoked' }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, status: 'accepted' }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, email: 'other@example.org' }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, invitationId: 'invite-old' }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, proposalId: 'proposal-other' }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, cfpId: 'event-other' }))).toBe(false);
    expect(valid(snapshot(baseInvitation), snapshot({ status: 'submitted' }))).toBe(false);
  });

  it('supersedes paused, archived, deleting and expired invitations', () => {
    expect(valid(snapshot(baseInvitation), proposal, snapshot({ paused: true }))).toBe(false);
    expect(valid(snapshot(baseInvitation), proposal, snapshot({ archived: true }))).toBe(false);
    expect(valid(snapshot(baseInvitation), proposal, snapshot({ deleting: true }))).toBe(false);
    expect(valid(snapshot({ ...baseInvitation, expiresAt: Timestamp.fromMillis(1) }))).toBe(false);
  });

  it('also follows the current CFP window when it becomes narrower than the invite', () => {
    const now = Date.now();
    expect(
      valid(
        snapshot(baseInvitation),
        proposal,
        snapshot({
          archived: false,
          deleting: false,
          paused: false,
          opensAt: Timestamp.fromMillis(now + 1),
          closesAt: future,
        }),
        now,
      ),
    ).toBe(false);
    expect(
      valid(
        snapshot(baseInvitation),
        proposal,
        snapshot({
          archived: false,
          deleting: false,
          paused: false,
          opensAt: Timestamp.fromMillis(1),
          closesAt: Timestamp.fromMillis(now),
        }),
        now,
      ),
    ).toBe(false);
  });

  it('keeps post-acceptance invitations independent of the closed submission window', () => {
    const now = Date.now();
    const lateInvitation = snapshot({
      ...baseInvitation,
      phase: 'postAcceptance',
      expiresAt: Timestamp.fromMillis(now + 60_000),
    });
    const closedCfp = snapshot({
      archived: false,
      deleting: false,
      paused: false,
      opensAt: Timestamp.fromMillis(1),
      closesAt: Timestamp.fromMillis(now - 1),
    });
    expect(valid(lateInvitation, snapshot({ status: 'confirmed' }), closedCfp, now)).toBe(true);
    expect(valid(lateInvitation, snapshot({ status: 'accepted' }), closedCfp, now)).toBe(true);
    expect(valid(lateInvitation, snapshot({ status: 'under_review' }), closedCfp, now)).toBe(false);
  });

  it('keeps an accepted sign-in route bound to a valid phase and active roster member', () => {
    const accepted = {
      ...baseInvitation,
      phase: 'postAcceptance',
      status: 'accepted',
      respondedBy: 'guest',
    };
    const acceptedProposal = snapshot({ status: 'accepted', speakerIds: ['lead', 'guest'] });
    const stillTrue = (invitation: Record<string, unknown>, proposalSnap = acceptedProposal) =>
      coSpeakerSignInInvitationStillTrue(
        'invite-a',
        'event-a',
        'proposal-a',
        'guest@example.org',
        snapshot(invitation),
        proposalSnap,
        cfp,
      );

    expect(stillTrue(accepted)).toBe(true);
    expect(stillTrue({ ...accepted, phase: 'unknown' })).toBe(false);
    expect(stillTrue(accepted, snapshot({ status: 'accepted', speakerIds: ['lead'] }))).toBe(false);
  });
});
