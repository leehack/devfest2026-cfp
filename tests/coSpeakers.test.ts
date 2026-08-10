import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  maskSpeakerEmail,
  normaliseSpeakerEmail,
  primarySpeakerIdOf,
} from '../shared/coSpeakers';
import { coSpeakerInvitationStillTrue } from '../functions/src/speakerLifecycle';

const snapshot = (data?: Record<string, unknown>) =>
  ({
    exists: data !== undefined,
    get: (field: string) => data?.[field],
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
});

describe('co-speaker invitation delivery validity', () => {
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
});
