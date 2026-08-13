import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  readEmailLog,
  readProposalById,
  readScheduleConfigDirect,
  reviewedEmailConfiguration,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  seedSpeakerConfirmation,
  setEmailDeliveryReadyDirect,
  setPlatformEmailDeliveryReadyDirect,
  setScheduleNeedsAttentionDirect,
} from './backend';

const SPEAKER = {
  sub: 'profile-refresh-speaker',
  email: 'profile-refresh@example.org',
  name: 'Leila Haddad',
};
const ADMIN = {
  sub: 'profile-refresh-admin',
  email: 'profile-refresh-admin@example.org',
  name: 'Programme Admin',
};
const OUTSIDER = {
  sub: 'profile-refresh-outsider',
  email: 'profile-refresh-outsider@example.org',
  name: 'Unrelated Account',
};

test.describe('explicit event speaker profile copies', () => {
  test.beforeEach(async () => reset());

  test('speaker and admin can explicitly refresh without changing confirmation or old copies automatically', async () => {
    const [speaker, admin, outsider] = await Promise.all(
      [SPEAKER, ADMIN, OUTSIDER].map(createAccount),
    );
    await Promise.all([
      seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
      seedSpeaker(speaker.uid, {
        name: SPEAKER.name,
        email: SPEAKER.email,
        bio: 'The current global profile explains reliable production AI systems in practical detail.',
        company: 'Northstar Labs',
        jobTitle: 'Staff Engineer',
      }),
      seedProposal('profile-refresh-talk', {
        speakerUid: speaker.uid,
        title: 'Production AI without surprises',
        status: 'confirmed',
        speaker: {
          name: 'Old programme name',
          bio: 'The previously approved event copy remains stable until somebody explicitly refreshes it.'.repeat(2),
          company: 'Former Company',
          jobTitle: 'Engineer',
        },
        confirmAnswers: { shirtSize: 'M' },
      }),
      setScheduleNeedsAttentionDirect(false),
    ]);

    // Updating the private global profile alone no longer rewrites event history.
    expect((await readProposalById('profile-refresh-talk'))?.speakerSnapshot[0]).toMatchObject({
      name: 'Old programme name',
      company: 'Former Company',
    });

    const refused = await callAs(outsider.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'profile-refresh-talk',
      speakerUid: speaker.uid,
      expectedCurrentFingerprint: '0'.repeat(64),
      expectedLatestFingerprint: '0'.repeat(64),
    });
    expect(refused).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    const speakerPreview = await callJson(speaker.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'profile-refresh-talk',
    }) as { currentFingerprint: string; latestFingerprint: string };
    expect(
      await callJson(speaker.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'profile-refresh-talk',
        expectedCurrentFingerprint: speakerPreview.currentFingerprint,
        expectedLatestFingerprint: speakerPreview.latestFingerprint,
      }),
    ).toMatchObject({ changed: true, scheduleNeedsAttention: true });

    const afterSpeaker = await readProposalById('profile-refresh-talk');
    expect(afterSpeaker).toMatchObject({
      status: 'confirmed',
      confirmAnswers: { shirtSize: 'M' },
    });
    expect(afterSpeaker?.speakerSnapshot[0]).toMatchObject({
      uid: speaker.uid,
      name: SPEAKER.name,
      company: 'Northstar Labs',
      jobTitle: 'Staff Engineer',
    });
    expect(afterSpeaker?.speakerSnapshot[0]).not.toHaveProperty('email');
    expect((await readScheduleConfigDirect())?.needsAttention).toBe(true);

    await Promise.all([
      seedSpeaker(speaker.uid, {
        name: 'Leila Haddad-Santos',
        email: SPEAKER.email,
        bio: 'An updated biography for the public programme with enough concrete detail to be useful.',
        company: 'Independent',
        jobTitle: 'Principal Consultant',
      }),
      setScheduleNeedsAttentionDirect(false),
    ]);

    const adminPreview = await callJson(admin.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'profile-refresh-talk',
      speakerUid: speaker.uid,
    }) as { currentFingerprint: string; latestFingerprint: string };
    expect(
      await callJson(admin.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'profile-refresh-talk',
        speakerUid: speaker.uid,
        expectedCurrentFingerprint: adminPreview.currentFingerprint,
        expectedLatestFingerprint: adminPreview.latestFingerprint,
      }),
    ).toMatchObject({ changed: true, scheduleNeedsAttention: true });
    expect((await readProposalById('profile-refresh-talk'))?.speakerSnapshot[0]).toMatchObject({
      name: 'Leila Haddad-Santos',
      company: 'Independent',
      jobTitle: 'Principal Consultant',
    });
  });

  test('previews safe diffs and tracks idempotent request, completion, cancellation and re-request generations', async () => {
    await setPlatformEmailDeliveryReadyDirect();
    const [speaker, admin, outsider] = await Promise.all(
      [SPEAKER, ADMIN, OUTSIDER].map(createAccount),
    );
    await Promise.all([
      seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
      seedSpeaker(speaker.uid, {
        name: SPEAKER.name,
        email: SPEAKER.email,
        bio: 'The latest private account profile has enough detail for a useful programme biography.',
        company: 'Current Company',
        jobTitle: 'Principal Engineer',
        basedIn: 'Private new location',
      }),
      seedProposal('profile-update-request-talk', {
        speakerUid: speaker.uid,
        title: 'A request with an explicit lifecycle',
        status: 'confirmed',
        speaker: {
          name: 'Old Programme Name',
          bio: 'The stable event copy remains unchanged until an explicit preview and adoption.'.repeat(2),
          company: 'Previous Company',
          jobTitle: 'Engineer',
          basedIn: 'Montréal event copy',
        },
        confirmAnswers: { shirtSize: 'M', dietaryNeeds: 'Private answer' },
      }),
      setScheduleNeedsAttentionDirect(false),
    ]);

    const firstPreview = await callJson(admin.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'profile-update-request-talk',
      speakerUid: speaker.uid,
    }) as {
      currentFingerprint: string;
      latestFingerprint: string;
      current: Record<string, unknown>;
      latest: Record<string, unknown>;
      changes: Array<{ field: string }>;
      request: unknown;
    };
    expect(firstPreview.changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(['name', 'bio', 'company', 'jobTitle']),
    );
    expect(firstPreview.current).not.toHaveProperty('basedIn');
    expect(firstPreview.latest).not.toHaveProperty('basedIn');
    expect(JSON.stringify(firstPreview)).not.toContain(SPEAKER.email);
    expect(JSON.stringify(firstPreview)).not.toContain('shirtSize');
    expect(JSON.stringify(firstPreview)).not.toContain('dietaryNeeds');
    expect(JSON.stringify(firstPreview)).not.toContain('speakerProfilePhotos/');
    expect(firstPreview.request).toBeNull();

    await seedSpeaker(speaker.uid, {
      name: 'Changed after preview',
      email: SPEAKER.email,
      bio: 'This concurrent edit makes the already-rendered preview stale before adoption.',
      company: 'Current Company',
      jobTitle: 'Principal Engineer',
      basedIn: 'Private new location',
    });
    expect(
      await callAs(admin.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        expectedCurrentFingerprint: firstPreview.currentFingerprint,
        expectedLatestFingerprint: firstPreview.latestFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'ABORTED' });

    const freshPreview = await callJson(admin.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'profile-update-request-talk',
      speakerUid: speaker.uid,
    }) as { currentFingerprint: string; latestFingerprint: string };
    await callJson(admin.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'profile-update-request-talk',
      speakerUid: speaker.uid,
      expectedCurrentFingerprint: freshPreview.currentFingerprint,
      expectedLatestFingerprint: freshPreview.latestFingerprint,
    });
    expect(
      (await readProposalById('profile-update-request-talk'))?.speakerSnapshot[0].basedIn,
    ).toBe('Montréal event copy');

    const selfPreview = await callJson(speaker.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'profile-update-request-talk',
    }) as {
      currentFingerprint: string;
      latestFingerprint: string;
      current: { basedIn?: string };
      latest: { basedIn?: string };
      changes: Array<{ field: string }>;
    };
    expect(selfPreview.current.basedIn).toBe('Montréal event copy');
    expect(selfPreview.latest.basedIn).toBe('Private new location');
    expect(selfPreview.changes).toContainEqual(
      expect.objectContaining({ field: 'basedIn' }),
    );
    await callJson(speaker.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'profile-update-request-talk',
      expectedCurrentFingerprint: selfPreview.currentFingerprint,
      expectedLatestFingerprint: selfPreview.latestFingerprint,
    });
    expect(
      (await readProposalById('profile-update-request-talk'))?.speakerSnapshot[0].basedIn,
    ).toBe('Private new location');

    const requested = await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
      proposalId: 'profile-update-request-talk',
      speakerUid: speaker.uid,
      scopes: ['profile'],
    }) as {
      created: boolean;
      changed: boolean;
      request: { requestId: string; generation: number; status: string };
    };
    expect(requested).toMatchObject({
      created: true,
      changed: true,
      request: { generation: 1, status: 'pending' },
    });
    const firstLogId =
      `profile_update_requested__profile-update-request-talk__generation-1__${speaker.uid}`;
    await expect.poll(async () =>
      (await readEmailLog()).find((row) => row.id === firstLogId),
    ).toMatchObject({
      kind: 'profile_update_requested',
      proposalId: 'profile-update-request-talk',
      recipientUid: speaker.uid,
      profileUpdateRequestId: requested.request.requestId,
      profileUpdateRequestGeneration: 1,
    });
    await expect.poll(async () =>
      (await readEmailLog()).find((row) => row.id === firstLogId)?.status,
    ).toBe('dry_run');
    expect(
      await callJson(speaker.idToken, 'listSpeakerProfileUpdateRequests', {}),
    ).toMatchObject({
      own: [{
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        requestId: requested.request.requestId,
        generation: 1,
        state: 'waiting',
        scopes: ['profile'],
      }],
      admin: [],
    });
    expect(
      await callJson(admin.idToken, 'listSpeakerProfileUpdateRequests', {}),
    ).toMatchObject({
      own: [],
      admin: [{
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        requestId: requested.request.requestId,
        state: 'waiting',
      }],
    });
    expect(
      await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        scopes: ['profile'],
      }),
    ).toMatchObject({
      created: false,
      changed: false,
      request: { requestId: requested.request.requestId, generation: 1 },
    });
    expect(
      (await readEmailLog()).filter((row) => row.kind === 'profile_update_requested'),
    ).toHaveLength(1);
    expect(
      await callAs(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        scopes: ['profile', 'photo'],
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callAs(outsider.idToken, 'previewProposalSpeakerProfile', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
      }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(
      await callAs(speaker.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        scopes: ['profile'],
      }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    expect(
      await callJson(speaker.idToken, 'completeProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        requestId: requested.request.requestId,
      }),
    ).toMatchObject({
      changed: true,
      remainingScopes: [],
      request: { status: 'resolved', resolvedScopes: ['profile'] },
    });
    expect(
      await callJson(speaker.idToken, 'listSpeakerProfileUpdateRequests', {}),
    ).toMatchObject({ own: [], admin: [] });
    expect(
      await callJson(admin.idToken, 'listSpeakerProfileUpdateRequests', {}),
    ).toMatchObject({
      admin: [{
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        requestId: requested.request.requestId,
        state: 'ready',
      }],
    });
    await setEmailDeliveryReadyDirect();
    const resolvedQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
    expect(resolvedQueue.retryable).not.toContainEqual(
      expect.objectContaining({ logId: firstLogId }),
    );
    expect(
      await callJson(admin.idToken, 'emailQueue', {
        action: 'retry',
        logIds: [firstLogId],
        reviewedRecipients: [{ logId: firstLogId, to: SPEAKER.email }],
        ...reviewedEmailConfiguration(resolvedQueue),
      }),
    ).toMatchObject({ released: 0, stale: 1 });
    expect(
      await callAs(admin.idToken, 'emailQueue', {
        action: 'resend',
        logId: firstLogId,
        reviewedTo: SPEAKER.email,
        ...reviewedEmailConfiguration(resolvedQueue),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callJson(speaker.idToken, 'completeProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        requestId: requested.request.requestId,
      }),
    ).toMatchObject({ changed: false, request: { status: 'resolved' } });

    const second = await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
      proposalId: 'profile-update-request-talk',
      speakerUid: speaker.uid,
      scopes: ['profile'],
    }) as { request: { requestId: string; generation: number } };
    expect(second.request).toMatchObject({ generation: 2 });
    expect(
      await callJson(admin.idToken, 'cancelProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        requestId: second.request.requestId,
      }),
    ).toMatchObject({ changed: true, request: { status: 'cancelled' } });
    expect(
      await callJson(admin.idToken, 'cancelProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        requestId: second.request.requestId,
      }),
    ).toMatchObject({ changed: false, request: { status: 'cancelled' } });
    expect(
      await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-update-request-talk',
        speakerUid: speaker.uid,
        scopes: ['profile'],
      }),
    ).toMatchObject({ created: true, request: { generation: 3, status: 'pending' } });
    await expect.poll(async () =>
      (await readEmailLog()).filter((row) => row.kind === 'profile_update_requested').length,
    ).toBe(3);
  });

  test('requires the exact speaker to be confirmed even while the aggregate session is accepted', async () => {
    const [speaker, admin] = await Promise.all([SPEAKER, ADMIN].map(createAccount));
    await Promise.all([
      seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
      seedSpeaker(speaker.uid, {
        name: SPEAKER.name,
        email: SPEAKER.email,
        bio: 'A complete profile for a speaker whose session is awaiting another participant.',
      }),
      seedProposal('profile-request-personal-confirmation', {
        speakerUid: speaker.uid,
        primarySpeakerId: speaker.uid,
        title: 'The session aggregate is not the personal answer',
        status: 'accepted',
      }),
    ]);

    expect(
      await callAs(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-request-personal-confirmation',
        speakerUid: speaker.uid,
        scopes: ['profile'],
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await seedSpeakerConfirmation(
      'profile-request-personal-confirmation',
      speaker.uid,
      'confirmed',
    );
    expect(
      await callJson(admin.idToken, 'requestProposalSpeakerProfileUpdate', {
        proposalId: 'profile-request-personal-confirmation',
        speakerUid: speaker.uid,
        scopes: ['profile'],
      }),
    ).toMatchObject({ created: true, request: { status: 'pending' } });
  });
});
