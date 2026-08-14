import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  callPublicJson,
  createAccount,
  createUnverifiedAccount,
  readCfp,
  readOrgMember,
  reset,
  seedCfp,
  seedMember,
  seedOrgEvent,
  seedPlatformMember,
} from './backend';
import type { Identity } from './form';

const OWNER: Identity = {
  sub: 'org-owner',
  email: 'org-owner@example.org',
  name: 'Org Owner',
};
const MEMBER: Identity = {
  sub: 'org-member',
  email: 'org-member@example.org',
  name: 'Org Member',
};

const PLATFORM_ADMIN: Identity = {
  sub: 'other-platform-admin',
  email: 'other-platform-admin@example.org',
  name: 'Other Platform Admin',
};

const creation = (cfpId: string, orgId?: string) => ({
  cfpId,
  name: cfpId.replaceAll('-', ' '),
  visibility: 'private',
  opensAt: new Date(Date.now() - 86_400_000).toISOString(),
  closesAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...(orgId ? { orgId } : {}),
});

test.describe('organization boundaries', () => {
  test.beforeEach(async () => reset());

  test('lets a verified user create one organization and protects owners', async () => {
    const owner = await createAccount(OWNER);
    await callJson(owner.idToken, 'createOrg', {
      name: 'Community',
      slug: 'community',
    });
    expect(await readOrgMember('community', owner.uid)).toMatchObject({ role: 'owner' });
    expect(
      await callAs(owner.idToken, 'createOrg', {
        name: 'Second Community',
        slug: 'second-community',
      }),
    ).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });

    expect(
      await callAs(owner.idToken, 'grantOrgRole', {
        orgId: 'community',
        email: 'missing@example.org',
        role: 'member',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const unverified = await createUnverifiedAccount({ email: 'unverified@example.org' });
    expect(
      await callAs(owner.idToken, 'grantOrgRole', {
        orgId: 'community',
        email: 'unverified@example.org',
        role: 'admin',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readOrgMember('community', unverified.uid)).toBeNull();

    const member = await createAccount(MEMBER);
    expect(
      await callAs(owner.idToken, 'grantOrgRole', {
        orgId: 'community',
        email: MEMBER.email,
        role: 'admin',
      }),
    ).toMatchObject({ ok: true });
    expect(await readOrgMember('community', member.uid)).toMatchObject({ role: 'admin' });

    const listed = await callJson(member.idToken, 'listOrgMembers', { orgId: 'community' });
    expect((listed as { members: Array<{ email: string; role: string }> }).members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: OWNER.email, role: 'owner' }),
        expect.objectContaining({ email: MEMBER.email, role: 'admin' }),
      ]),
    );

    expect(
      await callAs(member.idToken, 'grantOrgRole', {
        orgId: 'community',
        email: OWNER.email,
        role: 'member',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readOrgMember('community', owner.uid)).toMatchObject({ role: 'owner' });
  });

  test('lets platform administrators override and reset one user ownership quota', async () => {
    const owner = await createAccount(OWNER);
    const platformAdmin = await createAccount(PLATFORM_ADMIN);
    await seedPlatformMember(
      platformAdmin.uid,
      'admin',
      PLATFORM_ADMIN.email,
      PLATFORM_ADMIN.name,
    );
    const zeroOrgUser = await createAccount(MEMBER);
    expect(await callJson(platformAdmin.idToken, 'findUserOrgLimit', {
      email: MEMBER.email,
    })).toMatchObject({
      user: {
        uid: zeroOrgUser.uid,
        email: MEMBER.email,
        ownedOrganizationCount: 0,
        organizationLimit: 1,
        hasOverride: false,
      },
    });

    expect(
      await callAs(owner.idToken, 'setPlatformLimitsConfiguration', {
        organizationOwnershipDefault: 3,
      }),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    await callJson(owner.idToken, 'createOrg', { name: 'First Community', slug: 'first-community' });
    expect(await callJson(owner.idToken, 'listMyOrgs', {})).toMatchObject({
      canCreateOrg: false,
      ownershipLimit: 1,
    });

    const changed = await callJson(platformAdmin.idToken, 'setUserOrgLimit', {
      email: OWNER.email,
      limit: 2,
    });
    expect(changed.user).toMatchObject({
      uid: owner.uid,
      email: OWNER.email,
      ownedOrganizationCount: 1,
      organizationLimit: 2,
      hasOverride: true,
    });
    expect(await callJson(owner.idToken, 'listMyOrgs', {})).toMatchObject({
      canCreateOrg: true,
      ownershipLimit: 2,
    });

    await callJson(owner.idToken, 'createOrg', { name: 'Second Community', slug: 'second-community' });
    expect(await callJson(platformAdmin.idToken, 'listUserOrgLimits', {})).toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ uid: owner.uid, ownedOrganizationCount: 2, organizationLimit: 2 }),
      ]),
    });

    await callJson(platformAdmin.idToken, 'setPlatformLimitsConfiguration', {
      organizationOwnershipDefault: 3,
    });
    expect(await callJson(owner.idToken, 'listMyOrgs', {})).toMatchObject({
      canCreateOrg: false,
      ownershipLimit: 2,
    });

    await callJson(platformAdmin.idToken, 'resetUserOrgLimit', { uid: owner.uid });
    expect(await callJson(owner.idToken, 'listMyOrgs', {})).toMatchObject({
      canCreateOrg: true,
      ownershipLimit: 3,
    });
    await callJson(owner.idToken, 'createOrg', { name: 'Third Community', slug: 'third-community' });

    await callJson(platformAdmin.idToken, 'setPlatformLimitsConfiguration', {
      organizationOwnershipDefault: 1,
    });
    expect(await callJson(owner.idToken, 'listMyOrgs', {})).toMatchObject({
      canCreateOrg: false,
      ownershipLimit: 1,
    });
    expect(
      await callAs(owner.idToken, 'createOrg', { name: 'Fourth Community', slug: 'fourth-community' }),
    ).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });
  });

  test('serves only public active events to nonmembers', async () => {
    const owner = await createAccount(OWNER);
    await callJson(owner.idToken, 'createOrg', {
      name: 'Community',
      slug: 'community',
    });
    await seedOrgEvent('community', 'public-event', 'public');
    await seedOrgEvent('community', 'private-event', 'private');
    await seedOrgEvent('community', 'archived-event', 'public', true);

    const { org } = await callPublicJson('getOrg', { orgId: 'community' });
    expect(org).toMatchObject({ id: 'community', name: 'Community' });
    expect(org).not.toHaveProperty('billingEmail');

    const { events } = await callPublicJson('listOrgEvents', { orgId: 'community' });
    expect(events.map((event: { id: string }) => event.id)).toEqual(['public-event']);
  });

  test('keeps organization and platform creation authority separate', async () => {
    const owner = await createAccount(OWNER);
    const orgAdmin = await createAccount(MEMBER);
    const platformAdmin = await createAccount(PLATFORM_ADMIN);
    await seedPlatformMember(
      platformAdmin.uid,
      'admin',
      PLATFORM_ADMIN.email,
      PLATFORM_ADMIN.name,
    );
    await callJson(owner.idToken, 'createOrg', {
      name: 'Community',
      slug: 'community',
    });
    await callJson(owner.idToken, 'grantOrgRole', {
      orgId: 'community',
      email: MEMBER.email,
      role: 'admin',
    });

    expect(
      await callAs(orgAdmin.idToken, 'createCfp', creation('org-admin-call', 'community')),
    ).toMatchObject({ ok: true });
    expect(await readCfp('org-admin-call')).toMatchObject({ orgId: 'community' });

    expect(
      await callAs(orgAdmin.idToken, 'createCfp', creation('second-active-call', 'community')),
    ).toMatchObject({ ok: false, code: 'RESOURCE_EXHAUSTED' });

    expect(
      await callAs(platformAdmin.idToken, 'setOrgActiveEventLimit', {
        orgId: 'community',
        limit: 2,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await callAs(orgAdmin.idToken, 'createCfp', creation('second-active-call', 'community')),
    ).toMatchObject({ ok: true });

    expect(
      await callAs(
        platformAdmin.idToken,
        'createCfp',
        creation('platform-bypass-call', 'community'),
      ),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    await callJson(owner.idToken, 'grantOrgRole', {
      orgId: 'community',
      email: MEMBER.email,
      role: 'member',
    });
    expect(
      await callAs(orgAdmin.idToken, 'createCfp', creation('org-member-call', 'community')),
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('rejects malformed theme colors at the callable boundary', async () => {
    const owner = await createAccount(OWNER);
    await seedCfp(undefined, { ownerUid: owner.uid });
    await seedMember(owner.uid, 'owner');

    expect(
      await callAs(owner.idToken, 'updateCfp', {
        name: 'Community CFP',
        visibility: 'public',
        theme: { primaryColor: 'red' },
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });

    expect(
      await callAs(owner.idToken, 'updateCfp', {
        name: 'Community CFP',
        visibility: 'public',
        theme: { primaryColor: '#FEF08A' },
      }),
    ).toMatchObject({ ok: true });
    expect(await readCfp()).toMatchObject({ theme: { primaryColor: '#fef08a' } });
  });
});
