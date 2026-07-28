/**
 * §6 makes `status` and `aggregate` function-writable only, so the
 * draft → submitted transition cannot happen in the browser. That gives one
 * server-side chokepoint which re-runs validation and re-checks the deadline
 * against the server clock — neither can be bypassed by posting to Firestore.
 */

import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { inStatusSet, LIMITS, STATUS_SETS } from '../../shared/enums';
import { submissionSchema } from '../../shared/schema';
import { aggregateReviews, type ReviewRecord } from '../../shared/aggregate';
import { parseSessionizeProfile, parseSessionizeUrl } from '../../shared/sessionize';
import {
  DECISION_KINDS,
  EMAIL_KINDS,
  EMAIL_LOCALES,
  MESSAGE_KIND,
  renderSignInEmail,
  validateTemplate,
  type EmailKind,
  type EmailLocale,
  type Template,
} from '../../shared/emailTemplates';
import { validateSettings, type EmailSettings } from '../../shared/emailSettings';
import {
  EMPTY_FORM,
  normaliseForm,
  validateAnswers,
  validateForm,
  type Answers,
  type ConfirmForm,
} from '../../shared/confirmForm';
import { claim, grant, revoke, RoleError } from './roles';
import {
  deliver,
  loadSettings,
  loadTemplates,
  publicUrl,
  queueEmail,
  sendViaResend,
  type EmailStatus,
} from './email';
import { keyHint, readResendKey, writeResendKey } from './secrets';
import {
  addDomain,
  cleanDomain,
  getDomain,
  listDomains,
  ResendError,
  verifyDomain,
} from './domains';

export { sendQueuedEmail } from './email';

initializeApp();
const db = getFirestore();

/**
 * Blaze bills per invocation, so every callable caps its own fan-out. A CFP
 * peaks at a few hundred submissions in the last hour before the deadline —
 * anything past this ceiling is a loop or an attack, and should queue rather
 * than autoscale into a bill.
 */
const CALLABLE = { region: 'northamerica-northeast1', maxInstances: 10 } as const;

/** How many emailLog rows the admin panel gets in one response. */
const ROW_CAP = 500;

interface CfpWindow {
  paused: boolean;
  opensAt: Timestamp;
  closesAt: Timestamp;
}

/** Fails closed: a missing config document must not read as "wide open". */
async function assertCfpOpen(): Promise<void> {
  const snap = await db.doc('config/cfp').get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'CFP is not configured.');
  }
  const cfp = snap.data() as CfpWindow;
  const now = Date.now();
  if (cfp.paused) {
    throw new HttpsError('failed-precondition', 'The CFP is currently paused.');
  }
  if (now < cfp.opensAt.toMillis()) {
    throw new HttpsError('failed-precondition', 'The CFP has not opened yet.');
  }
  if (now >= cfp.closesAt.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'The CFP has closed.');
  }
}

function requireUid(request: { auth?: { uid: string } }, action: string): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', `Sign in to ${action}.`);
  return uid;
}

async function requireAdmin(request: { auth?: { uid: string } }, action: string): Promise<string> {
  const uid = requireUid(request, action);
  const reviewer = await db.doc(`reviewers/${uid}`).get();
  if (!reviewer.exists || reviewer.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', `Only an admin can ${action}.`);
  }
  return uid;
}

/** RoleError carries the code the caller should see; anything else is ours. */
function asHttpsError(error: unknown): HttpsError {
  if (error instanceof RoleError) return new HttpsError(error.code, error.message);
  logger.error('unexpected role failure', { error: String(error) });
  return new HttpsError('internal', 'Could not complete that change.');
}

function requireProposalId(data: unknown): string {
  const id = (data as { proposalId?: unknown } | undefined)?.proposalId;
  if (typeof id !== 'string' || !id) {
    throw new HttpsError('invalid-argument', 'proposalId is required.');
  }
  return id;
}

/**
 * Loads a proposal the caller owns. Non-ownership reports `not-found`, the same
 * as a missing document — an authenticated prober learns nothing about other
 * people's proposals either way.
 */
async function readOwnProposal(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  uid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError('not-found', 'Proposal not found.');
  const proposal = snap.data()!;
  if (!(proposal.speakerIds ?? []).includes(uid)) {
    throw new HttpsError('not-found', 'Proposal not found.');
  }
  return proposal;
}

/**
 * Reassembles the stored draft into the shape `submissionSchema` expects.
 * The proposal document holds the talk; the speaker document holds the person.
 */
function assemble(proposal: FirebaseFirestore.DocumentData, speaker: FirebaseFirestore.DocumentData) {
  return {
    proposal: {
      title: proposal.title,
      abstract: proposal.abstract,
      pitch: proposal.pitch,
      category: proposal.category,
      format: proposal.format,
      level: proposal.level,
      deliveryLanguage: proposal.deliveryLanguage,
      languagePreference: proposal.languagePreference,
    },
    speaker: {
      name: speaker.name,
      bio: speaker.bio,
      company: speaker.company,
      jobTitle: speaker.jobTitle,
      basedIn: speaker.basedIn,
      socials: speaker.socials ?? [],
      isGde: speaker.isGde ?? false,
      pastTalks: speaker.pastTalks,
      email: speaker.email,
    },
    acks: proposal.acks ?? {},
    attendance: proposal.attendance ?? {},
  };
}

/**
 * Everything an email needs about a proposal, gathered inside the caller's
 * transaction. Returns null when there is nobody to write to — an email is
 * never a reason to fail the operation that triggered it.
 */
async function emailContext(
  tx: FirebaseFirestore.Transaction,
  proposal: FirebaseFirestore.DocumentData,
) {
  // `speakerIds` is always exactly `[author]` today (see firestore.rules). When
  // co-presenters arrive this has to mail all of them — one row per speaker, so
  // the log id needs their uid in it too.
  const speakerId = (proposal.speakerIds ?? [])[0];
  if (!speakerId) return null;

  const snap = await tx.get(db.doc(`speakers/${speakerId}`));
  const speaker = snap.data();
  if (!speaker?.email) return null;

  return {
    to: speaker.email as string,
    locale: (speaker.locale === 'fr' ? 'fr' : 'en') as EmailLocale,
    data: {
      speakerName: (speaker.name as string) || (speaker.email as string),
      title: (proposal.title as string) ?? '',
      needsVisa: proposal.attendance?.needsVisa === true,
    },
  };
}

export const submitProposal = onCall(CALLABLE, async (request) => {
  const uid = requireUid(request, 'submit a proposal');
  const proposalId = requireProposalId(request.data);

  await assertCfpOpen();

  const proposalRef = db.doc(`proposals/${proposalId}`);

  const result = await db.runTransaction(async (tx) => {
    const proposal = await readOwnProposal(tx, proposalRef, uid);

    if (proposal.status === 'submitted') {
      return { alreadySubmitted: true };
    }
    if (proposal.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" can no longer be submitted.`,
      );
    }

    const speakerSnap = await tx.get(db.doc(`speakers/${uid}`));
    if (!speakerSnap.exists) {
      throw new HttpsError('failed-precondition', 'Complete your speaker profile first.');
    }

    // Drafts are uncapped — reviewers never see them. What is capped is how many
    // a speaker can put in front of the committee. Counted in memory rather than
    // with a `status in` clause, which would need a composite index for a
    // handful of documents.
    const mine = await tx.get(
      db.collection('proposals').where('speakerIds', 'array-contains', uid),
    );
    const live = mine.docs.filter((d) => inStatusSet('live', d.data().status)).length;
    if (live >= LIMITS.maxTalksPerSpeaker) {
      throw new HttpsError(
        'resource-exhausted',
        `You have already submitted ${LIMITS.maxTalksPerSpeaker} talks.`,
      );
    }

    // The authoritative pass; the browser's copy only renders inline errors.
    const parsed = submissionSchema.safeParse(assemble(proposal, speakerSnap.data()!));
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'The proposal is incomplete.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    // Queued in the same transaction as the status change: no receipt for a
    // submission that rolled back, and no submission without a receipt. Must
    // precede the write below — Firestore allows no reads after a write.
    const context = await emailContext(tx, proposal);
    if (context) {
      await queueEmail(db, tx, { kind: 'submission_received', proposalId, ...context });
    }

    tx.update(proposalRef, {
      status: 'submitted',
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { alreadySubmitted: false };
  });

  logger.info('proposal submitted', { proposalId, uid, ...result });
  return { ok: true, proposalId, ...result };
});

/**
 * Withdrawal is a status change rather than a delete: the rules block deletes
 * outright so the emailLog audit trail cannot be orphaned.
 */
export const withdrawProposal = onCall(CALLABLE, async (request) => {
  const uid = requireUid(request, 'withdraw a proposal');
  const proposalId = requireProposalId(request.data);

  const proposalRef = db.doc(`proposals/${proposalId}`);

  await db.runTransaction(async (tx) => {
    const proposal = await readOwnProposal(tx, proposalRef, uid);
    if (!inStatusSet('withdrawable', proposal.status)) {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" cannot be withdrawn.`,
      );
    }
    const context = await emailContext(tx, proposal);
    if (context) {
      await queueEmail(db, tx, { kind: 'withdrawn', proposalId, ...context });
    }

    tx.update(proposalRef, {
      status: 'withdrawn',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('proposal withdrawn', { proposalId, uid });
  return { ok: true };
});

/**
 * The speaker's answer to an acceptance.
 *
 * A callable rather than a rule because `status` is function-written only, and
 * because the answer has a precondition a rule cannot express cheaply: it is
 * only meaningful from `accepted`. Confirming twice is idempotent; changing a
 * confirmation to a decline is allowed, since plans change and the alternative
 * is an organiser doing it by hand from an email.
 *
 * No token in the link: the CFP is behind Google sign-in and the proposal is
 * already the speaker's, so the session is the authentication. A one-time token
 * would be a second, weaker credential to leak, expire and support.
 */
/** The organiser's questions, or none. Missing means nothing extra is asked. */
async function loadConfirmForm(): Promise<ConfirmForm> {
  const snap = await db.doc('config/confirmForm').get();
  const fields = snap.data()?.fields;
  return Array.isArray(fields) ? ({ fields } as ConfirmForm) : EMPTY_FORM;
}

export const respondToDecision = onCall(CALLABLE, async (request) => {
  const uid = requireUid(request, 'answer a decision');
  const proposalId = requireProposalId(request.data);
  const data = (request.data ?? {}) as { response?: unknown; answers?: unknown };
  const response = String(data.response ?? '');

  if (response !== 'confirm' && response !== 'decline') {
    throw new HttpsError('invalid-argument', 'Answer must be "confirm" or "decline".');
  }
  const status = response === 'confirm' ? 'confirmed' : 'declined';

  /*
   * Only a confirmation carries answers. Someone who cannot come should not
   * have to fill in a t-shirt size to say so — a decline that is harder than
   * silence is a decline we do not hear until it is too late to fill the slot.
   *
   * Validated here rather than trusted from the browser: `confirmAnswers` is in
   * `protectedKeys`, so this callable is the only way it is ever written, and
   * the client's copy of the form is a convenience.
   */
  let answers: Answers = {};
  if (status === 'confirmed') {
    const form = await loadConfirmForm();
    const checked = validateAnswers(form, (data.answers ?? {}) as Answers);
    if (Object.keys(checked.faults).length > 0) {
      throw new HttpsError('invalid-argument', 'Some answers need fixing.', checked.faults);
    }
    answers = checked.clean;
  }

  await db.runTransaction(async (tx) => {
    const proposalRef = db.doc(`proposals/${proposalId}`);
    const proposal = await readOwnProposal(tx, proposalRef, uid);

    // `confirmed` is in the set so that re-clicking a mailed link is a no-op
    // rather than an error the speaker has to interpret.
    if (!inStatusSet('speakerResponse', proposal.status) && proposal.status !== 'accepted') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" has no decision to answer.`,
      );
    }

    tx.update(proposalRef, {
      status,
      confirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Replaced wholesale, not merged: confirming again is how a speaker
      // corrects an answer, and a merge would leave the old one behind.
      ...(status === 'confirmed' ? { confirmAnswers: answers } : {}),
    });
  });

  logger.info('decision answered', { proposalId, uid, status });
  return { ok: true, status };
});

/**
 * The questions asked after someone says yes. Admin only, and stored rather
 * than coded so an organiser can add "do you need a power outlet" the week they
 * discover they need to know.
 *
 * Replaces the whole list. Editing one field of a form held in one document is
 * a read-modify-write either way; doing it in the browser and sending the
 * result keeps the merge where the admin can see it.
 */
export const setConfirmForm = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'change the confirmation form');
  const fields = (request.data as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(fields)) {
    throw new HttpsError('invalid-argument', 'fields must be a list.');
  }

  const form = normaliseForm({ fields } as ConfirmForm);
  const fault = validateForm(form);
  if (fault) {
    throw new HttpsError(
      'invalid-argument',
      fault.key ? `${fault.problem} on "${fault.key}"` : fault.problem,
      fault,
    );
  }

  await db.doc('config/confirmForm').set(form);
  logger.info('confirm form saved', { byUid, fields: form.fields.length });
  return { ok: true, fields: form.fields };
});

/**
 * Recomputes `aggregate` on every reviewed proposal. Run once when the round
 * closes (§8) — a batch job, not a trigger: a z-score is relative to everything
 * that reviewer scored, so one new review moves the normalised score of every
 * proposal they touched. Per-review triggers would fan out across the whole
 * collection and race each other.
 */
export const recomputeAggregates = onCall(CALLABLE, async (request) => {
  const uid = await requireAdmin(request, 'close the review round');

  // Collection group: every review on every proposal, in one read pass.
  const reviewSnaps = await db.collectionGroup('reviews').get();

  const reviews: ReviewRecord[] = reviewSnaps.docs.map((d) => ({
    // reviews live at proposals/{proposalId}/reviews/{reviewerUid}
    proposalId: d.ref.parent.parent!.id,
    reviewerUid: d.id,
    score: d.data().score,
    conflictOfInterest: d.data().conflictOfInterest === true,
  }));

  const aggregates = aggregateReviews(reviews);

  // Firestore caps a batch at 500 writes.
  const entries = [...aggregates.entries()];
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    for (const [proposalId, aggregate] of entries.slice(i, i + CHUNK)) {
      batch.update(db.doc(`proposals/${proposalId}`), {
        aggregate,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  logger.info('aggregates recomputed', {
    uid,
    reviews: reviews.length,
    proposals: aggregates.size,
  });

  return { ok: true, reviewCount: reviews.length, proposalCount: aggregates.size };
});

/**
 * Fetches and parses a public Sessionize profile. Writes nothing.
 *
 * Server-side because sessionize.com sends no CORS headers — which makes it an
 * SSRF surface, so the URL is rebuilt from a validated handle rather than taken
 * from the caller. `parseSessionizeUrl` is unit-tested against host-suffix
 * tricks and link-local addresses.
 */
export const importSessionizeProfile = onCall(
  { ...CALLABLE, timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    const uid = requireUid(request, 'import a profile');

    const parsed = parseSessionizeUrl((request.data as { url?: string } | undefined)?.url ?? '');
    if (!parsed) {
      throw new HttpsError(
        'invalid-argument',
        'That does not look like a Sessionize link. Paste your profile (sessionize.com/your-name) or a talk (sessionize.com/s/your-name/…).',
      );
    }

    const { handle, sessionId } = parsed;

    // The profile page even for a talk link: it carries the bio *and* every
    // talk with its full abstract, so it is one request that returns more.
    const target = `https://sessionize.com/${handle}/`;

    let response: Response;
    try {
      response = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          // Identify ourselves rather than pretending to be a browser.
          'user-agent': 'DevFestMTL-CFP/1.0 (+https://sessionize.com/ profile import)',
          accept: 'text/html',
        },
      });
    } catch (error) {
      logger.warn('sessionize fetch failed', { handle, error: String(error) });
      throw new HttpsError('unavailable', 'Could not reach Sessionize. Please try again.');
    }

    // A redirect could still land somewhere else; re-check the final host.
    const finalHost = new URL(response.url || target).hostname.toLowerCase();
    if (finalHost !== 'sessionize.com' && finalHost !== 'www.sessionize.com') {
      throw new HttpsError('permission-denied', 'That link redirected off Sessionize.');
    }

    if (response.status === 404) {
      throw new HttpsError('not-found', `No Sessionize profile found at sessionize.com/${handle}`);
    }
    if (!response.ok) {
      throw new HttpsError('unavailable', `Sessionize returned ${response.status}.`);
    }

    const html = await response.text();
    const profile = parseSessionizeProfile(html, handle);

    // Nothing usable almost always means the markup moved, not an empty
    // profile. Say so, rather than returning a blank the form would ignore.
    if (!profile.bio && !profile.name) {
      logger.error('sessionize parse produced nothing', { handle, warnings: profile.warnings });
      throw new HttpsError(
        'internal',
        'That page loaded but nothing could be read from it. Sessionize may have changed their layout — please fill the form in manually and let the organisers know.',
      );
    }

    // A pasted talk that is no longer listed: say so rather than silently
    // importing a different one.
    const preselect =
      sessionId && profile.sessions.some((s) => s.id === sessionId) ? sessionId : undefined;

    logger.info('sessionize profile imported', {
      handle,
      uid,
      sessions: profile.sessions.length,
      requestedSession: sessionId ?? null,
      matchedSession: preselect ?? null,
      warnings: profile.warnings,
    });

    return {
      ok: true,
      profile,
      preselectSessionId: preselect,
      requestedSessionMissing: Boolean(sessionId && !preselect),
    };
  },
);

// ----------------------------------------------------------------------- roles

/**
 * Called once after sign-in. Returns the caller's role, claiming a pending
 * `roleGrants` entry if one is waiting for their address.
 *
 * The email comes from the verified auth token, never from the request body —
 * otherwise anyone could claim any grant by naming it.
 */
export const claimRole = onCall(CALLABLE, async (request) => {
  const uid = requireUid(request, 'continue');
  const token = request.auth!.token;
  // `!== true` rather than `=== false`: a token with the claim absent must not
  // pass. Google always sets it, but a role is the wrong thing to hand out on
  // the assumption that the only provider we enabled today is the only one
  // there will ever be.
  if (token.email && token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }

  try {
    const role = await claim(db, {
      uid,
      email: token.email as string | undefined,
      name: token.name as string | undefined,
    });
    return { role };
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Admin only. Applies at once if the person already has an account. */
export const grantRole = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'assign roles');
  const data = (request.data ?? {}) as { email?: unknown; role?: unknown };

  try {
    const result = await grant(db, getAuth(), { email: data.email, role: data.role, byUid });
    logger.info('role granted', { ...result, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Admin only, and refuses to remove the last admin. */
export const revokeRole = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'remove roles');
  const data = (request.data ?? {}) as { email?: unknown };

  try {
    const result = await revoke(db, getAuth(), { email: data.email });
    logger.info('role revoked', { ...result, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/**
 * The selection decision. Admin only, and a function rather than a rule because
 * `status` is what every other permission keys off — an applicant who could
 * write it could accept themselves.
 *
 * Only the outcomes an admin actually decides. `draft`, `submitted` and
 * `withdrawn` belong to the applicant's own flow and are not settable here.
 */
const DECIDABLE = STATUS_SETS.decidable;

export const setProposalStatus = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'decide a proposal');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const proposalId = requireProposalId(data);
  const status = String(data.status ?? '');
  if (!(DECIDABLE as readonly string[]).includes(status)) {
    throw new HttpsError(
      'invalid-argument',
      `Status must be one of ${DECIDABLE.join(', ')} — got "${status}".`,
    );
  }

  const ref = db.doc(`proposals/${proposalId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'No such proposal.');

    const current = String(snap.data()?.status ?? '');
    // A withdrawn talk is the speaker's decision and outranks the committee's.
    if (current === 'draft' || current === 'withdrawn') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${current}" cannot be decided.`,
      );
    }

    // Decisions queue `held`, and an admin releases the whole batch at once
    // (§8) — otherwise the first people alphabetically learn their fate hours
    // before the rest, and rejections trickle out ahead of acceptances.
    if (DECISION_KINDS.includes(status as EmailKind)) {
      const context = await emailContext(tx, snap.data()!);
      if (context) {
        await queueEmail(db, tx, { kind: status as EmailKind, proposalId, ...context });
      }
    }

    tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
  });

  logger.info('proposal decided', { proposalId, status, byUid });
  return { ok: true, proposalId, status };
});

/**
 * The batch control for decision mail: see what is waiting, send it, or retry
 * what bounced.
 *
 * §8 asks for a dry run before the first real batch, so `preview` is the
 * default and nothing leaves without an explicit `release`. Every action is a
 * status flip on `emailLog`; the trigger does the sending.
 */
export const emailQueue = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'manage the email queue');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'preview');
  if (!['preview', 'release', 'retry', 'resend'].includes(action)) {
    throw new HttpsError('invalid-argument', `Unknown action "${action}".`);
  }

  /*
   * One message again, on purpose.
   *
   * The deterministic id is what stops a decision going out twice by accident,
   * so there was no way to send one on purpose either — an address that bounced
   * or a speaker who lost the mail had no route back. Re-queueing the existing
   * row rather than deleting it keeps `emailLog` a complete record of what was
   * sent: `attempts` goes up, the row does not reappear from nowhere.
   */
  if (action === 'resend') {
    const logId = String(data.logId ?? '');
    if (!logId) throw new HttpsError('invalid-argument', 'logId is required.');

    const ref = db.doc(`emailLog/${logId}`);
    const status = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'No such message.');

      // In-flight rows are the trigger's, not ours: re-queueing one mid-send is
      // how the same person gets it twice in the same minute.
      const current = snap.get('status') as EmailStatus;
      if (current === 'queued' || current === 'sending') {
        throw new HttpsError('failed-precondition', `That message is already ${current}.`);
      }
      tx.update(ref, { status: 'queued' satisfies EmailStatus });
      return current;
    });

    logger.info('email re-queued', { byUid, logId, was: status });
    return { ok: true, logId };
  }

  const [snap, configSnap] = await Promise.all([
    db.collection('emailLog').get(),
    db.doc('config/email').get(),
  ]);
  const emailConfig = configSnap.data() ?? {};

  const tally: Record<string, number> = {};
  for (const doc of snap.docs) {
    const key = `${doc.get('status')}:${doc.get('kind')}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }

  const at = (doc: (typeof snap.docs)[number], field: string): number =>
    (doc.get(field) as Timestamp | undefined)?.toMillis() ?? 0;

  const rows = snap.docs
    .map((d) => ({
      logId: d.id,
      kind: d.get('kind') as string,
      to: d.get('to') as string,
      status: d.get('status') as string,
      attempts: (d.get('attempts') as number) ?? 0,
      title: (d.get('data')?.title as string) ?? '',
      // Only a message has one. Two of them to the same speaker are otherwise
      // indistinguishable in the log.
      subject: (d.get('subject') as string) ?? '',
      // Milliseconds rather than a Timestamp: the client formats it, and a
      // Timestamp does not survive the callable's JSON.
      sentAt: at(d, 'sentAt') || null,
      // The provider's reason, not ours — shown as-is to an admin, who is the
      // one person who can act on "domain is not verified".
      error: (d.get('error') as string) ?? '',
    }))
    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0) || a.to.localeCompare(b.to));

  if (action === 'preview') {
    return {
      ok: true,
      tally,
      settings: await loadSettings(db),
      // Setup state for the panel. `keyHint` is the last four characters of the
      // API key — never the key.
      keyHint: (emailConfig.keyHint as string) ?? '',
      domainId: (emailConfig.domainId as string) ?? '',
      // The name, not just the id: the panel compares it against the sender to
      // catch an address on a domain that was never verified.
      domain: (emailConfig.domain as string) ?? '',
      templates: emailConfig.templates ?? {},
      // Enough to check the copy and the addresses before committing to a send.
      held: snap.docs
        .filter((d) => d.get('status') === 'held')
        .map((d) => ({ kind: d.get('kind'), to: d.get('to'), title: d.get('data')?.title })),
      /*
       * Who was written to, and what happened. The panel used to show counts by
       * status and nothing else, so "did this person get their acceptance" had
       * no answer short of the Firestore console.
       *
       * Newest first and capped, with `truncated` so a cap never reads as "that
       * is all of them". A CFP will not reach this; a platform running several
       * would.
       */
      rows: rows.slice(0, ROW_CAP),
      truncated: Math.max(0, rows.length - ROW_CAP),
    };
  }

  // `dry_run` counts as unsent, because it is: the row records a message that
  // was rendered while no sender was configured. Retrying picks those up once
  // the domain is, so a receipt written during setup still reaches its speaker.
  const from: EmailStatus[] = action === 'release' ? ['held'] : ['failed', 'dry_run'];
  const due = snap.docs.filter((d) => from.includes(d.get('status')));

  const CHUNK = 400;
  for (let i = 0; i < due.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of due.slice(i, i + CHUNK)) {
      batch.update(doc.ref, { status: 'queued' satisfies EmailStatus });
    }
    await batch.commit();
  }

  logger.info('email queue advanced', { byUid, action, count: due.length });
  return { ok: true, tally, released: due.length };
});

/*
 * Signing in without a Google account.
 *
 * A one-time link rather than a password: people touch this site a handful of
 * times a year, so a password would mostly be a reset flow — and it would mean
 * holding hashes for everyone who applies, which is a liability the event has
 * no reason to take on.
 */

/** Deliberately loose. Delivery is the real check, and this only rejects noise. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

const LINK_WINDOW_MS = 60 * 60 * 1000;
const LINKS_PER_WINDOW = 5;

/**
 * Throttles by address, so this callable cannot be turned into a way to mail
 * someone repeatedly from our verified domain — which would cost us the domain
 * reputation the whole pipeline depends on.
 *
 * Hashed, so the collection is not a readable list of everyone who has ever
 * tried to sign in.
 */
async function takeLinkAllowance(email: string): Promise<void> {
  const ref = db.doc(`signInLinks/${createHash('sha256').update(email).digest('hex')}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const startedAt = (snap.get('windowStart') as number) ?? 0;
    const fresh = now - startedAt > LINK_WINDOW_MS;
    const used = fresh ? 0 : ((snap.get('count') as number) ?? 0);

    if (used >= LINKS_PER_WINDOW) {
      throw new HttpsError('resource-exhausted', 'Too many sign-in links. Try again later.');
    }
    tx.set(ref, {
      windowStart: fresh ? now : startedAt,
      count: used + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Mails a sign-in link. Public: asking for one is how you get an account.
 *
 * The answer is the same whether or not the address has ever been seen. A
 * different reply for a known address turns this into a way to test whether
 * someone submitted to the CFP, which is not ours to disclose.
 *
 * The link never touches `emailLog`. Anyone holding it is signed in as its
 * owner, so it is rendered and handed to Resend in this one request and not
 * written anywhere — no queue row, no retry, nothing to read back later.
 */
export const requestSignInLink = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as { email?: unknown; locale?: unknown };
  const email = String(data.email ?? '').trim().toLowerCase();
  const locale: EmailLocale = data.locale === 'fr' ? 'fr' : 'en';

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  }

  await takeLinkAllowance(email);

  const [apiKey, settings] = await Promise.all([readResendKey(), loadSettings(db)]);
  const link = await getAuth().generateSignInWithEmailLink(email, {
    // Must be one of Auth's authorized domains, or Firebase refuses to mint it.
    url: `${publicUrl(settings)}/`,
    handleCodeInApp: true,
  });

  const outcome = await sendViaResend(email, renderSignInEmail(link, locale), apiKey, settings);
  // The address is not logged: this line would otherwise be a record of who
  // tried to sign in, sitting in Cloud Logging with a much wider audience than
  // Firestore has.
  logger.info('sign-in link sent', { status: outcome.status, error: outcome.error });

  if (outcome.status === 'failed') {
    throw new HttpsError('unavailable', 'Could not send the link. Please try again.');
  }
  return { ok: true };
});

/**
 * A message an organiser writes themselves, to one speaker.
 *
 * Everything else in `emailLog` is a template fired by a status change, so
 * asking a speaker a question — a clash in the schedule, a missing detail, a
 * correction — meant mailing from a personal account. That reaches the speaker
 * from an address they have no reason to trust, and leaves no record here at
 * all, so nobody else on the committee knows it happened.
 *
 * The id is Firestore's rather than derived from the content, because repeats
 * are the entire point. That gives up the dedupe every other kind gets: the
 * compose form is what stops a double-send, and this log is the receipt.
 */
export const sendSpeakerMessage = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'write to a speaker');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const proposalId = requireProposalId(data);
  const subject = String(data.subject ?? '').trim();
  const body = String(data.body ?? '').trim();

  if (subject.length > LIMITS.messageSubjectMax) {
    throw new HttpsError('invalid-argument', 'That subject is too long.');
  }
  if (body.length > LIMITS.messageBodyMax) {
    throw new HttpsError('invalid-argument', 'That message is too long.');
  }

  // The same check the template editor runs, for the same reason: a mistyped
  // `{speaker}` would print as itself in front of the person it names.
  const problem = validateTemplate({ subject, body });
  if (problem) {
    throw new HttpsError(
      'invalid-argument',
      problem.problem === 'unknownPlaceholder'
        ? `There is no {${problem.detail}} placeholder.`
        : 'A subject and a message are both required.',
    );
  }

  const logId = await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.doc(`proposals/${proposalId}`));
    if (!snap.exists) throw new HttpsError('not-found', 'No such proposal.');

    // A draft is nobody's but its author's, and writing to someone about a talk
    // they have not submitted tells them it was read.
    if (snap.get('status') === 'draft') {
      throw new HttpsError('failed-precondition', 'That proposal has not been submitted.');
    }

    const context = await emailContext(tx, snap.data()!);
    if (!context) throw new HttpsError('failed-precondition', 'No address on file for that speaker.');

    const ref = db.collection('emailLog').doc();
    tx.create(ref, {
      kind: MESSAGE_KIND,
      proposalId,
      subject,
      body,
      ...context,
      // Queued, not held: a message is one deliberate act, not part of a batch
      // that has to leave together.
      status: 'queued' satisfies EmailStatus,
      attempts: 0,
      byUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
  });

  logger.info('message queued', { byUid, proposalId, logId });
  return { ok: true, logId };
});

/**
 * Who the CFP writes as. Admin only, and stored rather than deployed so a
 * domain that finishes verifying on a Tuesday can be switched on that Tuesday.
 *
 * Nothing here is checked against Resend — an address on an unverified domain
 * saves fine and then fails at send time, which the queue records as `failed`
 * and the retry button recovers once the DNS is right.
 */
export const setEmailSettings = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'change the sending address');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const settings: EmailSettings = {
    from: String(data.from ?? '').trim(),
    replyTo: String(data.replyTo ?? '').trim(),
    // Trailing slash trimmed here rather than at render: it is one place, and
    // "https://x.org/" + a path is the kind of double slash nobody notices
    // until it is in mail that has already gone out.
    publicUrl: String(data.publicUrl ?? '').trim().replace(/\/+$/, ''),
  };

  const problem = validateSettings(settings);
  if (problem) {
    throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);
  }

  await db.doc('config/email').set(settings, { merge: true });
  logger.info('email settings changed', { byUid, ...settings });
  return { ok: true, settings };
});

/**
 * Replaces the wording of one message, or restores ours. Admin only.
 *
 * Validated server-side as well as in the browser: a blank body or a mistyped
 * placeholder reaches an applicant as a broken email, and the applicant is the
 * one person who cannot tell it was a mistake.
 */
export const setEmailTemplate = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'change the email wording');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const kind = String(data.kind ?? '') as EmailKind;
  if (!EMAIL_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', `Unknown message "${kind}".`);
  }
  const locale = String(data.locale ?? '') as EmailLocale;
  if (!EMAIL_LOCALES.includes(locale)) {
    throw new HttpsError('invalid-argument', `Unknown language "${locale}".`);
  }

  const path = `templates.${kind}.${locale}`;

  if (data.reset === true) {
    await db.doc('config/email').update({ [path]: FieldValue.delete() }).catch(() => {
      // Nothing stored for it yet, which is the state `reset` was asking for.
    });
    logger.info('email template reset', { byUid, kind, locale });
    return { ok: true, reset: true };
  }

  const template: Template = {
    subject: String(data.subject ?? ''),
    body: String(data.body ?? ''),
  };

  const problem = validateTemplate(template);
  if (problem) {
    throw new HttpsError('invalid-argument', `${problem.problem}: ${problem.detail ?? ''}`);
  }

  await db.doc('config/email').set({ templates: { [kind]: { [locale]: template } } }, { merge: true });
  logger.info('email template changed', { byUid, kind, locale });
  return { ok: true };
});

/**
 * Sends one rendered message to the caller's own address. Admin only.
 *
 * Deliberately not through `emailLog`: that collection is the record of what
 * applicants were told, and a test message is not that. It also means a test
 * cannot consume the deterministic id a real message will need later.
 */
export const sendTestEmail = onCall(CALLABLE, async (request) => {
  const uid = await requireAdmin(request, 'send a test');
  const to = request.auth?.token.email as string | undefined;
  if (!to) throw new HttpsError('failed-precondition', 'Your account has no email address.');

  const data = (request.data ?? {}) as Record<string, unknown>;
  const kind = String(data.kind ?? 'submission_received') as EmailKind;
  if (!EMAIL_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', `Unknown message "${kind}".`);
  }
  const locale = (data.locale === 'fr' ? 'fr' : 'en') as EmailLocale;

  const [apiKey, settings, templates] = await Promise.all([
    readResendKey(),
    loadSettings(db),
    loadTemplates(db),
  ]);
  const outcome = await deliver(
    {
      kind,
      locale,
      to,
      data: {
        speakerName: (request.auth?.token.name as string) || to,
        title: 'A test of the sending setup',
        needsVisa: data.needsVisa === true,
      },
    },
    apiKey,
    settings,
    templates,
  );

  logger.info('test email', { uid, kind, status: outcome.status });
  if (outcome.status === 'failed') {
    throw new HttpsError('unavailable', outcome.error ?? 'Resend refused it.');
  }
  return { ok: true, status: outcome.status, to };
});

/**
 * Sets the Resend API key. Admin only.
 *
 * The key goes to Secret Manager and is never written to Firestore, never
 * logged, and never returned — `#/admin` shows only the last four characters,
 * which is enough to tell one key from another and nothing else. Verified
 * against Resend before it is stored, so a typo fails here rather than silently
 * failing on the night the decisions go out.
 */
export const setEmailSecret = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'set the API key');
  const apiKey = String((request.data as { apiKey?: unknown } | undefined)?.apiKey ?? '').trim();

  if (!apiKey) throw new HttpsError('invalid-argument', 'An API key is required.');
  if (!apiKey.startsWith('re_')) {
    throw new HttpsError('invalid-argument', 'A Resend API key starts with "re_".');
  }

  try {
    await listDomains(apiKey);
  } catch (error) {
    throw asResendError(error);
  }

  await writeResendKey(apiKey);
  await db.doc('config/email').set(
    { keyHint: keyHint(apiKey), keySetAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.info('resend key set', { byUid, hint: keyHint(apiKey) });
  return { ok: true, keyHint: keyHint(apiKey) };
});

/** Resend's own failures, mapped so nothing leaks its raw text to a client. */
function asResendError(error: unknown): HttpsError {
  if (error instanceof ResendError) return new HttpsError(error.code, error.message);
  logger.error('unexpected resend failure', { error: String(error) });
  return new HttpsError('internal', 'Could not reach Resend.');
}

/**
 * The sending domain: add it, read back the DNS records Resend wants, and ask
 * it to re-check. Admin only, because it spends the API key.
 */
export const emailDomain = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'manage the sending domain');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'list');

  const apiKey = await readResendKey();

  try {
    if (action === 'list') return { ok: true, domains: await listDomains(apiKey) };

    if (action === 'add') {
      const name = cleanDomain(String(data.domain ?? ''));
      if (!name) throw new HttpsError('invalid-argument', 'That is not a domain name.');
      const domain = await addDomain(apiKey, name);
      await db.doc('config/email').set({ domainId: domain.id, domain: name }, { merge: true });
      return { ok: true, domain };
    }

    const id = String(data.domainId ?? '');
    if (!id) throw new HttpsError('invalid-argument', 'domainId is required.');

    if (action === 'get') return { ok: true, domain: await getDomain(apiKey, id) };
    if (action === 'verify') {
      const domain = await verifyDomain(apiKey, id);
      logger.info('domain verification requested', { byUid, id, status: domain.status });
      return { ok: true, domain };
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw asResendError(error);
  }

  throw new HttpsError('invalid-argument', `Unknown action "${action}".`);
});

/**
 * Admin only. The window is what the rules themselves read to decide whether
 * the CFP is open, so it stays out of reach of any client write.
 */
export const setCfpWindow = onCall(CALLABLE, async (request) => {
  const byUid = await requireAdmin(request, 'change the submission window');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const key of ['opensAt', 'closesAt'] as const) {
    if (data[key] === undefined) continue;
    const at = new Date(String(data[key]));
    if (Number.isNaN(at.valueOf())) {
      throw new HttpsError('invalid-argument', `${key} is not a date.`);
    }
    patch[key] = Timestamp.fromDate(at);
  }
  for (const key of ['paused', 'reviewsVisible'] as const) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'boolean') {
      throw new HttpsError('invalid-argument', `${key} must be true or false.`);
    }
    patch[key] = data[key];
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }

  const current = (await db.doc('config/cfp').get()).data() ?? {};
  const opensAt = (patch.opensAt ?? current.opensAt) as Timestamp | undefined;
  const closesAt = (patch.closesAt ?? current.closesAt) as Timestamp | undefined;
  if (opensAt && closesAt && closesAt.toMillis() <= opensAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'The window would close before it opens.');
  }

  await db.doc('config/cfp').set(patch, { merge: true });
  logger.info('cfp window changed', { byUid, ...patch });
  return { ok: true };
});
