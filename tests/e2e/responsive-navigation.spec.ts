import { expect, test, type Page } from '@playwright/test';

import { inviteRole, reset, seedProposal } from './backend';
import { at, signInAs, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'responsive-nav-admin',
  email: 'responsive-nav-admin@example.org',
  name: 'Ada Admin',
};

async function seedTallProposalList(count = 12) {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      seedProposal(`responsive-${index}`, {
        speakerUid: `responsive-speaker-${index}`,
        title: `Responsive navigation proposal ${index + 1}`,
        status: 'submitted',
      }),
    ),
  );
}

async function scrollToLastProposal(page: Page) {
  const rows = page.locator('.decision-table tbody tr');
  await expect(rows).toHaveCount(12);
  await rows.last().scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

test.describe('responsive navigation', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('French event navigation does not cover the admin section picker at 320px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.addInitScript(() => localStorage.setItem('cfp.locale', 'fr'));
    await inviteRole(ADMIN.email, 'admin');
    await seedTallProposalList();
    await signInAs(page, ADMIN, at('/admin/proposals'));

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.admin-section-picker')).toBeVisible();
    await scrollToLastProposal(page);

    const layout = await page.evaluate(() => {
      const eventNavigation = document.querySelector<HTMLElement>('nav.nav');
      const sectionPicker = document.querySelector<HTMLElement>('.admin-section-picker');
      if (!eventNavigation || !sectionPicker) throw new Error('Admin navigation is missing');

      return {
        eventBottom: eventNavigation.getBoundingClientRect().bottom,
        pickerTop: sectionPicker.getBoundingClientRect().top,
      };
    });

    expect(
      layout.eventBottom,
      'the sticky event navigation must end before the section picker begins',
    ).toBeLessThanOrEqual(layout.pickerTop + 1);
  });

  test('desktop admin subsection navigation remains in view after deep scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await inviteRole(ADMIN.email, 'admin');
    await seedTallProposalList();
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const subsectionNavigation = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(subsectionNavigation).toBeVisible();
    await scrollToLastProposal(page);

    const layout = await subsectionNavigation.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
    });

    expect(layout.top, 'admin subsection navigation scrolled above the viewport').toBeGreaterThanOrEqual(
      0,
    );
    expect(
      layout.bottom,
      'admin subsection navigation extends below the viewport',
    ).toBeLessThanOrEqual(layout.viewportHeight);
  });

  test('the public CFP hero keeps its primary action visible at 700px', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto(at(''));

    const heroAction = page
      .locator('.cfp-hero')
      .getByRole('link', { name: 'Submit a talk', exact: true });
    await expect(heroAction).toBeVisible();

    const box = await heroAction.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  });
});
