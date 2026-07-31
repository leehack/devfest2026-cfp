import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  callPublic,
  createAccount,
  createUnverifiedAccount,
  invitePlatformRole,
  reset,
  seedPlatformMember,
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
const CREATOR: Identity = {
  sub: 'platform-creator',
  email: 'creator@example.org',
  name: 'Casey Creator',
};
const OUTSIDER: Identity = {
  sub: 'platform-outsider',
  email: 'outsider@example.org',
  name: 'Ollie Outsider',
};

const creation = (cfpId: string) => ({
  cfpId,
  name: cfpId.replaceAll('-', ' '),
  visibility: 'private',
  opensAt: new Date(Date.now() - 86_400_000).toISOString(),
  closesAt: new Date(Date.now() + 86_400_000).toISOString(),
});

test.describe('platform creator access', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('anonymous and unapproved accounts cannot create or administer the platform', async ({
    page,
  }) => {
    expect(await callPublic('platformAccess', {})).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
    });

    const outsider = await createAccount(OUTSIDER);
    expect(await callAs(outsider.idToken, 'createCfp', creation('blocked-call'))).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    for (const [name, data] of [
      ['listPlatformUsers', {}],
      ['grantCfpCreator', { email: 'friend@example.org' }],
      ['revokeCfpCreator', { email: 'friend@example.org' }],
      ['grantPlatformAdmin', { email: 'friend@example.org' }],
      ['revokePlatformAdmin', { email: 'friend@example.org' }],
    ] as const) {
      expect(await callAs(outsider.idToken, name, data), name).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED',
      });
    }

    await signInAs(page, OUTSIDER, '/new');
    await expect(
      page.getByRole('heading', { name: 'CFP creation is restricted' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create it' })).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Start a call for proposals' })).toHaveCount(0);
    await expect(page.getByText(/must approve your account/)).toBeVisible();

    await page.goto('/platform');
    await expect(page.getByText('That page is not available to your account.')).toBeVisible();

    await page.goto('/new');
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);
    expect(
      await callAs(admin.idToken, 'grantCfpCreator', { email: OUTSIDER.email }),
    ).toMatchObject({ ok: true });
    await page.getByRole('button', { name: 'Check access again' }).click();
    await expect(page.getByRole('heading', { name: 'Event details' })).toBeVisible();
  });

  test('a pending grant is claimed only by its verified address', async () => {
    await invitePlatformRole(CREATOR.email.toUpperCase(), 'creator');
    const creator = await createAccount(CREATOR);
    const outsider = await createAccount(OUTSIDER);

    expect(await callJson(creator.idToken, 'platformAccess', {})).toMatchObject({
      role: 'creator',
      canCreateCfp: true,
      isPlatformAdmin: false,
    });
    expect(await callJson(outsider.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
      canCreateCfp: false,
      isPlatformAdmin: false,
    });
    expect(await callAs(creator.idToken, 'createCfp', creation('creator-call'))).toMatchObject({
      ok: true,
    });
    for (const [name, data] of [
      ['listPlatformUsers', {}],
      ['grantCfpCreator', { email: 'friend@example.org' }],
      ['revokeCfpCreator', { email: 'friend@example.org' }],
      ['grantPlatformAdmin', { email: 'friend@example.org' }],
      ['revokePlatformAdmin', { email: 'friend@example.org' }],
    ] as const) {
      expect(await callAs(creator.idToken, name, data), name).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED',
      });
    }
  });

  test('an unverified account cannot claim an email grant', async () => {
    await invitePlatformRole(CREATOR.email, 'creator');
    const creator = await createUnverifiedAccount(CREATOR);

    expect(await callAs(creator.idToken, 'platformAccess', {})).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
    expect(
      await callAs(creator.idToken, 'createCfp', creation('unverified-creator-call')),
    ).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
  });

  test('a pending admin grant upgrades an existing creator membership', async () => {
    const creator = await createAccount(CREATOR);
    await seedPlatformMember(creator.uid, 'creator', CREATOR.email, CREATOR.name);
    await invitePlatformRole(CREATOR.email, 'admin');

    expect(await callJson(creator.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
      canCreateCfp: true,
      isPlatformAdmin: true,
    });
    expect(await callAs(creator.idToken, 'listPlatformUsers', {})).toMatchObject({
      ok: true,
    });
  });

  test('an admin grants and revokes future creation without taking away an owned CFP', async () => {
    const admin = await createAccount(ADMIN);
    const creator = await createAccount(CREATOR);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);

    expect(
      await callAs(admin.idToken, 'setCfpWindow', { cfpId: CFP_ID, paused: true }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await callAs(admin.idToken, 'createCfp', creation('platform-admin-call'))).toMatchObject({
      ok: true,
    });

    expect(
      await callAs(admin.idToken, 'grantCfpCreator', { email: CREATOR.email }),
    ).toMatchObject({ ok: true });
    expect(await callAs(creator.idToken, 'createCfp', creation('owned-before-revoke'))).toMatchObject({
      ok: true,
    });

    expect(
      await callAs(admin.idToken, 'revokeCfpCreator', { email: CREATOR.email }),
    ).toMatchObject({ ok: true });
    expect(await callAs(creator.idToken, 'createCfp', creation('blocked-after-revoke'))).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(
      await callAs(creator.idToken, 'setCfpWindow', {
        cfpId: 'owned-before-revoke',
        paused: true,
      }),
    ).toMatchObject({ ok: true });

    expect(
      await callAs(admin.idToken, 'revokeCfpCreator', { email: ADMIN.email }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callAs(admin.idToken, 'grantCfpCreator', { email: ADMIN.email }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const pendingAdmin = 'next-platform-admin@example.org';
    await invitePlatformRole(pendingAdmin, 'admin');
    for (const callable of ['grantCfpCreator', 'revokeCfpCreator']) {
      expect(
        await callAs(admin.idToken, callable, { email: pendingAdmin }),
        callable,
      ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    }
    expect(await callJson(admin.idToken, 'listPlatformUsers', {})).toMatchObject({
      pending: [{ email: pendingAdmin, role: 'admin' }],
    });
  });

  test('an owner delegates administrators while every event remains separately authorised', async () => {
    const owner = await createAccount(OWNER);
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);

    expect(await callJson(owner.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
      canCreateCfp: true,
      isPlatformAdmin: true,
      isPlatformOwner: true,
    });
    expect(
      await callAs(owner.idToken, 'setCfpWindow', { cfpId: CFP_ID, paused: true }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    expect(
      await callJson(owner.idToken, 'grantPlatformAdmin', { email: ADMIN.email }),
    ).toMatchObject({ email: ADMIN.email, applied: true });
    expect(await callJson(admin.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
      canCreateCfp: true,
      isPlatformAdmin: true,
      isPlatformOwner: false,
    });

    const directory = await callJson(owner.idToken, 'listPlatformUsers', {});
    expect(directory.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: admin.uid,
          email: ADMIN.email,
          role: 'admin',
          createdBy: owner.uid,
          grantedBy: owner.uid,
          roleUpdatedBy: owner.uid,
        }),
      ]),
    );

    for (const callable of ['grantPlatformAdmin', 'revokePlatformAdmin']) {
      expect(
        await callAs(admin.idToken, callable, { email: 'another-admin@example.org' }),
        callable,
      ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
    expect(
      await callAs(owner.idToken, 'revokePlatformAdmin', { email: OWNER.email }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    expect(
      await callAs(owner.idToken, 'revokePlatformAdmin', { email: ADMIN.email }),
    ).toMatchObject({ ok: true });
    expect(await callJson(admin.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
      canCreateCfp: false,
      isPlatformAdmin: false,
      isPlatformOwner: false,
    });
  });

  test('an administrator grant waits for that exact address to verify and sign in', async () => {
    const owner = await createAccount(OWNER);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);
    const nextAdmin: Identity = {
      sub: 'next-platform-admin',
      email: 'next-platform-admin@example.org',
      name: 'Nadia Next',
    };

    expect(
      await callJson(owner.idToken, 'grantPlatformAdmin', { email: nextAdmin.email }),
    ).toMatchObject({ email: nextAdmin.email, applied: false });
    expect(await callJson(owner.idToken, 'listPlatformUsers', {})).toMatchObject({
      pending: [
        expect.objectContaining({
          email: nextAdmin.email,
          role: 'admin',
          createdBy: owner.uid,
          roleUpdatedBy: owner.uid,
        }),
      ],
    });

    const verified = await createAccount(nextAdmin);
    expect(await callJson(verified.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
      canCreateCfp: true,
      isPlatformAdmin: true,
      isPlatformOwner: false,
    });
  });

  test('the per-owner ceiling holds when creation requests race', async () => {
    const creator = await createAccount(CREATOR);
    await seedPlatformMember(creator.uid, 'creator', CREATOR.email, CREATOR.name);

    for (let index = 1; index <= 9; index += 1) {
      expect(
        await callAs(creator.idToken, 'createCfp', creation(`race-call-${index}`)),
      ).toMatchObject({ ok: true });
    }

    const results = await Promise.all(
      ['race-call-10', 'race-call-11'].map((cfpId) =>
        callAs(creator.idToken, 'createCfp', creation(cfpId)),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ code: 'RESOURCE_EXHAUSTED' }),
    ]);
  });

  test('the platform admin screen is discoverable, responsive, and manages pending creators', async ({
    page,
  }) => {
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);

    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, ADMIN, '/');
    await page.getByRole('button', { name: 'Account' }).click();
    await page
      .locator('.account-menu__panel')
      .getByRole('link', { name: 'Platform access' })
      .click();
    await expect(page).toHaveURL('/platform');
    await expect(page).toHaveTitle('Platform administration — Call for Proposals');
    await expect(page.getByRole('heading', { name: 'Platform access' })).toBeVisible();
    await expect(page.getByText('Paula Platform')).toBeVisible();
    await expect(page.getByText('Platform admin', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add creator' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add platform admin' })).toHaveCount(0);

    await page.getByRole('textbox', { name: /^Email address/ }).fill('future@example.org');
    await page.getByRole('button', { name: 'Add creator' }).click();
    await expect(page.getByText(/future@example.org will receive creator access/)).toBeVisible();
    const future = page.locator('.people__row').filter({ hasText: 'future@example.org' });
    await expect(future.getByText('Pending verified sign-in')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await future.getByRole('button', { name: 'Remove creator access' }).click();
    await expect(page.getByText(/future@example.org can no longer create/)).toBeVisible();
    await expect(future).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the owner screen delegates and revokes pending administrators', async ({ page }) => {
    const owner = await createAccount(OWNER);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);

    await signInAs(page, OWNER, '/platform');
    await expect(page.getByText('Platform owner', { exact: true })).toBeVisible();
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
