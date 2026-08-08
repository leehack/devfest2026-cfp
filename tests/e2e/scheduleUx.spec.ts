import { expect, test } from '@playwright/test';

import {
  callJson,
  createAccount,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'schedule-ux-admin',
  email: 'schedule-ux-admin@example.org',
  name: 'Ari Admin',
};
const FIRST_SPEAKER: Identity = {
  sub: 'schedule-ux-speaker-one',
  email: 'schedule-ux-speaker-one@example.org',
  name: 'Morgan Speaker',
};
const SECOND_SPEAKER: Identity = {
  sub: 'schedule-ux-speaker-two',
  email: 'schedule-ux-speaker-two@example.org',
  name: 'Riley Speaker',
};

const config = {
  timeZone: 'America/Toronto',
  revision: 0,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
};

test.beforeEach(async () => {
  await reset();
});

async function seedSchedulePeople(secondProposal = false) {
  const [admin, first, second] = await Promise.all([
    createAccount(ADMIN),
    createAccount(FIRST_SPEAKER),
    createAccount(SECOND_SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', undefined, ADMIN.email),
    seedSpeaker(first.uid, { name: FIRST_SPEAKER.name, email: FIRST_SPEAKER.email }),
    seedSpeaker(second.uid, { name: SECOND_SPEAKER.name, email: SECOND_SPEAKER.email }),
    seedProposal('already-scheduled', {
      speakerUid: first.uid,
      title: 'Already scheduled',
      status: 'confirmed',
    }),
    ...(secondProposal
      ? [
          seedProposal('needs-a-place', {
            speakerUid: second.uid,
            title: 'Needs a place',
            status: 'confirmed',
          }),
        ]
      : []),
  ]);
  const configured = await callJson(admin.idToken, 'setScheduleConfig', {
    config,
    expectedRevision: 0,
  });
  await callJson(admin.idToken, 'upsertScheduleEntry', {
    expectedRevision: configured.revision,
    entry: {
      id: 'already-scheduled',
      kind: 'proposal',
      proposalId: 'already-scheduled',
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 40,
      roomId: 'main',
    },
  });
  return admin;
}

test('schedule editing stays complete on mobile and reports conflicts inside a focus-contained dialog', async ({
  page,
}) => {
  await seedSchedulePeople(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.getByRole('button', { name: 'Move or edit: Already scheduled' }).click();
  let dialog = page.getByRole('dialog', { name: 'Already scheduled' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove from schedule' })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Cancel' }).first();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save item' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();

  await page.getByRole('button', { name: 'Edit placement' }).click();
  dialog = page.getByRole('dialog', { name: 'Needs a place' });
  await dialog.getByRole('button', { name: 'Save item' }).click();
  await expect(
    dialog.getByRole('alert').filter({
      hasText: 'That placement overlaps a room or speaker already scheduled.',
    }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.schedule-dialog__feedback')).toBeFocused();
  await dialog.getByRole('button', { name: 'Save item' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' }).first()).toBeFocused();
});

test('publishing has a real review step, refreshes email guidance, and cannot republish unchanged data', async ({
  page,
}) => {
  await seedSchedulePeople();
  await signInAs(page, ADMIN, at('/admin/schedule'));

  await page.locator('summary').getByText('Schedule setup', { exact: true }).click();
  await page.getByRole('button', { name: 'Add day' }).click();
  const secondDay = page.getByRole('textbox', { name: 'Day 2 Required' });
  await expect(secondDay).toBeVisible();
  await page.getByRole('button', { name: 'Remove day' }).last().click();
  await expect(secondDay).toHaveCount(0);

  const review = page.getByRole('button', { name: 'Review and publish' });
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Publish this programme?' });
  await expect(dialog).toContainText('1 scheduled');
  await expect(dialog).toContainText('0 tentative');
  await expect(dialog).toContainText('0 conflicts');
  await dialog.getByRole('button', { name: 'Publish programme' }).click();

  await expect(page.getByText(/The public programme is live\. Public version 1/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Email, 1 speaker notification waiting/ }),
  ).toBeVisible();
  await expect(review).toBeDisabled();
  await expect(review).toHaveAttribute('title', 'The public programme is already up to date.');
});
