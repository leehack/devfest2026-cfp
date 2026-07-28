import { expect, test } from '@playwright/test';
import { clearAuth, clearFirestore, reset, seedCfp } from './backend';
import { at } from './form';

const day = 24 * 60 * 60 * 1000;

test.describe('the submission window', () => {
  test('a CFP that does not exist reads as absent, not as open', async ({ page }) => {
    // The failure that matters: a missing tenant should never mean "wide open".
    // It reads differently from a closed one on purpose — a mistyped address and
    // a shut window are different problems with different fixes.
    await clearFirestore();
    await clearAuth();
    await page.goto(`/${at()}`);
    await expect(
      page.getByText('There is no call for proposals at this address.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  });

  test('an archived CFP is shut, whatever its dates say', async ({ page }) => {
    await reset();
    await seedCfp(undefined, { archived: true });
    await page.goto(`/${at()}`);
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
  });

  test('before it opens, says so and gives the date', async ({ page }) => {
    await reset({ opensAt: new Date(Date.now() + 10 * day) });
    await page.goto(`/${at()}`);
    await expect(page.getByText('The call for proposals is not open yet.')).toBeVisible();
    await expect(page.getByText('It opens on')).toBeVisible();
  });

  test('after it closes, says so and gives the date', async ({ page }) => {
    await reset({ closesAt: new Date(Date.now() - day) });
    await page.goto(`/${at()}`);
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
    await expect(page.getByText('It closed on')).toBeVisible();
  });

  test('paused is its own message, not "closed"', async ({ page }) => {
    await reset({ paused: true });
    await page.goto(`/${at()}`);
    await expect(page.getByText(/paused/)).toBeVisible();
  });

  test('open shows the deadline before asking anyone to sign in', async ({ page }) => {
    await reset();
    await page.goto(`/${at()}`);
    await expect(page.getByText('Submissions close on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });
});
