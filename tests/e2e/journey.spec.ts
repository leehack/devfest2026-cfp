/**
 * The whole thing, once, in order: two talks from one speaker, a reviewer
 * invited and scoring them, an admin deciding, and the result showing up.
 *
 * Every step is covered in isolation elsewhere. This exists to catch what
 * isolated tests cannot — the seams between them.
 */

import { expect, test, type Page } from '@playwright/test';

import { inviteRole, readProposals, reset } from './backend';
import { COMPLETE, at, check, field, fillRequired, select, signInAs, type Identity } from './form';

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
  await signInAs(page, REVIEWER, at('/review'));

  // One at a time now: the second proposal is a keystroke away, not a scroll.
  await expect(page.getByText('0 of 2 scored')).toBeVisible();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.locator('.card h2')).toHaveCount(1);
  // Not a blind review (§7) — the speaker's name is on the card.
  await expect(page.getByText('Test Speaker', { exact: false }).first()).toBeVisible();

  // The queue has no `orderBy`, so which talk the deck opens on is Firestore's
  // choice. Score whichever is up, then assert the ranking — the run has to
  // come out the same either way.
  const scores: Record<string, string> = { [FIRST]: '4 — Strong yes', [SECOND]: '2 — Maybe' };
  const opened = await page.locator('.card h2').innerText();
  const then = opened === FIRST ? SECOND : FIRST;

  await scoreTalk(page, opened, scores[opened], 1);
  // Scoring advanced the deck on its own; nothing here asked it to.
  await scoreTalk(page, then, scores[then], 2);

  // ------------------------------------------------------------------ admin
  await expect
    .poll(
      async () =>
        (await readProposals()).filter((proposal) => proposal.aggregate?.reviewCount === 1).length,
      { timeout: 15_000 },
    )
    .toBe(2);

  await inviteRole(ADMIN.email, 'admin');
  await signInAs(page, ADMIN, at('/admin/proposals'));
  await expect(page.getByRole('button', { name: 'Recompute scores' })).toHaveCount(0);
  await expect(page.getByText('2 of 2 proposals')).toBeVisible();

  // Ranked best first, so the 4 outranks the 2. Scoped to the Proposals
  // section — the admin page has several tables, and the email log is one.
  const proposals = page.locator('.section', {
    has: page.getByRole('heading', { name: 'Proposal decisions' }),
  });
  const titles = await proposals.locator('.table tbody tr td:first-child strong').allInnerTexts();
  expect(titles).toEqual([FIRST, SECOND]);

  await page.getByLabel(`Status: ${FIRST}`).selectOption('accepted');
  await expect(page.getByText(`“${FIRST}” moved from Submitted to Accepted.`)).toBeVisible();
  await page.getByLabel(`Status: ${SECOND}`).selectOption('rejected');
  await expect(page.getByText(`“${SECOND}” moved from Submitted to Rejected.`)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(`Restored the previous status for “${SECOND}”.`)).toBeVisible();
  expect((await readProposals()).find((proposal) => proposal.title === SECOND)?.status).toBe(
    'submitted',
  );
  await page.getByLabel(`Status: ${SECOND}`).selectOption('rejected');
  await expect(page.getByText(`“${SECOND}” moved from Submitted to Rejected.`)).toBeVisible();

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

/**
 * The review screen is a deck — one proposal on screen, and the score button
 * both saves and moves on. So this asserts the counter rather than a "Saved"
 * that has already navigated away, and clicks rather than checks: a control
 * that navigates cannot be verified-and-retried.
 */
async function scoreTalk(page: Page, title: string, score: string, scoredAfter: number) {
  const card = page.locator('.card', { has: page.getByRole('heading', { name: title }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: score }).click();
  await expect(page.getByText(`${scoredAfter} of 2 scored`)).toBeVisible();
}
