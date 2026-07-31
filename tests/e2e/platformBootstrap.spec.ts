import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import {
  callJson,
  createAccount,
  createUnverifiedAccount,
  disableAccount,
  reset,
  seedPlatformMember,
} from './backend';

const run = promisify(execFile);
const FIRST = {
  sub: 'bootstrap-first',
  email: 'first-platform-admin@example.org',
  name: 'First Platform Admin',
};
const SECOND = {
  sub: 'bootstrap-second',
  email: 'second-platform-admin@example.org',
  name: 'Second Platform Admin',
};

function bootstrap(
  email: string,
  {
    remove = false,
    role = 'admin',
    project = 'demo-devfest-cfp',
  }: {
    remove?: boolean;
    role?: 'admin' | 'owner';
    project?: string | null;
  } = {},
) {
  const env = { ...process.env };
  if (project) {
    env.GCLOUD_PROJECT = project;
    env.GOOGLE_CLOUD_PROJECT = project;
  } else {
    delete env.GCLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_PROJECT;
  }
  return run(
    process.execPath,
    [
      'scripts/set-platform-admin.mjs',
      '--email',
      email,
      '--role',
      role,
      ...(remove ? ['--remove'] : []),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...env,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      },
      timeout: 20_000,
    },
  );
}

test.describe('platform owner bootstrap', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('refuses to infer a target project from ambient credentials', async () => {
    await expect(bootstrap(FIRST.email, { project: null })).rejects.toMatchObject({
      stderr: expect.stringContaining('Usage: GCLOUD_PROJECT=my-project'),
    });
  });

  test('the default remains a backwards-compatible administrator grant', async () => {
    const pending = await bootstrap(FIRST.email);
    expect(pending.stdout).toContain('Target project: demo-devfest-cfp');
    expect(pending.stdout).toContain(`Platform admin pending verified sign-in: ${FIRST.email}`);

    const first = await createAccount(FIRST);
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
      canCreateCfp: true,
      isPlatformAdmin: true,
      isPlatformOwner: false,
    });
  });

  test('an explicit owner grant safely promotes an existing administrator', async () => {
    const first = await createAccount(FIRST);
    await bootstrap(FIRST.email);
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
    });

    expect((await bootstrap(FIRST.email, { role: 'owner' })).stdout).toContain(
      `Platform owner active: ${FIRST.email}`,
    );
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
      isPlatformAdmin: true,
      isPlatformOwner: true,
    });
    expect(await callJson(first.idToken, 'listPlatformUsers', {})).toMatchObject({
      members: [
        expect.objectContaining({
          uid: first.uid,
          role: 'owner',
          createdBy: 'bootstrap-script',
          grantedBy: 'bootstrap-script',
          roleUpdatedBy: 'bootstrap-script',
        }),
      ],
    });
  });

  test('a pending owner grant becomes active only after verified sign-in', async () => {
    const pending = await bootstrap(FIRST.email, { role: 'owner' });
    expect(pending.stdout).toContain(`Platform owner pending verified sign-in: ${FIRST.email}`);

    const first = await createAccount(FIRST);
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
      isPlatformOwner: true,
    });
  });

  test('a pending owner cannot replace the last active owner during removal', async () => {
    const first = await createAccount(FIRST);
    expect((await bootstrap(FIRST.email, { role: 'owner' })).stdout).toContain(
      `Platform owner active: ${FIRST.email}`,
    );
    await bootstrap('possibly-mistyped-owner@example.org', { role: 'owner' });

    await expect(
      bootstrap(FIRST.email, { role: 'owner', remove: true }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Refusing to remove the last platform owner.'),
    });
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
    });

    const second = await createAccount(SECOND);
    await bootstrap(SECOND.email, { role: 'owner' });
    expect(
      (await bootstrap(FIRST.email, { role: 'owner', remove: true })).stdout,
    ).toContain(`Platform owner removed: ${FIRST.email}`);
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
    });
    expect(await callJson(second.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
    });
  });

  test('the last-owner guard follows the account even if its stored email is stale', async () => {
    const first = await createAccount(FIRST);
    await seedPlatformMember(first.uid, 'owner', 'old-address@example.org', FIRST.name);

    await expect(
      bootstrap(FIRST.email, { role: 'owner', remove: true }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Refusing to remove the last platform owner.'),
    });
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
    });
  });

  test('a legacy last admin remains until a verified, enabled owner is active', async () => {
    const first = await createAccount(FIRST);
    await bootstrap(FIRST.email);

    await seedPlatformMember(
      'deleted-owner',
      'owner',
      'deleted-owner@example.org',
      'Deleted Owner',
    );
    const unverified = await createUnverifiedAccount({
      email: 'unverified-owner@example.org',
    });
    await seedPlatformMember(
      unverified.uid,
      'owner',
      'unverified-owner@example.org',
      'Unverified Owner',
    );
    const disabledIdentity = {
      sub: 'disabled-owner',
      email: 'disabled-owner@example.org',
      name: 'Disabled Owner',
    };
    const disabled = await createAccount(disabledIdentity);
    await disableAccount(disabled.uid);
    await seedPlatformMember(
      disabled.uid,
      'owner',
      disabledIdentity.email,
      disabledIdentity.name,
    );

    await expect(bootstrap(FIRST.email, { remove: true })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Refusing to remove the last usable platform administrator before an owner is active.',
      ),
    });

    const usableIdentity = {
      sub: 'usable-owner',
      email: 'usable-owner@example.org',
      name: 'Usable Owner',
    };
    const usable = await createAccount(usableIdentity);
    await bootstrap(usableIdentity.email, { role: 'owner' });
    expect((await bootstrap(FIRST.email, { remove: true })).stdout).toContain(
      `Platform admin removed: ${FIRST.email}`,
    );
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
    });
    expect(await callJson(usable.idToken, 'platformAccess', {})).toMatchObject({
      role: 'owner',
    });
  });

  test('concurrent owner removals cannot remove both owners', async () => {
    const [first, second] = await Promise.all([createAccount(FIRST), createAccount(SECOND)]);
    await Promise.all([
      bootstrap(FIRST.email, { role: 'owner' }),
      bootstrap(SECOND.email, { role: 'owner' }),
    ]);

    const removals = await Promise.allSettled([
      bootstrap(FIRST.email, { role: 'owner', remove: true }),
      bootstrap(SECOND.email, { role: 'owner', remove: true }),
    ]);
    expect(removals.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(removals.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const roles = await Promise.all([
      callJson(first.idToken, 'platformAccess', {}),
      callJson(second.idToken, 'platformAccess', {}),
    ]);
    expect(roles.filter(({ role }) => role === 'owner')).toHaveLength(1);
    expect(roles.filter(({ role }) => role === null)).toHaveLength(1);
  });
});
