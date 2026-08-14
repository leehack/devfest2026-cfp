import { expect, test } from '@playwright/test';

import { renderEmail } from '@shared/emailTemplates';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  createUnverifiedAccount,
  inviteRole,
  readEmailLog,
  reviewedEmailConfiguration,
  reset,
  seedMember,
  seedPlatformMember,
  seedProposal,
  seedSpeaker,
  setEmailStatusDirect,
  setPlatformEmailDeliveryReadyDirect,
  waitForEmail,
} from './backend';
import type { Identity } from './form';

const SPEAKER_REVIEWER: Identity = {
  sub: 'staff-speaker-reviewer',
  email: 'staff-speaker-reviewer@example.org',
  name: 'Sawyer Speaker Reviewer',
};
const OWNER: Identity = {
  sub: 'staff-owner',
  email: 'staff-owner@example.org',
  name: 'Oak Owner',
};
const ADMIN: Identity = {
  sub: 'staff-admin',
  email: 'staff-admin@example.org',
  name: 'Ari Admin',
};
const NOTIFIED_ADMIN: Identity = {
  sub: 'staff-notified-admin',
  email: 'staff-notified-admin@example.org',
  name: 'Noel Admin',
};
const REVIEWER: Identity = {
  sub: 'staff-reviewer',
  email: 'staff-reviewer@example.org',
  name: 'Riley Reviewer',
};
const PENDING: Identity = {
  sub: 'staff-pending',
  email: 'staff-pending@example.org',
  name: 'Parker Pending',
};
const REVOKED: Identity = {
  sub: 'staff-revoked',
  email: 'staff-revoked@example.org',
  name: 'Remy Revoked',
};
const GLOBAL_ONLY: Identity = {
  sub: 'staff-global-only',
  email: 'staff-global-only@example.org',
  name: 'Gale Global',
};
const UNVERIFIED_EMAIL = 'staff-unverified@example.org';
const INVITEE_EMAIL = 'staff-invitee@example.org';

test.beforeEach(async () => {
  await reset();
  await setPlatformEmailDeliveryReadyDirect();
});

test('a pending committee invite dedupes role edits, becomes stale on revoke, and re-invite gets a fresh authenticated link', async () => {
  const owner = await createAccount(OWNER);
  await seedMember(owner.uid, 'owner', undefined, OWNER.email);

  const firstGrant = await callJson(owner.idToken, 'grantRole', {
    email: INVITEE_EMAIL,
    role: 'reviewer',
  });
  expect(firstGrant).toMatchObject({
    email: INVITEE_EMAIL,
    role: 'reviewer',
    applied: false,
  });
  expect(firstGrant.invitationId).toEqual(expect.any(String));
  const firstLogId = `committee_role_invited__${firstGrant.invitationId}`;

  const firstRows = await waitForEmail(
    (rows) => rows.some((row) => row.id === firstLogId && row.status === 'dry_run'),
    'the pending committee invitation',
  );
  const firstInvite = firstRows.find((row) => row.id === firstLogId);
  expect(firstInvite).toMatchObject({
    kind: 'committee_role_invited',
    proposalId: firstGrant.invitationId,
    grantEmail: INVITEE_EMAIL,
    to: INVITEE_EMAIL,
    status: 'dry_run',
    attempts: 1,
    data: { speakerName: INVITEE_EMAIL, title: '' },
  });

  const reviewUrl = `http://localhost:5173/c/${CFP_ID}/review`;
  const rendered = renderEmail('committee_role_invited', 'en', {
    speakerName: 'Private invitee name',
    title: 'Private proposal title',
    event: 'DevFest Montréal 2026',
    proposalUrl: `http://localhost:5173/c/${CFP_ID}/submit`,
    reviewUrl,
  });
  expect(rendered.text).toContain(reviewUrl);
  expect(rendered.text).not.toContain('Private invitee name');
  expect(rendered.text).not.toContain('Private proposal title');

  // Editing the pending role retains the invitation identity, so neither the
  // document trigger nor a deterministic log id can create a second message.
  const editedGrant = await callJson(owner.idToken, 'grantRole', {
    email: INVITEE_EMAIL,
    role: 'admin',
  });
  expect(editedGrant).toMatchObject({
    email: INVITEE_EMAIL,
    role: 'admin',
    applied: false,
    invitationId: firstGrant.invitationId,
  });
  expect(
    (await readEmailLog()).filter((row) => row.kind === 'committee_role_invited'),
  ).toHaveLength(1);

  await callJson(owner.idToken, 'revokeRole', { email: INVITEE_EMAIL });
  const preview = await callJson(owner.idToken, 'emailQueue', { action: 'preview' });
  expect(preview.rows).toContainEqual(
    expect.objectContaining({ logId: firstLogId, stale: true }),
  );
  expect(
    await callAs(owner.idToken, 'emailQueue', {
      action: 'resend',
      logId: firstLogId,
      reviewedTo: INVITEE_EMAIL,
      ...reviewedEmailConfiguration(preview),
    }),
  ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

  const attemptsBeforeRetry = firstInvite?.attempts;
  await setEmailStatusDirect(firstLogId, 'queued');
  const revokedRows = await waitForEmail(
    (rows) => rows.some((row) => row.id === firstLogId && row.status === 'failed'),
    'the revoked invitation retry refusal',
  );
  expect(revokedRows.find((row) => row.id === firstLogId)?.attempts).toBe(
    attemptsBeforeRetry,
  );

  const secondGrant = await callJson(owner.idToken, 'grantRole', {
    email: INVITEE_EMAIL,
    role: 'reviewer',
  });
  expect(secondGrant.invitationId).toEqual(expect.any(String));
  expect(secondGrant.invitationId).not.toBe(firstGrant.invitationId);
  const secondLogId = `committee_role_invited__${secondGrant.invitationId}`;
  const reinvitedRows = await waitForEmail(
    (rows) => rows.some((row) => row.id === secondLogId && row.status === 'dry_run'),
    'the fresh committee re-invitation',
  );
  expect(
    reinvitedRows
      .filter((row) => row.kind === 'committee_role_invited')
      .map((row) => row.id)
      .sort(),
  ).toEqual([firstLogId, secondLogId].sort());
});

test('a submitted proposal notifies each eligible active event staff member once without private proposal data', async () => {
  const [speaker, owner, admin, reviewer, pending, revoked, globalOnly, unverified] =
    await Promise.all([
      createAccount(SPEAKER_REVIEWER),
      createAccount(OWNER),
      createAccount(ADMIN),
      createAccount(REVIEWER),
      createAccount(PENDING),
      createAccount(REVOKED),
      createAccount(GLOBAL_ONLY),
      createUnverifiedAccount({ email: UNVERIFIED_EMAIL }),
    ]);
  const proposalId = 'staff-private-proposal';
  const privateTitle = 'A private proposal title that must not enter staff copy';

  await Promise.all([
    seedSpeaker(speaker.uid, {
      name: SPEAKER_REVIEWER.name,
      email: SPEAKER_REVIEWER.email,
    }),
    // A role-holder who submits a proposal is the actor and must not receive a
    // notification about their own item.
    seedMember(speaker.uid, 'reviewer', undefined, SPEAKER_REVIEWER.email),
    seedMember(owner.uid, 'owner', undefined, OWNER.email),
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
    seedMember(revoked.uid, 'reviewer', undefined, REVOKED.email),
    seedMember(unverified.uid, 'reviewer', undefined, UNVERIFIED_EMAIL),
    inviteRole(PENDING.email, 'reviewer'),
    seedPlatformMember(globalOnly.uid, 'owner', GLOBAL_ONLY.email, GLOBAL_ONLY.name),
    seedProposal(proposalId, {
      speakerUid: speaker.uid,
      title: privateTitle,
      status: 'draft',
      includeSpeakerSnapshot: false,
    }),
  ]);
  await callJson(admin.idToken, 'revokeRole', { email: REVOKED.email });

  await expect(
    callJson(speaker.idToken, 'submitProposal', { proposalId }),
  ).resolves.toMatchObject({ ok: true, alreadySubmitted: false });

  const rows = await waitForEmail(
    (current) =>
      current.filter((row) => row.kind === 'committee_proposal_submitted').length === 3,
    'ready-for-review staff notifications',
  );
  const staff = rows
    .filter((row) => row.kind === 'committee_proposal_submitted')
    .sort((left, right) => left.id.localeCompare(right.id));
  const expectedRecipients = [owner.uid, admin.uid, reviewer.uid].sort();

  expect(staff.map((row) => row.recipientUid).sort()).toEqual(expectedRecipients);
  expect(staff.map((row) => row.id).sort()).toEqual(
    expectedRecipients
      .map((uid) => `committee_proposal_submitted__${proposalId}__${uid}`)
      .sort(),
  );
  for (const row of staff) {
    expect(row.proposalId).toBe(proposalId);
    expect(row.data).toMatchObject({ title: '' });
    expect(JSON.stringify(row)).not.toContain(privateTitle);
    expect(JSON.stringify(row)).not.toContain(SPEAKER_REVIEWER.email);
    expect(JSON.stringify(row)).not.toContain(SPEAKER_REVIEWER.name);
  }
  const actualRecipients = new Set(staff.map((row) => row.recipientUid));
  for (const omitted of [speaker.uid, pending.uid, revoked.uid, globalOnly.uid, unverified.uid]) {
    expect(actualRecipients.has(omitted), omitted).toBe(false);
  }

  const firstIds = (await readEmailLog()).map((row) => row.id).sort();
  await expect(
    callJson(speaker.idToken, 'submitProposal', { proposalId }),
  ).resolves.toMatchObject({ ok: true, alreadySubmitted: true });
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(firstIds);
});

test('a shared preview notifies current staff once per release while publish sends nothing', async () => {
  const [speaker, owner, admin, notifiedAdmin, reviewer, pending, revoked, globalOnly, unverified] =
    await Promise.all([
      createAccount(SPEAKER_REVIEWER),
      createAccount(OWNER),
      createAccount(ADMIN),
      createAccount(NOTIFIED_ADMIN),
      createAccount(REVIEWER),
      createAccount(PENDING),
      createAccount(REVOKED),
      createAccount(GLOBAL_ONLY),
      createUnverifiedAccount({ email: UNVERIFIED_EMAIL }),
    ]);
  const proposalId = 'staff-scheduled-proposal';
  const privateTitle = 'Private scheduled proposal title';
  await Promise.all([
    seedSpeaker(speaker.uid, {
      name: SPEAKER_REVIEWER.name,
      email: SPEAKER_REVIEWER.email,
    }),
    seedMember(owner.uid, 'owner', undefined, OWNER.email),
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(notifiedAdmin.uid, 'admin', undefined, NOTIFIED_ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
    seedMember(revoked.uid, 'reviewer', undefined, REVOKED.email),
    seedMember(unverified.uid, 'reviewer', undefined, UNVERIFIED_EMAIL),
    inviteRole(PENDING.email, 'reviewer'),
    seedPlatformMember(globalOnly.uid, 'owner', GLOBAL_ONLY.email, GLOBAL_ONLY.name),
    seedProposal(proposalId, {
      speakerUid: speaker.uid,
      title: privateTitle,
      status: 'confirmed',
    }),
  ]);
  await callJson(admin.idToken, 'revokeRole', { email: REVOKED.email });

  const config = {
    timeZone: 'America/Toronto',
    revision: 0,
    days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
    rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
  };
  let state = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  state = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: state.revision,
    entry: {
      id: proposalId,
      kind: 'proposal',
      proposalId,
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const firstShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: state.revision,
  });
  expect(firstShared).toMatchObject({ committeeNotificationCount: 3 });

  const firstRows = await waitForEmail(
    (rows) =>
      rows.filter((row) => row.kind === 'committee_schedule_shared').length === 3 &&
      rows
        .filter((row) => row.kind === 'committee_schedule_shared')
        .every((row) => row.status === 'dry_run') &&
      rows.some(
        (row) =>
          row.kind === 'schedule_assigned' &&
          row.proposalId === proposalId &&
          row.status === 'held',
      ),
    'first shared-preview staff and speaker notifications',
  );
  const firstStaff = firstRows.filter((row) => row.kind === 'committee_schedule_shared');
  const firstRecipients = [owner.uid, notifiedAdmin.uid, reviewer.uid].sort();
  expect(firstStaff.map((row) => row.recipientUid).sort()).toEqual(firstRecipients);
  expect(firstStaff.map((row) => row.id).sort()).toEqual(
    firstRecipients
      .map((uid) => `committee_schedule_shared__${firstShared.releaseId}__${uid}`)
      .sort(),
  );
  for (const row of firstStaff) {
    expect(row.proposalId).toBe(firstShared.releaseId);
    expect(row.data).toMatchObject({ title: '' });
    expect(JSON.stringify(row)).not.toContain(privateTitle);
    expect(JSON.stringify(row)).not.toContain('2026-11-14');
    expect(JSON.stringify(row)).not.toContain('Main room');
  }
  const omitted = [admin.uid, pending.uid, revoked.uid, globalOnly.uid, unverified.uid];
  for (const uid of omitted) {
    expect(firstStaff.some((row) => row.recipientUid === uid), uid).toBe(false);
  }

  const beforeFirstPublish = (await readEmailLog()).map((row) => row.id).sort();
  const firstPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: firstShared.revision,
  });
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(beforeFirstPublish);

  // A queued/retried staff message is re-authorised at send time. Revocation
  // makes the existing row terminal without another attempt and excludes the
  // same person from the next immutable release.
  await callJson(admin.idToken, 'revokeRole', { email: REVIEWER.email });
  const reviewerLogId = `committee_schedule_shared__${firstShared.releaseId}__${reviewer.uid}`;
  const attemptsBefore = (await readEmailLog()).find((row) => row.id === reviewerLogId)?.attempts;
  await setEmailStatusDirect(reviewerLogId, 'queued');
  await waitForEmail(
    (rows) => rows.some((row) => row.id === reviewerLogId && row.status === 'failed'),
    'revoked staff notification revalidation',
  );
  expect((await readEmailLog()).find((row) => row.id === reviewerLogId)?.attempts).toBe(
    attemptsBefore,
  );

  state = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: firstPublished.revision,
    entry: {
      id: 'staff-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Break', fr: 'Pause' },
      date: '2026-11-14',
      startsAt: '11:00',
      durationMinutes: 20,
      roomId: 'main',
    },
  });
  const secondShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: state.revision,
  });
  expect(secondShared).toMatchObject({ committeeNotificationCount: 2 });
  const secondRows = await waitForEmail(
    (rows) => rows.filter((row) => row.kind === 'committee_schedule_shared').length === 5,
    'second shared-preview staff notifications',
  );
  const secondStaff = secondRows.filter(
    (row) =>
      row.kind === 'committee_schedule_shared' && row.proposalId === secondShared.releaseId,
  );
  expect(secondStaff.map((row) => row.recipientUid).sort()).toEqual(
    [owner.uid, notifiedAdmin.uid].sort(),
  );
  expect(secondStaff.some((row) => row.recipientUid === reviewer.uid)).toBe(false);

  const beforeSecondPublish = (await readEmailLog()).map((row) => row.id).sort();
  await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: secondShared.revision,
  });
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(beforeSecondPublish);
  expect(
    await callAs(admin.idToken, 'shareSchedulePreview', {
      expectedRevision: secondShared.revision,
    }),
  ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(beforeSecondPublish);
});
