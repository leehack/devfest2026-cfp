import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  callPublic,
  clearSignInAllowance,
  createAccount,
  readEmailLog,
  readProposalById,
  readSignInLinks,
  readSpeakerConfirmation,
  readSpeakerParticipant,
  readStoredObjects,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  seedSpeakerParticipant,
  setCfpWindow,
  setConfirmFormDirect,
  setEmailDeliveryDirect,
  setEmailSendingDirect,
  setPublicUrlDirect,
  setSpeakerInvitationRateDirect,
  setSpeakerInvitationExpiryDirect,
  waitForEmail,
} from './backend';

const LEAD = { sub: 'lifecycle-lead', email: 'lead@example.org', name: 'Lead Speaker' };
const GUEST = { sub: 'lifecycle-guest', email: 'guest@example.org', name: 'Guest Speaker' };
const WRONG = { sub: 'lifecycle-wrong', email: 'wrong@example.org', name: 'Wrong Account' };
const ADMIN = { sub: 'lifecycle-admin', email: 'admin@example.org', name: 'Admin' };
const REVIEWER = {
  sub: 'lifecycle-reviewer',
  email: 'reviewer@example.org',
  name: 'Independent Reviewer',
};
const ACKS = { noTravelSupport: true, coc: true, recording: true };
const ATTENDANCE = { status: 'local', needsVisa: false };
const TALK_ABSTRACT =
  'A concrete plan for two presenters to prepare, rehearse, and deliver one coherent session. ' +
  'We cover shared story structure, explicit handoffs, live-demo recovery, accessible audience interaction, and the rehearsal checkpoints that keep both speakers aligned without making the session feel scripted.';

async function draftWithInvitation() {
  const lead = await createAccount(LEAD);
  const guest = await createAccount(GUEST);
  await seedSpeaker(lead.uid, { name: LEAD.name, email: LEAD.email });
  await seedSpeaker(guest.uid, { name: GUEST.name, email: GUEST.email });
  await seedProposal('linked-talk', {
    speakerUid: lead.uid,
    title: 'Building reliable AI systems together',
    abstract: TALK_ABSTRACT,
    status: 'draft',
    includeSpeakerSnapshot: false,
  });
  const invitation = await callJson(lead.idToken, 'inviteCoSpeaker', {
    proposalId: 'linked-talk',
    email: GUEST.email,
  });
  return { lead, guest, invitationId: String(invitation.invitationId) };
}

async function joinedDraft() {
  const staged = await draftWithInvitation();
  await callJson(staged.guest.idToken, 'respondToCoSpeakerInvitation', {
    proposalId: 'linked-talk',
    invitationId: staged.invitationId,
    response: 'accept',
  });
  return staged;
}

async function completeGuestDetails(uid: string) {
  await seedSpeakerParticipant('linked-talk', uid, {
    role: 'coSpeaker',
    status: 'active',
    acks: ACKS,
    attendance: ATTENDANCE,
  });
}

async function submitAndAccept() {
  const staged = await joinedDraft();
  await completeGuestDetails(staged.guest.uid);
  await callJson(staged.lead.idToken, 'submitProposal', { proposalId: 'linked-talk' });
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
  await callJson(admin.idToken, 'setProposalStatus', {
    proposalId: 'linked-talk',
    status: 'accepted',
  });
  return { ...staged, admin };
}

test.describe('co-speaker lifecycle boundaries', () => {
  test.beforeEach(async () => reset());

  test('a pending invitation blocks submission and declining it releases the lead', async () => {
    const { lead, guest, invitationId } = await draftWithInvitation();

    await expect(
      callAs(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readProposalById('linked-talk'))?.status).toBe('draft');

    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'linked-talk',
      invitationId,
      response: 'decline',
    });
    await callJson(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' });

    expect(await readProposalById('linked-talk')).toMatchObject({
      status: 'submitted',
      speakerIds: [lead.uid],
    });
    expect(await readSpeakerParticipant('linked-talk', guest.uid)).toBeNull();
  });

  test('only the matching account receives the private invitation summary', async () => {
    const { guest, invitationId } = await draftWithInvitation();
    const wrong = await createAccount(WRONG);

    const mismatched = (
      await callJson(wrong.idToken, 'getCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      })
    ).invitation;
    expect(mismatched).toMatchObject({
      invitedEmail: 'g****@example.org',
      matchesSignedInEmail: false,
      canRespond: false,
    });
    expect(mismatched.title ?? '').toBe('');
    expect(mismatched.primaryName ?? '').toBe('');
    expect(mismatched).not.toHaveProperty('talk');
    expect(JSON.stringify(mismatched)).not.toContain(TALK_ABSTRACT);
    expect(JSON.stringify(mismatched)).not.toContain(LEAD.name);

    const matching = (
      await callJson(guest.idToken, 'getCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      })
    ).invitation;
    expect(matching).toMatchObject({
      title: 'Building reliable AI systems together',
      primaryName: LEAD.name,
      matchesSignedInEmail: true,
      canRespond: true,
      talk: {
        abstract: TALK_ABSTRACT,
        category: { en: 'AI & ML', fr: 'IA et apprentissage automatique' },
        format: { en: 'Session — 40 minutes', fr: 'Session — 40 minutes' },
        level: { en: 'Intermediate', fr: 'Intermédiaire' },
        deliveryLanguage: { en: 'English', fr: 'Anglais' },
      },
    });
  });

  test('a usable talk title and lead identity are required before inviting', async () => {
    const lead = await createAccount(LEAD);
    await seedSpeaker(lead.uid, { name: LEAD.name, email: LEAD.email });
    await seedProposal('untitled-talk', {
      speakerUid: lead.uid,
      title: '',
      status: 'draft',
      includeSpeakerSnapshot: false,
    });
    await expect(
      callAs(lead.idToken, 'inviteCoSpeaker', {
        proposalId: 'untitled-talk',
        email: GUEST.email,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await seedSpeaker(lead.uid, { name: '', email: LEAD.email });
    await seedProposal('anonymous-lead-talk', {
      speakerUid: lead.uid,
      title: 'A titled proposal',
      status: 'draft',
      includeSpeakerSnapshot: false,
    });
    await expect(
      callAs(lead.idToken, 'inviteCoSpeaker', {
        proposalId: 'anonymous-lead-talk',
        email: GUEST.email,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('recipient invitation throttling spans proposals and lead accounts', async () => {
    const recipient = 'popular-speaker@example.org';
    for (let index = 0; index < 6; index += 1) {
      const identity = {
        sub: `rate-lead-${index}`,
        email: `rate-lead-${index}@example.org`,
        name: `Rate Lead ${index}`,
      };
      const lead = await createAccount(identity);
      await seedSpeaker(lead.uid, { name: identity.name, email: identity.email });
      await seedProposal(`rate-talk-${index}`, {
        speakerUid: lead.uid,
        title: `A complete proposal ${index}`,
        status: 'draft',
        includeSpeakerSnapshot: false,
      });
      const result = await callAs(lead.idToken, 'inviteCoSpeaker', {
        proposalId: `rate-talk-${index}`,
        email: recipient,
      });
      if (index < 5) {
        expect(result).toMatchObject({ ok: true });
      } else {
        expect(result).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });
      }
    }
    expect(
      (await readEmailLog()).filter(
        (row) => row.kind === 'co_speaker_invited' && row.to === recipient,
      ),
    ).toHaveLength(5);
  });

  test('an invitation queues one exact link row and duplicate invites do not spam', async () => {
    const { lead, invitationId } = await draftWithInvitation();
    const rows = await waitForEmail(
      (current) => {
        const invitation = current.filter((row) => row.kind === 'co_speaker_invited');
        return invitation.length === 1 &&
          !['queued', 'sending'].includes(String(invitation[0].status));
      },
      'co-speaker invitation',
    );
    const invitationRows = rows.filter((row) => row.kind === 'co_speaker_invited');
    expect(invitationRows).toEqual([
      expect.objectContaining({
        id: `co_speaker_invited__linked-talk__${invitationId}`,
        proposalId: 'linked-talk',
        invitationId,
        invitationEmail: GUEST.email,
        to: GUEST.email,
      }),
    ]);

    await expect(
      callAs(lead.idToken, 'inviteCoSpeaker', {
        proposalId: 'linked-talk',
        email: GUEST.email,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'ALREADY_EXISTS' });
    expect(
      (await readEmailLog()).filter((row) => row.kind === 'co_speaker_invited'),
    ).toHaveLength(1);

    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
    const invitationRow = invitationRows[0];
    const preview = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
    expect(JSON.stringify(preview)).not.toContain(GUEST.email);
    expect(JSON.stringify(preview)).not.toContain('Building reliable AI systems together');
    expect(JSON.stringify(preview)).not.toContain('co_speaker_invited');
    expect(
      (preview.rows ?? []).some(
        (row: Record<string, unknown>) => row.kind === 'co_speaker_invited',
      ),
    ).toBe(false);
    const readiness = await callJson(admin.idToken, 'emailQueue', { action: 'readiness' });
    const summary = await callJson(admin.idToken, 'emailQueue', { action: 'summary' });
    expect(readiness).not.toHaveProperty('rows');
    expect(summary).not.toHaveProperty('rows');
    expect(JSON.stringify(readiness)).not.toContain('co_speaker_invited');
    expect(JSON.stringify(summary)).not.toContain('co_speaker_invited');
    await expect(
      callAs(admin.idToken, 'emailQueue', {
        action: 'release',
        logIds: [invitationRow.id],
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      callAs(admin.idToken, 'emailQueue', {
        action: 'resend',
        logId: invitationRow.id,
      }),
    ).resolves.toMatchObject({ ok: false });
    const retry = await callJson(admin.idToken, 'emailQueue', { action: 'retry' });
    expect(retry).toMatchObject({ ok: true, released: 0 });
    expect(JSON.stringify(retry)).not.toContain('co_speaker_invited');
    expect(JSON.stringify(retry)).not.toContain(GUEST.email);
    const afterAdminActions = (await readEmailLog()).find(
      (row) => row.id === invitationRow.id,
    );
    expect(afterAdminActions).toMatchObject({
      status: invitationRow.status,
      attempts: invitationRow.attempts,
    });
  });

  test('failed invitation deliveries surface as retryable to the primary speaker', async () => {
    const { lead, invitationId } = await draftWithInvitation();
    const logId = `co_speaker_invited__linked-talk__${invitationId}`;
    await waitForEmail(
      (rows) => rows.some((row) => row.id === logId),
      'co-speaker delivery row',
    );

    for (const delivery of [
      { status: 'dry_run', attempts: 1 },
      { status: 'failed', attempts: 2 },
      {
        status: 'sending',
        attempts: 3,
        sendingStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      },
    ]) {
      await setEmailDeliveryDirect(logId, delivery);
      const roster = (
        await callJson(lead.idToken, 'getProposalRoster', { proposalId: 'linked-talk' })
      ).roster;
      expect(roster.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            invitationId,
            state: 'pending',
            deliveryState: 'notDelivered',
            canRetryDelivery: true,
          }),
        ]),
      );
    }
  });

  test('only the primary retries one exact invitation row atomically', async () => {
    const { lead, guest, invitationId } = await draftWithInvitation();
    const logId = `co_speaker_invited__linked-talk__${invitationId}`;
    await waitForEmail((rows) => rows.some((row) => row.id === logId), 'invitation row');
    await setEmailDeliveryDirect(logId, { status: 'failed', attempts: 1 });
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);

    for (const caller of [guest.idToken, admin.idToken]) {
      await expect(
        callAs(caller, 'retryCoSpeakerInvitation', {
          proposalId: 'linked-talk',
          invitationId,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
    await expect(
      callAs(lead.idToken, 'retryCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      }),
    ).resolves.toMatchObject({ ok: true });

    const rows = await waitForEmail(
      (current) => {
        const row = current.find((candidate) => candidate.id === logId);
        return Boolean(
          row &&
          Number(row.attempts) >= 2 &&
          !['queued', 'sending'].includes(String(row.status)),
        );
      },
      'retried invitation delivery',
    );
    const invitationRows = rows.filter(
      (row) => row.kind === 'co_speaker_invited' && row.proposalId === 'linked-talk',
    );
    expect(invitationRows).toEqual([
      expect.objectContaining({
        id: logId,
        invitationId,
        invitationEmail: GUEST.email,
        to: GUEST.email,
        retryRequestedAt: expect.any(String),
      }),
    ]);
  });

  test('invitation retry is bounded by delivery attempts and invitation rate', async () => {
    const { lead, invitationId } = await draftWithInvitation();
    const logId = `co_speaker_invited__linked-talk__${invitationId}`;
    await waitForEmail((rows) => rows.some((row) => row.id === logId), 'invitation row');

    await setEmailDeliveryDirect(logId, { status: 'dry_run', attempts: 5 });
    await expect(
      callAs(lead.idToken, 'retryCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });
    expect((await readEmailLog()).find((row) => row.id === logId)).toMatchObject({
      status: 'dry_run',
      attempts: 5,
    });

    await setEmailDeliveryDirect(logId, { status: 'failed', attempts: 1 });
    await setSpeakerInvitationRateDirect('speaker', lead.uid, 20);
    await expect(
      callAs(lead.idToken, 'retryCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });
    expect((await readEmailLog()).find((row) => row.id === logId)).toMatchObject({
      status: 'failed',
      attempts: 1,
    });
  });

  test('sent, queued, and freshly sending invitation retries are idempotent', async () => {
    const { lead, invitationId } = await draftWithInvitation();
    const logId = `co_speaker_invited__linked-talk__${invitationId}`;
    await waitForEmail((rows) => rows.some((row) => row.id === logId), 'invitation row');
    const retry = () =>
      callAs(lead.idToken, 'retryCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      });

    await setEmailDeliveryDirect(logId, { status: 'queued', attempts: 1 });
    await expect(retry()).resolves.toMatchObject({ ok: true });
    const queued = await waitForEmail(
      (rows) => {
        const row = rows.find((candidate) => candidate.id === logId);
        return Boolean(row && Number(row.attempts) === 2 && row.status !== 'sending');
      },
      'single queued delivery attempt',
    );
    expect(queued.find((row) => row.id === logId)?.retryRequestedAt).toBeUndefined();

    const startedAt = new Date();
    await setEmailDeliveryDirect(logId, {
      status: 'sending',
      attempts: 2,
      sendingStartedAt: startedAt,
    });
    await expect(retry()).resolves.toMatchObject({ ok: true });
    expect((await readEmailLog()).find((row) => row.id === logId)).toMatchObject({
      status: 'sending',
      attempts: 2,
      sendingStartedAt: startedAt.toISOString(),
    });

    await setEmailDeliveryDirect(logId, { status: 'sent', attempts: 2 });
    await expect(retry()).resolves.toMatchObject({ ok: true });
    expect((await readEmailLog()).find((row) => row.id === logId)).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
  });

  test('the original invitation expiry remains final when the CFP window is extended', async () => {
    const { guest, invitationId } = await draftWithInvitation();
    await setSpeakerInvitationExpiryDirect(
      'linked-talk',
      invitationId,
      new Date(Date.now() - 60_000),
    );
    await setCfpWindow({ closesAt: new Date(Date.now() + 60 * 86_400_000) });

    const summary = await callJson(guest.idToken, 'getCoSpeakerInvitation', {
      proposalId: 'linked-talk',
      invitationId,
    });
    expect(summary.invitation).toMatchObject({ state: 'expired', canRespond: false });
    await expect(
      callAs(guest.idToken, 'respondToCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
        response: 'accept',
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  test('event admins cannot alter a draft roster without the lead speaker', async () => {
    const { guest, invitationId } = await draftWithInvitation();
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);

    await expect(
      callAs(admin.idToken, 'inviteCoSpeaker', {
        proposalId: 'linked-talk',
        email: 'another-speaker@example.org',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    await expect(
      callAs(admin.idToken, 'revokeCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'linked-talk',
      invitationId,
      response: 'accept',
    });
    await expect(
      callAs(admin.idToken, 'removeCoSpeaker', {
        proposalId: 'linked-talk',
        uid: guest.uid,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('draft removal leaves no empty review snapshot and the lead can still delete it', async () => {
    const { lead, guest } = await joinedDraft();
    await callJson(lead.idToken, 'removeCoSpeaker', {
      proposalId: 'linked-talk',
      uid: guest.uid,
    });

    const draft = await readProposalById('linked-talk');
    expect(draft?.speakerSnapshot).toBeUndefined();
    expect(draft?.formerSpeakerSnapshot).toBeUndefined();
    await expect(
      callAs(lead.idToken, 'deleteDraftProposal', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readProposalById('linked-talk')).toBeNull();
  });

  test('a co-speaker can leave, rejoin from a fresh invitation, and remains conflicted', async () => {
    const { lead, guest, invitationId } = await joinedDraft();
    const left = await callJson(guest.idToken, 'removeCoSpeaker', {
      proposalId: 'linked-talk',
      uid: guest.uid,
    });
    expect(left).toMatchObject({ ok: true, roster: null });
    expect(await readProposalById('linked-talk')).toMatchObject({
      speakerIds: [lead.uid],
      formerSpeakerIds: [guest.uid],
    });
    expect(await readSpeakerParticipant('linked-talk', guest.uid)).toMatchObject({
      status: 'inactive',
      removedBy: guest.uid,
    });
    await expect(
      callAs(guest.idToken, 'getProposalRoster', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const oldSummary = (
      await callJson(guest.idToken, 'getCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
      })
    ).invitation;
    expect(oldSummary).toMatchObject({
      state: 'unavailable',
      matchesSignedInEmail: true,
      canRespond: false,
    });
    await expect(
      callAs(guest.idToken, 'respondToCoSpeakerInvitation', {
        proposalId: 'linked-talk',
        invitationId,
        response: 'accept',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const reinvited = await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'linked-talk',
      email: GUEST.email,
    });
    expect(reinvited.invitationId).not.toBe(invitationId);
    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'linked-talk',
      invitationId: reinvited.invitationId,
      response: 'accept',
    });
    expect(await readProposalById('linked-talk')).toMatchObject({
      speakerIds: [lead.uid, guest.uid],
      formerSpeakerIds: [guest.uid],
    });
    expect(await readSpeakerParticipant('linked-talk', guest.uid)).toMatchObject({
      status: 'active',
      invitationId: reinvited.invitationId,
    });

    await completeGuestDetails(guest.uid);
    await seedMember(guest.uid, 'reviewer', CFP_ID, GUEST.email);
    await callJson(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' });
    await expect(
      callAs(guest.idToken, 'saveReview', {
        proposalId: 'linked-talk',
        score: 4,
        conflictOfInterest: false,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('a fresh invitation delivery lease blocks draft deletion until it expires', async () => {
    const { lead, invitationId } = await draftWithInvitation();
    const logId = `co_speaker_invited__linked-talk__${invitationId}`;
    await waitForEmail(
      (rows) =>
        rows.some(
          (row) =>
            row.id === logId && !['queued', 'sending'].includes(String(row.status)),
        ),
      'initial co-speaker invitation delivery',
    );

    await setEmailSendingDirect(logId, new Date());
    await expect(
      callAs(lead.idToken, 'deleteDraftProposal', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(await readProposalById('linked-talk')).not.toBeNull();

    await setEmailSendingDirect(logId, new Date(Date.now() - 24 * 60 * 60 * 1_000));
    await expect(
      callAs(lead.idToken, 'deleteDraftProposal', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readProposalById('linked-talk')).toBeNull();
  });

  test('email sign-in preserves only the exact active invitation destination', async () => {
    const { invitationId } = await draftWithInvitation();
    await clearSignInAllowance();
    await setPublicUrlDirect('http://localhost:5173');
    const request = (email: string) =>
      callPublic('requestSignInLink', {
        email,
        locale: 'en',
        destination: 'submit',
        proposalId: 'linked-talk',
        speakerInvitationId: invitationId,
      });

    await expect(request('not-the-invitee@example.org')).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    await expect(request(GUEST.email)).resolves.toMatchObject({ ok: true });

    const links = (await readSignInLinks()).filter((link) => link.email === GUEST.email);
    expect(links.length).toBeGreaterThan(0);
    const continueUrl = new URL(links[links.length - 1].link).searchParams.get('continueUrl');
    expect(continueUrl).toBe(
      `http://localhost:5173/c/${CFP_ID}/submit?proposal=linked-talk&speakerInvite=${invitationId}`,
    );
  });

  test('an accepted invite can sign in without a session only while that speaker remains active', async () => {
    const { lead, guest, invitationId } = await joinedDraft();
    await clearSignInAllowance();
    await setPublicUrlDirect('http://localhost:5173');
    const request = () =>
      callPublic('requestSignInLink', {
        email: GUEST.email,
        locale: 'en',
        destination: 'submit',
        proposalId: 'linked-talk',
        speakerInvitationId: invitationId,
      });

    await expect(request()).resolves.toMatchObject({ ok: true });
    await callJson(lead.idToken, 'removeCoSpeaker', {
      proposalId: 'linked-talk',
      uid: guest.uid,
    });
    await expect(request()).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  test('shortening the current CFP window invalidates invitation sign-in immediately', async () => {
    const { guest, invitationId } = await draftWithInvitation();
    await clearSignInAllowance();
    await setPublicUrlDirect('http://localhost:5173');
    await setCfpWindow({ closesAt: new Date(Date.now() - 1_000) });

    const summary = await callJson(guest.idToken, 'getCoSpeakerInvitation', {
      proposalId: 'linked-talk',
      invitationId,
    });
    expect(summary.invitation).toMatchObject({ state: 'expired', canRespond: false });
    await expect(
      callPublic('requestSignInLink', {
        email: GUEST.email,
        locale: 'en',
        destination: 'submit',
        proposalId: 'linked-talk',
        speakerInvitationId: invitationId,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  test('admins see submitted roster snapshots, never later global-profile edits', async () => {
    const { lead, guest, admin } = await submitAndAccept();
    await seedSpeaker(lead.uid, {
      name: 'Changed Lead In A Later Event',
      email: 'changed-lead@example.org',
    });
    await seedSpeaker(guest.uid, {
      name: 'Changed Guest In A Later Event',
      email: 'changed-guest@example.org',
    });
    const roster = (
      await callJson(admin.idToken, 'getProposalRoster', { proposalId: 'linked-talk' })
    ).roster;
    expect(roster.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: lead.uid, name: LEAD.name }),
        expect.objectContaining({ uid: guest.uid, name: GUEST.name }),
      ]),
    );
    expect(
      roster.items.every((item: Record<string, unknown>) => item.email === undefined),
    ).toBe(true);
    expect(JSON.stringify(roster)).not.toContain('Changed Lead In A Later Event');
    expect(JSON.stringify(roster)).not.toContain('Changed Guest In A Later Event');
  });

  test('every joined speaker completes private details before one deduplicated receipt per person', async () => {
    const { lead, guest } = await joinedDraft();

    await expect(
      callAs(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readSpeakerParticipant('linked-talk', guest.uid)).toMatchObject({
      acks: {},
      attendance: {},
    });

    await completeGuestDetails(guest.uid);
    await callJson(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' });
    await waitForEmail(
      (rows) => rows.filter((row) => row.kind === 'submission_received').length === 2,
      'one submission receipt for each speaker',
    );

    const firstReceipts = (await readEmailLog())
      .filter((row) => row.kind === 'submission_received')
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(firstReceipts.map((row) => row.id)).toEqual([
      'submission_received__linked-talk',
      `submission_received__linked-talk__${guest.uid}`,
    ].sort());
    expect(firstReceipts.map((row) => row.to).sort()).toEqual([
      GUEST.email,
      LEAD.email,
    ]);

    const repeated = await callJson(lead.idToken, 'submitProposal', {
      proposalId: 'linked-talk',
    });
    expect(repeated.alreadySubmitted).toBe(true);
    expect(
      (await readEmailLog()).filter((row) => row.kind === 'submission_received').map((row) => row.id),
    ).toHaveLength(2);

    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
    await callJson(admin.idToken, 'setProposalStatus', {
      proposalId: 'linked-talk',
      status: 'accepted',
    });
    await callJson(admin.idToken, 'setProposalStatus', {
      proposalId: 'linked-talk',
      status: 'accepted',
    });
    const decisions = (await readEmailLog()).filter((row) => row.kind === 'accepted');
    expect(decisions.map((row) => row.id).sort()).toEqual([
      'accepted__linked-talk',
      `accepted__linked-talk__${guest.uid}`,
    ].sort());
    expect(decisions.every((row) => row.status === 'held')).toBe(true);
  });

  test('confirmation answers and headshots stay per speaker until everyone confirms', async () => {
    const PHOTO = {
      key: 'headshot',
      type: 'image',
      label: { en: 'Speaker headshot', fr: 'Photo du conférencier' },
      required: true,
    };
    const NOTE = {
      key: 'speaker_note',
      type: 'text',
      label: { en: 'Speaker note', fr: 'Note du conférencier' },
      required: true,
    };
    const base64 = readFileSync('tests/fixtures/headshot.png').toString('base64');
    const { lead, guest } = await submitAndAccept();
    await setConfirmFormDirect([PHOTO, NOTE]);

    for (const speaker of [lead, guest]) {
      await callJson(speaker.idToken, 'uploadHeadshot', {
        proposalId: 'linked-talk',
        key: 'headshot',
        contentType: 'image/png',
        base64,
      });
    }

    const leadUpload = await readSpeakerConfirmation('linked-talk', lead.uid);
    const guestUpload = await readSpeakerConfirmation('linked-talk', guest.uid);
    expect(leadUpload?.headshotUploads.headshot.path).toContain(`/${lead.uid}/headshot/`);
    expect(guestUpload?.headshotUploads.headshot.path).toContain(`/${guest.uid}/headshot/`);
    expect(leadUpload?.headshotUploads.headshot.path).not.toBe(
      guestUpload?.headshotUploads.headshot.path,
    );

    await callJson(guest.idToken, 'respondToDecision', {
      proposalId: 'linked-talk',
      response: 'confirm',
      answers: { speaker_note: 'Guest needs the aisle microphone.' },
    });
    expect((await readProposalById('linked-talk'))?.status).toBe('accepted');
    expect(await readSpeakerConfirmation('linked-talk', guest.uid)).toMatchObject({
      uid: guest.uid,
      response: 'confirmed',
      answers: { speaker_note: 'Guest needs the aisle microphone.' },
    });
    expect((await readSpeakerConfirmation('linked-talk', lead.uid))?.response).toBeUndefined();

    await callJson(lead.idToken, 'respondToDecision', {
      proposalId: 'linked-talk',
      response: 'confirm',
      answers: { speaker_note: 'Lead will bring the demo device.' },
    });
    expect((await readProposalById('linked-talk'))?.status).toBe('confirmed');
    expect(await readSpeakerConfirmation('linked-talk', lead.uid)).toMatchObject({
      uid: lead.uid,
      response: 'confirmed',
      answers: { speaker_note: 'Lead will bring the demo device.' },
    });

    const frozen = await readStoredObjects(
      `cfps/${CFP_ID}/confirmedHeadshots/linked-talk/`,
    );
    expect(frozen.some((path) => path.includes(`/${lead.uid}/headshot/`))).toBe(true);
    expect(frozen.some((path) => path.includes(`/${guest.uid}/headshot/`))).toBe(true);
  });

  test('a removed former speaker remains conflicted while an independent reviewer succeeds', async () => {
    const { lead, guest, admin } = await submitAndAccept();
    await callJson(guest.idToken, 'respondToDecision', {
      proposalId: 'linked-talk',
      response: 'decline',
    });
    await callJson(admin.idToken, 'removeCoSpeaker', {
      proposalId: 'linked-talk',
      uid: guest.uid,
    });

    const emailPreview = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
    expect(emailPreview.held).toEqual([
      expect.objectContaining({ logId: 'accepted__linked-talk', to: LEAD.email }),
    ]);
    expect(emailPreview.staleHeld).toBeGreaterThanOrEqual(1);
    expect(emailPreview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logId: `accepted__linked-talk__${guest.uid}`,
          stale: true,
        }),
      ]),
    );

    await callJson(admin.idToken, 'setProposalStatus', {
      proposalId: 'linked-talk',
      status: 'under_review',
    });

    await seedMember(guest.uid, 'reviewer', CFP_ID, GUEST.email);
    await expect(
      callAs(guest.idToken, 'saveReview', {
        proposalId: 'linked-talk',
        score: 4,
        conflictOfInterest: false,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    const reviewer = await createAccount(REVIEWER);
    await seedMember(reviewer.uid, 'reviewer', CFP_ID, REVIEWER.email);
    await expect(
      callAs(reviewer.idToken, 'saveReview', {
        proposalId: 'linked-talk',
        score: 4,
        conflictOfInterest: false,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readProposalById('linked-talk')).toMatchObject({
      speakerIds: [lead.uid],
      formerSpeakerIds: [guest.uid],
    });
  });

  test('a removed former speaker does not receive the committee submission notice', async () => {
    const { lead, guest } = await joinedDraft();
    const reviewer = await createAccount(REVIEWER);
    await seedMember(guest.uid, 'reviewer', CFP_ID, GUEST.email);
    await seedMember(reviewer.uid, 'reviewer', CFP_ID, REVIEWER.email);
    await callJson(lead.idToken, 'removeCoSpeaker', {
      proposalId: 'linked-talk',
      uid: guest.uid,
    });

    await callJson(lead.idToken, 'submitProposal', { proposalId: 'linked-talk' });
    const rows = await waitForEmail(
      (current) =>
        current.some(
          (row) =>
            row.kind === 'committee_proposal_submitted' &&
            row.recipientUid === reviewer.uid &&
            !['queued', 'sending'].includes(String(row.status)),
        ),
      'settled committee notice for the independent reviewer',
    );
    const staffNotices = rows.filter(
      (row) => row.kind === 'committee_proposal_submitted',
    );
    expect(staffNotices).toEqual([
      expect.objectContaining({
        id: `committee_proposal_submitted__linked-talk__${reviewer.uid}`,
        recipientUid: reviewer.uid,
        to: REVIEWER.email,
      }),
    ]);
    expect(JSON.stringify(staffNotices)).not.toContain(GUEST.email);
    expect(JSON.stringify(staffNotices)).not.toContain(guest.uid);
  });

  test('legacy single-speaker confirmation still uses the proposal document', async () => {
    const legacy = await createAccount({
      sub: 'legacy-speaker',
      email: 'legacy@example.org',
      name: 'Legacy Speaker',
    });
    await seedSpeaker(legacy.uid, { name: 'Legacy Speaker', email: 'legacy@example.org' });
    await seedProposal('legacy-talk', {
      speakerUid: legacy.uid,
      title: 'A proposal created before speaker rosters',
      status: 'accepted',
    });

    await callJson(legacy.idToken, 'respondToDecision', {
      proposalId: 'legacy-talk',
      response: 'confirm',
      answers: {},
    });

    expect(await readProposalById('legacy-talk')).toMatchObject({
      status: 'confirmed',
      confirmAnswers: {},
    });
    expect(await readSpeakerConfirmation('legacy-talk', legacy.uid)).toBeNull();
  });
});
