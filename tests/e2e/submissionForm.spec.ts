/**
 * A call that asks something other than what DevFest asked.
 *
 * The claim worth proving is not that the dropdowns render — it is that the
 * stored config is the only thing the callable will accept. A speaker's browser
 * has a copy of the form too, and a browser is not where that decision can be
 * made.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  createAccount,
  readProposal,
  readProposalById,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  setSubmissionFormDirect,
} from './backend';
import { at, check, field, fillRequired, select, signInAs, waitForSave, type Identity } from './form';

const SPEAKER: Identity = { sub: 'speaker-sub', email: 'speaker@example.org', name: 'Sam' };
const ADMIN: Identity = { sub: 'admin-sub', email: 'ada@example.org', name: 'Ada' };
const REVIEWER: Identity = { sub: 'rev-sub', email: 'rev@example.org', name: 'Robin' };

/** Nothing like DevFest's: different codes, one language, one consent. */
const OWN_FORM = {
  category: [
    { value: 'ops', label: { en: 'Operations', fr: 'Exploitation' } },
    { value: 'data', label: { en: 'Data', fr: 'Données' } },
  ],
  format: [{ value: 'talk_30', label: { en: 'Talk — 30 minutes' } }],
  level: [{ value: 'any', label: { en: 'Anyone' } }],
  deliveryLanguage: [{ value: 'en', label: { en: 'English only' } }],
  acks: [
    {
      key: 'ownRules',
      type: 'checkbox',
      required: true,
      label: { en: 'I have read the house rules.' },
    },
  ],
  fields: [
    {
      key: 'repo',
      type: 'text',
      required: true,
      label: { en: 'Link to the code' },
      help: { en: 'Wherever the demo lives.' },
    },
  ],
};

/** Everything but the call's own question, filled in against `OWN_FORM`. */
async function fillOwnForm(page: Page) {
  await field(page, 'Title').fill('Running things at 3am');
  await field(page, 'Abstract').fill('a'.repeat(220));
  await select(page, 'Category').selectOption('ops');
  await select(page, 'Format').selectOption('talk_30');
  await select(page, 'Audience level').selectOption('any');
  await select(page, 'Which language').selectOption('en');
  await field(page, 'Name').fill('Sam');
  await field(page, 'Bio').fill('b'.repeat(120));
  await field(page, 'Based in').fill('Montréal, QC');
  await check(page, 'house rules').check();
  await page.getByRole('radio', { name: /no travel required/ }).check();
}

test.describe('a call that asks its own questions', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('renders the stored taxonomy, consents and questions', async ({ page }) => {
    await setSubmissionFormDirect(OWN_FORM);
    await createAccount(SPEAKER);
    await signInAs(page, SPEAKER);

    await expect(select(page, 'Category')).toContainText('Operations');
    await expect(select(page, 'Category')).not.toContainText('App Dev');
    await expect(select(page, 'Audience level')).toContainText('Anyone');

    // One consent, and DevFest's three went with it.
    await expect(check(page, 'house rules')).toBeVisible();
    await expect(page.getByText('travel and accommodation are not covered')).toHaveCount(0);

    await expect(field(page, 'Link to the code')).toBeVisible();
  });

  test('a whole submission goes through against that form', async ({ page }) => {
    await setSubmissionFormDirect(OWN_FORM);
    await createAccount(SPEAKER);
    await signInAs(page, SPEAKER);

    await fillOwnForm(page);
    await field(page, 'Link to the code').fill('https://example.org/demo');
    await waitForSave(page);

    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();

    const stored = await readProposal();
    expect(stored?.category).toBe('ops');
    expect(stored?.acks).toEqual({ ownRules: true });
    expect(stored?.answers).toEqual({ repo: 'https://example.org/demo' });
  });

  test('a required question of the call’s own blocks the submit', async ({ page }) => {
    await setSubmissionFormDirect(OWN_FORM);
    await createAccount(SPEAKER);
    await signInAs(page, SPEAKER);

    // "Link to the code" left empty. The zod schema knows nothing about it —
    // it is the confirmation form's validator that has to catch this.
    await fillOwnForm(page);
    await waitForSave(page);

    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toHaveCount(0);
    await expect(page.locator('.field--error')).toHaveCount(1);
  });

  test('the callable refuses a category this call does not offer', async () => {
    // The browser would not let this happen; a signed-in speaker with a fetch
    // call would. The draft write itself is allowed — the rules do not read the
    // form — so the submit is where it has to be caught.
    //
    // Only the taxonomy is overridden here, so DevFest's consents still apply
    // and the seeded proposal satisfies them. A refusal can therefore only be
    // about the category.
    await setSubmissionFormDirect({ category: OWN_FORM.category });
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });
    await seedProposal('p-wrong', {
      speakerUid: speaker.uid,
      title: 'Wrong category',
      status: 'draft',
      category: 'ai_ml',
    });

    const refused = await callAs(speaker.idToken, 'submitProposal', { proposalId: 'p-wrong' });
    expect(refused.ok).toBe(false);
    expect((await readProposalById('p-wrong'))?.status).toBe('draft');

    // The same proposal with a category this call does offer goes straight in,
    // which is what makes the refusal above about the value rather than about
    // the seed being malformed some other way.
    await seedProposal('p-right', {
      speakerUid: speaker.uid,
      title: 'Right category',
      status: 'draft',
      category: 'ops',
    });
    const accepted = await callAs(speaker.idToken, 'submitProposal', { proposalId: 'p-right' });
    expect(accepted.ok).toBe(true);
  });

  test('a call with no config at all still asks what it always asked', async ({ page }) => {
    // Every CFP that existed before the form became configurable is in this
    // state, with live proposals under it.
    await createAccount(SPEAKER);
    await signInAs(page, SPEAKER);

    await expect(select(page, 'Category')).toContainText('App Dev');
    await expect(check(page, 'Code of Conduct')).toBeVisible();

    await fillRequired(page);
    await waitForSave(page);
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  });
});

test.describe('the admin editor', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('an admin rewords a choice and the form shows the new label', async ({ page }) => {
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
    await signInAs(page, ADMIN, at('/admin/submission'));

    const categories = page.locator('fieldset').filter({ hasText: 'Categories' });
    await categories.getByRole('textbox', { name: 'Label (English)' }).first().fill('Building apps');
    await page.getByRole('button', { name: 'Save the form' }).click();
    await expect(page.getByText('Submission form saved.')).toBeVisible();

    // The stored code is untouched, so the talks already filed under it stay
    // filed under it — only the wording moved.
    await expect(categories.getByText('Stored as “app_dev”.')).toBeVisible();

    await page.goto(at());
    await expect(select(page, 'Category')).toContainText('Building apps');
  });

  test('an empty list is refused before it reaches the callable', async ({ page }) => {
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
    await signInAs(page, ADMIN, at('/admin/submission'));

    const formats = page.locator('fieldset').filter({ hasText: 'Formats' });
    page.on('dialog', (dialog) => void dialog.accept());
    await expect(formats.getByRole('button', { name: 'Remove' })).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await formats.getByRole('button', { name: 'Remove' }).first().click();
    }

    await page.getByRole('button', { name: 'Save the form' }).click();
    await expect(page.getByRole('alert')).toContainText('Formats has no choices');
  });

  test('a reviewer cannot change the form', async () => {
    const reviewer = await createAccount(REVIEWER);
    await seedMember(reviewer.uid, 'reviewer', CFP_ID, REVIEWER.email);

    const refused = await callAs(reviewer.idToken, 'setSubmissionForm', {
      category: [{ value: 'ops', label: { en: 'Operations' } }],
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('PERMISSION_DENIED');
  });
});
