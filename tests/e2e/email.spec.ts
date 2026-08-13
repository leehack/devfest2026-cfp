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
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  invitePlatformRole,
  inviteRole,
  readEventEmailConfigurationDirect,
  readEmailLog,
  reset,
  seedEmailLog,
  seedProposal,
  seedSpeaker,
  setCfpNameDirect,
  setEmailDeliveryReadyDirect,
  setEventEmailSettingsDirect,
  setEmailStatusDirect,
  setPlatformEmailDeliveryReadyDirect,
  setSendingDomainDirect,
  setProposalStatusDirect,
  setPublicUrlDirect,
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

function reviewedPayload(
  preview: Record<string, unknown>,
  field: 'held' | 'retryable' = 'held',
) {
  const rows = (preview[field] ?? []) as Array<{ logId: string; to: string }>;
  return {
    logIds: rows.map((row) => row.logId),
    reviewedRecipients: rows.map(({ logId, to }) => ({ logId, to })),
    emailConfigurationFingerprint: String(preview.emailConfigurationFingerprint ?? ''),
  };
}

async function releaseCurrentBatch(idToken: string) {
  await setEmailDeliveryReadyDirect();
  const preview = await callJson(idToken, 'emailQueue', { action: 'preview' });
  return callJson(idToken, 'emailQueue', {
    action: 'release',
    ...reviewedPayload(preview),
  });
}

async function retryCurrent(idToken: string) {
  await setEmailDeliveryReadyDirect();
  const preview = await callJson(idToken, 'emailQueue', { action: 'preview' });
  return callJson(idToken, 'emailQueue', {
    action: 'retry',
    ...reviewedPayload(preview, 'retryable'),
  });
}

async function queueSpeakerMessage(
  idToken: string,
  draft: { proposalId: string; subject: string; body: string },
) {
  await setEmailDeliveryReadyDirect();
  const preview = await callJson(idToken, 'sendSpeakerMessage', {
    action: 'preview',
    proposalId: draft.proposalId,
  });
  return callJson(idToken, 'sendSpeakerMessage', {
    action: 'send',
    ...draft,
    expectedRecipientsFingerprint: preview.recipientsFingerprint,
    expectedEmailConfigurationFingerprint: preview.emailConfigurationFingerprint,
  });
}

test.describe('email pipeline', () => {
  test('manual delivery is refused until the server observes a complete setup', async () => {
    const { chair } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.delivery).toMatchObject({
      ready: false,
      problems: expect.arrayContaining(['missing_key', 'missing_domain', 'invalid_sender']),
    });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        logIds: heldLogIds(preview),
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'retry',
        logIds: heldLogIds(preview),
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: heldLogIds(preview)[0],
        reviewedTo: speaker.email,
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    const recipients = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        subject: 'Setup gate',
        body: 'This must not be queued.',
        expectedRecipientsFingerprint: recipients.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: recipients.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(
      await callAs(chair.idToken, 'sendTestEmail', {
        kind: 'accepted',
        locale: 'en',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readEmailLog())[0]).toMatchObject({ status: 'held', attempts: 0 });
  });

  test('resend rejects a slash-bearing log id before resolving a document path', async () => {
    const { chair } = await stage();
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'a/b',
        reviewedTo: speaker.email,
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  test('a queued acceptance is superseded if the decision is undone before claim', async () => {
    const { chair } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await waitForEmail((rows) => rows[0]?.status === 'held', 'the held acceptance');
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'under_review',
    });

    await setEmailStatusDirect('accepted__talk-1', 'queued');
    const rows = await waitForEmail(
      (current) => current[0]?.status === 'failed',
      'the stale queued decision to be superseded',
    );
    expect(rows[0]).toMatchObject({
      status: 'failed',
      attempts: 0,
      error: 'This notification is superseded.',
      errorReason: 'superseded',
    });
    expect(rows[0].attemptedAt).toBeTruthy();
    expect(rows[0]).not.toHaveProperty('sentAt');
  });

  test('a reviewed manual message never follows a changed profile address', async () => {
    const { author } = await stage();
    await seedSpeaker(author.uid, { ...speaker, email: 'ada-new@example.test' });
    await seedEmailLog('reviewed-message-race', {
      status: 'queued',
      kind: 'message',
      proposalId: 'talk-1',
      recipientUid: author.uid,
      to: speaker.email,
      reviewedTo: speaker.email,
      subject: 'Reviewed address',
      body: 'This must stay with the reviewed recipient.',
    });

    const rows = await waitForEmail(
      (current) => current[0]?.status === 'failed',
      'the changed reviewed recipient to be superseded',
    );
    expect(rows[0]).toMatchObject({
      id: 'reviewed-message-race',
      status: 'failed',
      attempts: 0,
      to: speaker.email,
      reviewedTo: speaker.email,
      error: 'This notification is superseded.',
    });
    expect(rows[0].attemptedAt).toBeTruthy();
    expect(rows[0]).not.toHaveProperty('sentAt');
  });

  test('release pins the live address shown in preview and rejects later drift', async () => {
    const { chair, author } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await waitForEmail((rows) => rows[0]?.status === 'held', 'the held acceptance');

    const firstLiveAddress = 'ada-current@example.test';
    await seedSpeaker(author.uid, { ...speaker, email: firstLiveAddress });
    await setEmailDeliveryReadyDirect();
    const reviewed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(reviewed.held).toEqual([
      expect.objectContaining({ logId: 'accepted__talk-1', to: firstLiveAddress }),
    ]);
    expect(reviewed.rows[0]).toMatchObject({
      logId: 'accepted__talk-1',
      to: speaker.email,
      currentTo: firstLiveAddress,
    });

    const secondLiveAddress = 'ada-later@example.test';
    await seedSpeaker(author.uid, { ...speaker, email: secondLiveAddress });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(reviewed),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readEmailLog())[0]).toMatchObject({ status: 'held', to: speaker.email });

    const refreshed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(refreshed.held[0]).toMatchObject({ to: secondLiveAddress });
    expect(
      await callJson(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(refreshed),
      }),
    ).toMatchObject({ released: 1, stale: 0 });
    const rows = await waitForEmail(
      (current) => current[0]?.status === 'dry_run',
      'the acceptance at the refreshed reviewed address',
    );
    expect(rows[0]).toMatchObject({ to: secondLiveAddress, reviewedTo: secondLiveAddress });
  });

  test('retry and resend bind a recoverable row to its current live address', async () => {
    const { chair, author } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await releaseCurrentBatch(chair.idToken);
    await waitForEmail((rows) => rows[0]?.status === 'dry_run', 'the first acceptance attempt');

    const retryAddress = 'ada-retry@example.test';
    await seedSpeaker(author.uid, { ...speaker, email: retryAddress });
    const retryPreview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(retryPreview.retryable[0]).toMatchObject({
      logId: 'accepted__talk-1',
      to: retryAddress,
    });
    expect(retryPreview.rows[0]).toMatchObject({ to: speaker.email, currentTo: retryAddress });
    expect(
      await callJson(chair.idToken, 'emailQueue', {
        action: 'retry',
        ...reviewedPayload(retryPreview, 'retryable'),
      }),
    ).toMatchObject({ released: 1, stale: 0 });
    await waitForEmail((rows) => rows[0]?.attempts === 2, 'the retry at the live address');

    const resendAddress = 'ada-resend@example.test';
    await seedSpeaker(author.uid, { ...speaker, email: resendAddress });
    const resendPreview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const resendRow = resendPreview.rows.find(
      (row: { logId: string }) => row.logId === 'accepted__talk-1',
    );
    expect(resendRow).toMatchObject({ to: retryAddress, currentTo: resendAddress });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__talk-1',
        reviewedTo: resendAddress,
        emailConfigurationFingerprint: resendPreview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: true });
    const rows = await waitForEmail((current) => current[0]?.attempts === 3, 'the live resend');
    expect(rows[0]).toMatchObject({ to: resendAddress, reviewedTo: resendAddress });
  });

  test('reviewed queue actions stay bound to the effective setup while immediate rows stay unbound', async () => {
    const { chair, author } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await setEmailDeliveryReadyDirect();
    const reviewed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });

    await setEventEmailSettingsDirect({ replyTo: 'changed@example.test' });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(reviewed),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readEmailLog()).find((row) => row.id === 'accepted__talk-1')).toMatchObject({
      status: 'held',
      attempts: 0,
    });

    const refreshed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(refreshed.emailConfigurationFingerprint).not.toBe(
      reviewed.emailConfigurationFingerprint,
    );
    expect(
      await callJson(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(refreshed),
      }),
    ).toMatchObject({ released: 1, stale: 0 });
    await waitForEmail(
      (rows) => rows.some((row) => row.id === 'accepted__talk-1' && row.status === 'dry_run'),
      'the refreshed reviewed decision',
    );
    expect((await readEmailLog()).find((row) => row.id === 'accepted__talk-1')).toMatchObject({
      reviewedEmailConfigurationFingerprint: refreshed.emailConfigurationFingerprint,
    });

    await Promise.all([
      seedEmailLog('stale-reviewed-configuration', {
        status: 'queued',
        kind: 'submission_received',
        proposalId: 'talk-1',
        recipientUid: author.uid,
        to: speaker.email,
        reviewedTo: speaker.email,
        reviewedEmailConfigurationFingerprint: reviewed.emailConfigurationFingerprint,
      }),
      seedEmailLog('unreviewed-immediate-configuration', {
        status: 'queued',
        kind: 'submission_received',
        proposalId: 'talk-1',
        recipientUid: author.uid,
        to: speaker.email,
      }),
    ]);
    const terminal = await waitForEmail(
      (rows) =>
        rows.some(
          (row) => row.id === 'stale-reviewed-configuration' && row.status === 'failed',
        ) &&
        rows.some(
          (row) => row.id === 'unreviewed-immediate-configuration' && row.status === 'dry_run',
        ),
      'reviewed and immediate setup binding outcomes',
    );
    expect(terminal.find((row) => row.id === 'stale-reviewed-configuration')).toMatchObject({
      status: 'failed',
      errorReason: 'email_configuration_changed',
    });
    expect(
      terminal.find((row) => row.id === 'unreviewed-immediate-configuration'),
    ).not.toHaveProperty('reviewedEmailConfigurationFingerprint');
  });

  test('reviewed queue actions include the event name and platform URL rendered in copy', async () => {
    const { chair } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await setEmailDeliveryReadyDirect();

    const reviewedName = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    await setCfpNameDirect('Renamed DevFest');
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(reviewedName),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const reviewedUrl = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(reviewedUrl.emailConfigurationFingerprint).not.toBe(
      reviewedName.emailConfigurationFingerprint,
    );
    await setPublicUrlDirect('https://new-cfp.example.test');
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(reviewedUrl),
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const refreshed = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(refreshed.emailConfigurationFingerprint).not.toBe(
      reviewedUrl.emailConfigurationFingerprint,
    );
    expect(
      await callJson(chair.idToken, 'emailQueue', {
        action: 'release',
        ...reviewedPayload(refreshed),
      }),
    ).toMatchObject({ released: 1, stale: 0 });
  });

  test('a large queue exposes one atomic reviewed batch and a truthful remainder', async ({
    page,
  }) => {
    const { chair } = await stage();
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        seedEmailLog(`bulk-review-${String(index).padStart(3, '0')}`, {
          status: 'held',
          kind: 'message',
          proposalId: `bulk-${index}`,
          to: `speaker-${index}@example.test`,
          subject: `Bulk message ${index}`,
          body: 'One exact reviewed batch.',
        }),
      ),
    );
    await setEmailDeliveryReadyDirect();

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview).toMatchObject({ waiting: 101, heldRemaining: 1 });
    expect(preview.held).toHaveLength(100);

    await signInAs(page, admin, at('/admin/email'));
    const queue = page.locator('.email-queue-card');
    await expect(queue.locator('.email-queue-card__count strong')).toHaveText('101');
    await expect(queue.locator('.table--held tbody tr')).toHaveCount(100);
    await expect(
      queue.getByText(
        '1 more messages remain. They will appear for a separate review after this batch is queued.',
      ),
    ).toBeVisible();

    await queue.getByRole('button', { name: 'Review 100 notifications' }).click();
    const review = page.getByRole('dialog', { name: 'Release speaker notifications' });
    await expect(review.locator('tbody tr')).toHaveCount(100);
    await review.getByRole('button', { name: 'Queue 100 notifications' }).click();

    await expect(review).toBeHidden({ timeout: 15_000 });
    await expect(queue.getByText('100 emails queued.')).toBeVisible();
    await expect(queue.locator('.email-queue-card__count strong')).toHaveText('1');
    await expect(queue.locator('.table--held tbody tr')).toHaveCount(1);
    await expect(queue.getByRole('button', { name: 'Review 1 notification' })).toBeVisible();
    await expect(queue.getByText(/more messages remain/)).toHaveCount(0);

    const next = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(next).toMatchObject({ waiting: 1, heldRemaining: 0 });
    expect(next.held).toHaveLength(1);
  });

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
    const heldPreview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });

    // Resend is only for a message that has already left the reviewed batch.
    // A direct call must not turn one held decision into an early notification.
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__talk-1',
        reviewedTo: speaker.email,
        emailConfigurationFingerprint: heldPreview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect((await readEmailLog())[0].status).toBe('held');

    // Give the trigger a chance to misbehave before asserting that it did not.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readEmailLog())[0].status).toBe('held');

    await setEmailDeliveryReadyDirect();
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 1,
      needsAttention: 0,
    });
    expect(await callAs(chair.idToken, 'emailQueue', { action: 'release' })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
    });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'release',
        logIds: heldLogIds(preview),
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });

    const released = await callAs(chair.idToken, 'emailQueue', {
      action: 'release',
      ...reviewedPayload(preview),
    });
    expect(released.ok).toBe(true);

    const sent = await waitForEmail(
      (rows) => rows[0]?.status === 'dry_run',
      'the released decision to be processed',
    );
    expect(sent[0].status).toBe('dry_run');
    expect(sent[0].attempts).toBe(1);
    expect(sent[0].reviewedTo).toBe(speaker.email);
    expect(sent[0].attemptedAt).toBeTruthy();
    expect(sent[0]).not.toHaveProperty('sentAt');
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 0,
      needsAttention: 1,
    });
  });

  /*
   * The reversal case, which is the reason decisions are held rather than sent
   * on the spot. Releasing used to queue every held row without re-reading the
   * proposal, so a decision taken back during the window went out anyway —
   * telling somebody they were accepted after the committee had undone it.
   */
  test('a decision taken back before release is not sent', async ({ page }) => {
    const { chair, author } = await stage();

    await callAs(chair.idToken, 'setProposalStatus', { proposalId: 'talk-1', status: 'accepted' });
    const held = await waitForEmail((rows) => rows.length > 0, 'the decision to be queued');
    expect(held[0].status).toBe('held');

    // The committee changes its mind while the batch is still waiting.
    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'under_review',
    });
    await seedSpeaker(author.uid, {
      ...speaker,
      email: 'new-private-address@example.test',
    });

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview).toMatchObject({ ok: true, held: [], staleHeld: 1 });
    expect(preview.tally['held:accepted']).toBeUndefined();
    expect(preview.rows[0]).toMatchObject({
      status: 'held',
      stale: true,
      to: speaker.email,
      currentTo: speaker.email,
    });
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'summary' })).toEqual({
      ok: true,
      waiting: 0,
      needsAttention: 0,
    });

    await signInAs(page, admin, at('/admin/email'));
    await expect(page.getByRole('button', { name: 'Nothing to send' })).toBeDisabled();
    await expect(page.getByText(/Superseded notifications retained: 1/)).toBeVisible();
    await expect(page.getByText('Retained — superseded')).toBeVisible();
    // The audit row keeps the action in place so the reason it cannot be used
    // is visible, but it cannot be retried while superseded.
    await expect(page.getByRole('button', { name: 'Retry delivery' })).toBeDisabled();
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__talk-1',
        reviewedTo: speaker.email,
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await setEmailDeliveryReadyDirect();
    const releasable = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const released = await callJson(chair.idToken, 'emailQueue', {
      action: 'release',
      logIds: ['accepted__talk-1'],
      reviewedRecipients: [{ logId: 'accepted__talk-1', to: speaker.email }],
      emailConfigurationFingerprint: releasable.emailConfigurationFingerprint,
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
    const retryable = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(await callJson(chair.idToken, 'emailQueue', {
      action: 'retry',
      logIds: ['accepted__talk-1'],
      reviewedRecipients: [{ logId: 'accepted__talk-1', to: speaker.email }],
      emailConfigurationFingerprint: retryable.emailConfigurationFingerprint,
    })).toMatchObject({
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

    await setEmailDeliveryReadyDirect();
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const release = { action: 'release', ...reviewedPayload(preview) };
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
    await setEmailDeliveryReadyDirect();
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
        ...reviewedPayload(reviewed),
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
      needsAttention: 1,
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
    await setEmailDeliveryReadyDirect();
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
    await setEmailDeliveryReadyDirect();
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
    await expect(heldLog.getByRole('button', { name: 'Retry delivery' })).toBeDisabled();

    const send = panel.getByRole('button', { name: 'Review 1 notification' });
    await expect(send).toBeEnabled();
    await send.click();
    const review = page.getByRole('dialog', { name: 'Release speaker notifications' });
    await expect(review.getByText(speaker.email)).toBeVisible();
    await expect(
      review
        .getByLabel('Exact messages and recipients')
        .getByRole('cell', { name: 'Not selected' }),
    ).toBeVisible();
    await review.getByRole('button', { name: 'Queue 1 notification' }).click();

    await expect(panel.getByText('1 email queued.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Nothing to send' })).toBeDisabled();

    const rows = await waitForEmail((r) => r[0]?.status === 'dry_run', 'the send');
    expect(rows[0].kind).toBe('rejected');
  });

  test('the event workspace distinguishes inherited delivery from an activated override', async ({
    page,
  }) => {
    await stage();
    await setPlatformEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/email'));

    const source = page.getByRole('group', { name: 'Email configuration source' });
    await expect(source.getByText('Using platform defaults')).toBeVisible();
    await expect(source.getByRole('heading', { name: 'Effective delivery identity' })).toBeVisible();
    await expect(source).toContainText('CFP Platform <mail@platform.example.test>');
    await expect(source).toContainText('support@platform.example.test');
    await expect(source).not.toContainText('dom-platform.example.test');
    const senderOverride = source.getByRole('textbox', { name: 'Sender name (optional)' });
    await senderOverride.fill('DevFest Montréal');
    await source.getByRole('button', { name: 'Save sender name' }).click();
    await expect(source.getByText('Event sender name saved.')).toBeVisible();
    await expect(source).toContainText('DevFest Montréal <mail@platform.example.test>');
    await expect(page.getByRole('heading', { name: 'Event delivery override' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready to deliver' })).toBeVisible();

    await setEventEmailSettingsDirect({
      senderMode: 'event',
      from: 'Event <mail@event.example.test>',
      domain: 'event.example.test',
      domainId: 'dom-event.example.test',
    });
    await page.reload();

    await expect(source.getByText('Using this event’s override')).toBeVisible();
    await expect(source.getByRole('button', { name: 'Switch to platform defaults' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Setup required' })).toBeVisible();
  });

  test('a saved decision is visibly pending until an admin reviews the email batch', async ({
    page,
  }) => {
    await stage();
    await setEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/proposals'));

    await page
      .getByLabel('Status: Notes on the Analytical Engine')
      .selectOption('accepted');

    await expect(page.getByText('Decision saved. This action does not send an email.')).toBeVisible();
    const notice = page.locator('.pending-email-notice');
    await expect(notice).toContainText('1 speaker notification is waiting');
    await expect(
      page.getByRole('link', {
        name: 'Email, 1 awaiting approval, 0 deliveries needing attention',
      }),
    ).toBeVisible();

    await notice.getByRole('link', { name: 'Review and send' }).click();
    await expect(page).toHaveURL(new RegExp('/admin/email$'));

    const queue = page.locator('.email-queue-card');
    await expect(queue.getByRole('heading', { name: 'Held speaker notifications' })).toBeVisible();
    await expect(queue.getByRole('row', { name: new RegExp(speaker.email) })).toContainText(
      'Accepted',
    );

    const send = queue.getByRole('button', { name: 'Review 1 notification' });
    await send.click();
    await page
      .getByRole('dialog', { name: 'Release speaker notifications' })
      .getByRole('button', { name: 'Queue 1 notification' })
      .click();

    await expect(queue.getByText('1 email queued.')).toBeVisible();
    await waitForEmail(
      (rows) => rows[0]?.status === 'dry_run',
      'the reviewed notification attempt',
    );
    await expect(page.getByRole('link', { name: /Email, 1 awaiting approval/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '1 speaker notification is waiting to be sent.' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: '1 email delivery needs attention.' }),
    ).toBeVisible();
  });

  test('admin navigation keeps failed delivery visible beside a held batch', async ({ page }) => {
    const { chair, author } = await stage();
    await setEmailDeliveryReadyDirect();
    await callAs(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await seedProposal('talk-2', {
      speakerUid: author.uid,
      title: 'A second current decision',
      status: 'accepted',
      speaker: { name: speaker.name },
    });
    await seedEmailLog('accepted__talk-2', {
      status: 'dry_run',
      kind: 'accepted',
      proposalId: 'talk-2',
      attempts: 1,
    });

    await signInAs(page, admin, at('/admin/proposals'));
    await expect(page.getByRole('heading', { name: /1 speaker notification is waiting/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 email delivery needs attention.' })).toBeVisible();
    await expect(page.locator('.subnav .subnav__badge--attention')).toHaveText('2');
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
    // No sender is configured, so the first attempt fails closed. It must still
    // remain recoverable after the organiser completes setup.
    const { chair, author } = await stage();
    await setProposalStatusDirect('talk-1', 'draft');
    await callAs(author.idToken, 'submitProposal', { proposalId: 'talk-1' });

    await waitForEmail(
      (r) =>
        r.some(
          (row) =>
            row.kind === 'submission_received' &&
            row.status === 'failed' &&
            row.errorReason === 'email_domain_unbound',
        ),
      'the blocked receipt',
    );

    const retried = await retryCurrent(chair.idToken);
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
    await setSendingDomainDirect('example.org', CFP_ID, { emulatorVerified: true });

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
    await expect(panel.getByText(/Put the display name in angle brackets/)).toBeVisible();

    // An address on a domain this CFP never registered is refused by the
    // server. The Resend account is shared, so otherwise one organiser could
    // send mail signed by another organiser's event.
    await panel.getByLabel('Send as').fill('cfp@someone-elses.example');
    await panel.getByRole('button', { name: 'Save address' }).click();
    await expect(
      panel.getByRole('alert').filter({ hasText: 'someone-elses.example' }),
    ).toBeVisible();

    await panel.getByLabel('Send as').fill('DevFest Montréal <cfp@example.org>');
    await panel.getByRole('checkbox', { name: 'Inherit the platform reply-to' }).uncheck();
    await panel.getByRole('textbox', { name: /^Reply-to/ }).fill('organisers@example.org');
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
      senderMode: 'event',
      from: 'attacker@evil.example',
      replyTo: '',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
  });

  test('the shared API key is platform-admin-only and never comes back', async () => {
    const { chair, author } = await stage();

    for (const name of ['emailDomain', 'sendTestEmail'] as const) {
      const result = await callAs(author.idToken, name, { apiKey: 're_x', action: 'list' });
      expect(result.ok, name).toBe(false);
      expect(result.code, name).toBe('PERMISSION_DENIED');
    }

    // Event administration does not confer control over the credential shared
    // by every tenant on the platform.
    expect(await callAs(chair.idToken, 'setEmailSecret', { apiKey: 're_x' })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });

    await invitePlatformRole(admin.email, 'admin');
    expect(await callJson(chair.idToken, 'platformAccess', {})).toMatchObject({
      isPlatformAdmin: true,
    });

    // A key that is not even shaped like one is refused before it reaches Resend.
    const bad = await callAs(chair.idToken, 'setEmailSecret', { apiKey: 'sk_not_resend' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('INVALID_ARGUMENT');

    // Nothing on the admin surface hands the key back — only the last four.
    const preview = await callAs(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.ok).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('re_');
  });

  test('an unconfigured event inherits platform delivery but keeps event-owned wording', async () => {
    const { chair } = await stage();
    await setPlatformEmailDeliveryReadyDirect({
      // Rollout-era platform copy must not become another event's wording.
      legacyTemplates: {
        accepted: {
          fr: { subject: 'Legacy platform: {title}', body: 'Legacy platform body.' },
        },
      },
    });
    await setEventEmailSettingsDirect({
      templates: {
        accepted: {
          en: { subject: 'Event accepted: {title}', body: 'Event English.' },
        },
      },
    });

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview).toMatchObject({
      source: 'platform',
      senderMode: 'platform',
      settings: {
        from: 'CFP Platform <mail@platform.example.test>',
        replyTo: 'support@platform.example.test',
      },
      delivery: { ready: true },
      eventSettings: { from: '', platformSenderName: '', replyTo: null, domainId: '', domain: '' },
      templateOverrides: {
        accepted: {
          en: { subject: 'Event accepted: {title}', body: 'Event English.' },
        },
      },
      templates: {
        accepted: {
          en: { subject: 'Event accepted: {title}', body: 'Event English.' },
        },
      },
    });
    expect(preview.templates.accepted).not.toHaveProperty('fr');
    // A CFP inherits the effective sender, never the platform DNS handle.
    expect(preview.domainId).toBe('');
  });

  test('reply-to may inherit or deliberately clear without changing the inherited sender', async () => {
    const { chair } = await stage();
    await setPlatformEmailDeliveryReadyDirect();
    await setEventEmailSettingsDirect({ senderMode: 'platform', replyTo: null });

    const inherited = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(inherited).toMatchObject({
      source: 'platform',
      settings: { replyTo: 'support@platform.example.test' },
      eventSettings: { replyTo: null },
    });

    await setEventEmailSettingsDirect({ senderMode: 'platform', replyTo: '' });
    const cleared = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(cleared).toMatchObject({
      source: 'platform',
      settings: { replyTo: '' },
      eventSettings: { replyTo: '' },
    });
  });

  test('an event may rename the sender while retaining the platform address', async () => {
    const { chair } = await stage();
    await setPlatformEmailDeliveryReadyDirect();
    await setEventEmailSettingsDirect({ senderMode: 'platform' });

    expect(
      await callJson(chair.idToken, 'setEmailSettings', {
        senderMode: 'platform',
        platformSenderNameOnly: true,
        senderName: 'DevFest Montréal',
      }),
    ).toMatchObject({
      ok: true,
      source: 'platform',
      settings: { from: 'DevFest Montréal <mail@platform.example.test>' },
    });
    expect(await readEventEmailConfigurationDirect()).toMatchObject({
      senderMode: 'platform',
      platformSenderName: 'DevFest Montréal',
    });
    expect(await callJson(chair.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      source: 'platform',
      settings: { from: 'DevFest Montréal <mail@platform.example.test>' },
      eventSettings: { platformSenderName: 'DevFest Montréal' },
      delivery: { ready: true },
    });

    expect(
      await callJson(chair.idToken, 'setEmailSettings', {
        senderMode: 'platform',
        platformSenderNameOnly: true,
        senderName: '<Wrong>',
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });

    expect(
      await callJson(chair.idToken, 'setEmailSettings', {
        senderMode: 'platform',
        platformSenderNameOnly: true,
        senderName: '',
      }),
    ).toMatchObject({
      ok: true,
      settings: { from: 'CFP Platform <mail@platform.example.test>' },
    });
    expect(await readEventEmailConfigurationDirect()).not.toHaveProperty('platformSenderName');
  });

  test('a reply-to-only save preserves an active event sender and its staged replacement', async () => {
    const { chair } = await stage();
    await setEventEmailSettingsDirect({
      senderMode: 'event',
      from: 'Active event <mail@active.example.test>',
      replyTo: 'old@example.test',
      domain: 'active.example.test',
      domainId: 'dom-active.example.test',
      stagedDomain: 'replacement.example.test',
      stagedDomainId: 'dom-replacement.example.test',
    });

    expect(
      await callJson(chair.idToken, 'setEmailSettings', {
        senderMode: 'event',
        replyToOnly: true,
        replyTo: 'new@example.test',
      }),
    ).toMatchObject({
      ok: true,
      source: 'event',
      settings: {
        from: 'Active event <mail@active.example.test>',
        replyTo: 'new@example.test',
      },
    });

    expect(await readEventEmailConfigurationDirect()).toMatchObject({
      senderMode: 'event',
      from: 'Active event <mail@active.example.test>',
      replyTo: 'new@example.test',
      domain: 'active.example.test',
      domainId: 'dom-active.example.test',
      stagedDomain: 'replacement.example.test',
      stagedDomainId: 'dom-replacement.example.test',
    });
  });

  test('staging an event sender keeps inheritance, but activating it fails closed', async () => {
    const { chair } = await stage();
    await setPlatformEmailDeliveryReadyDirect();
    const staged = {
      from: 'Event <mail@event.example.test>',
      domain: 'event.example.test',
      domainId: 'dom-event.example.test',
    };
    await setEventEmailSettingsDirect({ senderMode: 'platform', ...staged });

    expect(await callJson(chair.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      source: 'platform',
      senderMode: 'platform',
      settings: { from: 'CFP Platform <mail@platform.example.test>' },
      delivery: { ready: true },
      eventSettings: staged,
    });

    await setEventEmailSettingsDirect({ senderMode: 'event', ...staged });
    const activated = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(activated).toMatchObject({
      source: 'event',
      senderMode: 'event',
      delivery: { ready: false },
      domainId: 'dom-event.example.test',
      domain: 'event.example.test',
      settings: { from: 'Event <mail@event.example.test>' },
    });
    expect(activated.settings.from).not.toBe('CFP Platform <mail@platform.example.test>');
  });

  test('platform configuration stays platform-admin-only and cannot be reused as an event binding', async () => {
    const { chair, author } = await stage();
    await setPlatformEmailDeliveryReadyDirect();

    for (const identity of [author, chair]) {
      for (const [name, data] of [
        ['getPlatformEmailConfiguration', {}],
        [
          'setPlatformEmailSettings',
          { from: 'Changed <mail@platform.example.test>', replyTo: '' },
        ],
        ['platformEmailDomain', { action: 'list' }],
        ['sendPlatformTestEmail', { locale: 'en' }],
      ] as const) {
        expect(await callAs(identity.idToken, name, data), name).toMatchObject({
          ok: false,
          code: 'PERMISSION_DENIED',
        });
      }
    }

    await invitePlatformRole(admin.email, 'admin');
    await callJson(chair.idToken, 'platformAccess', {});
    expect(
      await callJson(chair.idToken, 'getPlatformEmailConfiguration', {}),
    ).toMatchObject({
      ok: true,
      settings: {
        from: 'CFP Platform <mail@platform.example.test>',
        replyTo: 'support@platform.example.test',
      },
      delivery: { ready: true },
    });

    await setEventEmailSettingsDirect({
      senderMode: 'platform',
      from: 'Event <mail@platform.example.test>',
      domain: 'platform.example.test',
      domainId: 'dom-platform.example.test',
    });
    expect(
      await callAs(chair.idToken, 'setEmailSettings', {
        senderMode: 'event',
        from: 'Event <mail@platform.example.test>',
        replyTo: null,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('custom wording reaches the sender, and a broken one cannot be saved', async () => {
    const { chair, author } = await stage();
    await setEmailDeliveryReadyDirect();

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

  test('a template test waits until the visible draft is saved', async ({ page }) => {
    await stage();
    await setEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/email'));

    await page.getByLabel('Edit the wording').check();
    const testMessage = page.getByRole('button', { name: 'Send this to me' });
    await expect(testMessage).toBeEnabled();
    await page
      .getByLabel('Subject line')
      .fill('A saved test for {event}');
    await expect(testMessage).toBeDisabled();
    await expect(
      page.getByText('Save this wording before testing it; tests use the stored template.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save wording' }).click();
    await expect(testMessage).toBeEnabled();
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

  test('switching the interface language does not discard unsaved email wording', async ({
    page,
  }) => {
    await stage();
    await signInAs(page, admin, at('/admin/email'));

    await page.getByLabel('Edit the wording').check();
    const subject = page.locator('.email-editor .editor input').first();
    const body = page.locator('.email-editor .editor textarea').first();
    await subject.fill('A bilingual-safe draft for {event}');
    await body.fill('This sentence must survive the interface language switch.');

    await page.getByRole('button', { name: 'Français' }).click();
    await expect(subject).toHaveValue('A bilingual-safe draft for {event}');
    await expect(body).toHaveValue('This sentence must survive the interface language switch.');
    await expect(page.locator('.email-editor').getByLabel('Langue')).toHaveValue('en');
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
      delivery: {
        ready: false,
        problems: ['missing_key', 'missing_domain', 'invalid_sender'],
        domainStatus: 'unknown',
      },
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
      sentAt: null,
    });
    expect(rows[0].attemptedAt).toEqual(expect.any(Number));
  });

  test('a delivered row keeps its sent outcome after the underlying decision changes', async () => {
    const { chair } = await stage();
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'accepted',
    });
    await waitForEmail((rows) => rows[0]?.status === 'held', 'the held acceptance');
    const sentAt = new Date('2026-08-11T12:00:00Z');
    await seedEmailLog('accepted__talk-1', {
      status: 'sent',
      kind: 'accepted',
      proposalId: 'talk-1',
      to: speaker.email,
      sentAt,
    });
    await callJson(chair.idToken, 'setProposalStatus', {
      proposalId: 'talk-1',
      status: 'under_review',
    });

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(preview.rows.find((row: { logId: string }) => row.logId === 'accepted__talk-1'))
      .toMatchObject({
        status: 'sent',
        stale: false,
        sentAt: sentAt.getTime(),
      });
  });

  test('history sorts by the truthful attempt time with a legacy sent fallback', async () => {
    const { chair } = await stage();
    await seedEmailLog('created-only', {
      status: 'failed',
      kind: 'message',
      proposalId: 'talk-1',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    await seedEmailLog('legacy-sent', {
      status: 'sent',
      kind: 'message',
      proposalId: 'talk-1',
      sentAt: new Date('2026-01-01T11:00:00Z'),
    });
    await seedEmailLog('attempted-failed', {
      status: 'failed',
      kind: 'message',
      proposalId: 'talk-1',
      attemptedAt: new Date('2026-01-01T12:00:00Z'),
    });

    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const ordered = preview.rows
      .filter((row: { logId: string }) =>
        ['created-only', 'legacy-sent', 'attempted-failed'].includes(row.logId),
      );
    expect(ordered.map((row: { logId: string }) => row.logId)).toEqual([
      'attempted-failed',
      'legacy-sent',
      'created-only',
    ]);
    expect(ordered[0]).toMatchObject({ attemptedAt: Date.parse('2026-01-01T12:00:00Z'), sentAt: null });
    expect(ordered[1]).toMatchObject({
      attemptedAt: Date.parse('2026-01-01T11:00:00Z'),
      sentAt: Date.parse('2026-01-01T11:00:00Z'),
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
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const reviewed = preview.rows.find(
      (row: { logId: string }) => row.logId === 'accepted__talk-1',
    );
    const again = await callAs(chair.idToken, 'emailQueue', {
      action: 'resend',
      logId: 'accepted__talk-1',
      reviewedTo: reviewed.currentTo,
      emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
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
    await setEmailDeliveryReadyDirect();
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
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    const refused = await callAs(chair.idToken, 'emailQueue', {
      action: 'resend',
      logId: 'accepted__talk-1',
      reviewedTo: speaker.email,
      emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
    });
    expect(refused).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
  });

  test('an expired in-flight message is visibly recoverable from the email workspace', async ({
    page,
  }) => {
    await stage();
    await setEmailDeliveryReadyDirect();
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
    await expect(
      page
        .getByLabel('Needs attention')
        .getByRole('cell', { name: 'Delivery stalled — retry available' }),
    ).toBeVisible();
    const retry = page.getByRole('button', { name: 'Review 1 for retry' });
    await expect(retry).toBeEnabled();
    await retry.click();
    await page
      .getByRole('dialog', { name: 'Retry unresolved deliveries' })
      .getByRole('button', { name: 'Retry 1 delivery' })
      .click();

    await expect
      .poll(async () => (await readEmailLog()).find((row) => row.id === 'stalled-receipt'))
      .toMatchObject({ status: 'dry_run', attempts: 2 });
    await expect(page.getByText('Delivery stalled — retry available')).toHaveCount(0);
  });

  test('resending something that was never queued says so', async () => {
    const { chair } = await stage();
    await setEmailDeliveryReadyDirect();
    const preview = await callJson(chair.idToken, 'emailQueue', { action: 'preview' });
    expect(
      await callAs(chair.idToken, 'emailQueue', {
        action: 'resend',
        logId: 'accepted__nope',
        reviewedTo: speaker.email,
        emailConfigurationFingerprint: preview.emailConfigurationFingerprint,
      }),
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

    const panel = page.getByRole('region', { name: 'Write to all speakers on a talk' });
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

    const sent = await queueSpeakerMessage(chair.idToken, {
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
      reviewedTo: speaker.email,
      subject: message.subject,
      body: message.body,
      // No API key under the emulator, so the trigger renders and records this
      // rather than claiming a delivery it did not make.
      status: 'dry_run',
    });
  });

  test('requires the exact current recipient set reviewed by the admin', async () => {
    const { chair, author } = await stage();
    await setEmailDeliveryReadyDirect();
    const first = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    expect(first).toMatchObject({
      kind: 'message',
      recipientCount: 1,
      recipients: [{ uid: author.uid, to: speaker.email }],
    });

    await seedSpeaker(author.uid, { ...speaker, email: 'ada-new@example.test' });
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: first.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: first.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readEmailLog()).toHaveLength(0);

    const current = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    expect(current.recipients).toEqual([
      { uid: author.uid, to: 'ada-new@example.test', name: speaker.name },
    ]);
  });

  test('requires the exact email setup reviewed with a manual speaker message', async () => {
    const { chair } = await stage();
    await setEmailDeliveryReadyDirect();
    const reviewed = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });

    await setEventEmailSettingsDirect({ replyTo: 'manual-changed@example.test' });
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: reviewed.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: reviewed.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readEmailLog()).toHaveLength(0);

    const current = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    expect(current.emailConfigurationFingerprint).not.toBe(
      reviewed.emailConfigurationFingerprint,
    );
    expect(
      await callJson(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: current.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: current.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ recipientCount: 1 });
    const rows = await waitForEmail(
      (all) => all.some((row) => row.kind === 'message' && row.status === 'dry_run'),
      'the message reviewed against the refreshed setup',
    );
    expect(rows.find((row) => row.kind === 'message')).toMatchObject({
      reviewedEmailConfigurationFingerprint: current.emailConfigurationFingerprint,
    });
  });

  test('requires the event name and platform URL reviewed with a manual speaker message', async () => {
    const { chair } = await stage();
    await setEmailDeliveryReadyDirect();
    const reviewedName = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });

    await setCfpNameDirect('Renamed DevFest');
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: reviewedName.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: reviewedName.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const reviewedUrl = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    await setPublicUrlDirect('https://new-cfp.example.test');
    expect(
      await callAs(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: reviewedUrl.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: reviewedUrl.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const refreshed = await callJson(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-1',
    });
    expect(
      await callJson(chair.idToken, 'sendSpeakerMessage', {
        action: 'send',
        proposalId: 'talk-1',
        ...message,
        expectedRecipientsFingerprint: refreshed.recipientsFingerprint,
        expectedEmailConfigurationFingerprint: refreshed.emailConfigurationFingerprint,
      }),
    ).toMatchObject({ recipientCount: 1 });
  });

  test('two of them are two emails, not one overwritten row', async () => {
    const { chair } = await stage();

    await queueSpeakerMessage(chair.idToken, { proposalId: 'talk-1', ...message });
    await queueSpeakerMessage(chair.idToken, {
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
    expect(await callAs(chair.idToken, 'sendSpeakerMessage', {
      action: 'preview',
      proposalId: 'talk-draft',
    })).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await readEmailLog()).toHaveLength(0);
  });

  test('the admin panel composes one and shows it in the log', async ({ page }) => {
    await stage();
    await setEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/email'));

    const panel = page.getByRole('region', { name: 'Write to all speakers on a talk' });
    const send = panel.getByRole('button', { name: 'Review recipients' });

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
    await send.click();
    const review = page.getByRole('dialog', { name: 'Review speaker message' });
    await expect(review.getByText(speaker.email)).toBeVisible();
    await review.getByRole('button', { name: 'Queue 1 copy' }).click();

    await expect(panel.getByText('1 copy queued for delivery.')).toBeVisible();
    // Cleared, because there is no deterministic id to collapse a second send.
    await expect(panel.getByRole('textbox', { name: /^Subject/ })).toHaveValue('');

    const log = page.getByRole('table');
    await expect(log.getByRole('row', { name: /About your room/ })).toBeVisible();
  });

  test('composer refreshes a changed recipient inside the open review', async ({ page }) => {
    const { author } = await stage();
    await setEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/email'));

    const panel = page.getByRole('region', { name: 'Write to all speakers on a talk' });
    await panel.getByLabel('Talk').selectOption('talk-1');
    await panel.getByRole('textbox', { name: /^Subject/ }).fill('Profile-sensitive message');
    await panel.getByRole('textbox', { name: /^Message/ }).fill('Hello {speakerName}.');
    await panel.getByRole('button', { name: 'Review recipients' }).click();

    const review = page.getByRole('dialog', { name: 'Review speaker message' });
    await expect(review.getByText(speaker.email)).toBeVisible();
    await seedSpeaker(author.uid, {
      ...speaker,
      name: 'Augusta Ada King',
      locale: 'en',
    });
    await review.getByRole('button', { name: 'Queue 1 copy' }).click();

    await expect(review.getByRole('alert')).toContainText(
      'The recipient list changed while you were reviewing it.',
    );
    await expect(review.getByText(/Augusta Ada King/)).toBeVisible();
    await review.getByRole('button', { name: 'Queue 1 copy' }).click();
    await expect(panel.getByText('1 copy queued for delivery.')).toBeVisible();
  });

  test('a changed email setup closes the open review before it can send', async ({ page }) => {
    await stage();
    await setEmailDeliveryReadyDirect();
    await signInAs(page, admin, at('/admin/email'));

    const panel = page.getByRole('region', { name: 'Write to all speakers on a talk' });
    await panel.getByLabel('Talk').selectOption('talk-1');
    await panel.getByRole('textbox', { name: /^Subject/ }).fill('Setup-sensitive message');
    await panel.getByRole('textbox', { name: /^Message/ }).fill('Hello {speakerName}.');
    await panel.getByRole('button', { name: 'Review recipients' }).click();

    const review = page.getByRole('dialog', { name: 'Review speaker message' });
    await expect(review.getByText(speaker.email)).toBeVisible();
    await setEventEmailSettingsDirect({ replyTo: 'changed-during-review@example.test' });
    await review.getByRole('button', { name: 'Queue 1 copy' }).click();

    await expect(review).toHaveCount(0);
    await expect(panel.getByText('The email state changed before this action finished.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Queue 1 copy' })).toHaveCount(0);
    expect(await readEmailLog()).toHaveLength(0);

    // The refreshed parent configuration must be reviewed through a new dialog;
    // the rejected dialog never receives a replacement token in place.
    const reviewAgain = panel.getByRole('button', { name: 'Review recipients' });
    await expect(reviewAgain).toBeEnabled();
    await reviewAgain.click();
    const refreshedReview = page.getByRole('dialog', { name: 'Review speaker message' });
    await expect(refreshedReview.getByText(speaker.email)).toBeVisible();
    await refreshedReview.getByRole('button', { name: 'Queue 1 copy' }).click();
    await expect(panel.getByText('1 copy queued for delivery.')).toBeVisible();
  });

  const bad = {
    'a placeholder that does not exist': { subject: 'Hi {speaker}', body: 'x' },
    'an empty subject': { subject: '   ', body: 'x' },
    'an empty body': { subject: 'x', body: '  ' },
  };
  for (const [what, draft] of Object.entries(bad)) {
    test(`refuses ${what}`, async () => {
      const { chair } = await stage();
      const preview = await callJson(chair.idToken, 'sendSpeakerMessage', {
        action: 'preview',
        proposalId: 'talk-1',
      });
      expect(
        await callAs(chair.idToken, 'sendSpeakerMessage', {
          action: 'send',
          proposalId: 'talk-1',
          ...draft,
          expectedRecipientsFingerprint: preview.recipientsFingerprint,
          expectedEmailConfigurationFingerprint: preview.emailConfigurationFingerprint,
        }),
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
      expect(await readEmailLog()).toHaveLength(0);
    });
  }
});
