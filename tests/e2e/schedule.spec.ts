import { expect, test, type Locator } from '@playwright/test';

import {
  callAs,
  callJson,
  callPublic,
  clearScheduleCancellationCarrySourceDirect,
  clearSchedulePhotoProvenanceDirect,
  clearSharedSchedulePointerDirect,
  createAccount,
  createUnverifiedAccount,
  inviteRole,
  readCfp,
  readEmailLog,
  readPublicScheduleEntry,
  readPublicScheduleRelease,
  readScheduleEntry,
  readScheduleReleaseIds,
  reviewedEmailConfiguration,
  reviewedEmailRecipients,
  reset,
  seedPlatformMember,
  setCfpArchivedDirect,
  seedMember,
  seedProposal,
  seedSpeaker,
  setEmailAmbiguousFailureDirect,
  setEmailDeliveryDirect,
  setEmailDeliveryReadyDirect,
  setEmailStatusDirect,
  setProposalStatusDirect,
  setScheduleEntryCancelledDirect,
  waitForEmail,
} from './backend';
import { at, signInAs, waitForAppHydration, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'schedule-admin',
  email: 'schedule-admin@example.org',
  name: 'Ada Admin',
};
const SPEAKER: Identity = {
  sub: 'schedule-speaker',
  email: 'schedule-speaker@example.org',
  name: 'Samira Speaker',
};
const OTHER_SPEAKER: Identity = {
  sub: 'schedule-other-speaker',
  email: 'schedule-other-speaker@example.org',
  name: 'Omar Other',
};
const TENTATIVE_SPEAKER: Identity = {
  sub: 'schedule-tentative-speaker',
  email: 'schedule-tentative-speaker@example.org',
  name: 'Taylor Tentative',
};
const REVIEWER: Identity = {
  sub: 'schedule-reviewer',
  email: 'schedule-reviewer@example.org',
  name: 'Riley Reviewer',
};
const PENDING_REVIEWER: Identity = {
  sub: 'schedule-pending-reviewer',
  email: 'schedule-pending-reviewer@example.org',
  name: 'Parker Pending',
};
const REVOKED_REVIEWER: Identity = {
  sub: 'schedule-revoked-reviewer',
  email: 'schedule-revoked-reviewer@example.org',
  name: 'Remy Revoked',
};
const GLOBAL_OWNER: Identity = {
  sub: 'schedule-global-owner',
  email: 'schedule-global-owner@example.org',
  name: 'Gale Global',
};

test.beforeEach(async () => {
  await reset();
});

async function seedDisclosureSchedule() {
  const [admin, speaker, otherSpeaker, tentativeSpeaker, reviewer, pending, revoked, global] =
    await Promise.all(
      [
        ADMIN,
        SPEAKER,
        OTHER_SPEAKER,
        TENTATIVE_SPEAKER,
        REVIEWER,
        PENDING_REVIEWER,
        REVOKED_REVIEWER,
        GLOBAL_OWNER,
      ].map(createAccount),
    );
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
    seedMember(revoked.uid, 'reviewer', undefined, REVOKED_REVIEWER.email),
    inviteRole(PENDING_REVIEWER.email, 'reviewer'),
    seedPlatformMember(global.uid, 'owner', GLOBAL_OWNER.email, GLOBAL_OWNER.name),
    seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email }),
    seedSpeaker(otherSpeaker.uid, {
      name: OTHER_SPEAKER.name,
      email: OTHER_SPEAKER.email,
    }),
    seedSpeaker(tentativeSpeaker.uid, {
      name: TENTATIVE_SPEAKER.name,
      email: TENTATIVE_SPEAKER.email,
    }),
    seedProposal('modern-web', {
      speakerUid: speaker.uid,
      title: 'The modern web, without the maze',
      status: 'confirmed',
      speaker: { name: SPEAKER.name },
    }),
    seedProposal('other-talk', {
      speakerUid: otherSpeaker.uid,
      title: 'A second confirmed session',
      status: 'confirmed',
      speaker: { name: OTHER_SPEAKER.name },
    }),
    seedProposal('tentative-talk', {
      speakerUid: tentativeSpeaker.uid,
      title: 'A tentative session',
      status: 'accepted',
      speaker: { name: TENTATIVE_SPEAKER.name },
    }),
  ]);
  const config = {
    timeZone: 'America/Toronto',
    revision: 0,
    days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
    rooms: [
      { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
      { id: 'amber', name: { en: 'Amber room', fr: 'Salle ambre' } },
    ],
  };
  let state = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  for (const entry of [
    {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
    {
      id: 'other-talk',
      kind: 'proposal',
      proposalId: 'other-talk',
      date: '2026-11-14',
      startsAt: '11:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
    {
      id: 'tentative-talk',
      kind: 'proposal',
      proposalId: 'tentative-talk',
      date: '2026-11-14',
      startsAt: '12:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
    {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Coffee break', fr: 'Pause café' },
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 20,
      roomId: 'amber',
    },
  ]) {
    state = await callJson(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: state.revision,
      entry,
    });
  }
  return {
    admin,
    speaker,
    otherSpeaker,
    reviewer,
    pending,
    revoked,
    global,
    config,
    revision: state.revision as number,
  };
}

test('custom item language is validated, filterable, and frozen into each schedule release', async ({
  page,
}) => {
  const fixture = await seedDisclosureSchedule();
  const coffeeBreak = {
    id: 'coffee-break',
    kind: 'custom',
    customType: 'break',
    title: { en: 'Coffee break', fr: 'Pause café' },
    date: '2026-11-14',
    startsAt: '10:00',
    durationMinutes: 20,
    roomId: 'amber',
  };

  expect(
    await callAs(fixture.admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: fixture.revision,
      entry: { ...coffeeBreak, language: 'either' },
    }),
  ).toEqual({ ok: false, code: 'INVALID_ARGUMENT' });

  const updated = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: fixture.revision,
    entry: { ...coffeeBreak, language: 'bilingual' },
  });
  const shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: updated.revision,
  });
  expect(await readScheduleEntry(shared.releaseId, coffeeBreak.id)).toMatchObject({
    kind: 'custom',
    language: 'bilingual',
  });

  const published = await callJson(fixture.admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
  const changed = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: published.revision,
    entry: { ...coffeeBreak, language: 'fr' },
  });
  expect(changed.revision).toBeGreaterThan(published.revision);
  expect(await readPublicScheduleEntry(published.releaseId, coffeeBreak.id)).toMatchObject({
    kind: 'custom',
    language: 'bilingual',
  });

  await page.goto(at('/schedule'));
  const languageFilter = page.getByRole('combobox', { name: 'Scheduled language' });
  await expect(languageFilter.locator('option[value="bilingual"]')).toHaveText('Bilingual');
  await languageFilter.selectOption('bilingual');
  const coffeeBreakLink = page.getByRole('link', { name: 'Coffee break' });
  await expect(coffeeBreakLink).toBeVisible();
  await expect(page.getByRole('listitem').filter({ has: coffeeBreakLink }).locator('.language-chip')).toHaveText('Bilingual');
  await languageFilter.selectOption('en');
  await expect(coffeeBreakLink).toHaveCount(0);
  await languageFilter.selectOption('all');
  await page.getByRole('link', { name: 'Coffee break' }).click();
  await expect(page.getByRole('article').locator('.language-chip')).toHaveText('Bilingual');
});

test('an admin shares and publishes without duplicating notices, and cancellations stay stable', async ({
  page,
}) => {
  const [admin, speaker] = await Promise.all([createAccount(ADMIN), createAccount(SPEAKER)]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio: 'Builds accessible developer tools and teaches teams how to ship them safely.',
      company: 'GDG Montréal',
      jobTitle: 'Community organiser',
    }),
    seedProposal('modern-web', {
      speakerUid: speaker.uid,
      title: 'The modern web, without the maze',
      status: 'confirmed',
      speaker: {
        name: SPEAKER.name,
        company: 'GDG Montréal',
        jobTitle: 'Community organiser',
      },
    }),
  ]);

  const config = {
    timeZone: 'America/Toronto',
    revision: 0,
    days: [
      { date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' },
      { date: '2026-11-15', startsAt: '09:00', endsAt: '17:00' },
    ],
    // Deliberately not alphabetical: the public agenda follows configured
    // track order when two items start together.
    rooms: [
      { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
      { id: 'amber', name: { en: 'Amber room', fr: 'Salle ambre' } },
    ],
  };
  expect(await callAs(speaker.idToken, 'setScheduleConfig', { config, expectedRevision: 0 })).toMatchObject({
    ok: false,
    code: 'PERMISSION_DENIED',
  });

  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  const scheduled = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:15',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  expect(
    await callAs(admin.idToken, 'publishSchedule', { expectedRevision: scheduled.revision }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  let shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });
  expect(shared).toMatchObject({ version: 1, sharedCount: 1, omittedCount: 0 });

  const queued = await waitForEmail(
    (rows) => rows.some((row) => row.kind === 'schedule_assigned' && row.status === 'held'),
    'held schedule assignment',
  );
  expect(queued).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule_assigned', proposalId: 'modern-web', status: 'held' }),
    ]),
  );

  const beforeFirstPublish = await readEmailLog();
  let published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
  expect(published.releaseId).toBe(shared.releaseId);
  expect(await readEmailLog()).toHaveLength(beforeFirstPublish.length);

  expect(
    await callAs(admin.idToken, 'publishSchedule', { expectedRevision: published.revision }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  const withBreak = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: published.revision,
    entry: {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Coffee break', fr: 'Pause café' },
      date: '2026-11-14',
      startsAt: '10:30',
      durationMinutes: 20,
      roomId: 'amber',
    },
  });
  shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: withBreak.revision,
  });
  expect(shared).toMatchObject({ version: 2, sharedCount: 2, omittedCount: 0 });
  await setEmailDeliveryReadyDirect();
  const unchangedQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(unchangedQueue.held).toEqual([
    expect.objectContaining({
      kind: 'schedule_assigned',
      title: 'The modern web, without the maze',
    }),
  ]);
  expect(await callJson(admin.idToken, 'emailQueue', { action: 'summary' })).toEqual({
    ok: true,
    waiting: 1,
    needsAttention: 0,
  });
  expect(
    await callJson(admin.idToken, 'emailQueue', {
      action: 'release',
      logIds: unchangedQueue.held.map((row: { logId: string }) => row.logId),
      reviewedRecipients: reviewedEmailRecipients(unchangedQueue.held),
      ...reviewedEmailConfiguration(unchangedQueue),
    }),
  ).toMatchObject({ ok: true, released: 1, stale: 0 });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.kind === 'schedule_assigned' &&
          row.proposalId === 'modern-web' &&
          row.status === 'dry_run',
    ),
    'released unchanged schedule assignment',
  );

  const beforeSecondPublish = await readEmailLog();
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
  expect(published.releaseId).toBe(shared.releaseId);
  expect(await readEmailLog()).toHaveLength(beforeSecondPublish.length);

  const adjustedBreak = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: published.revision,
    entry: {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Coffee break', fr: 'Pause café' },
      date: '2026-11-14',
      startsAt: '10:30',
      durationMinutes: 25,
      roomId: 'amber',
    },
  });
  shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: adjustedBreak.revision,
  });
  const retryReleaseId = shared.releaseId;
  await setEmailDeliveryReadyDirect();
  const retryableQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(retryableQueue.held).toEqual([]);
  expect(retryableQueue.tally['dry_run:schedule_assigned']).toBe(1);
  expect(await callJson(admin.idToken, 'emailQueue', {
    action: 'retry',
    logIds: retryableQueue.retryable.map((row: { logId: string }) => row.logId),
    reviewedRecipients: reviewedEmailRecipients(retryableQueue.retryable),
    ...reviewedEmailConfiguration(retryableQueue),
  })).toMatchObject({
    ok: true,
    released: 1,
    stale: 0,
  });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.kind === 'schedule_assigned' &&
          row.proposalId === 'modern-web' &&
          row.dedupeKey === retryReleaseId &&
          row.status === 'dry_run',
      ),
    'retried schedule assignment after an unrelated release',
  );
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });

  const moved = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: published.revision,
    entry: {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:30',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: moved.revision,
  });
  const queue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(queue.held).toEqual([
    expect.objectContaining({ kind: 'schedule_changed', title: 'The modern web, without the maze' }),
  ]);
  const beforeFinalPublish = await readEmailLog();
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
  expect(published.releaseId).toBe(shared.releaseId);
  expect(await readEmailLog()).toHaveLength(beforeFinalPublish.length);

  await signInAs(page, ADMIN, at('/admin/schedule'));
  await expect(page.getByRole('heading', { name: 'Build the programme' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Move or edit: The modern web, without the maze/ }),
  ).toBeVisible();

  await page.goto(at('/schedule'));
  await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();

  const dayTabs = page.getByRole('tab');
  await dayTabs.first().focus();
  await dayTabs.first().press('ArrowRight');
  await expect(dayTabs.nth(1)).toBeFocused();
  await expect(dayTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await dayTabs.nth(1).press('ArrowLeft');
  await expect(dayTabs.first()).toBeFocused();
  await expect(dayTabs.first()).toHaveAttribute('aria-selected', 'true');

  const roomFilter = page.getByRole('combobox', { name: 'Room / track' });
  const languageFilter = page.getByRole('combobox', { name: 'Scheduled language' });
  await expect(languageFilter.locator('option[value="bilingual"]')).toHaveCount(0);
  await languageFilter.selectOption('en');
  // Breaks and other non-talk items belong to the day, not to one language.
  await expect(page.getByRole('link', { name: 'Coffee break' })).toBeVisible();
  const agendaTitles = page.locator('.agenda-item h3');
  await expect(agendaTitles.nth(0)).toHaveText('The modern web, without the maze');
  await expect(agendaTitles.nth(1)).toHaveText('Coffee break');
  await expect(page.getByText('10:30–11:10', { exact: true })).toBeVisible();

  await roomFilter.selectOption('blue');
  await page.getByRole('link', { name: 'The modern web, without the maze' }).click();
  await expect(page.getByRole('heading', { name: 'The modern web, without the maze' })).toBeVisible();
  await expect(page.getByText('Samira Speaker')).toBeVisible();
  await expect(page.getByText('Blue room')).toBeVisible();
  await expect(page).toHaveTitle('The modern web, without the maze — DevFest Montréal 2026');
  await expect(page.getByText(/10:30–11:10/)).toBeVisible();
  await page.getByRole('link', { name: /Back to the programme/ }).click();
  await expect(roomFilter).toHaveValue('blue');
  await expect(languageFilter).toHaveValue('en');
  await expect(page).toHaveTitle('Programme — DevFest Montréal 2026');

  await page.goto(at('/schedule/no-longer-current'));
  await expect(page.getByText('This session is not in the current programme.')).toBeVisible();
  await expect(page.getByText('The modern web, without the maze')).toHaveCount(0);
  await expect(page.getByText('Samira Speaker')).toHaveCount(0);
  await page.getByRole('link', { name: /Back to the programme/ }).click();

  await signInAs(page, SPEAKER, at());
  const speakerSchedule = page.locator('.submission-schedule');
  await expect(speakerSchedule.getByRole('heading', { name: 'Your published session' })).toBeVisible();
  await expect(speakerSchedule).toContainText('10:30–11:10');
  await expect(speakerSchedule).toContainText('Blue room');
  await expect(speakerSchedule).toContainText('English');
  await speakerSchedule.getByRole('link', { name: 'View session details' }).click();
  await expect(page.getByRole('heading', { name: 'The modern web, without the maze' })).toBeVisible();
  const sessionMain = page.locator('#main-content');
  await expect(sessionMain).toHaveAttribute(
    'aria-label',
    'The modern web, without the maze — DevFest Montréal 2026',
  );
  await expect(sessionMain).toBeFocused();

  await setProposalStatusDirect('modern-web', 'withdrawn');
  await expect
    .poll(
      async () => (await readScheduleEntry(published.releaseId, 'modern-web'))?.cancelled,
      { timeout: 15_000 },
    )
    .toBe(true);
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === published.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'held cancellation after the published entry is marked',
  );
  const cancelledQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(cancelledQueue.held).toEqual([
    expect.objectContaining({ kind: 'schedule_cancelled', title: 'The modern web, without the maze' }),
  ]);
  await page.reload();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});

test('keeps private, shared, and public schedule releases isolated by audience', async ({
  page,
}) => {
  const fixture = await seedDisclosureSchedule();

  await page.goto(at(''));
  await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0);
  await page.goto(at('/schedule'));
  await expect(page.getByText('The programme has not been published yet.')).toBeVisible();
  await expect(page.getByText('The modern web, without the maze')).toHaveCount(0);
  expect(await callPublic('getSharedSchedule', {})).toEqual({
    ok: false,
    code: 'UNAUTHENTICATED',
  });
  expect(
    await callAs(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: fixture.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  let shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  expect(shared).toMatchObject({ version: 1, sharedCount: 3, omittedCount: 1 });
  await page.reload();
  await expect(page.getByText('The programme has not been published yet.')).toBeVisible();
  await expect(page.getByText('A tentative session')).toHaveCount(0);

  const moved = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: shared.revision,
    entry: {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:15',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  expect(
    await callAs(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: moved.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  const stale = await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {});
  expect(stale.stale).toBe(true);
  expect(stale.entries.find((entry: { id: string }) => entry.id === 'modern-web')).toMatchObject({
    startsAt: '10:00',
  });

  shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: moved.revision,
  });
  expect(shared).toMatchObject({ version: 2, sharedCount: 3, omittedCount: 1 });
  const emailRowsBeforePublish = await readEmailLog();
  const published = await callJson(fixture.admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });
  expect(published).toMatchObject({ releaseId: shared.releaseId, version: shared.version });
  expect(await readEmailLog()).toHaveLength(emailRowsBeforePublish.length);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The modern web, without the maze' })).toBeVisible();
  await expect(page.getByText('A tentative session')).toHaveCount(0);

  // An event published before shared previews existed has only the public pointer.
  // Archiving freezes that public record too; it cannot be taken offline afterward.
  await clearSharedSchedulePointerDirect();
  await setCfpArchivedDirect(true);
  expect(
    await callAs(fixture.admin.idToken, 'setScheduleConfig', {
      config: fixture.config,
      expectedRevision: shared.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  expect(
    await callAs(fixture.admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: shared.revision,
      entry: {
        id: 'archived-item',
        kind: 'custom',
        customType: 'break',
        title: { en: 'Archived change' },
        date: '2026-11-14',
        startsAt: '14:00',
        durationMinutes: 20,
        roomId: 'amber',
      },
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  expect(
    await callAs(fixture.admin.idToken, 'removeScheduleEntry', {
      expectedRevision: shared.revision,
      entryId: 'modern-web',
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  expect(
    await callAs(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: shared.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });
  expect(
    await callAs(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: shared.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  expect(await callAs(fixture.admin.idToken, 'unpublishSchedule', {})).toMatchObject({
    ok: false,
    code: 'FAILED_PRECONDITION',
  });
  await setProposalStatusDirect('modern-web', 'withdrawn');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect((await readPublicScheduleEntry(shared.releaseId, 'modern-web'))?.cancelled).not.toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The modern web, without the maze' })).toBeVisible();
  const internal = await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {});
  expect(internal.schedule.id).toBe(shared.releaseId);
});

test('requires a legacy shared release without photo provenance to be shared again', async () => {
  const fixture = await seedDisclosureSchedule();
  const legacy = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await clearSchedulePhotoProvenanceDirect(legacy.releaseId);

  expect(await callJson(fixture.admin.idToken, 'getSharedSchedule', {})).toMatchObject({
    stale: true,
  });
  expect(
    await callAs(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: legacy.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  const repaired = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: legacy.revision,
  });
  expect(repaired.releaseId).not.toBe(legacy.releaseId);
  expect(await callJson(fixture.admin.idToken, 'getSharedSchedule', {})).toMatchObject({
    stale: false,
  });
  await expect(
    callJson(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: repaired.revision,
    }),
  ).resolves.toMatchObject({ releaseId: repaired.releaseId });
});

test('an anonymous public release contains no organiser provenance or private speaker fields', async () => {
  const fixture = await seedDisclosureSchedule();
  await seedProposal('modern-web', {
    speakerUid: fixture.speaker.uid,
    title: 'The modern web, without the maze',
    status: 'confirmed',
    speaker: {
      name: SPEAKER.name,
      bio: 'Attendee-facing biography.',
      company: 'Example Co',
      jobTitle: 'Engineer',
      basedIn: 'Private profile location',
      socials: [{ platform: 'linkedin', handle: 'private-handle' }],
      isGde: true,
      pastTalks: 'Private committee notes about earlier talks.',
      sessionizeUrl: 'https://sessionize.com/private-speaker',
    },
  });
  const shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await callJson(fixture.admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });

  const release = await readPublicScheduleRelease(shared.releaseId);
  expect(Object.keys(release ?? {}).sort()).toEqual(
    ['days', 'publishedAt', 'rooms', 'timeZone', 'version'].sort(),
  );
  expect(release).not.toHaveProperty('sharedBy');
  expect(release).not.toHaveProperty('sharedAt');
  expect(release).not.toHaveProperty('sourceRevision');
  expect(release).not.toHaveProperty('sourceFingerprint');

  const entry = await readPublicScheduleEntry(shared.releaseId, 'modern-web');
  expect(entry?.session.speakers).toEqual([
    {
      name: SPEAKER.name,
      bio: 'Attendee-facing biography.',
      company: 'Example Co',
      jobTitle: 'Engineer',
    },
  ]);
  expect(entry?.session.speakers[0]).not.toHaveProperty('uid');
  expect(entry?.session.speakers[0]).not.toHaveProperty('basedIn');
  expect(entry?.session.speakers[0]).not.toHaveProperty('socials');
  expect(entry?.session.speakers[0]).not.toHaveProperty('pastTalks');
  expect(entry?.session.speakers[0]).not.toHaveProperty('sessionizeUrl');
  expect(entry?.session.speakers[0]).not.toHaveProperty('isGde');
});

test('sharing and archiving cannot leave an orphan schedule release', async () => {
  const fixture = await seedDisclosureSchedule();
  await seedMember(fixture.global.uid, 'owner', undefined, GLOBAL_OWNER.email);
  const before = await readScheduleReleaseIds();

  const [share, archive] = await Promise.all([
    callAs(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: fixture.revision,
    }),
    callAs(fixture.global.idToken, 'archiveCfp', { archived: true }),
  ]);

  expect(archive).toMatchObject({ ok: true });
  const cfp = await readCfp();
  const created = (await readScheduleReleaseIds()).filter((id) => !before.includes(id));
  if (share.ok) {
    expect(created).toHaveLength(1);
    expect(cfp).toMatchObject({ archived: true, sharedScheduleId: created[0] });
  } else {
    expect(created).toEqual([]);
    expect(cfp).toMatchObject({ archived: true });
  }
});

test('a shared schedule exposes only each confirmed speaker\'s own placement', async ({
  page,
}) => {
  const fixture = await seedDisclosureSchedule();
  const configured = await callJson(fixture.admin.idToken, 'setScheduleConfig', {
    expectedRevision: fixture.revision,
    config: {
      ...fixture.config,
      days: [
        ...fixture.config.days,
        { date: '2026-11-15', startsAt: '09:00', endsAt: '17:00' },
      ],
    },
  });
  let shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: configured.revision,
  });

  const own = await callJson(fixture.speaker.idToken, 'getSharedSchedule', {});
  expect(own).toMatchObject({ audience: 'speaker', stale: false });
  expect(own.entries.map((entry: { id: string }) => entry.id)).toEqual(['modern-web']);
  expect(own.schedule.days).toEqual([
    { date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' },
  ]);
  expect(own.schedule.rooms).toEqual([
    { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
  ]);
  const other = await callJson(fixture.otherSpeaker.idToken, 'getSharedSchedule', {});
  expect(other).toMatchObject({ audience: 'speaker', stale: false });
  expect(other.entries.map((entry: { id: string }) => entry.id)).toEqual(['other-talk']);

  await signInAs(page, SPEAKER, at());
  let placement = page.locator('.submission-schedule');
  await expect(placement.getByRole('heading', { name: 'Your working schedule' })).toBeVisible();
  await expect(placement).toContainText('Not public');
  await expect(placement).toContainText('10:00–10:40');
  await expect(page.getByText('A second confirmed session')).toHaveCount(0);
  await expect(page.getByText('Coffee break')).toHaveCount(0);
  await expect(page.getByText('A tentative session')).toHaveCount(0);
  await expect(placement.getByRole('link', { name: 'View session details' })).toHaveCount(0);

  const moved = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: shared.revision,
    entry: {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:15',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  await page.reload();
  placement = page.locator('.submission-schedule');
  await expect(placement).toContainText('10:00–10:40');
  await expect(placement).not.toContainText('10:15–10:55');

  shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: moved.revision,
  });
  expect(shared.version).toBe(2);
  await page.reload();
  placement = page.locator('.submission-schedule');
  await expect(placement).toContainText('10:15–10:55');
  await expect(page.getByText('A second confirmed session')).toHaveCount(0);
});

test('does not fall back to an obsolete public placement after a speaker is removed from the shared preview', async ({
  page,
}) => {
  const fixture = await seedDisclosureSchedule();
  let shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await callJson(fixture.admin.idToken, 'publishSchedule', {
    expectedRevision: shared.revision,
  });

  await signInAs(page, SPEAKER, at());
  await expect(page.locator('.submission-schedule')).toContainText('10:00–10:40');

  const removed = await callJson(fixture.admin.idToken, 'removeScheduleEntry', {
    expectedRevision: shared.revision,
    entryId: 'modern-web',
  });
  shared = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: removed.revision,
  });
  const current = await callJson(fixture.speaker.idToken, 'getSharedSchedule', {});
  expect(current).toMatchObject({ audience: 'speaker', stale: false });
  expect(current.schedule.id).toBe(shared.releaseId);
  expect(current.entries).toEqual([]);

  await page.reload();
  await expect(page.locator('.submission-schedule')).toHaveCount(0);
  await expect(page.getByText('10:00–10:40')).toHaveCount(0);
  await expect(
    page.getByText(
      'You are confirmed, but the current shared preview does not assign this session a time yet. Organisers will share another update when that changes.',
    ),
  ).toBeVisible();

  await page.route('**/getSharedSchedule', (route) => route.abort('failed'));
  await page.reload();
  await expect(
    page
      .getByText(
        'The current programme placement could not be loaded, so no schedule time is shown until you reload.',
      )
      .first(),
  ).toBeVisible();
  await expect(page.locator('.submission-schedule')).toHaveCount(0);
  await expect(page.getByText('10:00–10:40')).toHaveCount(0);
  await page.unroute('**/getSharedSchedule');

  await page.goto(at('/schedule'));
  await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The modern web, without the maze' })).toBeVisible();
});

test('requires a new shared release when an omitted speaker confirms without a draft edit', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  expect(first).toMatchObject({ sharedCount: 3, omittedCount: 1 });

  await setProposalStatusDirect('tentative-talk', 'confirmed');
  await expect
    .poll(async () => (await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {})).stale)
    .toBe(true);
  expect(
    await callAs(fixture.admin.idToken, 'publishSchedule', {
      expectedRevision: first.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: first.revision,
  });
  expect(second).toMatchObject({ version: 2, sharedCount: 4, omittedCount: 0 });
  const committee = await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {});
  expect(committee.entries.map((entry: { id: string }) => entry.id)).toContain('tentative-talk');
});

test('queues changed-placement notices when shared room metadata changes', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await waitForEmail(
    (rows) => rows.filter((row) => row.kind === 'schedule_assigned' && row.status === 'held').length === 2,
    'initial shared schedule assignments',
  );

  const renamed = await callJson(fixture.admin.idToken, 'setScheduleConfig', {
    expectedRevision: first.revision,
    config: {
      ...fixture.config,
      rooms: fixture.config.rooms.map((room) =>
        room.id === 'blue'
          ? { ...room, name: { en: 'Azure room', fr: 'Salle azur' } }
          : room,
      ),
    },
  });
  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: renamed.revision,
  });
  const queue = await callJson(fixture.admin.idToken, 'emailQueue', { action: 'preview' });
  expect(queue.held).toHaveLength(2);
  expect(queue.held).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule_changed', title: 'The modern web, without the maze' }),
      expect.objectContaining({ kind: 'schedule_changed', title: 'A second confirmed session' }),
    ]),
  );
  const beforePublish = await readEmailLog();
  await callJson(fixture.admin.idToken, 'publishSchedule', {
    expectedRevision: second.revision,
  });
  expect(await readEmailLog()).toHaveLength(beforePublish.length);
});

for (const status of ['queued', 'sending'] as const) {
  test(`does not supersede a schedule release while one of its messages is ${status}`, async () => {
    const fixture = await seedDisclosureSchedule();
    const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: fixture.revision,
    });
    const firstRows = await waitForEmail(
      (rows) =>
        rows.some(
          (row) =>
            row.dedupeKey === first.releaseId &&
            row.kind === 'schedule_assigned' &&
            row.status === 'held',
        ),
      'initial held schedule assignment',
    );
    const assignment = firstRows.find(
      (row) => row.dedupeKey === first.releaseId && row.kind === 'schedule_assigned',
    )!;
    await setEmailStatusDirect(assignment.id, status);

    const changed = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: first.revision,
      entry: {
        id: 'coffee-break',
        kind: 'custom',
        customType: 'break',
        title: { en: 'Long coffee break', fr: 'Longue pause café' },
        date: '2026-11-14',
        startsAt: '10:00',
        durationMinutes: 25,
        roomId: 'amber',
      },
    });
    expect(
      await callAs(fixture.admin.idToken, 'shareSchedulePreview', {
        expectedRevision: changed.revision,
      }),
    ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

    await setEmailStatusDirect(assignment.id, 'held');
    expect(
      await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
        expectedRevision: changed.revision,
      }),
    ).toMatchObject({ version: 2 });
  });
}

test('does not carry an ambiguous provider failure to a new schedule email id', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  const firstRows = await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === first.releaseId &&
          row.kind === 'schedule_assigned' &&
          row.status === 'held',
      ),
    'held schedule assignment before ambiguous failure',
  );
  const assignment = firstRows.find(
    (row) => row.dedupeKey === first.releaseId && row.kind === 'schedule_assigned',
  )!;
  await setEmailAmbiguousFailureDirect(assignment.id);
  const changed = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: first.revision,
    entry: {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Long coffee break', fr: 'Longue pause café' },
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 25,
      roomId: 'amber',
    },
  });
  expect(
    await callAs(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: changed.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  await setEmailDeliveryDirect(assignment.id, { status: 'failed', attempts: 1 });
  expect(
    await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: changed.revision,
    }),
  ).toMatchObject({ version: 2 });
});

test('does not share over a freshly cancelled entry before its notice row exists', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await setScheduleEntryCancelledDirect(first.releaseId, 'modern-web', true);
  const changed = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: first.revision,
    entry: {
      id: 'coffee-break',
      kind: 'custom',
      customType: 'break',
      title: { en: 'Long coffee break', fr: 'Longue pause café' },
      date: '2026-11-14',
      startsAt: '10:00',
      durationMinutes: 25,
      roomId: 'amber',
    },
  });
  expect(
    await callAs(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: changed.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  await setScheduleEntryCancelledDirect(first.releaseId, 'modern-web', false);
  expect(
    await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: changed.revision,
    }),
  ).toMatchObject({ version: 2 });
});

test('releases a trigger-created cancellation from its mapped release before any reshare', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await setProposalStatusDirect('modern-web', 'withdrawn');
  await expect
    .poll(async () => (await readScheduleEntry(first.releaseId, 'modern-web'))?.cancelled, {
      timeout: 15_000,
    })
    .toBe(true);
  const cancellationRows = await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === first.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'held trigger-created cancellation on mapped release',
  );
  const cancellation = cancellationRows.find(
    (row) =>
      row.dedupeKey === first.releaseId &&
      row.proposalId === 'modern-web' &&
      row.kind === 'schedule_cancelled',
  )!;
  await setEmailDeliveryReadyDirect();
  const queue = await callJson(fixture.admin.idToken, 'emailQueue', { action: 'preview' });
  expect(queue.held).toContainEqual(
    expect.objectContaining({
      logId: cancellation.id,
      kind: 'schedule_cancelled',
      title: 'The modern web, without the maze',
    }),
  );
  expect(
    await callJson(fixture.admin.idToken, 'emailQueue', {
      action: 'release',
      logIds: [cancellation.id],
      reviewedRecipients: reviewedEmailRecipients(
        queue.held.filter((row: { logId: string }) => row.logId === cancellation.id),
      ),
      ...reviewedEmailConfiguration(queue),
    }),
  ).toMatchObject({ ok: true, released: 1, stale: 0 });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.id === cancellation.id &&
          (row.status === 'dry_run' || row.status === 'sent'),
      ),
    'delivered trigger-created cancellation before reshare',
  );
});

test('carries an existing held cancellation when the cancelled placement is removed', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await setProposalStatusDirect('modern-web', 'withdrawn');
  await expect
    .poll(async () => (await readScheduleEntry(first.releaseId, 'modern-web'))?.cancelled)
    .toBe(true);
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === first.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'triggered held cancellation',
  );

  const removed = await callJson(fixture.admin.idToken, 'removeScheduleEntry', {
    expectedRevision: first.revision,
    entryId: 'modern-web',
  });
  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: removed.revision,
  });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === second.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'carried triggered cancellation',
  );
});

test('does not restore a session until its prior cancellation has been sent', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  const removed = await callJson(fixture.admin.idToken, 'removeScheduleEntry', {
    expectedRevision: first.revision,
    entryId: 'modern-web',
  });
  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: removed.revision,
  });
  const cancellationRows = await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === second.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'held cancellation before restoration',
  );
  const cancellation = cancellationRows.find(
    (row) =>
      row.dedupeKey === second.releaseId &&
      row.proposalId === 'modern-web' &&
      row.kind === 'schedule_cancelled',
  )!;
  const restored = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: second.revision,
    entry: {
      id: 'modern-web-returned',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '14:00',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  expect(
    await callAs(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: restored.revision,
    }),
  ).toEqual({ ok: false, code: 'FAILED_PRECONDITION' });

  await setEmailStatusDirect(cancellation.id, 'sent');
  expect(
    await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
      expectedRevision: restored.revision,
    }),
  ).toMatchObject({ version: 3 });
});

test('carries an unsent cancellation across consecutive releases without the session', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  const removed = await callJson(fixture.admin.idToken, 'removeScheduleEntry', {
    expectedRevision: first.revision,
    entryId: 'modern-web',
  });
  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: removed.revision,
  });
  const secondRows = await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === second.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
    ),
    'first held cancellation',
  );
  const secondCancellation = secondRows.find(
    (row) =>
      row.dedupeKey === second.releaseId &&
      row.proposalId === 'modern-web' &&
      row.kind === 'schedule_cancelled',
  )!;
  await setEmailDeliveryDirect(secondCancellation.id, { status: 'held', attempts: 2 });
  await clearScheduleCancellationCarrySourceDirect(second.releaseId);

  const changed = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: second.revision,
    entry: {
      id: 'modern-web',
      kind: 'custom',
      customType: 'other',
      title: { en: 'Room reset', fr: 'Réinitialisation de la salle' },
      date: '2026-11-14',
      startsAt: '15:00',
      durationMinutes: 10,
      roomId: 'amber',
    },
  });
  const third = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: changed.revision,
  });
  const thirdRows = await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === third.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'held',
      ),
    'carried held cancellation',
  );
  const thirdCancellation = thirdRows.find(
    (row) =>
      row.dedupeKey === third.releaseId &&
      row.proposalId === 'modern-web' &&
      row.kind === 'schedule_cancelled',
  )!;
  expect(thirdCancellation).toMatchObject({
    recipientUid: fixture.speaker.uid,
    attempts: 2,
    data: { scheduleEntryId: 'modern-web' },
  });
  expect(thirdCancellation.id).toBe(
    secondCancellation.id.replace(`__${second.releaseId}`, `__${third.releaseId}`),
  );
  const queue = await callJson(fixture.admin.idToken, 'emailQueue', { action: 'preview' });
  expect(queue.held).toContainEqual(
    expect.objectContaining({
      logId: thirdCancellation.id,
      kind: 'schedule_cancelled',
      title: 'The modern web, without the maze',
    }),
  );
  await setEmailStatusDirect(thirdCancellation.id, 'failed');

  const changedAgain = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: third.revision,
    entry: {
      id: 'modern-web',
      kind: 'custom',
      customType: 'other',
      title: { en: 'Longer room reset', fr: 'Réinitialisation prolongée' },
      date: '2026-11-14',
      startsAt: '15:00',
      durationMinutes: 15,
      roomId: 'amber',
    },
  });
  const fourth = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: changedAgain.revision,
  });
  await waitForEmail(
    (rows) =>
      rows.some(
        (row) =>
          row.dedupeKey === fourth.releaseId &&
          row.proposalId === 'modern-web' &&
          row.kind === 'schedule_cancelled' &&
          row.status === 'failed',
      ),
    'carried failed cancellation',
  );
});

test('blocks held schedule assignment and change mail once proposals are no longer confirmed', async () => {
  const fixture = await seedDisclosureSchedule();
  const first = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  await waitForEmail(
    (rows) =>
      rows.filter(
        (row) =>
          row.dedupeKey === first.releaseId &&
          row.kind === 'schedule_assigned' &&
          row.status === 'held',
      ).length === 2,
    'initial schedule assignments',
  );

  const moved = await callJson(fixture.admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: first.revision,
    entry: {
      id: 'modern-web',
      kind: 'proposal',
      proposalId: 'modern-web',
      date: '2026-11-14',
      startsAt: '10:15',
      durationMinutes: 40,
      roomId: 'blue',
    },
  });
  const second = await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: moved.revision,
  });
  const currentRows = await waitForEmail(
    (rows) =>
      rows.filter(
        (row) =>
          row.dedupeKey === second.releaseId &&
          ['schedule_assigned', 'schedule_changed'].includes(row.kind) &&
          row.status === 'held',
      ).length === 2,
    'current assigned and changed schedule messages',
  );
  const actionable = currentRows.filter(
    (row) =>
      row.dedupeKey === second.releaseId &&
      ['schedule_assigned', 'schedule_changed'].includes(row.kind),
  );
  expect(actionable.map((row) => row.kind).sort()).toEqual([
    'schedule_assigned',
    'schedule_changed',
  ]);

  await Promise.all([
    setProposalStatusDirect('modern-web', 'withdrawn'),
    setProposalStatusDirect('other-talk', 'declined'),
  ]);
  await expect
    .poll(async () =>
      Promise.all([
        readScheduleEntry(second.releaseId, 'modern-web'),
        readScheduleEntry(second.releaseId, 'other-talk'),
      ]).then((entries) => entries.every((entry) => entry?.cancelled === true)),
    )
    .toBe(true);

  // Restore the immutable entries to their pre-trigger shape. The queue must
  // still reject both messages based on current proposal status alone.
  await Promise.all([
    setScheduleEntryCancelledDirect(second.releaseId, 'modern-web', false),
    setScheduleEntryCancelledDirect(second.releaseId, 'other-talk', false),
  ]);
  expect(await readScheduleEntry(second.releaseId, 'modern-web')).toMatchObject({
    cancelled: false,
  });
  expect(await readScheduleEntry(second.releaseId, 'other-talk')).toMatchObject({
    cancelled: false,
  });

  await setEmailDeliveryReadyDirect();
  const queue = await callJson(fixture.admin.idToken, 'emailQueue', { action: 'preview' });
  for (const row of actionable) {
    expect(
      await callAs(fixture.admin.idToken, 'emailQueue', {
        action: 'resend',
        logId: row.id,
        reviewedTo: row.to,
        ...reviewedEmailConfiguration(queue),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  }
  expect(
    await callJson(fixture.admin.idToken, 'emailQueue', {
      action: 'release',
      logIds: actionable.map((row) => row.id),
      reviewedRecipients: actionable.map((row) => ({ logId: row.id, to: row.to })),
      ...reviewedEmailConfiguration(queue),
    }),
  ).toMatchObject({ ok: true, released: 0, stale: 2 });
  for (const row of actionable) {
    await setEmailStatusDirect(row.id, 'dry_run');
    expect(
      await callAs(fixture.admin.idToken, 'emailQueue', {
        action: 'resend',
        logId: row.id,
        reviewedTo: row.to,
        ...reviewedEmailConfiguration(queue),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  }
});

test('committee preview follows active event membership and remains read only', async ({
  page,
}) => {
  const fixture = await seedDisclosureSchedule();
  await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });

  const committee = await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {});
  expect(committee).toMatchObject({ audience: 'committee', stale: false });
  expect(
    committee.entries.map((entry: { id: string }) => entry.id).sort(),
  ).toEqual(['coffee-break', 'modern-web', 'other-talk']);
  expect(
    await callAs(fixture.reviewer.idToken, 'upsertScheduleEntry', {
      expectedRevision: fixture.revision,
      entry: {
        id: 'reviewer-change',
        kind: 'custom',
        customType: 'break',
        title: { en: 'Reviewer change' },
        date: '2026-11-14',
        startsAt: '15:00',
        durationMinutes: 20,
        roomId: 'amber',
      },
    }),
  ).toEqual({ ok: false, code: 'PERMISSION_DENIED' });

  await signInAs(page, REVIEWER, at('/schedule'));
  await expect(page.getByRole('heading', { name: 'Committee preview' })).toBeVisible();
  await expect(page.getByText('Not public', { exact: true })).toBeVisible();
  await expect(page.getByText(/Confirmed sessions only\. This read-only working programme/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'The modern web, without the maze' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'A second confirmed session' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coffee break' })).toBeVisible();
  await expect(page.getByText('A tentative session')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download calendar' })).toHaveCount(0);

  await signInAs(page, ADMIN, at('/admin/schedule'));
  await expect(
    page.getByRole('button', { name: /Move or edit: A tentative session/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private draft' })).toBeVisible();

  expect(await callAs(fixture.pending.idToken, 'getSharedSchedule', {})).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  expect(await callAs(fixture.global.idToken, 'getSharedSchedule', {})).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  await callJson(fixture.admin.idToken, 'revokeRole', {
    email: REVOKED_REVIEWER.email,
  });
  expect(await callAs(fixture.revoked.idToken, 'getSharedSchedule', {})).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });

  await signInAs(page, REVOKED_REVIEWER, at('/schedule'));
  await expect(page.getByText('The programme has not been published yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Committee preview' })).toHaveCount(0);
});

test('a failed committee-preview load offers an in-page retry', async ({ page }) => {
  const fixture = await seedDisclosureSchedule();
  await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });

  let unavailable = true;
  await page.route('**/getSharedSchedule', (route) =>
    unavailable ? route.abort('failed') : route.continue(),
  );
  await signInAs(page, REVIEWER, at('/schedule'));

  await expect(
    page.getByText('That service is unavailable right now. Please try again shortly.'),
  ).toBeVisible();
  const retry = page.getByRole('button', { name: 'Reload schedule' });
  await expect(retry).toBeVisible();

  unavailable = false;
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Committee preview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The modern web, without the maze' })).toBeVisible();
});

test('requires a verified account for shared schedule reads and admin mutations', async () => {
  const fixture = await seedDisclosureSchedule();
  await callJson(fixture.admin.idToken, 'shareSchedulePreview', {
    expectedRevision: fixture.revision,
  });
  const unverified = await createUnverifiedAccount({
    email: 'unverified-schedule-admin@example.org',
  });
  await seedMember(
    unverified.uid,
    'admin',
    undefined,
    'unverified-schedule-admin@example.org',
  );

  expect(await callAs(unverified.idToken, 'getSharedSchedule', {})).toEqual({
    ok: false,
    code: 'FAILED_PRECONDITION',
  });
  expect(await callJson(fixture.reviewer.idToken, 'getSharedSchedule', {})).toMatchObject({
    ok: true,
    audience: 'committee',
  });

  const edit = {
    expectedRevision: fixture.revision,
    entry: {
      id: 'verified-admin-item',
      kind: 'custom',
      customType: 'other',
      title: { en: 'Verified admin item' },
      date: '2026-11-14',
      startsAt: '15:00',
      durationMinutes: 20,
      roomId: 'amber',
    },
  };
  expect(await callAs(unverified.idToken, 'upsertScheduleEntry', edit)).toEqual({
    ok: false,
    code: 'FAILED_PRECONDITION',
  });
  expect(await callJson(fixture.admin.idToken, 'upsertScheduleEntry', edit)).toMatchObject({
    ok: true,
    entryId: 'verified-admin-item',
  });
});

test('an accepted speaker confirms and follows their shared session into the published calendar file', async ({
  page,
}) => {
  const [admin, speaker] = await Promise.all([createAccount(ADMIN), createAccount(SPEAKER)]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio: 'Builds accessible developer tools and teaches teams how to ship them safely.',
    }),
    seedProposal('acceptance-to-agenda', {
      speakerUid: speaker.uid,
      title: 'From acceptance to the agenda',
      status: 'accepted',
      abstract:
        'A field-tested path from an acceptance email to a reliable, accessible conference agenda.',
      deliveryLanguage: 'en',
      speaker: {
        name: SPEAKER.name,
        bio: 'Frozen programme biography for Samira.',
        company: 'GDG Montréal',
        jobTitle: 'Community organiser',
      },
    }),
  ]);

  await signInAs(page, SPEAKER, at());
  await expect(page.getByRole('heading', { name: 'Accepted' })).toBeVisible();
  await page.getByRole('button', { name: 'Yes, I can present' }).click();
  await page.getByRole('button', { name: 'Confirm my talk' }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'acceptance-to-agenda',
      kind: 'proposal',
      proposalId: 'acceptance-to-agenda',
      date: '2026-11-14',
      startsAt: '13:45',
      durationMinutes: 40,
      roomId: 'main',
    },
  });

  await signInAs(page, ADMIN, at('/admin/schedule'));
  const share = page.getByRole('button', { name: 'Review and share' });
  await expect(share).toBeEnabled();
  await share.click();
  const shareReview = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await expect(shareReview).toContainText('1 items shared');
  await shareReview.getByRole('button', { name: 'Share preview' }).click();
  await expect(page.getByText(/Preview shared\. Shared version 1/)).toBeVisible();

  await signInAs(page, SPEAKER, at());
  const working = page.locator('.submission-schedule');
  await expect(working.getByRole('heading', { name: 'Your working schedule' })).toBeVisible();
  await expect(working).toContainText('Not public');
  await expect(working).toContainText('13:45–14:25');
  await expect(working).toContainText('Main room');
  await expect(working.getByRole('link', { name: 'View session details' })).toHaveCount(0);

  await signInAs(page, ADMIN, at('/admin/schedule'));
  const review = page.getByRole('button', { name: 'Review and publish' });
  await expect(review).toBeEnabled();
  await review.click();
  const publish = page.getByRole('dialog', { name: 'Publish this programme?' });
  await expect(publish).toContainText('1 scheduled');
  await expect(publish).toContainText('Proposals are still open');
  await publish.getByRole('button', { name: 'Publish programme' }).click();
  await expect(page.getByText(/The public programme is live\. Public version 1/)).toBeVisible();

  // The public release owns a frozen speaker snapshot. A later global-profile
  // edit must not rewrite history in an immutable programme version.
  await seedSpeaker(speaker.uid, {
    name: 'Updated profile name',
    email: SPEAKER.email,
    bio: 'Updated profile biography that must not leak into the published release.',
  });

  await signInAs(page, SPEAKER, at());
  const ownSession = page.locator('.submission-schedule');
  await expect(ownSession.getByRole('heading', { name: 'Your published session' })).toBeVisible();
  await expect(ownSession).toContainText('13:45–14:25');
  await expect(ownSession).toContainText('Main room');
  await ownSession.getByRole('link', { name: 'View session details' }).click();

  await expect(page.getByRole('heading', { name: 'From acceptance to the agenda' })).toBeVisible();
  await expect(page.getByText('Samira Speaker')).toBeVisible();
  await expect(page.getByText('Frozen programme biography for Samira.')).toBeVisible();
  await expect(page.getByText('Updated profile biography that must not leak')).toHaveCount(0);
  await expect(page.getByText('Main room')).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();
  await expect(page.getByText(/13:45–14:25/)).toBeVisible();
  await expect(
    page.getByText(
      'A field-tested path from an acceptance email to a reliable, accessible conference agenda.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/c\/devfest-mtl-2026\/schedule\/acceptance-to-agenda$/);

  const detailUrl = page.url();
  const downloadStarted = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add session to calendar' }).click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe('devfest-mtl-2026-acceptance-to-agenda.ics');
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const calendar = Buffer.concat(chunks).toString('utf8').replace(/\r\n[ \t]/g, '');
  expect(calendar).toContain('UID:devfest-mtl-2026-acceptance-to-agenda@cfp.gdgmontreal.com');
  expect(calendar).toContain('DTSTART;TZID=America/Toronto:20261114T134500');
  expect(calendar).toContain('DTEND;TZID=America/Toronto:20261114T142500');
  expect(calendar).toContain('SUMMARY:From acceptance to the agenda');
  expect(calendar).toContain('LOCATION:Main room');
  expect(calendar).toContain(`URL:${detailUrl}`);
});

test('the public agenda stays within a narrow mobile viewport', async ({ page }) => {
  const [admin, speaker] = await Promise.all([createAccount(ADMIN), createAccount(SPEAKER)]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email }),
    seedProposal('mobile-session', {
      speakerUid: speaker.uid,
      title: 'A very useful session with a title that needs room to wrap on phones',
      status: 'confirmed',
    }),
  ]);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
    },
  });
  const scheduled = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'mobile-session',
      kind: 'proposal',
      proposalId: 'mobile-session',
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });
  await callJson(admin.idToken, 'publishSchedule', { expectedRevision: shared.revision });

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(at('/schedule'));
  await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  const firstItem = await page.locator('.agenda-item').first().boundingBox();
  expect(firstItem).not.toBeNull();
  expect(firstItem!.y).toBeLessThan(844);
});

test('unbroken schedule content stays contained for speakers, committee, and public session details', async ({
  page,
}) => {
  const longTitle = `Title-${'T'.repeat(180)}`;
  const longAbstract = `Abstract-${'A'.repeat(480)}`;
  const longBio = `Biography-${'B'.repeat(360)}`;
  const longRoom = `Room-${'R'.repeat(70)}`;
  const longNotice = `Notice-${'N'.repeat(420)}`;
  const [admin, speaker, reviewer] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
    createAccount(REVIEWER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
    seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email, bio: longBio }),
    seedProposal('overflow-session', {
      speakerUid: speaker.uid,
      title: longTitle,
      abstract: longAbstract,
      status: 'confirmed',
      speaker: {
        name: SPEAKER.name,
        bio: longBio,
        company: 'GDG Montréal',
        jobTitle: 'Community organiser',
      },
    }),
  ]);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    expectedRevision: 0,
    config: {
      timeZone: 'America/Toronto',
      revision: 0,
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'main', name: { en: longRoom, fr: longRoom } }],
    },
  });
  const scheduled = await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'overflow-session',
      kind: 'proposal',
      proposalId: 'overflow-session',
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
    expectedRevision: scheduled.revision,
  });

  await page.setViewportSize({ width: 320, height: 844 });
  const expectNoPageOverflow = async () => {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  };
  const expectContained = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(
      await locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  };

  await signInAs(page, SPEAKER, at());
  const speakerSchedule = page.getByRole('complementary', { name: 'Your working schedule' });
  await expect(speakerSchedule).toContainText(longRoom);
  const speakerNotice = speakerSchedule.locator(':scope > p');
  await speakerNotice.evaluate((node, text) => {
    node.textContent = text;
  }, longNotice);
  await expectContained(speakerSchedule);
  await expectContained(speakerNotice);
  await expectNoPageOverflow();

  await signInAs(page, REVIEWER, at('/schedule/overflow-session'));
  const committeeDetail = page.getByRole('article');
  const committeeNotice = committeeDetail.getByRole('status');
  await committeeNotice.locator('span').last().evaluate((node, text) => {
    node.textContent = text;
  }, longNotice);
  await expectContained(committeeDetail);
  await expectContained(committeeDetail.getByRole('heading', { name: longTitle }));
  await expectContained(committeeDetail.getByText(longAbstract, { exact: true }));
  await expectContained(committeeDetail.getByText(longBio, { exact: true }));
  await expectContained(committeeNotice);
  await expectNoPageOverflow();

  await callJson(admin.idToken, 'publishSchedule', { expectedRevision: shared.revision });
  await page.goto(at('/schedule'));
  await waitForAppHydration(page);
  const agendaLink = page.getByRole('link', { name: longTitle });
  await expectContained(agendaLink.locator('..'));
  await expectNoPageOverflow();
  await agendaLink.click();

  const publicDetail = page.getByRole('article');
  await expect(publicDetail.getByRole('button', { name: 'Add session to calendar' })).toBeVisible();
  await expectContained(publicDetail);
  await expectContained(publicDetail.getByRole('heading', { name: longTitle }));
  await expectContained(publicDetail.getByText(longAbstract, { exact: true }));
  await expectContained(publicDetail.getByText(longBio, { exact: true }));
  await expectNoPageOverflow();
});
