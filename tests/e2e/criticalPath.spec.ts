import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createCompleteDraftAs,
  createAccount,
  readEmailLog,
  readProposalById,
  readProposalIdsForSpeaker,
  readPublicScheduleEntry,
  readScheduleEntry,
  reviewedEmailConfiguration,
  reviewedEmailRecipients,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  setEmailDeliveryReadyDirect,
  setConfirmFormDirect,
  storeObjectDirect,
  waitForEmail,
} from './backend';
import { EvidenceRecorder } from './evidence';
import { at, field, fillRequired, signInAs, type Identity } from './form';

const OWNER: Identity = {
  sub: 'critical-owner',
  email: 'critical-owner@example.org',
  name: 'Oak Owner',
};
const ADMIN: Identity = {
  sub: 'critical-admin',
  email: 'critical-admin@example.org',
  name: 'Ari Admin',
};
const HEADSHOT_BYTES = readFileSync('tests/fixtures/headshot.png');
const REVIEWER: Identity = {
  sub: 'critical-reviewer',
  email: 'critical-reviewer@example.org',
  name: 'Riley Reviewer',
};
const INITIAL_ACCEPTED: Identity = {
  sub: 'critical-initial-accepted',
  email: 'critical-initial-accepted@example.org',
  name: 'Alex Initial',
};
const INITIAL_REJECTED: Identity = {
  sub: 'critical-initial-rejected',
  email: 'critical-initial-rejected@example.org',
  name: 'Robin Initial',
};
const LATE_ACCEPTED: Identity = {
  sub: 'critical-late-accepted',
  email: 'critical-late-accepted@example.org',
  name: 'Lane Late',
};
const LATE_REJECTED: Identity = {
  sub: 'critical-late-rejected',
  email: 'critical-late-rejected@example.org',
  name: 'Reese Late',
};

const INITIAL_ACCEPTED_ID = 'critical-initial-accepted';
const INITIAL_REJECTED_ID = 'critical-initial-rejected';

const CONFIRM_FIELDS = [
  {
    key: 'shirt',
    type: 'select',
    label: { en: 'T-shirt size', fr: 'Taille de t-shirt' },
    required: true,
    options: [
      { value: 'M', label: { en: 'M' } },
      { value: 'L', label: { en: 'L' } },
    ],
  },
  {
    key: 'headshot',
    type: 'image',
    label: { en: 'Headshot photo', fr: 'Photo de profil' },
    required: true,
  },
  {
    key: 'arrival',
    type: 'text',
    label: { en: 'When will you arrive?', fr: 'Quand arriverez-vous?' },
    required: true,
  },
];

const SCHEDULE_CONFIG = {
  timeZone: 'America/Toronto',
  revision: 0,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
};

async function signInForEvidence(page: Page, who: Identity, path: string) {
  await page.goto('/');
  const account = page.getByRole('button', { name: 'Account' });
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(account.or(signIn)).toBeVisible();
  if (await account.isVisible()) {
    await account.click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signIn).toBeVisible();
  }
  await signInAs(page, who, path);
  // Evidence switches several identities in one page. A signed-out boundary
  // plus reload makes each capture start from that account's persisted state,
  // never the prior persona's in-progress confirmation or filter state.
  await page.reload();
}

async function releaseHeldDecisions(adminToken: string, proposalIds: readonly string[]) {
  await setEmailDeliveryReadyDirect();
  const preview = await callJson(adminToken, 'emailQueue', { action: 'preview' });
  const selectedRows = preview.held
    .filter(
      (row: { logId: string; kind: string }) =>
        ['accepted', 'waitlisted', 'rejected'].includes(row.kind) &&
        proposalIds.includes(row.logId.slice(row.kind.length + 2)),
    ) as Array<{ logId: string; to: string }>;
  const selected = selectedRows.map((row) => row.logId);
  expect(selected).toHaveLength(proposalIds.length);
  await expect(
    callJson(adminToken, 'emailQueue', {
      action: 'release',
      logIds: selected,
      reviewedRecipients: reviewedEmailRecipients(selectedRows),
      ...reviewedEmailConfiguration(preview),
    }),
  ).resolves.toMatchObject({ ok: true, released: proposalIds.length, stale: 0 });
  await waitForEmail(
    (rows) =>
      selected.every((id) => rows.some((row) => row.id === id && row.status === 'dry_run')),
    'released decisions',
  );
}

async function releaseHeldSchedule(
  adminToken: string,
  proposalId: string,
  releaseId: string,
) {
  await setEmailDeliveryReadyDirect();
  const preview = await callJson(adminToken, 'emailQueue', { action: 'preview' });
  const selectedRows = preview.held
    .filter(
      (row: { logId: string; kind: string }) =>
        ['schedule_assigned', 'schedule_changed'].includes(row.kind) &&
        row.logId.includes(`__${proposalId}__`) &&
        row.logId.endsWith(`__${releaseId}`),
    ) as Array<{ logId: string; to: string }>;
  const selected = selectedRows.map((row) => row.logId);
  expect(selected).toHaveLength(1);
  await expect(
    callJson(adminToken, 'emailQueue', {
      action: 'release',
      logIds: selected,
      reviewedRecipients: reviewedEmailRecipients(selectedRows),
      ...reviewedEmailConfiguration(preview),
    }),
  ).resolves.toMatchObject({ ok: true, released: 1, stale: 0 });
  await waitForEmail(
    (rows) =>
      selected.every((id) => rows.some((row) => row.id === id && row.status === 'dry_run')),
    'released schedule placement',
  );
}

async function confirmWithRequiredDetails(
  speaker: { uid: string; idToken: string },
  proposalId: string,
  shirt: 'M' | 'L',
) {
  const headshot = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
  await storeObjectDirect(headshot, 'image/png', HEADSHOT_BYTES);
  await expect(
    callJson(speaker.idToken, 'respondToDecision', {
      proposalId,
      response: 'confirm',
      answers: { shirt, arrival: 'Friday afternoon' },
    }),
  ).resolves.toMatchObject({ ok: true, status: 'confirmed' });
  const confirmAnswers = (await readProposalById(proposalId))?.confirmAnswers;
  expect(confirmAnswers).toMatchObject({
    shirt,
    arrival: 'Friday afternoon',
  });
  expect(confirmAnswers?.headshot).toMatch(
    new RegExp(`^cfps/${CFP_ID}/confirmedHeadshots/${proposalId}/headshot/[^/]+$`),
  );
}

test('the same proposals survive the full initial and late-intake lifecycle through archive', async ({
  page,
}) => {
  const evidence = new EvidenceRecorder();
  test.setTimeout(evidence.enabled ? 240_000 : 150_000);
  await evidence.prepare(page);
  await reset();

  const [owner, admin, reviewer, initialAccepted, initialRejected, lateAccepted, lateRejected] =
    await Promise.all(
      [
        OWNER,
        ADMIN,
        REVIEWER,
        INITIAL_ACCEPTED,
        INITIAL_REJECTED,
        LATE_ACCEPTED,
        LATE_REJECTED,
      ].map(createAccount),
    );
  await Promise.all([
    seedMember(owner.uid, 'owner', undefined, OWNER.email),
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
    setConfirmFormDirect(CONFIRM_FIELDS),
    seedSpeaker(initialAccepted.uid, {
      name: INITIAL_ACCEPTED.name,
      email: INITIAL_ACCEPTED.email,
    }),
    seedSpeaker(initialRejected.uid, {
      name: INITIAL_REJECTED.name,
      email: INITIAL_REJECTED.email,
    }),
    seedProposal(INITIAL_ACCEPTED_ID, {
      speakerUid: initialAccepted.uid,
      title: 'Initial selected session',
      status: 'draft',
      includeSpeakerSnapshot: false,
    }),
    seedProposal(INITIAL_REJECTED_ID, {
      speakerUid: initialRejected.uid,
      title: 'Initial rejected session',
      status: 'draft',
      includeSpeakerSnapshot: false,
    }),
  ]);

  if (evidence.enabled) {
    await signInForEvidence(page, OWNER, at('/admin/overview'));
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await evidence.capture(page, {
      step: 1,
      stem: '01-owner-configure-cfp',
      title: 'Configure the CFP and see the remaining setup work',
      persona: 'Event owner / admin',
      ready: page.getByText('Recommended next action · Step 1 of 17'),
    });
  }

  // Initial intake: these exact draft IDs now enter the real lifecycle.
  for (const [speaker, proposalId] of [
    [initialAccepted, INITIAL_ACCEPTED_ID],
    [initialRejected, INITIAL_REJECTED_ID],
  ] as const) {
    await expect(
      callJson(speaker.idToken, 'submitProposal', { proposalId }),
    ).resolves.toMatchObject({ ok: true, alreadySubmitted: false, proposalId });
  }
  await waitForEmail(
    (rows) => rows.filter((row) => row.kind === 'committee_proposal_submitted').length === 6,
    'initial ready-for-review notices',
  );

  if (evidence.enabled) {
    await signInForEvidence(page, INITIAL_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial selected session');
    await evidence.capture(page, {
      step: 2,
      stem: '02a-initial-accepted-speaker-submitted',
      title: 'Initial selected speaker sees the submitted proposal',
      persona: 'Initial accepted speaker',
      ready: page.getByRole('heading', { name: 'Submitted', exact: true }),
    });

    await signInForEvidence(page, INITIAL_REJECTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial rejected session');
    await evidence.capture(page, {
      step: 2,
      stem: '02b-initial-rejected-speaker-submitted',
      title: 'Initial rejected speaker sees the submitted proposal',
      persona: 'Initial rejected speaker',
      ready: page.getByRole('heading', { name: 'Submitted', exact: true }),
    });

    await signInForEvidence(page, REVIEWER, at('/review'));
    await evidence.capture(page, {
      step: 3,
      stem: '03-reviewer-initial-round',
      title: 'Committee member opens the initial review queue',
      persona: 'Committee reviewer',
      ready: page.getByText('0 of 2 responded'),
    });
  }

  for (const proposalId of [INITIAL_ACCEPTED_ID, INITIAL_REJECTED_ID]) {
    await expect(
      callJson(reviewer.idToken, 'saveReview', {
        proposalId,
        score: proposalId === INITIAL_ACCEPTED_ID ? 4 : 2,
        conflictOfInterest: false,
        comment: 'Initial-round review',
      }),
    ).resolves.toMatchObject({ ok: true, proposalId, status: 'under_review' });
    expect((await readProposalById(proposalId))?.status).toBe('under_review');
  }

  await callJson(admin.idToken, 'setProposalStatus', {
    proposalId: INITIAL_ACCEPTED_ID,
    status: 'accepted',
  });
  await callJson(admin.idToken, 'setProposalStatus', {
    proposalId: INITIAL_REJECTED_ID,
    status: 'rejected',
  });

  if (evidence.enabled) {
    await signInForEvidence(page, ADMIN, at('/admin/proposals'));
    await expect(page.getByLabel('Status: Initial selected session')).toHaveValue('accepted');
    await expect(page.getByLabel('Status: Initial rejected session')).toHaveValue('rejected');
    await evidence.capture(page, {
      step: 4,
      stem: '04-admin-initial-decisions',
      title: 'Admin reviews accepted and rejected initial decisions',
      persona: 'Event owner / admin',
      ready: page.getByRole('heading', { name: 'Proposal decisions' }),
    });
  }

  await releaseHeldDecisions(admin.idToken, [INITIAL_ACCEPTED_ID, INITIAL_REJECTED_ID]);

  if (evidence.enabled) {
    await signInForEvidence(page, INITIAL_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial selected session');
    await expect(page.getByRole('heading', { name: 'Accepted', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await evidence.capture(page, {
      step: 5,
      stem: '05a-initial-accepted-confirmation-form',
      title: 'Accepted speaker receives the decision and opens required confirmation details',
      persona: 'Initial accepted speaker',
      ready: page.getByLabel(/T-shirt size/),
    });

    await signInForEvidence(page, INITIAL_REJECTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial rejected session');
    await evidence.capture(page, {
      step: 5,
      stem: '05b-initial-rejected-decision',
      title: 'Rejected speaker sees a clear final decision',
      persona: 'Initial rejected speaker',
      ready: page.getByRole('heading', { name: 'Rejected', exact: true }),
    });
  }

  await confirmWithRequiredDetails(initialAccepted, INITIAL_ACCEPTED_ID, 'M');
  expect((await readProposalById(INITIAL_REJECTED_ID))?.status).toBe('rejected');

  if (evidence.enabled) {
    await signInForEvidence(page, INITIAL_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial selected session');
    await evidence.capture(page, {
      step: 5,
      stem: '05c-initial-accepted-confirmed',
      title: 'Initial selected speaker sees confirmation recorded',
      persona: 'Initial accepted speaker',
      ready: page.getByRole('heading', { name: 'Confirmed', exact: true }),
    });
  }

  let schedule = await callJson(admin.idToken, 'setScheduleConfig', {
    config: SCHEDULE_CONFIG,
    expectedRevision: 0,
  });
  schedule = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: schedule.revision,
    entry: {
      id: INITIAL_ACCEPTED_ID,
      kind: 'proposal',
      proposalId: INITIAL_ACCEPTED_ID,
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });

  if (evidence.enabled) {
    await signInForEvidence(page, ADMIN, at('/admin/schedule'));
    await expect(page.getByText('Initial selected session', { exact: true })).toBeVisible();
    await evidence.capture(page, {
      step: 6,
      stem: '06-admin-private-schedule',
      title: 'Admin places the confirmed session in the private schedule',
      persona: 'Event owner / admin',
      ready: page.getByRole('heading', { name: 'Private draft' }),
    });
  }

  const firstShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: schedule.revision,
  });
  await waitForEmail(
    (rows) =>
      rows.filter((row) => row.kind === 'committee_schedule_shared').length === 2 &&
      rows
        .filter((row) => row.kind === 'committee_schedule_shared')
        .every((row) => row.status === 'dry_run') &&
      rows.some(
        (row) =>
          row.kind === 'schedule_assigned' &&
          row.proposalId === INITIAL_ACCEPTED_ID &&
          row.status === 'held',
    ),
    'initial shared-preview notifications',
  );

  if (evidence.enabled) {
    await signInForEvidence(page, ADMIN, at('/admin/email'));
    await expect(
      page.locator('.table--held').getByText('Initial selected session', { exact: true }),
    ).toBeVisible();
    await evidence.capture(page, {
      step: 7,
      stem: '07-admin-schedule-notification-queue',
      title: 'Admin sees the held speaker placement and delivered committee notices',
      persona: 'Event owner / admin',
      ready: page.getByRole('heading', { name: 'Held speaker notifications' }),
    });
  }

  await releaseHeldSchedule(admin.idToken, INITIAL_ACCEPTED_ID, firstShared.releaseId);
  expect(await callJson(initialAccepted.idToken, 'getSharedSchedule', {})).toMatchObject({
    ok: true,
    audience: 'speaker',
    entries: [expect.objectContaining({ proposalId: INITIAL_ACCEPTED_ID })],
  });
  expect(await callJson(reviewer.idToken, 'getSharedSchedule', {})).toMatchObject({
    ok: true,
    audience: 'committee',
    entries: [expect.objectContaining({ proposalId: INITIAL_ACCEPTED_ID })],
  });

  if (evidence.enabled) {
    await signInForEvidence(page, REVIEWER, at('/schedule'));
    await expect(page.getByRole('link', { name: 'Initial selected session' })).toBeVisible();
    await evidence.capture(page, {
      step: 8,
      stem: '08a-reviewer-shared-schedule',
      title: 'Committee member reviews the confirmed-only working schedule',
      persona: 'Committee reviewer',
      ready: page.getByRole('heading', { name: 'Committee preview' }),
    });

    await signInForEvidence(page, INITIAL_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Initial selected session');
    await evidence.capture(page, {
      step: 8,
      stem: '08b-initial-speaker-shared-placement',
      title: 'Confirmed speaker reviews only their own private placement',
      persona: 'Initial accepted speaker',
      ready: page.getByRole('heading', { name: 'Your working schedule' }),
    });
  }

  // Close before publication. Neither a new draft nor a submission request can
  // cross that boundary; the late proposals do not exist until the reopen.
  const now = Date.now();
  await callJson(admin.idToken, 'setCfpWindow', {
    closesAt: new Date(now - 1_000).toISOString(),
  });
  expect(
    await createCompleteDraftAs(
      lateAccepted.idToken,
      'critical-closed-draft-probe',
      lateAccepted.uid,
    ),
  ).toEqual({ ok: false, status: 403 });
  expect(await readProposalById('critical-closed-draft-probe')).toBeNull();
  expect(
    await callAs(lateAccepted.idToken, 'submitProposal', {
      proposalId: 'critical-closed-submission-probe',
    }),
  ).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });

  if (evidence.enabled) {
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto(at(''));
    await evidence.capture(page, {
      step: 9,
      stem: '09-anonymous-cfp-closed',
      title: 'Public visitor sees that the proposal window is closed',
      persona: 'Anonymous attendee',
      ready: page.getByText('The call for proposals has closed.'),
    });
  }

  const beforeFirstPublish = (await readEmailLog()).map((row) => row.id).sort();
  const firstPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: firstShared.revision,
  });
  expect(firstPublished.releaseId).toBe(firstShared.releaseId);
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(beforeFirstPublish);
  expect(
    await readPublicScheduleEntry(firstPublished.releaseId, INITIAL_ACCEPTED_ID),
  ).toMatchObject({ proposalId: INITIAL_ACCEPTED_ID });

  if (evidence.enabled) {
    await page.goto(at('/schedule'));
    await expect(page.getByRole('heading', { name: 'Programme', exact: true })).toBeVisible();
    await evidence.capture(page, {
      step: 10,
      stem: '10-anonymous-first-public-programme',
      title: 'Anonymous attendee sees the first published programme',
      persona: 'Anonymous attendee',
      ready: page.getByRole('link', { name: 'Initial selected session' }),
    });

    await signInForEvidence(page, ADMIN, at('/admin/overview'));
    await evidence.capture(page, {
      step: 11,
      stem: '11-admin-last-minute-intake-decision',
      title: 'Admin is guided to decide whether to add last-minute speakers',
      persona: 'Event owner / admin',
      ready: page.getByText('Recommended next action · Step 11 of 17'),
    });
  }

  // The organiser's last-minute decision is a bounded reopen; speakers still
  // submit and consent for themselves.
  await callJson(admin.idToken, 'setCfpWindow', {
    opensAt: new Date(now - 60_000).toISOString(),
    closesAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (evidence.enabled) await signInForEvidence(page, LATE_ACCEPTED, at('/submit'));
  else {
    await signInAs(page, LATE_ACCEPTED);
    await page.reload();
  }
  await fillRequired(page);
  await field(page, 'Title').fill('Late selected session');
  await page.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
  const [lateAcceptedId] = await readProposalIdsForSpeaker(lateAccepted.uid);
  expect(lateAcceptedId).toBeTruthy();
  await evidence.capture(page, {
    step: 12,
    stem: '12a-late-accepted-speaker-submitted',
    title: 'Late selected speaker submits through the reopened CFP',
    persona: 'Late accepted speaker',
    ready: page.getByRole('heading', { name: 'Submitted', exact: true }),
  });

  if (evidence.enabled) await signInForEvidence(page, LATE_REJECTED, at('/submit'));
  else {
    await signInAs(page, LATE_REJECTED);
    await page.reload();
  }
  await fillRequired(page);
  await field(page, 'Title').fill('Late rejected session');
  await page.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
  const [lateRejectedId] = await readProposalIdsForSpeaker(lateRejected.uid);
  expect(lateRejectedId).toBeTruthy();
  await evidence.capture(page, {
    step: 12,
    stem: '12b-late-rejected-speaker-submitted',
    title: 'Second late speaker submits through the same reopened CFP',
    persona: 'Late rejected speaker',
    ready: page.getByRole('heading', { name: 'Submitted', exact: true }),
  });
  await waitForEmail(
    (rows) => rows.filter((row) => row.kind === 'committee_proposal_submitted').length === 12,
    'late ready-for-review notices',
  );

  // The late intake is a seven-day exception, not a permanently reopened CFP.
  // Close it before committee work resumes and prove no third late proposal can
  // cross the same creation or submission boundary.
  await callJson(admin.idToken, 'setCfpWindow', {
    closesAt: new Date(Date.now() - 1_000).toISOString(),
  });
  expect(
    await createCompleteDraftAs(
      lateAccepted.idToken,
      'critical-after-late-window-draft-probe',
      lateAccepted.uid,
    ),
  ).toEqual({ ok: false, status: 403 });
  expect(await readProposalById('critical-after-late-window-draft-probe')).toBeNull();
  expect(
    await callAs(lateAccepted.idToken, 'submitProposal', {
      proposalId: 'critical-after-late-window-submission-probe',
    }),
  ).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });

  if (evidence.enabled) {
    await signInForEvidence(page, REVIEWER, at('/review'));
    await evidence.capture(page, {
      step: 13,
      stem: '13-reviewer-late-round',
      title: 'Committee member receives an independent late-proposal queue',
      persona: 'Committee reviewer',
      ready: page.getByText('0 of 2 responded'),
    });
  }

  for (const proposalId of [lateAcceptedId, lateRejectedId]) {
    await expect(
      callJson(reviewer.idToken, 'saveReview', {
        proposalId,
        score: proposalId === lateAcceptedId ? 4 : 1,
        conflictOfInterest: false,
        comment: 'Late-round review',
      }),
    ).resolves.toMatchObject({ ok: true, proposalId, status: 'under_review' });
  }
  await callJson(admin.idToken, 'setProposalStatus', {
    proposalId: lateAcceptedId,
    status: 'accepted',
  });
  await callJson(admin.idToken, 'setProposalStatus', {
    proposalId: lateRejectedId,
    status: 'rejected',
  });

  if (evidence.enabled) {
    await signInForEvidence(page, ADMIN, at('/admin/proposals'));
    await expect(page.getByLabel('Status: Late selected session')).toHaveValue('accepted');
    await expect(page.getByLabel('Status: Late rejected session')).toHaveValue('rejected');
    await evidence.capture(page, {
      step: 14,
      stem: '14-admin-late-decisions',
      title: 'Admin applies accepted and rejected outcomes to late proposals',
      persona: 'Event owner / admin',
      ready: page.getByRole('heading', { name: 'Proposal decisions' }),
    });
  }

  await releaseHeldDecisions(admin.idToken, [lateAcceptedId, lateRejectedId]);

  if (evidence.enabled) {
    await signInForEvidence(page, LATE_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Late selected session');
    await expect(page.getByRole('heading', { name: 'Accepted', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await evidence.capture(page, {
      step: 15,
      stem: '15a-late-accepted-confirmation-form',
      title: 'Late accepted speaker completes the same required confirmation form',
      persona: 'Late accepted speaker',
      ready: page.getByLabel(/T-shirt size/),
    });

    await signInForEvidence(page, LATE_REJECTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Late rejected session');
    await evidence.capture(page, {
      step: 15,
      stem: '15b-late-rejected-decision',
      title: 'Late rejected speaker receives a clear outcome',
      persona: 'Late rejected speaker',
      ready: page.getByRole('heading', { name: 'Rejected', exact: true }),
    });
  }

  await confirmWithRequiredDetails(lateAccepted, lateAcceptedId, 'L');

  if (evidence.enabled) {
    await signInForEvidence(page, LATE_ACCEPTED, at('/submit'));
    await expect(field(page, 'Title')).toHaveValue('Late selected session');
    await evidence.capture(page, {
      step: 15,
      stem: '15c-late-accepted-confirmed',
      title: 'Late accepted speaker sees confirmation recorded',
      persona: 'Late accepted speaker',
      ready: page.getByRole('heading', { name: 'Confirmed', exact: true }),
    });
  }

  schedule = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: firstPublished.revision,
    entry: {
      id: lateAcceptedId,
      kind: 'proposal',
      proposalId: lateAcceptedId,
      date: '2026-11-14',
      startsAt: '11:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const firstEntryBeforeRepublish = await readScheduleEntry(
    firstPublished.releaseId,
    INITIAL_ACCEPTED_ID,
  );
  const secondShared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: schedule.revision,
  });
  expect(secondShared.releaseId).not.toBe(firstPublished.releaseId);
  await waitForEmail(
    (rows) =>
      rows.filter((row) => row.kind === 'committee_schedule_shared').length === 4 &&
      rows
        .filter((row) => row.kind === 'committee_schedule_shared')
        .every((row) => row.status === 'dry_run') &&
      rows.some(
        (row) =>
          row.kind === 'schedule_assigned' &&
          row.proposalId === lateAcceptedId &&
          row.dedupeKey === secondShared.releaseId &&
          row.status === 'held',
    ),
    'late shared-preview notifications',
  );

  if (evidence.enabled) {
    await signInForEvidence(page, ADMIN, at('/admin/schedule'));
    await expect(page.getByText('Late selected session', { exact: true }).first()).toBeVisible();
    await evidence.capture(page, {
      step: 16,
      stem: '16a-admin-reviewed-programme-update',
      title: 'Admin reviews the second shared version before updating the public programme',
      persona: 'Event owner / admin',
      ready: page.getByRole('heading', { name: 'Build the programme' }),
    });
  }

  await releaseHeldSchedule(admin.idToken, lateAcceptedId, secondShared.releaseId);

  // Sharing version two does not move the anonymous pointer. Version one and
  // its existing entry remain unchanged until the explicit promotion.
  expect(
    await readPublicScheduleEntry(firstPublished.releaseId, lateAcceptedId),
  ).toBeNull();
  expect(await readScheduleEntry(firstPublished.releaseId, INITIAL_ACCEPTED_ID)).toEqual(
    firstEntryBeforeRepublish,
  );
  const beforeSecondPublish = (await readEmailLog()).map((row) => row.id).sort();
  const secondPublished = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: secondShared.revision,
  });
  expect(secondPublished.releaseId).toBe(secondShared.releaseId);
  expect((await readEmailLog()).map((row) => row.id).sort()).toEqual(beforeSecondPublish);
  expect(
    await readPublicScheduleEntry(secondPublished.releaseId, INITIAL_ACCEPTED_ID),
  ).toMatchObject({ proposalId: INITIAL_ACCEPTED_ID });
  expect(
    await readPublicScheduleEntry(secondPublished.releaseId, lateAcceptedId),
  ).toMatchObject({ proposalId: lateAcceptedId });

  if (evidence.enabled) {
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto(at('/schedule'));
    await expect(page.getByRole('link', { name: 'Initial selected session' })).toBeVisible();
    await evidence.capture(page, {
      step: 16,
      stem: '16b-anonymous-updated-public-programme',
      title: 'Anonymous attendee sees the updated public programme with the late session',
      persona: 'Anonymous attendee',
      ready: page.getByRole('link', { name: 'Late selected session' }),
    });
  }

  // Event done: obsolete committee access goes first, then archive freezes
  // mutations while retaining the direct historical public programme.
  await callJson(admin.idToken, 'revokeRole', { email: REVIEWER.email });
  expect(await callAs(reviewer.idToken, 'getSharedSchedule', {})).toMatchObject({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  await expect(
    callJson(owner.idToken, 'archiveCfp', { archived: true }),
  ).resolves.toMatchObject({ ok: true, archived: true });

  if (evidence.enabled) {
    await signInForEvidence(page, OWNER, at('/admin/settings'));
    await expect(page.getByRole('heading', { name: 'Event setup' })).toBeVisible();
    await evidence.capture(page, {
      step: 17,
      stem: '17a-owner-archived-workspace',
      title: 'Owner sees the archived event as a read-only historical workspace',
      persona: 'Event owner / admin',
      ready: page.locator('.admin-read-only'),
    });
  }

  expect(
    await callAs(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: secondPublished.revision,
      entry: {
        id: 'after-event',
        kind: 'custom',
        customType: 'other',
        title: { en: 'After event mutation' },
        date: '2026-11-14',
        startsAt: '12:00',
        durationMinutes: 20,
        roomId: 'main',
      },
    }),
  ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  expect(
    await readPublicScheduleEntry(secondPublished.releaseId, lateAcceptedId),
  ).toMatchObject({ proposalId: lateAcceptedId });
  expect((await readProposalById(INITIAL_ACCEPTED_ID))?.status).toBe('confirmed');
  expect((await readProposalById(lateAcceptedId))?.status).toBe('confirmed');

  if (evidence.enabled) {
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto(at('/schedule'));
    await expect(page.getByRole('link', { name: 'Initial selected session' })).toBeVisible();
    await evidence.capture(page, {
      step: 17,
      stem: '17b-anonymous-archived-programme',
      title: 'Public historical programme remains available after the event is archived',
      persona: 'Anonymous attendee',
      ready: page.getByRole('link', { name: 'Late selected session' }),
    });
  }
});
