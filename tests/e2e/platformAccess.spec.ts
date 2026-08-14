import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  readEmailDomainBinding,
  readPlatformEmailConfigurationDirect,
  reset,
  seedCfp,
  seedMember,
  seedPlatformMember,
  setPlatformEmailDeliveryReadyDirect,
  setPlatformStagedEmailDomainDirect,
  setSendingDomainDirect,
} from './backend';
import { signInAs, type Identity } from './form';

const ADMIN: Identity = {
  sub: 'platform-admin',
  email: 'platform-admin@example.org',
  name: 'Paula Platform',
};
const OWNER: Identity = {
  sub: 'platform-owner',
  email: 'platform-owner@example.org',
  name: 'Owen Owner',
};
const OUTSIDER: Identity = {
  sub: 'platform-outsider',
  email: 'outsider@example.org',
  name: 'Ollie Outsider',
};

test.describe('platform administration', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('ordinary verified accounts need an organization, not platform creator access', async ({ page }) => {
    const outsider = await createAccount(OUTSIDER);
    expect(await callJson(outsider.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
      isPlatformAdmin: false,
      isPlatformOwner: false,
    });
    expect(
      await callAs(outsider.idToken, 'createCfp', {
        cfpId: 'no-independent-event',
        name: 'No independent event',
        visibility: 'private',
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });

    await signInAs(page, OUTSIDER, '/new');
    await expect(page.getByRole('heading', { name: 'Create an organization first' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create an organization' })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Start a call for proposals' })).toBeVisible();
  });

  test('platform access remains limited to owners and administrators', async ({ page }) => {
    const owner = await createAccount(OWNER);
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);

    const directory = await callJson(owner.idToken, 'listPlatformUsers', {});
    expect(directory.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'owner', email: OWNER.email }),
        expect.objectContaining({ role: 'admin', email: ADMIN.email }),
      ]),
    );
    await signInAs(page, ADMIN, '/platform/access');
    await expect(page.getByText('Independent event creator')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Usage limits' })).toBeVisible();
  });

  test('a platform administrator can inspect the effective email defaults without event access', async ({
    page,
  }) => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    await setPlatformEmailDeliveryReadyDirect();

    await signInAs(page, ADMIN, '/');
    await page.getByRole('button', { name: 'Account' }).click();
    await page
      .locator('.account-menu__panel')
      .getByRole('link', { name: 'Email delivery' })
      .click();
    await expect(page).toHaveURL('/platform/email');
    await expect(page.getByRole('link', { name: 'Email delivery' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Platform email delivery' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Platform delivery is ready' })).toBeVisible();
    await expect(page.getByLabel('Send as')).toHaveValue(
      'CFP Platform <mail@platform.example.test>',
    );
    await expect(page.getByLabel('Reply-to')).toHaveValue('support@platform.example.test');
    await expect(page.getByRole('heading', { name: 'Default wording' })).toHaveCount(0);
    await expect(page.getByLabel('Edit the wording')).toHaveCount(0);
    await page.getByRole('button', { name: 'Send test email' }).click();
    await expect(
      page.getByText('Test rendered locally; no message was sent.'),
    ).toBeVisible();
  });

  test('usage-limit lists paginate without mislabelling an idle form as saving', async ({ page }) => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    const users = Array.from({ length: 6 }, (_, index) => ({
      uid: `quota-user-${index + 1}`,
      email: `quota-${index + 1}@example.org`,
      name: `Quota User ${index + 1}`,
      ownedOrganizationCount: index % 2,
      organizationLimit: 1,
      hasOverride: false,
    }));
    const organizations = Array.from({ length: 6 }, (_, index) => ({
      id: `quota-org-${index + 1}`,
      name: `Quota Organization ${index + 1}`,
      activeEventCount: index % 2,
      activeEventLimit: 1,
    }));
    await page.route('**/listUserOrgLimits', (route) => {
      const token = route.request().postDataJSON()?.data?.pageToken;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          result: token
            ? { users: users.slice(5), nextPageToken: null }
            : { users: users.slice(0, 5), nextPageToken: 'users-2' },
        }),
      });
    });
    await page.route('**/findUserOrgLimit', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ result: { user: users[1] } }),
      }),
    );
    await page.route('**/listOrgLimits', (route) => {
      const data = route.request().postDataJSON()?.data ?? {};
      const result = data.query
        ? { organizations: [organizations[2]], nextCursor: null }
        : data.cursor
          ? { organizations: organizations.slice(5), nextCursor: null }
          : { organizations: organizations.slice(0, 5), nextCursor: 'quota-org-5' };
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ result }),
      });
    });

    await signInAs(page, ADMIN, '/platform/limits');
    await expect(page.getByLabel('Find a verified account')).toBeVisible();
    await expect(page.locator('.platform-user-limit')).toHaveCount(5);
    const userPagination = page.getByRole('navigation', { name: 'List pages' }).first();
    await expect(userPagination).toContainText('Page 1');
    await userPagination.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.platform-user-limit')).toHaveCount(1);
    await expect(page.getByText('Quota User 6')).toBeVisible();

    await page.getByLabel('Find a verified account').fill('quota-2@example.org');
    await page.getByRole('button', { name: 'Find account' }).click();
    await expect(page.locator('.platform-user-limit')).toHaveCount(1);
    await expect(page.getByText('Quota User 2')).toBeVisible();
    await page.getByRole('button', { name: 'Back to directory' }).click();

    const orgPagination = page.getByRole('navigation', { name: 'List pages' }).last();
    await expect(orgPagination).toContainText('Page 1');
    await orgPagination.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Quota Organization 6')).toBeVisible();
    await page.getByLabel('Find an organization').fill('quota-org-3');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Quota Organization 3')).toBeVisible();
    await expect(page.getByText('Quota Organization 6')).toHaveCount(0);
  });

  test('platform domain activation refuses an unverified staged replacement', async () => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    await setPlatformEmailDeliveryReadyDirect();
    const staged = await setPlatformStagedEmailDomainDirect(
      'pending.platform.example.test',
      'pending',
    );

    expect(await callJson(admin.idToken, 'getPlatformEmailConfiguration', {})).toMatchObject({
      domainId: 'dom-platform.example.test',
      domain: 'platform.example.test',
      stagedDomainId: staged.domainId,
      stagedDomain: staged.domain,
      delivery: { ready: true },
    });
    expect(await callJson(admin.idToken, 'platformEmailDomain', { action: 'verify' })).toMatchObject({
      domain: { id: staged.domainId, name: staged.domain, status: 'pending' },
    });
    expect(
      await callAs(admin.idToken, 'platformEmailDomain', { action: 'activate' }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readPlatformEmailConfigurationDirect()).toMatchObject({
      domainId: 'dom-platform.example.test',
      stagedDomainId: staged.domainId,
    });
    expect(await readEmailDomainBinding('dom-platform.example.test')).toMatchObject({
      scope: 'platform',
    });
    expect(await readEmailDomainBinding(staged.domainId)).toMatchObject({ scope: 'platform' });
  });

  test('platform domain activation atomically cuts over and deletes only the old platform binding', async () => {
    const admin = await createAccount(ADMIN);
    await Promise.all([
      seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name),
      seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
    ]);
    await setPlatformEmailDeliveryReadyDirect();
    const staged = await setPlatformStagedEmailDomainDirect('next.platform.example.test');
    await seedCfp('other-event');
    await setSendingDomainDirect('event-owned.example.test', 'other-event');

    expect(await callJson(admin.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      source: 'platform',
      domain: 'platform.example.test',
      settings: { from: 'CFP Platform <mail@platform.example.test>' },
      delivery: { ready: true },
    });
    expect(await callJson(admin.idToken, 'platformEmailDomain', { action: 'verify' })).toMatchObject({
      domain: { id: staged.domainId, status: 'verified' },
    });
    expect(
      await callJson(admin.idToken, 'platformEmailDomain', { action: 'activate' }),
    ).toMatchObject({ ok: true, activated: true, domain: { id: staged.domainId } });

    const activated = await readPlatformEmailConfigurationDirect();
    expect(activated).toMatchObject({ domainId: staged.domainId, domain: staged.domain });
    expect(activated).not.toHaveProperty('stagedDomainId');
    expect(activated).not.toHaveProperty('stagedDomain');
    expect(activated).not.toHaveProperty('from');
    expect(await readEmailDomainBinding('dom-platform.example.test')).toBeNull();
    expect(await readEmailDomainBinding(staged.domainId)).toMatchObject({
      scope: 'platform',
      domainId: staged.domainId,
      domain: staged.domain,
    });
    expect(await readEmailDomainBinding('dom-event-owned.example.test')).toMatchObject({
      scope: 'event',
      cfpId: 'other-event',
    });

    expect(await callJson(admin.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      source: 'platform',
      domain: staged.domain,
      settings: { from: '' },
      delivery: { ready: false, problems: expect.arrayContaining(['invalid_sender']) },
    });
    await callJson(admin.idToken, 'setPlatformEmailSettings', {
      from: `CFP Platform <mail@${staged.domain}>`,
      replyTo: 'support@platform.example.test',
    });
    expect(await callJson(admin.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      source: 'platform',
      domain: staged.domain,
      settings: { from: `CFP Platform <mail@${staged.domain}>` },
      delivery: { ready: true },
    });
  });

  test('a verified platform replacement stays staged until its explicit cutover', async ({ page }) => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    let activated = false;
    const replacement = {
      id: 'dom-next.platform.example.test',
      name: 'next.platform.example.test',
      status: 'verified',
      records: [],
    };

    await page.route('**/getPlatformEmailConfiguration', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            ok: true,
            settings: {
              from: activated ? '' : 'CFP Platform <mail@platform.example.test>',
              replyTo: 'support@platform.example.test',
              publicUrl: '',
            },
            keyHint: '…test',
            domainId: activated ? replacement.id : 'dom-platform.example.test',
            domain: activated ? replacement.name : 'platform.example.test',
            stagedDomainId: activated ? '' : replacement.id,
            stagedDomain: activated ? '' : replacement.name,
            delivery: activated
              ? { ready: false, problems: ['invalid_sender'], domainStatus: 'verified' }
              : { ready: true, problems: [], domainStatus: 'verified' },
          },
        }),
      });
    });
    await page.route('**/platformEmailDomain', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const request = route.request().postDataJSON() as { data?: { action?: string } };
      if (request.data?.action === 'activate') activated = true;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          result:
            request.data?.action === 'list'
              ? { ok: true, domains: [replacement] }
              : { ok: true, activated: true, domain: replacement },
        }),
      });
    });

    await signInAs(page, ADMIN, '/platform/email');
    const active = page.locator('article', {
      has: page.getByRole('heading', { name: 'Active platform domain' }),
    });
    const staged = page.locator('article', {
      has: page.getByRole('heading', { name: 'Staged replacement' }),
    });
    await expect(active).toContainText('platform.example.test');
    await expect(staged).toContainText(replacement.name);
    await expect(staged).toContainText('Verified');
    await expect(page.getByRole('heading', { name: 'Platform delivery is ready' })).toBeVisible();

    await staged.getByRole('button', { name: 'Activate verified domain' }).click();

    await expect(active).toContainText(replacement.name);
    await expect(staged).toContainText('No replacement domain is staged.');
    await expect(page.getByLabel('Send as')).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Platform delivery needs setup' })).toBeVisible();
    await expect(
      page.getByText('Verified platform domain activated. Save a matching sender before delivery can resume.'),
    ).toBeVisible();
  });

  test('platform email drafts guard internal navigation', async ({ page }) => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    await setPlatformEmailDeliveryReadyDirect();
    await signInAs(page, ADMIN, '/platform/email');

    const sender = page.getByLabel('Send as');
    await sender.fill('Unsaved <mail@platform.example.test>');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'All calls', exact: true })
      .click();

    await expect(page).toHaveURL(/\/platform\/email$/);
    await expect(sender).toHaveValue('Unsaved <mail@platform.example.test>');
  });

  test('the owner screen delegates and revokes pending administrators', async ({ page }) => {
    const owner = await createAccount(OWNER);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);

    await signInAs(page, OWNER, '/platform/access');
    await expect(page.getByRole('term').filter({ hasText: 'Platform owner' })).toBeVisible();
    await page
      .getByRole('textbox', { name: /^Administrator email/ })
      .fill('future-admin@example.org');
    await page.getByRole('button', { name: 'Add platform admin' }).click();
    await expect(
      page.getByText(/future-admin@example.org will become a platform administrator/),
    ).toBeVisible();

    const future = page.locator('.people__row').filter({ hasText: 'future-admin@example.org' });
    await expect(future.getByText('Pending verified sign-in')).toBeVisible();
    await expect(future.getByText('Platform admin', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await future.getByRole('button', { name: 'Remove admin access' }).click();
    await expect(page.getByText(/future-admin@example.org is no longer/)).toBeVisible();
    await expect(future).toHaveCount(0);
  });
});
