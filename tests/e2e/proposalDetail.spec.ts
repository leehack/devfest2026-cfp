import { expect, test } from '@playwright/test';

import { createAccount, reset, seedMember, seedProposal, seedReview } from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'detail-admin',
  email: 'detail-admin@example.org',
  name: 'Dana Detail',
};

const ABSTRACT = 'How we moved a monolith to edge functions without a single rollback.';
const COMMENT = 'Strong speaker, but the scope needs trimming for forty minutes.';

test.beforeEach(async () => {
  await reset();
});

test('an organiser reads a proposal and its reviews before deciding', async ({ page }) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await seedProposal('detail-talk', {
    speakerUid: 'detail-speaker',
    title: 'Edge functions in anger',
    status: 'under_review',
    abstract: ABSTRACT,
  });
  await seedReview('detail-talk', 'detail-reviewer', 3, undefined, false, COMMENT);

  await signInAs(page, ADMIN, at('/admin/proposals'));
  const details = page.getByRole('button', { name: 'Open details for Edge functions in anger' });
  await details.click();

  const dialog = page.getByRole('dialog', { name: 'Edge functions in anger' });
  await expect(dialog.getByText(ABSTRACT)).toBeVisible();
  await expect(dialog.getByText(COMMENT)).toBeVisible();
  await expect(dialog.getByText('3 — Yes')).toBeVisible();
  await expect(page).toHaveURL(/[?&]proposal=detail-talk/);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(details).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]proposal=/);

  // The same view is reachable from a link.
  await page.goto(`${at('/admin/proposals')}?proposal=detail-talk`);
  await expect(dialog.getByText(COMMENT)).toBeVisible();
});

test('an organiser who speaks on a proposal is not shown its reviews', async ({ page }) => {
  const admin = await createAccount(ADMIN);
  await seedMember(admin.uid, 'admin', undefined, ADMIN.email);
  await seedProposal('own-talk', {
    speakerUid: admin.uid,
    title: 'My own talk',
    status: 'under_review',
    abstract: ABSTRACT,
  });
  await seedReview('own-talk', 'own-reviewer', 2, undefined, false, COMMENT);

  await signInAs(page, ADMIN, `${at('/admin/proposals')}?proposal=own-talk`);
  const dialog = page.getByRole('dialog', { name: 'My own talk' });
  await expect(dialog.getByText(ABSTRACT)).toBeVisible();
  await expect(
    dialog.getByText('You speak on this proposal, so its individual reviews stay hidden from you.'),
  ).toBeVisible();
  await expect(dialog.getByText(COMMENT)).toHaveCount(0);
});
