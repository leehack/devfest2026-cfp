/**
 * The whole thing, once, in order: two talks from one speaker, a reviewer
 * invited and scoring them, an admin deciding, and the result showing up.
 *
 * Every step is covered in isolation elsewhere. This exists to catch what
 * isolated tests cannot — the seams between them.
 */

import { expect, test, type Page } from '@playwright/test';

import { inviteRole, readProposals, reset } from './backend';
import { COMPLETE, check, field, fillRequired, select, signInAs, type Identity } from './form';

const SPEAKER: Identity = { sub: 'journey-speaker', email: 'sam@example.org', name: 'Sam' };
const REVIEWER: Identity = { sub: 'journey-reviewer', email: 'rey@example.org', name: 'Rey' };
const ADMIN: Identity = { sub: 'journey-admin', email: 'ada@example.org', name: 'Ada' };

const FIRST = 'Local models on a plane';
const SECOND = 'What broke when we shipped it';

async function submitCurrentTalk(page: Page) {
  await page.getByRole('button', { name: 'Submit proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
}

test('speaker submits two talks, reviewer scores them, admin selects one', async ({ page }) => {
  await reset();

  // ---------------------------------------------------------------- speaker
  await signInAs(page, SPEAKER);
  await expect(field(page, 'Title')).toBeVisible();

  await fillRequired(page);
  await submitCurrentTalk(page);

  // A second talk reuses the speaker profile rather than asking for it again.
  await page.getByRole('button', { name: '+ Another talk' }).click();
  await expect(field(page, 'Title')).toHaveValue('');
  await expect(field(page, 'Bio')).toHaveValue(COMPLETE.bio);

  await field(page, 'Title').fill(SECOND);
  await field(page, 'Abstract').fill(COMPLETE.abstract);
  await select(page, 'Category').selectOption('web');
  await select(page, 'Format').selectOption('lightning_15');
  await select(page, 'Audience level').selectOption('beginner');
  await select(page, 'Which language').selectOption('en');
  await check(page, 'travel and accommodation are not covered').check();
  await check(page, 'Code of Conduct').check();
  await check(page, 'recorded and published').check();
  await page.getByRole('radio', { name: /no travel required/ }).check();
  await submitCurrentTalk(page);

  // Both are on the picker, and both survive a reload.
  await page.reload();
  for (const title of [FIRST, SECOND]) {
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  }

  const stored = await readProposals();
  expect(stored).toHaveLength(2);
  expect(stored.every((p) => p.status === 'submitted')).toBe(true);
  expect(new Set(stored.map((p) => p.title))).toEqual(new Set([FIRST, SECOND]));

  // --------------------------------------------------------------- reviewer
  await inviteRole(REVIEWER.email, 'reviewer');
  await signInAs(page, REVIEWER, '#/review');

  await expect(page.getByText('0 of 2 scored')).toBeVisible();
  await expect(page.getByRole('heading', { name: FIRST })).toBeVisible();
  await expect(page.getByRole('heading', { name: SECOND })).toBeVisible();
  // Not a blind review (§7) — the speaker's name is on the card.
  await expect(page.getByText('Test Speaker', { exact: false }).first()).toBeVisible();

  await scoreTalk(page, FIRST, '4 — Strong yes');
  await scoreTalk(page, SECOND, '2 — Maybe');
  await expect(page.getByText('2 of 2 scored')).toBeVisible();

  // ------------------------------------------------------------------ admin
  await inviteRole(ADMIN.email, 'admin');
  await signInAs(page, ADMIN, '#/admin');

  await page.getByRole('button', { name: 'Recompute scores' }).click();
  await expect(page.getByText('2 reviews across 2 proposals.')).toBeVisible();

  // Ranked best first, so the 4 outranks the 2. Scoped to the Proposals
  // section — the admin page has several tables, and the email log is one.
  const proposals = page.locator('.section', {
    has: page.getByRole('heading', { name: 'Proposals' }),
  });
  const titles = await proposals.locator('.table tbody tr td:first-child').allInnerTexts();
  expect(titles).toEqual([FIRST, SECOND]);

  await page.getByLabel(`Status: ${FIRST}`).selectOption('accepted');
  await page.getByLabel(`Status: ${SECOND}`).selectOption('rejected');

  // ---------------------------------------------------------------- results
  await expect(page.getByRole('heading', { name: 'Selected speakers' })).toBeVisible();
  await expect(page.getByText('1 accepted')).toBeVisible();
  await expect(page.getByText('0 still to decide')).toBeVisible();

  const selected = page.locator('.section', { has: page.getByRole('heading', { name: 'Selected speakers' }) });
  await expect(selected.getByText(FIRST)).toBeVisible();
  await expect(selected.getByText(SECOND)).toHaveCount(0);

  // The decision reached Firestore, not just the table.
  const decided = await readProposals();
  expect(decided.find((p) => p.title === FIRST)?.status).toBe('accepted');
  expect(decided.find((p) => p.title === SECOND)?.status).toBe('rejected');
});

async function scoreTalk(page: Page, title: string, score: string) {
  const card = page.locator('.card', { has: page.getByRole('heading', { name: title }) });
  await card.getByRole('radio', { name: score }).check();
  await card.getByRole('button', { name: 'Save review' }).click();
  await expect(card.getByText('Saved', { exact: true })).toBeVisible();
}
