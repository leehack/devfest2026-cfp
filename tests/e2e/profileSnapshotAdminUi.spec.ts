import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  createAccount,
  reset,
  seedMember,
  seedProfileUpdateRequestDirect,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs } from './form';

const ADMIN = {
  sub: 'profile-snapshot-ui-admin',
  email: 'profile-snapshot-ui-admin@example.org',
  name: 'Programme Admin',
};
const SPEAKER = {
  sub: 'profile-snapshot-ui-speaker',
  email: 'profile-snapshot-ui-speaker@example.org',
  name: 'Latest Speaker Name',
};

test('admin profile refresh reconciles the proposal view without resetting filters or focus', async ({
  page,
}) => {
  await reset();
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio:
        'Builds reliable production systems, mentors engineering teams, and shares practical lessons from operating software at scale with developer communities.',
      company: 'Current Company',
      jobTitle: 'Principal Engineer',
    }),
    seedProposal('profile-snapshot-ui-talk', {
      speakerUid: speaker.uid,
      title: 'Profile refresh without losing context',
      status: 'confirmed',
      speaker: {
        name: 'Old Programme Name',
        company: 'Previous Company',
        jobTitle: 'Engineer',
      },
    }),
  ]);

  await signInAs(page, ADMIN, at('/admin/proposals'));
  const search = page.getByRole('searchbox', { name: 'Search' });
  await search.fill('Profile refresh');

  const manage = page.getByRole('button', {
    name: 'Open speaker roster for Profile refresh without losing context',
  });
  await manage.click();
  const dialog = page.getByRole('dialog', { name: 'Speakers for this proposal' });
  await dialog
    .getByRole('button', { name: 'Review profile changes' })
    .click();
  const comparison = dialog.locator('.profile-review');
  await expect(
    comparison.locator('.profile-review__before').filter({ hasText: 'Old Programme Name' }),
  ).toBeVisible();
  await expect(
    comparison.locator('.profile-review__after').filter({ hasText: SPEAKER.name }),
  ).toBeVisible();
  await comparison.getByRole('button', { name: 'Apply profile changes' }).click();
  await expect(dialog.getByText('Session profile updated.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close speaker roster' }).click();
  await expect(dialog).toBeHidden();
  await expect(manage).toBeFocused();
  await expect(search).toHaveValue('Profile refresh');
  await expect(
    page.getByRole('row').filter({ hasText: 'Profile refresh without losing context' }),
  ).toContainText(SPEAKER.name);
});

test('speaker profile refresh updates the roster without a manual refresh', async ({ page }) => {
  await reset();
  const speaker = await createAccount(SPEAKER);
  await Promise.all([
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio:
        'Builds reliable production systems, mentors engineering teams, and shares practical lessons from operating software at scale with developer communities.',
    }),
    seedProposal('profile-snapshot-self-ui-talk', {
      speakerUid: speaker.uid,
      title: 'Keep the visible roster current',
      status: 'confirmed',
      speaker: { name: 'Old Programme Name' },
    }),
  ]);

  await signInAs(page, SPEAKER, at());
  const roster = page.locator('.co-speaker-roster');
  await expect(roster.getByText('Old Programme Name', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Review changes for this session' }).click();
  await page.getByRole('button', { name: 'Apply profile changes' }).click();

  await expect(page.getByText('Session profile updated.')).toBeVisible();
  await expect(roster.getByText(SPEAKER.name, { exact: true })).toBeVisible();
  await expect(roster.getByText('Old Programme Name', { exact: true })).toHaveCount(0);
});

test('admin requests a session-scoped update and the confirmed speaker completes it explicitly', async ({
  page,
}) => {
  await reset();
  const [admin, speaker] = await Promise.all([
    createAccount(ADMIN),
    createAccount(SPEAKER),
  ]);
  await Promise.all([
    seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
      bio:
        'Builds reliable production systems, mentors engineering teams, and shares practical lessons from operating software at scale with developer communities.',
      company: 'Current Company',
      jobTitle: 'Principal Engineer',
    }),
    seedProposal('profile-update-request-ui-talk', {
      speakerUid: speaker.uid,
      title: 'A profile request with a visible finish line',
      status: 'confirmed',
      speaker: {
        name: 'Old Programme Name',
        company: 'Previous Company',
        jobTitle: 'Engineer',
      },
    }),
  ]);

  await signInAs(page, ADMIN, at('/admin/proposals'));
  await page.getByRole('button', {
    name: 'Open speaker roster for A profile request with a visible finish line',
  }).click();
  const dialog = page.getByRole('dialog', { name: 'Speakers for this proposal' });
  await dialog.getByRole('button', { name: 'Review profile changes' }).click();
  await dialog.getByRole('button', { name: 'Request speaker update' }).click();
  await expect(dialog.getByLabel('Profile information')).toBeChecked();
  await expect(
    dialog.getByText('a notification email with the exact session link is queued automatically', {
      exact: false,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Add update request' }).click();
  await expect(dialog.getByText('Update requested', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close speaker roster' }).click();
  const adminQueue = page.getByRole('region', { name: 'Profile update queue' });
  await expect(adminQueue.getByText('Waiting on speaker · 1')).toBeVisible();
  await adminQueue.getByRole('button', {
    name: 'Review Old Programme Name’s profile update for A profile request with a visible finish line',
  }).click();
  await expect(page).toHaveURL(/manageSpeakers=profile-update-request-ui-talk/);
  await expect(page).toHaveURL(new RegExp(`profileSpeaker=${speaker.uid}`));
  await expect(page.locator('.profile-review')).toBeVisible();

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const reopenedDialog = page.getByRole('dialog', { name: 'Speakers for this proposal' });
  await reopenedDialog.getByRole('button', { name: 'Copy session link' }).click();
  await expect(reopenedDialog.getByText('Session link copied.')).toBeVisible();
  const origin = await page.evaluate(() => window.location.origin);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${origin}/c/${CFP_ID}/submit?proposal=profile-update-request-ui-talk`,
  );

  await signInAs(page, SPEAKER, at());
  await expect(
    page.getByRole('button', {
      name: /A profile request with a visible finish line Confirmed Profile update requested/,
    }),
  ).toBeVisible();
  await expect(page.locator('.proposal-journey')).not.toContainText(
    'Profile update requested',
  );
  const speakerRequest = page.locator('.profile-update-request--pending');
  await expect(speakerRequest).toHaveCount(1);
  await expect(
    speakerRequest.getByText('Your speaker profile needs attention for this session'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review changes for this session' }).click();
  await page.getByRole('button', { name: 'Apply profile changes' }).click();
  await expect(page.getByText('Session profile updated.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark requested items complete' })
    .click();
  await expect(
    page
      .locator('.profile-update-request--resolved')
      .getByText('Profile update request completed', { exact: true }),
  ).toBeVisible();

  await signInAs(page, ADMIN, at('/admin/proposals'));
  const readyQueue = page.getByRole('region', { name: 'Profile update queue' });
  await expect(readyQueue.getByText('Ready to review · 1')).toBeVisible();
  await readyQueue.getByRole('button', {
    name: 'Review Latest Speaker Name’s profile update for A profile request with a visible finish line',
  }).click();
  await expect(page.locator('.profile-review')).toBeVisible();
});

test('speaker sees an outstanding request in the picker and its deep link opens the action', async ({
  page,
}) => {
  await reset();
  const speaker = await createAccount(SPEAKER);
  await Promise.all([
    seedSpeaker(speaker.uid, {
      name: SPEAKER.name,
      email: SPEAKER.email,
    }),
    seedProposal('profile-request-badged-talk', {
      speakerUid: speaker.uid,
      title: 'The session that needs attention',
      status: 'confirmed',
    }),
    seedProposal('profile-request-other-talk', {
      speakerUid: speaker.uid,
      title: 'The session with no task',
      status: 'confirmed',
    }),
  ]);
  await seedProfileUpdateRequestDirect('profile-request-badged-talk', speaker.uid);

  await signInAs(page, SPEAKER, at());

  await expect(
    page.getByRole('button', {
      name: /The session that needs attention Confirmed Profile update requested/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'The session with no task Confirmed', exact: true }),
  ).toBeVisible();

  await page.goto(`${at()}?proposal=profile-request-badged-talk`);
  await expect(
    page.getByRole('button', {
      name: /The session that needs attention Confirmed Profile update requested/,
    }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.profile-update-request--pending')).toHaveCount(1);
});
