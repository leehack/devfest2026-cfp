import { expect, test } from '@playwright/test';
import {
  CFP_ID,
  createAccount,
  readProposal,
  readProposals,
  reset,
  seedCfp,
  seedProposal,
  seedSpeaker,
} from './backend';
import {
  at,
  check,
  field,
  fillRequired,
  select,
  signIn,
  signInAs,
  waitForSave,
  COMPLETE,
  type Identity,
} from './form';

const RETURNING: Identity = {
  sub: 'returning-speaker',
  email: 'returning@example.org',
  name: 'Returning Speaker',
};

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

test('switching CFPs keeps each proposal in its own form instance', async ({ page }) => {
  const secondCfp = 'second-call';
  await seedCfp(secondCfp, { name: 'Second Call' });
  const speaker = await createAccount(RETURNING);
  await seedSpeaker(speaker.uid, { name: RETURNING.name, email: RETURNING.email });

  await signInAs(page, RETURNING);
  await field(page, 'Title').fill('A proposal for Montréal');
  await page.evaluate((cfpId) => {
    window.history.pushState(null, '', `/c/${cfpId}/submit`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, secondCfp);

  await expect(page).toHaveURL(`/c/${secondCfp}/submit`);
  await expect(field(page, 'Title')).toHaveValue('');
  await field(page, 'Title').fill('A proposal for the second call');
  await waitForSave(page);

  await expect
    .poll(async () => (await readProposals(CFP_ID)).map((proposal) => proposal.title))
    .toEqual(['A proposal for Montréal']);
  expect((await readProposals(secondCfp)).map((proposal) => proposal.title)).toEqual([
    'A proposal for the second call',
  ]);
});

test('browser Back waits for a dirty draft to save before leaving', async ({ page }) => {
  await signInAs(page, RETURNING);
  // Put a same-document entry behind the form. That is the route transition
  // where `popstate` used to unmount the editor while its save ran in the
  // background; a full-document Back is separately guarded by beforeunload.
  await page.evaluate((formPath) => {
    window.history.replaceState(null, '', '/');
    window.history.pushState(null, '', formPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, at());

  let releaseWrite!: () => void;
  let markWriteStarted!: () => void;
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  let firstWrite = true;
  await page.route('**/google.firestore.v1.Firestore/Write/channel**', async (route) => {
    if (firstWrite) {
      firstWrite = false;
      markWriteStarted();
      await writeHeld;
    }
    await route.continue();
  });

  try {
    await field(page, 'Title').fill('Do not lose this draft');
    await page.evaluate(() => window.history.back());
    await writeStarted;

    // The address and the editable state stay put for the whole write, instead
    // of unmounting the form while a fire-and-forget save runs.
    await expect(page).toHaveURL(at());
    await expect(field(page, 'Title')).toHaveValue('Do not lose this draft');
    expect(await readProposals()).toEqual([]);
  } finally {
    releaseWrite();
  }

  await expect(page).toHaveURL('/');
  await expect
    .poll(async () => (await readProposals()).map((proposal) => proposal.title))
    .toEqual(['Do not lose this draft']);
});

test('switching talks keeps every saved talk field and the latest speaker profile', async ({
  page,
}) => {
  const secondTitle = 'What broke when we shipped it';
  const secondAbstract = `${COMPLETE.abstract} This version follows the production rollout.`;
  const saveState = page.locator('.actions__status');

  await signIn(page);
  await field(page, 'Title').fill(COMPLETE.title);
  await field(page, 'Abstract').fill(COMPLETE.abstract);
  await field(page, 'Company').fill('First employer');
  await expect(saveState).toContainText('Changes not saved yet');
  await waitForSave(page);

  await page.getByRole('button', { name: '+ Another talk', exact: true }).click();
  await field(page, 'Title').fill(secondTitle);
  await field(page, 'Abstract').fill(secondAbstract);
  await field(page, 'Company').fill('Current employer');
  await expect(saveState).toContainText('Changes not saved yet');
  await waitForSave(page);

  await page.getByRole('button', { name: COMPLETE.title, exact: true }).click();
  await expect(field(page, 'Title')).toHaveValue(COMPLETE.title);
  await expect(field(page, 'Abstract')).toHaveValue(COMPLETE.abstract);
  await expect(field(page, 'Company')).toHaveValue('Current employer');

  await page.getByRole('button', { name: secondTitle, exact: true }).click();
  await expect(field(page, 'Title')).toHaveValue(secondTitle);
  await expect(field(page, 'Abstract')).toHaveValue(secondAbstract);
  await expect(field(page, 'Company')).toHaveValue('Current employer');
});

test('historical outcomes do not consume the live-talk cap', async ({ page }) => {
  const speaker = await createAccount(RETURNING);
  await seedSpeaker(speaker.uid, { name: RETURNING.name, email: RETURNING.email });
  for (const [id, status] of [
    ['old-declined', 'declined'],
    ['old-rejected', 'rejected'],
    ['old-withdrawn', 'withdrawn'],
  ] as const) {
    await seedProposal(id, {
      speakerUid: speaker.uid,
      title: id,
      status,
    });
  }

  await signInAs(page, RETURNING);
  await expect(page.getByText('New talk', { exact: true })).toBeVisible();
  await expect(page.getByText('Past talks (3)', { exact: true })).toBeVisible();
  await expect(field(page, 'Title')).toBeEditable();
});

test('live talks are counted even when historical outcomes sort before them', async ({ page }) => {
  const speaker = await createAccount(RETURNING);
  await seedSpeaker(speaker.uid, { name: RETURNING.name, email: RETURNING.email });
  for (const [id, status] of [
    ['a-declined', 'declined'],
    ['b-rejected', 'rejected'],
    ['c-withdrawn', 'withdrawn'],
    ['d-rejected', 'rejected'],
    ['z-live-1', 'submitted'],
    ['z-live-2', 'under_review'],
    ['z-live-3', 'waitlisted'],
  ] as const) {
    await seedProposal(id, {
      speakerUid: speaker.uid,
      title: id,
      status,
    });
  }

  await signInAs(page, RETURNING);
  await expect(page.getByText('That is the maximum of 3.')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Another talk', exact: true })).toHaveCount(0);
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
