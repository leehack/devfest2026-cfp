/**
 * §6 makes `status` and `aggregate` function-writable only, so the
 * draft → submitted transition cannot happen in the browser. That gives one
 * server-side chokepoint which re-runs validation and re-checks the deadline
 * against the server clock — neither can be bypassed by posting to Firestore.
 */

import { createHash, randomUUID } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import { inStatusSet, LIMITS, PROPOSAL_STATUSES, SCORES } from '../../shared/enums';
import { speakerSchema, submissionSchema } from '../../shared/schema';
import {
  DEFAULT_SUBMISSION_FORM,
  mergeSubmissionForm,
  normaliseSubmissionForm,
  validateSubmissionForm,
  type SubmissionForm,
} from '../../shared/submissionForm';
import { aggregateReviews, type Aggregate, type ReviewRecord } from '../../shared/aggregate';
import { parseSessionizeProfile, parseSessionizeUrl } from '../../shared/sessionize';
import {
  DECISION_KINDS,
  EMAIL_KINDS,
  EMAIL_LOCALES,
  MESSAGE_KIND,
  SCHEDULE_EMAIL_KINDS,
  STAFF_EMAIL_KINDS,
  renderSignInEmail,
  validateTemplate,
  type EmailKind,
  type EmailLocale,
  type Template,
} from '../../shared/emailTemplates';
import { senderMismatch, validateSettings, type EmailSettings } from '../../shared/emailSettings';
import {
  EMPTY_FORM,
  isConfirmedHeadshotPath,
  headshotPath,
  workingHeadshotPath,
  normaliseForm,
  validateAnswers,
  validateForm,
  localised,
  type Answers,
  type ConfirmForm,
  type HeadshotUploadPointer,
  type HeadshotUploads,
} from '../../shared/confirmForm';
import {
  CFP_LIMITS,
  calendarDate,
  validateCfp,
  validateCfpId,
  validateProfile,
  type CfpProfile,
  type CfpRole,
} from '../../shared/cfp';
import type { SpeakerSnapshot } from '../../shared/types';
import type { PlatformRole } from '../../shared/platform';
import { claim, grant, revoke, RoleError } from './roles';
import {
  claimPlatformRole,
  grantCfpCreator as grantPlatformCreator,
  grantPlatformAdmin as grantPlatformAdministrator,
  listPlatformAccess,
  revokeCfpCreator as revokePlatformCreator,
  revokePlatformAdmin as revokePlatformAdministrator,
} from './platform';
import {
  cfpUrl,
  deliver,
  loadPlatform,
  loadSettings,
  loadTemplates,
  logId,
  queueEmail,
  queueEmails,
  sendViaResend,
  settingsFromConfig,
  isCoSpeakerInvitationEmail,
  isStaffEmail,
  isRoleInvitationEmail,
  roleInvitationStillTrue,
  sendingLeaseExpired,
  staffEmailLanguage,
  staffMemberIsActive,
  staffNotificationStillTrue,
  verifiedStaffUser,
  type EmailStatus,
} from './email';
import {
  decodeHeadshotUpload,
  findSpeakerUploadedHeadshots,
  findUploadedHeadshots,
  freezeLegacyHeadshotAnswer,
  freezeLegacyHeadshots,
  freezeSpeakerUploadedHeadshots,
  freezeUploadedHeadshots,
  isSpeakerConfirmedHeadshotPath,
  readStoredHeadshot,
  speakerWorkingHeadshotFrom,
  speakerWorkingHeadshotMatches,
  speakerWorkingHeadshotPath,
  workingHeadshotFrom,
  workingHeadshotMatches,
} from './headshots';
import {
  coSpeakerSignInInvitationStillTrue,
  coSpeakerInvitationStillTrue,
  confirmationResponse,
  everySpeakerConfirmed,
  primarySpeakerId,
  proposalSpeakerIds,
  speakerConfirmationRef,
  speakerParticipantRef,
  usesPerSpeakerLifecycle,
} from './speakerLifecycle';
import { clearCfpFirestoreChildren, clearCfpStorage } from './deletion';
import { keyHint, readResendKey, writeResendKey } from './secrets';
import {
  addDomain,
  cleanDomain,
  getDomain,
  listDomains,
  ResendError,
  verifyDomain,
} from './domains';
import { useFreshHostingOrigin } from './authLinks';
export {
  getCoSpeakerInvitation,
  getProposalRoster,
  inviteCoSpeaker,
  removeCoSpeaker,
  retryCoSpeakerInvitation,
  respondToCoSpeakerInvitation,
  revokeCoSpeakerInvitation,
} from './coSpeakers';
import {
  SCHEDULE_LIMITS,
  publicScheduleSpeakers,
  resolvedScheduleLanguage,
  scheduleTaxonomyLabel,
  scheduleConflicts,
  sharedScheduleAudience,
  sharedScheduleEntriesFor,
  sharedScheduleForEntries,
  validateScheduleConfig,
  validateScheduleEntry,
  type PublicScheduleSpeaker,
  type PublishedScheduleEntry,
  type ScheduleConfig,
  type ScheduleDay,
  type ScheduleEntry,
  type ScheduleLanguage,
  type ScheduleRoom,
  type SharedSchedule,
} from '../../shared/schedule';

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
const EXTERNAL_MUTATION_CALLABLE = { ...CALLABLE, timeoutSeconds: 300 } as const;
const EXTERNAL_MUTATION_LEASE_MS = 10 * 60 * 1000;

/** How many emailLog rows the admin panel gets in one response. */
const ROW_CAP = 500;

interface CfpWindow {
  paused: boolean;
  archived: boolean;
  deleting?: boolean;
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

function assertCfpOpenSnapshot(snap: DocumentSnapshot): void {
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such call for proposals.');
  }
  const cfp = snap.data() as CfpWindow;
  const now = Date.now();
  if (cfp.deleting) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
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
  if (snap.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
  if (snap.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
}

/** For external side effects that cannot participate in a Firestore transaction. */
async function assertCfpNotArchivedNow(cfpId: string): Promise<DocumentSnapshot> {
  const snap = await db.doc(`cfps/${cfpId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (snap.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
  if (snap.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
  return snap;
}

const mutationLeaseRef = (cfpId: string) =>
  db.doc(`cfps/${cfpId}/config/externalMutation`);

function activeMutationLease(snap: DocumentSnapshot, now = Date.now()): boolean {
  if (!snap.exists) return false;
  const expiresAt = snap.get('expiresAt');
  return expiresAt instanceof Timestamp && expiresAt.toMillis() > now;
}

function assertMutationActor(
  member: DocumentSnapshot,
  role: 'admin' | 'owner',
): void {
  const actual = member.get('role');
  const allowed = role === 'owner' ? actual === 'owner' : actual === 'owner' || actual === 'admin';
  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      role === 'owner'
        ? 'Only an owner can complete this change.'
        : 'Only an admin can complete this change.',
    );
  }
}

/**
 * Reserves the external side-effect lane for one CFP. The callable timeout is
 * shorter than the lease, so an expired lease always belongs to a dead call.
 */
async function acquireCfpMutation(
  cfpId: string,
  kind: string,
  validate: (tx: FirebaseFirestore.Transaction) => Promise<void>,
  options: { allowArchived?: boolean } = {},
): Promise<string> {
  const leaseId = randomUUID();
  await db.runTransaction(async (tx) => {
    const [cfp, lease] = await tx.getAll(db.doc(`cfps/${cfpId}`), mutationLeaseRef(cfpId));
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true && options.allowArchived !== true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (activeMutationLease(lease)) {
      throw new HttpsError('aborted', 'Another event change is still in progress. Try again.');
    }
    await validate(tx);
    tx.set(mutationLeaseRef(cfpId), {
      id: leaseId,
      kind,
      expiresAt: Timestamp.fromMillis(Date.now() + EXTERNAL_MUTATION_LEASE_MS),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return leaseId;
}

async function finishCfpMutation(
  cfpId: string,
  leaseId: string,
  apply: (tx: FirebaseFirestore.Transaction) => Promise<void> | void,
  options: { allowArchived?: boolean } = {},
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const [cfp, lease] = await tx.getAll(db.doc(`cfps/${cfpId}`), mutationLeaseRef(cfpId));
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true && options.allowArchived !== true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!lease.exists || lease.get('id') !== leaseId) {
      throw new HttpsError('aborted', 'The event change lease expired. Try again.');
    }
    await apply(tx);
    tx.delete(lease.ref);
  });
}

async function releaseCfpMutation(cfpId: string, leaseId: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const lease = await tx.get(mutationLeaseRef(cfpId));
    if (lease.exists && lease.get('id') === leaseId) tx.delete(lease.ref);
  });
}

async function releaseCfpMutationQuietly(cfpId: string, leaseId: string): Promise<void> {
  try {
    await releaseCfpMutation(cfpId, leaseId);
  } catch (error) {
    logger.error('could not release event mutation lease', { cfpId, error: String(error) });
  }
}

function requireUid(request: { auth?: { uid: string } }, action: string): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', `Sign in to ${action}.`);
  return uid;
}

function requireVerifiedUid(
  request: { auth?: { uid: string; token?: { email_verified?: unknown } } },
  action: string,
): string {
  const uid = requireUid(request, action);
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return uid;
}

function requireVerifiedPlatformIdentity(
  request: {
    auth?: {
      uid: string;
      token: { email?: unknown; email_verified?: unknown; name?: unknown };
    };
  },
  action: string,
): { uid: string; email: string; name?: string } {
  const uid = requireUid(request, action);
  const token = request.auth!.token;
  if (token.email_verified !== true || typeof token.email !== 'string') {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return {
    uid,
    email: token.email,
    ...(typeof token.name === 'string' && token.name ? { name: token.name } : {}),
  };
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

async function requireScheduleAdmin(
  request: { auth?: { uid: string; token?: { email_verified?: unknown } } },
  cfpId: string,
  action: string,
): Promise<string> {
  const uid = requireVerifiedUid(request, action);
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

async function requirePlatformAdmin(
  request: {
    auth?: {
      uid: string;
      token: { email?: unknown; email_verified?: unknown; name?: unknown };
    };
  },
  action: string,
): Promise<{ uid: string; email: string; name?: string }> {
  const identity = requireVerifiedPlatformIdentity(request, action);
  try {
    const role = await claimPlatformRole(db, identity);
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', `Only a platform admin can ${action}.`);
    }
    return identity;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw asHttpsError(error);
  }
}

async function requirePlatformOwner(
  request: {
    auth?: {
      uid: string;
      token: { email?: unknown; email_verified?: unknown; name?: unknown };
    };
  },
  action: string,
): Promise<{ uid: string; email: string; name?: string }> {
  const identity = requireVerifiedPlatformIdentity(request, action);
  try {
    if ((await claimPlatformRole(db, identity)) !== 'owner') {
      throw new HttpsError('permission-denied', `Only a platform owner can ${action}.`);
    }
    return identity;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw asHttpsError(error);
  }
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

/** Whole-session actions stay with the account that created the proposal. */
async function readPrimaryProposal(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  uid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const proposal = await readOwnProposal(tx, ref, uid);
  if (primarySpeakerId(proposal) !== uid) {
    throw new HttpsError('permission-denied', 'Only the lead speaker can change the session.');
  }
  return proposal;
}

/**
 * Reassembles the stored draft into the shape `submissionSchema` expects.
 * The proposal document holds the talk; the speaker document holds the person.
 */
function assemble(
  proposal: FirebaseFirestore.DocumentData,
  speaker: FirebaseFirestore.DocumentData,
  participation?: FirebaseFirestore.DocumentData,
  privateParticipation = false,
) {
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
    acks: privateParticipation ? participation?.acks ?? {} : proposal.acks ?? {},
    attendance: privateParticipation
      ? participation?.attendance ?? {}
      : proposal.attendance ?? {},
  };
}

/**
 * The form this call actually asks, from `config/submissionForm`.
 *
 * Absent for every call that predates the form being configurable, and the
 * defaults are what those calls were already using — so a missing document is a
 * working document rather than a reason to refuse a submission.
 */
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
const CARRY_SCHEDULE_EMAIL_STATUSES = new Set<EmailStatus>(['held', 'failed', 'dry_run']);

function isScheduleEmail(kind: unknown): kind is EmailKind {
  return SCHEDULE_EMAIL_KINDS.includes(kind as EmailKind);
}

/** Working-placement mail follows the newest shared snapshot, then legacy public data. */
function scheduleEmailReleaseId(cfp: DocumentSnapshot | null | undefined): string {
  return String(cfp?.get('sharedScheduleId') ?? cfp?.get('publishedScheduleId') ?? '');
}

function scheduleEmailStillTrue(
  kind: string,
  rowReleaseId: string,
  currentReleaseId: string,
  entry: DocumentSnapshot | undefined,
  proposalStatus: string | undefined,
): boolean {
  if (!currentReleaseId || rowReleaseId !== currentReleaseId || !entry) return false;
  if (kind === 'schedule_cancelled') return !entry.exists || entry.get('cancelled') === true;
  return proposalStatus === 'confirmed' && entry.exists && entry.get('cancelled') !== true;
}

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
    ...new Set(
      docs
        .filter((doc) => {
          const kind = doc.get('kind');
          return (
            Boolean(DECISION_STILL_TRUE[kind as string]) ||
            isScheduleEmail(kind) ||
            kind === 'committee_proposal_submitted' ||
            isCoSpeakerInvitationEmail(kind) ||
            (!isStaffEmail(kind) && Boolean(doc.get('recipientUid')))
          );
        })
        .map((doc) => doc.get('proposalId') as string)
        .filter(Boolean),
    ),
  ];
  const proposals = proposalIds.length
    ? await db.getAll(
        ...proposalIds.map((proposalId) => db.doc(`cfps/${cfpId}/proposals/${proposalId}`)),
      )
    : [];
  const proposalMap = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const current = new Map(
    proposals.map((proposal) => [proposal.id, proposal.get('status') as string]),
  );
  const scheduleDocs = docs.filter((doc) => isScheduleEmail(doc.get('kind')));
  const staffDocs = docs.filter((doc) => isStaffEmail(doc.get('kind')));
  const cfp = await db.doc(`cfps/${cfpId}`).get();
  if (!cfp.exists || cfp.get('archived') === true) {
    return { sendable: [], stale: docs };
  }
  const currentReleaseId = scheduleEmailReleaseId(cfp);
  const scheduleEntryIds = [
    ...new Set(
      scheduleDocs
        .filter((doc) => doc.get('dedupeKey') === currentReleaseId)
        .map((doc) => doc.get('data')?.scheduleEntryId as string)
        .filter(Boolean),
    ),
  ];
  const scheduleEntries = scheduleEntryIds.length
    ? await db.getAll(
        ...scheduleEntryIds.map((entryId) =>
          db.doc(`cfps/${cfpId}/scheduleReleases/${currentReleaseId}/entries/${entryId}`),
        ),
      )
    : [];
  const scheduleEntryMap = new Map(scheduleEntries.map((entry) => [entry.id, entry]));
  const staffUids = [
    ...new Set(staffDocs.map((doc) => String(doc.get('recipientUid') ?? '')).filter(Boolean)),
  ];
  const [staffMembers, staffUsers] = await Promise.all([
    staffUids.length
      ? db.getAll(...staffUids.map((uid) => db.doc(`cfps/${cfpId}/members/${uid}`)))
      : Promise.resolve([]),
    Promise.all(staffUids.map(async (uid) => [uid, await verifiedStaffUser(uid)] as const)),
  ]);
  const staffMemberMap = new Map(staffMembers.map((member) => [member.id, member]));
  const staffUserMap = new Map(staffUsers);
  const invitationDocs = docs.filter((doc) => isRoleInvitationEmail(doc.get('kind')));
  const grantEmails = [
    ...new Set(
      invitationDocs.map((doc) => String(doc.get('grantEmail') ?? '')).filter(Boolean),
    ),
  ];
  const grants = grantEmails.length
    ? await db.getAll(
        ...grantEmails.map((email) => db.doc(`cfps/${cfpId}/roleGrants/${email}`)),
      )
    : [];
  const grantMap = new Map(grants.map((grant) => [grant.id, grant]));
  const coInvitationDocs = docs.filter((doc) =>
    isCoSpeakerInvitationEmail(doc.get('kind')),
  );
  const coInvitations = coInvitationDocs.length
    ? await db.getAll(
        ...coInvitationDocs.map((doc) =>
          db.doc(
            `cfps/${cfpId}/proposals/${String(doc.get('proposalId') ?? '')}` +
              `/speakerInvitations/${String(doc.get('invitationId') ?? '')}`,
          ),
        ),
      )
    : [];
  const coInvitationMap = new Map(
    coInvitationDocs.map((doc, index) => [doc.id, coInvitations[index]]),
  );
  const sendable = docs.filter((doc) => {
    const kind = doc.get('kind') as string;
    const holds = DECISION_STILL_TRUE[kind];
    if (isStaffEmail(kind)) {
      const uid = String(doc.get('recipientUid') ?? '');
      const subjectId = String(doc.get('proposalId') ?? '');
      const subject =
        kind === 'committee_proposal_submitted' ? proposalMap.get(subjectId) ?? null : cfp;
      return (
        Boolean(staffUserMap.get(uid)) &&
        staffMemberIsActive(staffMemberMap.get(uid)?.data(), cfpId, uid) &&
        staffNotificationStillTrue(kind, subjectId, subject)
      );
    }
    if (isRoleInvitationEmail(kind)) {
      const grantEmail = String(doc.get('grantEmail') ?? '');
      return roleInvitationStillTrue(
        kind,
        String(doc.get('proposalId') ?? ''),
        cfpId,
        grantEmail,
        grantMap.get(grantEmail) ?? null,
      );
    }
    if (isCoSpeakerInvitationEmail(kind)) {
      const proposalId = String(doc.get('proposalId') ?? '');
      return coSpeakerInvitationStillTrue(
        kind,
        String(doc.get('invitationId') ?? ''),
        cfpId,
        proposalId,
        String(doc.get('invitationEmail') ?? ''),
        coInvitationMap.get(doc.id) ?? null,
        proposalMap.get(proposalId) ?? null,
        cfp,
      );
    }
    const recipientUid = String(doc.get('recipientUid') ?? '');
    if (
      recipientUid &&
      !proposalSpeakerIds(proposalMap.get(String(doc.get('proposalId') ?? ''))?.data() ?? {})
        .includes(recipientUid)
    ) {
      return false;
    }
    if (isScheduleEmail(kind)) {
      const entryId = doc.get('data')?.scheduleEntryId as string;
      return scheduleEmailStillTrue(
        kind,
        String(doc.get('dedupeKey') ?? ''),
        currentReleaseId,
        scheduleEntryMap.get(entryId),
        current.get(doc.get('proposalId') as string),
      );
    }
    // A kind with no entry is not a decision at all, so nothing to check.
    return !holds || holds.includes(current.get(doc.get('proposalId') as string) ?? '');
  });
  const sendableIds = new Set(sendable.map((doc) => doc.id));
  return { sendable, stale: docs.filter((doc) => !sendableIds.has(doc.id)) };
}

/** Prevents concurrent releases from re-queuing a row the sender already claimed. */
async function advanceEmailQueue(
  cfpId: string,
  candidates: DocumentSnapshot[],
  from: EmailStatus[],
): Promise<{ released: number; stale: number }> {
  let released = 0;
  let stale = 0;
  const CHUNK = 100;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const candidateChunk = candidates.slice(i, i + CHUNK);
    const staffUids = [
      ...new Set(
        candidateChunk
          .filter((row) => isStaffEmail(row.get('kind')))
          .map((row) => String(row.get('recipientUid') ?? ''))
          .filter(Boolean),
      ),
    ];
    const staffUsers = new Map(
      await Promise.all(staffUids.map(async (uid) => [uid, await verifiedStaffUser(uid)] as const)),
    );
    const result = await db.runTransaction(async (tx) => {
      const rows = await tx.getAll(...candidateChunk.map((doc) => doc.ref));
      const proposalIds = [
        ...new Set(
          rows
            .filter(
              (row) =>
                DECISION_STILL_TRUE[row.get('kind') as string] ||
                isScheduleEmail(row.get('kind')) ||
                row.get('kind') === 'committee_proposal_submitted' ||
                isCoSpeakerInvitationEmail(row.get('kind')) ||
                (!isStaffEmail(row.get('kind')) && Boolean(row.get('recipientUid'))),
            )
            .map((row) => row.get('proposalId') as string)
            .filter(Boolean),
        ),
      ];
      const proposals =
        proposalIds.length > 0
          ? await tx.getAll(
              ...proposalIds.map((proposalId) =>
                db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
              ),
            )
          : [];
      const proposalStatuses = new Map(
        proposals.map((proposal) => [proposal.id, proposal.get('status') as string]),
      );
      const proposalMap = new Map(proposals.map((proposal) => [proposal.id, proposal]));
      const scheduleRows = rows.filter((row) => isScheduleEmail(row.get('kind')));
      const staffRows = rows.filter((row) => isStaffEmail(row.get('kind')));
      const cfp = await tx.get(db.doc(`cfps/${cfpId}`));
      if (!cfp.exists || cfp.get('archived') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      const currentReleaseId = scheduleEmailReleaseId(cfp);
      const scheduleEntryIds = [
        ...new Set(
          scheduleRows
            .filter((row) => row.get('dedupeKey') === currentReleaseId)
            .map((row) => row.get('data')?.scheduleEntryId as string)
            .filter(Boolean),
        ),
      ];
      const scheduleEntries = scheduleEntryIds.length
        ? await tx.getAll(
            ...scheduleEntryIds.map((entryId) =>
              db.doc(`cfps/${cfpId}/scheduleReleases/${currentReleaseId}/entries/${entryId}`),
            ),
          )
        : [];
      const scheduleEntryMap = new Map(scheduleEntries.map((entry) => [entry.id, entry]));
      const memberUids = [
        ...new Set(
          staffRows.map((row) => String(row.get('recipientUid') ?? '')).filter(Boolean),
        ),
      ];
      const members = memberUids.length
        ? await tx.getAll(
            ...memberUids.map((uid) => db.doc(`cfps/${cfpId}/members/${uid}`)),
          )
        : [];
      const memberMap = new Map(members.map((member) => [member.id, member]));
      const invitationRows = rows.filter((row) => isRoleInvitationEmail(row.get('kind')));
      const grantEmails = [
        ...new Set(
          invitationRows.map((row) => String(row.get('grantEmail') ?? '')).filter(Boolean),
        ),
      ];
      const grants = grantEmails.length
        ? await tx.getAll(
            ...grantEmails.map((email) => db.doc(`cfps/${cfpId}/roleGrants/${email}`)),
          )
        : [];
      const grantMap = new Map(grants.map((grant) => [grant.id, grant]));
      const coInvitationRows = rows.filter((row) =>
        isCoSpeakerInvitationEmail(row.get('kind')),
      );
      const coInvitations = coInvitationRows.length
        ? await tx.getAll(
            ...coInvitationRows.map((row) =>
              db.doc(
                `cfps/${cfpId}/proposals/${String(row.get('proposalId') ?? '')}` +
                  `/speakerInvitations/${String(row.get('invitationId') ?? '')}`,
              ),
            ),
          )
        : [];
      const coInvitationMap = new Map(
        coInvitationRows.map((row, index) => [row.id, coInvitations[index]]),
      );

      let advanced = 0;
      let superseded = 0;
      for (const row of rows) {
        if (!row.exists || !from.includes(row.get('status') as EmailStatus)) continue;
        if (
          row.get('status') === 'sending' &&
          !sendingLeaseExpired(row.get('sendingStartedAt') ?? row.updateTime)
        ) {
          continue;
        }
        const holds = DECISION_STILL_TRUE[row.get('kind') as string];
        if (isStaffEmail(row.get('kind'))) {
          const uid = String(row.get('recipientUid') ?? '');
          const subjectId = String(row.get('proposalId') ?? '');
          const subject =
            row.get('kind') === 'committee_proposal_submitted'
              ? proposalMap.get(subjectId) ?? null
              : cfp;
          if (
            !staffUsers.get(uid) ||
            !staffMemberIsActive(memberMap.get(uid)?.data(), cfpId, uid) ||
            !staffNotificationStillTrue(row.get('kind'), subjectId, subject)
          ) {
            superseded += 1;
            continue;
          }
        }
        if (isRoleInvitationEmail(row.get('kind'))) {
          const grantEmail = String(row.get('grantEmail') ?? '');
          if (
            !roleInvitationStillTrue(
              row.get('kind'),
              String(row.get('proposalId') ?? ''),
              cfpId,
              grantEmail,
              grantMap.get(grantEmail) ?? null,
            )
          ) {
            superseded += 1;
            continue;
          }
        }
        if (isCoSpeakerInvitationEmail(row.get('kind'))) {
          const proposalId = String(row.get('proposalId') ?? '');
          if (
            !coSpeakerInvitationStillTrue(
              row.get('kind'),
              String(row.get('invitationId') ?? ''),
              cfpId,
              proposalId,
              String(row.get('invitationEmail') ?? ''),
              coInvitationMap.get(row.id) ?? null,
              proposalMap.get(proposalId) ?? null,
              cfp,
            )
          ) {
            superseded += 1;
            continue;
          }
        }
        const recipientUid = String(row.get('recipientUid') ?? '');
        if (
          recipientUid &&
          !isStaffEmail(row.get('kind')) &&
          !proposalSpeakerIds(
            proposalMap.get(String(row.get('proposalId') ?? ''))?.data() ?? {},
          ).includes(recipientUid)
        ) {
          superseded += 1;
          continue;
        }
        if (isScheduleEmail(row.get('kind'))) {
          const entryId = row.get('data')?.scheduleEntryId as string;
          if (
            !scheduleEmailStillTrue(
              row.get('kind') as string,
              String(row.get('dedupeKey') ?? ''),
              currentReleaseId,
              scheduleEntryMap.get(entryId),
              proposalStatuses.get(row.get('proposalId') as string),
            )
          ) {
            superseded += 1;
            continue;
          }
        }
        if (
          holds &&
          !holds.includes(proposalStatuses.get(row.get('proposalId') as string) ?? '')
        ) {
          superseded += 1;
          continue;
        }
        tx.update(row.ref, {
          status: 'queued' satisfies EmailStatus,
          sendingClaimId: FieldValue.delete(),
          sendingStartedAt: FieldValue.delete(),
          sentAt: FieldValue.delete(),
          providerId: FieldValue.delete(),
          error: FieldValue.delete(),
        });
        advanced += 1;
      }
      return { advanced, superseded };
    });
    released += result.advanced;
    stale += result.superseded;
  }

  return { released, stale };
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

    const refreshed = await Promise.all(
      open.map((doc) =>
        db.runTransaction(async (tx) => {
          const cfpId = doc.ref.parent.parent?.id;
          if (!cfpId) return false;
          const [cfp, proposal] = await tx.getAll(db.doc(`cfps/${cfpId}`), doc.ref);
          if (
            !cfp.exists ||
            cfp.get('archived') === true ||
            !proposal.exists ||
            !STILL_BEING_JUDGED.includes(String(proposal.get('status') ?? ''))
          ) {
            return false;
          }
          // Replace this speaker's entry and leave any co-presenter's alone.
          const current =
            (proposal.get('speakerSnapshot') as SpeakerSnapshot[] | undefined) ?? [];
          tx.update(proposal.ref, {
            speakerSnapshot: current.map((person) => (person.uid === uid ? next : person)),
          });
          return true;
        }),
      ),
    );

    logger.info('speaker snapshot refreshed', {
      uid,
      proposals: refreshed.filter(Boolean).length,
    });
  },
);

/**
 * Everything an email needs about a proposal, gathered inside the caller's
 * transaction. Returns null when there is nobody to write to — an email is
 * never a reason to fail the operation that triggered it.
 */
interface SpeakerEmailContext {
  uid: string;
  primary: boolean;
  to: string;
  locale: EmailLocale;
  data: {
    speakerName: string;
    title: string;
    needsVisa: boolean;
  };
}

async function speakerEmailContexts(
  tx: FirebaseFirestore.Transaction,
  cfpId: string,
  proposalId: string,
  proposal: FirebaseFirestore.DocumentData,
): Promise<SpeakerEmailContext[]> {
  const speakerIds = proposalSpeakerIds(proposal);
  if (speakerIds.length === 0) return [];
  const primary = primarySpeakerId(proposal);
  const perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
  const profileRefs = speakerIds.map((uid) => db.doc(`speakers/${uid}`));
  const participantRefs = perSpeakerLifecycle
    ? speakerIds.map((uid) =>
        speakerParticipantRef(db, cfpId, proposalId, uid),
      )
    : [];
  const snapshots = await tx.getAll(...profileRefs, ...participantRefs);
  const profiles = snapshots.slice(0, profileRefs.length);
  const participants = snapshots.slice(profileRefs.length);
  return profiles.flatMap((snapshot, index) => {
    const speaker = snapshot.data();
    const participant = participants[index]?.data();
    const to = speaker?.email;
    if (typeof to !== 'string' || !to) return [];
    const isPrimary = speakerIds[index] === primary;
    return [{
      uid: speakerIds[index],
      primary: isPrimary,
      to,
      locale: (speaker.locale === 'fr' ? 'fr' : 'en') as EmailLocale,
      data: {
        speakerName: (speaker.name as string) || to,
        title: (proposal.title as string) ?? '',
        needsVisa: perSpeakerLifecycle
          ? participant?.attendance?.needsVisa === true
          : isPrimary && proposal.attendance?.needsVisa === true,
      },
    }];
  });
}

type StaffEmailKind = Extract<
  EmailKind,
  'committee_proposal_submitted' | 'committee_schedule_shared'
>;

interface StaffRecipient {
  uid: string;
  email: string;
  name: string;
  locale: EmailLocale;
  bilingual: boolean;
}

async function activeStaffRecipients(
  cfpId: string,
  excludeUids: readonly string[],
): Promise<StaffRecipient[]> {
  const excluded = new Set(excludeUids);
  const members = await db.collection(`cfps/${cfpId}/members`).get();
  const candidates = members.docs.filter(
    (member) =>
      !excluded.has(member.id) &&
      staffMemberIsActive(member.data(), cfpId, member.id),
  );
  const users = new Map<string, Awaited<ReturnType<typeof verifiedStaffUser>>>();
  for (let index = 0; index < candidates.length; index += 100) {
    const chunk = candidates.slice(index, index + 100);
    const result = await getAuth().getUsers(chunk.map((member) => ({ uid: member.id })));
    for (const user of result.users) {
      users.set(user.uid, !user.disabled && user.emailVerified && user.email ? user : null);
    }
  }

  return candidates.flatMap((member) => {
    const user = users.get(member.id);
    if (!user?.email) return [];
    const language = staffEmailLanguage(member.data());
    return [{
      uid: member.id,
      email: user.email,
      name: String(member.get('name') ?? user.displayName ?? user.email),
      ...language,
    }];
  });
}

async function queueStaffNotifications(
  cfpId: string,
  kind: StaffEmailKind,
  subjectId: string,
  excludedUids: readonly string[],
): Promise<number> {
  if (!STAFF_EMAIL_KINDS.includes(kind)) return 0;
  const recipients = await activeStaffRecipients(cfpId, excludedUids);
  let eligible = 0;

  for (let index = 0; index < recipients.length; index += 10) {
    const results = await Promise.all(
      recipients.slice(index, index + 10).map((recipient) =>
        db.runTransaction(async (tx) => {
          const memberRef = db.doc(`cfps/${cfpId}/members/${recipient.uid}`);
          const subjectRef =
            kind === 'committee_proposal_submitted'
              ? db.doc(`cfps/${cfpId}/proposals/${subjectId}`)
              : db.doc(`cfps/${cfpId}`);
          const cfpRef = db.doc(`cfps/${cfpId}`);
          const [cfp, member] = await tx.getAll(cfpRef, memberRef);
          const subject =
            kind === 'committee_proposal_submitted' ? await tx.get(subjectRef) : cfp;
          if (
            !cfp.exists ||
            cfp.get('archived') === true ||
            !staffMemberIsActive(member.data(), cfpId, recipient.uid) ||
            !staffNotificationStillTrue(kind, subjectId, subject)
          ) {
            return false;
          }
          await queueEmail(db, tx, cfpId, {
            kind,
            proposalId: subjectId,
            dedupeKey: recipient.uid,
            recipientUid: recipient.uid,
            to: recipient.email,
            locale: recipient.locale,
            bilingual: recipient.bilingual,
            data: {
              speakerName: recipient.name,
              title: '',
            },
          });
          return true;
        }),
      ),
    );
    eligible += results.filter(Boolean).length;
  }
  return eligible;
}

export const submitProposal = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireUid(request, 'submit a proposal');
  const proposalId = requireProposalId(request.data);

  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);

  const result = await db.runTransaction(async (tx) => {
    const [cfp, formSnap] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      db.doc(`cfps/${cfpId}/config/submissionForm`),
    );
    assertCfpOpenSnapshot(cfp);
    // The form is part of the commit boundary. If an organiser adds a required
    // answer concurrently, Firestore retries and validates against that form.
    const shape = mergeSubmissionForm(formSnap.exists ? formSnap.data() : undefined);
    const proposal = await readPrimaryProposal(tx, proposalRef, uid);

    if (proposal.status === 'submitted') {
      return { alreadySubmitted: true };
    }
    if (proposal.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" can no longer be submitted.`,
      );
    }

    const pendingInvitations = await tx.get(
      proposalRef.collection('speakerInvitations').where('status', '==', 'pending').limit(1),
    );
    if (!pendingInvitations.empty) {
      throw new HttpsError(
        'failed-precondition',
        'Resolve every pending co-speaker invitation before submitting.',
      );
    }

    const speakerIds = proposalSpeakerIds(proposal);
    if (speakerIds.length === 0 || !speakerIds.includes(uid)) {
      throw new HttpsError('failed-precondition', 'This proposal has no lead speaker.');
    }
    const perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
    const speakerRefs = speakerIds.map((speakerId) => db.doc(`speakers/${speakerId}`));
    const participantRefs = perSpeakerLifecycle
      ? speakerIds.map((speakerId) =>
          speakerParticipantRef(db, cfpId, proposalId, speakerId),
        )
      : [];
    const relatedSnaps = await tx.getAll(...speakerRefs, ...participantRefs);
    const speakerSnaps = relatedSnaps.slice(0, speakerRefs.length);
    const participantSnaps = relatedSnaps.slice(speakerRefs.length);
    if (speakerSnaps.some((speaker) => !speaker.exists)) {
      throw new HttpsError(
        'failed-precondition',
        'Every co-speaker must complete their speaker profile before submission.',
      );
    }
    const speakerByUid = new Map(
      speakerSnaps.map((speaker, index) => [speakerIds[index], speaker.data()!]),
    );
    const participationByUid = new Map(
      participantSnaps.map((participant, index) => [
        speakerIds[index],
        participant.exists ? participant.data()! : undefined,
      ]),
    );
    const primaryProfile = speakerByUid.get(uid)!;
    const incompleteCoSpeaker = speakerIds.some(
      (speakerId) => !speakerSchema.safeParse(assemble(proposal, speakerByUid.get(speakerId)!).speaker).success,
    );
    if (incompleteCoSpeaker) {
      throw new HttpsError(
        'failed-precondition',
        'Every co-speaker must complete their speaker profile before submission.',
      );
    }

    // Drafts are uncapped — reviewers never see them. What is capped is how many
    // a speaker can put in front of the committee. Counted in memory rather than
    // with a `status in` clause, which would need a composite index for a
    // handful of documents.
    const existingBySpeaker = await Promise.all(
      speakerIds.map((speakerId) =>
        tx.get(
          db
            .collection(`cfps/${cfpId}/proposals`)
            .where('speakerIds', 'array-contains', speakerId),
        ),
      ),
    );
    const overLimit = existingBySpeaker.findIndex(
      (mine) =>
        mine.docs.filter((document) => inStatusSet('live', document.data().status)).length >=
        LIMITS.maxTalksPerSpeaker,
    );
    if (overLimit >= 0) {
      throw new HttpsError(
        'resource-exhausted',
        overLimit === 0
          ? `You have already submitted ${LIMITS.maxTalksPerSpeaker} talks.`
          : `A co-speaker has already submitted ${LIMITS.maxTalksPerSpeaker} talks.`,
      );
    }

    // The authoritative pass; the browser's copy only renders inline errors.
    // Against this call's own form, not against a taxonomy compiled into the
    // bundle — that is the whole point of the config being data.
    const parsed = submissionSchema(shape).safeParse(
      assemble(proposal, primaryProfile, participationByUid.get(uid), perSpeakerLifecycle),
    );
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'The proposal is incomplete.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    for (const speakerId of speakerIds) {
      if (speakerId === uid) continue;
      const coSpeaker = submissionSchema(shape).safeParse(
        assemble(
          proposal,
          speakerByUid.get(speakerId)!,
          participationByUid.get(speakerId),
          perSpeakerLifecycle,
        ),
      );
      if (!coSpeaker.success) {
        throw new HttpsError(
          'failed-precondition',
          'Every co-speaker must complete their acknowledgements and attendance details before submission.',
          {
            speakerUid: speakerId,
            issues: coSpeaker.error.issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          },
        );
      }
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
    const contexts = await speakerEmailContexts(tx, cfpId, proposalId, proposal);
    await queueEmails(
      db,
      tx,
      cfpId,
      contexts.map((context) => ({
        kind: 'submission_received',
        proposalId,
        recipientUid: context.uid,
        ...(context.primary ? {} : { logIdSuffix: context.uid }),
        to: context.to,
        locale: context.locale,
        data: context.data,
      })),
    );

    tx.update(proposalRef, {
      status: 'submitted',
      // What the committee will read, frozen now. The profile belongs to the
      // account and is global; this is the only copy of it this CFP gets, so a
      // bio rewritten years later cannot rewrite what was judged.
      speakerSnapshot: speakerIds.map((speakerId) =>
        snapshotOf(speakerId, speakerByUid.get(speakerId)!),
      ),
      // Only what the form still asks for, which is what `clean` is.
      answers: clean,
      ...(perSpeakerLifecycle
        ? { acks: FieldValue.delete(), attendance: FieldValue.delete() }
        : {}),
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { alreadySubmitted: false };
  });

  logger.info('proposal submitted', { proposalId, uid, ...result });
  return { ok: true, proposalId, ...result };
});

export const notifyCommitteeOnProposalSubmitted = onDocumentWritten(
  {
    document: 'cfps/{cfpId}/proposals/{proposalId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    if (
      event.data?.before.get('status') !== 'draft' ||
      event.data?.after.get('status') !== 'submitted'
    ) {
      return;
    }
    const proposal = event.data.after.data()!;
    const speakerIds = proposalSpeakerIds(proposal);
    const formerSpeakerIds = Array.isArray(proposal.formerSpeakerIds)
      ? proposal.formerSpeakerIds.filter(
          (candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate),
        )
      : [];
    const notified = await queueStaffNotifications(
      event.params.cfpId,
      'committee_proposal_submitted',
      event.params.proposalId,
      [...new Set([...speakerIds, ...formerSpeakerIds])],
    );
    logger.info('committee proposal notifications queued', {
      cfpId: event.params.cfpId,
      proposalId: event.params.proposalId,
      notified,
    });
  },
);

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
    const proposal = await readPrimaryProposal(tx, proposalRef, uid);
    if (!inStatusSet('withdrawable', proposal.status)) {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" cannot be withdrawn.`,
      );
    }
    const contexts = await speakerEmailContexts(tx, cfpId, proposalId, proposal);
    await queueEmails(
      db,
      tx,
      cfpId,
      contexts.map((context) => ({
        kind: 'withdrawn',
        proposalId,
        recipientUid: context.uid,
        ...(context.primary ? {} : { logIdSuffix: context.uid }),
        to: context.to,
        locale: context.locale,
        data: context.data,
      })),
    );

    tx.update(proposalRef, {
      status: 'withdrawn',
      // A withdrawn talk must not keep serving a score while the aggregate
      // refresh trigger catches up.
      aggregate: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('proposal withdrawn', { proposalId, uid });
  return { ok: true };
});

/**
 * Deletes writing that was never submitted to the committee.
 *
 * Once a proposal has any submission or review history it is an audit record,
 * so withdrawal — not deletion — is the only supported operation. Every
 * precondition is read in the same transaction as the delete so a concurrent
 * archive, submit, review or email write cannot slip through.
 */
export const deleteDraftProposal = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireUid(request, 'delete a draft');
  const proposalId = requireProposalId(request.data);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    const proposal = await readPrimaryProposal(tx, proposalRef, uid);

    if (proposal.status !== 'draft') {
      throw new HttpsError('failed-precondition', 'Only an unsubmitted draft can be deleted.');
    }

    const hasSubmissionHistory = ['submittedAt', 'speakerSnapshot', 'aggregate'].some((key) =>
      Object.prototype.hasOwnProperty.call(proposal, key),
    );
    if (hasSubmissionHistory) {
      throw new HttpsError(
        'failed-precondition',
        'This draft has submission history and cannot be deleted.',
      );
    }

    const childLimit = 100;
    const [reviews, emailHistory, invitations, participants, confirmations] = await Promise.all([
      tx.get(proposalRef.collection('reviews').limit(1)),
      tx.get(
        db
          .collection(`cfps/${cfpId}/emailLog`)
          .where('proposalId', '==', proposalId)
          .limit(25),
      ),
      tx.get(proposalRef.collection('speakerInvitations').limit(childLimit)),
      tx.get(proposalRef.collection('speakerParticipants').limit(childLimit)),
      tx.get(proposalRef.collection('speakerConfirmations').limit(childLimit)),
    ]);
    const nonInvitationEmail = emailHistory.docs.some(
      (email) => !isCoSpeakerInvitationEmail(email.get('kind')),
    );
    const invitationSending = emailHistory.docs.some(
      (email) =>
        isCoSpeakerInvitationEmail(email.get('kind')) &&
        email.get('status') === 'sending' &&
        !sendingLeaseExpired(email.get('sendingStartedAt') ?? email.updateTime),
    );
    if (!reviews.empty || nonInvitationEmail || invitationSending || emailHistory.size === 25) {
      throw new HttpsError(
        invitationSending ? 'unavailable' : 'failed-precondition',
        invitationSending
          ? 'A co-speaker invitation is still being delivered. Try again shortly.'
          : 'This draft has committee or email history and cannot be deleted.',
      );
    }
    if (
      invitations.size === childLimit ||
      participants.size === childLimit ||
      confirmations.size === childLimit
    ) {
      throw new HttpsError(
        'failed-precondition',
        'This draft has too much speaker history to delete safely.',
      );
    }

    for (const child of [
      ...invitations.docs,
      ...participants.docs,
      ...confirmations.docs,
    ]) {
      tx.delete(child.ref);
    }
    for (const invitationEmail of emailHistory.docs) {
      if (invitationEmail.get('status') === 'sent') continue;
      tx.update(invitationEmail.ref, {
        status: 'failed',
        error: 'This notification is superseded because the draft was deleted.',
        sendingClaimId: FieldValue.delete(),
        sendingStartedAt: FieldValue.delete(),
        providerAttemptId: FieldValue.delete(),
      });
    }
    tx.delete(proposalRef);
  });

  logger.info('draft proposal deleted', { cfpId, proposalId, uid });
  return { ok: true, proposalId };
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
async function loadConfirmForm(cfpId: string): Promise<ConfirmForm> {
  const snap = await db.doc(`cfps/${cfpId}/config/confirmForm`).get();
  return confirmFormFrom(snap);
}

function confirmFormFrom(snap: DocumentSnapshot): ConfirmForm {
  const fields = snap.data()?.fields;
  return Array.isArray(fields) ? ({ fields } as ConfirmForm) : EMPTY_FORM;
}

function assertDecisionCanBeAnswered(proposal: FirebaseFirestore.DocumentData): void {
  if (!inStatusSet('speakerResponse', proposal.status) && proposal.status !== 'accepted') {
    throw new HttpsError(
      'failed-precondition',
      `A proposal with status "${proposal.status}" has no decision to answer.`,
    );
  }
}

function assertWorkingHeadshotAccess(
  proposal: FirebaseFirestore.DocumentData,
  form: ConfirmForm,
  key: string,
): void {
  // A declined speaker can change their answer back to confirmed from this
  // same screen, and therefore has to be able to replace a required photo
  // before `respondToDecision` moves the status again.
  if (!['accepted', 'confirmed', 'declined'].includes(String(proposal.status ?? ''))) {
    throw new HttpsError(
      'failed-precondition',
      'A headshot can only be uploaded while answering an acceptance.',
    );
  }
  if (!form.fields.some((field) => field.key === key && field.type === 'image')) {
    throw new HttpsError('invalid-argument', 'That image question is not on the current form.');
  }
}

/**
 * Writes one replaceable confirmation photo through the same per-CFP lane as
 * archive and deletion. Browser Storage writes cannot participate in that
 * fence, so they stay closed in `storage.rules`.
 */
export const uploadHeadshot = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireVerifiedUid(request, 'upload a headshot');
  const proposalId = requireProposalId(request.data);
  const data = (request.data ?? {}) as {
    key?: unknown;
    contentType?: unknown;
    base64?: unknown;
  };
  const key = typeof data.key === 'string' ? data.key : '';
  if (!key) throw new HttpsError('invalid-argument', 'key is required.');
  const upload = await decodeHeadshotUpload(data.contentType, data.base64);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, uid);
  const readValidProposal = async (tx: FirebaseFirestore.Transaction) => {
    const [proposal, form, confirmation] = await tx.getAll(
      proposalRef,
      formRef,
      confirmationRef,
    );
    if (!proposal.exists || !((proposal.get('speakerIds') ?? []) as unknown[]).includes(uid)) {
      throw new HttpsError('not-found', 'Proposal not found.');
    }
    assertWorkingHeadshotAccess(proposal.data()!, confirmFormFrom(form), key);
    return { proposal, confirmation };
  };

  let perSpeakerLifecycle = false;
  const leaseId = await acquireCfpMutation(cfpId, 'speaker-headshot-upload', async (tx) => {
    const { proposal } = await readValidProposal(tx);
    perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal.data()!);
  });
  const path = perSpeakerLifecycle
    ? speakerWorkingHeadshotPath(cfpId, proposalId, uid, key, leaseId)
    : workingHeadshotPath(cfpId, proposalId, key, leaseId);
  const file = getStorage().bucket().file(path);
  let pointer: HeadshotUploadPointer | undefined;

  try {
    await file.save(upload.bytes, {
      resumable: false,
      metadata: {
        contentType: upload.contentType,
        cacheControl: 'private, no-store',
      },
    });
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation ?? '');
    if (!generation) {
      throw new HttpsError('failed-precondition', 'The uploaded photo has no stable version.');
    }
    pointer = {
      path,
      generation,
      contentType: upload.contentType,
      size: upload.bytes.length,
    };
    // Admins may change the decision or confirmation form without touching
    // Storage. Recheck both, then atomically make this unique object current.
    await finishCfpMutation(cfpId, leaseId, async (tx) => {
      const { proposal, confirmation } = await readValidProposal(tx);
      const current = perSpeakerLifecycle
        ? confirmation.get('headshotUploads')
        : proposal.get('headshotUploads');
      const uploads: HeadshotUploads =
        current && typeof current === 'object' && !Array.isArray(current)
          ? (current as HeadshotUploads)
          : {};
      if (perSpeakerLifecycle) {
        tx.set(
          confirmationRef,
          {
            cfpId,
            proposalId,
            uid,
            headshotUploads: { ...uploads, [key]: pointer },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        tx.update(proposalRef, {
          headshotUploads: { ...uploads, [key]: pointer },
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (error) {
    if (pointer) {
      try {
        const current = perSpeakerLifecycle
          ? await confirmationRef.get()
          : await proposalRef.get();
        const committed =
          current.exists &&
          (perSpeakerLifecycle
            ? speakerWorkingHeadshotMatches(
                current.get('headshotUploads'),
                cfpId,
                proposalId,
                uid,
                key,
                pointer,
              )
            : workingHeadshotMatches(
                current.get('headshotUploads'),
                cfpId,
                proposalId,
                key,
                pointer,
              ));
        if (committed) {
          logger.warn('headshot upload recovered after an ambiguous commit response', {
            cfpId,
            proposalId,
            uid,
            key,
          });
          return { ok: true, path };
        }
      } catch (verificationError) {
        // The pointer transaction may have committed. Never delete a possibly
        // referenced object merely because its response or verification was
        // unavailable; an unreferenced unique object is cleared with the CFP.
        logger.error('headshot upload commit could not be verified', {
          cfpId,
          proposalId,
          uid,
          error: String(verificationError),
        });
        throw new HttpsError('unavailable', 'The photo upload could not be settled. Try again.');
      }
    }
    try {
      // Unique staging means a failed attempt never touches the previous
      // pointer or its object; cleanup can only remove this attempt.
      await file.delete({ ignoreNotFound: true });
    } catch (cleanupError) {
      // Keep the lease until expiry. Archive and deletion stay fenced while a
      // possibly committed upload is ambiguous, and their later bucket clear
      // remains the final backstop.
      logger.error('headshot upload cleanup failed', {
        cfpId,
        proposalId,
        uid,
        error: String(cleanupError),
      });
      throw new HttpsError('unavailable', 'The photo upload could not be settled. Try again.');
    }
    await releaseCfpMutationQuietly(cfpId, leaseId);
    if (error instanceof HttpsError) throw error;
    logger.error('headshot upload failed', { cfpId, proposalId, uid, error: String(error) });
    throw new HttpsError('unavailable', 'The photo could not be uploaded. Try again.');
  }

  logger.info('headshot uploaded', { cfpId, proposalId, uid, key });
  return { ok: true, path };
});

export const respondToDecision = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireUid(request, 'answer a decision');
  const proposalId = requireProposalId(request.data);
  const data = (request.data ?? {}) as { response?: unknown; answers?: unknown };
  const response = String(data.response ?? '');

  if (response !== 'confirm' && response !== 'decline') {
    throw new HttpsError('invalid-argument', 'Answer must be "confirm" or "decline".');
  }
  const speakerResponse = response === 'confirm' ? 'confirmed' : 'declined';
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, uid);

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
  let leaseId: string | undefined;
  let uploadPaths: Record<string, string> = {};
  let frozenUploads: Record<string, string> = {};
  let perSpeakerLifecycle = false;
  if (speakerResponse === 'confirmed') {
    leaseId = await acquireCfpMutation(cfpId, 'speaker-confirmation', async (tx) => {
      const proposal = await readOwnProposal(tx, proposalRef, uid);
      assertDecisionCanBeAnswered(proposal);
      perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
    });
    try {
      const form = await loadConfirmForm(cfpId);
      const bucket = getStorage().bucket();
      const [currentProposal, currentConfirmation] = await Promise.all([
        proposalRef.get(),
        confirmationRef.get(),
      ]);
      const uploads = perSpeakerLifecycle
        ? await findSpeakerUploadedHeadshots(
            bucket,
            cfpId,
            proposalId,
            form,
            uid,
            currentConfirmation.get('headshotUploads'),
          )
        : await findUploadedHeadshots(
            bucket,
            cfpId,
            proposalId,
            form,
            uid,
            currentProposal.get('headshotUploads'),
          );
      uploadPaths = Object.fromEntries(
        Object.entries(uploads).map(([key, upload]) => [key, upload.path]),
      );
      const checked = validateAnswers(form, (data.answers ?? {}) as Answers, uploadPaths);
      if (Object.keys(checked.faults).length > 0) {
        throw new HttpsError('invalid-argument', 'Some answers need fixing.', checked.faults);
      }
      frozenUploads = perSpeakerLifecycle
        ? await freezeSpeakerUploadedHeadshots(bucket, cfpId, proposalId, uid, uploads)
        : await freezeUploadedHeadshots(bucket, cfpId, proposalId, uploads);
      answers = { ...checked.clean, ...frozenUploads };
    } catch (error) {
      await releaseCfpMutationQuietly(cfpId, leaseId);
      throw error;
    }
  }

  let finalStatus = speakerResponse;
  try {
    const finish = async (tx: FirebaseFirestore.Transaction) => {
      const proposal = await readOwnProposal(tx, proposalRef, uid);
      // `confirmed` is allowed so re-clicking a mailed link is a no-op rather
      // than an error the speaker has to interpret.
      assertDecisionCanBeAnswered(proposal);
      const currentPerSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
      if (leaseId && currentPerSpeakerLifecycle !== perSpeakerLifecycle) {
        throw new HttpsError(
          'aborted',
          'The speaker roster changed while the answer was being saved. Try again.',
        );
      }

      const speakerIds = proposalSpeakerIds(proposal);
      const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
      const configRef = scheduleConfigRef(cfpId);
      const confirmationRefs = currentPerSpeakerLifecycle
        ? speakerIds.map((speakerId) =>
            speakerConfirmationRef(db, cfpId, proposalId, speakerId),
          )
        : [];
      const [latestFormSnap, scheduleConfig, ...confirmationSnaps] = await tx.getAll(
        formRef,
        configRef,
        ...confirmationRefs,
      );

      if (speakerResponse === 'confirmed') {
        const latestForm = confirmFormFrom(latestFormSnap);
        const checked = validateAnswers(
          latestForm,
          (data.answers ?? {}) as Answers,
          uploadPaths,
        );
        if (Object.keys(checked.faults).length > 0) {
          throw new HttpsError('invalid-argument', 'Some answers need fixing.', checked.faults);
        }
        answers = { ...checked.clean };
        for (const [key, path] of Object.entries(frozenUploads)) {
          if (Object.prototype.hasOwnProperty.call(answers, key)) answers[key] = path;
        }
      }

      if (!currentPerSpeakerLifecycle) {
        finalStatus = speakerResponse;
        tx.update(proposalRef, {
          status: finalStatus,
          confirmedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          // Replaced wholesale, not merged: confirming again is how a speaker
          // corrects an answer, and a merge would leave the old one behind.
          ...(speakerResponse === 'confirmed' ? { confirmAnswers: answers } : {}),
        });
        return;
      }

      const confirmations = new Map<string, FirebaseFirestore.DocumentData | undefined>(
        confirmationSnaps.map((snap, index) => [speakerIds[index], snap.data()]),
      );
      confirmations.set(uid, { response: speakerResponse });
      const primaryUid = primarySpeakerId(proposal);
      const primaryResponse = confirmationResponse(confirmations.get(primaryUid));
      finalStatus =
        primaryResponse === 'declined'
          ? 'declined'
          : everySpeakerConfirmed(speakerIds, confirmations)
            ? 'confirmed'
            : 'accepted';

      tx.set(
        confirmationRef,
        {
          cfpId,
          proposalId,
          uid,
          response: speakerResponse,
          answers: speakerResponse === 'confirmed' ? answers : {},
          respondedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...(speakerResponse === 'confirmed'
            ? { confirmedAt: FieldValue.serverTimestamp() }
            : { confirmedAt: FieldValue.delete() }),
        },
        { merge: true },
      );
      tx.update(proposalRef, {
        status: finalStatus,
        updatedAt: FieldValue.serverTimestamp(),
        ...(finalStatus === 'confirmed'
          ? { confirmedAt: FieldValue.serverTimestamp() }
          : { confirmedAt: FieldValue.delete() }),
      });
      if (speakerResponse === 'declined' && uid !== primaryUid && scheduleConfig.exists) {
        tx.set(
          configRef,
          { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    };

    if (leaseId) {
      await finishCfpMutation(cfpId, leaseId, finish);
    } else {
      await db.runTransaction(async (tx) => {
        await assertCfpNotArchived(tx, cfpId);
        await finish(tx);
      });
    }
  } catch (error) {
    if (leaseId) await releaseCfpMutationQuietly(cfpId, leaseId);
    throw error;
  }

  logger.info('decision answered', {
    proposalId,
    uid,
    response: speakerResponse,
    status: finalStatus,
  });
  return { ok: true, status: finalStatus, response: speakerResponse };
});

async function readHeadshotBytes(
  path: string,
  generation?: string,
): Promise<{ contentType: string; base64: string }> {
  const stored = await readStoredHeadshot(getStorage().bucket(), path, generation);
  if (!stored) throw new HttpsError('not-found', 'No headshot for that speaker.');
  return { contentType: stored.contentType, base64: stored.bytes.toString('base64') };
}

/**
 * Reads either a speaker's current working upload or an organiser's immutable
 * confirmed answer. Both paths return bytes inline, without a public download
 * token; the explicit `working: true` branch derives its path from the
 * server-written proposal pointer and never accepts one from the browser.
 */
export const headshotImage = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const proposalId = requireProposalId(request.data);
  const data = (request.data ?? {}) as {
    key?: unknown;
    working?: unknown;
    speakerUid?: unknown;
  };
  const key = String(data.key ?? '');
  if (!key) {
    throw new HttpsError('invalid-argument', 'proposalId and key are required.');
  }
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);

  if (data.working === true) {
    const uid = requireVerifiedUid(request, 'view a working headshot');
    const pointer = await db.runTransaction(async (tx) => {
      const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, uid);
      const [cfp, proposal, form, confirmation] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        proposalRef,
        db.doc(`cfps/${cfpId}/config/confirmForm`),
        confirmationRef,
      );
      if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
      if (cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
      }
      if (!proposal.exists || !((proposal.get('speakerIds') ?? []) as unknown[]).includes(uid)) {
        throw new HttpsError('not-found', 'Proposal not found.');
      }
      assertWorkingHeadshotAccess(proposal.data()!, confirmFormFrom(form), key);
      const perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal.data()!);
      const uploads = perSpeakerLifecycle
        ? confirmation.get('headshotUploads')
        : proposal.get('headshotUploads');
      const current = perSpeakerLifecycle
        ? speakerWorkingHeadshotFrom(uploads, cfpId, proposalId, uid, key)
        : workingHeadshotFrom(uploads, cfpId, proposalId, key);
      if (current) return current;
      if (
        uploads &&
        typeof uploads === 'object' &&
        !Array.isArray(uploads) &&
        Object.prototype.hasOwnProperty.call(uploads, key)
      ) {
        throw new HttpsError('failed-precondition', 'The saved photo pointer is invalid.');
      }
      if (perSpeakerLifecycle) {
        throw new HttpsError('not-found', 'No headshot for that speaker.');
      }
      // Calls created before pointer-backed uploads keep their canonical live
      // object until the speaker replaces it once through the new callable.
      return { path: headshotPath(cfpId, uid, key), generation: undefined };
    });
    const image = await readHeadshotBytes(pointer.path, pointer.generation);
    return { ok: true, ...image };
  }

  const byUid = await requireAdmin(request, cfpId, 'view a headshot');

  const proposal = await proposalRef.get();
  if (!proposal.exists) throw new HttpsError('not-found', 'No such proposal.');
  const proposalData = proposal.data()!;
  const speakerIds = proposalSpeakerIds(proposalData);
  const perSpeakerLifecycle = usesPerSpeakerLifecycle(proposalData);
  const requestedUid = typeof data.speakerUid === 'string' ? data.speakerUid : '';
  const targetUid = requestedUid || primarySpeakerId(proposalData);
  if (!targetUid || !speakerIds.includes(targetUid)) {
    throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
  }
  if (perSpeakerLifecycle) {
    const confirmation = await speakerConfirmationRef(
      db,
      cfpId,
      proposalId,
      targetUid,
    ).get();
    const answers = confirmation.get('answers');
    const path =
      answers && typeof answers === 'object' && !Array.isArray(answers)
        ? (answers as Record<string, unknown>)[key]
        : undefined;
    if (
      typeof path !== 'string' ||
      !isSpeakerConfirmedHeadshotPath(path, cfpId, proposalId, targetUid, key)
    ) {
      throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
    }
    const image = await readHeadshotBytes(path);
    return { ok: true, dataUrl: `data:${image.contentType};base64,${image.base64}` };
  }

  const answers = proposal.get('confirmAnswers');
  const path =
    answers && typeof answers === 'object' && !Array.isArray(answers)
      ? (answers as Record<string, unknown>)[key]
      : undefined;
  const isLegacyPath =
    typeof path === 'string' &&
    speakerIds.some((uid) =>
      path === headshotPath(cfpId, uid, key),
    );
  if (
    typeof path !== 'string' ||
    (!isConfirmedHeadshotPath(path, cfpId, proposalId, key) && !isLegacyPath)
  ) {
    throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
  }
  let imagePath = path;

  if (isLegacyPath) {
    const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
    const leaseId = await acquireCfpMutation(
      cfpId,
      'legacy-headshot-read',
      async (tx) => assertMutationActor(await tx.get(memberRef), 'admin'),
      { allowArchived: true },
    );
    try {
      // Re-read after acquiring the lane. Another organiser may have completed
      // the migration between the first read and this reservation.
      const current = await proposal.ref.get();
      const currentAnswers = current.get('confirmAnswers');
      const currentPath =
        currentAnswers && typeof currentAnswers === 'object' && !Array.isArray(currentAnswers)
          ? (currentAnswers as Record<string, unknown>)[key]
          : undefined;
      const currentSpeakerIds = current.get('speakerIds');
      const currentIsLegacy =
        typeof currentPath === 'string' &&
        Array.isArray(currentSpeakerIds) &&
        currentSpeakerIds.some((uid) =>
          typeof uid === 'string' ? currentPath === headshotPath(cfpId, uid, key) : false,
        );
      if (
        typeof currentPath === 'string' &&
        isConfirmedHeadshotPath(currentPath, cfpId, proposalId, key)
      ) {
        imagePath = currentPath;
      } else if (currentIsLegacy) {
        imagePath = await freezeLegacyHeadshotAnswer(
          db,
          getStorage().bucket(),
          cfpId,
          proposal.ref,
          key,
          currentPath as string,
        );
      } else {
        throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
      }
      await finishCfpMutation(
        cfpId,
        leaseId,
        async (tx) => assertMutationActor(await tx.get(memberRef), 'admin'),
        { allowArchived: true },
      );
      if (!isConfirmedHeadshotPath(imagePath, cfpId, proposalId, key)) {
        throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
      }
    } catch (error) {
      await releaseCfpMutationQuietly(cfpId, leaseId);
      throw error;
    }
  }

  const image = await readHeadshotBytes(imagePath);
  return { ok: true, dataUrl: `data:${image.contentType};base64,${image.base64}` };
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

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    tx.set(db.doc(`cfps/${cfpId}/config/confirmForm`), form);
  });
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

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    const formRef = db.doc(`cfps/${cfpId}/config/submissionForm`);
    const scheduleRef = db.doc(`cfps/${cfpId}/config/schedule`);
    const [currentForm, schedule] = await tx.getAll(formRef, scheduleRef);
    const taxonomyChanged =
      scheduleTaxonomyFingerprint(scheduleFormFrom(currentForm)) !==
      scheduleTaxonomyFingerprint(form);
    tx.set(formRef, form);
    if (schedule.exists && taxonomyChanged) {
      tx.set(
        scheduleRef,
        { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
  });
  logger.info('submission form saved', {
    byUid,
    cfpId,
    acks: form.acks.length,
    fields: form.fields.length,
  });
  return { ok: true, form };
});

const REVIEW_QUEUE_STATUSES = ['submitted', 'under_review'] as const;
const AGGREGATE_REVISION_FIELD = '_aggregateRevision';
const AGGREGATE_CHUNK = 400;

const isKnownScore = (score: unknown): score is number =>
  (SCORES as readonly unknown[]).includes(score);

const aggregateScorable = (status: unknown): boolean =>
  typeof status === 'string' &&
  (PROPOSAL_STATUSES as readonly string[]).includes(status) &&
  status !== 'draft' &&
  status !== 'withdrawn';

export const saveReview = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const reviewerUid = requireVerifiedUid(request, 'save a review');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const proposalId = requireProposalId(data);
  const score = data.score;
  const conflictOfInterest = data.conflictOfInterest;
  const comment = data.comment === undefined ? '' : data.comment;
  if (!isKnownScore(score)) {
    throw new HttpsError('invalid-argument', 'Score must be between 1 and 4.');
  }
  if (typeof conflictOfInterest !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Conflict of interest must be true or false.');
  }
  if (typeof comment !== 'string' || comment.length > LIMITS.reviewCommentMax) {
    throw new HttpsError('invalid-argument', 'That review comment is too long.');
  }

  const status = await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const memberRef = db.doc(`cfps/${cfpId}/members/${reviewerUid}`);
    const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
    const participantRef = speakerParticipantRef(db, cfpId, proposalId, reviewerUid);
    const [cfp, member, proposal, participant] = await tx.getAll(
      cfpRef,
      memberRef,
      proposalRef,
      participantRef,
    );
    if (!cfp.exists || !proposal.exists) {
      throw new HttpsError('not-found', 'No such proposal.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!staffMemberIsActive(member.data(), cfpId, reviewerUid)) {
      throw new HttpsError('permission-denied', 'Only an active reviewer can save a review.');
    }
    if (
      participant.exists ||
      ((proposal.get('speakerIds') ?? []) as string[]).includes(reviewerUid) ||
      ((proposal.get('formerSpeakerIds') ?? []) as string[]).includes(reviewerUid)
    ) {
      throw new HttpsError('permission-denied', 'You cannot review your own proposal.');
    }
    const current = String(proposal.get('status') ?? '');
    if (!(REVIEW_QUEUE_STATUSES as readonly string[]).includes(current)) {
      throw new HttpsError('failed-precondition', 'That proposal cannot be reviewed.');
    }

    const trimmed = comment.trim();
    tx.set(proposalRef.collection('reviews').doc(reviewerUid), {
      cfpId,
      score,
      conflictOfInterest,
      ...(trimmed ? { comment: trimmed } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (current === 'submitted') {
      tx.update(proposalRef, {
        status: 'under_review',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return 'under_review';
    }
    return current;
  });

  logger.info('review saved', { cfpId, proposalId, reviewerUid, status });
  return { ok: true, proposalId, status };
});

/**
 * The current review policy is deliberately explicit: every active role-holder
 * sees every in-round proposal they do not speak on. There is no assignment
 * document yet, so a report that implied partitioned panels would manufacture
 * obligations the data model cannot represent.
 *
 * Only completion metadata leaves this callable. Scores and comments do not,
 * and an admin who is also a speaker gets no coverage metadata at all for their
 * own proposal — the same privacy boundary enforced by Firestore rules.
 */
export const reviewCoverage = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const requesterUid = await requireAdmin(request, cfpId, 'view review coverage');

  const [members, proposalSnaps, reviewSnaps] = await Promise.all([
    db.collection(`cfps/${cfpId}/members`).get(),
    db
      .collection(`cfps/${cfpId}/proposals`)
      .where('status', 'in', [...REVIEW_QUEUE_STATUSES])
      .get(),
    db.collectionGroup('reviews').where('cfpId', '==', cfpId).get(),
  ]);

  const current = proposalSnaps.docs.map((proposal) => ({
    id: proposal.id,
    title: String(proposal.get('title') ?? ''),
    speakerIds: ((proposal.get('speakerIds') as unknown[]) ?? []).filter(
      (uid): uid is string => typeof uid === 'string',
    ),
    formerSpeakerIds: ((proposal.get('formerSpeakerIds') as unknown[]) ?? []).filter(
      (uid): uid is string => typeof uid === 'string',
    ),
  }));
  const hiddenOwnProposalCount = current.filter((proposal) =>
    [...proposal.speakerIds, ...proposal.formerSpeakerIds].includes(requesterUid),
  ).length;
  const visible = current
    .filter(
      (proposal) =>
        ![...proposal.speakerIds, ...proposal.formerSpeakerIds].includes(requesterUid),
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const visibleIds = new Set(visible.map((proposal) => proposal.id));
  const activeReviewerIds = new Set(members.docs.map((member) => member.id));

  const reviewByPair = new Map<
    string,
    { score: unknown; conflictOfInterest: boolean }
  >();
  for (const review of reviewSnaps.docs) {
    const proposalId = review.ref.parent.parent?.id;
    if (!proposalId || !visibleIds.has(proposalId) || !activeReviewerIds.has(review.id)) continue;
    reviewByPair.set(`${proposalId}:${review.id}`, {
      score: review.get('score'),
      conflictOfInterest: review.get('conflictOfInterest') === true,
    });
  }

  const reviewers = members.docs
    .map((member) => {
      const data = member.data();
      const eligible = visible.filter(
        (proposal) =>
          ![...proposal.speakerIds, ...proposal.formerSpeakerIds].includes(member.id),
      );
      const scoredProposalIds: string[] = [];
      const conflictProposalIds: string[] = [];
      const missingProposalIds: string[] = [];

      for (const proposal of eligible) {
        const review = reviewByPair.get(`${proposal.id}:${member.id}`);
        if (!review) {
          missingProposalIds.push(proposal.id);
        } else if (review.conflictOfInterest) {
          conflictProposalIds.push(proposal.id);
        } else if (isKnownScore(review.score)) {
          scoredProposalIds.push(proposal.id);
        } else {
          // A malformed historic row is not evidence that a valid score landed.
          missingProposalIds.push(proposal.id);
        }
      }

      return {
        uid: member.id,
        name: String(data.name ?? ''),
        email: String(data.email ?? ''),
        role: data.role as CfpRole,
        eligibleCount: eligible.length,
        scoredProposalIds,
        conflictProposalIds,
        missingProposalIds,
      };
    })
    .sort(
      (a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email) || a.uid.localeCompare(b.uid),
    );

  return {
    ok: true,
    hiddenOwnProposalCount,
    proposals: visible.map(({ id, title }) => ({ id, title })),
    reviewers,
  };
});

interface AggregateRefresh {
  reviewCount: number;
  proposalCount: number;
  writes: number;
  superseded: boolean;
  archived: boolean;
}

/** A monotonic fence: an older refresh may never commit after a newer one starts. */
async function reserveAggregateRevision(
  cfpId: string,
): Promise<{ revision: number | null; archived: boolean }> {
  const cfpRef = db.doc(`cfps/${cfpId}`);
  return db.runTransaction(async (tx) => {
    const cfp = await tx.get(cfpRef);
    if (!cfp.exists) return { revision: null, archived: false };
    if (cfp.get('archived') === true) return { revision: null, archived: true };
    const stored = cfp.get(AGGREGATE_REVISION_FIELD);
    const current = typeof stored === 'number' && Number.isSafeInteger(stored) ? stored : 0;
    const revision = current + 1;
    tx.update(cfpRef, { [AGGREGATE_REVISION_FIELD]: revision });
    return { revision, archived: false };
  });
}

function sameAggregate(current: unknown, desired: Aggregate): boolean {
  if (!current || typeof current !== 'object') return false;
  const value = current as Record<string, unknown>;
  return (
    value.avgScore === desired.avgScore &&
    value.normalizedScore === desired.normalizedScore &&
    value.reviewCount === desired.reviewCount &&
    value.stdDev === desired.stdDev &&
    Object.keys(value).length === 4
  );
}

/**
 * Recomputes the complete CFP because one review changes that reviewer's
 * calibration, which can move every proposal they scored. Each write chunk
 * checks the revision fence transactionally. If a newer event starts, the old
 * run stops; it cannot land stale values after the new run.
 */
async function refreshAggregates(cfpId: string): Promise<AggregateRefresh> {
  const reservation = await reserveAggregateRevision(cfpId);
  const { revision } = reservation;
  if (revision === null) {
    return {
      reviewCount: 0,
      proposalCount: 0,
      writes: 0,
      superseded: false,
      archived: reservation.archived,
    };
  }

  const [proposalSnaps, reviewSnaps] = await Promise.all([
    db.collection(`cfps/${cfpId}/proposals`).get(),
    db.collectionGroup('reviews').where('cfpId', '==', cfpId).get(),
  ]);
  const scorableIds = new Set(
    proposalSnaps.docs
      .filter((proposal) => aggregateScorable(proposal.get('status')))
      .map((proposal) => proposal.id),
  );
  const reviews = reviewSnaps.docs.flatMap<ReviewRecord>((review) => {
    const proposalId = review.ref.parent.parent?.id ?? '';
    const score = review.get('score') as unknown;
    if (!scorableIds.has(proposalId) || !isKnownScore(score)) return [];
    return [
      {
        proposalId,
        reviewerUid: review.id,
        score,
        conflictOfInterest: review.get('conflictOfInterest') === true,
      },
    ];
  });
  const aggregates = aggregateReviews(reviews);

  const candidates = proposalSnaps.docs.filter((proposal) => {
    const desired = aggregates.get(proposal.id);
    const current = proposal.get('aggregate') as unknown;
    return desired
      ? !sameAggregate(current, desired)
      : Object.prototype.hasOwnProperty.call(proposal.data(), 'aggregate');
  });

  let writes = 0;
  const cfpRef = db.doc(`cfps/${cfpId}`);
  for (let i = 0; i < candidates.length; i += AGGREGATE_CHUNK) {
    const chunk = candidates.slice(i, i + AGGREGATE_CHUNK);
    const result = await db.runTransaction(async (tx) => {
      const cfp = await tx.get(cfpRef);
      if (cfp.get('archived') === true) {
        return { applied: false, writes: 0, archived: true };
      }
      if (!cfp.exists || cfp.get(AGGREGATE_REVISION_FIELD) !== revision) {
        return { applied: false, writes: 0, archived: false };
      }

      const currentProposals = [];
      for (const proposal of chunk) currentProposals.push(await tx.get(proposal.ref));

      let chunkWrites = 0;
      for (const proposal of currentProposals) {
        if (!proposal.exists) continue;
        const desired = aggregateScorable(proposal.get('status'))
          ? aggregates.get(proposal.id)
          : undefined;
        const current = proposal.get('aggregate') as unknown;
        if (desired ? sameAggregate(current, desired) : current === undefined) continue;

        tx.update(proposal.ref, {
          aggregate: desired ?? FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        chunkWrites += 1;
      }
      return { applied: true, writes: chunkWrites, archived: false };
    });

    if (!result.applied) {
      return {
        reviewCount: reviews.length,
        proposalCount: aggregates.size,
        writes,
        superseded: true,
        archived: result.archived,
      };
    }
    writes += result.writes;
  }

  return {
    reviewCount: reviews.length,
    proposalCount: aggregates.size,
    writes,
    superseded: false,
    archived: false,
  };
}

/**
 * Operational fallback for an admin. Automatic triggers normally keep these
 * current; this remains useful after an outage or a historic data repair.
 */
export const recomputeAggregates = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = await requireAdmin(request, cfpId, 'recompute review scores');
  const result = await refreshAggregates(cfpId);
  if (result.archived) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }

  logger.info('aggregates recomputed', { cfpId, uid, ...result });
  return {
    ok: true,
    reviewCount: result.reviewCount,
    proposalCount: result.proposalCount,
  };
});

export const refreshReviewAggregates = onDocumentWritten(
  {
    document: 'cfps/{cfpId}/proposals/{proposalId}/reviews/{reviewerUid}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (before?.exists && after?.exists) {
      const scoreChanged = before.get('score') !== after.get('score');
      const conflictChanged =
        (before.get('conflictOfInterest') === true) !==
        (after.get('conflictOfInterest') === true);
      if (!scoreChanged && !conflictChanged) return;
    }

    if (!before?.exists && after?.exists) {
      const proposalRef = db.doc(
        `cfps/${event.params.cfpId}/proposals/${event.params.proposalId}`,
      );
      await db.runTransaction(async (tx) => {
        const [cfp, proposal] = await tx.getAll(db.doc(`cfps/${event.params.cfpId}`), proposalRef);
        if (!cfp.exists || cfp.get('archived') === true) return;
        if (proposal.exists && proposal.get('status') === 'submitted') {
          tx.update(proposalRef, {
            status: 'under_review',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    }

    const result = await refreshAggregates(event.params.cfpId);
    logger.info('review aggregate refresh completed', {
      cfpId: event.params.cfpId,
      proposalId: event.params.proposalId,
      reviewerUid: event.params.reviewerUid,
      ...result,
    });
  },
);

export const refreshProposalAggregates = onDocumentWritten(
  {
    document: 'cfps/{cfpId}/proposals/{proposalId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    const beforeScorable =
      event.data?.before.exists === true &&
      aggregateScorable(event.data.before.get('status'));
    const afterScorable =
      event.data?.after.exists === true &&
      aggregateScorable(event.data.after.get('status'));
    if (beforeScorable === afterScorable) return;

    const result = await refreshAggregates(event.params.cfpId);
    logger.info('proposal aggregate refresh completed', {
      cfpId: event.params.cfpId,
      proposalId: event.params.proposalId,
      beforeScorable,
      afterScorable,
      ...result,
    });
  },
);

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


// ------------------------------------------------------------ platform access

/** Claims any pending platform grant and reports only the caller's own access. */
export const platformAccess = onCall(CALLABLE, async (request) => {
  const identity = requireVerifiedPlatformIdentity(request, 'check platform access');
  try {
    const role = await claimPlatformRole(db, identity);
    return {
      role,
      canCreateCfp: role === 'owner' || role === 'admin' || role === 'creator',
      isPlatformAdmin: role === 'owner' || role === 'admin',
      isPlatformOwner: role === 'owner',
    };
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Platform administrators see delegated access, not the Firebase Auth directory. */
export const listPlatformUsers = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'list CFP creators');
  return { ok: true, ...(await listPlatformAccess(db)) };
});

/** Platform owners and admins grant creator access. */
export const grantCfpCreator = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformAdmin(request, 'grant CFP creator access');
  const data = (request.data ?? {}) as { email?: unknown };
  try {
    const result = await grantPlatformCreator(db, getAuth(), {
      email: data.email,
      byUid: uid,
    });
    logger.info('CFP creator access granted', { ...result, byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Revocation affects future CFP creation, never ownership of existing CFPs. */
export const revokeCfpCreator = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformAdmin(request, 'revoke CFP creator access');
  const data = (request.data ?? {}) as { email?: unknown };
  try {
    const result = await revokePlatformCreator(db, getAuth(), {
      email: data.email,
      byUid: uid,
    });
    logger.info('CFP creator access revoked', { ...result, byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Platform owners may delegate administration without delegating ownership. */
export const grantPlatformAdmin = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformOwner(request, 'grant platform administrator access');
  const data = (request.data ?? {}) as { email?: unknown };
  try {
    const result = await grantPlatformAdministrator(db, getAuth(), {
      email: data.email,
      byUid: uid,
    });
    logger.info('platform administrator access granted', { ...result, byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Owners cannot remove themselves, and owner records remain out of band. */
export const revokePlatformAdmin = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformOwner(request, 'revoke platform administrator access');
  const data = (request.data ?? {}) as { email?: unknown };
  try {
    const result = await revokePlatformAdministrator(db, getAuth(), {
      email: data.email,
      byUid: uid,
    });
    logger.info('platform administrator access revoked', { ...result, byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

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
  const identity = requireVerifiedPlatformIdentity(request, 'create a call for proposals');
  const { uid } = identity;
  let creatorRole: PlatformRole | null;
  try {
    creatorRole = await claimPlatformRole(db, identity);
  } catch (error) {
    throw asHttpsError(error);
  }
  if (
    creatorRole !== 'owner' &&
    creatorRole !== 'admin' &&
    creatorRole !== 'creator'
  ) {
    throw new HttpsError(
      'permission-denied',
      'A platform admin must grant creator access first.',
    );
  }
  const token = request.auth!.token;

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

  const mine = db
    .collection('cfps')
    .where('ownerUids', 'array-contains', uid)
    .limit(CFP_LIMITS.perOwner);

  const ref = db.doc(`cfps/${input.id}`);
  const platformMemberRef = db.doc(`platformMembers/${uid}`);
  await db.runTransaction(async (tx) => {
    // Keep the ceiling in this transaction. A count done before it lets two
    // simultaneous tenth calls both pass and commit.
    const owned = await tx.get(mine);
    const member = await tx.get(platformMemberRef);
    const currentRole = member.get('role');
    if (
      currentRole !== 'owner' &&
      currentRole !== 'admin' &&
      currentRole !== 'creator'
    ) {
      throw new HttpsError(
        'permission-denied',
        'A platform admin must grant creator access first.',
      );
    }
    if (owned.size >= CFP_LIMITS.perOwner) {
      throw new HttpsError(
        'resource-exhausted',
        'You have reached the limit on calls for proposals.',
      );
    }
    const existing = await tx.get(ref);
    if (existing.exists) {
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
    eventStartDate: text(data.eventStartDate || data.eventDate),
    eventEndDate: text(data.eventEndDate || data.eventStartDate || data.eventDate),
    timeZone: text(data.timeZone),
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
    eventStartDate: profile.eventStartDate || profile.eventDate || FieldValue.delete(),
    eventEndDate:
      profile.eventEndDate || profile.eventStartDate || profile.eventDate || FieldValue.delete(),
    timeZone: profile.timeZone || FieldValue.delete(),
    eventDate: FieldValue.delete(),
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

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`cfps/${cfpId}`);
    await assertCfpNotArchived(tx, cfpId);
    tx.update(ref, {
      name,
      visibility,
      ...writableProfile(profile),
      updatedAt: FieldValue.serverTimestamp(),
    });
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
export const archiveCfp = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireOwner(request, cfpId, 'archive this call for proposals');
  const archived = (request.data as { archived?: unknown }).archived !== false;
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);

  if (!archived) {
    await db.runTransaction(async (tx) => {
      const [cfp, lease, member] = await tx.getAll(
        cfpRef,
        mutationLeaseRef(cfpId),
        memberRef,
      );
      if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
      assertMutationActor(member, 'owner');
      if (cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
      }
      if (activeMutationLease(lease)) {
        throw new HttpsError('aborted', 'Another event change is still in progress. Try again.');
      }
      if (lease.exists) tx.delete(lease.ref);
      tx.update(cfpRef, {
        archived: false,
        archivedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    const alreadyArchived = await db.runTransaction(async (tx) => {
      const [cfp, lease, member] = await tx.getAll(
        cfpRef,
        mutationLeaseRef(cfpId),
        memberRef,
      );
      if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
      assertMutationActor(member, 'owner');
      if (cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
      }
      if (activeMutationLease(lease)) {
        throw new HttpsError('aborted', 'Another event change is still in progress. Try again.');
      }
      if (lease.exists) tx.delete(lease.ref);
      return cfp.get('archived') === true;
    });

    if (!alreadyArchived) {
      const leaseId = await acquireCfpMutation(cfpId, 'archive', async (tx) => {
        assertMutationActor(await tx.get(memberRef), 'owner');
      });
      try {
        await freezeLegacyHeadshots(db, getStorage().bucket(), cfpId);
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          assertMutationActor(await tx.get(memberRef), 'owner');
          tx.update(cfpRef, {
            archived: true,
            archivedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (error) {
        await releaseCfpMutationQuietly(cfpId, leaseId);
        throw error;
      }
    }
  }
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
 * A reservation fences unarchive and every other write first. Storage is
 * cleared before Firestore. Firestore descendants are then cleared while the
 * root and caller's owner membership remain as retry anchors; only a final
 * transaction removes those two together.
 */
export const deleteCfp = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireOwner(request, cfpId, 'delete this call for proposals');
  if (String((request.data as { confirm?: unknown }).confirm ?? '') !== cfpId) {
    throw new HttpsError('invalid-argument', 'Type the address to confirm.');
  }

  const cfpRef = db.doc(`cfps/${cfpId}`);
  await db.runTransaction(async (tx) => {
    const [cfp, lease, member] = await tx.getAll(
      cfpRef,
      mutationLeaseRef(cfpId),
      db.doc(`cfps/${cfpId}/members/${byUid}`),
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    assertMutationActor(member, 'owner');
    if (cfp.get('archived') !== true) {
      throw new HttpsError('failed-precondition', 'Archive it before deleting it.');
    }
    if (cfp.get('deleting') === true && member.get('deletionReserved') !== true) {
      throw new HttpsError('aborted', 'Another owner is already deleting this event.');
    }
    if (activeMutationLease(lease)) {
      throw new HttpsError('aborted', 'Another event change is still in progress. Try again.');
    }
    if (lease.exists) tx.delete(lease.ref);
    tx.update(member.ref, { deletionReserved: true });
    tx.update(cfpRef, {
      deleting: true,
      deletingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  try {
    await clearCfpStorage(getStorage().bucket(), cfpId);
  } catch (error) {
    logger.error('could not clear the bucket', { cfpId, error: String(error) });
    throw new HttpsError('unavailable', 'Could not clear stored event files. Try deleting again.');
  }

  try {
    await clearCfpFirestoreChildren(db, cfpRef, byUid);
  } catch (error) {
    logger.error('could not clear event records', { cfpId, error: String(error) });
    throw new HttpsError('unavailable', 'Could not clear event records. Try deleting again.');
  }

  await db.runTransaction(async (tx) => {
    const [cfp, owner] = await tx.getAll(cfpRef, db.doc(`cfps/${cfpId}/members/${byUid}`));
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    assertMutationActor(owner, 'owner');
    if (
      cfp.get('archived') !== true ||
      cfp.get('deleting') !== true ||
      owner.get('deletionReserved') !== true
    ) {
      throw new HttpsError('failed-precondition', 'This deletion is no longer reserved.');
    }
    tx.delete(owner.ref);
    tx.delete(cfpRef);
  });
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
  if (typeof token.email !== 'string' || !token.email || token.email_verified !== true) {
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

export const notifyCommitteeRoleInvite = onDocumentWritten(
  {
    document: 'cfps/{cfpId}/roleGrants/{grantEmail}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists || after.get('claimedBy')) return;
    const invitationId = String(after.get('invitationId') ?? '');
    const beforeInvitationId = event.data?.before.exists
      ? String(event.data.before.get('invitationId') ?? '')
      : '';
    if (!invitationId || invitationId === beforeInvitationId) return;

    const { cfpId, grantEmail } = event.params;
    const queued = await db.runTransaction(async (tx) => {
      const [cfp, grant] = await tx.getAll(db.doc(`cfps/${cfpId}`), after.ref);
      if (
        !cfp.exists ||
        cfp.get('archived') === true ||
        !roleInvitationStillTrue(
          'committee_role_invited',
          invitationId,
          cfpId,
          grantEmail,
          grant,
        )
      ) {
        return false;
      }
      const language = staffEmailLanguage(grant.data());
      await queueEmail(db, tx, cfpId, {
        kind: 'committee_role_invited',
        proposalId: invitationId,
        grantEmail,
        to: grantEmail,
        ...language,
        data: { speakerName: grantEmail, title: '' },
      });
      return true;
    });
    logger.info('committee role invitation queued', {
      cfpId,
      grantEmail,
      invitationId,
      queued,
    });
  },
);

/** Admin only, and refuses to remove the last admin. */
export const revokeRole = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'remove roles');
  const data = (request.data ?? {}) as { email?: unknown };

  try {
    const result = await revoke(db, getAuth(), { cfpId, email: data.email, byUid });
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
 * Undo returns to `under_review`. `submitted` is the speaker-editable state
 * before the first review and is never a committee target.
 */
const ADMIN_PROPOSAL_STATUSES = [
  'under_review',
  'accepted',
  'waitlisted',
  'rejected',
] as const;

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
    const [cfp, snap] = await tx.getAll(db.doc(`cfps/${cfpId}`), ref);
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!snap.exists) throw new HttpsError('not-found', 'No such proposal.');

    const current = String(snap.data()?.status ?? '');
    // A withdrawn talk is the speaker's decision and outranks the committee's.
    if (current === 'draft' || current === 'withdrawn') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${current}" cannot be decided.`,
      );
    }
    const resetSpeakerResponses =
      usesPerSpeakerLifecycle(snap.data()!) && current !== status;
    const confirmationRefs = resetSpeakerResponses
      ? proposalSpeakerIds(snap.data()!).map((speakerId) =>
          speakerConfirmationRef(db, cfpId, proposalId, speakerId),
        )
      : [];
    if (confirmationRefs.length) await tx.getAll(...confirmationRefs);
    // Decisions queue `held`, and an admin releases the whole batch at once
    // (§8) — otherwise the first people alphabetically learn their fate hours
    // before the rest, and rejections trickle out ahead of acceptances.
    if (DECISION_KINDS.includes(status as EmailKind)) {
      const contexts = await speakerEmailContexts(tx, cfpId, proposalId, snap.data()!);
      await queueEmails(
        db,
        tx,
        cfpId,
        contexts.map((context) => ({
          kind: status as EmailKind,
          proposalId,
          recipientUid: context.uid,
          ...(context.primary ? {} : { logIdSuffix: context.uid }),
          to: context.to,
          locale: context.locale,
          data: context.data,
        })),
      );
    }

    for (const confirmationRef of confirmationRefs) {
      tx.set(
        confirmationRef,
        {
          response: FieldValue.delete(),
          answers: FieldValue.delete(),
          respondedAt: FieldValue.delete(),
          confirmedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    tx.update(ref, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(resetSpeakerResponses ? { confirmedAt: FieldValue.delete() } : {}),
    });
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
 * status flip on `emailLog`; the trigger does the sending. Release names the
 * reviewed rows so a decision added after preview waits for the next batch.
 */
export const emailQueue = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'manage the email queue');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'preview');
  if (!['readiness', 'summary', 'preview', 'release', 'retry', 'resend'].includes(action)) {
    throw new HttpsError('invalid-argument', `Unknown action "${action}".`);
  }

  /*
   * The overview needs only setup state. Keeping this ahead of the queue read
   * avoids loading an event's entire delivery history just to draw one setup
   * checklist item.
   */
  if (action === 'readiness') {
    const configSnap = await db.doc(`cfps/${cfpId}/config/email`).get();
    const emailConfig = configSnap.data() ?? {};
    return {
      ok: true,
      settings: settingsFromConfig(emailConfig),
      keyHint: (emailConfig.keyHint as string) ?? '',
      domainId: (emailConfig.domainId as string) ?? '',
      domain: (emailConfig.domain as string) ?? '',
    };
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
    const initial = await ref.get();
    const initialRecipientUid =
      initial.exists && isStaffEmail(initial.get('kind'))
        ? String(initial.get('recipientUid') ?? '')
        : '';
    const resendStaffUser = initialRecipientUid
      ? await verifiedStaffUser(initialRecipientUid)
      : null;
    const status = await db.runTransaction(async (tx) => {
      const [cfp, snap] = await tx.getAll(db.doc(`cfps/${cfpId}`), ref);
      if (!cfp.exists || cfp.get('archived') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      if (!snap.exists) throw new HttpsError('not-found', 'No such message.');
      if (isCoSpeakerInvitationEmail(snap.get('kind'))) {
        throw new HttpsError('not-found', 'No such message.');
      }

      // Held decisions belong to the reviewed batch, while in-flight rows belong
      // to the trigger. Neither may be turned into a one-off resend.
      const current = snap.get('status') as EmailStatus;
      if (current === 'held') {
        throw new HttpsError(
          'failed-precondition',
          'That message is still held for batch review.',
        );
      }
      if (current === 'queued' || current === 'sending') {
        throw new HttpsError('failed-precondition', `That message is already ${current}.`);
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
          !resendStaffUser ||
          resendStaffUser.uid !== uid ||
          !staffMemberIsActive(member?.data(), cfpId, uid) ||
          !staffNotificationStillTrue(snap.get('kind'), subjectId, subject)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That committee notification is no longer sendable.',
          );
        }
      }
      if (isRoleInvitationEmail(snap.get('kind'))) {
        const grantEmail = String(snap.get('grantEmail') ?? '');
        const grant = grantEmail
          ? await tx.get(db.doc(`cfps/${cfpId}/roleGrants/${grantEmail}`))
          : null;
        if (
          !roleInvitationStillTrue(
            snap.get('kind'),
            String(snap.get('proposalId') ?? ''),
            cfpId,
            grantEmail,
            grant,
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That committee invitation is no longer sendable.',
          );
        }
      }
      if (isCoSpeakerInvitationEmail(snap.get('kind'))) {
        const proposalId = String(snap.get('proposalId') ?? '');
        const invitationId = String(snap.get('invitationId') ?? '');
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
            String(snap.get('invitationEmail') ?? ''),
            invitation,
            proposal,
            cfp,
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That speaker invitation is no longer sendable.',
          );
        }
      }
      const speakerRecipientUid = !isStaffEmail(snap.get('kind'))
        ? String(snap.get('recipientUid') ?? '')
        : '';
      if (speakerRecipientUid) {
        const proposal = await tx.get(
          db.doc(`cfps/${cfpId}/proposals/${String(snap.get('proposalId') ?? '')}`),
        );
        if (
          !proposal.exists ||
          !proposalSpeakerIds(proposal.data()!).includes(speakerRecipientUid)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That speaker notification is no longer sendable.',
          );
        }
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
      if (isScheduleEmail(snap.get('kind'))) {
        const cfp = await tx.get(db.doc(`cfps/${cfpId}`));
        const currentReleaseId = scheduleEmailReleaseId(cfp);
        const entryId = snap.get('data')?.scheduleEntryId as string;
        const proposalId = snap.get('proposalId') as string;
        const proposal = proposalId
          ? await tx.get(db.doc(`cfps/${cfpId}/proposals/${proposalId}`))
          : undefined;
        const entry = currentReleaseId && entryId
          ? await tx.get(
              db.doc(`cfps/${cfpId}/scheduleReleases/${currentReleaseId}/entries/${entryId}`),
            )
          : undefined;
        if (
          !scheduleEmailStillTrue(
            snap.get('kind') as string,
            String(snap.get('dedupeKey') ?? ''),
            currentReleaseId,
            entry,
            proposal?.exists ? (proposal.get('status') as string) : undefined,
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That schedule changed, so this message is no longer sendable.',
          );
        }
      }
      tx.update(ref, {
        status: 'queued' satisfies EmailStatus,
        sendingClaimId: FieldValue.delete(),
        sendingStartedAt: FieldValue.delete(),
        // A one-row resend is an explicit new delivery. Bulk retry retains an
        // ambiguous provider attempt so its Resend idempotency key stays stable.
        providerAttemptId: FieldValue.delete(),
        sentAt: FieldValue.delete(),
        providerId: FieldValue.delete(),
        error: FieldValue.delete(),
      });
      return current;
    });

    logger.info('email re-queued', { byUid, logId, was: status });
    return { ok: true, logId };
  }

  const log = db.collection(`cfps/${cfpId}/emailLog`);
  if (action === 'summary') {
    const held = await log.where('status', '==', 'held').get();
    const pending = await currentDecisionEmails(
      cfpId,
      held.docs.filter((doc) => !isCoSpeakerInvitationEmail(doc.get('kind'))),
    );
    return { ok: true, waiting: pending.sendable.length };
  }

  const snap = await log.get();
  const queueDocs = snap.docs.filter(
    (doc) => !isCoSpeakerInvitationEmail(doc.get('kind')),
  );
  const expiredSending = queueDocs.filter(
    (doc) =>
      doc.get('status') === 'sending' &&
      sendingLeaseExpired(doc.get('sendingStartedAt') ?? doc.updateTime),
  );
  const expiredSendingIds = new Set(expiredSending.map((doc) => doc.id));
  const pendingDocs = queueDocs.filter(
    (doc) =>
      ['held', 'failed', 'dry_run'].includes(doc.get('status') as string) ||
      expiredSendingIds.has(doc.id),
  );
  const pendingState =
    action === 'preview' || action === 'release' || action === 'retry'
      ? await currentDecisionEmails(cfpId, pendingDocs)
      : { sendable: pendingDocs, stale: [] };
  const staleIds = new Set(pendingState.stale.map((doc) => doc.id));
  const recoverableSendingIds = new Set(
    expiredSending.filter((doc) => !staleIds.has(doc.id)).map((doc) => doc.id),
  );

  const tally: Record<string, number> = {};
  for (const doc of queueDocs) {
    // A retained, superseded decision is not waiting for release. It becomes
    // sendable again only if the committee restores that exact decision.
    if (staleIds.has(doc.id)) continue;
    const key = `${doc.get('status')}:${doc.get('kind')}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }

  const at = (doc: (typeof snap.docs)[number], field: string): number =>
    (doc.get(field) as Timestamp | undefined)?.toMillis() ?? 0;

  const rows = queueDocs
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
      recoverable: recoverableSendingIds.has(d.id),
      // The database row remains held so restoring the decision can release it.
      // This flag lets the log describe its effective state truthfully.
      stale: staleIds.has(d.id),
    }))
    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0) || a.to.localeCompare(b.to));

  if (action === 'preview') {
    const configSnap = await db.doc(`cfps/${cfpId}/config/email`).get();
    const emailConfig = configSnap.data() ?? {};
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
        .map((d) => ({
          logId: d.id,
          kind: d.get('kind'),
          to: d.get('to'),
          title: d.get('data')?.title,
        })),
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
      recoverableSending: recoverableSendingIds.size,
      truncated: Math.max(0, rows.length - ROW_CAP),
    };
  }

  await assertCfpNotArchivedNow(cfpId);

  // `dry_run` counts as unsent, because it is: the row records a message that
  // was rendered while no sender was configured. Retrying picks those up once
  // the domain is, so a receipt written during setup still reaches its speaker.
  const from: EmailStatus[] =
    action === 'release' ? ['held'] : ['failed', 'dry_run', 'sending'];
  let candidates: DocumentSnapshot[];
  if (action === 'release') {
    const rawLogIds = data.logIds;
    if (
      !Array.isArray(rawLogIds) ||
      rawLogIds.length === 0 ||
      rawLogIds.some((id) => typeof id !== 'string' || !id || id.includes('/')) ||
      new Set(rawLogIds).size !== rawLogIds.length
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Release requires the unique message ids from the reviewed preview.',
      );
    }
    candidates = await db.getAll(...rawLogIds.map((id) => log.doc(id as string)));
    if (candidates.some((doc) => isCoSpeakerInvitationEmail(doc.get('kind')))) {
      throw new HttpsError('not-found', 'No such message.');
    }
  } else {
    candidates = queueDocs.filter(
      (doc) =>
        from.includes(doc.get('status') as EmailStatus) &&
        (doc.get('status') !== 'sending' || expiredSendingIds.has(doc.id)),
    );
  }
  const { released, stale } = await advanceEmailQueue(cfpId, candidates, from);

  logger.info('email queue advanced', { byUid, action, count: released, stale });
  return { ok: true, tally, released, stale };
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
const SIGN_IN_PROPOSAL_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SIGN_IN_SPEAKER_INVITATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LINK_WINDOW_MS = 60 * 60 * 1000;
const LINKS_PER_WINDOW = 5;
const SIGN_IN_DESTINATIONS = new Set([
  'submit',
  'review',
  'schedule',
  'admin/overview',
  'admin/proposals',
  'admin/schedule',
  'admin/committee',
  'admin/settings',
  'admin/submission',
  'admin/confirmation',
  'admin/email',
]);

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
 * `cfpId` is optional and decides who the message comes from. `destination`
 * preserves the CFP workspace that asked for the link, but it is an allowlisted
 * route name rather than a URL: the caller never chooses the origin or an
 * arbitrary redirect.
 */
export const requestSignInLink = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as {
    email?: unknown;
    locale?: unknown;
    cfpId?: unknown;
    destination?: unknown;
    proposalId?: unknown;
    speakerInvitationId?: unknown;
  };
  const email = String(data.email ?? '').trim().toLowerCase();
  const locale: EmailLocale = data.locale === 'fr' ? 'fr' : 'en';
  const cfpId = typeof data.cfpId === 'string' && validateCfpId(data.cfpId) === null
    ? data.cfpId
    : null;
  const destination =
    typeof data.destination === 'string' && SIGN_IN_DESTINATIONS.has(data.destination)
      ? data.destination
      : 'submit';
  const proposalId = typeof data.proposalId === 'string' ? data.proposalId : '';
  const speakerInvitationId =
    typeof data.speakerInvitationId === 'string' ? data.speakerInvitationId : '';
  const hasSpeakerInvitation = Boolean(proposalId || speakerInvitationId);

  if (
    hasSpeakerInvitation &&
    (!cfpId ||
      destination !== 'submit' ||
      !SIGN_IN_PROPOSAL_ID.test(proposalId) ||
      !SIGN_IN_SPEAKER_INVITATION_ID.test(speakerInvitationId))
  ) {
    throw new HttpsError('invalid-argument', 'A valid speaker invitation is required.');
  }

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  }

  const [apiKey, platform] = await Promise.all([readResendKey(), loadPlatform(db)]);
  // Named CFP or not, the sender is looked up server-side. Nothing about who
  // this mail comes from is taken from the caller.
  const [settings, cfpSnap, invitationSnap, invitationProposalSnap] = await Promise.all([
    cfpId ? loadSettings(db, cfpId) : Promise.resolve(platform.settings),
    cfpId ? db.doc(`cfps/${cfpId}`).get() : Promise.resolve(null),
    hasSpeakerInvitation && cfpId
      ? db.doc(
          `cfps/${cfpId}/proposals/${proposalId}` +
            `/speakerInvitations/${speakerInvitationId}`,
        ).get()
      : Promise.resolve(null),
    hasSpeakerInvitation && cfpId
      ? db.doc(`cfps/${cfpId}/proposals/${proposalId}`).get()
      : Promise.resolve(null),
  ]);
  if (
    hasSpeakerInvitation &&
    !coSpeakerSignInInvitationStillTrue(
      speakerInvitationId,
      cfpId!,
      proposalId,
      email,
      invitationSnap,
      invitationProposalSnap,
      cfpSnap,
    )
  ) {
    throw new HttpsError('not-found', 'That speaker invitation is no longer active.');
  }
  const event = (cfpSnap?.get('name') as string) || platform.name;

  const generatedLink = await getAuth().generateSignInWithEmailLink(email, {
    // Must be one of Auth's authorized domains, or Firebase refuses to mint it.
    // The origin is platform config, never a per-CFP field: an organiser who
    // could edit it could aim other people's sign-in mail at a host they own.
    url: cfpId
      ? destination === 'submit'
        ? hasSpeakerInvitation
          ? `${cfpUrl(platform.publicUrl, cfpId)}?${new URLSearchParams({
              proposal: proposalId,
              speakerInvite: speakerInvitationId,
            }).toString()}`
          : cfpUrl(platform.publicUrl, cfpId)
        : `${platform.publicUrl}/c/${cfpId}/${destination}`
      : `${platform.publicUrl}/`,
    handleCodeInApp: true,
  });
  const link = useFreshHostingOrigin(
    generatedLink,
    process.env.GCLOUD_PROJECT,
    Boolean(process.env.FUNCTIONS_EMULATOR),
  );

  // Configuration failures above must not spend somebody's request allowance.
  // Take it immediately before the only external side effect: sending mail.
  await takeLinkAllowance(email);

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

  const logIds = await db.runTransaction(async (tx) => {
    const [cfp, snap] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
    );
    if (!cfp.exists || cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!snap.exists) throw new HttpsError('not-found', 'No such proposal.');

    // A draft stays within its active speaker roster. Organiser mail would tell
    // applicants that the committee read something they never submitted.
    if (snap.get('status') === 'draft') {
      throw new HttpsError('failed-precondition', 'That proposal has not been submitted.');
    }

    const contexts = await speakerEmailContexts(tx, cfpId, proposalId, snap.data()!);
    if (contexts.length === 0) {
      throw new HttpsError('failed-precondition', 'No address on file for that speaker.');
    }

    return contexts.map((context) => {
      const ref = db.collection(`cfps/${cfpId}/emailLog`).doc();
      tx.create(ref, {
        kind: MESSAGE_KIND,
        proposalId,
        subject,
        body,
        recipientUid: context.uid,
        to: context.to,
        locale: context.locale,
        data: context.data,
        // Queued, not held: a message is one deliberate act, not part of a batch
        // that has to leave together.
        status: 'queued' satisfies EmailStatus,
        attempts: 0,
        byUid,
        createdAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    });
  });

  logger.info('message queued', { byUid, proposalId, logIds });
  return { ok: true, logId: logIds[0], logIds };
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
  await db.runTransaction(async (tx) => {
    const [cfp, config] = await tx.getAll(db.doc(`cfps/${cfpId}`), configRef);
    if (!cfp.exists || cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    const registered = (config.get('domain') as string | undefined) ?? '';
    if (!registered) {
      throw new HttpsError('failed-precondition', 'Add your sending domain first.');
    }
    const mismatch = senderMismatch(settings.from, registered);
    if (mismatch) {
      throw new HttpsError('invalid-argument', `${mismatch} is not your verified domain.`);
    }
    tx.set(configRef, { from: settings.from, replyTo: settings.replyTo }, { merge: true });
  });
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
  const configRef = db.doc(`cfps/${cfpId}/config/email`);

  if (data.reset === true) {
    await db.runTransaction(async (tx) => {
      const [cfp, config] = await tx.getAll(db.doc(`cfps/${cfpId}`), configRef);
      if (!cfp.exists || cfp.get('archived') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      // Nothing stored for it yet is already the state `reset` asks for.
      if (config.exists) tx.update(configRef, { [path]: FieldValue.delete() });
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

  await db.runTransaction(async (tx) => {
    await assertCfpNotArchived(tx, cfpId);
    tx.set(configRef, { templates: { [kind]: { [locale]: template } } }, { merge: true });
  });
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
  const cfpSnap = await assertCfpNotArchivedNow(cfpId);

  const [apiKey, settings, templates, platform] = await Promise.all([
    readResendKey(),
    loadSettings(db, cfpId),
    loadTemplates(db, cfpId),
    loadPlatform(db),
  ]);
  // This is the last check possible before the provider handoff. An archive
  // racing the HTTP request itself cannot recall a message Resend accepted.
  await assertCfpNotArchivedNow(cfpId);
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
export const setEmailSecret = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'set the API key');
  const apiKey = String((request.data as { apiKey?: unknown } | undefined)?.apiKey ?? '').trim();

  if (!apiKey) throw new HttpsError('invalid-argument', 'An API key is required.');
  if (!apiKey.startsWith('re_')) {
    throw new HttpsError('invalid-argument', 'A Resend API key starts with "re_".');
  }
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
  const leaseId = await acquireCfpMutation(cfpId, 'email-secret', async (tx) => {
    assertMutationActor(await tx.get(memberRef), 'admin');
  });
  try {
    try {
      await listDomains(apiKey);
    } catch (error) {
      throw asResendError(error);
    }

    await writeResendKey(apiKey);
    await finishCfpMutation(cfpId, leaseId, async (tx) => {
      assertMutationActor(await tx.get(memberRef), 'admin');
      tx.set(
        db.doc(`cfps/${cfpId}/config/email`),
        { keyHint: keyHint(apiKey), keySetAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  } catch (error) {
    await releaseCfpMutationQuietly(cfpId, leaseId);
    throw error;
  }

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
export const emailDomain = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'manage the sending domain');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'list');

  const apiKey = await readResendKey();
  const configRef = db.doc(`cfps/${cfpId}/config/email`);
  const ours = ((await configRef.get()).get('domainId') as string | undefined) ?? '';
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);

  try {
    if (action === 'list') {
      return { ok: true, domains: ours ? [await getDomain(apiKey, ours)] : [] };
    }

    if (action === 'add') {
      const name = cleanDomain(String(data.domain ?? ''));
      if (!name) throw new HttpsError('invalid-argument', 'That is not a domain name.');
      const leaseId = await acquireCfpMutation(cfpId, 'email-domain-add', async (tx) => {
        assertMutationActor(await tx.get(memberRef), 'admin');
      });
      try {
        // Already in the account — verified through Resend's own dashboard, or
        // added here before the write below landed. Adopting the existing one is
        // the only way forward: Resend refuses a duplicate, and refusing back
        // would leave a CFP permanently unable to claim a domain it owns.
        const existing = (await listDomains(apiKey)).find((d) => d.name === name);
        const domain = existing ?? (await addDomain(apiKey, name));
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          assertMutationActor(await tx.get(memberRef), 'admin');
          tx.set(configRef, { domainId: domain.id, domain: name }, { merge: true });
        });
        return { ok: true, domain: existing ? await getDomain(apiKey, domain.id) : domain };
      } catch (error) {
        await releaseCfpMutationQuietly(cfpId, leaseId);
        throw error;
      }
    }

    if (action === 'get') {
      if (!ours) throw new HttpsError('failed-precondition', 'No domain has been added yet.');
      return { ok: true, domain: await getDomain(apiKey, ours) };
    }
    if (action === 'verify') {
      const leaseId = await acquireCfpMutation(cfpId, 'email-domain-verify', async (tx) => {
        assertMutationActor(await tx.get(memberRef), 'admin');
      });
      try {
        const currentDomainId = ((await configRef.get()).get('domainId') as string | undefined) ?? '';
        if (!currentDomainId) {
          throw new HttpsError('failed-precondition', 'No domain has been added yet.');
        }
        const domain = await verifyDomain(apiKey, currentDomainId);
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          assertMutationActor(await tx.get(memberRef), 'admin');
        });
        logger.info('domain verification requested', { byUid, cfpId, status: domain.status });
        return { ok: true, domain };
      } catch (error) {
        await releaseCfpMutationQuietly(cfpId, leaseId);
        throw error;
      }
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

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`cfps/${cfpId}`);
    const current = await tx.get(ref);
    if (!current.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (current.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    const opensAt = (patch.opensAt ?? current.get('opensAt')) as Timestamp | undefined;
    const closesAt = (patch.closesAt ?? current.get('closesAt')) as Timestamp | undefined;
    if (opensAt && closesAt && closesAt.toMillis() <= opensAt.toMillis()) {
      throw new HttpsError('invalid-argument', 'The window would close before it opens.');
    }
    tx.set(
      ref,
      { ...patch, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
  logger.info('cfp window changed', { byUid, ...patch });
  return { ok: true };
});

// --------------------------------------------------------------- schedule

const scheduleConfigRef = (cfpId: string) => db.doc(`cfps/${cfpId}/config/schedule`);
const scheduleSubmissionFormRef = (cfpId: string) =>
  db.doc(`cfps/${cfpId}/config/submissionForm`);
const scheduleDraft = (cfpId: string) => db.collection(`cfps/${cfpId}/scheduleDraft`);
const scheduleReleaseSourceRef = (cfpId: string, releaseId: string) =>
  db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}/internal/source`);

function scheduleConfigFrom(value: unknown): ScheduleConfig {
  const data = (value ?? {}) as Record<string, unknown>;
  const days = Array.isArray(data.days) ? data.days : [];
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  return {
    timeZone: String(data.timeZone ?? '').trim(),
    days: days.map((item) => {
      const day = item as Record<string, unknown>;
      return {
        date: String(day.date ?? '').trim(),
        startsAt: String(day.startsAt ?? '').trim(),
        endsAt: String(day.endsAt ?? '').trim(),
      } satisfies ScheduleDay;
    }),
    rooms: rooms.map((item) => {
      const room = item as Record<string, unknown>;
      const name = (room.name ?? {}) as Record<string, unknown>;
      return {
        id: String(room.id ?? '').trim(),
        name: { en: String(name.en ?? '').trim(), fr: String(name.fr ?? '').trim() },
      } satisfies ScheduleRoom;
    }),
    revision: Number(data.revision ?? 0),
  };
}

function scheduleSpeakersFrom(value: unknown): PublicScheduleSpeaker[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [null as unknown as PublicScheduleSpeaker];
  return value.slice(0, SCHEDULE_LIMITS.customSpeakers + 1).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item as PublicScheduleSpeaker;
    }
    const data = item as Record<string, unknown>;
    const text = (key: 'name' | 'bio' | 'company' | 'jobTitle'): unknown => {
      const field = data[key];
      return typeof field === 'string' ? field.trim() || undefined : field;
    };
    const name = text('name');
    const bio = text('bio');
    const company = text('company');
    const jobTitle = text('jobTitle');
    return {
      name: name as string,
      ...(bio !== undefined ? { bio: bio as string } : {}),
      ...(company !== undefined ? { company: company as string } : {}),
      ...(jobTitle !== undefined ? { jobTitle: jobTitle as string } : {}),
    };
  });
}

function scheduleEntryFrom(value: unknown): ScheduleEntry {
  const data = (value ?? {}) as Record<string, unknown>;
  const base = {
    id: String(data.id ?? '').trim(),
    date: String(data.date ?? '').trim(),
    startsAt: String(data.startsAt ?? '').trim(),
    durationMinutes: Number(data.durationMinutes),
    roomId: String(data.roomId ?? '').trim(),
  };
  if (data.kind === 'proposal') {
    const assigned = String(data.assignedLanguage ?? '');
    return {
      ...base,
      kind: 'proposal',
      proposalId: String(data.proposalId ?? '').trim(),
      ...(assigned === 'en' || assigned === 'fr' ? { assignedLanguage: assigned } : {}),
    };
  }
  const title = (data.title ?? {}) as Record<string, unknown>;
  const description = (data.description ?? {}) as Record<string, unknown>;
  const language = String(data.language ?? '').trim();
  const speakers = scheduleSpeakersFrom(data.speakers);
  return {
    ...base,
    kind: 'custom',
    customType: String(data.customType ?? '') as ScheduleEntry & never,
    ...(language ? { language: language as ScheduleLanguage } : {}),
    ...(speakers !== undefined ? { speakers } : {}),
    title: { en: String(title.en ?? '').trim(), fr: String(title.fr ?? '').trim() },
    description: {
      en: String(description.en ?? '').trim(),
      fr: String(description.fr ?? '').trim(),
    },
  } as ScheduleEntry;
}

function assertScheduleRevision(current: number, expected: unknown): void {
  if (!Number.isInteger(expected) || expected !== current) {
    throw new HttpsError(
      'aborted',
      'The schedule changed in another tab. Reload it before making this change.',
    );
  }
}

export const setScheduleConfig = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'configure the schedule');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const config = scheduleConfigFrom(input.config);
  const problem = validateScheduleConfig(config);
  if (problem) throw new HttpsError('invalid-argument', problem);

  const revision = await db.runTransaction(async (tx) => {
    const ref = scheduleConfigRef(cfpId);
    await assertCfpNotArchived(tx, cfpId);
    const [snap, draftEntries] = await Promise.all([
      tx.get(ref),
      tx.get(scheduleDraft(cfpId)),
    ]);
    const current = Number(snap.get('revision') ?? 0);
    assertScheduleRevision(current, input.expectedRevision);
    for (const doc of draftEntries.docs) {
      const entryProblem = validateScheduleEntry(
        scheduleEntryFrom({ id: doc.id, ...doc.data() }),
        config,
      );
      if (entryProblem) {
        throw new HttpsError(
          'failed-precondition',
          'Move or remove entries that do not fit the new schedule setup.',
        );
      }
    }
    const next = current + 1;
    tx.set(ref, {
      ...config,
      revision: next,
      needsAttention: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
  logger.info('schedule configured', { cfpId, byUid, revision });
  return { ok: true, revision };
});

export const upsertScheduleEntry = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'edit the schedule');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const entry = scheduleEntryFrom(input.entry);

  const revision = await db.runTransaction(async (tx) => {
    const configRef = scheduleConfigRef(cfpId);
    await assertCfpNotArchived(tx, cfpId);
    const [configSnap, entriesSnap] = await Promise.all([
      tx.get(configRef),
      tx.get(scheduleDraft(cfpId)),
    ]);
    if (!configSnap.exists) throw new HttpsError('failed-precondition', 'Configure the schedule first.');
    const config = scheduleConfigFrom(configSnap.data());
    const current = Number(configSnap.get('revision') ?? 0);
    assertScheduleRevision(current, input.expectedRevision);
    const problem = validateScheduleEntry(entry, config);
    if (problem) throw new HttpsError('invalid-argument', problem);

    const entries = entriesSnap.docs
      .filter((doc) => doc.id !== entry.id)
      .map((doc) => scheduleEntryFrom({ id: doc.id, ...doc.data() }));
    if (entries.length >= SCHEDULE_LIMITS.entries) {
      throw new HttpsError('resource-exhausted', 'This schedule has reached its entry limit.');
    }
    entries.push(entry);
    const proposalIds = entries
      .filter((item): item is Extract<ScheduleEntry, { kind: 'proposal' }> => item.kind === 'proposal')
      .map((item) => item.proposalId);
    const proposalSnaps = proposalIds.length
      ? await tx.getAll(...proposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`)))
      : [];
    const proposals = new Map(proposalSnaps.map((snap) => [snap.id, snap.data()]));
    for (const item of entries) {
      if (item.kind !== 'proposal') continue;
      const proposal = proposals.get(item.proposalId);
      if (!proposal || !['accepted', 'confirmed'].includes(String(proposal.status))) {
        throw new HttpsError('failed-precondition', 'Only accepted or confirmed talks can be scheduled.');
      }
    }
    const speakers = new Map(
      proposalSnaps.map((snap) => [snap.id, (snap.get('speakerIds') ?? []) as string[]]),
    );
    if (scheduleConflicts(entries, speakers).length) {
      throw new HttpsError('already-exists', 'That placement conflicts with another session.');
    }

    const next = current + 1;
    const { id, ...stored } = entry;
    tx.set(scheduleDraft(cfpId).doc(id), { ...stored, updatedAt: FieldValue.serverTimestamp() });
    tx.update(configRef, {
      revision: next,
      needsAttention: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
  logger.info('schedule entry saved', { cfpId, entryId: entry.id, byUid, revision });
  return { ok: true, revision, entryId: entry.id };
});

export const removeScheduleEntry = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'edit the schedule');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const entryId = String(input.entryId ?? '');
  if (!/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(entryId)) {
    throw new HttpsError('invalid-argument', 'entryId is required.');
  }
  const revision = await db.runTransaction(async (tx) => {
    const configRef = scheduleConfigRef(cfpId);
    await assertCfpNotArchived(tx, cfpId);
    const snap = await tx.get(configRef);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Configure the schedule first.');
    const current = Number(snap.get('revision') ?? 0);
    assertScheduleRevision(current, input.expectedRevision);
    const next = current + 1;
    tx.delete(scheduleDraft(cfpId).doc(entryId));
    tx.update(configRef, {
      revision: next,
      needsAttention: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
  logger.info('schedule entry removed', { cfpId, entryId, byUid, revision });
  return { ok: true, revision, entryId };
});

function stableScheduleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableScheduleValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableScheduleValue(item)]),
  );
}

function scheduleProjectionFingerprint(
  config: Pick<ScheduleConfig, 'timeZone' | 'days' | 'rooms'>,
  entries: readonly PublishedScheduleEntry[],
): string {
  const source = stableScheduleValue({
    timeZone: config.timeZone,
    days: config.days,
    rooms: config.rooms,
    entries: [...entries].sort((left, right) => left.id.localeCompare(right.id)),
  });
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

function scheduleTaxonomySource(form: SubmissionForm): unknown {
  const options = (items: SubmissionForm['category']) =>
    items.map((item) => ({ value: item.value, label: item.label }));
  return {
    category: options(form.category),
    format: options(form.format),
    level: options(form.level),
  };
}

function scheduleTaxonomyFingerprint(form: SubmissionForm): string {
  return createHash('sha256')
    .update(JSON.stringify(stableScheduleValue(scheduleTaxonomySource(form))))
    .digest('hex');
}

function scheduleFormFrom(snapshot: DocumentSnapshot): SubmissionForm {
  return mergeSubmissionForm(snapshot.exists ? snapshot.data() : undefined);
}

function scheduleEntriesWithTaxonomyLabels(
  entries: readonly PublishedScheduleEntry[],
  form: SubmissionForm,
): PublishedScheduleEntry[] {
  return entries.map((entry) =>
    entry.kind === 'custom'
      ? entry
      : {
          ...entry,
          session: {
            ...entry.session,
            categoryLabel: scheduleTaxonomyLabel(form.category, entry.session.category),
            formatLabel: scheduleTaxonomyLabel(form.format, entry.session.format),
            levelLabel: scheduleTaxonomyLabel(form.level, entry.session.level),
          },
        },
  );
}

function sharedProjection(
  config: ScheduleConfig,
  entries: readonly ScheduleEntry[],
  proposals: ReadonlyMap<string, DocumentSnapshot>,
  form: SubmissionForm,
): { entries: PublishedScheduleEntry[]; omittedCount: number; fingerprint: string } {
  const projected: PublishedScheduleEntry[] = [];
  const eligibleDraft: ScheduleEntry[] = [];
  let omittedCount = 0;

  for (const entry of entries) {
    const problem = validateScheduleEntry(entry, config);
    if (problem) throw new HttpsError('invalid-argument', problem);
    if (entry.kind === 'custom') {
      projected.push(entry);
      eligibleDraft.push(entry);
      continue;
    }
    const proposal = proposals.get(entry.proposalId);
    if (!proposal?.exists || proposal.get('status') !== 'confirmed') {
      omittedCount += 1;
      continue;
    }
    const data = proposal.data()!;
    const language = resolvedScheduleLanguage(data.deliveryLanguage, entry.assignedLanguage);
    if (!language) {
      throw new HttpsError('failed-precondition', 'Assign a language to every flexible session.');
    }
    eligibleDraft.push(entry);
    const category = String(data.category ?? '');
    const format = String(data.format ?? '');
    const level = String(data.level ?? '');
    projected.push({
      id: entry.id,
      kind: 'proposal',
      proposalId: entry.proposalId,
      date: entry.date,
      startsAt: entry.startsAt,
      durationMinutes: entry.durationMinutes,
      roomId: entry.roomId,
      session: {
        proposalId: entry.proposalId,
        title: String(data.title ?? ''),
        abstract: String(data.abstract ?? ''),
        category,
        categoryLabel: scheduleTaxonomyLabel(form.category, category),
        format,
        formatLabel: scheduleTaxonomyLabel(form.format, format),
        level,
        levelLabel: scheduleTaxonomyLabel(form.level, level),
        language,
        speakers: publicScheduleSpeakers(
          (data.speakerSnapshot ?? []) as SpeakerSnapshot[],
        ),
      },
    });
  }

  const speakers = new Map(
    [...proposals].map(([id, proposal]) => [id, (proposal.get('speakerIds') ?? []) as string[]]),
  );
  if (scheduleConflicts(eligibleDraft, speakers).length) {
    throw new HttpsError('already-exists', 'Resolve every shared schedule conflict first.');
  }
  return {
    entries: projected,
    omittedCount,
    fingerprint: scheduleProjectionFingerprint(config, projected),
  };
}

export const shareSchedulePreview = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'share the schedule preview');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const [configSnap, entriesSnap, cfpBefore, formSnap] = await Promise.all([
    scheduleConfigRef(cfpId).get(),
    scheduleDraft(cfpId).get(),
    db.doc(`cfps/${cfpId}`).get(),
    scheduleSubmissionFormRef(cfpId).get(),
  ]);
  if (!cfpBefore.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfpBefore.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
  if (!configSnap.exists) throw new HttpsError('failed-precondition', 'Configure the schedule first.');
  const current = Number(configSnap.get('revision') ?? 0);
  assertScheduleRevision(current, input.expectedRevision);
  const config = scheduleConfigFrom(configSnap.data());
  const form = scheduleFormFrom(formSnap);
  const configProblem = validateScheduleConfig(config);
  if (configProblem) throw new HttpsError('invalid-argument', configProblem);
  const entries = entriesSnap.docs.map((doc) => scheduleEntryFrom({ id: doc.id, ...doc.data() }));
  if (!entries.length) throw new HttpsError('failed-precondition', 'Add at least one schedule item first.');

  const proposalEntries = entries.filter(
    (entry): entry is Extract<ScheduleEntry, { kind: 'proposal' }> => entry.kind === 'proposal',
  );
  const proposalSnaps = proposalEntries.length
    ? await db.getAll(
        ...proposalEntries.map((entry) => db.doc(`cfps/${cfpId}/proposals/${entry.proposalId}`)),
      )
    : [];
  const proposals = new Map(proposalSnaps.map((snap) => [snap.id, snap]));
  const projection = sharedProjection(config, entries, proposals, form);
  const sharedEntries = projection.entries;
  if (!sharedEntries.length) {
    throw new HttpsError(
      'failed-precondition',
      'Add at least one confirmed session or custom schedule item first.',
    );
  }

  const previousReleaseId = (cfpBefore.get('sharedScheduleId') ??
    cfpBefore.get('publishedScheduleId')) as string | undefined;
  const [previousRelease, previousEntriesSnap, previousSource] = previousReleaseId
    ? await Promise.all([
        db.doc(`cfps/${cfpId}/scheduleReleases/${previousReleaseId}`).get(),
        db.collection(`cfps/${cfpId}/scheduleReleases/${previousReleaseId}/entries`).get(),
        scheduleReleaseSourceRef(cfpId, previousReleaseId).get(),
      ])
    : [null, null, null];
  const previousFingerprint = String(
    previousSource?.get('sourceFingerprint') ?? previousRelease?.get('sourceFingerprint') ?? '',
  );
  const projectionChanged =
    previousRelease?.exists !== true ||
    !previousFingerprint ||
    previousFingerprint !== projection.fingerprint;
  if (configSnap.get('needsAttention') !== true && !projectionChanged) {
    throw new HttpsError('failed-precondition', 'There are no unpublished schedule changes.');
  }
  const previousEntries = new Map(
    (previousEntriesSnap?.docs ?? [])
      .filter((doc) => doc.get('kind') === 'proposal')
      .map((doc) => [doc.get('proposalId') as string, { id: doc.id, ...doc.data() }]),
  );
  const previousRooms = new Map(
    (((previousRelease?.get('rooms') as ScheduleRoom[] | undefined) ?? []).map((room) => [
      room.id,
      room,
    ])),
  );
  const currentRooms = new Map(config.rooms.map((room) => [room.id, room]));
  const timeZoneChanged =
    previousRelease?.exists === true && previousRelease.get('timeZone') !== config.timeZone;
  type ScheduleEmailChange = {
    kind: Extract<EmailKind, 'schedule_assigned' | 'schedule_changed' | 'schedule_cancelled'>;
    proposalId: string;
    entryId: string;
    title: string;
    date: string;
    startsAt: string;
    room: ScheduleRoom | undefined;
  };
  const changes: ScheduleEmailChange[] = [];
  const unchanged: { proposalId: string; entryId: string }[] = [];
  const alreadyCancelled: ScheduleEmailChange[] = [];
  const currentProposalIds = new Set<string>();
  for (const entry of sharedEntries) {
    if (entry.kind !== 'proposal') continue;
    currentProposalIds.add(entry.proposalId);
    const previous = previousEntries.get(entry.proposalId) as
      | (Record<string, any> & { id: string })
      | undefined;
    const moved =
      previous &&
      (previous.date !== entry.date ||
        previous.startsAt !== entry.startsAt ||
        previous.durationMinutes !== entry.durationMinutes ||
        previous.roomId !== entry.roomId ||
        JSON.stringify(stableScheduleValue(previousRooms.get(String(previous.roomId))?.name)) !==
          JSON.stringify(stableScheduleValue(currentRooms.get(entry.roomId)?.name)) ||
        timeZoneChanged ||
        previous.session?.title !== entry.session.title ||
        previous.session?.language !== entry.session.language ||
        previous.cancelled === true);
    if (!previous || moved) {
      changes.push({
        kind: previous ? 'schedule_changed' : 'schedule_assigned',
        proposalId: entry.proposalId,
        entryId: entry.id,
        title: entry.session.title,
        date: entry.date,
        startsAt: entry.startsAt,
        room: currentRooms.get(entry.roomId),
      });
    } else {
      unchanged.push({ proposalId: entry.proposalId, entryId: entry.id });
    }
  }
  for (const [proposalId, previous] of previousEntries) {
    if (currentProposalIds.has(proposalId)) continue;
    const old = previous as Record<string, any> & { id: string };
    const cancellation: ScheduleEmailChange = {
      kind: 'schedule_cancelled',
      proposalId,
      entryId: old.id,
      title: String(old.session?.title ?? ''),
      date: String(old.date ?? ''),
      startsAt: String(old.startsAt ?? ''),
      room: previousRooms.get(String(old.roomId ?? '')),
    };
    if (old.cancelled === true) alreadyCancelled.push(cancellation);
    else changes.push(cancellation);
  }
  const changeProposalIds = [
    ...new Set([...changes, ...alreadyCancelled].map((change) => change.proposalId)),
  ];
  const changeProposalSnaps = changeProposalIds.length
    ? await db.getAll(
        ...changeProposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`)),
      )
    : [];

  type ScheduleEmailRecipient = {
    change: ScheduleEmailChange;
    uid: string;
    primary: boolean;
  };
  const notificationProposals = new Map(
    [...proposalSnaps, ...changeProposalSnaps].map((proposal) => [proposal.id, proposal]),
  );
  const recipientsFor = (proposalId: string) => {
    const proposal = notificationProposals.get(proposalId);
    if (!proposal?.exists) return [];
    const data = proposal.data()!;
    const primary = primarySpeakerId(data);
    return proposalSpeakerIds(data).map((uid) => ({ uid, primary: uid === primary }));
  };
  const changeRecipients: ScheduleEmailRecipient[] = changes.flatMap((change) =>
    recipientsFor(change.proposalId).map((recipient) => ({ change, ...recipient })),
  );

  const cancelledCarrySources: {
    proposalId: string;
    entryId: string;
    uid: string;
    primary: boolean;
    sourceRef: FirebaseFirestore.DocumentReference;
  }[] = [];
  if (previousReleaseId && alreadyCancelled.length) {
    const candidates = alreadyCancelled.flatMap((change) =>
      recipientsFor(change.proposalId).map((recipient) => ({ change, ...recipient })),
    );
    const sourceRefs = candidates.map(({ change, uid, primary }) =>
      db.doc(
        `cfps/${cfpId}/emailLog/${logId(
          'schedule_cancelled',
          change.proposalId,
          previousReleaseId,
          primary ? undefined : uid,
        )}`,
      ),
    );
    const sources = sourceRefs.length ? await db.getAll(...sourceRefs) : [];
    for (const [index, candidate] of candidates.entries()) {
      const source = sources[index];
      const status = source?.exists ? (source.get('status') as EmailStatus) : undefined;
      if (status && CARRY_SCHEDULE_EMAIL_STATUSES.has(status)) {
        cancelledCarrySources.push({
          proposalId: candidate.change.proposalId,
          entryId: candidate.change.entryId,
          uid: candidate.uid,
          primary: candidate.primary,
          sourceRef: sourceRefs[index],
        });
      } else if (!source?.exists) {
        changeRecipients.push(candidate);
      }
    }
  }

  const releaseRef = db.collection(`cfps/${cfpId}/scheduleReleases`).doc();
  const carryCandidates = previousReleaseId
    ? [
        ...unchanged.flatMap(({ proposalId, entryId }) =>
          recipientsFor(proposalId).flatMap(({ uid, primary }) =>
            (['schedule_assigned', 'schedule_changed'] as const).map((kind) => ({
              proposalId,
              entryId,
              uid,
              sourceRef: db.doc(
                `cfps/${cfpId}/emailLog/${logId(
                  kind,
                  proposalId,
                  previousReleaseId,
                  primary ? undefined : uid,
                )}`,
              ),
              targetRef: db.doc(
                `cfps/${cfpId}/emailLog/${logId(
                  kind,
                  proposalId,
                  releaseRef.id,
                  primary ? undefined : uid,
                )}`,
              ),
            })),
          ),
        ),
        ...cancelledCarrySources.map(({ proposalId, entryId, uid, primary, sourceRef }) => ({
          proposalId,
          entryId,
          uid,
          sourceRef,
          targetRef: db.doc(
            `cfps/${cfpId}/emailLog/${logId(
              'schedule_cancelled',
              proposalId,
              releaseRef.id,
              primary ? undefined : uid,
            )}`,
          ),
        })),
      ]
    : [];
  const version =
    Math.max(
      Number(configSnap.get('sharedVersion') ?? 0),
      Number(configSnap.get('publishedVersion') ?? 0),
      Number(previousRelease?.get('version') ?? 0),
    ) + 1;
  const { revision, speakerNotificationCount } = await db.runTransaction(async (tx) => {
    const allProposalIds = [
      ...new Set([
        ...proposalEntries.map((entry) => entry.proposalId),
        ...changeRecipients.map(({ change }) => change.proposalId),
      ]),
    ];
    const proposalRefs = allProposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`));
    const speakerIds = [
      ...new Set(changeProposalSnaps.flatMap((snap) => (snap.get('speakerIds') ?? []) as string[])),
    ];
    const speakerRefs = speakerIds.map((id) => db.doc(`speakers/${id}`));
    const participantKeys = [
      ...new Map(
        changeRecipients.map(({ change, uid }) => [
          `${change.proposalId}\u0000${uid}`,
          { proposalId: change.proposalId, uid },
        ]),
      ).values(),
    ];
    const participantRefs = participantKeys.map(({ proposalId, uid }) =>
      speakerParticipantRef(db, cfpId, proposalId, uid),
    );
    const emailRefs = changeRecipients.map(({ change, uid, primary }) =>
      db.doc(
        `cfps/${cfpId}/emailLog/${logId(
          change.kind,
          change.proposalId,
          releaseRef.id,
          primary ? undefined : uid,
        )}`,
      ),
    );
    const carrySourceRefs = carryCandidates.map((candidate) => candidate.sourceRef);
    const carryTargetRefs = carryCandidates.map((candidate) => candidate.targetRef);
    const comparisonRefs = previousReleaseId
      ? [
          db.doc(`cfps/${cfpId}/scheduleReleases/${previousReleaseId}`),
          scheduleReleaseSourceRef(cfpId, previousReleaseId),
        ]
      : [];
    const snapshots = await tx.getAll(
      scheduleConfigRef(cfpId),
      db.doc(`cfps/${cfpId}`),
      scheduleSubmissionFormRef(cfpId),
      ...comparisonRefs,
      ...proposalRefs,
      ...speakerRefs,
      ...participantRefs,
      ...emailRefs,
      ...carrySourceRefs,
      ...carryTargetRefs,
    );
    const freshConfig = snapshots[0];
    const cfpSnap = snapshots[1];
    const freshForm = snapshots[2];
    const freshFormValue = scheduleFormFrom(freshForm);
    const dataStart = 3 + comparisonRefs.length;
    const freshPreviousRelease = previousReleaseId ? snapshots[3] : null;
    const freshPreviousSource = previousReleaseId ? snapshots[4] : null;
    const freshProposals = snapshots.slice(dataStart, dataStart + proposalRefs.length);
    const freshSpeakers = snapshots.slice(
      dataStart + proposalRefs.length,
      dataStart + proposalRefs.length + speakerRefs.length,
    );
    const participantStart = dataStart + proposalRefs.length + speakerRefs.length;
    const freshParticipants = snapshots.slice(
      participantStart,
      participantStart + participantRefs.length,
    );
    const emailStart = participantStart + participantRefs.length;
    const existingEmails = snapshots.slice(emailStart, emailStart + emailRefs.length);
    const carrySources = snapshots.slice(
      emailStart + emailRefs.length,
      emailStart + emailRefs.length + carrySourceRefs.length,
    );
    const carryTargets = snapshots.slice(
      emailStart + emailRefs.length + carrySourceRefs.length,
    );
    if (!cfpSnap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfpSnap.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    assertScheduleRevision(Number(freshConfig.get('revision') ?? 0), input.expectedRevision);
    const freshPreviousReleaseId = (cfpSnap.get('sharedScheduleId') ??
      cfpSnap.get('publishedScheduleId')) as string | undefined;
    if (freshPreviousReleaseId !== previousReleaseId) {
      throw new HttpsError(
        'aborted',
        'The shared schedule changed in another tab. Reload it before sharing again.',
      );
    }
    const freshProjection = sharedProjection(
      scheduleConfigFrom(freshConfig.data()),
      entries,
      new Map(freshProposals.map((snap) => [snap.id, snap])),
      freshFormValue,
    );
    if (freshProjection.fingerprint !== projection.fingerprint) {
      throw new HttpsError(
        'aborted',
        'The schedule content changed while the preview was being shared. Try again.',
      );
    }
    const freshPreviousFingerprint = String(
      freshPreviousSource?.get('sourceFingerprint') ??
        freshPreviousRelease?.get('sourceFingerprint') ??
        '',
    );
    const freshProjectionChanged =
      freshPreviousRelease?.exists !== true ||
      !freshPreviousFingerprint ||
      freshPreviousFingerprint !== freshProjection.fingerprint;
    if (freshConfig.get('needsAttention') !== true && !freshProjectionChanged) {
      throw new HttpsError('failed-precondition', 'There are no unpublished schedule changes.');
    }
    let writeCount = 0;
    const countWrite = () => {
      writeCount += 1;
      // Firestore caps a transaction at 500 writes. Leave room for SDK-level
      // transforms rather than committing a release whose pointer cannot land.
      if (writeCount > 490) {
        throw new HttpsError(
          'resource-exhausted',
          'This schedule release is too large to share in one safe operation.',
        );
      }
    };

    countWrite();
    tx.create(releaseRef, {
      version,
      timeZone: config.timeZone,
      days: config.days,
      rooms: config.rooms,
    });
    countWrite();
    tx.create(scheduleReleaseSourceRef(cfpId, releaseRef.id), {
      sourceRevision: current,
      sourceFingerprint: projection.fingerprint,
      taxonomyFingerprint: scheduleTaxonomyFingerprint(freshFormValue),
      sharedBy: byUid,
      sharedAt: FieldValue.serverTimestamp(),
    });
    for (const sharedEntry of sharedEntries) {
      const { id, ...stored } = sharedEntry;
      countWrite();
      tx.create(releaseRef.collection('entries').doc(id), stored);
    }
    const next = current;
    countWrite();
    tx.update(scheduleConfigRef(cfpId), {
      sharedVersion: version,
      sharedRevision: current,
      sharedFingerprint: projection.fingerprint,
      sharedTaxonomyFingerprint: scheduleTaxonomyFingerprint(freshFormValue),
      needsAttention: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    countWrite();
    tx.update(db.doc(`cfps/${cfpId}`), {
      sharedScheduleId: releaseRef.id,
      sharedScheduleAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const includedProposalIds = new Set(
      sharedEntries
        .filter((entry) => entry.kind === 'proposal')
        .map((entry) => entry.proposalId),
    );
    for (const entry of proposalEntries) {
      if (entry.assignedLanguage && includedProposalIds.has(entry.proposalId)) {
        countWrite();
        tx.update(db.doc(`cfps/${cfpId}/proposals/${entry.proposalId}`), {
          assignedLanguage: entry.assignedLanguage,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    const freshProposalMap = new Map(freshProposals.map((snap) => [snap.id, snap]));
    const freshSpeakerMap = new Map(freshSpeakers.map((snap) => [snap.id, snap]));
    const freshParticipantMap = new Map(
      freshParticipants.map((participant, index) => [
        `${participantKeys[index].proposalId}\u0000${participantKeys[index].uid}`,
        participant,
      ]),
    );
    let speakerNotificationCount = 0;
    for (const [index, recipient] of changeRecipients.entries()) {
      if (existingEmails[index]?.exists) continue;
      const { change, uid: speakerId } = recipient;
      const proposal = freshProposalMap.get(change.proposalId);
      if (change.kind !== 'schedule_cancelled' && proposal?.get('status') !== 'confirmed') {
        continue;
      }
      if (!proposalSpeakerIds(proposal?.data() ?? {}).includes(speakerId)) continue;
      const speaker = speakerId ? freshSpeakerMap.get(speakerId) : undefined;
      const to = speaker?.get('email') as string | undefined;
      if (!to) continue;
      const locale = speaker?.get('locale') === 'fr' ? 'fr' : 'en';
      const isPrimary = primarySpeakerId(proposal!.data()!) === speakerId;
      const participant = freshParticipantMap.get(`${change.proposalId}\u0000${speakerId}`);
      const date = calendarDate(change.date);
      const scheduleDate = date
        ? new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
            dateStyle: 'full',
            timeZone: 'UTC',
          }).format(date)
        : change.date;
      countWrite();
      tx.create(emailRefs[index], {
        kind: change.kind,
        proposalId: change.proposalId,
        dedupeKey: releaseRef.id,
        recipientUid: speakerId,
        to,
        locale,
        data: {
          speakerName: (speaker?.get('name') as string) || to,
          title: change.title || (proposal?.get('title') as string) || '',
          needsVisa: usesPerSpeakerLifecycle(proposal!.data()!)
            ? participant?.get('attendance')?.needsVisa === true
            : isPrimary && proposal?.get('attendance')?.needsVisa === true,
          scheduleDate,
          scheduleTime: `${change.startsAt} (${config.timeZone})`,
          scheduleRoom: change.room ? localised(change.room.name, locale) : '',
          scheduleEntryId: change.entryId,
        },
        status: 'held' satisfies EmailStatus,
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      speakerNotificationCount += 1;
    }
    for (const [index, candidate] of carryCandidates.entries()) {
      const source = carrySources[index];
      const sourceStatus = source?.exists
        ? (source.get('status') as EmailStatus | undefined)
        : undefined;
      if (
        !source?.exists ||
        !sourceStatus ||
        !CARRY_SCHEDULE_EMAIL_STATUSES.has(sourceStatus) ||
        carryTargets[index]?.exists
      ) {
        continue;
      }
      const sourceData = source.data()!;
      const proposal = freshProposalMap.get(candidate.proposalId);
      if (!proposalSpeakerIds(proposal?.data() ?? {}).includes(candidate.uid)) continue;
      if (
        sourceData.kind !== 'schedule_cancelled' &&
        proposal?.get('status') !== 'confirmed'
      ) {
        continue;
      }
      countWrite();
      tx.create(candidate.targetRef, {
        ...sourceData,
        dedupeKey: releaseRef.id,
        recipientUid: candidate.uid,
        data: {
          ...(sourceData.data as Record<string, unknown>),
          scheduleEntryId: candidate.entryId,
        },
        status: sourceStatus,
        createdAt: FieldValue.serverTimestamp(),
      });
      speakerNotificationCount += 1;
    }
    return { revision: next, speakerNotificationCount };
  });
  logger.info('schedule preview shared', {
    cfpId,
    releaseId: releaseRef.id,
    version,
    entries: sharedEntries.length,
    omitted: projection.omittedCount,
    byUid,
  });
  let committeeNotificationCount = 0;
  try {
    committeeNotificationCount = await queueStaffNotifications(
      cfpId,
      'committee_schedule_shared',
      releaseRef.id,
      [byUid],
    );
  } catch (error) {
    logger.error('committee schedule notifications will be retried by the pointer trigger', {
      cfpId,
      releaseId: releaseRef.id,
      error: String(error),
    });
  }
  return {
    ok: true,
    releaseId: releaseRef.id,
    version,
    revision,
    sharedCount: sharedEntries.length,
    omittedCount: projection.omittedCount,
    committeeNotificationCount,
    speakerNotificationCount,
  };
});

export const notifyCommitteeOnScheduleShared = onDocumentWritten(
  {
    document: 'cfps/{cfpId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;
    const releaseId = String(after.get('sharedScheduleId') ?? '');
    if (!releaseId || releaseId === String(before?.get('sharedScheduleId') ?? '')) return;
    if (
      !before?.get('sharedScheduleId') &&
      before?.get('publishedScheduleId') === releaseId &&
      !after.get('publishedScheduleId')
    ) {
      return;
    }
    const source = await scheduleReleaseSourceRef(event.params.cfpId, releaseId).get();
    const sharedBy = String(source.get('sharedBy') ?? '');
    if (!sharedBy) return;
    const notified = await queueStaffNotifications(
      event.params.cfpId,
      'committee_schedule_shared',
      releaseId,
      [sharedBy],
    );
    logger.info('committee schedule notifications queued', {
      cfpId: event.params.cfpId,
      releaseId,
      notified,
    });
  },
);

const callableTime = (value: unknown): unknown =>
  value instanceof Timestamp ? value.toMillis() : (value ?? null);

export const getSharedSchedule = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireVerifiedUid(request, 'view the shared schedule');
  const role = await roleOn(cfpId, uid);
  const audience = sharedScheduleAudience(role);
  return db.runTransaction(async (tx) => {
    const cfpSnap = await tx.get(db.doc(`cfps/${cfpId}`));
    if (!cfpSnap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    const releaseId = (cfpSnap.get('sharedScheduleId') ??
      cfpSnap.get('publishedScheduleId')) as string | undefined;
    if (!releaseId) {
      return { ok: true, audience, schedule: null, entries: [], stale: false };
    }

    const releaseRef = db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`);
    const [release, releaseSource, releaseEntriesSnap, configSnap, formSnap] =
      await Promise.all([
        tx.get(releaseRef),
        tx.get(scheduleReleaseSourceRef(cfpId, releaseId)),
        tx.get(releaseRef.collection('entries')),
        tx.get(scheduleConfigRef(cfpId)),
        tx.get(scheduleSubmissionFormRef(cfpId)),
      ]);
    if (!release.exists) {
      throw new HttpsError('failed-precondition', 'The shared schedule is unavailable.');
    }

    const sourceRevision = Number(
      releaseSource.get('sourceRevision') ?? release.get('sourceRevision') ?? 0,
    );
    const sourceFingerprint = String(
      releaseSource.get('sourceFingerprint') ?? release.get('sourceFingerprint') ?? '',
    );
    const releaseEntries = releaseEntriesSnap.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as PublishedScheduleEntry,
    );
    const form = scheduleFormFrom(formSnap);
    const sourceTaxonomyFingerprint = String(
      releaseSource.get('taxonomyFingerprint') ?? '',
    );
    const taxonomyChanged =
      Boolean(sourceTaxonomyFingerprint) &&
      sourceTaxonomyFingerprint !== scheduleTaxonomyFingerprint(form);
    const schedule: SharedSchedule = {
      id: release.id,
      version: Number(release.get('version') ?? 0),
      timeZone: String(release.get('timeZone') ?? ''),
      days: (release.get('days') ?? []) as ScheduleDay[],
      rooms: (release.get('rooms') ?? []) as ScheduleRoom[],
      sourceRevision,
      sharedAt: callableTime(releaseSource.get('sharedAt') ?? release.get('sharedAt')),
      ...(release.get('publishedAt')
        ? { publishedAt: callableTime(release.get('publishedAt')) }
        : {}),
    };

    if (audience === 'speaker') {
      const ownProposals = await tx.get(
        db
          .collection(`cfps/${cfpId}/proposals`)
          .where('speakerIds', 'array-contains', uid),
      );
      const ownConfirmedSpeakers = new Map(
        ownProposals.docs
          .filter((proposal) => proposal.get('status') === 'confirmed')
          .map((proposal) => [proposal.id, (proposal.get('speakerIds') ?? []) as string[]]),
      );
      if (ownConfirmedSpeakers.size === 0) {
        throw new HttpsError(
          'permission-denied',
          'You have no confirmed proposal for this shared schedule.',
        );
      }
      const visibleEntries = sharedScheduleEntriesFor(
        releaseEntries,
        audience,
        uid,
        ownConfirmedSpeakers,
      );
      const releaseConfig = scheduleConfigFrom(release.data());
      const stale =
        !configSnap.exists ||
        configSnap.get('needsAttention') === true ||
        taxonomyChanged ||
        sourceRevision !== Number(configSnap.get('revision') ?? 0) ||
        sourceFingerprint !== scheduleProjectionFingerprint(releaseConfig, releaseEntries) ||
        (Boolean(sourceTaxonomyFingerprint) &&
          sourceFingerprint !==
            scheduleProjectionFingerprint(
              releaseConfig,
              scheduleEntriesWithTaxonomyLabels(releaseEntries, form),
            ));
      return {
        ok: true,
        audience,
        schedule: sharedScheduleForEntries(schedule, visibleEntries),
        entries: visibleEntries,
        stale,
      };
    }

    const draftSnap = await tx.get(scheduleDraft(cfpId));
    const draftEntries = draftSnap.docs.map((entry) =>
      scheduleEntryFrom({ id: entry.id, ...entry.data() }),
    );
    const proposalIds = [
      ...new Set([
        ...releaseEntries
          .filter((entry) => entry.kind === 'proposal')
          .map((entry) => entry.proposalId),
        ...draftEntries
          .filter(
            (entry): entry is Extract<ScheduleEntry, { kind: 'proposal' }> =>
              entry.kind === 'proposal',
          )
          .map((entry) => entry.proposalId),
      ]),
    ];
    const proposalSnaps = proposalIds.length
      ? await tx.getAll(
          ...proposalIds.map((proposalId) =>
            db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
          ),
        )
      : [];
    const proposals = new Map(proposalSnaps.map((proposal) => [proposal.id, proposal]));
    const confirmedSpeakers = new Map(
      proposalSnaps
        .filter((proposal) => proposal.exists && proposal.get('status') === 'confirmed')
        .map((proposal) => [proposal.id, (proposal.get('speakerIds') ?? []) as string[]]),
    );
    const visibleEntries = sharedScheduleEntriesFor(
      releaseEntries,
      audience,
      uid,
      confirmedSpeakers,
    );

    let stale =
      !configSnap.exists || configSnap.get('needsAttention') === true || taxonomyChanged;
    if (configSnap.exists) {
      try {
        const config = scheduleConfigFrom(configSnap.data());
        const currentProjection = sharedProjection(config, draftEntries, proposals, form);
        const releaseConfig = scheduleConfigFrom(release.data());
        stale =
          stale ||
          sourceRevision !== Number(configSnap.get('revision') ?? 0) ||
          sourceFingerprint !== currentProjection.fingerprint ||
          sourceFingerprint !== scheduleProjectionFingerprint(releaseConfig, releaseEntries);
      } catch {
        stale = true;
      }
    }
    return { ok: true, audience, schedule, entries: visibleEntries, stale };
  });
});

export const publishSchedule = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'publish the schedule');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const result = await db.runTransaction(async (tx) => {
    const configRef = scheduleConfigRef(cfpId);
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [configSnap, cfpSnap] = await tx.getAll(configRef, cfpRef);
    if (!cfpSnap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfpSnap.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!configSnap.exists) {
      throw new HttpsError('failed-precondition', 'Configure the schedule first.');
    }
    const revision = Number(configSnap.get('revision') ?? 0);
    assertScheduleRevision(revision, input.expectedRevision);
    const releaseId = cfpSnap.get('sharedScheduleId') as string | undefined;
    if (!releaseId) {
      throw new HttpsError('failed-precondition', 'Share the schedule preview before publishing.');
    }
    if (cfpSnap.get('publishedScheduleId') === releaseId) {
      throw new HttpsError('failed-precondition', 'That schedule is already public.');
    }
    if (configSnap.get('needsAttention') === true) {
      throw new HttpsError(
        'failed-precondition',
        'The shared schedule is out of date. Share it again before publishing.',
      );
    }

    const releaseRef = db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`);
    const [release, releaseSource, releaseEntriesSnap, draftSnap, formSnap] = await Promise.all([
      tx.get(releaseRef),
      tx.get(scheduleReleaseSourceRef(cfpId, releaseId)),
      tx.get(releaseRef.collection('entries')),
      tx.get(scheduleDraft(cfpId)),
      tx.get(scheduleSubmissionFormRef(cfpId)),
    ]);
    if (!release.exists) {
      throw new HttpsError('failed-precondition', 'The shared schedule is unavailable.');
    }
    const config = scheduleConfigFrom(configSnap.data());
    const form = scheduleFormFrom(formSnap);
    const configProblem = validateScheduleConfig(config);
    if (configProblem) throw new HttpsError('invalid-argument', configProblem);
    const draftEntries = draftSnap.docs.map((entry) =>
      scheduleEntryFrom({ id: entry.id, ...entry.data() }),
    );
    const proposalIds = [
      ...new Set(
        draftEntries
          .filter(
            (entry): entry is Extract<ScheduleEntry, { kind: 'proposal' }> =>
              entry.kind === 'proposal',
          )
          .map((entry) => entry.proposalId),
      ),
    ];
    const proposalSnaps = proposalIds.length
      ? await tx.getAll(
          ...proposalIds.map((proposalId) =>
            db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
          ),
        )
      : [];
    const projection = sharedProjection(
      config,
      draftEntries,
      new Map(proposalSnaps.map((proposal) => [proposal.id, proposal])),
      form,
    );
    const releaseEntries = releaseEntriesSnap.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as PublishedScheduleEntry,
    );
    const sourceFingerprint = String(
      releaseSource.get('sourceFingerprint') ?? release.get('sourceFingerprint') ?? '',
    );
    const sourceRevision = Number(
      releaseSource.get('sourceRevision') ?? release.get('sourceRevision') ?? -1,
    );
    const sourceTaxonomyFingerprint = String(
      releaseSource.get('taxonomyFingerprint') ?? '',
    );
    const currentTaxonomyFingerprint = scheduleTaxonomyFingerprint(form);
    const releaseFingerprint = scheduleProjectionFingerprint(
      scheduleConfigFrom(release.data()),
      releaseEntries,
    );
    if (
      sourceRevision !== revision ||
      Number(configSnap.get('sharedRevision') ?? -1) !== revision ||
      String(configSnap.get('sharedFingerprint') ?? '') !== sourceFingerprint ||
      (sourceTaxonomyFingerprint &&
        sourceTaxonomyFingerprint !== currentTaxonomyFingerprint) ||
      (String(configSnap.get('sharedTaxonomyFingerprint') ?? '') &&
        String(configSnap.get('sharedTaxonomyFingerprint')) !== currentTaxonomyFingerprint) ||
      projection.fingerprint !== sourceFingerprint ||
      releaseFingerprint !== sourceFingerprint
    ) {
      throw new HttpsError(
        'failed-precondition',
        'The shared schedule is out of date. Share it again before publishing.',
      );
    }

    if (!release.get('publishedAt')) {
      tx.update(releaseRef, { publishedAt: FieldValue.serverTimestamp() });
    }
    tx.update(configRef, {
      publishedVersion: Number(release.get('version') ?? 0),
      publishedRevision: revision,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(cfpRef, {
      publishedScheduleId: releaseId,
      publishedScheduleAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { releaseId, version: Number(release.get('version') ?? 0), revision };
  });
  logger.info('shared schedule published', { cfpId, byUid, ...result });
  return { ok: true, ...result };
});

export const unpublishSchedule = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'take the public schedule offline');
  const result = await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const cfpSnap = await tx.get(cfpRef);
    if (!cfpSnap.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfpSnap.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    const releaseId = cfpSnap.get('publishedScheduleId') as string | undefined;
    if (!releaseId) return { releaseId: null, version: null };
    const release = await tx.get(db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`));
    const migrateLegacyPreview = !cfpSnap.get('sharedScheduleId');
    tx.update(cfpRef, {
      ...(migrateLegacyPreview
        ? {
            sharedScheduleId: releaseId,
            sharedScheduleAt:
              cfpSnap.get('publishedScheduleAt') ?? FieldValue.serverTimestamp(),
          }
        : {}),
      publishedScheduleId: FieldValue.delete(),
      publishedScheduleAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (migrateLegacyPreview) {
      tx.set(
        scheduleConfigRef(cfpId),
        { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    return {
      releaseId,
      version: release.exists ? Number(release.get('version') ?? 0) : null,
    };
  });
  logger.info('public schedule taken offline', { cfpId, byUid, ...result });
  return { ok: true, ...result };
});

export const cancelPublishedSession = onDocumentWritten(
  {
    document: 'cfps/{cfpId}/proposals/{proposalId}',
    region: 'northamerica-northeast1',
    maxInstances: 10,
    retry: true,
  },
  async (event) => {
    // Creation and deletion are not decision transitions. In particular, a
    // delayed event from deleting an old CFP must not cancel a newly recreated
    // proposal that happens to reuse the same path.
    if (!event.data?.before.exists || !event.data.after.exists) return;
    const beforeStatus = event.data?.before.get('status');
    const afterStatus = event.data?.after.get('status');
    if (beforeStatus === afterStatus) return;
    const { cfpId, proposalId } = event.params;
    const cfpSnap = await db.doc(`cfps/${cfpId}`).get();
    if (!cfpSnap.exists || cfpSnap.get('archived') === true) return;
    const releaseIds = [
      ...new Set(
        [cfpSnap.get('sharedScheduleId'), cfpSnap.get('publishedScheduleId')].filter(
          (value): value is string => typeof value === 'string' && Boolean(value),
        ),
      ),
    ];
    const [draftMatching, ...releaseMatches] = await Promise.all([
      scheduleDraft(cfpId).where('proposalId', '==', proposalId).get(),
      ...releaseIds.map((releaseId) =>
        db
          .collection(`cfps/${cfpId}/scheduleReleases/${releaseId}/entries`)
          .where('proposalId', '==', proposalId)
          .get(),
      ),
    ]);
    const hasReleaseEntry = releaseMatches.some((matching) => !matching.empty);
    if (draftMatching.empty && !hasReleaseEntry) return;

    const cancelled = beforeStatus === 'confirmed' && afterStatus !== 'confirmed';
    const observedReleaseId = scheduleEmailReleaseId(cfpSnap);
    const observedReleaseIndex = releaseIds.indexOf(observedReleaseId);
    const observedEntries =
      observedReleaseIndex >= 0 ? releaseMatches[observedReleaseIndex].docs : [];
    await db.runTransaction(async (tx) => {
      const [freshCfp, ...freshObservedEntries] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        ...observedEntries.map((entry) => entry.ref),
      );
      if (!freshCfp.exists || freshCfp.get('archived') === true) return;
      if (cancelled) {
        for (const matching of releaseMatches) {
          for (const entry of matching.docs) {
            tx.update(entry.ref, {
              cancelled: true,
              cancelledAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      // A share that commits after this trigger starts already re-reads the
      // proposal status. Do not let the delayed trigger stale that newer snapshot.
      if (scheduleEmailReleaseId(freshCfp) !== observedReleaseId) return;
      const expectedEntryIds =
        afterStatus === 'confirmed' ? draftMatching.docs.map((entry) => entry.id).sort() : [];
      const actualEntryIds = freshObservedEntries
        .filter((entry) => entry.exists)
        .map((entry) => entry.id)
        .sort();
      const aligned =
        expectedEntryIds.length === actualEntryIds.length &&
        expectedEntryIds.every((entryId, index) => entryId === actualEntryIds[index]) &&
        freshObservedEntries.every(
          (entry) => !entry.exists || entry.get('cancelled') !== true,
        );
      if (!aligned) {
        tx.set(
          scheduleConfigRef(cfpId),
          { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    });
    if (!cancelled || !hasReleaseEntry) {
      logger.info('scheduled proposal status changed', {
        cfpId,
        proposalId,
        beforeStatus,
        afterStatus,
      });
      return;
    }

    const preferredReleaseId = scheduleEmailReleaseId(
      await db.doc(`cfps/${cfpId}`).get(),
    );
    const preferredIndex = releaseIds.indexOf(preferredReleaseId);
    const chosenIndex =
      preferredIndex >= 0 && !releaseMatches[preferredIndex].empty
        ? preferredIndex
        : releaseMatches.findIndex((matching) => !matching.empty);
    const entryReleaseId = releaseIds[chosenIndex];
    const entry = releaseMatches[chosenIndex].docs[0];
    const release = await db.doc(`cfps/${cfpId}/scheduleReleases/${entryReleaseId}`).get();
    const room = ((release.get('rooms') ?? []) as ScheduleRoom[]).find(
      (candidate) => candidate.id === entry.get('roomId'),
    );
    const cancellationTime = String(entry.get('startsAt') ?? '');
    const cancellationTimeZone = String(release.get('timeZone') ?? '');
    await db.runTransaction(async (tx) => {
      await assertCfpNotArchived(tx, cfpId);
      const proposal = event.data?.after.data();
      if (!proposal) return;
      const contexts = await speakerEmailContexts(tx, cfpId, proposalId, proposal);
      const date = calendarDate(String(entry.get('date') ?? ''));
      await queueEmails(
        db,
        tx,
        cfpId,
        contexts.map((context) => ({
          kind: 'schedule_cancelled' as const,
          proposalId,
          dedupeKey: preferredReleaseId || entryReleaseId,
          recipientUid: context.uid,
          logIdSuffix: context.primary ? undefined : context.uid,
          to: context.to,
          locale: context.locale,
          data: {
            ...context.data,
            scheduleDate: date
              ? new Intl.DateTimeFormat(context.locale === 'fr' ? 'fr-CA' : 'en-CA', {
                  dateStyle: 'full',
                  timeZone: 'UTC',
                }).format(date)
              : String(entry.get('date') ?? ''),
            scheduleTime: cancellationTimeZone
              ? `${cancellationTime} (${cancellationTimeZone})`
              : cancellationTime,
            scheduleRoom: room ? localised(room.name, context.locale) : '',
            scheduleEntryId: entry.id,
          },
        })),
      );
    });
    logger.info('shared and public session cancelled', {
      cfpId,
      proposalId,
      releaseIds,
    });
  },
);
