/**
 * The email pipeline, end to end against the emulators.
 *
 * The claims worth proving are the ones that hurt when wrong: nothing gets sent
 * twice, decisions do not leak out one at a time, and a rejection is never
 * queued for someone who withdrew.
 *
 * No API key is configured under the emulator, so the trigger renders and
 * records `dry_run` instead of `sent` — every assertion below is about what the
 * queue did, which is exactly the part we control.
 */

import { expect, test } from '@playwright/test';

import {
  callAs,
  createAccount,
  inviteRole,
  readEmailLog,
  reset,
  seedProposal,
  seedSpeaker,
  setProposalStatusDirect,
  waitForEmail,
} from './backend';
import { signInAs } from './form';

const admin = { sub: 'email-admin', email: 'chair@devfest.test', name: 'Chair' };
const speaker = { sub: 'email-speaker', email: 'ada@example.test', name: 'Ada Lovelace' };

/** An admin who can decide, and a speaker with one submitted talk. */
async function stage(options: { locale?: 'en' | 'fr' } = {}) {
  await reset();

  await inviteRole(admin.email, 'admin');

  const chair = await createAccount(admin);
  const author = await createAccount(speaker);
  await callAs(chair.idToken, 'claimRole', {});

  await seedSpeaker(author.uid, { ...speaker, locale: options.locale });
  await seedProposal('talk-1', {
    speakerUid: author.uid,
    title: 'Notes on the Analytical Engine',
    status: 'submitted',
  });

  return { chair, author };
}

test.describe('email pipeline', () => {
  test('a decision is held until it is released', async () => {
    const { chair } = await stage();

    const decided = await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    expect(decided.ok).toBe(true);

    // Held means held: the trigger sees the write and declines to act on it.
    const held = await waitForEmail((rows) => rows.length > 0, 'the decision to be queued');
    expect(held).toHaveLength(1);
    expect(held[0].kind).toBe('accepted');
    expect(held[0].to).toBe(speaker.email);
    expect(held[0].status).toBe('held');

    // Give the trigger a chance to misbehave before asserting that it did not.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readEmailLog())[0].status).toBe('held');

    const preview = await callAs(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);

    const released = await callAs(chair.idToken, 'emailQueue', { action: 'release' });
    expect(released.ok).toBe(true);

    const sent = await waitForEmail(
      (rows) => rows.every((r) => r.status !== 'held' && r.status !== 'queued'),
      'the released decision to be processed',
    );
    expect(sent[0].status).toBe('dry_run');
    expect(sent[0].attempts).toBe(1);
  });

  test('re-deciding after the send does not send again', async () => {
    const { chair } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    await waitForEmail((r) => r.length > 0, 'the acceptance');
    await callAs(chair.idToken, 'emailQueue', { action: 'release' });
    await waitForEmail((r) => r[0]?.status === 'dry_run', 'the acceptance to go out');

    // An admin flipping a decision back and forth must not re-arm a row that
    // has already left. Row count alone would not catch this — the id is
    // deterministic, so a careless overwrite keeps the count at one while
    // resetting the status to `held` and sending a second time.
    for (let i = 0; i < 3; i++) {
      await callAs(chair.idToken, 'setProposalStatus', {
        proposalId: 'talk-1',
        status: 'accepted',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const rows = await readEmailLog();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('dry_run');
    expect(rows[0].attempts).toBe(1);
  });

  test('a waitlist promotion is its own message', async () => {
    const { chair } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'waitlisted' });
    await waitForEmail((r) => r.some((x) => x.kind === 'waitlisted'), 'the waitlist notice');

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    const rows = await waitForEmail((r) => r.some((x) => x.kind === 'accepted'), 'the promotion');

    expect(rows.map((r) => r.kind).sort()).toEqual(['accepted', 'waitlisted']);
  });

  test('a receipt goes out without waiting for a batch', async () => {
    const { author } = await stage();
    await setProposalStatusDirect('talk-1', 'draft');

    const submitted = await callAs(author.idToken, 'submitProposal', { proposalId: 'talk-1' });
    expect(submitted.ok).toBe(true);

    // Never `held` — a receipt that waited for the decision batch would arrive
    // weeks after the thing it acknowledges.
    const rows = await waitForEmail(
      (r) => r.some((x) => x.kind === 'submission_received' && x.status !== 'queued'),
      'the receipt',
    );
    const receipt = rows.find((r) => r.kind === 'submission_received')!;
    expect(receipt.status).toBe('dry_run');
    expect(receipt.to).toBe(speaker.email);
  });

  test('the language follows the speaker, not the server', async () => {
    const { author } = await stage({ locale: 'fr' });
    await setProposalStatusDirect('talk-1', 'draft');

    await callAs(author.idToken, 'submitProposal', { proposalId: 'talk-1' });
    const rows = await waitForEmail((r) => r.length > 0, 'the receipt');

    expect(rows[0].locale).toBe('fr');
  });

  test('a withdrawn proposal cannot be decided, so no decision is queued', async () => {
    const { chair, author } = await stage();

    const withdrawn = await callAs(author.idToken, 'withdrawProposal', { proposalId: 'talk-1' });
    expect(withdrawn.ok).toBe(true);

    const refused = await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'rejected',
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('FAILED_PRECONDITION');

    const rows = await waitForEmail((r) => r.length > 0, 'the withdrawal notice');
    expect(rows.map((r) => r.kind)).toEqual(['withdrawn']);
  });

  test('the admin panel previews the batch and sends it', async ({ page }) => {
    const { chair } = await stage();
    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'rejected' });

    await signInAs(page, admin, '#/admin');

    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Email' }),
    });

    // The address and the outcome are both on screen before anything is sent —
    // this table is the last chance to catch a rejection in the wrong row.
    await expect(panel.getByText(speaker.email)).toBeVisible();
    await expect(panel.getByText('Not selected')).toBeVisible();

    const send = panel.getByRole('button', { name: /^Send 1 decision/ });
    await expect(send).toBeEnabled();

    page.once('dialog', (d) => d.accept());
    await send.click();

    await expect(panel.getByText('1 messages queued.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Nothing to send' })).toBeDisabled();

    const rows = await waitForEmail((r) => r[0]?.status === 'dry_run', 'the send');
    expect(rows[0].kind).toBe('rejected');
  });

  test('a message rendered before the sender was configured can be recovered', async () => {
    // The whole emulator runs unconfigured, so every send lands on `dry_run`.
    // That is the same state a real receipt would be in if someone submitted
    // between deploying the pipeline and verifying the domain — and it must not
    // be a message that is lost for good.
    const { chair, author } = await stage();
    await setProposalStatusDirect('talk-1', 'draft');
    await callAs(author.idToken, 'submitProposal', { proposalId: 'talk-1' });

    await waitForEmail((r) => r[0]?.status === 'dry_run', 'the unsent receipt');

    const retried = await callAs(chair.idToken, 'emailQueue', { action: 'retry' });
    expect(retried.ok).toBe(true);

    // Requeued and processed again — a second attempt, not a second row.
    const rows = await waitForEmail((r) => r[0]?.attempts === 2, 'the retry');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('submission_received');
  });

  test('the sending address is set from the admin page, not a deploy', async ({ page }) => {
    const { chair } = await stage();

    // Hold the panel's first load open so the typing below is guaranteed to
    // happen while it is still in flight. Without the delay this race only
    // shows up under load, which is to say: in front of a real admin, once.
    let held = false;
    await page.route('**/emailQueue', async (route) => {
      if (!held) {
        held = true;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await route.continue();
    });

    await signInAs(page, admin, '#/admin');
    const panel = page.locator('.section', { has: page.getByRole('heading', { name: 'Email' }) });

    // Unset is called out, because it is the reason nothing is going out.
    await expect(panel.getByText(/No sending address is set/)).toBeVisible();

    // A response that arrives after the cursor does must not empty the field.
    await panel.getByLabel('Send as').fill('typed@example.org');
    await page.waitForTimeout(2500);
    await expect(panel.getByLabel('Send as')).toHaveValue('typed@example.org');
    await page.unroute('**/emailQueue');

    // A display name without brackets is caught before it reaches the server.
    await panel.getByLabel('Send as').fill('DevFest Montréal cfp@example.org');
    await panel.getByRole('button', { name: 'Save address' }).click();
    await expect(panel.getByRole('alert')).toContainText(/angle brackets/);

    await panel.getByLabel('Send as').fill('DevFest Montréal <cfp@example.org>');
    await panel.getByLabel('Reply-to').fill('organisers@example.org');
    await panel.getByRole('button', { name: 'Save address' }).click();

    // Wait for the save to land, not for the banner to clear — the banner keys
    // off what has been typed, so it goes the moment the field is filled and
    // would let this reload race the write.
    await expect(panel.getByText('Saved.')).toBeVisible();

    // It survives a reload, so it is stored rather than held in the page.
    await page.reload();
    await expect(panel.getByLabel('Send as')).toHaveValue('DevFest Montréal <cfp@example.org>');

    // And it reaches the sender: still no API key here, so this gets as far as
    // `dry_run` — but through the stored settings rather than the environment.
    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    await callAs(chair.idToken, 'emailQueue', { action: 'release' });
    const rows = await waitForEmail((r) => r[0]?.status === 'dry_run', 'the send');
    expect(rows).toHaveLength(1);
  });

  test('a non-admin cannot change who the CFP writes as', async () => {
    const { author } = await stage();
    const result = await callAs(author.idToken, 'setEmailSettings', {
      from: 'attacker@evil.example',
      replyTo: '',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
  });

  test('only an admin may work the queue', async () => {
    const { author } = await stage();

    for (const action of ['preview', 'release', 'retry'] as const) {
      const result = await callAs(author.idToken, 'emailQueue', { action });
      expect(result.ok, action).toBe(false);
      expect(result.code, action).toBe('PERMISSION_DENIED');
    }
  });
});
