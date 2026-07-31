import { expect, test, type Page } from '@playwright/test';

import {
  CFP_ID,
  createAccount,
  invitePlatformRole,
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
    await invitePlatformRole(SPEAKER.email, 'creator');
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

  test('a 320px admin gets contained primary tabs and direct section links', async ({
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

    const menu = page.locator('.admin-section-menu');
    await expect(menu).toBeVisible();
    const trigger = menu.locator('summary');
    await expect(trigger).toContainText('Proposals');
    await expect(page.getByRole('button', { name: 'Go', exact: true })).toHaveCount(0);
    await trigger.click();
    await expect(
      menu.getByRole('link', { name: 'Proposals', exact: true }),
    ).toHaveCount(0);
    const current = menu.locator('.admin-section-menu__link--on');
    await expect(current).toHaveText('Proposals');
    await expect(current).toHaveAttribute('aria-current', 'page');
    const email = menu.getByRole('link', { name: 'Email', exact: true });
    await expect(email).toHaveAttribute('href', at('/admin/email'));
    await email.click();
    await expect(page).toHaveURL(at('/admin/email'));
    await expect(menu.locator('details')).not.toHaveAttribute('open');
    await expect(menu.locator('summary')).toContainText('Email');
    await expect(page).toHaveTitle('Email — DevFest Montréal 2026 — Call for Proposals');
  });

  test('the section menu stays usable and dismissible in a short mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 320 });
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const menu = page.getByRole('navigation', { name: 'Admin sections' });
    const trigger = menu.getByRole('button', { name: 'Section: Proposals' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const list = menu.locator('.admin-section-menu__list');
    await expect(list).toBeVisible();
    await expect
      .poll(() => list.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(321);
    const geometry = await list.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      viewport: window.innerHeight,
      rowHeights: [...element.querySelectorAll('.admin-section-menu__link')].map(
        (row) => row.getBoundingClientRect().height,
      ),
    }));
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(Math.min(...geometry.rowHeights)).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');
    await expect(menu.locator('details')).not.toHaveAttribute('open');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator('.admin-shell-header').click();
    await expect(menu.locator('details')).not.toHaveAttribute('open');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await menu.getByRole('link', { name: 'Dashboard', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(at('/admin/overview'));
  });

  test('the section menu remains bounded and compact in a short tablet viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 320 });
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const menu = page.getByRole('navigation', { name: 'Admin sections' });
    const trigger = menu.getByRole('button', { name: 'Section: Proposals' });
    await trigger.click();
    const list = menu.locator('.admin-section-menu__list');
    await expect(list).toBeVisible();
    await expect
      .poll(() => list.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(321);

    const geometry = await list.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        viewport: window.innerHeight,
        columns: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.columns).toBe(2);
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
