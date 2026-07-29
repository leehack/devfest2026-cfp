import { expect, test } from '@playwright/test';
import { reset } from './backend';
import { field, signIn, waitForSave } from './form';

/**
 * These hit the real sessionize.com through the functions emulator, so they are
 * the only tests here that need the network. `E2E_SKIP_NETWORK=1` drops them.
 */
test.skip(!!process.env.E2E_SKIP_NETWORK, 'needs sessionize.com');

const PROFILE = 'https://sessionize.com/leehack';

/**
 * The import panel's own box. Scoped, because the profile section further down
 * the form now has a Sessionize field of its own — this one is the panel that
 * does the fetching.
 */
const importBox = (page: import('@playwright/test').Page) =>
  page.locator('.import').getByRole('textbox');

async function importProfile(page: import('@playwright/test').Page, url = PROFILE) {
  await importBox(page).fill(url);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.import__report')).toBeVisible({ timeout: 30_000 });
}

const talks = (page: import('@playwright/test').Page) => page.locator('.import__sessions li');

test.beforeEach(async ({ page }) => {
  await reset();
  await signIn(page);
});

test('the import leads the form', async ({ page }) => {
  // It fills fields in every section below it, so arriving after the talk has
  // been typed out by hand wastes the work it exists to save.
  const headings = await page.locator('form.form > section h2').allTextContents();
  expect(headings[0]).toBe('Have a Sessionize profile?');
});

test('a profile fills the speaker and lists the talks', async ({ page }) => {
  await importProfile(page);

  await expect(page.getByText(/Filled in:.*bio/)).toBeVisible();
  await expect(field(page, 'Bio')).not.toHaveValue('');
  await expect(field(page, 'Based in')).not.toHaveValue('');
  await expect(talks(page).first()).toBeVisible();
});

test('it does not overwrite what was already typed', async ({ page }) => {
  await field(page, 'Bio').fill('My own bio, written by me and nobody else.');
  await importProfile(page);

  await expect(field(page, 'Bio')).toHaveValue('My own bio, written by me and nobody else.');
  await expect(page.getByText(/Left alone because you had already filled it/)).toBeVisible();
});

test('picking a talk fills the title and abstract', async ({ page }) => {
  await importProfile(page);
  const first = talks(page).first();
  const title = (await first.locator('.import__session-title').textContent())!;

  await first.getByRole('button', { name: 'Use this one' }).click();
  await expect(field(page, 'Title')).toHaveValue(title);
  await expect(field(page, 'Abstract')).not.toHaveValue('');
});

test('switching talks replaces the previous one without asking', async ({ page }) => {
  await importProfile(page);
  await talks(page).nth(0).getByRole('button').click();

  const second = talks(page).nth(2);
  const title = (await second.locator('.import__session-title').textContent())!;

  // Any dialog here is a failure: this text is ours to replace.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await second.getByRole('button').click();
  await expect(field(page, 'Title')).toHaveValue(title);
  expect(dialogs).toEqual([]);
});

test.describe('picking a talk on a draft that already has one', () => {
  // Provenance dies with the page. After a reload the app cannot tell an
  // imported title from a typed one, so it asks instead of silently no-opping.

  test('asks first, and declining changes nothing', async ({ page }) => {
    await importProfile(page);
    await talks(page).nth(0).getByRole('button').click();
    await waitForSave(page);
    const kept = await field(page, 'Title').inputValue();

    await page.reload();
    await importProfile(page);

    page.once('dialog', (d) => {
      expect(d.message()).toContain('title');
      d.dismiss();
    });
    await talks(page).nth(2).getByRole('button').click();

    await expect(page.getByText(/Left your own text in place/)).toBeVisible();
    await expect(field(page, 'Title')).toHaveValue(kept);
  });

  test('accepting replaces it', async ({ page }) => {
    await importProfile(page);
    await talks(page).nth(0).getByRole('button').click();
    await waitForSave(page);

    await page.reload();
    await importProfile(page);
    const wanted = (await talks(page).nth(2).locator('.import__session-title').textContent())!;

    page.once('dialog', (d) => d.accept());
    await talks(page).nth(2).getByRole('button').click();

    await expect(field(page, 'Title')).toHaveValue(wanted);
  });
});

test('a talk link preselects that talk', async ({ page }) => {
  await importProfile(
    page,
    'https://sessionize.com/s/leehack/flight-mode-ai-building-local-llm-apps-easily-with/163127',
  );
  await expect(field(page, 'Title')).toHaveValue(/Flight Mode AI/);
  // 1,301 characters against our 1,200 cap — filled anyway, but flagged.
  await expect(page.getByText(/please trim it before submitting/)).toBeVisible();
});

test('a link that is not Sessionize is refused', async ({ page }) => {
  await importBox(page).fill('https://evil.example/x');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/That does not look like a Sessionize link/);
});

test('an unknown handle says so rather than failing silently', async ({ page }) => {
  await importBox(page)
    .fill('https://sessionize.com/no-such-speaker-xyzzy-9876');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/could not find a Sessionize profile/, {
    timeout: 30_000,
  });
});
