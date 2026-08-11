import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  createAccount,
  reset,
  seedMember,
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
    .getByRole('button', { name: 'Use Old Programme Name’s latest profile' })
    .click();
  await expect(dialog.getByText('Session profile updated.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close speaker roster' }).click();
  await expect(dialog).toBeHidden();
  await expect(manage).toBeFocused();
  await expect(search).toHaveValue('Profile refresh');
  await expect(
    page.getByRole('row').filter({ hasText: 'Profile refresh without losing context' }),
  ).toContainText(SPEAKER.name);
});
