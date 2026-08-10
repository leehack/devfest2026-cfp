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

test('sharing and publishing have separate review steps and stale-version guidance', async ({
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

  const stages = page.locator('.schedule-stages');
  await expect(stages.getByRole('heading', { name: 'Private draft' })).toBeVisible();
  await expect(stages.getByRole('heading', { name: 'Shared preview' })).toBeVisible();
  await expect(stages.getByRole('heading', { name: 'Public programme' })).toBeVisible();
  await expect(stages.getByText('Private', { exact: true })).toBeVisible();
  await expect(stages.getByText('Not shared', { exact: true })).toBeVisible();
  await expect(stages.getByText('Offline', { exact: true })).toBeVisible();

  const publish = page.getByRole('button', { name: 'Review and publish' });
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', 'Review and share the confirmed preview first.');

  const share = page.getByRole('button', { name: 'Review and share' });
  await share.click();
  const shareDialog = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await expect(shareDialog).toContainText('1 items shared');
  await expect(shareDialog).toContainText('0 tentative omitted');
  await expect(shareDialog).toContainText('Confirmed speakers see only their own');
  await expect(shareDialog).toContainText('The public still sees only the currently published programme.');
  await shareDialog.getByRole('button', { name: 'Share preview' }).click();

  await expect(page.getByText(/Preview shared\. Shared version 1/)).toBeVisible();
  await expect(stages.getByText('Shared', { exact: true })).toBeVisible();
  await expect(share).toBeDisabled();
  await expect(share).toHaveAttribute('title', 'The shared preview already matches this draft.');
  await expect(publish).toBeEnabled();

  await page.getByRole('button', { name: 'Move or edit: Already scheduled' }).click();
  const placement = page.getByRole('dialog', { name: 'Already scheduled' });
  await placement.getByRole('textbox', { name: 'Start time Required' }).fill('09:15');
  await placement.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByText('The private draft has changed. Share a new preview before publishing.')).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute(
    'title',
    'The private draft changed. Share a new preview before publishing.',
  );
  await share.click();
  const reshare = page.getByRole('dialog', { name: 'Share this confirmed preview?' });
  await reshare.getByRole('button', { name: 'Share preview' }).click();
  await expect(page.getByText(/Preview shared\. Shared version 2/)).toBeVisible();
  await expect(publish).toBeEnabled();

  await publish.click();
  const publishDialog = page.getByRole('dialog', { name: 'Publish this programme?' });
  await expect(publishDialog).toContainText('1 scheduled');
  await expect(publishDialog).toContainText('0 tentative');
  await expect(publishDialog).toContainText('0 conflicts');
  await expect(publishDialog).toContainText('Proposals are still open');
  await expect(publishDialog).toContainText('Confirm that this timing is intentional.');
  await publishDialog.getByRole('button', { name: 'Publish programme' }).click();

  await expect(page.getByText(/The public programme is live\. Public version 2/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Email, 1 speaker notification waiting/ }),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', 'The public programme is already up to date.');

  await page.getByRole('button', { name: 'Take offline' }).click();
  const offline = page.getByRole('alertdialog', {
    name: 'Take the public programme offline?',
  });
  await expect(offline).toContainText('The private draft, shared preview, and release history stay intact.');
  await offline.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(offline).toHaveCount(0);
});
