import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import {
  createAccount,
  createUnverifiedAccount,
  disableAccount,
  readCfp,
  readMember,
  readSubmissionFormDirect,
  reset,
  setSubmissionFormDirect,
} from './backend';

const run = promisify(execFile);
const PROJECT = 'demo-devfest-cfp';

function seed(id: string, owner: string) {
  return run(
    process.execPath,
    [
      'scripts/seed-cfp.mjs',
      '--id',
      id,
      '--name',
      'Bootstrap test',
      '--opens',
      '2027-01-01',
      '--closes',
      '2027-02-01',
      '--owner',
      owner,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      },
      timeout: 20_000,
    },
  );
}

test.describe('event owner bootstrap', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('refuses absent, unverified, and disabled owner accounts before creating the CFP', async () => {
    await createUnverifiedAccount({
      email: 'unverified-event-owner@example.org',
    });
    const disabledIdentity = {
      sub: 'disabled-event-owner',
      email: 'disabled-event-owner@example.org',
      name: 'Disabled Event Owner',
    };
    const disabled = await createAccount(disabledIdentity);
    await disableAccount(disabled.uid);

    const cases = [
      ['missing-owner-cfp', 'missing-event-owner@example.org', /must sign in and verify/],
      ['unverified-owner-cfp', 'unverified-event-owner@example.org', /verified, enabled account/],
      ['disabled-owner-cfp', disabledIdentity.email, /verified, enabled account/],
    ] as const;
    for (const [id, email, message] of cases) {
      await expect(seed(id, email)).rejects.toMatchObject({
        stderr: expect.stringMatching(message),
      });
      expect(await readCfp(id)).toBeNull();
    }
  });

  test('writes an owner only for a verified, enabled account', async () => {
    const identity = {
      sub: 'verified-event-owner',
      email: 'verified-event-owner@example.org',
      name: 'Verified Event Owner',
    };
    const owner = await createAccount(identity);

    await expect(seed('verified-owner-cfp', identity.email)).resolves.toMatchObject({
      stdout: expect.stringContaining(`owner ${identity.email}`),
    });
    expect(await readCfp('verified-owner-cfp')).toMatchObject({ ownerUids: [owner.uid] });
    expect(await readMember(owner.uid, 'verified-owner-cfp')).toMatchObject({
      role: 'owner',
      email: identity.email,
    });
    const form = await readSubmissionFormDirect('verified-owner-cfp');
    expect(form).toMatchObject({
      attendance: { enabled: false },
      fields: [],
    });
    expect(form?.category).toHaveLength(7);
    expect(form?.format).toHaveLength(3);
    expect(form?.level).toHaveLength(4);
    expect(form?.deliveryLanguage).toHaveLength(4);
    expect(JSON.stringify(form?.attendance)).not.toMatch(/Montréal|Montreal|Canada|GDE/);

    await setSubmissionFormDirect(
      { attendance: { enabled: true, marker: 'organiser-copy' } },
      'verified-owner-cfp',
    );
    await seed('verified-owner-cfp', identity.email);
    expect(await readSubmissionFormDirect('verified-owner-cfp')).toMatchObject({
      attendance: { enabled: true, marker: 'organiser-copy' },
    });
  });
});
