/**
 * The speaker's answer to an acceptance.
 *
 * Guards go through `callAs` rather than the UI: "the button is not rendered"
 * is not the claim worth proving — `status` is function-written only, so the
 * callable is the enforcement point and the thing an attacker would reach for.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  createUnverifiedAccount,
  readCfp,
  readProposalById,
  readProposalUpdateTime,
  reset,
  seedProposal,
  inviteRole,
  readStoredObjects,
  seedCfp,
  seedExternalMutationLease,
  seedMember,
  seedSpeaker,
  setCfpArchivedDirect,
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
    await expect(page.getByText(/organisers can plan a slot/)).toBeVisible();
    await expect(page.getByText(/published programme/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.locator('.speaker-photo').getByText('Optional', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm my talk' }).click();

    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
    await expect(
      page.getByText(/Schedule details will appear here after organisers share a confirmed preview/),
    ).toBeVisible();
    await expect(page.getByText(/published programme/)).toHaveCount(0);
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
    await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
    expect(await statusOf('p-change')).toBe('declined');

    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
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
    await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
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

  test('switching talks asks before discarding an unsubmitted confirmation answer', async ({
    page,
  }) => {
    const speaker = await accepted();
    await seedProposal('p-other', {
      speakerUid: speaker.uid,
      title: 'Another talk',
      status: 'submitted',
    });
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER, `${at()}?proposal=p-q`);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await page.getByLabel(/T-shirt size/).selectOption('L');

    const otherTalk = page.getByRole('button', {
      name: 'Another talk Submitted',
      exact: true,
    });
    page.once('dialog', (dialog) => dialog.dismiss());
    await otherTalk.click();
    await expect(page.getByLabel(/T-shirt size/)).toHaveValue('L');

    page.once('dialog', (dialog) => dialog.accept());
    await otherTalk.click();
    await expect(page.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
  });

  test('declining never asks them', async ({ page }) => {
    await accepted();
    await setConfirmFormDirect([SHIRT]);

    await signInAs(page, SPEAKER);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'I have to decline' }).click();

    await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
    expect(await statusOf('p-q')).toBe('declined');
    expect((await readProposalById('p-q'))?.confirmAnswers).toBeUndefined();
  });

  test('with no custom questions configured, confirmation still offers the optional programme photo', async ({
    page,
  }) => {
    await accepted();

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByRole('heading', { name: 'Speaker photo', exact: true })).toBeVisible();
    await expect(page.locator('.speaker-photo').getByText('Optional', { exact: true })).toBeVisible();
    expect(await statusOf('p-q')).toBe('accepted');
    await page.getByRole('button', { name: 'Confirm my talk' }).click();
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
    await expect(page.locator('.toast--success')).toContainText('Confirmation details saved.');
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
    await expect(
      panel.getByText('It is optional unless you require it below.', { exact: false }),
    ).toBeVisible();
    await expect(
      panel.getByRole('checkbox', {
        name: 'Require every speaker to have a profile photo before confirming',
      }),
    ).not.toBeChecked();
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
 * bucket. The verified upload callable owns the only write path and
 * confirmation follows the server-written current-object pointer rather than a
 * claim from the browser.
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
  const PNG_BYTES = readFileSync(FIXTURE);
  const PNG_BASE64 = PNG_BYTES.toString('base64');
  const WEBP_BYTES = Buffer.from(
    'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA',
    'base64',
  );
  const REPLACEMENT_WEBP_BYTES = Buffer.from(
    'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ0f/+ByKi/wEA',
    'base64',
  );
  const WEBP_BASE64 = WEBP_BYTES.toString('base64');

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

  test('a speaker uploads one and reloads its private preview', async ({ page }) => {
    await accepted();

    await signInAs(page, SPEAKER);
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    const input = page.getByLabel('A photo of you');
    await expect(input).toHaveAttribute('tabindex', '-1');
    await input.setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    const errorId = await input.getAttribute('aria-errormessage');
    expect(errorId).toBeTruthy();
    const headshot = input.locator('..');
    const describedBy = await headshot
      .getByRole('button', { name: 'Choose a photo' })
      .getAttribute('aria-describedby');
    expect(describedBy?.split(/\s+/)).toContain(errorId);
    await input.setInputFiles(FIXTURE);
    await expect(page.getByRole('button', { name: 'Choose a different photo' })).toBeVisible();

    // The proposal pointer, not an in-memory File, is the durable uploaded
    // state. Reloading reads preview bytes through the verified callable.
    await page.reload();
    await page.getByRole('button', { name: 'Yes, I can present' }).click();
    await expect(page.getByRole('button', { name: 'Choose a different photo' })).toBeVisible();
    await expect(page.locator('img.headshot__preview')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm my talk' }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();

    // The callable writes a unique object and atomically points this proposal
    // at it. Failed replacements therefore cannot damage an older upload.
    const proposal = await readProposalById('p-pic');
    const path = proposal?.headshotUploads?.headshot?.path;
    expect(path).toMatch(
      new RegExp(`^cfps/${CFP_ID}/workingHeadshots/p-pic/headshot/[^/]+$`),
    );
    const stored = await readStoredObjects(`cfps/${CFP_ID}/`);
    expect(stored).toContain(path);
    const frozen = stored.find((name) =>
      name.startsWith(`cfps/${CFP_ID}/confirmedHeadshots/p-pic/headshot/`),
    );
    expect(frozen).toBeTruthy();
    expect(proposal?.confirmAnswers).toEqual({ headshot: frozen });
  });

  test('the upload callable enforces identity, ownership, lifecycle, form and event fences', async () => {
    const speaker = await accepted();
    const other = await createAccount(OTHER);
    const unverified = await createUnverifiedAccount({ email: 'unverified-photo@example.org' });
    const payload = {
      proposalId: 'p-pic',
      key: 'headshot',
      contentType: 'image/png',
      base64: PNG_BASE64,
    };

    expect(await callAs(unverified.idToken, 'uploadHeadshot', payload)).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
    expect(await callAs(other.idToken, 'uploadHeadshot', payload)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await callAs(speaker.idToken, 'uploadHeadshot', { ...payload, key: 'retired-photo' }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });

    await seedProposal('p-rejected-photo', {
      speakerUid: speaker.uid,
      title: 'Rejected photo',
      status: 'rejected',
    });
    expect(
      await callAs(speaker.idToken, 'uploadHeadshot', {
        ...payload,
        proposalId: 'p-rejected-photo',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await setCfpArchivedDirect(true);
    expect(await callAs(speaker.idToken, 'uploadHeadshot', payload)).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
    await setCfpArchivedDirect(false);
    await seedExternalMutationLease(new Date(Date.now() + 60_000));
    expect(await callAs(speaker.idToken, 'uploadHeadshot', payload)).toMatchObject({
      ok: false,
      code: 'ABORTED',
    });
    expect(await readStoredObjects(`cfps/${CFP_ID}/workingHeadshots/`)).toEqual([]);
  });

  test('a declined speaker can upload before changing their answer back to confirmed', async () => {
    const speaker = await accepted();
    const other = await createAccount(OTHER);
    const unverified = await createUnverifiedAccount({ email: 'unverified-preview@example.org' });
    await seedProposal('p-pic', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'declined',
    });

    expect(
      await callAs(speaker.idToken, 'uploadHeadshot', {
        proposalId: 'p-pic',
        key: 'headshot',
        contentType: 'image/webp',
        base64: WEBP_BASE64,
      }),
    ).toMatchObject({ ok: true });
    const pointer = (await readProposalById('p-pic'))?.headshotUploads?.headshot?.path;
    expect(pointer).toMatch(
      new RegExp(`^cfps/${CFP_ID}/workingHeadshots/p-pic/headshot/[^/]+$`),
    );
    expect(await readStoredObjects(`cfps/${CFP_ID}/workingHeadshots/p-pic/`)).toEqual([
      pointer,
    ]);
    expect(
      await callJson(speaker.idToken, 'headshotImage', {
        proposalId: 'p-pic',
        key: 'headshot',
        working: true,
      }),
    ).toMatchObject({ ok: true, contentType: 'image/webp', base64: WEBP_BASE64 });
    expect(
      await callAs(other.idToken, 'headshotImage', {
        proposalId: 'p-pic',
        key: 'headshot',
        working: true,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(
      await callAs(unverified.idToken, 'headshotImage', {
        proposalId: 'p-pic',
        key: 'headshot',
        working: true,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('confirmation waits for a headshot upload already in flight', async ({ page }) => {
    await accepted();
    let releaseUpload!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route('**/uploadHeadshot', async (route) => {
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

  test('a confirmation racing a new required question validates the committed form', async () => {
    const speaker = await accepted();
    await storeObjectDirect(
      `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`,
      'image/png',
      PNG_BYTES,
    );

    const confirmation = callAs(speaker.idToken, 'respondToDecision', {
      proposalId: 'p-pic',
      response: 'confirm',
      answers: {},
    });
    const formUpdatedAt = await setConfirmFormDirect([
      PHOTO,
      {
        key: 'late_required',
        type: 'text',
        label: { en: 'A newly required answer' },
        required: true,
      },
    ]);

    const result = await confirmation;
    if (result.ok) {
      // A successful confirmation is valid only if its transaction committed
      // before the direct form edit. Edit-first must make the transaction retry
      // against the new required question and take the refusal branch below.
      const proposalUpdatedAt = await readProposalUpdateTime('p-pic');
      expect(Date.parse(proposalUpdatedAt!)).toBeLessThanOrEqual(Date.parse(formUpdatedAt));
      expect(await statusOf('p-pic')).toBe('confirmed');
    } else {
      expect(result).toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(await statusOf('p-pic')).toBe('accepted');
    }
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

  test('the confirmed-photo branch remains admin-only', async () => {
    const speaker = await accepted();

    // A speaker uses the explicit working branch for their own current upload.
    // The default branch is only for immutable confirmed answers and checks an
    // organiser role before it looks at any bucket path.
    await inviteRole(OTHER.email, 'reviewer');
    const reviewer = await createAccount(OTHER);
    await callAs(reviewer.idToken, 'claimRole', {});
    for (const who of [speaker, reviewer]) {
      expect(
        await callAs(who.idToken, 'headshotImage', { proposalId: 'p-pic', key: 'headshot' }),
      ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
  });

  test('the confirmed photo stays fixed when the working upload is replaced', async () => {
    const speaker = await accepted();
    const live = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
    await storeObjectDirect(live, 'image/webp', WEBP_BYTES);
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-pic',
        response: 'confirm',
        answers: {},
      }),
    ).toMatchObject({ ok: true });

    const owner = await createAccount(ADMIN);
    await seedMember(owner.uid, 'owner');
    await storeObjectDirect(live, 'image/webp', REPLACEMENT_WEBP_BYTES);
    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: true,
    });

    const result = await callJson(owner.idToken, 'headshotImage', {
      proposalId: 'p-pic',
      key: 'headshot',
    });
    expect(result.dataUrl).toBe(`data:image/webp;base64,${WEBP_BASE64}`);
  });

  test('archiving freezes a legacy live-path confirmation before it becomes read-only', async () => {
    const speaker = await accepted();
    const live = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
    await seedProposal('p-pic', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'confirmed',
      confirmAnswers: { headshot: live },
    });
    await storeObjectDirect(live, 'image/webp', WEBP_BYTES);
    const owner = await createAccount(ADMIN);
    await seedMember(owner.uid, 'owner');

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: true,
    });
    const frozen = (await readProposalById('p-pic'))?.confirmAnswers?.headshot;
    expect(frozen).toMatch(
      new RegExp(`^cfps/${CFP_ID}/confirmedHeadshots/p-pic/headshot/[^/]+$`),
    );

    await storeObjectDirect(live, 'image/webp', REPLACEMENT_WEBP_BYTES);
    const result = await callJson(owner.idToken, 'headshotImage', {
      proposalId: 'p-pic',
      key: 'headshot',
    });
    expect(result.dataUrl).toBe(`data:image/webp;base64,${WEBP_BASE64}`);
  });

  test('archive waits when a legacy confirmed photo cannot be secured', async () => {
    const speaker = await accepted();
    const live = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
    await seedProposal('p-pic', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'confirmed',
      confirmAnswers: { headshot: live },
    });
    const owner = await createAccount(ADMIN);
    await seedMember(owner.uid, 'owner');

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });

    // The failure left a retryable active CFP. Restoring the referenced image
    // lets the same archive operation complete and freezes it first.
    await storeObjectDirect(live, 'image/webp', WEBP_BYTES);
    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: true,
    });
  });

  test('a legacy photo read and CFP deletion cannot leave an orphan copy', async () => {
    const speaker = await accepted();
    const live = `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`;
    await seedProposal('p-pic', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'confirmed',
      confirmAnswers: { headshot: live },
    });
    await storeObjectDirect(live, 'image/webp', WEBP_BYTES);
    const owner = await createAccount(ADMIN);
    await seedMember(owner.uid, 'owner');
    // Models an event archived before immutable confirmation copies existed.
    await setCfpArchivedDirect(true);

    const [photo, deletion] = await Promise.all([
      callAs(owner.idToken, 'headshotImage', { proposalId: 'p-pic', key: 'headshot' }),
      callAs(owner.idToken, 'deleteCfp', { confirm: CFP_ID }),
    ]);

    if (deletion.ok) {
      expect(await readCfp()).toBeNull();
      expect(await readStoredObjects('cfps/')).toEqual([]);
    } else {
      expect(photo).toMatchObject({ ok: true });
      const frozen = (await readProposalById('p-pic'))?.confirmAnswers?.headshot;
      expect(frozen).toMatch(
        new RegExp(`^cfps/${CFP_ID}/confirmedHeadshots/p-pic/headshot/[^/]+$`),
      );
      expect(await readStoredObjects(`cfps/${CFP_ID}/confirmedHeadshots/`)).toContain(frozen);
    }
  });

  test('declared image bytes with the wrong signature cannot satisfy a required photo', async () => {
    const speaker = await accepted();

    // Pre-migration rows may still point at a canonical live object. It takes
    // going around the now-closed browser rules to plant one with a false MIME.
    await storeObjectDirect(
      `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`,
      'image/png',
      'not actually a PNG',
    );
    expect(
      await callAs(speaker.idToken, 'respondToDecision', {
        proposalId: 'p-pic',
        response: 'confirm',
        answers: {},
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await statusOf('p-pic')).toBe('accepted');
  });
});
