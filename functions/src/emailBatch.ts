/**
 * Batched provider handoff for `emailLog`.
 *
 * The per-row trigger still owns claiming and every revalidation. Once a row
 * is ready to hand off it is *staged* instead of sent, and the invocation that
 * wins the event's batch lock drains staged rows through Resend's batch
 * endpoint, up to `maxMembers` per request. One submission's committee
 * fan-out becomes one provider request instead of sixteen racing the account
 * limit.
 *
 * Staging and lock acquisition happen in the same transaction, so the two
 * always serialise on the lock document: either the drainer's final query
 * sees the new row, or the stager sees the lock released and drains itself.
 *
 * A batch is a manifest, not a payload. `emailBatches/{batchId}` lists its
 * member rows; content is rendered again at send time from the row and the
 * current configuration. The batch id is the idempotency key, so an ambiguous
 * failure is retried by re-sending the *same* manifest and Resend dedupes it.
 * The manifest also records which rows went on the wire (`requested`), so a
 * replay carries the original composition even after some rows were finalised.
 */

import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions';

import {
  emailConfigurationFingerprint,
  emailContentContext,
  emailTransportConfigurationFingerprint,
  resolveEmailConfiguration,
} from './emailConfig';
import { RESEND_RATE_LIMIT_RETRY, rateLimitWaitMs, renderQueuedEmail } from './email';
import { readResendKey } from './secrets';

export const EMAIL_BATCH = {
  /** Resend allows 100; half that keeps one function run comfortably short. */
  maxMembers: 50,
  /** How long the drainer waits for sibling triggers to stage before the first query. */
  coalesceMs: 1_000,
  /** A drainer that dies leaves a lock another invocation may take over after this. */
  lockMs: 90_000,
  /** Ambiguous provider failures re-send the same manifest this many times. */
  maxAttempts: 5,
  /** Spacing between those re-sends. */
  retryDelayMs: 60_000,
  /** Bounds one drain so it stays inside the trigger timeout. */
  maxRounds: 10,
} as const;

export type BatchStatus = 'pending' | 'completed' | 'failed';

export interface BatchEmailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
}

export type MemberOutcome =
  /** `providerId` is unknown when the provider only confirms an earlier acceptance. */
  | { status: 'sent'; providerId?: string }
  | { status: 'failed'; error: string };

export type BatchSendResult =
  | { ok: true; outcomes: MemberOutcome[] }
  | {
      ok: false;
      error: string;
      ambiguous: boolean;
      /** The key was already used with another payload: the earlier request was accepted. */
      acceptedEarlier?: boolean;
    };

export function batchIdempotencyKey(cfpId: string, batchId: string): string {
  const digest = createHash('sha256').update(JSON.stringify([cfpId, batchId])).digest('hex');
  return `cfp-email-batch/${digest}`;
}

/**
 * Per-index outcomes from a permissive batch response.
 *
 * `data` lists only the accepted emails, in payload order, while `errors` names
 * the rejected indexes — so the two have to be zipped back together rather
 * than read positionally. Returns null when the body is not that shape, which
 * the caller treats as an ambiguous failure.
 */
export function mapBatchResults(count: number, body: unknown): MemberOutcome[] | null {
  const parsed = body as {
    data?: unknown;
    errors?: unknown;
  };
  if (!parsed || !Array.isArray(parsed.data)) return null;
  const errors = new Map<number, string>();
  if (parsed.errors !== undefined) {
    if (!Array.isArray(parsed.errors)) return null;
    for (const entry of parsed.errors as Array<{ index?: unknown; message?: unknown }>) {
      if (!Number.isInteger(entry?.index)) return null;
      errors.set(entry.index as number, String(entry.message ?? 'rejected'));
    }
  }
  const accepted = parsed.data as Array<{ id?: unknown }>;
  if (accepted.length + errors.size !== count) return null;

  const outcomes: MemberOutcome[] = [];
  let next = 0;
  for (let index = 0; index < count; index += 1) {
    const error = errors.get(index);
    if (error !== undefined) {
      outcomes.push({ status: 'failed', error });
      continue;
    }
    const id = accepted[next]?.id;
    next += 1;
    if (typeof id !== 'string' || !id) return null;
    outcomes.push({ status: 'sent', providerId: id });
  }
  return outcomes;
}

interface SendRetryOptions {
  attempts?: number;
  wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * 250)));

/** One batch request. A 429 is retried in place with the same key, like the single send. */
export async function sendBatchViaResend(
  emails: readonly BatchEmailPayload[],
  apiKey: string,
  idempotencyKey: string,
  retry: SendRetryOptions = {},
): Promise<BatchSendResult> {
  const attempts = retry.attempts ?? RESEND_RATE_LIMIT_RETRY.attempts;
  const wait = retry.wait ?? defaultWait;

  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'x-batch-validation': 'permissive',
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(emails),
      });
    } catch (error) {
      return { ok: false, error: `network: ${String(error)}`, ambiguous: true };
    }

    if (response.status === 429 && attempt < attempts) {
      await wait(rateLimitWaitMs(response.headers.get('retry-after')));
      continue;
    }

    const body = (await response.json().catch(() => null)) as
      | { message?: string; name?: string }
      | null;
    if (!response.ok) {
      const conflict = response.status === 409;
      const ambiguous =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500 ||
        (conflict &&
          (body?.name === 'concurrent_idempotent_requests' ||
            /concurrent/i.test(body?.message ?? '')));
      const acceptedEarlier =
        conflict &&
        (body?.name === 'invalid_idempotent_request' ||
          /different payload/i.test(body?.message ?? ''));
      return {
        ok: false,
        error: `${response.status}: ${body?.message ?? 'unknown'}`,
        ambiguous,
        ...(acceptedEarlier ? { acceptedEarlier: true } : {}),
      };
    }
    const outcomes = mapBatchResults(emails.length, body);
    if (!outcomes) {
      return { ok: false, error: 'unreadable batch response', ambiguous: true };
    }
    return { ok: true, outcomes };
  }
}

export interface FlushDeps {
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  send?: typeof sendBatchViaResend;
  readKey?: () => Promise<string>;
  /** A callable recovering stuck batches has no siblings to wait for. */
  coalesceMs?: number;
}

export interface FlushSummary {
  /** `staged` means another invocation holds the lock and will drain this row. */
  role: 'staged' | 'drained' | 'skipped';
  batches: number;
}

/** A row the calling trigger has just cleared for handoff. */
export interface StagedRow {
  ref: DocumentReference;
  claimId: string;
  /** The configuration the trigger validated; the drain refuses to send under another. */
  configurationFingerprint: string;
  reviewed: boolean;
}

function lockHeld(lock: FirebaseFirestore.DocumentSnapshot, now: number): boolean {
  const expiresAt = lock.get('expiresAt') as Timestamp | undefined;
  return lock.exists && expiresAt instanceof Timestamp && expiresAt.toMillis() > now;
}

const terminalRowUpdate = (
  outcome: MemberOutcome,
  preserveProviderAttempt: boolean,
  errorReason?: string,
) => ({
  status: outcome.status,
  providerId:
    outcome.status === 'sent' && outcome.providerId ? outcome.providerId : FieldValue.delete(),
  error: outcome.status === 'failed' ? outcome.error : FieldValue.delete(),
  errorReason: errorReason ?? FieldValue.delete(),
  attemptedAt: FieldValue.serverTimestamp(),
  sentAt: outcome.status === 'sent' ? FieldValue.serverTimestamp() : FieldValue.delete(),
  sendingClaimId: FieldValue.delete(),
  sendingStartedAt: FieldValue.delete(),
  batchStaged: FieldValue.delete(),
  batchStagedAt: FieldValue.delete(),
  batchConfigurationFingerprint: FieldValue.delete(),
  batchReviewed: FieldValue.delete(),
  ...(preserveProviderAttempt ? {} : { providerAttemptId: FieldValue.delete() }),
});

/**
 * Stages `stage` (if given) and drains every staged row of the event through
 * batch requests, unless another invocation already holds the lock.
 */
export async function flushEmailBatches(
  db: Firestore,
  cfpId: string,
  stage: StagedRow | null = null,
  deps: FlushDeps = {},
): Promise<FlushSummary> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? defaultWait;
  const coalesceMs = deps.coalesceMs ?? EMAIL_BATCH.coalesceMs;
  const send = deps.send ?? sendBatchViaResend;
  const readKey = deps.readKey ?? readResendKey;
  const lockRef = db.doc(`cfps/${cfpId}/config/emailBatchLock`);
  const batches = db.collection(`cfps/${cfpId}/emailBatches`);
  const owner = randomUUID();

  const acquired = await db.runTransaction(async (tx) => {
    const [lock, row] = await tx.getAll(lockRef, ...(stage ? [stage.ref] : []));
    if (stage) {
      if (
        !row?.exists ||
        row.get('status') !== 'sending' ||
        row.get('sendingClaimId') !== stage.claimId
      ) {
        return null;
      }
      tx.update(stage.ref, {
        batchStaged: true,
        batchStagedAt: FieldValue.serverTimestamp(),
        batchConfigurationFingerprint: stage.configurationFingerprint,
        batchReviewed: stage.reviewed,
      });
    }
    if (lockHeld(lock, now())) return false;
    tx.set(lockRef, { owner, expiresAt: Timestamp.fromMillis(now() + EMAIL_BATCH.lockMs) });
    return true;
  });
  if (acquired === null) return { role: 'skipped', batches: 0 };
  if (!acquired) return { role: 'staged', batches: 0 };

  /** Runs inside a transaction that must already have read the lock. */
  const ownsLock = (lock: FirebaseFirestore.DocumentSnapshot) =>
    lock.exists && lock.get('owner') === owner;

  /**
   * Claims up to `maxMembers` staged rows into a new manifest. Releases the
   * lock in the same transaction that finds nothing left, closing the window a
   * late stager could fall into.
   */
  const claimBatch = (): Promise<DocumentReference | null> =>
    db.runTransaction(async (tx) => {
      const lock = await tx.get(lockRef);
      if (!ownsLock(lock)) return null;
      const staged = await tx.get(
        db
          .collection(`cfps/${cfpId}/emailLog`)
          .where('batchStaged', '==', true)
          .limit(EMAIL_BATCH.maxMembers),
      );
      const live = staged.docs.filter((doc) => doc.get('status') === 'sending');
      if (live.length === 0) {
        tx.delete(lockRef);
        return null;
      }
      tx.update(lockRef, { expiresAt: Timestamp.fromMillis(now() + EMAIL_BATCH.lockMs) });
      const batchRef = batches.doc();
      tx.create(batchRef, {
        status: 'pending' satisfies BatchStatus,
        members: live.map((doc) => ({
          logId: doc.id,
          providerAttemptId: String(doc.get('providerAttemptId') ?? ''),
        })),
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
        nextAttemptAt: Timestamp.fromMillis(now()),
      });
      for (const doc of live) {
        tx.update(doc.ref, {
          batchId: batchRef.id,
          batchStaged: FieldValue.delete(),
          batchStagedAt: FieldValue.delete(),
        });
      }
      return batchRef;
    });

  const finalizeMember = (
    logId: string,
    batchId: string,
    outcome: MemberOutcome,
    preserveProviderAttempt: boolean,
    errorReason?: string,
  ) =>
    db.runTransaction(async (tx) => {
      const ref = db.doc(`cfps/${cfpId}/emailLog/${logId}`);
      const row = await tx.get(ref);
      if (!row.exists || row.get('status') !== 'sending' || row.get('batchId') !== batchId) {
        return false;
      }
      tx.update(ref, terminalRowUpdate(outcome, preserveProviderAttempt, errorReason));
      return true;
    });

  const sendBatch = async (batchRef: DocumentReference): Promise<void> => {
    const batch = await batchRef.get();
    if (batch.get('status') !== 'pending') return;
    const batchId = batchRef.id;
    const members = (batch.get('members') ?? []) as Array<{ logId: string }>;
    // Once a request has gone on the wire its composition is fixed: a replay
    // under the same key must carry the same rows, whatever their state now.
    const requested = batch.get('requested') as string[] | undefined;
    const replay = Array.isArray(requested);
    const attempt = Number(batch.get('attempts') ?? 0) + 1;

    const [config, cfpSnap, platformSnap] = await Promise.all([
      resolveEmailConfiguration(db, cfpId),
      db.doc(`cfps/${cfpId}`).get(),
      db.doc('config/platform').get(),
    ]);
    const eventUnavailable =
      !replay &&
      (!cfpSnap.exists || cfpSnap.get('deleting') === true || cfpSnap.get('archived') === true);
    const settings = config.settings;
    if (eventUnavailable || !settings.from) {
      const outcome: MemberOutcome = {
        status: 'failed',
        error: eventUnavailable
          ? 'This notification is superseded because the event is unavailable.'
          : 'Email delivery is blocked because its sending identity is not assigned.',
      };
      for (const member of members) {
        await finalizeMember(
          member.logId,
          batchId,
          outcome,
          false,
          eventUnavailable ? 'superseded' : 'email_domain_unbound',
        );
      }
      await batchRef.update({
        status: 'failed' satisfies BatchStatus,
        lastError: outcome.error,
        nextAttemptAt: FieldValue.delete(),
        resolvedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const context = emailContentContext(cfpId, cfpSnap.data() ?? {}, platformSnap.data() ?? {});
    const cfp = { id: cfpId, name: context.cfpName, publicUrl: context.publicUrl };
    const fingerprints = {
      reviewed: emailConfigurationFingerprint(config, context),
      transport: emailTransportConfigurationFingerprint(config),
    };
    const live: Array<{ logId: string; payload: BatchEmailPayload }> = [];
    for (const logId of replay ? requested : members.map((member) => member.logId)) {
      const row = await db.doc(`cfps/${cfpId}/emailLog/${logId}`).get();
      if (!row.exists) continue;
      if (!replay) {
        if (row.get('status') !== 'sending' || row.get('batchId') !== batchId) continue;
        // The trigger validated the row against one configuration; a change in
        // the seconds since is the same refusal the single send makes at handoff.
        const expected = row.get('batchConfigurationFingerprint');
        const current =
          row.get('batchReviewed') === true ? fingerprints.reviewed : fingerprints.transport;
        if (typeof expected === 'string' && expected !== current) {
          await finalizeMember(
            logId,
            batchId,
            {
              status: 'failed',
              error:
                'Email delivery setup changed before provider handoff. Review and retry this message.',
            },
            false,
            'email_configuration_changed',
          );
          continue;
        }
      }
      const rendered = renderQueuedEmail(row.data()!, cfp, config.templates);
      live.push({
        logId,
        payload: {
          from: settings.from,
          to: [String(row.get('to'))],
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
        },
      });
    }
    if (live.length === 0) {
      await batchRef.update({
        status: 'completed' satisfies BatchStatus,
        nextAttemptAt: FieldValue.delete(),
        resolvedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    // Recorded before the request so a crash between provider acceptance and
    // finalisation replays exactly this composition.
    await batchRef.update({
      attempts: attempt,
      ...(replay ? {} : { requested: live.map((member) => member.logId) }),
    });
    const apiKey = await readKey();
    const result = apiKey
      ? await send(
          live.map((member) => member.payload),
          apiKey,
          batchIdempotencyKey(cfpId, batchId),
          { wait },
        )
      : { ok: false as const, error: 'provider key unavailable', ambiguous: true };

    if (result.ok) {
      let sent = 0;
      for (const [index, member] of live.entries()) {
        const outcome = result.outcomes[index];
        if (outcome.status === 'sent') sent += 1;
        await finalizeMember(member.logId, batchId, outcome, false);
      }
      await batchRef.update({
        status: 'completed' satisfies BatchStatus,
        sent,
        failed: live.length - sent,
        nextAttemptAt: FieldValue.delete(),
        resolvedAt: FieldValue.serverTimestamp(),
      });
      logger.info('email batch processed', { cfpId, batchId, sent, failed: live.length - sent });
      return;
    }

    if (result.acceptedEarlier) {
      // The provider holds an earlier request under this key that it accepted,
      // and our re-rendered payload no longer matches it. The rows went out;
      // only their provider ids are lost.
      for (const member of live) {
        await finalizeMember(member.logId, batchId, { status: 'sent' }, false);
      }
      await batchRef.update({
        status: 'completed' satisfies BatchStatus,
        sent: live.length,
        failed: 0,
        lastError: result.error,
        nextAttemptAt: FieldValue.delete(),
        resolvedAt: FieldValue.serverTimestamp(),
      });
      logger.warn('email batch accepted under an earlier attempt', {
        cfpId,
        batchId,
        attempt,
        error: result.error,
      });
      return;
    }

    if (result.ambiguous && attempt < EMAIL_BATCH.maxAttempts) {
      await batchRef.update({
        lastError: result.error,
        nextAttemptAt: Timestamp.fromMillis(now() + EMAIL_BATCH.retryDelayMs),
      });
      logger.warn('email batch deferred', { cfpId, batchId, attempt, error: result.error });
      return;
    }
    for (const member of live) {
      await finalizeMember(
        member.logId,
        batchId,
        { status: 'failed', error: result.error },
        result.ambiguous,
      );
    }
    await batchRef.update({
      status: 'failed' satisfies BatchStatus,
      lastError: result.error,
      nextAttemptAt: FieldValue.delete(),
      resolvedAt: FieldValue.serverTimestamp(),
    });
    logger.error('email batch failed', { cfpId, batchId, attempt, error: result.error });
  };

  let drained = 0;
  try {
    if (coalesceMs > 0) await wait(coalesceMs);
    for (let round = 0; round < EMAIL_BATCH.maxRounds; round += 1) {
      // Only pending batches carry `nextAttemptAt`, so one range query finds
      // the due ones without a composite index.
      const due = await batches
        .where('nextAttemptAt', '<=', Timestamp.fromMillis(now()))
        .limit(5)
        .get();
      for (const doc of due.docs) {
        await sendBatch(doc.ref);
        drained += 1;
      }
      const batchRef = await claimBatch();
      if (!batchRef) return { role: 'drained', batches: drained };
      await sendBatch(batchRef);
      drained += 1;
    }
    return { role: 'drained', batches: drained };
  } finally {
    await db.runTransaction(async (tx: Transaction) => {
      const lock = await tx.get(lockRef);
      if (ownsLock(lock)) tx.delete(lockRef);
    });
  }
}

/** Rows a pending batch may still deliver; an admin retry must not reclaim them. */
export async function pendingBatchMemberIds(db: Firestore, cfpId: string): Promise<Set<string>> {
  const pending = await db
    .collection(`cfps/${cfpId}/emailBatches`)
    .where('status', '==', 'pending')
    .get();
  const ids = new Set<string>();
  for (const doc of pending.docs) {
    for (const member of (doc.get('members') ?? []) as Array<{ logId?: unknown }>) {
      if (typeof member.logId === 'string') ids.add(member.logId);
    }
  }
  return ids;
}
