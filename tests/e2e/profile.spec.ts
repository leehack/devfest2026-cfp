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
    await expect(field(page, 'Name')).toHaveValue('Sam Rivera');
    await expect(field(page, 'Company')).toHaveValue('Acme');
  });

  test('refuses to save a half-filled profile, and says which half', async ({ page }) => {
    await signInAs(page, SPEAKER, '/me');

    await field(page, 'Name').fill('Sam Rivera');
    // No bio, which the schema requires with a floor.
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect(alerts(page).first()).toBeVisible();
    await expect(page.getByText('Saved.')).toHaveCount(0);
    expect(await readSpeaker((await createAccount(SPEAKER)).uid)).toBeUndefined();
  });

  test('is reachable from the header, and signs you in first if it has to', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();

    await signInAs(page, SPEAKER, at());
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
