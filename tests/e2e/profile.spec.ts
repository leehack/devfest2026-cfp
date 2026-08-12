/**
 * The speaker profile as a page of its own.
 *
 * The claim worth proving is that it is the *same document* the submission form
 * writes — a second copy of a bio is the failure this page could quietly
 * introduce.
 */

import { expect, test } from '@playwright/test';

import { createAccount, readSpeaker, reset, seedSpeaker } from './backend';
import { at, field, signInAs, type Identity, alerts } from './form';

const SPEAKER: Identity = { sub: 'speaker-sub', email: 'speaker@example.org', name: 'Sam' };

const BIO =
  'Engineer working on on-device machine learning, based in Montréal. Organises a monthly ' +
  'meetup and has been shipping mobile applications for about a decade.';

test.describe('the speaker profile', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('keeps the editor closed until a failed profile load is retried', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, {
      name: 'Stored Sam',
      email: SPEAKER.email,
      bio: BIO,
    });
    let unavailable = true;
    await page.route('http://127.0.0.1:8080/**', (route) =>
      unavailable ? route.abort() : route.continue(),
    );

    await signInAs(page, SPEAKER, '/me');
    await expect(
      page.getByText('That service is unavailable right now. Please try again shortly.'),
    ).toBeVisible();
    await expect(field(page, 'Name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save profile' })).toHaveCount(0);

    unavailable = false;
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(field(page, 'Name')).toHaveValue('Stored Sam');
    await expect(field(page, 'Bio')).toHaveValue(BIO);
  });

  test('saves once and shows up on the submission form', async ({ page }) => {
    await signInAs(page, SPEAKER, '/me');

    await field(page, 'Name').fill('Sam Rivera');
    await field(page, 'Bio').fill(BIO);
    await field(page, 'Based in').fill('Montréal, QC');
    await field(page, 'Company').fill('Acme');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // The same `speakers/{uid}` the form writes, not a second copy of it.
    await page.goto(at());
    await expect(page.getByText('Profile ready')).toBeVisible();
    await expect(page.getByText('Sam Rivera', { exact: true })).toBeVisible();
    await expect(field(page, 'Name')).toHaveCount(0);

    // Returning speakers can verify the compact summary without reviewing the
    // whole form again, and the canonical fields remain one explicit action away.
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(field(page, 'Name')).toHaveValue('Sam Rivera');
    await expect(field(page, 'Company')).toHaveValue('Acme');
  });

  test('gives each repeated social-link control a distinct accessible name', async ({ page }) => {
    await signInAs(page, SPEAKER, '/me');

    await page.getByRole('button', { name: 'Add a link' }).click();
    await page.getByRole('button', { name: 'Add a link' }).click();

    await expect(page.getByRole('group', { name: 'Website 1' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Website 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove — Website 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove — Website 2' })).toBeVisible();
  });

  test('refuses to save a half-filled profile, and says which half', async ({ page }) => {
    await signInAs(page, SPEAKER, '/me');

    await field(page, 'Name').fill('Sam Rivera');
    // No bio, which the schema requires with a floor.
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect(alerts(page).first()).toBeVisible();
    await expect(page.getByText('Saved.')).toHaveCount(0);
    await expect(field(page, 'Bio')).toBeFocused();
    expect(await readSpeaker((await createAccount(SPEAKER)).uid)).toBeUndefined();
  });

  test('browser Back does not discard profile edits without confirmation', async ({ page }) => {
    await page.goto('/');
    await signInAs(page, SPEAKER, '/me');
    await field(page, 'Name').fill('Sam Rivera');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL('/me');
    await expect(field(page, 'Name')).toHaveValue('Sam Rivera');

    page.once('dialog', (dialog) => dialog.accept());
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL('/');
  });

  test('is reachable from the header, and signs you in first if it has to', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();

    await signInAs(page, SPEAKER, at());
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('link', { name: 'Your profile' }).click();
    await expect(page).toHaveURL('/me');
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  });

  /*
   * Item 5 of the request: the address is asked for once and remembered, so the
   * import at the top of the next form is offered already filled in.
   */
  test('remembers a Sessionize address for the next call', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });

    await signInAs(page, SPEAKER, '/me');
    await field(page, 'Bio').fill(BIO);
    await field(page, 'Based in').fill('Montréal, QC');
    await page.getByRole('textbox', { name: /^Sessionize profile/ }).fill('sessionize.com/sam');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto(at());
    // The import panel's own box, not the profile field further down the page.
    await expect(page.locator('.import').getByRole('textbox')).toHaveValue('sessionize.com/sam');
  });

  test('refuses an address that is not a Sessionize one', async ({ page }) => {
    await signInAs(page, SPEAKER, '/me');
    await field(page, 'Name').fill('Sam Rivera');
    await field(page, 'Bio').fill(BIO);
    await field(page, 'Based in').fill('Montréal, QC');
    await page.getByRole('textbox', { name: /^Sessionize profile/ }).fill('https://example.org/sam');
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect(page.getByText('That is not a Sessionize profile link.')).toBeVisible();
    await expect(page.getByText('Saved.')).toHaveCount(0);
  });
});
