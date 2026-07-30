import { expect, test } from '@playwright/test';
import {
  clearAuth,
  clearFirestore,
  createAccount,
  reset,
  seedCfp,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, type Identity } from './form';

const day = 24 * 60 * 60 * 1000;
const SPEAKER: Identity = { sub: 'window-speaker', email: 'window@example.org', name: 'Sam' };

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
    await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  });

  test('an archived CFP is shut, whatever its dates say', async ({ page }) => {
    await reset();
    await seedCfp(undefined, { archived: true });
    await page.goto(at());
    await expect(page.getByText('The call for proposals has closed.')).toBeVisible();
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

  test('open shows the deadline before asking anyone to sign in', async ({ page }) => {
    await reset();
    await page.goto(at());
    await expect(page.getByText('Submissions close on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Declined' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, I can present' })).toHaveCount(0);
  });
});
