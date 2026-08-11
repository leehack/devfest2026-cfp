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

import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import {
  CO_SPEAKER_INVITATION_KINDS,
  DECISION_KINDS,
  PROFILE_UPDATE_REQUEST_EMAIL_KINDS,
  ROLE_INVITATION_EMAIL_KINDS,
  SCHEDULE_EMAIL_KINDS,
  STAFF_EMAIL_KINDS,
  MESSAGE_KIND,
  renderBilingualEmail,
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
import { ensureLegacyEmailDomainBinding } from './emailTenancy';
import {
  coSpeakerInvitationStillTrue,
  profileUpdateRequestStillTrue,
  scheduleEmailStillTrue,
  scheduleReleaseProposalEntryId,
} from './speakerLifecycle';

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

/**
 * Where a speaker's own proposal lives, which is what their mail points at.
 *
 * The submission page rather than the CFP's front page: every message that
 * carries this link is about a talk — confirm it, revise it, read the decision —
 * and a marketing page is not an answer to any of those.
 */
export const cfpUrl = (publicUrl: string, cfpId: string) => `${publicUrl}/c/${cfpId}/submit`;

const configDoc = (db: Firestore, cfpId: string) => db.doc(`cfps/${cfpId}/config/email`);

/** Env is the fallback, so a fresh project sends nothing until someone says so. */
export function settingsFromConfig(stored: Record<string, unknown>): EmailSettings {
  return {
    from: (stored.from as string) || process.env.CFP_EMAIL_FROM || '',
    replyTo: (stored.replyTo as string) || process.env.CFP_REPLY_TO || '',
    // Not stored here at all — see `loadPublicUrl`. Kept on the type because the
    // renderer needs both halves and one object is easier to pass than two.
    publicUrl: '',
  };
}

export async function loadSettings(db: Firestore, cfpId: string): Promise<EmailSettings> {
  const snap = await configDoc(db, cfpId).get();
  const config = snap.data() ?? {};
  const settings = settingsFromConfig(config);
  // A sender is tenant-owned only through the platform binding. Falling back
  // to an address in an unbound config would let a copied legacy pointer keep
  // sending as another CFP even after the binding was assigned correctly.
  if (!(await ensureLegacyEmailDomainBinding(db, cfpId, config))) {
    return { ...settings, from: '' };
  }
  return settings;
}

/** Organiser-written copy, if any. Absent means the built-in wording is used. */
export async function loadTemplates(db: Firestore, cfpId: string): Promise<TemplateOverrides> {
  const snap = await configDoc(db, cfpId).get();
  return ((snap.data()?.templates ?? {}) as TemplateOverrides) ?? {};
}

export type EmailStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'dry_run';

const DECISION_EMAIL_STATUSES: Record<string, readonly string[]> = {
  accepted: ['accepted', 'confirmed', 'declined'],
  waitlisted: ['waitlisted'],
  rejected: ['rejected'],
};

/** A queued decision may outlive the committee action that created it. */
export function decisionEmailStillTrue(
  kind: unknown,
  proposal: FirebaseFirestore.DocumentSnapshot | null | undefined,
): boolean {
  const statuses = DECISION_EMAIL_STATUSES[String(kind ?? '')];
  return Boolean(
    statuses && proposal?.exists && statuses.includes(String(proposal.get('status') ?? '')),
  );
}

/** Admin review pins one address; a trigger may refresh only unreviewed rows. */
export function reviewedRecipientStillTrue(
  row: FirebaseFirestore.DocumentData,
  liveTo: unknown,
): boolean {
  const reviewedTo = row.reviewedTo;
  if (typeof reviewedTo !== 'string' || !reviewedTo) return true;
  return row.to === reviewedTo && liveTo === reviewedTo;
}

/** A send normally completes in seconds; this is the manual-recovery boundary. */
export const EMAIL_SENDING_LEASE_MS = 10 * 60 * 1_000;

type TimestampLike = { toMillis: () => number } | Date | number;

/** `updateTime` is the fallback for rows left by releases before leases existed. */
export function sendingLeaseExpired(
  startedAt: TimestampLike | null | undefined,
  now = Date.now(),
): boolean {
  const started =
    typeof startedAt === 'number'
      ? startedAt
      : startedAt instanceof Date
        ? startedAt.getTime()
        : startedAt?.toMillis();
  return Number.isFinite(started) && now - Number(started) >= EMAIL_SENDING_LEASE_MS;
}

export type EmailClaimMode = 'new' | 'resume';

/**
 * Duplicate delivery of one CloudEvent may resume its claim. A stale queued
 * event may not claim a later manual retry, whose attempt counter has moved on.
 */
export function emailClaimMode(
  row: FirebaseFirestore.DocumentData,
  eventId: string,
  queuedAttempts: number,
): EmailClaimMode | null {
  if (row.status === 'sending' && row.sendingClaimId === eventId) return 'resume';
  if (row.status === 'queued' && Number(row.attempts ?? 0) === queuedAttempts) return 'new';
  return null;
}

/**
 * Provider identity survives an ambiguous timeout and a later queue event.
 * Active Firestore claims may change; the Resend request must not.
 */
export function providerAttemptId(
  row: FirebaseFirestore.DocumentData,
  claimId: string,
): string {
  const existing = row.providerAttemptId;
  return typeof existing === 'string' && existing ? existing : claimId;
}

/** Bounded for Resend's header while retaining all three uniqueness domains. */
export function resendIdempotencyKey(
  cfpId: string,
  logId: string,
  providerAttempt: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([cfpId, logId, providerAttempt]))
    .digest('hex');
  return `cfp-email/${digest}`;
}

export interface QueueRequest {
  kind: EmailKind;
  proposalId: string;
  to: string;
  locale: EmailLocale;
  /** Unknown committee language gets one message containing both EN and FR. */
  bilingual?: boolean;
  /** The link and the event name are filled in at send time — see `deliver`. */
  data: Omit<EmailData, 'proposalUrl' | 'event' | 'scheduleUrl' | 'reviewUrl'> & {
    scheduleEntryId?: string;
  };
  /** Schedule releases need one row per version rather than one row forever. */
  dedupeKey?: string;
  /** Staff and linked-speaker notices are revalidated against this uid before sending. */
  recipientUid?: string;
  /**
   * Extra uniqueness for recipients after the legacy lead-speaker row.
   *
   * The first speaker keeps the historical id (`kind__proposal__release`) so a
   * rollout cannot recreate mail that was already sent. Additional speakers
   * append their uid without changing `dedupeKey`, which must remain the raw
   * release id for schedule-validity checks.
   */
  logIdSuffix?: string;
  /** Pending role invitations are revalidated against this exact grant before sending. */
  grantEmail?: string;
  /** Pending co-speaker invitations are revalidated immediately before delivery. */
  invitationId?: string;
  invitationEmail?: string;
  /** Profile-request mail is bound to one immutable request generation. */
  profileUpdateRequestId?: string;
  profileUpdateRequestGeneration?: number;
}

export function isStaffEmail(kind: unknown): kind is EmailKind {
  return STAFF_EMAIL_KINDS.includes(kind as EmailKind);
}

export function isRoleInvitationEmail(kind: unknown): kind is EmailKind {
  return ROLE_INVITATION_EMAIL_KINDS.includes(kind as EmailKind);
}

export function isCoSpeakerInvitationEmail(kind: unknown): kind is EmailKind {
  return CO_SPEAKER_INVITATION_KINDS.includes(kind as EmailKind);
}

export function isProfileUpdateRequestEmail(kind: unknown): kind is EmailKind {
  return PROFILE_UPDATE_REQUEST_EMAIL_KINDS.includes(kind as EmailKind);
}

export function isScheduleEmail(kind: unknown): kind is EmailKind {
  return SCHEDULE_EMAIL_KINDS.includes(kind as EmailKind);
}

async function scheduleEmailIsCurrent(
  db: Firestore,
  cfpId: string,
  row: FirebaseFirestore.DocumentData,
  cfp: DocumentSnapshot,
  read: (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>,
): Promise<boolean> {
  const releaseId = String(cfp.get('sharedScheduleId') ?? cfp.get('publishedScheduleId') ?? '');
  const proposalId = String(row.proposalId ?? '');
  const entryId = String(row.data?.scheduleEntryId ?? '');
  if (
    !releaseId ||
    !/^(?!__)[A-Za-z0-9_-]{1,256}$/.test(releaseId) ||
    !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(proposalId) ||
    !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(entryId)
  ) {
    return false;
  }
  const [proposal, entry, source] = await read([
    db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
    db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}/entries/${entryId}`),
    db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}/internal/source`),
  ]);
  return scheduleEmailStillTrue(
    String(row.kind ?? ''),
    String(row.dedupeKey ?? ''),
    releaseId,
    entry,
    proposal,
    String(row.recipientUid ?? ''),
    scheduleReleaseProposalEntryId(source, proposalId),
  );
}

async function decisionEmailIsCurrent(
  db: Firestore,
  cfpId: string,
  row: FirebaseFirestore.DocumentData,
  read: (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>,
): Promise<boolean> {
  const proposalId = String(row.proposalId ?? '');
  if (!/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(proposalId)) return false;
  const [proposal] = await read([db.doc(`cfps/${cfpId}/proposals/${proposalId}`)]);
  return decisionEmailStillTrue(row.kind, proposal);
}

/**
 * Final Firestore-backed address check.
 *
 * An admin-reviewed row is pinned to `reviewedTo`. Automatic rows may refresh
 * while they are first claimed, but their refreshed `to` must still match the
 * account immediately before the provider handoff.
 */
async function reviewedRecipientIsCurrent(
  db: Firestore,
  cfpId: string,
  row: FirebaseFirestore.DocumentData,
  read: (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>,
): Promise<boolean> {
  const reviewedTo = row.reviewedTo;
  const reviewed = typeof reviewedTo === 'string' && Boolean(reviewedTo);
  if (reviewed && row.to !== reviewedTo) return false;
  const expectedTo = reviewed ? reviewedTo : row.to;
  if (typeof expectedTo !== 'string' || !expectedTo) return false;
  if (isStaffEmail(row.kind)) return true; // Auth was re-read immediately before this check.
  if (isRoleInvitationEmail(row.kind)) return row.grantEmail === expectedTo;
  if (isCoSpeakerInvitationEmail(row.kind)) return row.invitationEmail === expectedTo;

  const uid = String(row.recipientUid ?? '');
  if (!uid) return true; // Legacy single-speaker rows have no resolvable account id.
  const proposalId = String(row.proposalId ?? '');
  if (
    !/^[^/]{1,128}$/.test(uid) ||
    !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(proposalId)
  ) {
    return false;
  }
  const [speaker, proposal] = await read([
    db.doc(`speakers/${uid}`),
    db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
  ]);
  if (!speaker.exists || speaker.get('email') !== expectedTo || !proposal.exists) return false;
  if (isScheduleEmail(row.kind)) return true;
  const speakerIds = proposal.get('speakerIds');
  return Array.isArray(speakerIds) && speakerIds.includes(uid);
}

async function profileUpdateEmailIsCurrent(
  db: Firestore,
  cfpId: string,
  row: FirebaseFirestore.DocumentData,
  read: (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>,
): Promise<boolean> {
  const proposalId = String(row.proposalId ?? '');
  const speakerUid = String(row.recipientUid ?? '');
  const requestId = String(row.profileUpdateRequestId ?? '');
  const generation = Number(row.profileUpdateRequestGeneration ?? 0);
  if (
    !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(proposalId) ||
    !/^[^/]{1,128}$/.test(speakerUid) ||
    !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(requestId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    return false;
  }
  const [updateRequest, proposal, confirmation] = await read([
    db.doc(
      `cfps/${cfpId}/proposals/${proposalId}/profileUpdateRequests/${speakerUid}`,
    ),
    db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
    db.doc(
      `cfps/${cfpId}/proposals/${proposalId}/speakerConfirmations/${speakerUid}`,
    ),
  ]);
  return profileUpdateRequestStillTrue(
    row.kind,
    requestId,
    generation,
    cfpId,
    proposalId,
    speakerUid,
    updateRequest,
    proposal,
    confirmation,
  );
}

export function staffEmailLanguage(
  stored: FirebaseFirestore.DocumentData | undefined,
): { locale: EmailLocale; bilingual: boolean } {
  const locale = stored?.locale;
  return locale === 'en' || locale === 'fr'
    ? { locale, bilingual: false }
    : { locale: 'en', bilingual: true };
}

export function staffMemberIsActive(
  member: FirebaseFirestore.DocumentData | undefined,
  cfpId: string,
  uid: string,
): boolean {
  return (
    member?.cfpId === cfpId &&
    member.uid === uid &&
    ['owner', 'admin', 'reviewer'].includes(String(member.role ?? ''))
  );
}

export async function verifiedStaffUser(uid: string): Promise<UserRecord | null> {
  try {
    const user = await getAuth().getUser(uid);
    return !user.disabled && user.emailVerified && user.email ? user : null;
  } catch {
    return null;
  }
}

export function staffNotificationStillTrue(
  kind: unknown,
  subjectId: string,
  subject: FirebaseFirestore.DocumentSnapshot | null,
): boolean {
  if (!subject?.exists) return false;
  if (kind === 'committee_proposal_submitted') {
    return ['submitted', 'under_review'].includes(String(subject.get('status') ?? ''));
  }
  if (kind === 'committee_schedule_shared') {
    return subject.get('sharedScheduleId') === subjectId;
  }
  return false;
}

export function roleInvitationStillTrue(
  kind: unknown,
  invitationId: string,
  cfpId: string,
  grantEmail: string,
  grant: FirebaseFirestore.DocumentSnapshot | null,
): boolean {
  if (kind !== 'committee_role_invited' || !grant?.exists) return false;
  return (
    grant.get('cfpId') === cfpId &&
    grant.get('email') === grantEmail &&
    ['admin', 'reviewer'].includes(String(grant.get('role') ?? '')) &&
    grant.get('invitationId') === invitationId &&
    !grant.get('claimedBy')
  );
}

/**
 * One document per (kind, proposal). Two acceptances for the same talk collapse
 * into one row, and therefore one email.
 */
export const logId = (
  kind: EmailKind,
  proposalId: string,
  dedupeKey?: string,
  suffix?: string,
) => [kind, proposalId, dedupeKey, suffix].filter(Boolean).join('__');

/** Queues a recipient fan-out without attempting a transaction read after its first write. */
export async function queueEmails(
  db: Firestore,
  tx: Transaction,
  cfpId: string,
  requests: readonly QueueRequest[],
): Promise<void> {
  if (requests.length === 0) return;

  const prepared = requests.map((request) => ({
    request,
    ref: db.doc(
      `cfps/${cfpId}/emailLog/${logId(
        request.kind,
        request.proposalId,
        request.dedupeKey,
        request.logIdSuffix,
      )}`,
    ),
  }));
  if (new Set(prepared.map(({ ref }) => ref.path)).size !== prepared.length) {
    throw new Error('Email fan-out contains duplicate log ids.');
  }
  const existing = await tx.getAll(...prepared.map(({ ref }) => ref));

  for (const [index, { request, ref }] of prepared.entries()) {
    if (existing[index].exists) continue;
    if (!request.to) {
      logger.warn('no address to send to', {
        kind: request.kind,
        proposalId: request.proposalId,
        recipientUid: request.recipientUid,
      });
      continue;
    }
    const stored = { ...request };
    delete stored.logIdSuffix;
    tx.create(ref, {
      ...stored,
      status: (
        DECISION_KINDS.includes(request.kind) || SCHEDULE_EMAIL_KINDS.includes(request.kind)
          ? 'held'
          : 'queued'
      ) satisfies EmailStatus,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

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
  await queueEmails(db, tx, cfpId, [request]);
}

interface SendOutcome {
  status: EmailStatus;
  providerId?: string;
  error?: string;
  /** The provider may have accepted the request before the response was lost. */
  ambiguous?: boolean;
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
  idempotencyKey?: string,
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
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
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
    return { status: 'failed', error: `network: ${String(error)}`, ambiguous: true };
  }

  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!response.ok) {
    const ambiguousResponse =
      response.status === 408 ||
      response.status >= 500 ||
      (response.status === 409 &&
        (body.name === 'concurrent_idempotent_requests' ||
          /concurrent/i.test(body.message ?? '')));
    return {
      status: 'failed',
      error: `${response.status}: ${body.message ?? 'unknown'}`,
      // Resend has the same idempotent request in flight. Retrying the same key
      // is safe; assigning a new one could send it twice.
      ...(ambiguousResponse ? { ambiguous: true } : {}),
    };
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
  idempotencyKey?: string,
): Promise<SendOutcome> {
  const locale = (row.locale ?? 'en') as EmailLocale;
  // The link and the event name are resolved now rather than when the row was
  // written, so renaming a CFP or moving the site fixes mail still in the queue.
  const data = {
    ...(row.data as Omit<EmailData, 'proposalUrl' | 'event'>),
    proposalUrl: claimedProposalUrl(row, cfp),
    reviewUrl: `${cfp.publicUrl}/c/${cfp.id}/review`,
    scheduleUrl: claimedScheduleUrl(row, cfp),
    event: cfp.name,
  };

  // A message carries its own copy on the row. It was written once, for one
  // person, so there is nothing to look up and nothing an override could apply
  // to — but it still goes through the same renderer.
  const committeeNotice =
    isStaffEmail(row.kind) ||
    isRoleInvitationEmail(row.kind) ||
    isCoSpeakerInvitationEmail(row.kind);
  const email =
    row.kind === MESSAGE_KIND
      ? renderTemplate({ subject: row.subject as string, body: row.body as string }, locale, data)
      : row.bilingual === true && committeeNotice
        ? renderBilingualEmail(row.kind as EmailKind, data, templates)
        : renderEmail(row.kind as EmailKind, locale, data, templates);

  return sendViaResend(row.to as string, email, apiKey, settings, idempotencyKey);
}

function claimedProposalUrl(
  row: FirebaseFirestore.DocumentData,
  cfp: { id: string; publicUrl: string },
): string {
  if (isProfileUpdateRequestEmail(row.kind)) {
    const query = new URLSearchParams({ proposal: String(row.proposalId ?? '') });
    return `${cfpUrl(cfp.publicUrl, cfp.id)}?${query.toString()}`;
  }
  if (!isCoSpeakerInvitationEmail(row.kind)) return cfpUrl(cfp.publicUrl, cfp.id);
  const proposalId = String(row.proposalId ?? '');
  const invitationId = String(row.invitationId ?? '');
  const query = new URLSearchParams({ proposal: proposalId, speakerInvite: invitationId });
  return `${cfpUrl(cfp.publicUrl, cfp.id)}?${query.toString()}`;
}

function claimedScheduleUrl(
  row: FirebaseFirestore.DocumentData,
  cfp: { id: string; publicUrl: string },
): string {
  return row.kind === 'committee_schedule_shared'
    ? `${cfp.publicUrl}/c/${cfp.id}/schedule`
    : cfpUrl(cfp.publicUrl, cfp.id);
}

/**
 * Sends anything sitting at `queued`.
 *
 * Firestore triggers are at-least-once, and the same event can arrive twice.
 * The claim below is the guard: a transaction moves `queued` → `sending`. A
 * retry carrying the same CloudEvent id resumes that attempt with the same
 * provider idempotency key; every other event stops. The `sending` write
 * re-fires this trigger, which is why the first thing it does checks `queued`.
 *
 * `onDocumentWritten` rather than `onDocumentCreated` because decisions are
 * created `held` and become sendable later, on release — an on-create trigger
 * would never see that moment.
 */
export const SEND_QUEUED_EMAIL_TRIGGER_OPTIONS = {
  document: 'cfps/{cfpId}/emailLog/{logId}',
  region: 'northamerica-northeast1',
  maxInstances: 10,
  retry: true,
} as const;

function supersededEmailUpdate(error = 'This notification is superseded.') {
  return {
    status: 'failed' as const,
    error,
    attemptedAt: FieldValue.serverTimestamp(),
    sentAt: FieldValue.delete(),
    sendingClaimId: FieldValue.delete(),
    sendingStartedAt: FieldValue.delete(),
    providerAttemptId: FieldValue.delete(),
  };
}

export const sendQueuedEmail = onDocumentWritten(
  SEND_QUEUED_EMAIL_TRIGGER_OPTIONS,
  async (event) => {
    const ref = event.data?.after.ref;
    if (!ref || !event.data?.after.exists) return;
    if (event.data.after.get('status') !== 'queued') return;

    const { cfpId } = event.params;
    const claimId = event.id;
    const queuedAttempts = Number(event.data.after.get('attempts') ?? 0);
    const db = getFirestore();
    const pending = event.data.after.data()!;
    const recipientUid = isStaffEmail(pending.kind)
      ? String(pending.recipientUid ?? '')
      : '';
    const staffUser = recipientUid ? await verifiedStaffUser(recipientUid) : null;
    const claimed = await db.runTransaction<FirebaseFirestore.DocumentData | null>(async (tx) => {
      const [snap, cfp] = await tx.getAll(ref, db.doc(`cfps/${cfpId}`));
      if (!snap.exists) return null;
      const claimMode = emailClaimMode(snap.data()!, claimId, queuedAttempts);
      if (!claimMode) return null;
      if (!cfp.exists || cfp.get('deleting') === true) {
        tx.update(
          ref,
          supersededEmailUpdate(
            'This notification is superseded because the event was deleted.',
          ),
        );
        return null;
      }
      if (cfp.get('archived') === true) {
        tx.update(
          ref,
          supersededEmailUpdate(
            'This notification is superseded because the event is archived.',
          ),
        );
        return null;
      }
      let to = snap.get('to') as string;
      let language = {
        locale: (snap.get('locale') === 'fr' ? 'fr' : 'en') as EmailLocale,
        bilingual: snap.get('bilingual') === true,
      };
      if (
        isScheduleEmail(snap.get('kind')) &&
        !(await scheduleEmailIsCurrent(db, cfpId, snap.data()!, cfp, (refs) =>
          tx.getAll(...refs)
        ))
      ) {
        tx.update(ref, supersededEmailUpdate());
        return null;
      }
      if (
        isProfileUpdateRequestEmail(snap.get('kind')) &&
        !(await profileUpdateEmailIsCurrent(db, cfpId, snap.data()!, (refs) =>
          tx.getAll(...refs)
        ))
      ) {
        tx.update(ref, supersededEmailUpdate());
        return null;
      }
      if (
        DECISION_KINDS.includes(snap.get('kind')) &&
        !(await decisionEmailIsCurrent(db, cfpId, snap.data()!, (refs) =>
          tx.getAll(...refs)
        ))
      ) {
        tx.update(ref, supersededEmailUpdate());
        return null;
      }
      if (isStaffEmail(snap.get('kind'))) {
        const uid = String(snap.get('recipientUid') ?? '');
        const subjectId = String(snap.get('proposalId') ?? '');
        const subjectRef =
          snap.get('kind') === 'committee_proposal_submitted'
            ? db.doc(`cfps/${cfpId}/proposals/${subjectId}`)
            : db.doc(`cfps/${cfpId}`);
        const [member, subject] = uid
          ? await tx.getAll(db.doc(`cfps/${cfpId}/members/${uid}`), subjectRef)
          : [null, null];
        if (
          !staffUser ||
          staffUser.uid !== uid ||
          !staffMemberIsActive(member?.data(), cfpId, uid) ||
          !staffNotificationStillTrue(snap.get('kind'), subjectId, subject) ||
          !reviewedRecipientStillTrue(snap.data()!, staffUser.email)
        ) {
          tx.update(ref, supersededEmailUpdate());
          return null;
        }
        to = (snap.get('reviewedTo') as string | undefined) || staffUser.email!;
        language = staffEmailLanguage(member?.data());
      } else if (isRoleInvitationEmail(snap.get('kind'))) {
        const invitationId = String(snap.get('proposalId') ?? '');
        const grantEmail = String(snap.get('grantEmail') ?? '');
        const grant = grantEmail
          ? await tx.get(db.doc(`cfps/${cfpId}/roleGrants/${grantEmail}`))
          : null;
        if (
          !roleInvitationStillTrue(
            snap.get('kind'),
            invitationId,
            cfpId,
            grantEmail,
            grant,
          ) ||
          !reviewedRecipientStillTrue(snap.data()!, grantEmail)
        ) {
          tx.update(ref, supersededEmailUpdate());
          return null;
        }
        to = (snap.get('reviewedTo') as string | undefined) || grantEmail;
        language = staffEmailLanguage(grant?.data());
      } else if (isCoSpeakerInvitationEmail(snap.get('kind'))) {
        const proposalId = String(snap.get('proposalId') ?? '');
        const invitationId = String(snap.get('invitationId') ?? '');
        const invitationEmail = String(snap.get('invitationEmail') ?? '');
        const [invitation, proposal] = await tx.getAll(
          db.doc(
            `cfps/${cfpId}/proposals/${proposalId}/speakerInvitations/${invitationId}`,
          ),
          db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
        );
        if (
          !coSpeakerInvitationStillTrue(
            snap.get('kind'),
            invitationId,
            cfpId,
            proposalId,
            invitationEmail,
            invitation,
            proposal,
            cfp,
          ) ||
          !reviewedRecipientStillTrue(snap.data()!, invitationEmail)
        ) {
          tx.update(ref, supersededEmailUpdate());
          return null;
        }
        to = (snap.get('reviewedTo') as string | undefined) || invitationEmail;
        language = { locale: 'en', bilingual: true };
      } else {
        const uid = String(snap.get('recipientUid') ?? '');
        if (uid) {
          const proposalId = String(snap.get('proposalId') ?? '');
          const [proposal, speaker] = await tx.getAll(
            db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
            db.doc(`speakers/${uid}`),
          );
          const speakerIds = proposal.get('speakerIds');
          const latestEmail = speaker.get('email');
          const scheduleNotification = isScheduleEmail(snap.get('kind'));
          if (
            !proposal.exists ||
            !Array.isArray(speakerIds) ||
            (!scheduleNotification && !speakerIds.includes(uid)) ||
            typeof latestEmail !== 'string' ||
            !latestEmail ||
            !reviewedRecipientStillTrue(snap.data()!, latestEmail)
          ) {
            tx.update(ref, supersededEmailUpdate());
            return null;
          }
          to = (snap.get('reviewedTo') as string | undefined) || latestEmail;
          language = {
            locale: speaker.get('locale') === 'fr' ? 'fr' : 'en',
            bilingual: false,
          };
        }
      }
      const claim =
        claimMode === 'new'
          ? {
              status: 'sending' as const,
              attempts: FieldValue.increment(1),
              sendingClaimId: claimId,
              sendingStartedAt: FieldValue.serverTimestamp(),
            }
          : {};
      const providerIdempotencyAttempt = providerAttemptId(snap.data()!, claimId);
      const changedRecipient = to !== snap.get('to');
      const changedLanguage =
        language.locale !== snap.get('locale') || language.bilingual !== snap.get('bilingual');
      if (
        claimMode === 'new' ||
        changedRecipient ||
        changedLanguage ||
        snap.get('providerAttemptId') !== providerIdempotencyAttempt
      ) {
        tx.update(ref, {
          ...claim,
          providerAttemptId: providerIdempotencyAttempt,
          ...(changedRecipient ? { to } : {}),
          locale: language.locale,
          bilingual: language.bilingual,
        });
      }
      return {
        ...snap.data()!,
        sendingClaimId: claimId,
        providerAttemptId: providerIdempotencyAttempt,
        to,
        ...language,
      };
    });
    if (!claimed) return;

    const updateClaim = async (
      fields?: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
      preserveProviderAttempt = false,
      validateFinalState = false,
    ): Promise<boolean> =>
      db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (
          !current.exists ||
          current.get('status') !== 'sending' ||
          current.get('sendingClaimId') !== claimId
        ) {
          return false;
        }
        if (validateFinalState) {
          const latestCfp = await tx.get(db.doc(`cfps/${cfpId}`));
          const invalidEvent =
            !latestCfp.exists ||
            latestCfp.get('deleting') === true ||
            latestCfp.get('archived') === true;
          const invalidSchedule =
            !invalidEvent &&
            isScheduleEmail(current.get('kind')) &&
            !(await scheduleEmailIsCurrent(db, cfpId, current.data()!, latestCfp, (refs) =>
              tx.getAll(...refs)
            ));
          const invalidProfileUpdate =
            !invalidEvent &&
            isProfileUpdateRequestEmail(current.get('kind')) &&
            !(await profileUpdateEmailIsCurrent(db, cfpId, current.data()!, (refs) =>
              tx.getAll(...refs)
            ));
          const invalidDecision =
            !invalidEvent &&
            DECISION_KINDS.includes(current.get('kind')) &&
            !(await decisionEmailIsCurrent(db, cfpId, current.data()!, (refs) =>
              tx.getAll(...refs)
            ));
          let invalidStaff = false;
          if (!invalidEvent && isStaffEmail(current.get('kind'))) {
            const uid = String(current.get('recipientUid') ?? '');
            const subjectId = String(current.get('proposalId') ?? '');
            const member = uid
              ? await tx.get(db.doc(`cfps/${cfpId}/members/${uid}`))
              : null;
            const subject =
              current.get('kind') === 'committee_proposal_submitted'
                ? await tx.get(db.doc(`cfps/${cfpId}/proposals/${subjectId}`))
                : latestCfp;
            invalidStaff =
              !uid ||
              !staffMemberIsActive(member?.data(), cfpId, uid) ||
              !staffNotificationStillTrue(current.get('kind'), subjectId, subject);
          }
          let invalidRoleInvitation = false;
          if (!invalidEvent && isRoleInvitationEmail(current.get('kind'))) {
            const invitationId = String(current.get('proposalId') ?? '');
            const grantEmail = String(current.get('grantEmail') ?? '');
            const grant = grantEmail
              ? await tx.get(db.doc(`cfps/${cfpId}/roleGrants/${grantEmail}`))
              : null;
            invalidRoleInvitation = !roleInvitationStillTrue(
              current.get('kind'),
              invitationId,
              cfpId,
              grantEmail,
              grant,
            );
          }
          let invalidCoSpeakerInvitation = false;
          if (!invalidEvent && isCoSpeakerInvitationEmail(current.get('kind'))) {
            const proposalId = String(current.get('proposalId') ?? '');
            const invitationId = String(current.get('invitationId') ?? '');
            const invitationEmail = String(current.get('invitationEmail') ?? '');
            const [invitation, proposal] = await tx.getAll(
              db.doc(
                `cfps/${cfpId}/proposals/${proposalId}/speakerInvitations/${invitationId}`,
              ),
              db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
            );
            invalidCoSpeakerInvitation = !coSpeakerInvitationStillTrue(
              current.get('kind'),
              invitationId,
              cfpId,
              proposalId,
              invitationEmail,
              invitation,
              proposal,
              latestCfp,
            );
          }
          const invalidReviewedRecipient =
            !invalidEvent &&
            !(await reviewedRecipientIsCurrent(db, cfpId, current.data()!, (refs) =>
              tx.getAll(...refs)
            ));
          if (
            invalidEvent ||
            invalidSchedule ||
            invalidProfileUpdate ||
            invalidDecision ||
            invalidStaff ||
            invalidRoleInvitation ||
            invalidCoSpeakerInvitation ||
            invalidReviewedRecipient
          ) {
            tx.update(ref, supersededEmailUpdate());
            return false;
          }
        }
        if (fields) {
          const terminalStatus = String(fields.status ?? '');
          const terminal = ['sent', 'failed', 'dry_run'].includes(terminalStatus);
          const terminalAt = terminal ? FieldValue.serverTimestamp() : null;
          tx.update(ref, {
            ...fields,
            ...(terminal
              ? {
                  attemptedAt: terminalAt!,
                  sentAt: terminalStatus === 'sent' ? terminalAt! : FieldValue.delete(),
                  sendingClaimId: FieldValue.delete(),
                  sendingStartedAt: FieldValue.delete(),
                  ...(!preserveProviderAttempt
                    ? { providerAttemptId: FieldValue.delete() }
                    : {}),
                }
              : {}),
          });
        }
        return true;
      });

    const [apiKey, templates, platform, cfpSnap] = await Promise.all([
      readResendKey(),
      loadTemplates(db, cfpId),
      loadPlatform(db),
      db.doc(`cfps/${cfpId}`).get(),
    ]);
    const cfp = {
      id: cfpId,
      name: (cfpSnap.get('name') as string) || cfpId,
      publicUrl: platform.publicUrl,
    };
    if (!cfpSnap.exists || cfpSnap.get('deleting') === true) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded because the event was deleted.',
      });
      return;
    }
    if (cfpSnap.get('archived') === true) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded because the event is archived.',
      });
      return;
    }
    if (
      isProfileUpdateRequestEmail(claimed.kind) &&
      !(await profileUpdateEmailIsCurrent(db, cfpId, claimed, (refs) => db.getAll(...refs)))
    ) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded.',
      });
      return;
    }
    if (isStaffEmail(claimed.kind)) {
      const uid = String(claimed.recipientUid ?? '');
      const subjectId = String(claimed.proposalId ?? '');
      const subjectRef =
        claimed.kind === 'committee_proposal_submitted'
          ? db.doc(`cfps/${cfpId}/proposals/${subjectId}`)
          : db.doc(`cfps/${cfpId}`);
      const [latestUser, member, subject] = await Promise.all([
        uid ? verifiedStaffUser(uid) : Promise.resolve(null),
        uid ? db.doc(`cfps/${cfpId}/members/${uid}`).get() : Promise.resolve(null),
        subjectRef.get(),
      ]);
      if (
        !latestUser?.email ||
        !staffMemberIsActive(member?.data(), cfpId, uid) ||
        !staffNotificationStillTrue(claimed.kind, subjectId, subject) ||
        !reviewedRecipientStillTrue(claimed, latestUser.email)
      ) {
        await updateClaim({
          status: 'failed',
          error: 'This notification is superseded.',
        });
        return;
      }
      const language = staffEmailLanguage(member?.data());
      const recipient = (claimed.reviewedTo as string | undefined) || latestUser.email;
      if (
        claimed.to !== recipient ||
        claimed.locale !== language.locale ||
        claimed.bilingual !== language.bilingual
      ) {
        if (!(await updateClaim({ to: recipient, ...language }))) return;
      }
      claimed.to = recipient;
      Object.assign(claimed, language);
    } else if (isRoleInvitationEmail(claimed.kind)) {
      const invitationId = String(claimed.proposalId ?? '');
      const grantEmail = String(claimed.grantEmail ?? '');
      const grant = grantEmail
        ? await db.doc(`cfps/${cfpId}/roleGrants/${grantEmail}`).get()
        : null;
      if (
        !roleInvitationStillTrue(
          claimed.kind,
          invitationId,
          cfpId,
          grantEmail,
          grant,
        ) ||
        !reviewedRecipientStillTrue(claimed, grantEmail)
      ) {
        await updateClaim({
          status: 'failed',
          error: 'This notification is superseded.',
        });
        return;
      }
      const language = staffEmailLanguage(grant?.data());
      const recipient = (claimed.reviewedTo as string | undefined) || grantEmail;
      if (
        claimed.to !== recipient ||
        claimed.locale !== language.locale ||
        claimed.bilingual !== language.bilingual
      ) {
        if (!(await updateClaim({ to: recipient, ...language }))) return;
      }
      claimed.to = recipient;
      Object.assign(claimed, language);
    } else if (isCoSpeakerInvitationEmail(claimed.kind)) {
      const proposalId = String(claimed.proposalId ?? '');
      const invitationId = String(claimed.invitationId ?? '');
      const invitationEmail = String(claimed.invitationEmail ?? '');
      const [invitation, proposal] = await Promise.all([
        db.doc(
          `cfps/${cfpId}/proposals/${proposalId}/speakerInvitations/${invitationId}`,
        ).get(),
        db.doc(`cfps/${cfpId}/proposals/${proposalId}`).get(),
      ]);
      if (
        !coSpeakerInvitationStillTrue(
          claimed.kind,
          invitationId,
          cfpId,
          proposalId,
          invitationEmail,
          invitation,
          proposal,
          cfpSnap,
        ) ||
        !reviewedRecipientStillTrue(claimed, invitationEmail)
      ) {
        await updateClaim({
          status: 'failed',
          error: 'This notification is superseded.',
        });
        return;
      }
      const language = { locale: 'en' as const, bilingual: true };
      const recipient = (claimed.reviewedTo as string | undefined) || invitationEmail;
      if (
        claimed.to !== recipient ||
        claimed.locale !== language.locale ||
        claimed.bilingual !== language.bilingual
      ) {
        if (!(await updateClaim({ to: recipient, ...language }))) return;
      }
      claimed.to = recipient;
      Object.assign(claimed, language);
    } else {
      const uid = String(claimed.recipientUid ?? '');
      if (uid) {
        const proposalId = String(claimed.proposalId ?? '');
        const [proposal, speaker] = await Promise.all([
          db.doc(`cfps/${cfpId}/proposals/${proposalId}`).get(),
          db.doc(`speakers/${uid}`).get(),
        ]);
        const speakerIds = proposal.get('speakerIds');
        const latestEmail = speaker.get('email');
        const scheduleNotification = isScheduleEmail(claimed.kind);
        if (
          !proposal.exists ||
          !Array.isArray(speakerIds) ||
          (!scheduleNotification && !speakerIds.includes(uid)) ||
          typeof latestEmail !== 'string' ||
          !latestEmail ||
          !reviewedRecipientStillTrue(claimed, latestEmail)
        ) {
          await updateClaim({
            status: 'failed',
            error: 'This notification is superseded.',
          });
          return;
        }
        const language = {
          locale: (speaker.get('locale') === 'fr' ? 'fr' : 'en') as EmailLocale,
          bilingual: false,
        };
        const recipient = (claimed.reviewedTo as string | undefined) || latestEmail;
        if (
          claimed.to !== recipient ||
          claimed.locale !== language.locale ||
          claimed.bilingual !== language.bilingual
        ) {
          if (!(await updateClaim({ to: recipient, ...language }))) return;
        }
        claimed.to = recipient;
        Object.assign(claimed, language);
      }
    }
    const finalCfp = await db.doc(`cfps/${cfpId}`).get();
    if (!finalCfp.exists || finalCfp.get('deleting') === true) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded because the event was deleted.',
      });
      return;
    }
    if (finalCfp.get('archived') === true) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded because the event is archived.',
      });
      return;
    }
    if (
      isScheduleEmail(claimed.kind) &&
      !(await scheduleEmailIsCurrent(db, cfpId, claimed, finalCfp, (refs) =>
        db.getAll(...refs)
      ))
    ) {
      await updateClaim({
        status: 'failed',
        error: 'This notification is superseded.',
      });
      return;
    }
    const finalEmailConfig = await db.doc(`cfps/${cfpId}/config/email`).get();
    const finalEmailData = finalEmailConfig.data() ?? {};
    const configuredForDelivery = Boolean(
      finalEmailData.from || finalEmailData.domain || finalEmailData.domainId,
    );
    if (
      configuredForDelivery &&
      !(await ensureLegacyEmailDomainBinding(db, cfpId, finalEmailData))
    ) {
      await updateClaim({
        status: 'failed',
        error: 'Email delivery is blocked because this sending domain is not assigned to the event.',
      });
      return;
    }
    const settings = settingsFromConfig(finalEmailData);
    // This is the final state check before the provider handoff. An archive
    // racing the HTTP request itself cannot recall a message Resend accepted.
    if (!(await updateClaim(undefined, false, true))) return;
    const outcome = await deliver(
      claimed,
      apiKey,
      settings,
      cfp,
      templates,
      resendIdempotencyKey(
        cfpId,
        event.params.logId,
        String(claimed.providerAttemptId ?? claimId),
      ),
    );

    const finalized = await updateClaim(
      {
        status: outcome.status,
        providerId: outcome.providerId ?? FieldValue.delete(),
        error: outcome.error ?? FieldValue.delete(),
      },
      outcome.ambiguous === true,
    );
    if (!finalized) return;

    const line = { cfpId, logId: event.params.logId, kind: claimed.kind, status: outcome.status };
    if (outcome.status === 'failed') logger.error('email failed', { ...line, error: outcome.error });
    else logger.info('email processed', line);
  },
);
