/**
 * Addresses, now that they are paths rather than fragments.
 *
 * Two claims worth holding onto: the links already sitting in people's
 * mailboxes still work, and moving between pages does not throw the whole
 * application away and rebuild it.
 */

import { expect, test } from '@playwright/test';

import { CFP_ID, inviteRole, reset } from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = { sub: 'admin-sub', email: 'admin@example.org', name: 'Ada' };

test.describe('addresses', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('a link mailed before the move still lands where it points', async ({ page }) => {
    await page.goto(`/#/c/${CFP_ID}`);
    await expect(page).toHaveURL(at());
    await expect(page.getByRole('heading', { name: 'DevFest Montréal 2026' })).toBeVisible();
  });

  test('an old admin link keeps its tab', async ({ page }) => {
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, `/#/c/${CFP_ID}/admin/email`);

    await expect(page).toHaveURL(at('/admin/email'));
    await expect(page.getByRole('button', { name: 'Email', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('an old link the router cannot read reads as the front door', async ({ page }) => {
    await page.goto('/#/nonsense');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'DevFest Montréal 2026' })).toBeVisible();
  });

  /*
   * A well-formed id for a call that does not exist is not the same thing: it
   * keeps its address and says so, rather than quietly becoming the listing —
   * which would read as "that call was deleted" for what is usually a typo.
   */
  test('an old link to a call that is gone keeps its address', async ({ page }) => {
    await page.goto('/#/c/no-such-call-here');
    await expect(page).toHaveURL('/c/no-such-call-here');
    await expect(
      page.getByText('There is no call for proposals at this address.'),
    ).toBeVisible();
  });

  test('following a link keeps the app running, and Back comes home', async ({ page }) => {
    await page.goto('/');
    // Survives a client-side navigation and would not survive a reload, which
    // is the whole difference this test is about.
    await page.evaluate(() => ((window as Window & { kept?: boolean }).kept = true));

    await page.getByRole('link', { name: 'DevFest Montréal 2026' }).click();
    await expect(page).toHaveURL(at());
    expect(await page.evaluate(() => (window as Window & { kept?: boolean }).kept)).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'DevFest Montréal 2026' })).toBeVisible();
  });
});
