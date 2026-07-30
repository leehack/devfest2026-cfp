import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  createAccount,
  inviteRole,
  reset,
  seedCfp,
  seedMember,
  seedProposal,
} from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = { sub: 'nav-admin', email: 'nav-admin@example.org', name: 'Ada Admin' };
const REVIEWER: Identity = {
  sub: 'nav-reviewer',
  email: 'nav-reviewer@example.org',
  name: 'Rey Reviewer',
};
const SPEAKER: Identity = {
  sub: 'nav-speaker',
  email: 'nav-speaker@example.org',
  name: 'Sam Speaker',
};
const SECOND_SPEAKER: Identity = {
  sub: 'nav-second-speaker',
  email: 'nav-second-speaker@example.org',
  name: 'Sid Speaker',
};

const eventNav = (page: Page) =>
  page.getByRole('navigation', { name: /DevFest Montréal 2026: Event sections/ });

test.describe('navigation by persona', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('an anonymous speaker always has an event home and proposal path', async ({ page }) => {
    await page.goto(at(''));

    const nav = eventNav(page);
    await expect(nav.getByRole('link', { name: 'Event', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'My proposals', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Review talks', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Manage event', exact: true })).toHaveCount(0);

    await nav.getByRole('link', { name: 'My proposals', exact: true }).click();
    await expect(page).toHaveURL(at());
    await expect(
      eventNav(page).getByRole('link', { name: 'My proposals', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'DevFest Montréal 2026', exact: true })).toHaveAttribute(
      'href',
      `/c/${CFP_ID}`,
    );
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('header sign-in on an event keeps the speaker inside that event', async ({ page }) => {
    await page.goto(at(''));
    await page
      .locator('header.header')
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();

    await expect(page).toHaveURL(at());
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page.locator('#sign-in')).toBeVisible();
    await expect(page.getByText(/come back and edit your draft/)).toBeVisible();
  });

  test('an upcoming event still offers sign-in after the header action', async ({ page }) => {
    await reset({ opensAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await page.goto(at(''));
    await page
      .locator('header.header')
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();

    await expect(page).toHaveURL(at());
    await expect(page.getByText('The call for proposals is not open yet.')).toBeVisible();
    await expect(page.locator('#sign-in')).toBeVisible();
  });

  test('a signed-out protected deep link keeps its breadcrumb without misleading tabs', async ({
    page,
  }) => {
    await page.goto(at('/admin/proposals'));

    await expect(eventNav(page)).toHaveCount(0);
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByText('Proposals', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('#sign-in')).toBeVisible();
  });

  test('a signed-in speaker sees no committee destinations', async ({ page }) => {
    await signInAs(page, SPEAKER, at());

    const nav = eventNav(page);
    await expect(nav.getByRole('link', { name: 'Event', exact: true })).toBeVisible();
    await expect(
      nav.getByRole('link', { name: 'My proposals', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Review talks', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Manage event', exact: true })).toHaveCount(0);
  });

  test('a reviewer gets review navigation but not event management', async ({ page }) => {
    await inviteRole(REVIEWER.email, 'reviewer');
    await signInAs(page, REVIEWER, at('/review'));

    const nav = eventNav(page);
    await expect(nav.getByRole('link', { name: 'Review talks', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Manage event', exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle(
      'Review talks — DevFest Montréal 2026 — Call for Proposals',
    );
  });

  test('an admin sees the full hierarchy and a task-specific browser title', async ({ page }) => {
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const nav = eventNav(page);
    await expect(nav.getByRole('link', { name: 'Manage event', exact: true })).toHaveAttribute(
      'aria-current',
      'location',
    );
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(
      breadcrumb.getByRole('link', { name: 'DevFest Montréal 2026', exact: true }),
    ).toHaveAttribute('href', `/c/${CFP_ID}`);
    await expect(breadcrumb.getByRole('link', { name: 'Manage event', exact: true })).toHaveAttribute(
      'href',
      `/c/${CFP_ID}/admin/overview`,
    );
    await expect(breadcrumb.getByText('Proposals', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.locator('.admin-shell-header').getByRole('heading', {
        name: 'Proposals',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle(
      'Proposals — DevFest Montréal 2026 — Call for Proposals',
    );
  });

  test('the create page separates the page title from its form heading', async ({ page }) => {
    await signInAs(page, SPEAKER, '/new');

    await expect(
      page.locator('header.header').getByRole('heading', {
        name: 'Create your call for proposals',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator('#main-content').getByRole('heading', {
        name: 'Event details',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('a 320px admin gets contained primary tabs and a discoverable section picker', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const nav = eventNav(page);
    const layout = await nav.evaluate((element) => ({
      overflow: element.scrollWidth - element.clientWidth,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      links: [...element.querySelectorAll('a')].map((link) => {
        const box = link.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
      viewport: window.innerWidth,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.documentOverflow).toBeLessThanOrEqual(1);
    for (const link of layout.links) {
      expect(link.left).toBeGreaterThanOrEqual(0);
      expect(link.right).toBeLessThanOrEqual(layout.viewport);
    }

    const picker = page.getByRole('combobox', { name: 'Manage section' });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveValue('proposals');
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeHidden();
    await picker.selectOption('email');
    await expect(page).toHaveURL(at('/admin/proposals'));
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page).toHaveURL(at('/admin/email'));
    await expect(picker).toHaveValue('email');
    await expect(page).toHaveTitle('Email — DevFest Montréal 2026 — Call for Proposals');
  });
});

test.describe('task-aware home navigation', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('a private draft is resumable without keeping its original link', async ({ page }) => {
    const privateId = 'private-speaker-call';
    await seedCfp(privateId, { name: 'Private Speaker Call', visibility: 'private' });
    const speaker = await createAccount(SPEAKER);
    await seedProposal('draft-one', {
      cfpId: privateId,
      speakerUid: speaker.uid,
      title: 'A private draft',
      status: 'draft',
      includeSpeakerSnapshot: false,
    });

    await signInAs(page, SPEAKER, '/');
    await expect(page.getByRole('heading', { name: 'Your activity' })).toBeVisible();
    const resume = page.getByRole('link', {
      name: /Private Speaker Call.*Draft.*Continue draft/,
    });
    await expect(resume).toHaveAttribute('href', `/c/${privateId}/submit`);
    await resume.click();
    await expect(page).toHaveURL(`/c/${privateId}/submit`);
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveValue('A private draft');
  });

  test('committee activity opens the useful workspace directly', async ({ page }) => {
    const privateId = 'private-review-call';
    await seedCfp(privateId, { name: 'Private Review Call', visibility: 'private' });
    const reviewer = await createAccount(REVIEWER);
    await seedMember(reviewer.uid, 'reviewer', privateId, REVIEWER.email);

    await signInAs(page, REVIEWER, '/');
    const review = page.getByRole('link', {
      name: /Private Review Call.*Reviewer.*Review talks/,
    });
    await expect(review).toHaveAttribute('href', `/c/${privateId}/review`);
  });

  test('switching accounts hides the previous speaker activity before the next paint', async ({
    page,
  }) => {
    const privateId = 'private-account-switch';
    await seedCfp(privateId, { name: 'Previous Account Call', visibility: 'private' });
    const first = await createAccount(SPEAKER);
    await createAccount(SECOND_SPEAKER);
    await seedProposal('private-account-draft', {
      cfpId: privateId,
      speakerUid: first.uid,
      title: 'Only the first account can see this',
      status: 'draft',
      includeSpeakerSnapshot: false,
    });

    await signInAs(page, SPEAKER, '/');
    await expect(page.getByText('Previous Account Call', { exact: true })).toBeVisible();

    const firstPaint = await page.evaluate(async (claims) => {
      await (window as any).signInAsTestSpeaker(claims);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return document.body.innerText;
    }, SECOND_SPEAKER);
    expect(firstPaint).not.toContain('Previous Account Call');
    await expect(page.getByText('Previous Account Call', { exact: true })).toHaveCount(0);
  });
});
