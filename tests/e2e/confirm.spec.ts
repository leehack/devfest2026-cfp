/**
 * The speaker's answer to an acceptance.
 *
 * Guards go through `callAs` rather than the UI: "the button is not rendered"
 * is not the claim worth proving — `status` is function-written only, so the
 * callable is the enforcement point and the thing an attacker would reach for.
 */

import { expect, test } from '@playwright/test';

import {
  callAs,
  createAccount,
  readProposalById,
  reset,
  seedProposal,
  inviteRole,
  seedSpeaker,
  setConfirmFormDirect,
} from './backend';
import { signInAs, type Identity } from './form';

const SPEAKER: Identity = { sub: 'speaker-sub', email: 'speaker@example.org', name: 'Sam' };
const OTHER: Identity = { sub: 'other-sub', email: 'other@example.org', name: 'Robin' };
const ADMIN: Identity = { sub: 'admin-sub', email: 'ada@example.org', name: 'Ada' };

const statusOf = async (id: string) => (await readProposalById(id))?.status;

test.describe('answering an acceptance', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('an accepted speaker confirms, and it sticks across a reload', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-yes', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });

    await signInAs(page, SPEAKER, '#/');
    await page.getByRole('button', { name: 'Yes, I can present' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByText('See you in Montréal')).toBeVisible();
    expect(await statusOf('p-yes')).toBe('confirmed');

    // The answer is a status, not a bit of page state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, I can present' })).toHaveCount(0);
  });

  test('declining asks first, and taking it back changes nothing', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-no', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });

    await signInAs(page, SPEAKER, '#/');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'I have to decline' }).click();

    // Dismissed, so nothing moved — a slot given away by a stray click is the
    // failure this confirmation exists for.
    await expect(page.getByRole('heading', { name: 'Accepted' })).toBeVisible();
    expect(await statusOf('p-no')).toBe('accepted');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'I have to decline' }).click();
    await expect(page.getByRole('heading', { name: 'Declined' })).toBeVisible();
    expect(await statusOf('p-no')).toBe('declined');
  });

  test('nobody answers for someone else', async () => {
    const speaker = await createAccount(SPEAKER);
    const other = await createAccount(OTHER);
    await seedProposal('p-mine', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });

    expect(
      await callAs(other.idToken, 'respondToDecision', {
        proposalId: 'p-mine',
        response: 'confirm',
      }),
    ).toMatchObject({ ok: false });
    expect(await statusOf('p-mine')).toBe('accepted');

    // Paired with one that succeeds, or a broken URL would pass as a refusal.
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-mine',
        response: 'confirm',
      }),
    ).toMatchObject({ ok: true });
    expect(await statusOf('p-mine')).toBe('confirmed');
  });

  test('there is nothing to answer until a decision has been made', async () => {
    const speaker = await createAccount(SPEAKER);
    for (const status of ['submitted', 'under_review', 'rejected', 'waitlisted']) {
      await seedProposal(`p-${status}`, {
        speakerUid: speaker.uid,
        title: `Talk ${status}`,
        status,
      });
      expect(
        await callAs(speaker.idToken, 'respondToDecision', {
          proposalId: `p-${status}`,
          response: 'confirm',
        }),
      ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
      expect(await statusOf(`p-${status}`)).toBe(status);
    }
  });

  test('an answer can be changed, and re-clicking a mailed link is harmless', async () => {
    const speaker = await createAccount(SPEAKER);
    await seedProposal('p-mind', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });
    const respond = (response: string) =>
      callAs(speaker.idToken, 'respondToDecision', { proposalId: 'p-mind', response });

    expect(await respond('confirm')).toMatchObject({ ok: true });
    // Idempotent: a speaker who opens the email twice must not see an error.
    expect(await respond('confirm')).toMatchObject({ ok: true });
    expect(await statusOf('p-mind')).toBe('confirmed');

    // Plans change, and the alternative is an organiser editing it by hand.
    expect(await respond('decline')).toMatchObject({ ok: true });
    expect(await statusOf('p-mind')).toBe('declined');
  });

  test('the answer has to be one of the two', async () => {
    const speaker = await createAccount(SPEAKER);
    await seedProposal('p-junk', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });

    for (const response of ['', 'maybe', 'accepted', 'confirmed']) {
      expect(
        await callAs(speaker.idToken, 'respondToDecision', { proposalId: 'p-junk', response }),
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    }
    expect(await statusOf('p-junk')).toBe('accepted');
  });
});

/**
 * The organiser's own questions, asked on confirmation.
 *
 * The form is data an admin edits, so the interesting failures are the ones
 * where the two copies of it disagree — the browser's, which renders, and the
 * callable's, which is the only thing that can actually write an answer.
 */
test.describe('the confirmation questions', () => {
  const SHIRT = {
    key: 'shirt',
    type: 'select',
    label: { en: 'T-shirt size', fr: 'Taille de t-shirt' },
    required: true,
    options: [
      { value: 'M', label: { en: 'M' } },
      { value: 'L', label: { en: 'L' } },
    ],
  };
  const DIET = {
    key: 'diet',
    type: 'text',
    label: { en: 'Anything we should know about food?' },
    required: false,
  };

  async function accepted(id = 'p-q') {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal(id, { speakerUid: speaker.uid, title: 'Sam on shipping', status: 'accepted' });
    return speaker;
  }

  test('a speaker answers them, and an organiser gets the answers back', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT, DIET]);

    await signInAs(page, SPEAKER, '#/');
    // Saying yes opens the questions rather than confirming on the spot.
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByLabel(/T-shirt size/)).toBeVisible();
    expect(await statusOf('p-q')).toBe('accepted');

    await page.getByLabel(/T-shirt size/).selectOption('L');
    await page.getByLabel(/food/).fill('No shellfish.');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    expect(await statusOf('p-q')).toBe('confirmed');
    expect((await readProposalById('p-q'))?.confirmAnswers).toEqual({
      shirt: 'L',
      diet: 'No shellfish.',
    });
  });

  test('a required question blocks the confirmation and says which', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT, DIET]);

    await signInAs(page, SPEAKER, '#/');
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/food/).fill('No shellfish.');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByText('This one is needed.')).toBeVisible();
    // Still theirs to accept: a missing shirt size must not cost them the slot.
    expect(await statusOf('p-q')).toBe('accepted');
  });

  test('declining never asks them', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER, '#/');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'I have to decline' }).click();

    await expect(page.getByRole('heading', { name: 'Declined' })).toBeVisible();
    expect(await statusOf('p-q')).toBe('declined');
    expect((await readProposalById('p-q'))?.confirmAnswers).toBeUndefined();
  });

  test('with no questions configured, confirming stays one click', async ({ page }) => {
    await accepted();

    await signInAs(page, SPEAKER, '#/');
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
  });

  test('an answer can be corrected after confirming', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER, '#/');
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/T-shirt size/).selectOption('M');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    // A size picked in a hurry should not be final.
    await page.getByLabel(/T-shirt size/).selectOption('L');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect.poll(async () => (await readProposalById('p-q'))?.confirmAnswers?.shirt).toBe('L');
  });

  test('the callable refuses answers the form did not ask for', async () => {
    const speaker = await accepted();
    await setConfirmFormDirect([SHIRT]);

    // The browser renders the form; only this decides what may be stored.
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-q',
        response: 'confirm',
        answers: { shirt: 'XXL' },
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(await statusOf('p-q')).toBe('accepted');

    // And drops one for a question that is not on the form at all.
    await callAs(speaker.idToken, 'respondToDecision', {
      proposalId: 'p-q',
      response: 'confirm',
      answers: { shirt: 'M', smuggled: 'x' },
    });
    expect((await readProposalById('p-q'))?.confirmAnswers).toEqual({ shirt: 'M' });
  });

  test('only an admin can change the questions', async () => {
    const speaker = await accepted();
    expect(
      await callAs(speaker.idToken, 'setConfirmForm', { fields: [SHIRT] }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('an admin writes a question and a speaker is asked it', async ({ page }) => {
    await accepted();
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);

    await signInAs(page, ADMIN, '#/admin');
    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Confirmation questions' }),
    });

    await panel.getByRole('button', { name: 'Add a question' }).click();
    await panel.getByLabel('Question (English)').fill('Which hotel are you at?');
    await panel.getByRole('button', { name: 'Save questions' }).click();
    await expect(panel.getByText('Questions saved.')).toBeVisible();

    // The key is derived from the label and shown, because it is what every
    // stored answer is filed under and it does not move afterwards.
    await expect(panel.getByText(/stored under .which_hotel_are_you_at./)).toBeVisible();

    await signInAs(page, SPEAKER, '#/');
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/Which hotel/).fill('The one by the station.');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    expect((await readProposalById('p-q'))?.confirmAnswers).toEqual({
      which_hotel_are_you_at: 'The one by the station.',
    });
  });
});
