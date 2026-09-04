/**
 * The batch drain against the Firestore emulator (the `rules` vitest project).
 *
 * Rows are seeded at the point the trigger stages them — `sending`, claimed,
 * revalidated — and the provider is a stub, so what is under test is the lock,
 * the manifest, the result mapping onto rows and the recovery of a batch the
 * provider may have accepted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Firestore } from 'firebase-admin/firestore';

import {
  EMAIL_BATCH,
  batchIdempotencyKey,
  flushEmailBatches,
  pendingBatchMemberIds,
  type BatchEmailPayload,
  type BatchSendResult,
} from '../functions/src/emailBatch';
import {
  emailTransportConfigurationFingerprint,
  resolveEmailConfiguration,
} from '../functions/src/emailConfig';

// The code under test resolves firebase-admin from functions/node_modules; a
// Timestamp from the root copy is a foreign class to that instance.
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { getApps, initializeApp } = requireFromFunctions('firebase-admin/app') as typeof import('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = requireFromFunctions(
  'firebase-admin/firestore',
) as typeof import('firebase-admin/firestore');

const PROJECT = 'demo-devfest-cfp';
const CFP = 'batch-flow';
let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('This suite needs the Firestore emulator (npm run test:rules).');
  }
  process.env.GCLOUD_PROJECT = PROJECT;
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

/** Event delivery needs a platform identity with its exact domain binding. */
async function seedPlatformSender() {
  const domain = 'example.org';
  const domainId = `dom-${domain}`;
  await db.doc('config/platformEmail').set({
    from: 'DevFest <cfp@example.org>',
    domain,
    domainId,
  });
  await db.doc(`emailDomainBindings/${createHash('sha256').update(domainId).digest('hex')}`).set({
    scope: 'platform',
    domain,
    domainId,
  });
}

afterAll(async () => {
  await db.recursiveDelete(db.doc(`cfps/${CFP}`));
});

beforeEach(async () => {
  await db.recursiveDelete(db.doc(`cfps/${CFP}`));
  await db.doc(`cfps/${CFP}`).set({ name: 'Batch Flow', archived: false });
  await seedPlatformSender();
});

async function seedStaged(logId: string, to: string, claimId = `claim-${logId}`) {
  await db.doc(`cfps/${CFP}/emailLog/${logId}`).set({
    kind: 'submission_received',
    proposalId: 'talk-1',
    to,
    locale: 'en',
    data: { speakerName: 'Ada', title: 'Reliable delivery' },
    status: 'sending',
    attempts: 1,
    sendingClaimId: claimId,
    sendingStartedAt: FieldValue.serverTimestamp(),
    providerAttemptId: claimId,
    batchStaged: true,
    batchStagedAt: FieldValue.serverTimestamp(),
  });
}

const row = async (logId: string) => (await db.doc(`cfps/${CFP}/emailLog/${logId}`).get()).data()!;
const batchDocs = async () => (await db.collection(`cfps/${CFP}/emailBatches`).get()).docs;
const lock = () => db.doc(`cfps/${CFP}/config/emailBatchLock`).get();

const instant = { wait: async () => {}, readKey: async () => 'resend-key' };
const stagedAs = async (claimId: string) => ({
  claimId,
  configurationFingerprint: emailTransportConfigurationFingerprint(
    await resolveEmailConfiguration(db, CFP),
  ),
  reviewed: false,
});

function providerAccepting() {
  const calls: Array<{ emails: BatchEmailPayload[]; key: string }> = [];
  const send = vi.fn(async (emails: readonly BatchEmailPayload[], _key: string, key: string) => {
    calls.push({ emails: [...emails], key });
    return {
      ok: true,
      outcomes: emails.map((email, index) => ({
        status: 'sent' as const,
        providerId: `provider-${index}-${email.to[0]}`,
      })),
    } satisfies BatchSendResult;
  });
  return { send, calls };
}

describe('email batch drain', () => {
  it('drains every staged row in one request and finalises each row from its slot', async () => {
    await seedStaged('a', 'a@example.org');
    await seedStaged('b', 'b@example.org');
    await seedStaged('c', 'c@example.org');
    const provider = providerAccepting();

    const summary = await flushEmailBatches(db, CFP, null, { ...instant, send: provider.send });

    expect(summary).toEqual({ role: 'drained', batches: 1 });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].emails.map((email) => email.to[0]).sort()).toEqual([
      'a@example.org',
      'b@example.org',
      'c@example.org',
    ]);
    expect(provider.calls[0].emails[0]).toMatchObject({
      from: 'DevFest <cfp@example.org>',
      subject: 'Your Batch Flow proposal is in',
      text: expect.stringContaining('Reliable delivery'),
    });
    for (const id of ['a', 'b', 'c']) {
      const stored = await row(id);
      expect(stored.status).toBe('sent');
      expect(stored.providerId).toMatch(/^provider-\d-/);
      expect(stored.batchStaged).toBeUndefined();
      expect(stored.sendingClaimId).toBeUndefined();
      expect(stored.providerAttemptId).toBeUndefined();
      expect(stored.sentAt).toBeInstanceOf(Timestamp);
    }
    const [batch] = await batchDocs();
    expect(batch.data()).toMatchObject({ status: 'completed', sent: 3, failed: 0, attempts: 1 });
    expect(provider.calls[0].key).toBe(batchIdempotencyKey(CFP, batch.id));
    expect((await lock()).exists).toBe(false);
  });

  it('records a permissive rejection on that row alone', async () => {
    await seedStaged('good', 'good@example.org');
    await seedStaged('bad', 'not-an-address');
    const send = vi.fn(async (emails: readonly BatchEmailPayload[]) => ({
      ok: true as const,
      outcomes: emails.map((email) =>
        email.to[0] === 'not-an-address'
          ? { status: 'failed' as const, error: 'Invalid `to` field' }
          : { status: 'sent' as const, providerId: 'ok' },
      ),
    }));

    await flushEmailBatches(db, CFP, null, { ...instant, send });

    expect(await row('good')).toMatchObject({ status: 'sent', providerId: 'ok' });
    expect(await row('bad')).toMatchObject({ status: 'failed', error: 'Invalid `to` field' });
    expect((await batchDocs())[0].data()).toMatchObject({ sent: 1, failed: 1 });
  });

  it('stages a row under someone else\'s lock and lets that drainer take it', async () => {
    await db.doc(`cfps/${CFP}/config/emailBatchLock`).set({
      owner: 'other-invocation',
      expiresAt: Timestamp.fromMillis(Date.now() + EMAIL_BATCH.lockMs),
    });
    const ref = db.doc(`cfps/${CFP}/emailLog/late`);
    await ref.set({
      kind: 'submission_received',
      proposalId: 'talk-1',
      to: 'late@example.org',
      locale: 'en',
      data: { speakerName: 'Ada', title: 'Late row' },
      status: 'sending',
      attempts: 1,
      sendingClaimId: 'claim-late',
      providerAttemptId: 'claim-late',
    });
    const provider = providerAccepting();

    const summary = await flushEmailBatches(db, CFP, { ref, ...(await stagedAs('claim-late')) }, {
      ...instant,
      send: provider.send,
    });

    expect(summary).toEqual({ role: 'staged', batches: 0 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(await row('late')).toMatchObject({ status: 'sending', batchStaged: true });

    // The other drainer's lock lapses; the next flush drains what was staged.
    await db.doc(`cfps/${CFP}/config/emailBatchLock`).delete();
    await flushEmailBatches(db, CFP, null, { ...instant, send: provider.send });
    expect(await row('late')).toMatchObject({ status: 'sent' });
  });

  it('refuses to stage a row whose claim has moved on', async () => {
    const ref = db.doc(`cfps/${CFP}/emailLog/stale`);
    await ref.set({ status: 'sending', sendingClaimId: 'newer-claim', to: 'x@example.org' });
    const provider = providerAccepting();

    const summary = await flushEmailBatches(db, CFP, { ref, ...(await stagedAs('old-claim')) }, {
      ...instant,
      send: provider.send,
    });

    expect(summary).toEqual({ role: 'skipped', batches: 0 });
    expect((await row('stale')).batchStaged).toBeUndefined();
    expect((await lock()).exists).toBe(false);
  });

  it('keeps an ambiguous batch pending and re-sends the same manifest under the same key', async () => {
    await seedStaged('a', 'a@example.org');
    await seedStaged('b', 'b@example.org');
    const keys: string[] = [];
    let attempt = 0;
    const send = vi.fn(async (emails: readonly BatchEmailPayload[], _api: string, key: string) => {
      keys.push(key);
      attempt += 1;
      if (attempt === 1) return { ok: false as const, error: 'network: lost', ambiguous: true };
      return {
        ok: true as const,
        outcomes: emails.map(() => ({ status: 'sent' as const, providerId: 'p' })),
      };
    });
    let clock = Date.now();
    const deps = { ...instant, send, now: () => clock };

    await flushEmailBatches(db, CFP, null, deps);

    let [batch] = await batchDocs();
    expect(batch.data()).toMatchObject({ status: 'pending', attempts: 1, lastError: 'network: lost' });
    expect(await row('a')).toMatchObject({ status: 'sending', batchId: batch.id });
    expect(await pendingBatchMemberIds(db, CFP)).toEqual(new Set(['a', 'b']));

    // Not due yet: a flush leaves it alone.
    await flushEmailBatches(db, CFP, null, deps);
    expect(send).toHaveBeenCalledTimes(1);

    clock += EMAIL_BATCH.retryDelayMs + 1;
    await flushEmailBatches(db, CFP, null, deps);

    expect(send).toHaveBeenCalledTimes(2);
    expect(keys[1]).toBe(keys[0]);
    [batch] = await batchDocs();
    expect(batch.data()).toMatchObject({ status: 'completed', attempts: 2, sent: 2 });
    expect(await row('a')).toMatchObject({ status: 'sent' });
    expect(await pendingBatchMemberIds(db, CFP)).toEqual(new Set());
  });

  it('replays the composition that went on the wire, not the rows still waiting', async () => {
    await seedStaged('a', 'a@example.org');
    await seedStaged('b', 'b@example.org');
    await seedStaged('c', 'c@example.org');
    let attempt = 0;
    const calls: Array<string[]> = [];
    const send = vi.fn(async (emails: readonly BatchEmailPayload[]) => {
      calls.push(emails.map((email) => email.to[0]));
      attempt += 1;
      if (attempt === 1) return { ok: false as const, error: 'network: lost', ambiguous: true };
      return {
        ok: true as const,
        outcomes: emails.map((email) => ({ status: 'sent' as const, providerId: `p-${email.to[0]}` })),
      };
    });
    let clock = Date.now();
    const deps = { ...instant, send, now: () => clock };

    await flushEmailBatches(db, CFP, null, deps);
    const [batch] = await batchDocs();
    expect(batch.get('requested')).toEqual(['a', 'b', 'c']);

    // The provider had in fact accepted the request and the drainer died
    // after finalising `a`: replaying a smaller payload would break the key.
    await db.doc(`cfps/${CFP}/emailLog/a`).update({ status: 'sent', providerId: 'p-original' });
    clock += EMAIL_BATCH.retryDelayMs + 1;
    await flushEmailBatches(db, CFP, null, deps);

    expect(calls).toEqual([
      ['a@example.org', 'b@example.org', 'c@example.org'],
      ['a@example.org', 'b@example.org', 'c@example.org'],
    ]);
    expect(await row('a')).toMatchObject({ status: 'sent', providerId: 'p-original' });
    expect(await row('b')).toMatchObject({ status: 'sent', providerId: 'p-b@example.org' });
    expect(await row('c')).toMatchObject({ status: 'sent', providerId: 'p-c@example.org' });
    expect((await batchDocs())[0].data()).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('reads a payload mismatch on replay as the earlier request having been accepted', async () => {
    await seedStaged('a', 'a@example.org');
    await seedStaged('b', 'b@example.org');
    let attempt = 0;
    const send = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false as const, error: 'network: lost', ambiguous: true };
      return {
        ok: false as const,
        error: '409: Idempotency key already used with a different payload',
        ambiguous: false,
        acceptedEarlier: true,
      };
    });
    let clock = Date.now();
    const deps = { ...instant, send, now: () => clock };

    await flushEmailBatches(db, CFP, null, deps);
    clock += EMAIL_BATCH.retryDelayMs + 1;
    await flushEmailBatches(db, CFP, null, deps);

    const a = await row('a');
    expect(a).toMatchObject({ status: 'sent' });
    expect(a.providerId).toBeUndefined();
    expect(a.error).toBeUndefined();
    expect(await row('b')).toMatchObject({ status: 'sent' });
    expect((await batchDocs())[0].data()).toMatchObject({ status: 'completed', sent: 2, failed: 0 });
    expect(await pendingBatchMemberIds(db, CFP)).toEqual(new Set());
  });

  it('fails the rows and preserves their attempt identity once retries run out', async () => {
    await seedStaged('a', 'a@example.org');
    const send = vi.fn(async () => ({ ok: false as const, error: '503: down', ambiguous: true }));
    let clock = Date.now();
    const deps = { ...instant, send, now: () => clock };

    for (let i = 0; i < EMAIL_BATCH.maxAttempts; i += 1) {
      await flushEmailBatches(db, CFP, null, deps);
      clock += EMAIL_BATCH.retryDelayMs + 1;
    }

    expect(send).toHaveBeenCalledTimes(EMAIL_BATCH.maxAttempts);
    const stored = await row('a');
    expect(stored).toMatchObject({ status: 'failed', error: '503: down', providerAttemptId: 'claim-a' });
    expect(stored.sendingClaimId).toBeUndefined();
    expect((await batchDocs())[0].data()).toMatchObject({ status: 'failed' });
  });

  it('fails a rejected batch at once and drops the attempt identity', async () => {
    await seedStaged('a', 'a@example.org');
    const send = vi.fn(async () => ({ ok: false as const, error: '401: bad key', ambiguous: false }));

    await flushEmailBatches(db, CFP, null, { ...instant, send });

    const stored = await row('a');
    expect(stored).toMatchObject({ status: 'failed', error: '401: bad key' });
    expect(stored.providerAttemptId).toBeUndefined();
  });

  it('supersedes a manifest whose event was archived before the request', async () => {
    await seedStaged('a', 'a@example.org');
    await db.doc(`cfps/${CFP}`).update({ archived: true });
    const provider = providerAccepting();

    await flushEmailBatches(db, CFP, null, { ...instant, send: provider.send });

    expect(provider.send).not.toHaveBeenCalled();
    expect(await row('a')).toMatchObject({ status: 'failed', errorReason: 'superseded' });
  });

  it('leaves a row alone when its claim changed while the batch was in flight', async () => {
    await seedStaged('a', 'a@example.org');
    await seedStaged('b', 'b@example.org');
    const send = vi.fn(async (emails: readonly BatchEmailPayload[]) => {
      // An admin reclaimed `b` mid-request: it is queued for a fresh attempt.
      await db.doc(`cfps/${CFP}/emailLog/b`).update({
        status: 'queued',
        sendingClaimId: FieldValue.delete(),
        batchId: FieldValue.delete(),
      });
      return {
        ok: true as const,
        outcomes: emails.map(() => ({ status: 'sent' as const, providerId: 'p' })),
      };
    });

    await flushEmailBatches(db, CFP, null, { ...instant, send });

    expect(await row('a')).toMatchObject({ status: 'sent' });
    expect(await row('b')).toMatchObject({ status: 'queued' });
  });

  it('refuses a row whose delivery setup changed after it was validated', async () => {
    await seedStaged('a', 'a@example.org');
    await db.doc(`cfps/${CFP}/emailLog/a`).update({
      batchConfigurationFingerprint: 'validated-under-a-previous-sender',
      batchReviewed: false,
    });
    await seedStaged('b', 'b@example.org');
    const provider = providerAccepting();

    await flushEmailBatches(db, CFP, null, { ...instant, send: provider.send });

    expect(await row('a')).toMatchObject({
      status: 'failed',
      errorReason: 'email_configuration_changed',
    });
    expect(await row('b')).toMatchObject({ status: 'sent' });
    expect(provider.calls[0].emails.map((email) => email.to[0])).toEqual(['b@example.org']);
  });

  it('splits more rows than one request holds across manifests', async () => {
    const total = EMAIL_BATCH.maxMembers + 3;
    await Promise.all(
      Array.from({ length: total }, (_, i) => seedStaged(`r${i}`, `r${i}@example.org`)),
    );
    const provider = providerAccepting();

    const summary = await flushEmailBatches(db, CFP, null, { ...instant, send: provider.send });

    expect(summary.batches).toBe(2);
    expect(provider.calls.map((call) => call.emails.length).sort()).toEqual([3, EMAIL_BATCH.maxMembers]);
    const sent = (await db.collection(`cfps/${CFP}/emailLog`).where('status', '==', 'sent').get()).size;
    expect(sent).toBe(total);
  });
});
