import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import {
  callJson,
  createAccount,
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

function bootstrap(email: string, remove = false) {
  return run(
    process.execPath,
    [
      'scripts/set-platform-admin.mjs',
      '--email',
      email,
      ...(remove ? ['--remove'] : []),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        GCLOUD_PROJECT: 'demo-devfest-cfp',
        GOOGLE_CLOUD_PROJECT: 'demo-devfest-cfp',
      },
      timeout: 20_000,
    },
  );
}

test.describe('platform admin bootstrap', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('a pending bootstrap grant becomes admin only after verified sign-in', async () => {
    const pending = await bootstrap(FIRST.email);
    expect(pending.stdout).toContain(`Platform admin pending verified sign-in: ${FIRST.email}`);

    const first = await createAccount(FIRST);
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
      canCreateCfp: true,
      isPlatformAdmin: true,
    });
  });

  test('a pending grant cannot replace the last active admin during removal', async () => {
    const first = await createAccount(FIRST);
    expect((await bootstrap(FIRST.email)).stdout).toContain(
      `Platform admin active: ${FIRST.email}`,
    );
    await bootstrap('possibly-mistyped-admin@example.org');

    await expect(bootstrap(FIRST.email, true)).rejects.toMatchObject({
      stderr: expect.stringContaining('Refusing to remove the last platform admin.'),
    });
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
    });

    const second = await createAccount(SECOND);
    await bootstrap(SECOND.email);
    expect((await bootstrap(FIRST.email, true)).stdout).toContain(
      `Platform admin removed: ${FIRST.email}`,
    );
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: null,
    });
    expect(await callJson(second.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
    });
  });

  test('the last-active guard follows the account even if its stored email is stale', async () => {
    const first = await createAccount(FIRST);
    await seedPlatformMember(first.uid, 'admin', 'old-address@example.org', FIRST.name);

    await expect(bootstrap(FIRST.email, true)).rejects.toMatchObject({
      stderr: expect.stringContaining('Refusing to remove the last platform admin.'),
    });
    expect(await callJson(first.idToken, 'platformAccess', {})).toMatchObject({
      role: 'admin',
    });
  });
});
