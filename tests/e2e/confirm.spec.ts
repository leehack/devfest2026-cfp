/**
 * The speaker's answer to an acceptance.
 *
 * Guards go through `callAs` rather than the UI: "the button is not rendered"
 * is not the claim worth proving — `status` is function-written only, so the
 * callable is the enforcement point and the thing an attacker would reach for.
 */

import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  createAccount,
  readProposalById,
  reset,
  seedProposal,
  inviteRole,
  readStoredObjects,
  seedCfp,
  seedSpeaker,
  setConfirmFormDirect,
  storeObjectDirect,
} from './backend';
import { at, signInAs, type Identity } from './form';
import { FIELD_TYPES } from '../../shared/confirmForm';

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

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByText('See you in Montréal')).toBeVisible();
    expect(await statusOf('p-yes')).toBe('confirmed');

    // The answer is a status, not a bit of page state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, I can present' })).toHaveCount(0);
  });

  test('a speaker can change their response in either direction from the proposal page', async ({
    page,
  }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-change', {
      speakerUid: speaker.uid,
      title: 'Plans can change',
      status: 'confirmed',
    });

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('button', { name: 'I have to decline' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'I have to decline' }).click();
    await expect(page.getByRole('heading', { name: 'Declined' })).toBeVisible();
    expect(await statusOf('p-change')).toBe('declined');

    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    expect(await statusOf('p-change')).toBe('confirmed');
  });

  test('declining asks first, and taking it back changes nothing', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-no', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });

    await signInAs(page, SPEAKER);
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

    await signInAs(page, SPEAKER);
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

    await signInAs(page, SPEAKER);
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

    await signInAs(page, SPEAKER);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'I have to decline' }).click();

    await expect(page.getByRole('heading', { name: 'Declined' })).toBeVisible();
    expect(await statusOf('p-q')).toBe('declined');
    expect((await readProposalById('p-q'))?.confirmAnswers).toBeUndefined();
  });

  test('with no questions configured, confirming stays one click', async ({ page }) => {
    await accepted();

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
  });

  test('an answer can be corrected after confirming', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/T-shirt size/).selectOption('M');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    // A size picked in a hurry should not be final.
    await page.getByLabel(/T-shirt size/).selectOption('L');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect.poll(async () => (await readProposalById('p-q'))?.confirmAnswers?.shirt).toBe('L');
  });

  test('confirmed details autosave without changing the response', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/T-shirt size/).selectOption('M');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    await page.getByLabel(/T-shirt size/).selectOption('L');
    await expect
      .poll(async () => (await readProposalById('p-q'))?.confirmAnswers?.shirt)
      .toBe('L');
    expect(await statusOf('p-q')).toBe('confirmed');

    await page.reload();
    await expect(page.getByLabel(/T-shirt size/)).toHaveValue('L');
  });

  test('an archived confirmation stays readable but cannot be changed', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await setConfirmFormDirect([SHIRT]);
    await seedProposal('p-archived-confirmed', {
      speakerUid: speaker.uid,
      title: 'An archived talk',
      status: 'confirmed',
      confirmAnswers: { shirt: 'M' },
    });
    await seedCfp(undefined, { archived: true });

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByLabel(/T-shirt size/)).toHaveValue('M');
    await expect(page.getByLabel(/T-shirt size/)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'I have to decline' })).toHaveCount(0);
  });

  test('archiving transactionally freezes response and withdrawal callables', async () => {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-confirm-archived', {
      speakerUid: speaker.uid,
      title: 'Confirm after archive',
      status: 'accepted',
    });
    await seedProposal('p-decline-archived', {
      speakerUid: speaker.uid,
      title: 'Decline after archive',
      status: 'accepted',
    });
    await seedProposal('p-withdraw-archived', {
      speakerUid: speaker.uid,
      title: 'Withdraw after archive',
      status: 'submitted',
    });
    await seedCfp(undefined, { archived: true });

    for (const [proposalId, response] of [
      ['p-confirm-archived', 'confirm'],
      ['p-decline-archived', 'decline'],
    ] as const) {
      expect(
        await callAs(speaker.idToken, 'respondToDecision', { proposalId, response }),
      ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    }
    expect(
      await callAs(speaker.idToken, 'withdrawProposal', {
        proposalId: 'p-withdraw-archived',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await statusOf('p-confirm-archived')).toBe('accepted');
    expect(await statusOf('p-decline-archived')).toBe('accepted');
    expect(await statusOf('p-withdraw-archived')).toBe('submitted');

    // The same identities and statuses work as soon as the CFP is active,
    // proving the refusal is the archive boundary rather than a broken seed.
    await seedCfp(undefined, { archived: false });
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-confirm-archived',
        response: 'confirm',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-decline-archived',
        response: 'decline',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await callAs(speaker.idToken, 'withdrawProposal', {
        proposalId: 'p-withdraw-archived',
      }),
    ).toMatchObject({ ok: true });
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

  /*
   * The dictionary went a type behind `FIELD_TYPES` and nothing caught it: the
   * labels were cast to `Record<string, string>`, so the missing one type-checked
   * and rendered as a nameless row in the dropdown. An organiser looking for
   * "Photo" could not find it, and the one field type that needed explaining
   * was the one with no name.
   */
  test('every answer type is offered by name', async ({ page }) => {
    await accepted();
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);

    await signInAs(page, ADMIN, at('/admin/confirmation'));
    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Confirmation questions' }),
    });
    await panel.getByRole('button', { name: 'Add a question' }).click();

    // The placeholder is deliberately blank and disabled; every real choice
    // has to be readable.
    const offered = await panel
      .getByLabel('Answer type')
      .locator('option:not([disabled])')
      .allTextContents();

    expect(offered).toHaveLength(FIELD_TYPES.length);
    expect(offered.filter((label) => !label.trim())).toEqual([]);
    expect(offered).toContain('Photo');
  });

  test('an admin writes a question and a speaker is asked it', async ({ page }) => {
    await accepted();
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);

    await signInAs(page, ADMIN, at('/admin/confirmation'));
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

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/Which hotel/).fill('The one by the station.');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    expect((await readProposalById('p-q'))?.confirmAnswers).toEqual({
      which_hotel_are_you_at: 'The one by the station.',
    });
  });

  test('changing admin tabs does not discard unsaved confirmation questions', async ({ page }) => {
    await accepted();
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);
    await signInAs(page, ADMIN, at('/admin/confirmation'));

    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Confirmation questions' }),
    });
    await panel.getByRole('button', { name: 'Add a question' }).click();
    await panel.getByLabel('Question (English)').fill('Which hotel are you at?');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Proposals', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/confirmation$'));
    await expect(panel.getByLabel('Question (English)')).toHaveValue('Which hotel are you at?');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Proposals', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/proposals$'));
  });

  test('an organiser still sees an answer after its question is retired', async ({ page }) => {
    const speaker = await accepted();
    await setConfirmFormDirect([DIET]);
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-q',
        response: 'confirm',
        answers: { diet: 'No shellfish.' },
      }),
    ).toMatchObject({ ok: true });

    // Retiring a question changes future forms. It must not erase the answer
    // already collected for programme operations.
    await setConfirmFormDirect([]);
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);
    await signInAs(page, ADMIN, at('/admin/proposals'));

    await expect(page.getByText('diet', { exact: true })).toBeVisible();
    await expect(page.getByText('No shellfish.', { exact: true })).toBeVisible();
  });
});

/**
 * The headshot question.
 *
 * A photo is the one answer the browser cannot be trusted to report: everything
 * else is a value the speaker types, but "there is a file" is a fact about the
 * bucket. So the claims here are that the callable looks rather than listens,
 * and that the object lands where the rules confine it.
 */
test.describe('a headshot question', () => {
  const PHOTO = {
    key: 'headshot',
    type: 'image',
    label: { en: 'A photo of you' },
    help: { en: 'Used on the programme.' },
    required: true,
  };
  const FIXTURE = 'tests/fixtures/headshot.png';

  async function accepted() {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-pic', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'accepted',
    });
    await setConfirmFormDirect([PHOTO]);
    return speaker;
  }

  test('a speaker uploads one and it is stored under their own uid', async ({ page }) => {
    const speaker = await accepted();

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel('A photo of you').setInputFiles(FIXTURE);
    await expect(page.getByRole('button', { name: 'Choose a different photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    // The path is derived from the uid, which is what makes it unclaimable, and
    // from the CFP, so two programmes can ask the same speaker for different
    // photographs and deleting one takes its objects with it.
    const path = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
    expect(await readStoredObjects(`cfps/${CFP_ID}/headshots/`)).toEqual([path]);
    expect((await readProposalById('p-pic'))?.confirmAnswers).toEqual({ headshot: path });
  });

  test('confirmation waits for a headshot upload already in flight', async ({ page }) => {
    await accepted();
    let releaseUpload!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route('**/v0/b/**', async (route) => {
      if (route.request().method() === 'POST') await held;
      await route.continue();
    });

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    const confirm = page.getByRole('button', { name: 'Confirm my talk' });

    try {
      await page.getByLabel('A photo of you').setInputFiles(FIXTURE);
      await expect(page.getByRole('button', { name: 'Uploading…' })).toBeVisible();
      await expect(confirm).toBeDisabled();
    } finally {
      releaseUpload();
    }

    await expect(page.getByRole('button', { name: 'Choose a different photo' })).toBeVisible();
    await expect(confirm).toBeEnabled();
  });

  test('a required photo blocks the confirmation until there is one', async ({ page }) => {
    await accepted();

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByText('This one is needed.')).toBeVisible();
    expect(await statusOf('p-pic')).toBe('accepted');
  });

  test('claiming a photo without uploading one gets you nowhere', async () => {
    const speaker = await accepted();

    // The browser could say anything here; the callable asks the bucket. Both
    // a plausible path of their own and somebody else's are ignored alike.
    for (const claimed of [
      `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`,
      `cfps/${CFP_ID}/headshots/someone-else/headshot`,
    ]) {
      expect(
        await callAs(speaker.idToken, 'respondToDecision', {
          proposalId: 'p-pic',
          response: 'confirm',
          answers: { headshot: claimed },
        }),
        claimed,
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    }
    expect(await statusOf('p-pic')).toBe('accepted');
    expect(await readStoredObjects('headshots/')).toEqual([]);
  });

  test('an organiser sees the photo, through a callable rather than an open bucket', async ({
    page,
  }) => {
    await accepted();
    await inviteRole(ADMIN.email, 'admin');
    await createAccount(ADMIN);

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel('A photo of you').setInputFiles(FIXTURE);
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    await signInAs(page, ADMIN, at('/admin/proposals'));
    const selected = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Selected speakers' }),
    });
    await selected.getByRole('button', { name: 'View photo' }).click();
    const photo = selected.locator('img.headshot__preview');
    await expect(photo).toBeVisible();

    // Inline, so no fetchable address for the photo was handed out along the
    // way — the bytes came back through the callable that checked the role.
    await expect(photo).toHaveAttribute('src', /^data:image\/png;base64,/);
  });

  test('nobody but an admin can read one back', async () => {
    const speaker = await accepted();
    await storeObjectDirect(`headshots/${speaker.uid}/headshot`, 'image/png');

    // Including the speaker whose photo it is: the callable is for organisers,
    // and the owner already has the bucket. Reviewers are refused too — this is
    // the only door to a headshot, so it is the only place the role is checked.
    await inviteRole(OTHER.email, 'reviewer');
    const reviewer = await createAccount(OTHER);
    await callAs(reviewer.idToken, 'claimRole', {});
    for (const who of [speaker, reviewer]) {
      expect(
        await callAs(who.idToken, 'headshotImage', { speakerUid: speaker.uid, key: 'headshot' }),
      ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
  });

  test('an object that is not an image is refused rather than served', async () => {
    const speaker = await accepted();
    await inviteRole(ADMIN.email, 'admin');
    const admin = await createAccount(ADMIN);
    await callAs(admin.idToken, 'claimRole', {});

    // `storage.rules` refuse this on the way in, so it takes going round them to
    // plant one. The callable checks anyway, because what it returns goes into
    // a `data:` URL an organiser's browser will act on.
    await storeObjectDirect(
      `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`,
      'text/html',
      '<script>',
    );
    expect(
      await callAs(admin.idToken, 'headshotImage', { speakerUid: speaker.uid, key: 'headshot' }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });
});
