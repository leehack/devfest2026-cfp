import { expect, type Page } from '@playwright/test';

import { CFP_ID } from './backend';

/**
 * Page helpers. Fields are found by accessible name, anchored at the start so
 * "Title" does not also match "Job title" — no test ids in the markup.
 */

export const field = (page: Page, label: string) =>
  page.getByRole('textbox', { name: new RegExp(`^${label}\\b`) });

export const select = (page: Page, label: string) =>
  page.getByRole('combobox', { name: new RegExp(`^${label}\\b`) });

export const check = (page: Page, label: string) =>
  page.getByRole('checkbox', { name: new RegExp(label) });

/**
 * A path inside the CFP these specs work on. Every page but the home listing
 * and the create form lives under `/c/{cfpId}`, so writing that out in each
 * spec would be the same string forty times.
 *
 * The submission page by default, because that is what almost every spec here
 * is about. `at('')` is the public front page.
 */
/**
 * The app's own alerts.
 *
 * The framework renders `<div role="alert" id="__next-route-announcer__">` on
 * every page — it announces navigations to screen readers, and it is deliberately
 * empty the rest of the time. A bare `getByRole('alert')` therefore matches two
 * elements and fails strict mode, so every assertion about a message the app
 * raised goes through here.
 */
export const alerts = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)');

export const at = (sub = '/submit') => `/c/${CFP_ID}${sub}`;

export async function signIn(page: Page) {
  await page.goto(at());
  await page.getByRole('button', { name: /test speaker/i }).click();
  await expect(field(page, 'Title')).toBeVisible();
}

export interface Identity {
  sub: string;
  email: string;
  name: string;
}

/** Anyone but the default test speaker — see the hook in `src/lib/devAuth.ts`. */
export async function signInAs(page: Page, who: Identity, path = at()) {
  await page.goto(path);
  await page.waitForFunction(() => typeof (window as any).signInAsTestSpeaker === 'function');
  await page.evaluate((claims) => (window as any).signInAsTestSpeaker(claims), who);
}

/** Everything `submissionSchema` requires, so a test can submit in one call. */
export const COMPLETE = {
  title: 'Local models on a plane',
  abstract:
    'What actually happens when you take a language model offline and run it on the device in your pocket. ' +
    'We will look at quantisation, memory pressure and the three things that break first, with numbers from a ' +
    'real app that shipped to both stores this year and the mistakes made getting there.',
  bio:
    'Engineer working on on-device machine learning, based in Montréal. Organises a monthly meetup and has been ' +
    'shipping mobile applications for about a decade.',
  basedIn: 'Montréal, QC',
};

export async function fillRequired(page: Page) {
  await field(page, 'Title').fill(COMPLETE.title);
  await field(page, 'Abstract').fill(COMPLETE.abstract);
  await select(page, 'Category').selectOption('ai_ml');
  await select(page, 'Format').selectOption('session_40');
  await select(page, 'Audience level').selectOption('intermediate');
  await select(page, 'Which language').selectOption('en');
  await field(page, 'Name').fill('Test Speaker');
  await field(page, 'Bio').fill(COMPLETE.bio);
  await field(page, 'Based in').fill(COMPLETE.basedIn);
  await check(page, 'travel and accommodation are not covered').check();
  await check(page, 'Code of Conduct').check();
  await check(page, 'recorded and published').check();
  await page.getByRole('radio', { name: /no travel required/ }).check();
}

/** Autosave is debounced; this waits for the write rather than guessing. */
export async function waitForSave(page: Page) {
  await expect(page.locator('.actions__status')).toHaveText(/Draft saved/, { timeout: 10_000 });
}
