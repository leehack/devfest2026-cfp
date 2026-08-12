import { expect, test } from '@playwright/test';
import {
  clearAuth,
  clearFirestore,
  callAs,
  callJson,
  createAccount,
  readCfp,
  reset,
  seedCfp,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, type Identity } from './form';

const day = 24 * 60 * 60 * 1000;
const SPEAKER: Identity = { sub: 'window-speaker', email: 'window@example.org', name: 'Sam' };
const ADMIN: Identity = { sub: 'window-admin', email: 'window-admin@example.org', name: 'Ada' };

test.describe('the submission window', () => {
  test('a temporary CFP lookup failure can be retried', async ({ page }) => {
    await reset();
    let unavailable = true;
    await page.route('http://127.0.0.1:8080/**', (route) =>
      unavailable ? route.abort() : route.continue(),
    );

    await page.goto(at());
    await expect(
      page.getByText('That service is unavailable right now. Please try again shortly.'),
    ).toBeVisible();

    unavailable = false;
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('a CFP that does not exist reads as absent, not as open', async ({ page }) => {
    // The failure that matters: a missing tenant should never mean "wide open".
    // It reads differently from a closed one on purpose — a mistyped address and
    // a shut window are different problems with different fixes.
    await clearFirestore();
    await clearAuth();
    await page.goto(at());
    await expect(
      page.getByText('There is no call for proposals at this address.'),
    ).toBeVisible();
    await expect(
      page.locator('#main-content').getByRole('button', { name: 'Sign in with Google' }),
    ).toHaveCount(0);
  });

  test('an archived CFP is shut, whatever its dates say', async ({ page }) => {
    await reset();
    await seedCfp(undefined, { archived: true });
    await page.goto(at());
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
  });

  test('concurrent partial window edits cannot combine into close-before-open', async () => {
    await reset({
      opensAt: new Date('2030-01-01T00:00:00.000Z'),
      closesAt: new Date('2030-01-10T00:00:00.000Z'),
    });
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', undefined, ADMIN.email);

    const results = await Promise.all([
      callAs(admin.idToken, 'setCfpWindow', { opensAt: '2030-01-08T00:00:00.000Z' }),
      callAs(admin.idToken, 'setCfpWindow', { closesAt: '2030-01-05T00:00:00.000Z' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => result.code === 'INVALID_ARGUMENT')).toHaveLength(1);

    const cfp = await readCfp();
    expect(new Date(cfp!.closesAt).getTime()).toBeGreaterThan(new Date(cfp!.opensAt).getTime());
  });

  test('a published programme can prepare and save a seven-calendar-day late intake', async ({
    page,
  }) => {
    await reset({
      opensAt: new Date('2026-01-01T17:00:00.000Z'),
      closesAt: new Date('2026-02-01T17:00:00.000Z'),
    });
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', undefined, ADMIN.email);

    let schedule = await callJson(admin.idToken, 'setScheduleConfig', {
      expectedRevision: 0,
      config: {
        timeZone: 'America/Toronto',
        revision: 0,
        days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
        rooms: [{ id: 'main', name: { en: 'Main room', fr: 'Salle principale' } }],
      },
    });
    schedule = await callJson(admin.idToken, 'upsertScheduleEntry', {
      expectedRevision: schedule.revision,
      entry: {
        id: 'welcome',
        kind: 'custom',
        customType: 'other',
        title: { en: 'Welcome', fr: 'Bienvenue' },
        date: '2026-11-14',
        startsAt: '09:00',
        durationMinutes: 20,
        roomId: 'main',
      },
    });
    const shared = await callJson(admin.idToken, 'shareSchedulePreview', {
      expectedRevision: schedule.revision,
    });
    await callJson(admin.idToken, 'publishSchedule', { expectedRevision: shared.revision });
    await callJson(admin.idToken, 'setCfpWindow', { paused: true, reviewsVisible: true });

    await signInAs(page, ADMIN, at('/admin/settings'));
    const prepare = page.getByRole('button', { name: 'Prepare a 7-day late intake' });
    await expect(prepare).toBeVisible();

    const realNow = new Date();
    await page.clock.setFixedTime(new Date('2026-10-31T16:00:00.000Z'));
    await prepare.click();
    await expect(page.getByRole('textbox', { name: /^Opens\b/ })).toHaveValue(
      '2026-10-31T12:00',
    );
    await expect(page.getByRole('textbox', { name: /^Closes\b/ })).toHaveValue(
      '2026-11-07T12:00',
    );
    await expect(page.getByRole('checkbox', { name: /Pause submissions now/ })).not.toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: /Let reviewers see each other’s scores/ }),
    ).not.toBeChecked();

    await page.clock.setFixedTime(realNow);
    await page.getByRole('button', { name: 'Save window' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await readCfp())?.opensAt)
      .toBe('2026-10-31T16:00:00Z');
    await expect
      .poll(async () => (await readCfp())?.closesAt)
      .toBe('2026-11-07T17:00:00Z');
    expect(
      (Date.parse((await readCfp())!.closesAt) - Date.parse((await readCfp())!.opensAt)) /
        3_600_000,
    ).toBe(169);
  });

  test('before it opens, says so and gives the date', async ({ page }) => {
    await reset({ opensAt: new Date(Date.now() + 10 * day) });
    await page.goto(at());
    await expect(page.getByText('The call for proposals is not open yet.')).toBeVisible();
    await expect(page.getByText('It opens on')).toBeVisible();
  });

  test('after it closes, says so and gives the date', async ({ page }) => {
    await reset({ closesAt: new Date(Date.now() - day) });
    await page.goto(at());
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
    await expect(page.getByText('It closed on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('paused is its own message, not "closed"', async ({ page }) => {
    await reset({ paused: true });
    await page.goto(at());
    await expect(page.getByText(/paused/)).toBeVisible();
  });

  test('a paused draft is kept for reopening instead of described as closed', async ({ page }) => {
    await reset({ paused: true });
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedProposal('paused-draft', {
      speakerUid: speaker.uid,
      title: 'A paused draft',
      status: 'draft',
    });

    await signInAs(page, SPEAKER);
    await expect(
      page.getByRole('heading', { name: 'Submissions are temporarily paused' }),
    ).toBeVisible();
    await expect(page.getByText('This draft was not submitted')).toHaveCount(0);
  });

  test('open shows the deadline before asking anyone to sign in', async ({ page }) => {
    await reset();
    await page.goto(at());
    await expect(page.getByText('Submissions close on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('an open call still opens the only decided proposal instead of a blank form', async ({
    page,
  }) => {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedProposal('only-rejected', {
      speakerUid: speaker.uid,
      title: 'The proposal with a decision',
      status: 'rejected',
    });

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveValue(
      'The proposal with a decision',
    );
    await expect(page.getByRole('heading', { name: 'Rejected', exact: true })).toBeVisible();
  });

  test('a closed call does not offer a new proposal after sign-in', async ({ page }) => {
    await reset({ closesAt: new Date(Date.now() - day) });
    await signInAs(page, SPEAKER);

    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveCount(0);
  });

  test('a closed call opens the talk that needs a response ahead of an old draft', async ({
    page,
  }) => {
    await reset({ closesAt: new Date(Date.now() - day) });
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedProposal('a-old-draft', {
      speakerUid: speaker.uid,
      title: 'Unfinished draft',
      status: 'draft',
    });
    await seedProposal('z-accepted', {
      speakerUid: speaker.uid,
      title: 'Talk needing an answer',
      status: 'accepted',
    });

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('heading', { name: 'Accepted' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, I can present' })).toBeVisible();
  });

  for (const fixture of [
    {
      state: 'closed',
      status: 'accepted',
      arrange: () => reset({ closesAt: new Date(Date.now() - day) }),
      action: 'Yes, I can present',
    },
    {
      state: 'paused',
      status: 'confirmed',
      arrange: () => reset({ paused: true }),
      action: 'I have to decline',
    },
  ] as const) {
    test(`an existing ${fixture.status} proposal stays reachable when the call is ${fixture.state}`, async ({
      page,
    }) => {
      await fixture.arrange();
      const speaker = await createAccount(SPEAKER);
      await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
      await seedProposal(`p-${fixture.state}`, {
        speakerUid: speaker.uid,
        title: `${fixture.state} proposal`,
        status: fixture.status,
      });

      await signInAs(page, SPEAKER);
      await expect(page.getByRole('heading', { name: new RegExp(fixture.status, 'i') })).toBeVisible();
      await expect(page.getByRole('button', { name: fixture.action })).toBeVisible();
    });
  }

  test('an archived response stays visible but frozen', async ({ page }) => {
    await reset();
    await seedCfp(undefined, { archived: true });
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
    await seedProposal('p-archived', {
      speakerUid: speaker.uid,
      title: 'Archived proposal',
      status: 'declined',
    });

    await signInAs(page, SPEAKER);
    await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, I can present' })).toHaveCount(0);
  });
});
