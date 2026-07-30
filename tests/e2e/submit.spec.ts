import { expect, test, type Page } from '@playwright/test';
import { readProposal, reset, setCfpWindow } from './backend';
import { COMPLETE, field, fillRequired, signIn, waitForSave, alerts } from './form';

test.beforeEach(async () => {
  await reset();
});

test.describe('validation', () => {
  test('an incomplete form is refused, and says which fields', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Submit proposal' }).click();

    await expect(page.getByText(/fields need attention/)).toBeVisible();
    await expect(page.locator('.field__error').first()).toHaveText('This one is required.');
    await expect(field(page, 'Title')).toBeFocused();
    expect((await readProposal())?.status).not.toBe('submitted');
  });

  test('a short abstract is reported as a length, not as "required"', async ({ page }) => {
    await signIn(page);
    await field(page, 'Abstract').fill('Too short to be a real abstract.');
    await page.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(page.getByText('At least 200 characters.')).toBeVisible();
  });

  test('errors are in the language the page is in', async ({ page }) => {
    // The gap this closes: zod speaks English, and a French applicant used to
    // read English errors on the fields they got wrong.
    await signIn(page);
    await page.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(page.getByText('This one is required.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Français' }).click();
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();
    await expect(page.getByText('This one is required.')).toHaveCount(0);
  });

  test('errors clear as they are fixed', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Submit proposal' }).click();
    const title = field(page, 'Title');
    await expect(title).toHaveAttribute('aria-invalid', 'true');

    await title.fill('A perfectly good title');
    await expect(title).toHaveAttribute('aria-invalid', 'false');
  });

  test('the acknowledgements are not optional', async ({ page }) => {
    await signIn(page);
    await fillRequired(page);
    await waitForSave(page);
    await page.getByRole('checkbox', { name: /Code of Conduct/ }).uncheck();
    await page.getByRole('button', { name: 'Submit proposal' }).click();

    await expect(page.getByText('You need to agree to this before submitting.')).toBeVisible();
    expect((await readProposal())?.status).toBe('draft');
  });
});

test.describe('submitting', () => {
  async function submit(page: Page) {
    await signIn(page);
    await fillRequired(page);
    await waitForSave(page);
    await page.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  }

  test('a complete proposal submits and stays on screen', async ({ page }) => {
    await submit(page);

    // The talk is still readable — a speaker who cannot re-read what they sent
    // has no way to check it went in.
    await expect(field(page, 'Title')).toHaveValue(COMPLETE.title);
    await expect(page.getByRole('button', { name: 'Submit proposal' })).toHaveCount(0);

    const proposal = await readProposal();
    expect(proposal?.status).toBe('submitted');
    expect(proposal?.submittedAt).toBeTruthy();
  });

  test('the submitted state survives a reload', async ({ page }) => {
    await submit(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
    await expect(field(page, 'Title')).toHaveValue(COMPLETE.title);
  });

  test('a submitted proposal can be withdrawn', async ({ page }) => {
    await submit(page);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Withdraw proposal' }).click();

    await expect(page.getByRole('heading', { name: 'Withdrawn' })).toBeVisible();
    expect((await readProposal())?.status).toBe('withdrawn');
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByText('Past talks (1)')).toBeVisible();

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const status = await page.locator('.submission-status').boundingBox();
      const workspace = await page.locator('.submission-workspace').boundingBox();
      expect(status).not.toBeNull();
      expect(workspace).not.toBeNull();
      const gap = workspace!.y - (status!.y + status!.height);
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThanOrEqual(28);
    }

    await page.reload();
    await expect(field(page, 'Title')).toHaveValue('');
    await page.getByText('Past talks (1)').click();
    await page.getByRole('button', { name: new RegExp(COMPLETE.title) }).click();
    await expect(page.getByRole('heading', { name: 'Withdrawn' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });

  test('a persisted draft can be deleted without deleting the speaker profile', async ({ page }) => {
    await signIn(page);
    await fillRequired(page);
    await waitForSave(page);

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete draft' }).click();
    expect(await readProposal()).not.toBeNull();

    // The delete confirmation promises to keep the global speaker profile.
    // Exercise the narrow race before its normal autosave has fired.
    await field(page, 'Company').fill('Just edited before deleting');
    await expect(page.locator('.actions__status')).toContainText('Changes not saved yet');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete draft' }).click();
    await expect(page.getByText('Draft deleted.')).toBeVisible();
    await expect.poll(readProposal).toBeNull();

    // A late autosave must not recreate the row, and the account-wide profile
    // remains available after the proposal itself is gone.
    await page.waitForTimeout(1_700);
    await page.reload();
    await expect.poll(readProposal).toBeNull();
    await expect(field(page, 'Title')).toHaveValue('');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(field(page, 'Name')).toHaveValue('Test Speaker');
    await expect(field(page, 'Company')).toHaveValue('Just edited before deleting');
    await expect(page.getByRole('button', { name: 'Delete draft' })).toHaveCount(0);
  });

  test('the deadline is enforced by the server, not the form', async ({ page }) => {
    // Fill the form while the window is open, then close it underneath the
    // browser. The client has no idea; the rules and the callable both re-check
    // against their own clock.
    await signIn(page);
    await fillRequired(page);
    await waitForSave(page);

    await setCfpWindow({ closesAt: new Date(Date.now() - 1000) });
    await page.getByRole('button', { name: 'Submit proposal' }).click();

    const banner = alerts(page).last();
    await expect(banner).toBeVisible();
    // Whatever it says, it must not be raw rule text — that used to read
    // "PERMISSION_DENIED: evaluation error at L103:24 …".
    await expect(banner).not.toContainText(/PERMISSION_DENIED|evaluation error|L\d+:\d+/);
    await expect(banner).toContainText(/can no longer be edited|closed/i);
    expect((await readProposal())?.status).toBe('draft');
  });
});
