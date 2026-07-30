/**
 * §6 makes `status` and `aggregate` function-writable only, so the
 * draft → submitted transition cannot happen in the browser. That gives one
 * server-side chokepoint which re-runs validation and re-checks the deadline
 * against the server clock — neither can be bypassed by posting to Firestore.
 */

import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import { inStatusSet, LIMITS, STATUS_SETS } from '../../shared/enums';
import { submissionSchema } from '../../shared/schema';
import {
  DEFAULT_SUBMISSION_FORM,
  mergeSubmissionForm,
  normaliseSubmissionForm,
  validateSubmissionForm,
  type SubmissionForm,
} from '../../shared/submissionForm';
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
import { senderMismatch, validateSettings, type EmailSettings } from '../../shared/emailSettings';
import {
  EMPTY_FORM,
  IMAGE_TYPES,
  headshotPath,
  normaliseForm,
  validateAnswers,
  validateForm,
  type Answers,
  type ConfirmForm,
} from '../../shared/confirmForm';
import {
  CFP_LIMITS,
  validateCfp,
  validateCfpId,
  validateProfile,
  type CfpProfile,
  type CfpRole,
} from '../../shared/cfp';
import type { SpeakerSnapshot } from '../../shared/types';
import { claim, grant, revoke, RoleError } from './roles';
import {
  cfpUrl,
  deliver,
  loadPlatform,
  loadSettings,
  loadTemplates,
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
  archived: boolean;
  opensAt: Timestamp;
  closesAt: Timestamp;
}

/**
 * Which CFP this call is about.
 *
 * Every callable below takes one. It is never inferred from the caller's
 * memberships — somebody on two CFPs would get whichever the server guessed —
 * and the role check that follows is always made against this id, so naming a
 * CFP you have no role on buys nothing.
 */
function requireCfpId(data: unknown): string {
  const id = (data as { cfpId?: unknown } | undefined)?.cfpId;
  if (typeof id !== 'string' || validateCfpId(id) !== null) {
    throw new HttpsError('invalid-argument', 'cfpId is required.');
  }
  return id;
}

/** Fails closed: a missing CFP must not read as "wide open". */
async function assertCfpOpen(cfpId: string): Promise<void> {
  const snap = await db.doc(`cfps/${cfpId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such call for proposals.');
  }
  const cfp = snap.data() as CfpWindow;
  const now = Date.now();
  // Archiving is how a round is stopped without editing its window, so it is
  // checked before the dates rather than after them.
  if (cfp.archived) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
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

/**
 * Speaker lifecycle writes stay frozen once a round is archived.
 *
 * Read inside the same transaction as the proposal so an archive racing a
 * response or withdrawal retries against the new state instead of slipping one
 * last write through. These actions remain allowed after the submission window
 * closes; archiving, not the calendar, is the historical boundary.
 */
async function assertCfpNotArchived(
  tx: FirebaseFirestore.Transaction,
  cfpId: string,
): Promise<void> {
  const snap = await tx.get(db.doc(`cfps/${cfpId}`));
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such call for proposals.');
  }
  if (snap.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
}

function requireUid(request: { auth?: { uid: string } }, action: string): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', `Sign in to ${action}.`);
  return uid;
}

/** The caller's role on one CFP, or undefined if they hold none. */
async function roleOn(cfpId: string, uid: string): Promise<CfpRole | undefined> {
  const snap = await db.doc(`cfps/${cfpId}/members/${uid}`).get();
  return snap.exists ? (snap.data()?.role as CfpRole) : undefined;
}

/** `owner` outranks `admin` wherever admin is enough. */
async function requireAdmin(
  request: { auth?: { uid: string } },
  cfpId: string,
  action: string,
): Promise<string> {
  const uid = requireUid(request, action);
  const role = await roleOn(cfpId, uid);
  if (role !== 'admin' && role !== 'owner') {
    throw new HttpsError('permission-denied', `Only an admin can ${action}.`);
  }
  return uid;
}

/** Archiving, deleting and changing who owns a CFP are the owner's alone. */
async function requireOwner(
  request: { auth?: { uid: string } },
  cfpId: string,
  action: string,
): Promise<string> {
  const uid = requireUid(request, action);
  if ((await roleOn(cfpId, uid)) !== 'owner') {
    throw new HttpsError('permission-denied', `Only an owner can ${action}.`);
  }
  return uid;
}

/** RoleError carries the code the caller should see; anything else is ours. */
function asHttpsError(error: unknown): HttpsError {
  if (error instanceof RoleError) return new HttpsError(error.code, error.message);
  logger.error('unexpected role failure', { error: String(error) });
  return new HttpsError('internal', 'Could not complete that change.');
}

/** An ISO date from the request body, or a legible refusal. */
function toTimestamp(value: unknown, field: string): Timestamp {
  const at = new Date(String(value ?? ''));
  if (Number.isNaN(at.valueOf())) {
    throw new HttpsError('invalid-argument', `${field} is not a date.`);
  }
  return Timestamp.fromDate(at);
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
 * The form this call actually asks, from `config/submissionForm`.
 *
 * Absent for every call that predates the form being configurable, and the
 * defaults are what those calls were already using — so a missing document is a
 * working document rather than a reason to refuse a submission.
 */
async function submissionFormFor(cfpId: string): Promise<SubmissionForm> {
  const snap = await db.doc(`cfps/${cfpId}/config/submissionForm`).get();
  return mergeSubmissionForm(snap.exists ? snap.data() : undefined);
}

/**
 * The speaker as the committee will read them.
 *
 * `email` is deliberately absent. A reviewer judging a talk has no need of the
 * address, and this copy is readable by every reviewer on the CFP — the profile
 * it is taken from is not.
 */
function snapshotOf(uid: string, speaker: FirebaseFirestore.DocumentData): SpeakerSnapshot {
  return {
    uid,
    name: (speaker.name as string) ?? '',
    bio: (speaker.bio as string) ?? '',
    ...(speaker.company ? { company: speaker.company as string } : {}),
    ...(speaker.jobTitle ? { jobTitle: speaker.jobTitle as string } : {}),
    basedIn: (speaker.basedIn as string) ?? '',
    socials: (speaker.socials as SpeakerSnapshot['socials']) ?? [],
    isGde: speaker.isGde === true,
    ...(speaker.pastTalks ? { pastTalks: speaker.pastTalks as string } : {}),
    ...(speaker.sessionizeUrl ? { sessionizeUrl: speaker.sessionizeUrl as string } : {}),
  };
}

/** Statuses where the committee has not answered yet, so the copy may still move. */
const STILL_BEING_JUDGED: readonly string[] = ['submitted', 'under_review'];

/**
 * Which proposal statuses a held decision email is still true of.
 *
 * `accepted` covers the speaker's own answer as well: confirming or declining
 * happens *after* the acceptance, so a row queued before they replied is still
 * the message they were owed. Anything else means the decision moved.
 */
const DECISION_STILL_TRUE: Record<string, readonly string[]> = {
  accepted: ['accepted', 'confirmed', 'declined'],
  waitlisted: ['waitlisted'],
  rejected: ['rejected'],
};

/**
 * Splits unsent decision rows by whether the proposal still has that decision.
 *
 * Preview and release must use the same answer: showing a message as sendable
 * when release or retry will retain it is worse than no preview at all.
 */
async function currentDecisionEmails(
  cfpId: string,
  docs: QueryDocumentSnapshot[],
): Promise<{ sendable: QueryDocumentSnapshot[]; stale: QueryDocumentSnapshot[] }> {
  if (docs.length === 0) return { sendable: [], stale: [] };

  const proposalIds = [
    ...new Set(docs.map((doc) => doc.get('proposalId') as string).filter(Boolean)),
  ];
  const proposals = await db.getAll(
    ...proposalIds.map((proposalId) => db.doc(`cfps/${cfpId}/proposals/${proposalId}`)),
  );
  const current = new Map(proposals.map((proposal) => [proposal.id, proposal.get('status') as string]));
  const sendable = docs.filter((doc) => {
    const holds = DECISION_STILL_TRUE[doc.get('kind') as string];
    // A kind with no entry is not a decision at all, so nothing to check.
    return !holds || holds.includes(current.get(doc.get('proposalId') as string) ?? '');
  });
  const sendableIds = new Set(sendable.map((doc) => doc.id));
  return { sendable, stale: docs.filter((doc) => !sendableIds.has(doc.id)) };
}

/**
 * Keeps the committee's copy of a speaker current until their talk is decided.
 *
 * `speakerSnapshot` is frozen so a bio rewritten in 2028 cannot change what the
 * 2026 committee actually read. Freezing it at *submission* went too far: a
 * speaker who fills in their employer, job title or past talks an hour after
 * submitting is not rewriting history, and the committee simply never saw it.
 * That is not hypothetical — it is what happened on the first real submission
 * this ran for. So the freeze starts at the decision instead.
 *
 * Rules cannot express this: the speaker may not write their own snapshot, or
 * they could tell the committee whatever they liked about themselves.
 */
export const refreshSpeakerSnapshots = onDocumentWritten(
  {
    document: 'speakers/{uid}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const uid = event.params.uid;
    const next = snapshotOf(uid, after.data()!);

    // Most profile writes are a locale, an email or an `updatedAt`, none of
    // which the committee reads. Comparing first keeps those from each costing
    // a collection-group query across every CFP on the platform.
    const before = event.data?.before;
    if (before?.exists && JSON.stringify(snapshotOf(uid, before.data()!)) === JSON.stringify(next)) {
      return;
    }

    const mine = await db
      .collectionGroup('proposals')
      .where('speakerIds', 'array-contains', uid)
      .get();

    // Filtered here rather than in the query: a speaker has at most a handful
    // of proposals, and a second `where` would need its own composite index at
    // collection-group scope for the sake of skipping two documents.
    const open = mine.docs.filter((doc) =>
      STILL_BEING_JUDGED.includes(doc.get('status') as string),
    );
    if (open.length === 0) return;

    const batch = db.batch();
    for (const doc of open) {
      // Replace this speaker's entry and leave any co-presenter's alone.
      const current = (doc.get('speakerSnapshot') as SpeakerSnapshot[] | undefined) ?? [];
      batch.update(doc.ref, {
        speakerSnapshot: current.map((person) => (person.uid === uid ? next : person)),
      });
    }
    await batch.commit();

    logger.info('speaker snapshot refreshed', { uid, proposals: open.length });
  },
);

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
  const cfpId = requireCfpId(request.data);
  const uid = requireUid(request, 'submit a proposal');
  const proposalId = requireProposalId(request.data);

  await assertCfpOpen(cfpId);

  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  // Outside the transaction: config, not state — nothing in here depends on it
  // being read at the same instant as the proposal, and a transaction that
  // reads it would retry on every unrelated edit to the form.
  const shape = await submissionFormFor(cfpId);

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
      db.collection(`cfps/${cfpId}/proposals`).where('speakerIds', 'array-contains', uid),
    );
    const live = mine.docs.filter((d) => inStatusSet('live', d.data().status)).length;
    if (live >= LIMITS.maxTalksPerSpeaker) {
      throw new HttpsError(
        'resource-exhausted',
        `You have already submitted ${LIMITS.maxTalksPerSpeaker} talks.`,
      );
    }

    // The authoritative pass; the browser's copy only renders inline errors.
    // Against this call's own form, not against a taxonomy compiled into the
    // bundle — that is the whole point of the config being data.
    const parsed = submissionSchema(shape).safeParse(assemble(proposal, speakerSnap.data()!));
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'The proposal is incomplete.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    // The call's own questions. Same machinery as the confirmation form, and
    // the same rule: unknown keys are dropped rather than refused, because a
    // form edited while somebody was filling it in is not their mistake.
    const { faults, clean } = validateAnswers(
      { fields: shape.fields },
      (proposal.answers ?? {}) as Answers,
    );
    if (Object.keys(faults).length > 0) {
      throw new HttpsError('invalid-argument', 'The proposal is incomplete.', { faults });
    }

    // Queued in the same transaction as the status change: no receipt for a
    // submission that rolled back, and no submission without a receipt. Must
    // precede the write below — Firestore allows no reads after a write.
    const context = await emailContext(tx, proposal);
    if (context) {
      await queueEmail(db, tx, cfpId, { kind: 'submission_received', proposalId, ...context });
    }

    tx.update(proposalRef, {
      status: 'submitted',
      // What the committee will read, frozen now. The profile belongs to the
      // account and is global; this is the only copy of it this CFP gets, so a
      // bio rewritten years later cannot rewrite what was judged.
      speakerSnapshot: [snapshotOf(uid, speakerSnap.data()!)],
      // Only what the form still asks for, which is what `clean` is.
      answers: clean,
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
  const cfpId = requireCfpId(request.data);
  const uid = requireUid(request, 'withdraw a proposal');
  const proposalId = requireProposalId(request.data);

  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    const proposal = await readOwnProposal(tx, proposalRef, uid);
    if (!inStatusSet('withdrawable', proposal.status)) {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" cannot be withdrawn.`,
      );
    }
    const context = await emailContext(tx, proposal);
    if (context) {
      await queueEmail(db, tx, cfpId, { kind: 'withdrawn', proposalId, ...context });
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
/**
 * Which image questions this speaker has actually uploaded a file for.
 *
 * Asked of the bucket rather than of the browser. The path is derived from the
 * caller's own uid, so there is nothing here a speaker could point at somebody
 * else's object — the answer is a fact we look up, not a claim we accept.
 */
async function findUploads(
  cfpId: string,
  form: ConfirmForm,
  uid: string,
): Promise<Record<string, string>> {
  const images = (form.fields ?? []).filter((field) => field.type === 'image');
  if (images.length === 0) return {};

  const bucket = getStorage().bucket();
  const found: Record<string, string> = {};
  await Promise.all(
    images.map(async (field) => {
      const path = headshotPath(cfpId, uid, field.key);
      const [exists] = await bucket.file(path).exists();
      if (exists) found[field.key] = path;
    }),
  );
  return found;
}

/** The organiser's questions, or none. Missing means nothing extra is asked. */
async function loadConfirmForm(cfpId: string): Promise<ConfirmForm> {
  const snap = await db.doc(`cfps/${cfpId}/config/confirmForm`).get();
  const fields = snap.data()?.fields;
  return Array.isArray(fields) ? ({ fields } as ConfirmForm) : EMPTY_FORM;
}

export const respondToDecision = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
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
    const form = await loadConfirmForm(cfpId);
    const uploads = await findUploads(cfpId, form, uid);
    const checked = validateAnswers(form, (data.answers ?? {}) as Answers, uploads);
    if (Object.keys(checked.faults).length > 0) {
      throw new HttpsError('invalid-argument', 'Some answers need fixing.', checked.faults);
    }
    answers = checked.clean;
  }

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
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
 * One speaker's headshot, for an organiser.
 *
 * The bucket stays shut to everyone but the owner: Cloud Storage rules cannot
 * read Firestore, so "and the committee" is not expressible there, and any rule
 * loose enough to admit a reviewer would admit everybody. Putting a callable in
 * the path moves the role check somewhere it can actually be made.
 *
 * The bytes come back inline rather than as a signed URL. A signed URL would be
 * cheaper, but `getSignedUrl` has to sign with a private key: the emulator has
 * none, and a deployed function only manages it by calling IAM `signBlob`, which
 * needs a role the runtime service account is not granted by default. So the
 * link would work here and fail on the one machine that matters. Inline also
 * means no bearer URL for the photo ever exists to be forwarded or logged.
 * Answers are capped at `FORM_LIMITS.image`, which bounds the response.
 */
export const headshotImage = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  await requireAdmin(request, cfpId, 'view a headshot');
  const data = (request.data ?? {}) as { speakerUid?: unknown; key?: unknown };
  const speakerUid = String(data.speakerUid ?? '');
  const key = String(data.key ?? '');
  if (!speakerUid || !key) {
    throw new HttpsError('invalid-argument', 'speakerUid and key are required.');
  }

  const file = getStorage().bucket().file(headshotPath(cfpId, speakerUid, key));
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'No headshot for that speaker.');

  // Read from the object rather than trusting the upload rule, because this
  // string goes into a `data:` URL an organiser's browser will act on. Anything
  // that is not one of the three image types we accept is refused outright.
  const [meta] = await file.getMetadata();
  const contentType = String(meta.contentType ?? '');
  if (!(IMAGE_TYPES as readonly string[]).includes(contentType)) {
    throw new HttpsError('failed-precondition', 'That file is not an image.');
  }

  const [bytes] = await file.download();
  return { ok: true, dataUrl: `data:${contentType};base64,${bytes.toString('base64')}` };
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change the confirmation form');
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

  await db.doc(`cfps/${cfpId}/config/confirmForm`).set(form);
  logger.info('confirm form saved', { byUid, fields: form.fields.length });
  return { ok: true, fields: form.fields };
});

/**
 * The submission form itself: what this call asks a speaker for.
 *
 * Whole-document replace, like `setConfirmForm` and for the same reason — the
 * merge happens in the browser where an admin can see what they are doing.
 * Validated twice over: the taxonomy and the consents by `validateSubmissionForm`,
 * the custom questions by the confirmation form's own `validateForm`, because
 * they are the same shape and deserve the same rules.
 */
export const setSubmissionForm = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change the submission form');

  const form = normaliseSubmissionForm(
    mergeSubmissionForm((request.data ?? {}) as Record<string, unknown>),
  );

  const shapeFault = validateSubmissionForm(form);
  if (shapeFault) {
    throw new HttpsError(
      'invalid-argument',
      shapeFault.key ? `${shapeFault.problem} on "${shapeFault.key}"` : shapeFault.problem,
      shapeFault,
    );
  }
  for (const fields of [form.acks, form.fields]) {
    const fault = validateForm({ fields });
    if (fault) {
      throw new HttpsError(
        'invalid-argument',
        fault.key ? `${fault.problem} on "${fault.key}"` : fault.problem,
        fault,
      );
    }
  }

  await db.doc(`cfps/${cfpId}/config/submissionForm`).set(form);
  logger.info('submission form saved', {
    byUid,
    cfpId,
    acks: form.acks.length,
    fields: form.fields.length,
  });
  return { ok: true, form };
});

/**
 * Recomputes `aggregate` on every reviewed proposal. Run once when the round
 * closes (§8) — a batch job, not a trigger: a z-score is relative to everything
 * that reviewer scored, so one new review moves the normalised score of every
 * proposal they touched. Per-review triggers would fan out across the whole
 * collection and race each other.
 */
export const recomputeAggregates = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = await requireAdmin(request, cfpId, 'close the review round');

  /*
   * Every review on every proposal in *this* CFP, in one read pass.
   *
   * Filtered on the denormalised `cfpId` rather than on the path, because a
   * collection-group query cannot be constrained by ancestor — without the
   * filter this would sweep up every review on the platform and write one
   * organiser's scores onto another's proposals. The rules pin
   * `request.resource.data.cfpId` to the path on write, so the field cannot lie.
   */
  const reviewSnaps = await db.collectionGroup('reviews').where('cfpId', '==', cfpId).get();

  const reviews: ReviewRecord[] = reviewSnaps.docs.map((d) => ({
    // reviews live at cfps/{cfpId}/proposals/{proposalId}/reviews/{reviewerUid}
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
      batch.update(db.doc(`cfps/${cfpId}/proposals/${proposalId}`), {
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


// ------------------------------------------------------------------- the CFP

/**
 * A new call for proposals, owned by whoever asked for it.
 *
 * The id is the slug, so `create` is also the uniqueness check: two people
 * racing for the same name means one `create` fails, and there is no window in
 * which both believe they hold it. That is why this is a transaction with an
 * existence check rather than a `set`.
 *
 * The creator is written as owner in the same transaction. That is what
 * replaced the bootstrap script — there is no moment when a CFP exists with
 * nobody able to administer it.
 */
export const createCfp = onCall(CALLABLE, async (request) => {
  const uid = requireUid(request, 'create a call for proposals');
  const token = request.auth!.token;
  if (token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }

  const data = (request.data ?? {}) as Record<string, unknown>;
  const input = {
    id: String(data.cfpId ?? ''),
    name: String(data.name ?? '').trim(),
    visibility: String(data.visibility ?? 'private'),
  };
  const fault = validateCfp(input);
  if (fault) throw new HttpsError('invalid-argument', fault);

  const opensAt = toTimestamp(data.opensAt, 'opensAt');
  const closesAt = toTimestamp(data.closesAt, 'closesAt');
  if (closesAt.toMillis() <= opensAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'The window closes before it opens.');
  }

  // A platform anyone can create on needs a ceiling somewhere, and the cheapest
  // honest one is per account.
  const mine = await db
    .collection('cfps')
    .where('ownerUids', 'array-contains', uid)
    .count()
    .get();
  if (mine.data().count >= CFP_LIMITS.perOwner) {
    throw new HttpsError('resource-exhausted', 'You have reached the limit on calls for proposals.');
  }

  const ref = db.doc(`cfps/${input.id}`);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) {
      throw new HttpsError('already-exists', 'That address is taken.');
    }
    tx.set(ref, {
      name: input.name,
      visibility: input.visibility,
      ownerUids: [uid],
      archived: false,
      opensAt,
      closesAt,
      paused: false,
      reviewsVisible: false,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Seeded rather than left absent, even though `mergeSubmissionForm` would
    // supply the same values. An absent document means "whatever the code
    // defaults to today", and the day those defaults change, every call that
    // never wrote one silently changes the taxonomy under proposals already
    // submitted against it. Written once, it is this call's own.
    tx.set(db.doc(`cfps/${input.id}/config/submissionForm`), DEFAULT_SUBMISSION_FORM);
    tx.set(db.doc(`cfps/${input.id}/members/${uid}`), {
      cfpId: input.id,
      uid,
      role: 'owner',
      email: (token.email as string) ?? '',
      ...(token.name ? { name: token.name as string } : {}),
      createdAt: FieldValue.serverTimestamp(),
      grantedBy: uid,
    });
  });

  logger.info('cfp created', { cfpId: input.id, uid });
  return { ok: true, cfpId: input.id };
});

/** Trims what arrived and keeps only the shape `validateProfile` knows about. */
function readProfile(data: Record<string, unknown>): CfpProfile {
  const text = (value: unknown) => String(value ?? '').trim();
  const description = (data.description ?? {}) as Record<string, unknown>;
  return {
    description: { en: text(description.en), fr: text(description.fr) },
    eventDate: text(data.eventDate),
    venue: text(data.venue),
    location: text(data.location),
    website: text(data.website),
  };
}

/**
 * The same profile as something to write, with the empty fields deleted rather
 * than stored blank.
 *
 * Absent has to mean absent: the landing page decides whether to render a venue
 * line by whether there is a venue, and an empty string is not the same answer
 * as no answer — it is a heading over nothing.
 */
function writableProfile(profile: CfpProfile): Record<string, unknown> {
  const description = profile.description;
  const anyDescription = Boolean(description?.en || description?.fr);
  return {
    description: anyDescription
      ? { en: description!.en, ...(description!.fr ? { fr: description!.fr } : {}) }
      : FieldValue.delete(),
    eventDate: profile.eventDate || FieldValue.delete(),
    venue: profile.venue || FieldValue.delete(),
    location: profile.location || FieldValue.delete(),
    website: profile.website || FieldValue.delete(),
  };
}

/** The name, who can find it, and what it says about the event. */
export const updateCfp = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change this call for proposals');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const name = String(data.name ?? '').trim();
  const visibility = String(data.visibility ?? '');
  const fault = validateCfp({ id: cfpId, name, visibility });
  if (fault) throw new HttpsError('invalid-argument', fault);

  const profile = readProfile(data);
  const profileFault = validateProfile(profile);
  if (profileFault) throw new HttpsError('invalid-argument', profileFault);

  await db.doc(`cfps/${cfpId}`).update({
    name,
    visibility,
    ...writableProfile(profile),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('cfp updated', { cfpId, byUid });
  return { ok: true };
});

/**
 * Archiving, and taking it back.
 *
 * Read-only rather than gone: the committee's decisions and the email log are
 * the record of a round that actually happened, and an organiser who wanted
 * them destroyed asked for `deleteCfp`. Reversible for the same reason —
 * archiving by mistake must not cost anybody their data.
 */
export const archiveCfp = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireOwner(request, cfpId, 'archive this call for proposals');
  const archived = (request.data as { archived?: unknown }).archived !== false;

  await db.doc(`cfps/${cfpId}`).update({
    archived,
    // Cleared rather than left behind, so "when was this archived" cannot
    // answer for an archiving that was undone.
    archivedAt: archived ? FieldValue.serverTimestamp() : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('cfp archived', { cfpId, byUid, archived });
  return { ok: true, archived };
});

/**
 * Deleting a CFP, and everything anybody submitted to it.
 *
 * Two steps on purpose. It must be archived first — so the round is visibly
 * over before it can be destroyed — and the caller has to send back the id,
 * which is what a confirm dialog cannot do on its own. This is other people's
 * writing; nobody should be one stray click from it.
 *
 * `recursiveDelete` walks the subcollections, and the bucket prefix goes with
 * them. Both are best-effort against a partial failure: a second call finishes
 * the job, because a half-deleted CFP is worse than either outcome.
 */
export const deleteCfp = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireOwner(request, cfpId, 'delete this call for proposals');

  const snap = await db.doc(`cfps/${cfpId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (snap.data()?.archived !== true) {
    throw new HttpsError('failed-precondition', 'Archive it before deleting it.');
  }
  if (String((request.data as { confirm?: unknown }).confirm ?? '') !== cfpId) {
    throw new HttpsError('invalid-argument', 'Type the address to confirm.');
  }

  await getStorage()
    .bucket()
    .deleteFiles({ prefix: `cfps/${cfpId}/` })
    .catch((error) => logger.error('could not clear the bucket', { cfpId, error: String(error) }));

  await db.recursiveDelete(db.doc(`cfps/${cfpId}`));
  logger.warn('cfp deleted', { cfpId, byUid });
  return { ok: true };
});

// ----------------------------------------------------------------------- roles

/**
 * Called once after sign-in. Returns the caller's role, claiming a pending
 * `roleGrants` entry if one is waiting for their address.
 *
 * The email comes from the verified auth token, never from the request body —
 * otherwise anyone could claim any grant by naming it.
 */
export const claimRole = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
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
      cfpId,
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'assign roles');
  const data = (request.data ?? {}) as { email?: unknown; role?: unknown };

  try {
    const result = await grant(db, getAuth(), { cfpId, email: data.email, role: data.role, byUid });
    logger.info('role granted', { ...result, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Admin only, and refuses to remove the last admin. */
export const revokeRole = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'remove roles');
  const data = (request.data ?? {}) as { email?: unknown };

  try {
    const result = await revoke(db, getAuth(), { cfpId, email: data.email });
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
 * Admins may also restore a decision to `submitted`. That is the exact state
 * the proposals screen's Undo control needs; `draft` and `withdrawn` remain the
 * applicant's own states and are never settable here.
 */
const DECIDABLE = STATUS_SETS.decidable;
const ADMIN_PROPOSAL_STATUSES = ['submitted', ...DECIDABLE] as const;

export const setProposalStatus = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'decide a proposal');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const proposalId = requireProposalId(data);
  const status = String(data.status ?? '');
  if (!(ADMIN_PROPOSAL_STATUSES as readonly string[]).includes(status)) {
    throw new HttpsError(
      'invalid-argument',
      `Status must be one of ${ADMIN_PROPOSAL_STATUSES.join(', ')} — got "${status}".`,
    );
  }

  const ref = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
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
        await queueEmail(db, tx, cfpId, { kind: status as EmailKind, proposalId, ...context });
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'manage the email queue');
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

    const ref = db.doc(`cfps/${cfpId}/emailLog/${logId}`);
    const status = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'No such message.');

      // In-flight rows are the trigger's, not ours: re-queueing one mid-send is
      // how the same person gets it twice in the same minute.
      const current = snap.get('status') as EmailStatus;
      if (current === 'queued' || current === 'sending') {
        throw new HttpsError('failed-precondition', `That message is already ${current}.`);
      }
      const holds = DECISION_STILL_TRUE[snap.get('kind') as string];
      if (holds) {
        const proposalId = snap.get('proposalId') as string;
        const proposal = await tx.get(db.doc(`cfps/${cfpId}/proposals/${proposalId}`));
        if (!proposal.exists || !holds.includes(proposal.get('status') as string)) {
          throw new HttpsError(
            'failed-precondition',
            'That decision changed, so this message is no longer sendable.',
          );
        }
      }
      tx.update(ref, { status: 'queued' satisfies EmailStatus });
      return current;
    });

    logger.info('email re-queued', { byUid, logId, was: status });
    return { ok: true, logId };
  }

  const [snap, configSnap] = await Promise.all([
    db.collection(`cfps/${cfpId}/emailLog`).get(),
    db.doc(`cfps/${cfpId}/config/email`).get(),
  ]);
  const emailConfig = configSnap.data() ?? {};
  const pendingDocs = snap.docs.filter((doc) =>
    ['held', 'failed', 'dry_run'].includes(doc.get('status') as string),
  );
  const pendingState =
    action === 'preview' || action === 'release' || action === 'retry'
      ? await currentDecisionEmails(cfpId, pendingDocs)
      : { sendable: pendingDocs, stale: [] };
  const staleIds = new Set(pendingState.stale.map((doc) => doc.id));

  const tally: Record<string, number> = {};
  for (const doc of snap.docs) {
    // A retained, superseded decision is not waiting for release. It becomes
    // sendable again only if the committee restores that exact decision.
    if (staleIds.has(doc.id)) continue;
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
      // The database row remains held so restoring the decision can release it.
      // This flag lets the log describe its effective state truthfully.
      stale: staleIds.has(d.id),
    }))
    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0) || a.to.localeCompare(b.to));

  if (action === 'preview') {
    return {
      ok: true,
      tally,
      settings: await loadSettings(db, cfpId),
      // Setup state for the panel. `keyHint` is the last four characters of the
      // API key — never the key.
      keyHint: (emailConfig.keyHint as string) ?? '',
      domainId: (emailConfig.domainId as string) ?? '',
      // The name, not just the id: the panel compares it against the sender to
      // catch an address on a domain that was never verified.
      domain: (emailConfig.domain as string) ?? '',
      templates: emailConfig.templates ?? {},
      // Enough to check the copy and the addresses before committing to a send.
      held: pendingState.sendable
        .filter((d) => d.get('status') === 'held')
        .map((d) => ({ kind: d.get('kind'), to: d.get('to'), title: d.get('data')?.title })),
      staleHeld: pendingState.stale.length,
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
  const due = pendingState.sendable.filter((d) => from.includes(d.get('status')));

  /*
   * A decision reversed after it was queued must not go out anyway.
   *
   * Holding decisions so they release together buys the committee a window to
   * change its mind — and the whole point is lost if the row queued during that
   * window sends regardless. Nothing else re-reads the proposal: `held` was
   * written when the status changed, and a later change does not revisit it.
   *
   * Stale rows stay `held` rather than being deleted, so restoring the decision
   * releases them normally on the next pass.
   */
  const stale = pendingState.stale.filter((d) => from.includes(d.get('status'))).length;

  const CHUNK = 400;
  for (let i = 0; i < due.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of due.slice(i, i + CHUNK)) {
      batch.update(doc.ref, { status: 'queued' satisfies EmailStatus });
    }
    await batch.commit();
  }

  logger.info('email queue advanced', { byUid, action, count: due.length, stale });
  return { ok: true, tally, released: due.length, stale };
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
 *
 * `cfpId` is optional and only decides who the message comes from and where it
 * lands: signing in at a CFP writes as that CFP, signing in at the home page
 * writes as the platform. The link itself is the same either way — an account
 * is an account, not a membership.
 */
export const requestSignInLink = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as { email?: unknown; locale?: unknown; cfpId?: unknown };
  const email = String(data.email ?? '').trim().toLowerCase();
  const locale: EmailLocale = data.locale === 'fr' ? 'fr' : 'en';
  const cfpId = typeof data.cfpId === 'string' && validateCfpId(data.cfpId) === null
    ? data.cfpId
    : null;

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  }

  await takeLinkAllowance(email);

  const [apiKey, platform] = await Promise.all([readResendKey(), loadPlatform(db)]);
  // Named CFP or not, the sender is looked up server-side. Nothing about who
  // this mail comes from is taken from the caller.
  const [settings, cfpSnap] = await Promise.all([
    cfpId ? loadSettings(db, cfpId) : Promise.resolve(platform.settings),
    cfpId ? db.doc(`cfps/${cfpId}`).get() : Promise.resolve(null),
  ]);
  const event = (cfpSnap?.get('name') as string) || platform.name;

  const link = await getAuth().generateSignInWithEmailLink(email, {
    // Must be one of Auth's authorized domains, or Firebase refuses to mint it.
    // The origin is platform config, never a per-CFP field: an organiser who
    // could edit it could aim other people's sign-in mail at a host they own.
    url: cfpId ? cfpUrl(platform.publicUrl, cfpId) : `${platform.publicUrl}/`,
    handleCodeInApp: true,
  });

  const outcome = await sendViaResend(
    email,
    renderSignInEmail(link, locale, event),
    apiKey,
    settings,
  );
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'write to a speaker');
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
    const snap = await tx.get(db.doc(`cfps/${cfpId}/proposals/${proposalId}`));
    if (!snap.exists) throw new HttpsError('not-found', 'No such proposal.');

    // A draft is nobody's but its author's, and writing to someone about a talk
    // they have not submitted tells them it was read.
    if (snap.get('status') === 'draft') {
      throw new HttpsError('failed-precondition', 'That proposal has not been submitted.');
    }

    const context = await emailContext(tx, snap.data()!);
    if (!context) throw new HttpsError('failed-precondition', 'No address on file for that speaker.');

    const ref = db.collection(`cfps/${cfpId}/emailLog`).doc();
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
 * The sender has to be on the domain *this* CFP registered. One Resend account
 * serves the whole platform, so without that check any organiser could put
 * another CFP's verified domain in their own `from` and send mail that arrives
 * signed by somebody else's event.
 */
export const setEmailSettings = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change the sending address');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const settings: EmailSettings = {
    from: String(data.from ?? '').trim(),
    replyTo: String(data.replyTo ?? '').trim(),
    // Platform config now — see `loadPlatform`. Kept on the type because the
    // renderer wants both halves in one object.
    publicUrl: '',
  };

  const problem = validateSettings(settings);
  if (problem) {
    throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);
  }

  const configRef = db.doc(`cfps/${cfpId}/config/email`);
  const registered = ((await configRef.get()).get('domain') as string | undefined) ?? '';
  if (!registered) {
    throw new HttpsError('failed-precondition', 'Add your sending domain first.');
  }
  const mismatch = senderMismatch(settings.from, registered);
  if (mismatch) {
    throw new HttpsError('invalid-argument', `${mismatch} is not your verified domain.`);
  }

  await configRef.set({ from: settings.from, replyTo: settings.replyTo }, { merge: true });
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change the email wording');
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
    await db.doc(`cfps/${cfpId}/config/email`).update({ [path]: FieldValue.delete() }).catch(() => {
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

  await db.doc(`cfps/${cfpId}/config/email`).set({ templates: { [kind]: { [locale]: template } } }, { merge: true });
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
  const cfpId = requireCfpId(request.data);
  const uid = await requireAdmin(request, cfpId, 'send a test');
  const to = request.auth?.token.email as string | undefined;
  if (!to) throw new HttpsError('failed-precondition', 'Your account has no email address.');

  const data = (request.data ?? {}) as Record<string, unknown>;
  const kind = String(data.kind ?? 'submission_received') as EmailKind;
  if (!EMAIL_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', `Unknown message "${kind}".`);
  }
  const locale = (data.locale === 'fr' ? 'fr' : 'en') as EmailLocale;

  const [apiKey, settings, templates, platform, cfpSnap] = await Promise.all([
    readResendKey(),
    loadSettings(db, cfpId),
    loadTemplates(db, cfpId),
    loadPlatform(db),
    db.doc(`cfps/${cfpId}`).get(),
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
    { id: cfpId, name: (cfpSnap.get('name') as string) || cfpId, publicUrl: platform.publicUrl },
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
 * logged, and never returned — `/admin` shows only the last four characters,
 * which is enough to tell one key from another and nothing else. Verified
 * against Resend before it is stored, so a typo fails here rather than silently
 * failing on the night the decisions go out.
 */
export const setEmailSecret = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'set the API key');
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
  await db.doc(`cfps/${cfpId}/config/email`).set(
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
 *
 * One Resend account serves the whole platform, so every action here is pinned
 * to the domain id stored on *this* CFP. `list` used to return the account's
 * whole roster, which under tenancy is a list of every other organiser's
 * domains, and `get`/`verify` took an id straight from the caller — which would
 * have let one CFP read another's DNS records and trigger its verifications.
 */
export const emailDomain = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'manage the sending domain');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'list');

  const apiKey = await readResendKey();
  const configRef = db.doc(`cfps/${cfpId}/config/email`);
  const ours = ((await configRef.get()).get('domainId') as string | undefined) ?? '';

  try {
    if (action === 'list') {
      return { ok: true, domains: ours ? [await getDomain(apiKey, ours)] : [] };
    }

    if (action === 'add') {
      const name = cleanDomain(String(data.domain ?? ''));
      if (!name) throw new HttpsError('invalid-argument', 'That is not a domain name.');

      // Already in the account — verified through Resend's own dashboard, or
      // added here before the write below landed. Adopting the existing one is
      // the only way forward: Resend refuses a duplicate, and refusing back
      // would leave a CFP permanently unable to claim a domain it owns.
      const existing = (await listDomains(apiKey)).find((d) => d.name === name);
      const domain = existing ?? (await addDomain(apiKey, name));
      await configRef.set({ domainId: domain.id, domain: name }, { merge: true });
      return { ok: true, domain: existing ? await getDomain(apiKey, domain.id) : domain };
    }

    if (!ours) throw new HttpsError('failed-precondition', 'No domain has been added yet.');

    if (action === 'get') return { ok: true, domain: await getDomain(apiKey, ours) };
    if (action === 'verify') {
      const domain = await verifyDomain(apiKey, ours);
      logger.info('domain verification requested', { byUid, cfpId, status: domain.status });
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
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'change the submission window');
  const data = (request.data ?? {}) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const key of ['opensAt', 'closesAt'] as const) {
    if (data[key] === undefined) continue;
    patch[key] = toTimestamp(data[key], key);
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

  const current = (await db.doc(`cfps/${cfpId}`).get()).data() ?? {};
  const opensAt = (patch.opensAt ?? current.opensAt) as Timestamp | undefined;
  const closesAt = (patch.closesAt ?? current.closesAt) as Timestamp | undefined;
  if (opensAt && closesAt && closesAt.toMillis() <= opensAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'The window would close before it opens.');
  }

  await db.doc(`cfps/${cfpId}`).set(patch, { merge: true });
  logger.info('cfp window changed', { byUid, ...patch });
  return { ok: true };
});
