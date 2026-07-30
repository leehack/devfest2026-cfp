import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  clearProposals,
  createAccount,
  inviteRole,
  readProposals,
  readReviews,
  reset,
  seedMember,
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

const tab = (page: Page, name: string) =>
  page.locator('.nav, .subnav').getByRole('link', { name, exact: true });

/** One person's line on the committee list, found by whatever it calls them. */
const row = (page: Page, who: string) => page.locator('.people__row', { hasText: who });

/**
 * The invite form's Role select. Scoped rather than found by name: every row in
 * the list carries a role select of its own now, so "Role" is ambiguous.
 */
const inviteRoleField = (page: Page) => page.locator('.grid--2').getByRole('combobox');

/** The label on each admin sub-tab, so a test can say where it means to land. */
const SECTIONS = {
  proposals: 'Proposals',
  committee: 'Committee',
  settings: 'Event setup',
  confirmation: 'Confirmation form',
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
    await expect(tab(page, 'Manage event')).toHaveCount(0);
    await expect(tab(page, 'Review talks')).toHaveCount(0);
  });

  test('the bootstrap grant becomes a role on first sign-in', async ({ page }) => {
    await asAdmin(page);
    await expect(row(page, ADMIN.name)).toBeVisible();
    await expect(tab(page, 'Manage event')).toBeVisible();
  });

  test('an invited reviewer picks up the role on first sign-in', async ({ page }) => {
    await asAdmin(page);

    await page.getByRole('textbox', { name: /^Email address/ }).fill(REVIEWER.email);
    await inviteRoleField(page).selectOption('reviewer');
    await page.getByRole('button', { name: 'Invite' }).click();

    // Nobody with that address exists yet, so the grant has to wait for them.
    await expect(
      page.getByText(`${REVIEWER.email} will hold that role once they sign in.`),
    ).toBeVisible();
    await expect(page.getByText('Invited — has not signed in yet')).toBeVisible();

    await signInAs(page, REVIEWER, at('/review'));
    await expect(tab(page, 'Review talks')).toBeVisible();
    // A reviewer is not an admin.
    await expect(tab(page, 'Manage event')).toHaveCount(0);
  });

  test('an admin cannot revoke the last admin', async ({ page }) => {
    await asAdmin(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Revoke' }).click();

    await expect(page.getByText(/only admin left/)).toBeVisible();
    await expect(row(page, ADMIN.name)).toBeVisible();
  });

  test('an admin changes a member’s role from the list', async ({ page }) => {
    const reviewer = await createAccount(REVIEWER);
    await seedMember(reviewer.uid, 'reviewer', CFP_ID, REVIEWER.email);
    await asAdmin(page);

    const rey = row(page, REVIEWER.email).getByRole('combobox');
    await expect(rey).toHaveValue('reviewer');
    await rey.selectOption('admin');
    await expect(page.getByText(`${REVIEWER.email} now holds that role.`)).toBeVisible();

    // Reloaded, because the point is the member document and not the select.
    await page.reload();
    await expect(row(page, REVIEWER.email).getByRole('combobox')).toHaveValue('admin');
    await signInAs(page, REVIEWER, at('/admin/committee'));
    await expect(tab(page, 'Manage event')).toBeVisible();
  });

  test('the last admin cannot demote themselves', async ({ page }) => {
    await asAdmin(page);
    await row(page, 'Ada').getByRole('combobox').selectOption('reviewer');

    await expect(page.getByText(/only admin left/)).toBeVisible();
    // The refusal has to reach the control as well — a select left showing
    // "Reviewer" says the change went through.
    await expect(row(page, 'Ada').getByRole('combobox')).toHaveValue('admin');
    await expect(tab(page, 'Manage event')).toBeVisible();
  });

  test('the owner’s row offers neither control, and the callable refuses both', async ({ page }) => {
    const owner = await createAccount({ sub: 'owner-sub', email: 'owner@example.org', name: 'Ozzy' });
    await seedMember(owner.uid, 'owner', CFP_ID, 'owner@example.org');
    await asAdmin(page);

    const theirs = row(page, 'owner@example.org');
    await expect(theirs.getByText('Owner', { exact: true })).toBeVisible();
    await expect(theirs.getByRole('combobox')).toHaveCount(0);
    await expect(theirs.getByRole('button', { name: 'Revoke' })).toHaveCount(0);

    // Hiding the controls is a courtesy; the refusal is the rule.
    const admin = await createAccount(ADMIN);
    for (const [fn, args] of [
      ['grantRole', { email: 'owner@example.org', role: 'reviewer' }],
      ['revokeRole', { email: 'owner@example.org' }],
    ] as const) {
      expect(await callAs(admin.idToken, fn, args)).toMatchObject({
        ok: false,
        code: 'FAILED_PRECONDITION',
      });
    }
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

  test('an admin can restore a decision to submitted', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });
    await asAdmin(page, 'proposals');

    const status = () => page.getByLabel('Status: Sam on shipping');
    await status().selectOption('accepted');
    await expect
      .poll(
        async () =>
          (await readProposals()).find((proposal) => proposal.title === 'Sam on shipping')?.status,
      )
      .toBe('accepted');

    // Immediate Undo is still available, but recovery cannot depend on the
    // current render surviving: an organiser notices mistakes after reloads
    // and on another device too.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.reload();
    await status().selectOption('submitted');
    await expect
      .poll(
        async () =>
          (await readProposals()).find((proposal) => proposal.title === 'Sam on shipping')?.status,
      )
      .toBe('submitted');
  });

  test('withdrawn talks are hidden by default and never keep a score', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSubmittedProposal('p-current', {
      speakerUid: speaker.uid,
      title: 'Current talk',
    });
    await seedProposal('p-withdrawn', {
      speakerUid: speaker.uid,
      title: 'Withdrawn talk',
      status: 'withdrawn',
      aggregate: {
        avgScore: 4,
        normalizedScore: 4,
        reviewCount: 2,
        stdDev: 0,
      },
    });

    await expect
      .poll(async () => {
        const withdrawn = (await readProposals()).find((row) => row.title === 'Withdrawn talk');
        return withdrawn ? 'aggregate' in withdrawn : null;
      })
      .toBe(false);

    await asAdmin(page, 'proposals');
    const proposals = page.locator('.decision-panel', {
      has: page.getByRole('heading', { name: 'Proposal decisions' }),
    });
    await expect(proposals.getByText('Current talk')).toBeVisible();
    await expect(proposals.getByText('Withdrawn talk')).toHaveCount(0);
    await expect(proposals.getByText('1 of 2 proposals')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recompute scores' })).toHaveCount(0);

    await proposals
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption('withdrawn');
    await expect(proposals.getByText('Withdrawn talk')).toBeVisible();
    await expect(proposals.getByText('Current talk')).toHaveCount(0);
    await expect(proposals.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  });

  test('the proposal workspace stays usable across screen sizes', async ({ page }) => {
    const title =
      'A deliberately long proposal title that still keeps every committee control on screen';
    const speaker = await createAccount(SPEAKER);
    await seedSubmittedProposal('p-responsive', { speakerUid: speaker.uid, title });
    await asAdmin(page, 'proposals');
    await expect(page.getByText('1 of 1 proposals')).toBeVisible();

    for (const width of [390, 700, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbar = page.locator('.decision-toolbar');
      await expect(toolbar.getByRole('searchbox', { name: 'Search', exact: true })).toBeVisible();
      for (const name of ['Status', 'Category', 'Talk score status', 'Sort by']) {
        await expect(toolbar.getByRole('combobox', { name, exact: true })).toBeVisible();
      }

      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
        const filters = [...document.querySelectorAll<HTMLElement>('.decision-filter')].map(
          (filter) => filter.getBoundingClientRect(),
        );
        const overlaps = filters.some((current, index) =>
          filters.slice(index + 1).some(
            (other) =>
              current.left < other.right &&
              current.right > other.left &&
              current.top < other.bottom &&
              current.bottom > other.top,
          ),
        );
        const toolbar = document.querySelector<HTMLElement>('.decision-toolbar');
        const scroller = document.querySelector<HTMLElement>('.decision-panel .table__scroll');
        const activeTab = document.querySelector<HTMLElement>(
          '.subnav__tab[aria-current="page"]',
        );
        const subnav = document.querySelector<HTMLElement>('.subnav');
        const sectionMenu =
          document.querySelector<HTMLElement>('.admin-section-menu summary');
        return {
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 999,
          overlaps,
          scroller: rect('.decision-panel .table__scroll'),
          panel: rect('.decision-panel'),
          status: rect('.decision-control select'),
          activeTab: activeTab?.getBoundingClientRect() ?? null,
          subnav: subnav?.getBoundingClientRect() ?? null,
          sectionMenu: sectionMenu?.getBoundingClientRect() ?? null,
          sectionText: sectionMenu?.textContent ?? '',
          scrollerOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 999,
          viewportWidth: window.innerWidth,
          chartWidths: [
            ...document.querySelectorAll<HTMLElement>('.proposal-dashboard__charts > .card'),
          ].map((card) => card.getBoundingClientRect().width),
        };
      });

      expect(layout.documentOverflow).toBeLessThanOrEqual(1);
      expect(layout.toolbarOverflow).toBeLessThanOrEqual(1);
      expect(layout.overlaps).toBe(false);
      expect(layout.scroller).not.toBeNull();
      expect(layout.panel).not.toBeNull();
      expect(layout.scroller!.left).toBeGreaterThanOrEqual(layout.panel!.left);
      expect(layout.scroller!.right).toBeLessThanOrEqual(layout.panel!.right + 1);

      if (width < 768) {
        expect(layout.scrollerOverflow).toBeLessThanOrEqual(1);
        expect(layout.status).not.toBeNull();
        expect(layout.status!.left).toBeGreaterThanOrEqual(0);
        expect(layout.status!.right).toBeLessThanOrEqual(layout.viewportWidth);
      }

      if (width < 1024) {
        expect(layout.sectionMenu).not.toBeNull();
        expect(layout.sectionMenu!.width).toBeGreaterThan(0);
        expect(layout.sectionMenu!.left).toBeGreaterThanOrEqual(0);
        expect(layout.sectionMenu!.right).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.sectionText).toContain('Proposals');
      } else {
        expect(layout.activeTab).not.toBeNull();
        expect(layout.subnav).not.toBeNull();
        expect(layout.activeTab!.left).toBeGreaterThanOrEqual(layout.subnav!.left);
        expect(layout.activeTab!.right).toBeLessThanOrEqual(layout.subnav!.right + 1);
      }

      if (width === 700) {
        expect(layout.chartWidths).toHaveLength(3);
        expect(layout.chartWidths[2]).toBeGreaterThan(layout.chartWidths[0] * 1.8);
      }
    }
  });

  test('a status outside the committee’s vocabulary is refused', async ({ page }) => {
    await asAdmin(page);
    const admin = await createAccount(ADMIN);
    const speaker = await createAccount(SPEAKER);
    await seedSubmittedProposal('p-sam', { speakerUid: speaker.uid, title: 'Sam on shipping' });

    // `withdrawn` belongs to the applicant's flow, and arbitrary values never do.
    for (const status of ['withdrawn', 'nonsense']) {
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
    await page.getByRole('button', { name: 'Edit profile' }).click();
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

    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('textbox', { name: /^Company/ }).fill('New Employer');
    await page.getByRole('checkbox', { name: /visa or eTA/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.actions__status')).toHaveText(/Draft saved/);

    await page.reload();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.getByRole('textbox', { name: /^Company/ })).toHaveValue('New Employer');
    await expect(page.getByRole('checkbox', { name: /visa or eTA/ })).toBeChecked();
  });

  test('the window controls reach the form', async ({ page }) => {
    await asAdmin(page, 'settings');

    await expect(page.getByText(/^Your device time zone:/)).toBeVisible();
    await page.getByRole('checkbox', { name: /Pause submissions/ }).check();
    await page.getByRole('button', { name: 'Save window' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto(at());
    await expect(page.getByText(/paused/)).toBeVisible();
  });

  test('changing admin tabs does not discard unsaved settings', async ({ page }) => {
    await asAdmin(page, 'settings');
    const settings = page.locator('.section', {
      has: page.getByRole('heading', { name: 'This call for proposals' }),
    });
    const name = settings.getByRole('textbox', { name: /^Name/ });
    await name.fill('A renamed conference');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'All calls', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/settings$'));
    await expect(name).toHaveValue('A renamed conference');

    page.once('dialog', (dialog) => dialog.accept());
    await tab(page, 'Committee').click();
    await expect(page).toHaveURL(new RegExp('/admin/committee$'));
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
