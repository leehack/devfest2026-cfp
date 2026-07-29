/**
 * A call's public front page, and the admin panel that fills it in.
 *
 * The claim worth holding onto is that it renders for somebody who is not
 * signed in and never will be — this is the one screen whose audience has not
 * decided to submit yet.
 */

import { expect, test, type Page } from '@playwright/test';

import { inviteRole, reset } from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = { sub: 'admin-sub', email: 'admin@example.org', name: 'Ada' };

const BLURB =
  'A day of talks about building for the web and for Android, in Montréal, ' +
  'run by the local Google Developer Group.';

async function describeTheEvent(page: Page) {
  await inviteRole(ADMIN.email, 'admin');
  await signInAs(page, ADMIN, at('/admin/settings'));

  await page.getByRole('textbox', { name: /^Description \(English\)/ }).fill(BLURB);
  await page.getByRole('textbox', { name: /^Date of the event/ }).fill('2026-11-14');
  await page.getByRole('textbox', { name: /^Venue/ }).fill('Palais des congrès');
  await page.getByRole('textbox', { name: /^City/ }).fill('Montréal, QC');
  await page.getByRole('textbox', { name: /^Event website/ }).fill('https://gdgmontreal.com');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test.describe('a call’s front page', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('says what the event is, to somebody who is not signed in', async ({ page, browser }) => {
    await describeTheEvent(page);

    // A fresh context: no account, no session, nothing this browser knows.
    const stranger = await browser.newContext();
    const visitor = await stranger.newPage();
    await visitor.goto(at(''));

    await expect(visitor.getByText(/A day of talks about building/)).toBeVisible();
    await expect(visitor.getByText('Palais des congrès, Montréal, QC')).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'gdgmontreal.com' })).toBeVisible();
    await expect(visitor.getByText(/14 November 2026|November 14, 2026/)).toBeVisible();

    // And the way onwards is a link, so it can be opened in a new tab.
    await visitor.getByRole('link', { name: 'Submit a talk' }).click();
    await expect(visitor).toHaveURL(at());
    await stranger.close();
  });

  test('says so plainly when nobody has described it yet', async ({ page }) => {
    await page.goto(at(''));
    await expect(page.getByText('The organisers have not described this event yet.')).toBeVisible();
    // The deadline is still worth saying — it is the fact with a date on it.
    await expect(page.getByText(/Submissions close on/)).toBeVisible();
  });

  test('the details survive a reload of the admin panel', async ({ page }) => {
    await describeTheEvent(page);
    await page.reload();

    await expect(page.getByRole('textbox', { name: /^Venue/ })).toHaveValue('Palais des congrès');
    await expect(page.getByRole('textbox', { name: /^Date of the event/ })).toHaveValue(
      '2026-11-14',
    );
  });

  /*
   * The website is rendered as an href. `javascript:` in one is a script the
   * organiser did not write, running on a page speakers are asked to trust.
   */
  test('refuses a website that is not one', async ({ page }) => {
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/settings'));

    await page
      .getByRole('textbox', { name: /^Event website/ })
      .fill('javascript:alert(document.domain)');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(page.getByRole('alert')).toBeVisible();
    await page.goto(at(''));
    await expect(page.getByRole('link', { name: /alert/ })).toHaveCount(0);
  });
});
