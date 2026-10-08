import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readCfp,
  readMember,
  readOrgMember,
  readPlatformMember,
  reset,
  seedCfp,
  seedMember,
  seedOrgEvent,
  seedPlatformMember,
} from './backend';
import { signInAs, type Identity } from './form';

const OWNER: Identity = {
  sub: 'transfer-owner',
  email: 'transfer-owner@example.org',
  name: 'Transfer Owner',
};
const SUCCESSOR: Identity = {
  sub: 'transfer-successor',
  email: 'transfer-successor@example.org',
  name: 'Transfer Successor',
};
const ADMIN: Identity = {
  sub: 'transfer-admin',
  email: 'transfer-admin@example.org',
  name: 'Transfer Admin',
};

test.describe('single-owner transfer boundaries', () => {
  test.beforeEach(async () => reset());

  test('platform transfer requires acceptance and atomically demotes the former owner', async ({
    page,
  }) => {
    const owner = await createAccount(OWNER);
    const successor = await createAccount(SUCCESSOR);
    const admin = await createAccount(ADMIN);
    await seedPlatformMember(owner.uid, 'owner', OWNER.email, OWNER.name);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);

    await callJson(owner.idToken, 'initiatePlatformOwnershipTransfer', {
      email: SUCCESSOR.email,
    });
    expect(
      await callAs(owner.idToken, 'initiatePlatformOwnershipTransfer', {
        email: ADMIN.email,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await callJson(admin.idToken, 'getPlatformOwnershipTransfer', {})).toMatchObject({
      transfer: null,
    });

    // Initiating owner must NOT see the Accept Ownership Transfer banner on HomePage (#50)
    await signInAs(page, OWNER, '/');
    await expect(page.locator('.ownership-transfer-card')).toHaveCount(0);

    // Intended successor sees the Accept Ownership Transfer banner on HomePage and can accept (#50, #53)
    await signInAs(page, SUCCESSOR, '/');
    const banner = page.locator('.ownership-transfer-card');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: /Accept ownership/i }).click();
    await expect(banner).toHaveCount(0);

    expect(await readPlatformMember(successor.uid)).toMatchObject({ role: 'owner' });
    expect(await readPlatformMember(owner.uid)).toMatchObject({ role: 'admin' });
    expect(await readPlatformMember(admin.uid)).toMatchObject({ role: 'admin' });
  });

  test('organization transfer is private to its owner and target', async () => {
    const platformAdmin = await createAccount(ADMIN);
    const owner = await createAccount(OWNER);
    const successor = await createAccount(SUCCESSOR);
    await callJson(owner.idToken, 'createOrg', {
      name: 'Transfer Community',
      slug: 'transfer-community',
    });
    await callJson(owner.idToken, 'grantOrgRole', {
      orgId: 'transfer-community',
      email: ADMIN.email,
      role: 'admin',
    });
    expect(
      await callAs(owner.idToken, 'initiateOrgOwnershipTransfer', {
        orgId: 'transfer-community',
        email: 'not-an-email',
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    await callJson(owner.idToken, 'initiateOrgOwnershipTransfer', {
      orgId: 'transfer-community',
      email: SUCCESSOR.email,
    });

    expect(
      await callJson(platformAdmin.idToken, 'getOrgOwnershipTransfer', {
        orgId: 'transfer-community',
      }),
    ).toMatchObject({ transfer: null });
    await callJson(successor.idToken, 'acceptOrgOwnershipTransfer', {
      orgId: 'transfer-community',
    });
    expect(await readOrgMember('transfer-community', successor.uid)).toMatchObject({ role: 'owner' });
    expect(await readOrgMember('transfer-community', owner.uid)).toMatchObject({ role: 'admin' });

    await seedOrgEvent('transfer-community', 'still-linked', 'private');
    expect(
      await callAs(successor.idToken, 'deleteOrg', {
        orgId: 'transfer-community',
        confirm: 'transfer-community',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('event transfer accepts from a nonmember landing page account', async () => {
    const owner = await createAccount(OWNER);
    const successor = await createAccount(SUCCESSOR);
    const admin = await createAccount(ADMIN);
    await seedCfp(undefined, { ownerUid: owner.uid });
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await seedMember(admin.uid, 'admin', undefined, ADMIN.email);

    await callJson(owner.idToken, 'initiateEventOwnershipTransfer', {
      cfpId: 'devfest-mtl-2026',
      email: SUCCESSOR.email,
    });
    expect(
      await callJson(admin.idToken, 'getEventOwnershipTransfer', {
        cfpId: 'devfest-mtl-2026',
      }),
    ).toMatchObject({ transfer: null });

    await callJson(successor.idToken, 'acceptEventOwnershipTransfer', {
      cfpId: 'devfest-mtl-2026',
    });
    expect(await readCfp()).toMatchObject({
      ownerUid: successor.uid,
    });
    expect(await readMember(successor.uid)).toMatchObject({ role: 'owner' });
    expect(await readMember(owner.uid)).toMatchObject({ role: 'admin' });
  });
});
