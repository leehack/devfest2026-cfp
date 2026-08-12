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
  deleteReviewDirect,
  inviteRole,
  readProposalById,
  readReviews,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  seedSubmittedProposal,
  setSubmissionFormDirect,
} from './backend';
import { alerts, at, signInAs, type Identity } from './form';

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
  await signInAs(page, REVIEWER, at('/review'));
  await expect(page.getByText('1 of 3')).toBeVisible();
}

const heading = (page: Page, title: string) => page.getByRole('heading', { name: title });

test.describe('the review deck', () => {
  test('the first real review freezes talk content and deleting the review does not reopen it', async ({
    page,
  }) => {
    await reset();
    const reviewer = await createAccount(REVIEWER);
    const speaker = await createAccount(SPEAKER);
    await Promise.all([
      seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email),
      seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email }),
      seedSubmittedProposal('first-review-lock', {
        speakerUid: speaker.uid,
        title: 'The first review starts the round',
      }),
    ]);

    await signInAs(page, REVIEWER, at('/review'));
    await page.getByRole('button', { name: '3 — Yes' }).click();
    await expect(page.getByText('1 of 1 responded')).toBeVisible();
    await expect
      .poll(async () => (await readProposalById('first-review-lock'))?.status)
      .toBe('under_review');

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeDisabled();
    await expect(page.getByText(/talk itself is locked now/)).toBeVisible();

    await deleteReviewDirect('first-review-lock', reviewer.uid);
    await expect.poll(async () => (await readReviews('first-review-lock')).length).toBe(0);
    await page.reload();

    expect((await readProposalById('first-review-lock'))?.status).toBe('under_review');
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeDisabled();
    await expect(page.getByText(/talk itself is locked now/)).toBeVisible();
  });

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

  test('renders the reviewer projection without legacy confirmation or travel details', async ({
    page,
  }) => {
    await reset();
    const reviewer = await createAccount(REVIEWER);
    const speaker = await createAccount(SPEAKER);
    await seedMember(reviewer.uid, 'reviewer', undefined, REVIEWER.email);
    await setSubmissionFormDirect({
      fields: [
        {
          key: 'reviewerContext',
          type: 'textarea',
          required: false,
          label: { en: 'Reviewer context', fr: 'Contexte pour le comité' },
        },
        {
          key: 'demoMode',
          type: 'select',
          required: false,
          label: { en: 'Demo format', fr: 'Format de la démo' },
          options: [{ value: 'live', label: { en: 'Live demo', fr: 'Démo en direct' } }],
        },
      ],
    });
    await seedProposal('private-legacy-details', {
      speakerUid: speaker.uid,
      title: 'A safe projected review',
      status: 'submitted',
      speaker: {
        name: 'Public Speaker',
        bio: 'This public biography reaches the review card.',
        email: 'private-speaker@example.org',
        dietaryNeeds: 'Private dietary detail',
      },
      attendance: { status: 'pending', needsVisa: true },
      confirmAnswers: { dietaryNeeds: 'Severe allergy' },
      headshotUploads: { portrait: { path: 'private-working-photo' } },
      speakerPhoto: { path: 'private-confirmed-photo' },
      answers: {
        reviewerContext: '  The live coding is the core of the session.  ',
        demoMode: 'live',
        privateTravelNote: 'Never expose this applicant note',
      },
    });

    await signInAs(page, REVIEWER, at('/review'));
    await expect(heading(page, 'A safe projected review')).toBeVisible();
    await expect(page.getByText('This public biography reaches the review card.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Additional talk details' })).toBeVisible();
    await expect(page.getByText('Reviewer context')).toBeVisible();
    await expect(page.getByText('The live coding is the core of the session.')).toBeVisible();
    await expect(page.getByText('Live demo')).toBeVisible();
    await expect(page.getByText('Needs a visa or eTA to enter Canada')).toHaveCount(0);
    for (const privateValue of [
      'private-speaker@example.org',
      'Private dietary detail',
      'Severe allergy',
      'private-working-photo',
      'private-confirmed-photo',
      'Never expose this applicant note',
    ]) {
      await expect(page.getByText(privateValue, { exact: false })).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Renseignements supplémentaires sur la conférence',
      }),
    ).toBeVisible();
    await expect(page.getByText('Contexte pour le comité')).toBeVisible();
    await expect(page.getByText('Démo en direct')).toBeVisible();
  });

  test('a number scores the talk on screen and advances', async ({ page }) => {
    await stage(page);

    await page.keyboard.press('3');
    // The counter first, always: it is the signal that the write has landed,
    // and anything asserted before it is reading a frame that has not caught up.
    await expect(page.getByText('1 of 3 responded')).toBeVisible();
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
    await expect(page.getByText('1 of 3 responded')).toBeVisible();
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
    await expect(page.getByText('1 of 3 responded')).toBeVisible();
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
    await expect(page.getByText('0 of 3 responded')).toBeVisible();
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
    await expect(page.getByText('1 of 3 responded')).toBeVisible();

    const reviews = await readReviews('deck-0');
    expect(reviews[0]).toMatchObject({ score: 3, comment: 'Wants a tighter close.' });
    expect(await readReviews('deck-1')).toHaveLength(0);
  });

  test('a failed score save keeps its exact proposal, note, and score for retry', async ({
    page,
  }) => {
    await stage(page);

    const title = TITLES[0];
    const comment = 'Keep this exact note through a failed save.';
    const note = page.getByRole('textbox', { name: /^Notes for the committee/ });
    await note.fill(comment);

    let failNextSave = true;
    await page.route('**/saveReview', async (route) => {
      if (!failNextSave) {
        await route.continue();
        return;
      }
      failNextSave = false;
      await route.abort('failed');
    });
    await page.getByRole('button', { name: '3 — Yes' }).click();

    const recovery = alerts(page).filter({
      has: page.getByRole('heading', { name: 'Some reviews did not save' }),
    });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByText(title, { exact: true })).toBeVisible();
    expect(failNextSave).toBe(false);
    expect(await readReviews('deck-0')).toHaveLength(0);

    await page.unroute('**/saveReview');
    await recovery.getByRole('button', { name: 'Open proposal' }).click();
    await expect(heading(page, title)).toBeVisible();
    await expect(note).toHaveValue(comment);
    await expect(page.getByRole('button', { name: '3 — Yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await recovery.getByRole('button', { name: 'Retry save' }).click();
    await expect(recovery).toHaveCount(0);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const reviews = await readReviews('deck-0');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ score: 3, comment });
  });

  test('an unscored note survives leaving and returning to review', async ({ page }) => {
    await stage(page);

    const note = 'Compare the evidence in the final section before scoring.';
    await page.getByRole('textbox', { name: /^Notes for the committee/ }).fill(note);
    await page.goto(at('/schedule'));
    await page.getByRole('link', { name: 'Review talks', exact: true }).click();

    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Notes for the committee/ })).toHaveValue(note);
    expect(await readReviews('deck-0')).toHaveLength(0);
  });

  test('a conflict can be saved without choosing a numeric score', async ({ page }) => {
    await stage(page);

    await page.getByRole('checkbox', { name: 'I have a conflict of interest' }).check();
    const save = page.getByRole('button', { name: 'Save review', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    const reviews = await readReviews('deck-0');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ conflictOfInterest: true });
    await page.reload();
    await expect(heading(page, TITLES[1])).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'I have a conflict of interest' })).toBeChecked();
    for (const name of ['1 — Pass', '2 — Maybe', '3 — Yes', '4 — Strong yes']) {
      await expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }

    await page.keyboard.press('3');
    await expect(heading(page, TITLES[0])).toBeVisible();
    expect((await readReviews('deck-0'))[0]).toMatchObject({
      conflictOfInterest: true,
      score: 1,
    });
  });

  test('the shortcut list can be opened from the keyboard', async ({ page }) => {
    await stage(page);

    await expect(page.getByText('Score, and move to the next one')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(page.getByText('Score, and move to the next one')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByText('Score, and move to the next one')).toHaveCount(0);
  });

  test('the queue can jump back to any named proposal and shows its review state', async ({
    page,
  }) => {
    await stage(page);
    await page.keyboard.press('3');
    await expect(page.getByText('1 of 3 responded')).toBeVisible();

    await page.getByRole('button', { name: 'Review queue', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Review queue' });
    await expect(queue).toBeVisible();
    const first = queue.getByRole('button', { name: /Alpha on caching/ });
    await expect(first).toContainText('Responded');
    await first.click();

    await expect(heading(page, TITLES[0])).toBeVisible();
    await expect(page.getByRole('button', { name: '4 — Strong yes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('button', { name: '3 — Yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the queue identifies the current talk without creating a focus-losing action', async ({
    page,
  }) => {
    await stage(page);

    const toggle = page.locator('button[aria-controls="review-queue"]');
    await expect(toggle).toHaveAccessibleName('Review queue');
    await expect(toggle).toHaveAttribute('aria-controls', 'review-queue');
    await toggle.click();
    await expect(toggle).toBeFocused();

    const current = page.locator('#review-queue [aria-current="true"]');
    await expect(current).toContainText('Current · Needs response');
    await expect(current.getByRole('button')).toHaveCount(0);
  });

  test('says plainly when every proposal in the current view has a response', async ({ page }) => {
    await stage(page);

    for (const count of [1, 2, 3]) {
      await page.keyboard.press('3');
      await expect(page.getByText(`${count} of 3 responded`)).toBeVisible();
    }
    await expect(page.getByText('Every proposal in this view has a response.')).toBeVisible();
  });

  /* Travel, visa and funding answers belong to the speaker and organisers.
   * Reviewers receive only the public speaker snapshot and review-relevant
   * proposal fields through the projected review queue. */
  test('the card keeps private travel logistics out of the review deck', async ({ page }) => {
    await reset();
    await createAccount(REVIEWER);
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await inviteRole(REVIEWER.email, 'reviewer');
    await seedProposal('deck-far', {
      speakerUid: speaker.uid,
      title: 'Coming a long way',
      status: 'submitted',
      deliveryLanguage: 'either',
      languagePreference: 'French if the room is up for it.',
      attendance: {
        status: 'pending',
        fundingSource: 'Applying to the GDE programme.',
        decisionBy: '2026-10-01',
        needsVisa: true,
      },
    });

    await signInAs(page, REVIEWER, at('/review'));
    await expect(heading(page, 'Coming a long way')).toBeVisible();

    await expect(page.getByText('French if the room is up for it.')).toBeVisible();
    await expect(page.getByText('Expected but not confirmed')).toHaveCount(0);
    await expect(page.getByText('Applying to the GDE programme.')).toHaveCount(0);
    await expect(page.getByText('2026-10-01')).toHaveCount(0);
    await expect(page.getByText(/Needs a visa or eTA/)).toHaveCount(0);
  });

  /*
   * The three acknowledgements are `z.literal(true)`, so every proposal carries
   * the same values and a row for them says nothing about this one. The
   * speaker's address is contact detail rather than evidence about the talk.
   */
  test('it does not pad itself with what every proposal has in common', async ({ page }) => {
    await stage(page);

    await expect(page.getByText(/code of conduct/i)).toHaveCount(0);
    await expect(page.getByText(SPEAKER.email)).toHaveCount(0);
  });
});
