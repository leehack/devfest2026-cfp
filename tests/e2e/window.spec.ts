import { expect, test } from '@playwright/test';
import { clearAuth, clearFirestore, reset } from './backend';

const day = 24 * 60 * 60 * 1000;

test.describe('the submission window', () => {
  test('a missing config document reads as closed, not as open', async ({ page }) => {
    // The failure that matters: config gone should never mean "wide open".
    await clearFirestore();
    await clearAuth();
    await page.goto('/');
    await expect(page.getByText('The call for proposals is not open yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  });

  test('before it opens, says so and gives the date', async ({ page }) => {
    await reset({ opensAt: new Date(Date.now() + 10 * day) });
    await page.goto('/');
    await expect(page.getByText('The call for proposals is not open yet.')).toBeVisible();
    await expect(page.getByText('It opens on')).toBeVisible();
  });

  test('after it closes, says so and gives the date', async ({ page }) => {
    await reset({ closesAt: new Date(Date.now() - day) });
    await page.goto('/');
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
    await expect(page.getByText('It closed on')).toBeVisible();
  });

  test('paused is its own message, not "closed"', async ({ page }) => {
    await reset({ paused: true });
    await page.goto('/');
    await expect(page.getByText(/paused/)).toBeVisible();
  });

  test('open shows the deadline before asking anyone to sign in', async ({ page }) => {
    await reset();
    await page.goto('/');
    await expect(page.getByText('Submissions close on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to submit' })).toBeVisible();
  });
});
