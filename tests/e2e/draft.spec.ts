import { expect, test } from '@playwright/test';
import { readProposal, reset } from './backend';
import { check, field, fillRequired, select, signIn, waitForSave, COMPLETE } from './form';

test.beforeEach(async () => {
  await reset();
});

test('a draft survives a reload', async ({ page }) => {
  await signIn(page);
  await field(page, 'Title').fill(COMPLETE.title);
  await field(page, 'Abstract').fill(COMPLETE.abstract);
  await waitForSave(page);

  await page.reload();
  await expect(field(page, 'Title')).toHaveValue(COMPLETE.title);
  await expect(field(page, 'Abstract')).toHaveValue(COMPLETE.abstract);
});

test('clearing an optional field actually clears it', async ({ page }) => {
  // `{merge: true}` ignores absent keys, so an emptied field used to save and
  // then reappear on reload. This is the regression test for that.
  await signIn(page);
  await field(page, 'Title').fill(COMPLETE.title);
  await field(page, 'Pitch').fill('Committee-only context.');
  await waitForSave(page);

  await field(page, 'Pitch').fill('');
  await waitForSave(page);

  expect((await readProposal())?.pitch).toBeUndefined();
  await page.reload();
  await expect(field(page, 'Pitch')).toHaveValue('');
});

test('email comes from the account and cannot be edited', async ({ page }) => {
  await signIn(page);
  const email = field(page, 'Email');
  await expect(email).toHaveValue('test.speaker@example.org');
  await expect(email).toBeDisabled();
});

test.describe('conditional fields', () => {
  test('funding appears for pending, with a decision date', async ({ page }) => {
    await signIn(page);
    await expect(field(page, 'Where is the funding')).toHaveCount(0);

    await page.getByRole('radio', { name: /isn't confirmed yet/ }).check();
    await expect(field(page, 'Where is the funding')).toBeVisible();
    await expect(page.getByLabel(/When do you expect to know/)).toBeVisible();
  });

  test('secured asks where the money is from, but not when', async ({ page }) => {
    await signIn(page);
    await page.getByRole('radio', { name: /already covered/ }).check();
    await expect(field(page, 'Where is the funding')).toBeVisible();
    await expect(page.getByLabel(/When do you expect to know/)).toHaveCount(0);
  });

  test('switching back to local clears the funding it collected', async ({ page }) => {
    // A stranded fundingSource is rejected by the schema, with no visible field
    // left on screen to point the error at.
    await signIn(page);
    await page.getByRole('radio', { name: /isn't confirmed yet/ }).check();
    await field(page, 'Where is the funding').fill('Employer conference budget');
    await waitForSave(page);

    await page.getByRole('radio', { name: /no travel required/ }).check();
    await waitForSave(page);

    const attendance = (await readProposal())?.attendance;
    expect(attendance.status).toBe('local');
    expect(attendance.fundingSource).toBeUndefined();
    expect(attendance.decisionBy).toBeUndefined();
  });

  test('language preference only exists for "either"', async ({ page }) => {
    await signIn(page);
    await select(page, 'Which language').selectOption('either');
    await expect(field(page, 'Do you have a preference')).toBeVisible();

    await select(page, 'Which language').selectOption('en');
    await expect(field(page, 'Do you have a preference')).toHaveCount(0);
  });

  test('bilingual warns that the session will be labelled as such', async ({ page }) => {
    await signIn(page);
    await select(page, 'Which language').selectOption('bilingual');
    await expect(page.getByText(/label this session as bilingual/)).toBeVisible();
  });

  test('GDE guidance appears only for GDEs', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/GDE program manager/)).toHaveCount(0);
    await check(page, 'Google Developer Expert').check();
    await expect(page.getByText(/GDE program manager/)).toBeVisible();
  });

  test('visa guidance appears only when a visa is needed', async ({ page }) => {
    await signIn(page);
    await check(page, 'visa or eTA').check();
    await expect(page.getByText(/invitation letter/)).toBeVisible();
  });
});

test('the draft that reaches Firestore is the one that was typed', async ({ page }) => {
  await signIn(page);
  await fillRequired(page);
  await waitForSave(page);

  const proposal = await readProposal();
  expect(proposal).toMatchObject({
    title: COMPLETE.title,
    category: 'ai_ml',
    format: 'session_40',
    level: 'intermediate',
    deliveryLanguage: 'en',
    status: 'draft',
    acks: { noTravelSupport: true, coc: true, recording: true },
  });
  // The uid is the emulator's own, not the `sub` we minted — what matters is
  // that exactly one owner is recorded, since the rules key ownership off it.
  expect(proposal?.speakerIds).toHaveLength(1);
});
