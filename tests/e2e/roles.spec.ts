import { expect, test, type Page } from '@playwright/test';

import {
  callAs,
  clearProposals,
  createAccount,
  inviteRole,
  readProposals,
  readReviews,
  reset,
  seedProposal,
  seedSpeaker,
  seedSubmittedProposal,
  setProposalStatusDirect,
  setReviewsVisible,
} from './backend';
import { at, signInAs, type Identity } from './form';
import { LIMITS } from '@shared/enums';

const ADMIN: Identity = { sub: 'admin-sub', email: 'admin@example.org', name: 'Ada' };
const REVIEWER: Identity = { sub: 'reviewer-sub', email: 'reviewer@example.org', name: 'Rey' };
const SPEAKER: Identity = { sub: 'speaker-sub', email: 'speaker@example.org', name: 'Sam' };

const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** The label on each admin sub-tab, so a test can say where it means to land. */
const SECTIONS = {
  proposals: 'Proposals',
  committee: 'Committee',
  settings: 'Settings',
  confirmation: 'Confirmation',
  email: 'Email',
} as const;

/**
 * The first admin, the way `scripts/grant-role.mjs` makes one.
 *
 * The section is named rather than left to the default, and waited for: the
 * admin screen is five tabs, so "the page loaded" and "the part I am about to
 * assert on is mounted" are no longer the same statement.
 */
async function asAdmin(page: Page, section: keyof typeof SECTIONS = 'committee') {
  await inviteRole(ADMIN.email, 'admin');
  await signInAs(page, ADMIN, at(`/admin/${section}`));
  await expect(tab(page, SECTIONS[section])).toHaveAttribute('aria-current', 'page');
}

test.describe('roles', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('a speaker sees no committee tabs and cannot open the admin page', async ({ page }) => {
    await signInAs(page, SPEAKER, at('/admin'));
    await expect(page.getByText('That page is not available to your account.')).toBeVisible();
    await expect(tab(page, 'Admin')).toHaveCount(0);
    await expect(tab(page, 'Review')).toHaveCount(0);
  });

  test('the bootstrap grant becomes a role on first sign-in', async ({ page }) => {
    await asAdmin(page);
    await expect(page.getByText('Ada')).toBeVisible();
    await expect(tab(page, 'Admin')).toBeVisible();
  });

  test('an invited reviewer picks up the role on first sign-in', async ({ page }) => {
    await asAdmin(page);

    await page.getByRole('textbox', { name: /^Email address/ }).fill(REVIEWER.email);
    await page.getByRole('combobox', { name: /^Role/ }).selectOption('reviewer');
    await page.getByRole('button', { name: 'Invite' }).click();

    // Nobody with that address exists yet, so the grant has to wait for them.
    await expect(
      page.getByText(`${REVIEWER.email} will hold that role once they sign in.`),
    ).toBeVisible();
    await expect(page.getByText('Invited — has not signed in yet')).toBeVisible();

    await signInAs(page, REVIEWER, at('/review'));
    await expect(tab(page, 'Review')).toBeVisible();
    // A reviewer is not an admin.
    await expect(tab(page, 'Admin')).toHaveCount(0);
  });

  test('an admin cannot revoke the last admin', async ({ page }) => {
    await asAdmin(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Revoke' }).click();

    await expect(page.getByText(/only admin left/)).toBeVisible();
    await expect(page.getByText('Ada')).toBeVisible();
  });

  test('deciding a proposal is refused to everyone but an admin', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    const reviewer = await createAccount(REVIEWER);
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });
    await inviteRole(REVIEWER.email, 'reviewer');
    // Claims the grant, so the reviewer really does hold a role by now.
    await signInAs(page, REVIEWER, at('/review'));
    await expect(page.getByRole('heading', { name: 'Sam on shipping' })).toBeVisible();

    const decide = { proposalId: 'p-sam', status: 'accepted' };
    expect(await callAs(speaker.idToken, 'setProposalStatus', decide)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    // Holding a role is not the same as being allowed to decide.
    expect(await callAs(reviewer.idToken, 'setProposalStatus', decide)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  test('an admin cannot decide a draft or a withdrawn talk', async ({ page }) => {
    await asAdmin(page);
    const admin = await createAccount(ADMIN);
    const speaker = await createAccount(SPEAKER);
    await seedProposal('p-draft', { speakerUid: speaker.uid, title: 'Not ready', status: 'draft' });
    await seedProposal('p-gone', { speakerUid: speaker.uid, title: 'Gone', status: 'withdrawn' });

    for (const id of ['p-draft', 'p-gone']) {
      expect(
        await callAs(admin.idToken, 'setProposalStatus', { proposalId: id, status: 'accepted' }),
      ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    }
  });

  test('a status outside the committee’s vocabulary is refused', async ({ page }) => {
    await asAdmin(page);
    const admin = await createAccount(ADMIN);
    const speaker = await createAccount(SPEAKER);
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });

    // `submitted` and `withdrawn` belong to the applicant's flow, not this one.
    for (const status of ['submitted', 'withdrawn', 'nonsense']) {
      expect(
        await callAs(admin.idToken, 'setProposalStatus', { proposalId: 'p-sam', status }),
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    }

    // ...and one that works, so the refusals above are not just a bad request.
    expect(
      await callAs(admin.idToken, 'setProposalStatus', {
        proposalId: 'p-sam',
        status: 'accepted',
      }),
    ).toMatchObject({ ok: true });
  });

  test('a fourth submitted talk is refused by the server', async () => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    for (let i = 0; i < LIMITS.maxTalksPerSpeaker; i++) {
      await seedSubmittedProposal(`p-${i}`, { speakerUid: speaker.uid, title: `Talk ${i}` });
    }
    await seedProposal('p-extra', {
      speakerUid: speaker.uid,
      title: 'One too many',
      status: 'draft',
    });

    expect(
      await callAs(speaker.idToken, 'submitProposal', { proposalId: 'p-extra' }),
    ).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });

    // Drafts themselves are uncapped — only what reaches the committee is.
    expect((await readProposals()).filter((p) => p.status === 'draft')).toHaveLength(1);
  });

  test('a speaker can still see and edit a submitted talk, then loses the content', async ({
    page,
  }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });
    await signInAs(page, SPEAKER);

    // The talk is on screen, not replaced by a dead-end panel.
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveValue('Sam on shipping');
    await expect(page.getByText('The committee has not started reading yet.')).toBeVisible();

    // ...and still editable, because submitting is not what closes it.
    await page.getByRole('textbox', { name: /^Title/ }).fill('Sam on shipping, revised');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.actions__status')).toHaveText(/Draft saved/);
    expect((await readProposals())[0].title).toBe('Sam on shipping, revised');

    // Once it is being read, the content locks but the travel answers do not.
    await setProposalStatusDirect('p-sam', 'under_review');
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: /^Bio/ })).toBeEnabled();
    await expect(page.getByRole('radio', { name: /no travel required/ })).toBeEnabled();
    await expect(page.getByText(/talk itself is locked now/)).toBeVisible();
  });

  test('a locked talk still saves a profile and travel edit', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedProposal('p-sam', {
      speakerUid: speaker.uid,
      title: 'Sam on shipping',
      status: 'under_review',
    });
    await signInAs(page, SPEAKER);
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeDisabled();

    await page.getByRole('textbox', { name: /^Company/ }).fill('New Employer');
    await page.getByRole('checkbox', { name: /visa or eTA/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.actions__status')).toHaveText(/Draft saved/);

    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Company/ })).toHaveValue('New Employer');
    await expect(page.getByRole('checkbox', { name: /visa or eTA/ })).toBeChecked();
  });

  test('the window controls reach the form', async ({ page }) => {
    await asAdmin(page, 'settings');

    await page.getByRole('checkbox', { name: /Pause submissions/ }).check();
    await page.getByRole('button', { name: 'Save window' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto(`/${at()}`);
    await expect(page.getByText(/paused/)).toBeVisible();
  });
});

test.describe('reviewing', () => {
  let reviewerUid: string;

  test.beforeEach(async ({ page }) => {
    await reset();
    reviewerUid = (await createAccount(REVIEWER)).uid;
    const speaker = await createAccount(SPEAKER);
    await inviteRole(REVIEWER.email, 'reviewer');
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });
    await signInAs(page, REVIEWER, at('/review'));
  });

  test('scores a proposal and keeps the score across a reload', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sam on shipping' })).toBeVisible();
    await expect(page.getByText('0 of 1 scored')).toBeVisible();

    // Scoring saves on its own; Save is for coming back to add a note to a
    // talk you have already scored.
    await page.getByRole('button', { name: '3 — Yes' }).click();
    await expect(page.getByText('1 of 1 scored')).toBeVisible();

    await page
      .getByRole('textbox', { name: /^Notes for the committee/ })
      .fill('Solid, wants a tighter close.');
    await page.getByRole('button', { name: 'Save review' }).click();
    // Waiting on "Saved" would prove nothing — the score already put it there.
    await expect
      .poll(async () => (await readReviews('p-sam'))[0]?.comment)
      .toBe('Solid, wants a tighter close.');

    await page.reload();
    await expect(page.getByText('1 of 1 scored')).toBeVisible();
    await expect(page.getByRole('button', { name: '3 — Yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('textbox', { name: /^Notes for the committee/ })).toHaveValue(
      'Solid, wants a tighter close.',
    );
  });

  // Review is not blind (§7), and the committee is judging whether this person
  // can deliver this talk. The bio in particular: the schema says it feeds
  // review, and for a long time the card was the one place that never showed it.
  test('the card carries the speaker behind the talk, not just their name', async ({ page }) => {
    const speaker = await createAccount({ ...SPEAKER, sub: 'ctx-sub', email: 'ctx@example.org' });
    // On the proposal, not on `speakers/{uid}`: the profile is global and a role
    // is per CFP, so what the committee reads is the copy frozen at submission.
    await seedSubmittedProposal('p-ctx', {
      speakerUid: speaker.uid,
      title: 'Sam on inference',
      speaker: {
        name: 'Sam Rivera',
        bio: 'Fifteen years of shipping mobile, mostly the parts that go wrong.',
        company: 'Acme',
        jobTitle: 'Staff Engineer',
        isGde: true,
        pastTalks: 'DroidCon 2023 — recording linked',
      },
    });
    await page.reload();

    const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Sam on inference' }) });
    await expect(card.getByText('Fifteen years of shipping mobile')).toBeVisible();
    await expect(card.getByText('Staff Engineer, Acme')).toBeVisible();
    await expect(card.getByText('DroidCon 2023')).toBeVisible();
    await expect(card.getByText('GDE', { exact: true })).toBeVisible();
  });

  test('a reviewer never sees their own proposal in the queue', async ({ page }) => {
    await seedSubmittedProposal('p-rey', { speakerUid: reviewerUid, title: 'Rey on reviewing' });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Sam on shipping' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rey on reviewing' })).toHaveCount(0);
  });

  test('an empty queue says whether it is empty because the only talk is yours', async ({
    page,
  }) => {
    await clearProposals();
    await page.reload();
    await expect(page.getByText('no talks have been submitted')).toBeVisible();

    await seedSubmittedProposal('p-rey', { speakerUid: reviewerUid, title: 'Rey on reviewing' });
    await page.reload();
    await expect(page.getByText('cannot score your own talk')).toBeVisible();
  });

  test('other scores stay hidden until an admin opens the round', async ({ page }) => {
    await page.getByRole('button', { name: '4 — Strong yes' }).click();
    await expect(page.getByText('1 of 1 scored')).toBeVisible();

    await expect(page.getByText(/scores stay hidden/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Committee scores' })).toHaveCount(0);

    await setReviewsVisible(true);
    await page.reload();

    await expect(page.getByText(/scores stay hidden/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Committee scores' })).toBeVisible();
  });
});
