/**
 * A call's public front page, and the admin panel that fills it in.
 *
 * The claim worth holding onto is that it renders for somebody who is not
 * signed in and never will be — this is the one screen whose audience has not
 * decided to submit yet.
 */

import { expect, test, type Page } from '@playwright/test';

import { CFP_ID, inviteRole, reset, seedCfp, setCfpWindow } from './backend';
import { at, signInAs, type Identity, alerts } from './form';

const ADMIN: Identity = { sub: 'admin-sub', email: 'admin@example.org', name: 'Ada' };

const BLURB =
  'A day of talks about building for the web and for Android, in Montréal, ' +
  'run by the local Google Developer Group.';

async function describeTheEvent(page: Page) {
  await inviteRole(ADMIN.email, 'admin');
  await signInAs(page, ADMIN, at('/admin/settings'));

  await page.getByRole('textbox', { name: /^Description \(English\)/ }).fill(BLURB);
  await page.getByRole('textbox', { name: /^Date of the event/ }).fill('2026-11-14');
  await page.getByRole('textbox', { name: /^Venue/ }).fill('Palais des congrès');
  await page.getByRole('textbox', { name: /^City/ }).fill('Montréal, QC');
  await page.getByRole('textbox', { name: /^Event website/ }).fill('https://gdgmontreal.com');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test.describe('a call’s front page', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('says what the event is, to somebody who is not signed in', async ({ page, browser }) => {
    await describeTheEvent(page);

    // A fresh context: no account, no session, nothing this browser knows.
    const stranger = await browser.newContext();
    const visitor = await stranger.newPage();
    await visitor.goto(at(''));

    await expect(visitor.getByText(/A day of talks about building/)).toBeVisible();
    await expect(visitor.getByText('Palais des congrès, Montréal, QC')).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'gdgmontreal.com' })).toBeVisible();
    await expect(visitor.getByText(/14 November 2026|November 14, 2026/)).toBeVisible();

    // And the way onwards is a link, so it can be opened in a new tab.
    await visitor
      .locator('.cfp-hero')
      .getByRole('link', { name: 'Submit a talk', exact: true })
      .click();
    await expect(visitor).toHaveURL(at());
    await expect(visitor.locator('#main-content')).toBeFocused();
    await stranger.close();
  });

  test('says so plainly when nobody has described it yet', async ({ page }) => {
    await page.goto(at(''));
    await expect(page.getByText('More event details are on the way.')).toBeVisible();
    // The deadline is still worth saying — it is the fact with a date on it.
    await expect(page.getByText(/Submissions close on/)).toBeVisible();
  });

  test('does not offer an impossible submission action outside the open window', async ({
    page,
  }) => {
    const day = 24 * 60 * 60 * 1000;
    await setCfpWindow({
      opensAt: new Date(Date.now() + day),
      closesAt: new Date(Date.now() + 2 * day),
    });

    await page.goto(at(''));
    await expect(
      page.getByText('The submission form will be available here when the call opens.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Submit a talk', exact: true })).toHaveCount(0);

    await setCfpWindow({
      opensAt: new Date(Date.now() - 2 * day),
      closesAt: new Date(Date.now() - day),
    });
    await page.reload();
    await expect(
      page.getByText('Organisers will contact speakers about the next steps.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Submit a talk', exact: true })).toHaveCount(0);
    await expect(
      page.locator('.cfp-hero').getByRole('link', {
        name: 'View your proposals',
        exact: true,
      }),
    ).toHaveAttribute('href', `/c/${CFP_ID}/submit`);
    await expect(
      page.getByRole('region', { name: 'Your proposals' }).getByRole('link', {
        name: 'View your proposals',
        exact: true,
      }),
    ).toHaveAttribute('href', `/c/${CFP_ID}/submit`);
  });

  test('the details survive a reload of the admin panel', async ({ page }) => {
    await describeTheEvent(page);
    await page.reload();

    await expect(page.getByRole('textbox', { name: /^Venue/ })).toHaveValue('Palais des congrès');
    await expect(page.getByRole('textbox', { name: /^Date of the event/ })).toHaveValue(
      '2026-11-14',
    );
  });

  /*
   * The website is rendered as an href. `javascript:` in one is a script the
   * organiser did not write, running on a page speakers are asked to trust.
   */
  test('refuses a website that is not one', async ({ page }) => {
    await inviteRole(ADMIN.email, 'admin');
    await signInAs(page, ADMIN, at('/admin/settings'));

    await page
      .getByRole('textbox', { name: /^Event website/ })
      .fill('javascript:alert(document.domain)');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(alerts(page)).toBeVisible();
    await page.goto(at(''));
    await expect(page.getByRole('link', { name: /alert/ })).toHaveCount(0);
  });
});

/**
 * What a crawler and a link unfurl get, asserted on the served bytes.
 *
 * These are the claims the unit tests for `metaFor`/`inject`/`sitemapXml` used
 * to make about a string builder. They belong here now: the framework writes the
 * tags, so the only thing worth checking is what actually leaves the server —
 * and `request` fetches it without running a line of JavaScript, which is
 * precisely the audience this page exists for.
 */
test.describe('what leaves the server', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('a public call carries its own title and description, before any JS runs', async ({
    page,
    request,
  }) => {
    await describeTheEvent(page);

    const html = await (await request.get(at(''))).text();
    expect(html).toContain('<title>DevFest Montréal 2026</title>');
    expect(html).toContain(BLURB.slice(0, 60));

    // Open Graph and Twitter say the same thing as each other. A preview that
    // disagrees with the page is worse than no preview.
    for (const tag of ['og:title', 'twitter:title']) {
      expect(html).toMatch(new RegExp(`${tag}"?[^>]*DevFest Montr`));
    }
    // And it is indexable, which is the whole point of a public call.
    expect(html).not.toContain('name="robots"');
  });

  /*
   * This shipped broken once. `generateMetadata` is given paths, and Next emits a
   * path verbatim unless `metadataBase` gives it an origin to resolve against —
   * so `og:url` went out as `/c/devfest-mtl-2026`, which Open Graph does not
   * allow and an unfurler cannot follow. The tags were all present and the suite
   * was green, because it only ever asserted on the titles.
   *
   * Asserted as "absolute, ending in the right path" rather than against a
   * literal origin: the origin is deployment config, and pinning it here would
   * make the test fail on the very thing it is meant to let vary.
   */
  test('the canonical and og:url are absolute, so an unfurler can follow them', async ({
    request,
  }) => {
    const html = await (await request.get(at(''))).text();

    for (const [what, pattern] of [
      ['og:url', /property="og:url" content="([^"]+)"/],
      ['canonical', /rel="canonical" href="([^"]+)"/],
    ] as const) {
      const url = html.match(pattern)?.[1];
      expect(url, `${what} is missing`).toBeTruthy();
      expect(url, `${what} is relative`).toMatch(/^https?:\/\//);
      expect(new URL(url!).pathname).toBe(`/c/${CFP_ID}`);
    }
  });

  test('an unlisted call renders but tells a crawler to stay away', async ({ request }) => {
    // Private means unlisted, not secret — the rules publish it to anyone with
    // the link. A search result is the one place it must not turn up.
    await seedCfp('quiet-call', { visibility: 'private' });

    const res = await request.get('/c/quiet-call');
    const html = await res.text();
    expect(html).toContain('noindex');
    /*
     * Nor may a shared cache hold it: unlisting a call has no invalidation hook.
     * The exact header differs by host — `next dev` sends
     * `no-cache, must-revalidate` and does not apply next.config.ts's `headers()`
     * at all, while a production build sends the pinned `private, no-store`. What
     * has to hold on both is that nothing shared is allowed to keep it.
     */
    const cache = res.headers()['cache-control'] ?? '';
    expect(cache).not.toContain('public');
    expect(cache).toMatch(/no-store|no-cache/);

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).not.toContain('quiet-call');
  });

  test('the sitemap lists the public calls and robots.txt guards the rest', async ({ request }) => {
    await seedCfp('another-call', { visibility: 'public' });

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/c/another-call');
    expect(sitemap).toContain(`/c/${CFP_ID}`);

    const robots = await (await request.get('/robots.txt')).text();
    for (const path of ['/c/*/admin', '/c/*/review', '/c/*/submit']) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    // No origin: this is a platform, whoever deploys it picks one.
    expect(robots).not.toContain('Sitemap:');
  });
});
