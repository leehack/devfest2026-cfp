/**
 * Signing in without a Google account.
 *
 * The link is a bearer credential: whoever opens it is signed in as its owner.
 * So the claims worth proving are about where it does *not* go — not into the
 * callable's response, not into `emailLog` — and about the throttle, since this
 * callable is the one thing on the site that will mail a stranger on request.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  callPublic,
  clearSignInAllowance,
  inviteRole,
  readEmailLog,
  readSignInLinks,
  reset,
  setPublicUrlDirect,
} from './backend';
import { at, signInAs, type Identity } from './form';

const ADDRESS = 'nogoogle@example.test';
const COMMITTEE_ADDRESS = 'committee-link@example.test';
const EXISTING_USER: Identity = {
  sub: 'already-signed-in-sub',
  email: 'already-signed-in@example.test',
  name: 'Existing User',
};

/**
 * The server builds the link, so it decides where the link comes back to. Said
 * here rather than left to the environment: `CFP_PUBLIC_URL` in a gitignored
 * `functions/.env.local` made these pass on a laptop and fail in CI, where the
 * fallback pointed at a `.web.app` address that is not this app at all.
 */
const HERE = 'http://localhost:5173';

/** Public: no token at all, which is the point of it. */
const request = (email: string) => callPublic('requestSignInLink', { email, locale: 'en' });

async function ask(page: Page, email: string, path = at()) {
  await page.goto(path);
  await page.getByRole('textbox', { name: /^Email/ }).fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  // The link does not exist until the callable has answered.
  await expect(page.getByText(/sign-in link is on its way/)).toBeVisible();
}

/**
 * The most recent link for one address. The Auth emulator keeps its out-of-band
 * codes across `reset()`, so the first entry in the list belongs to whichever
 * test ran before this one.
 */
async function latestLink(email: string): Promise<string> {
  const mine = (await readSignInLinks()).filter((l) => l.email === email);
  expect(mine.length, `a link for ${email}`).toBeGreaterThan(0);
  return mine[mine.length - 1].link;
}

test.describe('signing in by email link', () => {
  test.beforeEach(async () => {
    await reset();
    await clearSignInAllowance();
    await setPublicUrlDirect(HERE);
  });

  test('a link arrives and signs the person in', async ({ page }) => {
    await ask(page, ADDRESS);
    await expect(page.getByText(new RegExp(`${ADDRESS}.*sign-in link is on its way`))).toBeVisible();

    // Same browser, so the address it was requested with is already known and
    // the link completes without asking again.
    await page.goto(await latestLink(ADDRESS));
    await expect(page.getByRole('heading', { name: 'Your talk' })).toBeVisible();
    // Signed in as the address that asked, not merely signed in as somebody.
    await expect(page.getByRole('textbox', { name: /^Email/ })).toHaveValue(ADDRESS);
  });

  test('a committee link returns to the workspace that requested it', async ({ page }) => {
    await inviteRole(COMMITTEE_ADDRESS, 'admin');
    await ask(page, COMMITTEE_ADDRESS, at('/admin/proposals'));

    await page.goto(await latestLink(COMMITTEE_ADDRESS));
    await expect(page).toHaveURL(at('/admin/proposals'));
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  });

  /*
   * `cfpId: null` rather than an omitted key, because `withCfp` in `backend.ts`
   * fills the seeded tenant in for any call that does not name one — which is
   * why `request()` above tests the CFP-scoped path too, and why nothing here
   * saw this until a link minted outside a CFP was opened by hand.
   */
  test('a link asked for outside a CFP still signs the person in', async ({ page }) => {
    const email = 'platform-link@example.test';
    expect((await callPublic('requestSignInLink', { email, locale: 'en', cfpId: null })).ok).toBe(
      true,
    );

    // No CFP to return to, so the server sends it to the root — the one route
    // that renders no sign-in panel of its own.
    const link = await latestLink(email);
    expect(new URL(link).searchParams.get('continueUrl')).toBe(`${HERE}/`);

    await page.goto(link);
    await expect(page.getByText('One more thing')).toBeVisible();
    await page.getByRole('textbox', { name: /^Email/ }).fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Signed in, and left on the listing rather than on a sign-in panel.
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).search).toBe('');
  });

  test('a link replaces an existing signed-in account instead of being ignored', async ({ page }) => {
    await signInAs(page, EXISTING_USER);
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

    // Requested outside the browser, so the address must be confirmed even
    // though a different Firebase user is already active in this tab.
    await request(ADDRESS);
    await page.goto(await latestLink(ADDRESS));
    await expect(page.getByText('One more thing')).toBeVisible();
    await page.getByRole('textbox', { name: /^Email/ }).fill(ADDRESS);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByText(ADDRESS, { exact: true })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('a refused link offers a new one instead of a dead Continue', async ({ page }) => {
    // Asked for over the callable, so this browser never stored the address and
    // the panel confirms whose link it is first. The failure then has to land
    // somewhere that can still act on it.
    await request(ADDRESS);
    const spoiled = (await latestLink(ADDRESS)).replace(/oobCode=[^&]+/, 'oobCode=nonsense');

    await page.goto(spoiled);
    await expect(page.getByText('One more thing')).toBeVisible();
    await page.getByRole('textbox', { name: /^Email/ }).fill(ADDRESS);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText(/link did not work/)).toBeVisible();
    // The error names a control, so the control has to be on screen.
    await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Email/ })).toHaveValue(ADDRESS);
  });

  test('a caller cannot turn the return destination into an open redirect', async ({ page }) => {
    const email = 'redirect-check@example.test';
    const answer = await callPublic('requestSignInLink', {
      email,
      locale: 'en',
      cfpId: CFP_ID,
      destination: 'https://evil.example/collect',
    });
    expect(answer.ok).toBe(true);

    await page.goto(await latestLink(email));
    expect(new URL(page.url()).pathname).toBe(at());
    await expect(page.getByText('One more thing')).toBeVisible();
    await page.getByRole('textbox', { name: /^Email/ }).fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(at());
    await expect(page.getByRole('heading', { name: 'Your talk' })).toBeVisible();
  });

  test('a mistyped address can be corrected and sent again in place', async ({ page }) => {
    await ask(page, 'mistyped@example.test');

    const email = page.getByRole('textbox', { name: /^Email/ });
    await expect(email).toBeVisible();
    await email.fill(ADDRESS);
    await page.getByRole('button', { name: 'Email me a link' }).click();

    await expect(page.getByText(new RegExp(`${ADDRESS}.*sign-in link is on its way`))).toBeVisible();
    expect(await latestLink(ADDRESS)).toContain('oobCode=');
  });

  test('the link never reaches the queue, the response, or the log', async () => {
    const answer = await request(ADDRESS);
    expect(answer.ok).toBe(true);

    const code = new URL(await latestLink(ADDRESS)).searchParams.get('oobCode')!;
    expect(code).toBeTruthy();

    // Nothing in `emailLog`: an admin can read that queue, and a row holding a
    // live sign-in link would be a way into somebody else's account.
    const rows = await readEmailLog();
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows).toHaveLength(0);
  });

  test('opening it in another browser asks whose it is', async ({ page, browser }) => {
    await request(ADDRESS);
    const link = await latestLink(ADDRESS);

    // A fresh context has no localStorage, which is exactly the case of asking
    // on a laptop and tapping the link on a phone.
    const elsewhere = await browser.newContext();
    const phone = await elsewhere.newPage();
    await phone.goto(link);

    await expect(phone.getByText('One more thing')).toBeVisible();
    await phone.getByRole('textbox', { name: /^Email/ }).fill(ADDRESS);
    await phone.getByRole('button', { name: 'Continue' }).click();
    await expect(phone.getByRole('heading', { name: 'Your talk' })).toBeVisible();
    await elsewhere.close();
    expect(page).toBeTruthy();
  });

  /*
   * Whether a code can be redeemed twice is Firebase's guarantee, not ours, and
   * the emulator does not enforce it the way production does. What is ours is
   * what the page does when a link is refused — a dead link that produces a
   * silent page is the one failure a speaker cannot get past.
   */
  test('a link that is refused says so, and offers another', async ({ page }) => {
    await ask(page, ADDRESS);
    const spoiled = (await latestLink(ADDRESS)).replace(/oobCode=[^&]+/, 'oobCode=nonsense');

    await page.goto(spoiled);
    await expect(page.getByText(/link did not work/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
  });

  test('the same address cannot be mailed over and over', async () => {
    // Otherwise this is a way to have our verified domain mail a stranger
    // repeatedly, which costs the domain reputation the whole pipeline needs.
    for (let i = 0; i < 5; i++) {
      expect((await request(ADDRESS)).ok, `request ${i + 1}`).toBe(true);
    }
    expect(await request(ADDRESS)).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });

    // Per address, not globally — one person hitting the limit must not lock
    // everybody else out.
    expect((await request('someone.else@example.test')).ok).toBe(true);
  });

  test('an address that is not one is refused before anything is sent', async () => {
    // Compared against a snapshot rather than against zero: the Auth emulator
    // keeps its out-of-band codes across `reset()`, so "none at all" would be a
    // claim about the previous test rather than about this one.
    const before = await readSignInLinks();
    for (const bad of ['', 'not-an-address', 'missing@tld', 'two words@example.test']) {
      expect(await request(bad), bad).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    }
    expect(await readSignInLinks()).toEqual(before);
  });

  test('the answer is the same for an address we have never seen', async () => {
    // A different reply for a known address would turn this into a way to ask
    // whether someone submitted to the CFP.
    const stranger = await request('nobody@example.test');
    const known = await request(ADDRESS);
    expect(stranger).toEqual(known);
  });
});
