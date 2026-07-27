/**
 * The speaker's answer to an acceptance.
 *
 * Guards go through `callAs` rather than the UI: "the button is not rendered"
 * is not the claim worth proving — `status` is function-written only, so the
 * callable is the enforcement point and the thing an attacker would reach for.
 */

import { expect, test } from '@playwright/test';

import { callAs, createAccount, readProposalById, reset, seedProposal, seedSpeaker } from './backend';
import { signInAs, type Identity } from './form';

const SPEAKER: Identity = { sub: 'speaker-sub', email: 'speaker@example.org', name: 'Sam' };
const OTHER: Identity = { sub: 'other-sub', email: 'other@example.org', name: 'Robin' };

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
