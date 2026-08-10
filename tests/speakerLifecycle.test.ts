import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  coSpeakerInvitationStillTrue,
  coSpeakerSignInInvitationStillTrue,
  everySpeakerConfirmed,
  primarySpeakerId,
  proposalSpeakerIds,
  usesPerSpeakerLifecycle,
} from '../functions/src/speakerLifecycle';

const snapshot = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  get: (key: string) => data?.[key],
  data: () => data ?? undefined,
});

describe('speaker lifecycle', () => {
  it('keeps old single-speaker proposals on the legacy confirmation path', () => {
    const proposal = { speakerIds: ['lead'] };
    expect(proposalSpeakerIds(proposal)).toEqual(['lead']);
    expect(primarySpeakerId(proposal)).toBe('lead');
    expect(usesPerSpeakerLifecycle(proposal)).toBe(false);
  });

  it('opts roster proposals into private per-speaker state', () => {
    expect(
      usesPerSpeakerLifecycle({
        primarySpeakerId: 'lead',
        speakerIds: ['lead', 'co'],
      }),
    ).toBe(true);
  });

  it('confirms the proposal only after every active speaker confirms', () => {
    expect(
      everySpeakerConfirmed(
        ['lead', 'co'],
        new Map([
          ['lead', { response: 'confirmed' }],
          ['co', { response: 'confirmed' }],
        ]),
      ),
    ).toBe(true);
    expect(
      everySpeakerConfirmed(
        ['lead', 'co'],
        new Map([
          ['lead', { response: 'confirmed' }],
          ['co', { response: 'declined' }],
        ]),
      ),
    ).toBe(false);
  });

  it('revalidates the exact pending invite, proposal, CFP, and expiry', () => {
    const now = Date.now();
    const cfp = snapshot({
      archived: false,
      deleting: false,
      paused: false,
      opensAt: Timestamp.fromMillis(now - 60_000),
      closesAt: Timestamp.fromMillis(now + 60_000),
    });
    const proposal = snapshot({ status: 'draft' });
    const invitation = snapshot({
      cfpId: 'event',
      proposalId: 'talk',
      invitationId: 'invite',
      email: 'co@example.org',
      status: 'pending',
      expiresAt: Timestamp.fromMillis(now + 60_000),
    });
    expect(
      coSpeakerInvitationStillTrue(
        'co_speaker_invited',
        'invite',
        'event',
        'talk',
        'co@example.org',
        invitation as never,
        proposal as never,
        cfp as never,
        now,
      ),
    ).toBe(true);
    expect(
      coSpeakerInvitationStillTrue(
        'co_speaker_invited',
        'invite',
        'event',
        'talk',
        'other@example.org',
        invitation as never,
        proposal as never,
        cfp as never,
        now,
      ),
    ).toBe(false);
    expect(
      coSpeakerInvitationStillTrue(
        'co_speaker_invited',
        'invite',
        'event',
        'talk',
        'co@example.org',
        invitation as never,
        proposal as never,
        cfp as never,
        now + 60_000,
      ),
    ).toBe(false);
  });

  it('keeps an accepted sign-in link only while its responder remains a speaker', () => {
    const invitation = snapshot({
      cfpId: 'event',
      proposalId: 'talk',
      invitationId: 'invite',
      email: 'co@example.org',
      status: 'accepted',
      respondedBy: 'co',
    });
    const cfp = snapshot({ deleting: false });
    const active = snapshot({ status: 'draft', speakerIds: ['lead', 'co'] });
    const removed = snapshot({ status: 'draft', speakerIds: ['lead'], formerSpeakerIds: ['co'] });
    const valid = (proposal: ReturnType<typeof snapshot>, email = 'co@example.org') =>
      coSpeakerSignInInvitationStillTrue(
        'invite',
        'event',
        'talk',
        email,
        invitation as never,
        proposal as never,
        cfp as never,
      );

    expect(valid(active)).toBe(true);
    expect(valid(removed)).toBe(false);
    expect(valid(active, 'other@example.org')).toBe(false);
    expect(
      coSpeakerSignInInvitationStillTrue(
        'invite',
        'event',
        'talk',
        'co@example.org',
        invitation as never,
        active as never,
        snapshot({ deleting: true }) as never,
      ),
    ).toBe(false);
  });
});
