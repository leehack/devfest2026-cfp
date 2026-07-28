/**
 * The email pipeline (§8).
 *
 * Every send goes through `emailLog`, whose document id is derived from what
 * the message is about — so queueing the same message twice is a no-op rather
 * than a second email. Sending is a Firestore trigger rather than part of the
 * request that caused it: a speaker's submission must not fail because Resend
 * is having a bad afternoon, and the trigger retries on its own.
 *
 * Decisions are queued `held` and released as a batch. §8 is explicit that
 * rejections go out at the same time as acceptances — an admin working down the
 * list would otherwise send rejections one at a time over an afternoon, and the
 * people at the top of the alphabet would learn their fate first.
 */

import { FieldValue, getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import {
  DECISION_KINDS,
  MESSAGE_KIND,
  renderEmail,
  renderTemplate,
  type EmailData,
  type EmailKind,
  type EmailLocale,
  type TemplateOverrides,
} from '../../shared/emailTemplates';
import type { EmailSettings } from '../../shared/emailSettings';
import { readResendKey } from './secrets';

/**
 * Neither the key nor the addresses are deploy config: the addresses live in
 * `config/email` and the key in Secret Manager, both written from `#/admin`.
 * Anything that can only change by redeploying stays wrong for as long as the
 * deploy takes, which on the night decisions go out is too long.
 */
/**
 * Where `{proposalUrl}` points, most specific first: an organiser's custom
 * domain, then a local override, then the project's own Hosting domain.
 *
 * Derived rather than written down, so a staging project or a fork is right
 * with no configuration. It is deliberately *not* taken from the request —
 * `sendQueuedEmail` is a Firestore trigger and has no request at all, and the
 * callables that queue only see a client-supplied `Host`, which would let
 * whoever submits a proposal choose the link in mail we send to a speaker.
 */
const derivedUrl = () => `https://${process.env.GCLOUD_PROJECT ?? 'localhost'}.web.app`;

const publicUrl = (settings: EmailSettings) =>
  settings.publicUrl || process.env.CFP_PUBLIC_URL || derivedUrl();

/** Env is the fallback, so a fresh project sends nothing until someone says so. */
export async function loadSettings(db: Firestore): Promise<EmailSettings> {
  const snap = await db.doc('config/email').get();
  const stored = snap.data() ?? {};
  return {
    from: (stored.from as string) || process.env.CFP_EMAIL_FROM || '',
    replyTo: (stored.replyTo as string) || process.env.CFP_REPLY_TO || '',
    // Stored only, unlike the addresses above: this is what the admin field
    // edits, and folding the env fallback in here put `http://localhost:5173`
    // into that field locally — a value `validPublicUrl` then refused to save.
    // The fallback still applies, at render time, in `publicUrl()`.
    publicUrl: (stored.publicUrl as string) || '',
  };
}

/** Organiser-written copy, if any. Absent means the built-in wording is used. */
export async function loadTemplates(db: Firestore): Promise<TemplateOverrides> {
  const snap = await db.doc('config/email').get();
  return ((snap.data()?.templates ?? {}) as TemplateOverrides) ?? {};
}

export type EmailStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'dry_run';

export interface QueueRequest {
  kind: EmailKind;
  proposalId: string;
  to: string;
  locale: EmailLocale;
  data: Omit<EmailData, 'proposalUrl'>;
}

/**
 * One document per (kind, proposal). Two acceptances for the same talk collapse
 * into one row, and therefore one email.
 */
export const logId = (kind: EmailKind, proposalId: string) => `${kind}__${proposalId}`;

/**
 * Queues inside the caller's transaction, so an email is never recorded for a
 * status change that rolled back. Reads the row first — Firestore requires every
 * read before any write, so callers must invoke this before their own writes.
 */
export async function queueEmail(
  db: Firestore,
  tx: Transaction,
  request: QueueRequest,
): Promise<void> {
  const ref = db.doc(`emailLog/${logId(request.kind, request.proposalId)}`);
  const existing = await tx.get(ref);
  if (existing.exists) return;

  if (!request.to) {
    logger.warn('no address to send to', { kind: request.kind, proposalId: request.proposalId });
    return;
  }

  tx.create(ref, {
    ...request,
    // Held decisions wait for an admin to release the whole batch.
    status: (DECISION_KINDS.includes(request.kind) ? 'held' : 'queued') satisfies EmailStatus,
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
}

interface SendOutcome {
  status: EmailStatus;
  providerId?: string;
  error?: string;
}

/**
 * Hands one message to Resend.
 *
 * With no API key configured it renders and logs instead, and records `dry_run`
 * rather than `sent` — a log that claims to have sent mail it did not is worse
 * than no log. That is also what makes the pipeline testable end to end.
 */
export async function deliver(
  row: FirebaseFirestore.DocumentData,
  apiKey: string,
  settings: EmailSettings,
  templates?: TemplateOverrides,
): Promise<SendOutcome> {
  const locale = (row.locale ?? 'en') as EmailLocale;
  const data = {
    ...(row.data as Omit<EmailData, 'proposalUrl'>),
    proposalUrl: publicUrl(settings),
  };

  // A message carries its own copy on the row. It was written once, for one
  // person, so there is nothing to look up and nothing an override could apply
  // to — but it still goes through the same renderer.
  const email =
    row.kind === MESSAGE_KIND
      ? renderTemplate({ subject: row.subject as string, body: row.body as string }, locale, data)
      : renderEmail(row.kind as EmailKind, locale, data, templates);

  const sender = settings.from;
  if (!apiKey || !sender) {
    logger.warn('email not configured — rendering only', {
      kind: row.kind,
      to: row.to,
      subject: email.subject,
    });
    return { status: 'dry_run' };
  }

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        from: sender,
        to: [row.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
      }),
    });
  } catch (error) {
    return { status: 'failed', error: `network: ${String(error)}` };
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    return { status: 'failed', error: `${response.status}: ${body.message ?? 'unknown'}` };
  }
  return { status: 'sent', providerId: body.id };
}

/**
 * Sends anything sitting at `queued`.
 *
 * Firestore triggers are at-least-once, and the same event can arrive twice.
 * The claim below is the guard: a transaction moves `queued` → `sending`, and
 * whichever invocation loses that race sees a status it does not act on and
 * stops. The `sending` write re-fires this trigger, which is why the first thing
 * it does is check the status.
 *
 * `onDocumentWritten` rather than `onDocumentCreated` because decisions are
 * created `held` and become sendable later, on release — an on-create trigger
 * would never see that moment.
 */
export const sendQueuedEmail = onDocumentWritten(
  {
    document: 'emailLog/{logId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const ref = event.data?.after.ref;
    if (!ref || !event.data?.after.exists) return;
    if (event.data.after.get('status') !== 'queued') return;

    const db = getFirestore();
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get('status') !== 'queued') return null;
      tx.update(ref, { status: 'sending', attempts: FieldValue.increment(1) });
      return snap.data()!;
    });
    if (!claimed) return;

    const [apiKey, settings, templates] = await Promise.all([
      readResendKey(),
      loadSettings(db),
      loadTemplates(db),
    ]);
    const outcome = await deliver(claimed, apiKey, settings, templates);

    await ref.update({
      status: outcome.status,
      sentAt: FieldValue.serverTimestamp(),
      providerId: outcome.providerId ?? FieldValue.delete(),
      error: outcome.error ?? FieldValue.delete(),
    });

    const line = { logId: event.params.logId, kind: claimed.kind, status: outcome.status };
    if (outcome.status === 'failed') logger.error('email failed', { ...line, error: outcome.error });
    else logger.info('email processed', line);
  },
);
