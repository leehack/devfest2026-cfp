import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readScheduleEntry,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  setProposalStatusDirect,
  waitForEmail,
} from './backend';
import { at, signInAs, type Identity } from './form';

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

test.beforeEach(async () => {
  await reset();
});

test('an admin publishes a confirmed programme and later cancellations stay public', async ({
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
  let published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: scheduled.revision,
  });

  const queued = await waitForEmail(
    (rows) => rows.some((row) => row.kind === 'schedule_assigned' && row.status === 'held'),
    'held schedule assignment',
  );
  expect(queued).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule_assigned', proposalId: 'modern-web', status: 'held' }),
    ]),
  );

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
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: withBreak.revision,
  });
  const unchangedQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(unchangedQueue.staleHeld).toBe(1);
  expect(unchangedQueue.held).toEqual([
    expect.objectContaining({
      kind: 'schedule_assigned',
      title: 'The modern web, without the maze',
    }),
  ]);
  expect(await callJson(admin.idToken, 'emailQueue', { action: 'summary' })).toEqual({
    ok: true,
    waiting: 1,
  });
  expect(
    await callJson(admin.idToken, 'emailQueue', {
      action: 'release',
      logIds: unchangedQueue.held.map((row: { logId: string }) => row.logId),
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
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: adjustedBreak.revision,
  });
  const retryReleaseId = published.releaseId;
  const retryableQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(retryableQueue.staleHeld).toBe(2);
  expect(retryableQueue.held).toEqual([]);
  expect(retryableQueue.tally['dry_run:schedule_assigned']).toBe(1);
  expect(await callJson(admin.idToken, 'emailQueue', { action: 'retry' })).toMatchObject({
    ok: true,
    released: 1,
    stale: 1,
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
  published = await callJson(admin.idToken, 'publishSchedule', {
    expectedRevision: moved.revision,
  });
  const queue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(queue.staleHeld).toBe(3);
  expect(queue.held).toEqual([
    expect.objectContaining({ kind: 'schedule_changed', title: 'The modern web, without the maze' }),
  ]);

  await signInAs(page, ADMIN, at('/admin/schedule'));
  await expect(page.getByRole('heading', { name: 'Build the programme' })).toBeVisible();
  await expect(page.getByText('The modern web, without the maze')).toBeVisible();

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

  await signInAs(page, SPEAKER, at());
  const speakerSchedule = page.locator('.submission-schedule');
  await expect(speakerSchedule.getByRole('heading', { name: 'Your published session' })).toBeVisible();
  await expect(speakerSchedule).toContainText('10:30–11:10');
  await expect(speakerSchedule).toContainText('Blue room');
  await expect(speakerSchedule).toContainText('English');
  await speakerSchedule.getByRole('link', { name: 'View session details' }).click();
  await expect(page.getByRole('heading', { name: 'The modern web, without the maze' })).toBeVisible();

  await setProposalStatusDirect('modern-web', 'declined');
  await expect.poll(async () => (await readScheduleEntry(published.releaseId, 'modern-web'))?.cancelled).toBe(true);
  const cancelledQueue = await callJson(admin.idToken, 'emailQueue', { action: 'preview' });
  expect(cancelledQueue.staleHeld).toBe(4);
  expect(cancelledQueue.held).toEqual([
    expect.objectContaining({ kind: 'schedule_cancelled', title: 'The modern web, without the maze' }),
  ]);
  await page.reload();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});

test('an accepted speaker confirms and follows their published session into its calendar file', async ({
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
  const review = page.getByRole('button', { name: 'Review and publish' });
  await expect(review).toBeEnabled();
  await review.click();
  const publish = page.getByRole('dialog', { name: 'Publish this programme?' });
  await expect(publish).toContainText('1 scheduled');
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
  await callJson(admin.idToken, 'publishSchedule', { expectedRevision: scheduled.revision });

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
