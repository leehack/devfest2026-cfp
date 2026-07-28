/**
 * The review deck: one proposal on screen, scored from the keyboard.
 *
 * The claims worth proving are the ones that would quietly corrupt a round —
 * a score landing on the wrong talk, the order moving under the reviewer, or a
 * digit typed into a comment being read as a score.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  createAccount,
  inviteRole,
  readReviews,
  reset,
  seedSpeaker,
  seedSubmittedProposal,
} from './backend';
import { signInAs, type Identity } from './form';

const REVIEWER: Identity = { sub: 'deck-reviewer', email: 'rey@example.org', name: 'Rey' };
const SPEAKER: Identity = { sub: 'deck-speaker', email: 'sam@example.org', name: 'Sam' };

const TITLES = ['Alpha on caching', 'Beta on queues', 'Gamma on tracing'];

async function stage(page: Page) {
  await reset();
  await createAccount(REVIEWER);
  const speaker = await createAccount(SPEAKER);
  await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
  await inviteRole(REVIEWER.email, 'reviewer');
  for (const [i, title] of TITLES.entries()) {
    await seedSubmittedProposal(`deck-${i}`, { speakerUid: speaker.uid, title });
  }
  await signInAs(page, REVIEWER, '#/review');
  await expect(page.getByText('1 of 3')).toBeVisible();
}

const heading = (page: Page, title: string) => page.getByRole('heading', { name: title });

test.describe('the review deck', () => {
  test('shows one proposal at a time and moves with the arrow keys', async ({ page }) => {
    await stage(page);

    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(heading(page, TITLES[1])).toHaveCount(0);

    await page.keyboard.press('ArrowRight');
    await expect(heading(page, TITLES[1])).toBeVisible();
    await expect(page.getByText('2 of 3')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(heading(page, TITLES[0])).toBeVisible();

    // Does not wrap: the ends are ends, so a held-down arrow cannot loop you
    // back to the start without noticing.
    await page.keyboard.press('ArrowLeft');
    await expect(heading(page, TITLES[0])).toBeVisible();
  });

  test('a number scores the talk on screen and advances', async ({ page }) => {
    await stage(page);

    await page.keyboard.press('3');
    // The counter first, always: it is the signal that the write has landed,
    // and anything asserted before it is reading a frame that has not caught up.
    await expect(page.getByText('1 of 3 scored')).toBeVisible();
    await expect(heading(page, TITLES[1])).toBeVisible();

    // The score went to the proposal that was on screen when the key was
    // pressed, not to the one it advanced to.
    const reviews = await readReviews('deck-0');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].score).toBe(3);
    expect(await readReviews('deck-1')).toHaveLength(0);
  });

  test('a score survives going back to it', async ({ page }) => {
    await stage(page);

    await page.keyboard.press('4');
    await expect(page.getByText('1 of 3 scored')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(page.getByRole('button', { name: '4 — Strong yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // The order used to be recomputed from the reviewer's own scores on every
  // render. In a list that is invisible; in a deck it reshuffles the thing you
  // are about to press a number on.
  //
  // The reshuffle only happens once the score reaches `mine`, so every step
  // here waits for the counter first. Asserting straight after the keypress
  // reads the frame before the save lands, and passes no matter what.
  test('scoring does not reorder the deck underneath you', async ({ page }) => {
    await stage(page);

    await page.keyboard.press('2');
    await expect(page.getByText('1 of 3 scored')).toBeVisible();
    await expect(heading(page, TITLES[1])).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(heading(page, TITLES[0])).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(heading(page, TITLES[2])).toBeVisible();
  });

  test('digits typed into a comment are text, not scores', async ({ page }) => {
    await stage(page);

    const comment = page.getByRole('textbox', { name: /^Notes for the committee/ });
    await comment.fill('');
    await comment.press('3');

    // Still on the first proposal, still unscored: the keystroke belonged to
    // the person writing, not to the shortcut handler.
    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(comment).toHaveValue('3');
    await expect(page.getByText('0 of 3 scored')).toBeVisible();
    expect(await readReviews('deck-0')).toHaveLength(0);
  });

  test('a comment written before scoring is saved with the score', async ({ page }) => {
    await stage(page);

    await page
      .getByRole('textbox', { name: /^Notes for the committee/ })
      .fill('Wants a tighter close.');
    // `click`, not `check`: scoring advances the deck, so `check`'s verify-and-
    // retry loop would find the button it just pressed unpressed on the next
    // card and score that one too.
    await page.getByRole('button', { name: '3 — Yes' }).click();
    await expect(heading(page, TITLES[1])).toBeVisible();
    await expect(page.getByText('1 of 3 scored')).toBeVisible();

    const reviews = await readReviews('deck-0');
    expect(reviews[0]).toMatchObject({ score: 3, comment: 'Wants a tighter close.' });
    expect(await readReviews('deck-1')).toHaveLength(0);
  });

  test('the shortcut list can be opened from the keyboard', async ({ page }) => {
    await stage(page);

    await expect(page.getByText('Score, and move to the next one')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(page.getByText('Score, and move to the next one')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByText('Score, and move to the next one')).toHaveCount(0);
  });
});
