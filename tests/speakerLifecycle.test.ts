import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  coSpeakerInvitationStillTrue,
  coSpeakerSignInInvitationStillTrue,
  currentReleasedSpeakerIds,
  everySpeakerConfirmed,
  primarySpeakerId,
  proposalEventIsCurrent,
  proposalSpeakerIds,
  scheduleCancellationSnapshotIsCurrent,
  scheduleCancellationRecipientIds,
  scheduleEmailStillTrue,
  scheduleReleaseIds,
  scheduleReleaseProposalEntryId,
  usesPerSpeakerLifecycle,
} from '../functions/src/speakerLifecycle';

const snapshot = (
  data: Record<string, unknown> | null,
  id = '',
  createTime?: Timestamp,
) => ({
  id,
  exists: data !== null,
  get: (key: string) => data?.[key],
  data: () => data ?? undefined,
  createTime,
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

  it('keeps a late addition out of the immutable roster until a new release replaces it', () => {
    const proposal = snapshot({
      status: 'accepted',
      speakerIds: ['lead', 'co', 'late'],
      lateSpeakerSchedulePreserved: true,
      lateSpeakerScheduleBaselineIds: ['lead', 'co'],
      lateSpeakerPendingIds: ['late'],
      lateSpeakerPendingInvitations: [{ uid: 'late', invitationId: 'invite' }],
    });
    expect(currentReleasedSpeakerIds(proposal as never)).toEqual(['lead', 'co']);
    expect(scheduleCancellationRecipientIds(proposal as never)).toEqual(['lead', 'co']);

    const confirmed = snapshot({
      ...proposal.data(),
      status: 'confirmed',
      lateSpeakerPendingIds: undefined,
      lateSpeakerPendingInvitations: undefined,
    });
    expect(currentReleasedSpeakerIds(confirmed as never)).toEqual(['lead', 'co']);
    expect(
      scheduleEmailStillTrue(
        'schedule_changed',
        'release-one',
        'release-one',
        snapshot({ cancelled: false }, 'session-one') as never,
        confirmed as never,
        'late',
        'session-one',
      ),
    ).toBe(false);
    expect(
      scheduleEmailStillTrue(
        'schedule_cancelled',
        'release-one',
        'release-one',
        // The old id has been reused by a different entry. The proposal-level
        // map is authoritative and proves this proposal is still absent.
        snapshot({ cancelled: false }, 'session-one') as never,
        confirmed as never,
        'lead',
        scheduleReleaseProposalEntryId(
          snapshot({ scheduledProposalEntries: {} }) as never,
          'proposal',
        ),
      ),
    ).toBe(true);
    expect(
      scheduleEmailStillTrue(
        'schedule_cancelled',
        'release-one',
        'release-one',
        snapshot({ cancelled: true }, 'session-one') as never,
        confirmed as never,
        'lead',
        'session-one',
      ),
    ).toBe(true);
    expect(
      scheduleEmailStillTrue(
        'schedule_cancelled',
        'release-one',
        'release-one',
        snapshot({ cancelled: false }, 'session-one') as never,
        confirmed as never,
        'lead',
        'session-one',
      ),
    ).toBe(false);
    expect(
      scheduleEmailStillTrue(
        'schedule_cancelled',
        'release-one',
        'release-one',
        undefined,
        confirmed as never,
        'lead',
        '',
      ),
    ).toBe(true);
  });

  it('fails closed for a forced cancellation but retains the frozen cancellation recipients', () => {
    const proposal = snapshot({
      status: 'accepted',
      speakerIds: ['lead', 'late'],
      scheduleCancellationRequired: true,
      lateSpeakerSchedulePreserved: true,
      lateSpeakerScheduleBaselineIds: ['lead', 'former'],
    });
    expect(currentReleasedSpeakerIds(proposal as never)).toEqual([]);
    expect(scheduleCancellationRecipientIds(proposal as never)).toEqual(['lead', 'former']);
    expect(
      scheduleEmailStillTrue(
        'schedule_cancelled',
        'release-one',
        'release-one',
        snapshot({ cancelled: true }) as never,
        proposal as never,
        'former',
        '',
      ),
    ).toBe(true);
  });

  it('rejects a stale cancellation snapshot after release pointers change', () => {
    const beforeShare = scheduleReleaseIds(snapshot({}) as never);
    expect(
      scheduleCancellationSnapshotIsCurrent(
        beforeShare,
        snapshot({ sharedScheduleId: 'release-one' }) as never,
      ),
    ).toBe(false);

    const observed = scheduleReleaseIds(
      snapshot({ sharedScheduleId: 'release-one', publishedScheduleId: 'release-zero' }) as never,
    );
    expect(
      scheduleCancellationSnapshotIsCurrent(
        observed,
        snapshot({ sharedScheduleId: 'release-one', publishedScheduleId: 'release-zero' }) as never,
      ),
    ).toBe(true);
  });

  it('rejects a delayed event after its proposal path is recreated', () => {
    const oldProposal = snapshot(
      { status: 'accepted' },
      'proposal',
      new Timestamp(1, 1),
    );
    const recreatedProposal = snapshot(
      { status: 'accepted' },
      'proposal',
      new Timestamp(1, 2),
    );
    expect(proposalEventIsCurrent(oldProposal as never, oldProposal as never)).toBe(true);
    expect(proposalEventIsCurrent(oldProposal as never, recreatedProposal as never)).toBe(false);
  });

  it('keeps legacy release email validation while new releases bind a proposal entry', () => {
    const confirmed = snapshot({ status: 'confirmed', speakerIds: ['lead'] });
    const entry = snapshot({ cancelled: false }, 'session-one');
    const legacySource = snapshot({ sourceFingerprint: 'legacy' });
    const mappedSource = snapshot({
      scheduledProposalEntries: { proposal: 'session-one' },
    });
    const movedSource = snapshot({
      scheduledProposalEntries: { proposal: 'session-two' },
    });

    expect(scheduleReleaseProposalEntryId(legacySource as never, 'proposal')).toBeNull();
    expect(scheduleReleaseProposalEntryId(mappedSource as never, 'proposal')).toBe('session-one');
    expect(
      scheduleEmailStillTrue(
        'schedule_changed',
        'release-one',
        'release-one',
        entry as never,
        confirmed as never,
        'lead',
        scheduleReleaseProposalEntryId(legacySource as never, 'proposal'),
      ),
    ).toBe(true);
    expect(
      scheduleEmailStillTrue(
        'schedule_changed',
        'release-one',
        'release-one',
        entry as never,
        confirmed as never,
        'lead',
        scheduleReleaseProposalEntryId(movedSource as never, 'proposal'),
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
