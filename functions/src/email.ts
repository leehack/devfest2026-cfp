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
  type RenderedEmail,
  type TemplateOverrides,
} from '../../shared/emailTemplates';
import type { EmailSettings } from '../../shared/emailSettings';
import { readResendKey } from './secrets';

/**
 * Neither the key nor the addresses are deploy config: the addresses live in
 * `cfps/{cfpId}/config/email` and the key in Secret Manager, both written from
 * the admin screen. Anything that can only change by redeploying stays wrong for
 * as long as the deploy takes, which on the night decisions go out is too long.
 */
/**
 * Where the site is, most specific first: a stored platform address, then a
 * local override, then the project's own Hosting domain.
 *
 * Platform-level rather than per-CFP, and unwritable through any callable. It
 * is the origin of every link we mail, including sign-in links, which are bearer
 * credentials — an organiser who could edit it could aim other people's
 * sign-in mail at a host of their choosing. Derived rather than written down so
 * a staging project or a fork is right with no configuration, and deliberately
 * *not* taken from the request: `sendQueuedEmail` is a Firestore trigger and has
 * no request at all, and the callables that queue only see a client-supplied
 * `Host`.
 */
const derivedUrl = () => `https://${process.env.GCLOUD_PROJECT ?? 'localhost'}.web.app`;

/**
 * The platform itself: where it lives, what it calls itself, and who it writes
 * as when the message is not about any one CFP — a sign-in link requested from
 * the home page, before the person has picked one.
 */
export interface Platform {
  publicUrl: string;
  name: string;
  settings: EmailSettings;
}

export async function loadPlatform(db: Firestore): Promise<Platform> {
  const stored = (await db.doc('config/platform').get()).data() ?? {};
  return {
    publicUrl: (stored.publicUrl as string) || process.env.CFP_PUBLIC_URL || derivedUrl(),
    name: (stored.name as string) || 'Call for proposals',
    settings: {
      from: (stored.from as string) || process.env.CFP_EMAIL_FROM || '',
      replyTo: (stored.replyTo as string) || '',
      publicUrl: '',
    },
  };
}

/** Where one CFP lives, which is what a speaker's mail should point at. */
export const cfpUrl = (publicUrl: string, cfpId: string) => `${publicUrl}/c/${cfpId}`;

const configDoc = (db: Firestore, cfpId: string) => db.doc(`cfps/${cfpId}/config/email`);

/** Env is the fallback, so a fresh project sends nothing until someone says so. */
export async function loadSettings(db: Firestore, cfpId: string): Promise<EmailSettings> {
  const snap = await configDoc(db, cfpId).get();
  const stored = snap.data() ?? {};
  return {
    from: (stored.from as string) || process.env.CFP_EMAIL_FROM || '',
    replyTo: (stored.replyTo as string) || process.env.CFP_REPLY_TO || '',
    // Not stored here at all — see `loadPublicUrl`. Kept on the type because the
    // renderer needs both halves and one object is easier to pass than two.
    publicUrl: '',
  };
}

/** Organiser-written copy, if any. Absent means the built-in wording is used. */
export async function loadTemplates(db: Firestore, cfpId: string): Promise<TemplateOverrides> {
  const snap = await configDoc(db, cfpId).get();
  return ((snap.data()?.templates ?? {}) as TemplateOverrides) ?? {};
}

export type EmailStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'dry_run';

export interface QueueRequest {
  kind: EmailKind;
  proposalId: string;
  to: string;
  locale: EmailLocale;
  /** The link and the event name are filled in at send time — see `deliver`. */
  data: Omit<EmailData, 'proposalUrl' | 'event'>;
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
  cfpId: string,
  request: QueueRequest,
): Promise<void> {
  const ref = db.doc(`cfps/${cfpId}/emailLog/${logId(request.kind, request.proposalId)}`);
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
 * One rendered message, handed to Resend.
 *
 * Split out from `deliver` so a sign-in link can be sent without going through
 * `emailLog` at all. That link is a bearer credential: anyone who reads it is
 * signed in as its owner, so it must not be written to a collection, kept in a
 * retry queue, or held anywhere it could be read back later.
 */
export async function sendViaResend(
  to: string,
  email: RenderedEmail,
  apiKey: string,
  settings: EmailSettings,
): Promise<SendOutcome> {
  const sender = settings.from;
  if (!apiKey || !sender) {
    logger.warn('email not configured — rendering only', { to, subject: email.subject });
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
        to: [to],
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
  cfp: { id: string; name: string; publicUrl: string },
  templates?: TemplateOverrides,
): Promise<SendOutcome> {
  const locale = (row.locale ?? 'en') as EmailLocale;
  // The link and the event name are resolved now rather than when the row was
  // written, so renaming a CFP or moving the site fixes mail still in the queue.
  const data = {
    ...(row.data as Omit<EmailData, 'proposalUrl' | 'event'>),
    proposalUrl: cfpUrl(cfp.publicUrl, cfp.id),
    event: cfp.name,
  };

  // A message carries its own copy on the row. It was written once, for one
  // person, so there is nothing to look up and nothing an override could apply
  // to — but it still goes through the same renderer.
  const email =
    row.kind === MESSAGE_KIND
      ? renderTemplate({ subject: row.subject as string, body: row.body as string }, locale, data)
      : renderEmail(row.kind as EmailKind, locale, data, templates);

  return sendViaResend(row.to as string, email, apiKey, settings);
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
    document: 'cfps/{cfpId}/emailLog/{logId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const ref = event.data?.after.ref;
    if (!ref || !event.data?.after.exists) return;
    if (event.data.after.get('status') !== 'queued') return;

    const { cfpId } = event.params;
    const db = getFirestore();
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get('status') !== 'queued') return null;
      tx.update(ref, { status: 'sending', attempts: FieldValue.increment(1) });
      return snap.data()!;
    });
    if (!claimed) return;

    const [apiKey, settings, templates, platform, cfpSnap] = await Promise.all([
      readResendKey(),
      loadSettings(db, cfpId),
      loadTemplates(db, cfpId),
      loadPlatform(db),
      db.doc(`cfps/${cfpId}`).get(),
    ]);
    const cfp = {
      id: cfpId,
      name: (cfpSnap.get('name') as string) || cfpId,
      publicUrl: platform.publicUrl,
    };
    const outcome = await deliver(claimed, apiKey, settings, cfp, templates);

    await ref.update({
      status: outcome.status,
      sentAt: FieldValue.serverTimestamp(),
      providerId: outcome.providerId ?? FieldValue.delete(),
      error: outcome.error ?? FieldValue.delete(),
    });

    const line = { cfpId, logId: event.params.logId, kind: claimed.kind, status: outcome.status };
    if (outcome.status === 'failed') logger.error('email failed', { ...line, error: outcome.error });
    else logger.info('email processed', line);
  },
);
