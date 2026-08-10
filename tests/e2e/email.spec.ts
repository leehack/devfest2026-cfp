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
  callJson,
  createAccount,
  inviteRole,
  readEmailLog,
  reset,
  seedEmailLog,
  seedProposal,
  seedSpeaker,
  setEmailStatusDirect,
  setSendingDomainDirect,
  setProposalStatusDirect,
  waitForEmail,
} from './backend';
import { at, signInAs } from './form';

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
    // What the committee sees. `speakers/{uid}` is global and not theirs to
    // read; the snapshot on the proposal is.
    speaker: { name: speaker.name },
  });

  return { chair, author };
}

function heldLogIds(preview: { held?: Array<{ logId: string }> }): string[] {
  return (preview.held ?? []).map((row) => row.logId);
}

async function releaseCurrentBatch(idToken: string) {
  const preview = await callJson(idToken, 'emailQueue', { action: 'preview' });
  return callJson(idToken, 'emailQueue', {
    action: 'release',
    logIds: heldLogIds(preview),
  });
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

    // Resend is only for a message that has already left the reviewed batch.
    // A direct call must not turn one held decision into an early notification.
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__talk-1',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readEmailLog())[0].status).toBe('held');

    // Give the trigger a chance to misbehave before asserting that it did not.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readEmailLog())[0].status).toBe('held');

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 1,
    });
    expect(await callAs(chair.idToken, 'emailQueue', { action: 'release' })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
    });

    const released = await callAs(chair.idToken, 'emailQueue', {
      action: 'release',
      logIds: heldLogIds(preview),
    });
    expect(released.ok).toBe(true);

    const sent = await waitForEmail(
      (rows) => rows.every((r) => r.status !== 'held' && r.status !== 'queued'),
      'the released decision to be processed',
    );
    expect(sent[0].status).toBe('dry_run');
    expect(sent[0].attempts).toBe(1);
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 0,
    });
  });

  /*
   * The reversal case, which is the reason decisions are held rather than sent
   * on the spot. Releasing used to queue every held row without re-reading the
   * proposal, so a decision taken back during the window went out anyway —
   * telling somebody they were accepted after the committee had undone it.
   */
  test('a decision taken back before release is not sent', async ({ page }) => {
    const { chair } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    const held = await waitForEmail((rows) => rows.length > 0, 'the decision to be queued');
    expect(held[0].status).toBe('held');

    // The committee changes its mind while the batch is still waiting.
    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'under_review',
    });

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview).toMatchObject({ ok: true, held: [], staleHeld: 1 });
    expect(preview.tally['held:accepted']).toBeUndefined();
    expect(preview.rows[0]).toMatchObject({ status: 'held', stale: true });
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 0,
    });

    await signInAs(page, admin, at('/admin/email'));
    await expect(page.getByRole('button', { name: 'Nothing to send' })).toBeDisabled();
    await expect(page.getByText(/Superseded notifications retained: 1/)).toBeVisible();
    await expect(page.getByText('Retained — superseded')).toBeVisible();
    // The audit row keeps the action in place so the reason it cannot be used
    // is visible, but the UI calls that action “Send again”.
    await expect(page.getByRole('button', { name: 'Send again' })).toBeDisabled();
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__talk-1',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const released = await callJson(chair.idToken, 'emailQueue', {
      action: 'release',
      logIds: ['accepted__talk-1'],
    });
    expect(released).toMatchObject({ ok: true, released: 0, stale: 1 });

    // Still held, not sent and not destroyed: re-accepting must be able to
    // release it normally rather than leave the speaker with no answer at all.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readEmailLog())[0].status).toBe('held');

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    expect(await releaseCurrentBatch(chair.idToken)).toMatchObject({
      released: 1,
      stale: 0,
    });
    await waitForEmail((rows) => rows[0]?.status === 'dry_run', 'the restored decision attempt');

    // A provider failure or dry run can outlive the decision too. Retry must
    // apply the same freshness check as the original batch release.
    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'under_review',
    });
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'retry' })).toMatchObject({
      released: 0,
      stale: 1,
    });
    expect((await readEmailLog())[0].status).toBe('dry_run');
  });

  test('two admins releasing the same batch still send each email once', async () => {
    const { chair } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await waitForEmail((rows) => rows[0]?.status === 'held', 'the held acceptance');

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const release = { action: 'release', logIds: heldLogIds(preview) };
    const releases = await Promise.all([
      callJson(chair.idToken, 'emailQueue', release),
      callJson(chair.idToken, 'emailQueue', release),
    ]);
    expect(releases.reduce((total, result) => total + result.released, 0)).toBe(1);

    const rows = await waitForEmail(
      (all) => all[0]?.status === 'dry_run',
      'the single release attempt',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(1);
  });

  test('a decision added after preview stays held for the next reviewed batch', async () => {
    const { chair, author } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await waitForEmail((rows) => rows[0]?.status === 'held', 'the reviewed acceptance');
    const reviewed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(heldLogIds(reviewed)).toEqual(['accepted__talk-1']);

    await seedProposal('talk-2', {
      speakerUid: author.uid,
      title: 'Computing Bernoulli Numbers',
      status: 'submitted',
      speaker: { name: speaker.name },
    });
    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-2',
      status: 'rejected',
    });
    await waitForEmail((rows) => rows.length === 2, 'the later decision');

    expect(
      await callJson(chair.idToken, 'emailQueue', {
        action: 'release',
        logIds: heldLogIds(reviewed),
      }),
    ).toMatchObject({ released: 1, stale: 0 });

    const rows = await waitForEmail(
      (emailRows) =>
        emailRows.some((row) => row.id === 'accepted__talk-1' && row.status === 'dry_run') &&
        emailRows.some((row) => row.id === 'rejected__talk-2' && row.status === 'held'),
      'only the reviewed decision to be sent',
    );
    expect(rows.find((row) => row.id === 'rejected__talk-2')?.attempts ?? 0).toBe(0);
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 1,
    });
  });

  test('re-deciding after the send does not send again', async () => {
    const { chair } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    await waitForEmail((r) => r.length > 0, 'the acceptance');
    await releaseCurrentBatch(chair.idToken);
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
    // weeks after the thing it acknowledges. Wait through the trigger's
    // short-lived `sending` state before asserting its terminal result.
    const rows = await waitForEmail(
      (r) => r.some((x) => x.kind === 'submission_received' && x.status === 'dry_run'),
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

    await signInAs(page, admin, at('/admin/email'));

    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Email' }),
    });

    // The address and the outcome are both on screen before anything is sent —
    // this table is the last chance to catch a rejection in the wrong row.
    // Scoped to the held table: the sent-log below lists the same address.
    const queued = panel
      .locator('.table--held')
      .getByRole('row', { name: new RegExp(speaker.email) });
    await expect(queued).toBeVisible();
    await expect(queued).toContainText('Not selected');
    const heldLog = panel
      .locator('.email-log-table')
      .getByRole('row', { name: new RegExp(speaker.email) });
    await expect(heldLog.getByRole('button', { name: 'Send again' })).toBeDisabled();

    const send = panel.getByRole('button', { name: 'Send 1 notification' });
    await expect(send).toBeEnabled();

    page.once('dialog', (d) => d.accept());
    await send.click();

    await expect(panel.getByText('1 email queued.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Nothing to send' })).toBeDisabled();

    const rows = await waitForEmail((r) => r[0]?.status === 'dry_run', 'the send');
    expect(rows[0].kind).toBe('rejected');
  });

  test('a saved decision is visibly pending until an admin reviews the email batch', async ({
    page,
  }) => {
    await stage();
    await signInAs(page, admin, at('/admin/proposals'));

    await page
      .getByLabel('Status: Notes on the Analytical Engine')
      .selectOption('accepted');

    await expect(page.getByText('Decision saved. This action does not send an email.')).toBeVisible();
    const notice = page.locator('.pending-email-notice');
    await expect(notice).toContainText('1 speaker notification is waiting');
    await expect(
      page.getByRole('link', { name: 'Email, 1 speaker notification waiting' }),
    ).toBeVisible();

    await notice.getByRole('link', { name: 'Review and send' }).click();
    await expect(page).toHaveURL(new RegExp('/admin/email$'));

    const queue = page.locator('.email-queue-card');
    await expect(queue.getByRole('heading', { name: 'Held speaker notifications' })).toBeVisible();
    await expect(queue.getByRole('row', { name: new RegExp(speaker.email) })).toContainText(
      'Accepted',
    );

    const send = queue.getByRole('button', { name: 'Send 1 notification' });
    page.once('dialog', (dialog) => dialog.accept());
    await send.click();

    await expect(queue.getByText('1 email queued.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Email, 1 speaker notification waiting/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.pending-email-notice')).toHaveCount(0);
  });

  test('a failed queue refresh still guides the admin after a saved decision', async ({ page }) => {
    await stage();
    const initialSummary = page.waitForResponse(
      (response) =>
        response.url().includes('/emailQueue') &&
        response.request().postData()?.includes('"summary"') === true,
    );
    await signInAs(page, admin, at('/admin/proposals'));
    await initialSummary;

    await page.route('**/emailQueue', (route) => route.abort());
    await page
      .getByLabel('Status: Notes on the Analytical Engine')
      .selectOption('accepted');

    await expect(page.getByText('Decision saved. This action does not send an email.')).toBeVisible();
    const notice = page.locator('.pending-email-notice--unknown');
    await expect(notice).toContainText('Email queue status unavailable');
    await expect(notice.getByRole('link', { name: 'Review and send' })).toBeVisible();
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
    const rows = await waitForEmail(
      (r) => r.some((row) => row.kind === 'submission_received' && row.attempts === 2),
      'the retry',
    );
    const receipts = rows.filter((row) => row.kind === 'submission_received');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].attempts).toBe(2);
  });

  test('the sending address is set from the admin page, not a deploy', async ({ page }) => {
    const { chair } = await stage();
    await setSendingDomainDirect('example.org');

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

    await signInAs(page, admin, at('/admin/email'));
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

    // An address on a domain this CFP never registered is refused by the
    // server. The Resend account is shared, so otherwise one organiser could
    // send mail signed by another organiser's event.
    await panel.getByLabel('Send as').fill('cfp@someone-elses.example');
    await panel.getByRole('button', { name: 'Save address' }).click();
    await expect(panel.getByRole('alert')).toContainText(/someone-elses.example/);

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
    await releaseCurrentBatch(chair.idToken);
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

  test('the API key is admin-only and never comes back', async () => {
    const { chair, author } = await stage();

    for (const name of ['setEmailSecret', 'emailDomain', 'sendTestEmail'] as const) {
      const result = await callAs(author.idToken, name, { apiKey: 're_x', action: 'list' });
      expect(result.ok, name).toBe(false);
      expect(result.code, name).toBe('PERMISSION_DENIED');
    }

    // A key that is not even shaped like one is refused before it reaches Resend.
    const bad = await callAs(chair.idToken, 'setEmailSecret', { apiKey: 'sk_not_resend' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('INVALID_ARGUMENT');

    // Nothing on the admin surface hands the key back — only the last four.
    const preview = await callAs(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('re_');
  });

  test('custom wording reaches the sender, and a broken one cannot be saved', async () => {
    const { chair, author } = await stage();

    const rejected = await callAs(chair.idToken, 'setEmailTemplate', {
      kind: 'accepted',
      locale: 'en',
      subject: 'Hi {speeker}',
      body: 'x',
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('INVALID_ARGUMENT');

    const blank = await callAs(chair.idToken, 'setEmailTemplate', {
      kind: 'accepted',
      locale: 'en',
      subject: 'Fine',
      body: '   ',
    });
    expect(blank.ok).toBe(false);

    const saved = await callAs(chair.idToken, 'setEmailTemplate', {
      kind: 'submission_received',
      locale: 'en',
      subject: 'Got it: {title}',
      body: 'Hi {speakerName}, we have it.',
    });
    expect(saved.ok).toBe(true);

    // The proof is what the sender renders, not what the editor shows.
    await setProposalStatusDirect('talk-1', 'draft');
    await callAs(author.idToken, 'submitProposal', { proposalId: 'talk-1' });
    await waitForEmail((r) => r[0]?.status === 'dry_run', 'the receipt');

    const preview = await callAs(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);

    const reset = await callAs(chair.idToken, 'setEmailTemplate', {
      kind: 'submission_received',
      locale: 'en',
      reset: true,
    });
    expect(reset.ok).toBe(true);
  });

  test('changing admin tabs does not discard unsaved email wording', async ({ page }) => {
    await stage();
    await signInAs(page, admin, at('/admin/email'));

    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Email' }),
    });
    await panel.getByLabel('Edit the wording').check();
    const subject = panel.getByLabel('Subject line');
    await subject.fill('A carefully revised acceptance for {event}');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Committee', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/email$'));
    await expect(subject).toHaveValue('A carefully revised acceptance for {event}');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Committee', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/committee$'));
  });

  test('a late email refresh does not overwrite wording being typed', async ({ page }) => {
    await stage();

    let first = true;
    await page.route('**/emailQueue', async (route) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await signInAs(page, admin, at('/admin/email'));
    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Email' }),
    });
    await panel.getByLabel('Edit the wording').check();
    const subject = panel.getByLabel('Subject line');
    await subject.fill('Do not replace this draft for {event}');

    // The first queue snapshot now lands with a fresh templates object. The
    // draft remains authoritative until the organiser saves or discards it.
    await page.waitForTimeout(1800);
    await expect(subject).toHaveValue('Do not replace this draft for {event}');
    await page.unroute('**/emailQueue');
  });

  test('sender and one-off message drafts both guard admin navigation', async ({ page }) => {
    await stage();
    await signInAs(page, admin, at('/admin/email'));
    const panel = page.locator('.section', {
      has: page.getByRole('heading', { name: 'Email' }),
    });

    const from = panel.getByLabel('Send as');
    await from.fill('typed@example.org');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Committee', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/email$'));
    await expect(from).toHaveValue('typed@example.org');

    // Return the sender to its stored value. The message is now the only dirty
    // surface, so this proves the parent aggregates the two independently.
    await from.fill('');
    const subject = panel.getByRole('textbox', { name: /^Subject/ });
    const body = panel.getByRole('textbox', { name: /^Message/ });
    await subject.fill('A schedule question');
    await body.fill('Would 10:00 work for you?');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Committee', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/email$'));
    await expect(subject).toHaveValue('A schedule question');
    await expect(body).toHaveValue('Would 10:00 work for you?');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Committee', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/admin/committee$'));
  });

  test('email setup stays unavailable until its first preview succeeds', async ({ page }) => {
    await stage();
    await signInAs(page, admin, at('/admin/committee'));
    await page.route('**/emailQueue', (route) => route.abort());
    await page.getByRole('link', { name: 'Email', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(page.getByLabel('Send as')).toHaveCount(0);
    await expect(page.getByLabel('Edit the wording')).toHaveCount(0);

    await page.unroute('**/emailQueue');
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByLabel('Send as')).toBeEnabled();
  });

  test('a non-admin cannot rewrite what applicants are told', async () => {
    const { author } = await stage();
    const result = await callAs(author.idToken, 'setEmailTemplate', {
      kind: 'rejected',
      locale: 'en',
      subject: 'x',
      body: 'y',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
  });

  test('only an admin may work the queue', async () => {
    const { author } = await stage();

    for (const action of [
      'readiness',
      'summary',
      'preview',
      'release',
      'retry',
      'resend',
    ] as const) {
      const result = await callAs(author.idToken, 'emailQueue', { action, logId: 'x' });
      expect(result.ok, action).toBe(false);
      expect(result.code, action).toBe('PERMISSION_DENIED');
    }
  });

  test('the setup checklist reads configuration without returning delivery history', async () => {
    const { chair } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });

    const readiness = await callJson(chair.idToken, 'emailQueue', {
      action: 'readiness',
    });
    expect(readiness).toMatchObject({
      ok: true,
      keyHint: '',
      domainId: '',
      domain: '',
    });
    expect(readiness).toHaveProperty('settings');
    expect(readiness).not.toHaveProperty('rows');
    expect(readiness).not.toHaveProperty('held');
    expect(readiness).not.toHaveProperty('tally');
  });

  test('the queue says who was written to, and what came of it', async () => {
    const { chair } = await stage();
    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    await releaseCurrentBatch(chair.idToken);
    await waitForEmail((r) => r[0]?.status === 'dry_run', 'the send');

    const { rows } = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    // Counts alone could not answer "did this speaker get their acceptance".
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to: speaker.email,
      kind: 'accepted',
      status: 'dry_run',
      logId: 'accepted__talk-1',
    });
  });

  test('a sent message can be sent again, deliberately', async () => {
    const { chair } = await stage();
    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    await releaseCurrentBatch(chair.idToken);
    await waitForEmail((r) => r[0]?.status === 'dry_run', 'the first send');
    expect((await readEmailLog())[0].attempts).toBe(1);

    // The deterministic id stops an accidental second copy, which also stopped
    // a deliberate one — an address that bounced had no route back.
    const again = await callAs(chair.idToken, 'emailQueue', {
      action: 'resend',
      logId: 'accepted__talk-1',
    });
    expect(again.ok).toBe(true);

    await waitForEmail((r) => r[0]?.attempts === 2, 'the resend');
    const rows = await readEmailLog();
    // Re-queued, not recreated: one row, still the record of what was sent.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('dry_run');
  });

  test('a message already in flight is not re-queued underneath the trigger', async () => {
    const { chair } = await stage();
    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });

    /*
     * A held row belongs to the batch-release path and is covered above. An
     * in-flight row belongs to the trigger, and re-queueing one mid-send is how
     * the same person gets two copies in the same minute.
     *
     * Tested at `sending` rather than `queued`: the guard treats them alike,
     * but writing `queued` wakes the very trigger this is trying to out-race,
     * so the row can reach `dry_run` before the callable reads it. `sending` is
     * the state the trigger will not touch, so the refusal is the same every
     * time rather than only when the machine is quiet.
     */
    await setEmailStatusDirect('accepted__talk-1', 'sending');
    const refused = await callAs(chair.idToken, 'emailQueue', {
      action: 'resend',
      logId: 'accepted__talk-1',
    });
    expect(refused).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('an expired in-flight message is visibly recoverable from the email workspace', async ({
    page,
  }) => {
    await stage();
    await seedEmailLog('stalled-receipt', {
      status: 'sending',
      kind: 'submission_received',
      proposalId: 'talk-1',
      attempts: 1,
      sendingClaimId: 'abandoned-claim',
      sendingStartedAt: new Date(Date.now() - 11 * 60 * 1_000),
    });

    await signInAs(page, admin);
    await page.goto(at('/admin/email'));
    await expect(page.getByText('Delivery stalled — retry available')).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry 1 unsent' });
    await expect(retry).toBeEnabled();
    await retry.click();

    await expect
      .poll(async () => (await readEmailLog()).find((row) => row.id === 'stalled-receipt'))
      .toMatchObject({ status: 'dry_run', attempts: 2 });
    await expect(page.getByText('Delivery stalled — retry available')).toHaveCount(0);
  });

  test('resending something that was never queued says so', async () => {
    const { chair } = await stage();
    expect(
      await callAs(chair.idToken, 'emailQueue', { action: 'resend', logId: 'accepted__nope' }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

/**
 * A message an organiser writes themselves.
 *
 * Its id is Firestore's rather than derived from the content, which deliberately
 * gives up the dedupe every other kind gets — so the claims worth proving are
 * that repeats really do repeat, and that nobody but an admin can send one.
 */
test.describe('a message to one speaker', () => {
  const message = { subject: 'About your room', body: 'Hi {speakerName}, quick question.' };

  test('keeps the composer closed until a failed proposal load is retried', async ({ page }) => {
    await stage();
    await signInAs(page, admin, at('/admin/committee'));
    // Finish the role and committee reads before isolating the composer's
    // proposal query; otherwise the outage would stop the admin page itself.
    await expect(page.getByRole('combobox', { name: `Role for ${admin.name}` })).toBeVisible();
    let unavailable = true;
    await page.route('http://127.0.0.1:8080/**', (route) => {
      const proposalQuery = (route.request().postData() ?? '').includes(
        '"collectionId":"proposals"',
      );
      return unavailable && proposalQuery ? route.abort() : route.continue();
    });

    await page.getByRole('link', { name: 'Email', exact: true }).click();

    const panel = page.getByRole('region', { name: 'Write to a speaker' });
    await expect(
      panel.getByText('That service is unavailable right now. Please try again shortly.'),
    ).toBeVisible();
    await expect(panel.getByLabel('Talk')).toHaveCount(0);

    unavailable = false;
    await panel.getByRole('button', { name: 'Reload' }).click();
    await expect(panel.getByLabel('Talk')).toContainText(
      `Notes on the Analytical Engine — ${speaker.name}`,
    );
  });

  test('is queued, sent, and carries the copy that was typed', async () => {
    const { chair } = await stage();

    const sent = await callJson(chair.idToken, 'sendSpeakerMessage', {
      proposalId: 'talk-1',
      ...message,
    });
    expect(sent.logId).toBeTruthy();

    // On the terminal status, not merely on the row: it is created `queued`, so
    // waiting for its existence would race the trigger that renders it.
    const rows = await waitForEmail(
      (all) => all.some((r) => r.kind === 'message' && r.status === 'dry_run'),
      'the message',
    );
    const row = rows.find((r) => r.kind === 'message')!;
    expect(row).toMatchObject({
      to: speaker.email,
      subject: message.subject,
      body: message.body,
      // No API key under the emulator, so the trigger renders and records this
      // rather than claiming a delivery it did not make.
      status: 'dry_run',
    });
  });

  test('two of them are two emails, not one overwritten row', async () => {
    const { chair } = await stage();

    await callJson(chair.idToken, 'sendSpeakerMessage', { proposalId: 'talk-1', ...message });
    await callJson(chair.idToken, 'sendSpeakerMessage', {
      proposalId: 'talk-1',
      subject: 'One more thing',
      body: 'Sorry — also this.',
    });

    const rows = await waitForEmail(
      (all) => all.filter((r) => r.kind === 'message' && r.status === 'dry_run').length === 2,
      'both messages',
    );
    const subjects = rows.filter((r) => r.kind === 'message').map((r) => r.subject).sort();
    expect(subjects).toEqual(['About your room', 'One more thing']);
  });

  test('only an admin can write to a speaker', async () => {
    const { author } = await stage();
    await inviteRole('rev@example.test', 'reviewer');
    const reviewer = await createAccount({ sub: 'msg-rev', email: 'rev@example.test', name: 'Rev' });
    await callAs(reviewer.idToken, 'claimRole', {});

    for (const who of [reviewer, author]) {
      expect(
        await callAs(who.idToken, 'sendSpeakerMessage', { proposalId: 'talk-1', ...message }),
      ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
    expect(await readEmailLog()).toHaveLength(0);
  });

  test('a draft is not something to write to anyone about', async () => {
    const { chair, author } = await stage();
    await seedProposal('talk-draft', {
      speakerUid: author.uid,
      title: 'Half an idea',
      status: 'draft',
    });

    // Writing about an unsubmitted talk tells its author it was read.
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', { proposalId: 'talk-draft', ...message }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readEmailLog()).toHaveLength(0);
  });

  test('the admin panel composes one and shows it in the log', async ({ page }) => {
    await stage();
    await signInAs(page, admin, at('/admin/email'));

    const panel = page.locator('.section', { has: page.getByRole('heading', { name: 'Email' }) });
    const send = panel.getByRole('button', { name: 'Send message' });

    // Nothing to send until there is somebody to send it to and something to
    // say — a message with a blank body is only ever a slip.
    await expect(send).toBeDisabled();

    const talk = panel.getByLabel('Talk');
    // The picker names the speaker as well as the talk — an organiser choosing
    // who to write to is thinking about the person, not the title.
    await expect(talk).toContainText(`Notes on the Analytical Engine — ${speaker.name}`);
    await talk.selectOption('talk-1');
    await panel.getByRole('textbox', { name: /^Subject/ }).fill('About your room');
    await panel.getByRole('textbox', { name: /^Message/ }).fill('Hi {speakerName}, quick question.');
    await expect(send).toBeEnabled();

    page.once('dialog', (d) => d.accept());
    await send.click();

    await expect(panel.getByText(`Sent to ${speaker.name}.`)).toBeVisible();
    // Cleared, because there is no deterministic id to collapse a second send.
    await expect(panel.getByRole('textbox', { name: /^Subject/ })).toHaveValue('');

    const log = panel.locator('.table__scroll');
    await expect(log.getByRole('row', { name: /About your room/ })).toBeVisible();
  });

  const bad = {
    'a placeholder that does not exist': { subject: 'Hi {speaker}', body: 'x' },
    'an empty subject': { subject: '   ', body: 'x' },
    'an empty body': { subject: 'x', body: '  ' },
  };
  for (const [what, draft] of Object.entries(bad)) {
    test(`refuses ${what}`, async () => {
      const { chair } = await stage();
      expect(
        await callAs(chair.idToken, 'sendSpeakerMessage', { proposalId: 'talk-1', ...draft }),
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
      expect(await readEmailLog()).toHaveLength(0);
    });
  }
});
