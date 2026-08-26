/**
 * §6 makes `status` and `aggregate` function-writable only, so the
 * draft → submitted transition cannot happen in the browser. That gives one
 * server-side chokepoint which re-runs validation and re-checks the deadline
 * against the server clock — neither can be bypassed by posting to Firestore.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import { inStatusSet, LIMITS, PROPOSAL_STATUSES, SCORES, STATUS_SETS } from '../../shared/enums';
import { speakerSchema, submissionSchema } from '../../shared/schema';
import {
  attendanceNeedsVisa,
  NEW_CFP_SUBMISSION_FORM,
  mergeSubmissionForm,
  normaliseSubmissionForm,
  rawSubmissionAttendanceFault,
  reviewerAttendanceEnabled,
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
  type TemplateOverrides,
} from '../../shared/emailTemplates';
import {
  emailDeliveryReadiness,
  senderMismatch,
  validSenderDisplayName,
  validateSettings,
  type EmailDeliveryReadiness,
  type EmailSettings,
} from '../../shared/emailSettings';
import {
  EMPTY_FORM,
  confirmFormFromData,
  FORM_LIMITS,
  IMAGE_TYPES,
  SPEAKER_PHOTO_KEY,
  isConfirmedHeadshotPath,
  headshotPath,
  isSpeakerProfilePhotoPath,
  speakerProfilePhotoPath,
  workingHeadshotPath,
  normaliseForm,
  validateAnswers,
  validateForm,
  localised,
  type Answers,
  type ConfirmForm,
  type ConfirmedSpeakerPhoto,
  type HeadshotUploadPointer,
  type HeadshotUploads,
  type SpeakerProfilePhoto,
} from '../../shared/confirmForm';
import {
  calendarDate,
  validateCfp,
  validateCfpId,
  validateProfile,
  type CfpProfile,
  type CfpRole,
} from '../../shared/cfp';
import type { CfpTheme, SpeakerSnapshot } from '../../shared/types';
import {
  ORG_LIMITS,
  effectiveActiveEventLimit,
  effectiveOrgOwnershipLimit,
  validateOrgSlug,
  type OrgRole,
} from '../../shared/org';
import { normaliseThemeColor } from '../../shared/cfpTheme';
import {
  archiveOwnershipTransfer,
  ownershipTransferExpiry,
  ownershipTransferIsPending,
  ownershipTransferView,
} from './ownership';
import {
  claim,
  grant,
  normalizeEmail,
  revoke,
  RoleError,
  createInviteLink,
  revokeInviteLink,
  getInviteLinkInfo,
  claimInviteLink,
  initiateEventOwnershipTransfer as initiateEventOwnershipTransferImpl,
  acceptEventOwnershipTransfer as acceptEventOwnershipTransferImpl,
  cancelEventOwnershipTransfer as cancelEventOwnershipTransferImpl,
  getEventOwnershipTransfer as getEventOwnershipTransferImpl,
} from './roles';
import {
  claimPlatformRole,
  grantPlatformAdmin as grantPlatformAdministrator,
  listPlatformAccess,
  revokePlatformAdmin as revokePlatformAdministrator,
  initiatePlatformOwnershipTransfer as initiatePlatformOwnershipTransferImpl,
  acceptPlatformOwnershipTransfer as acceptPlatformOwnershipTransferImpl,
  cancelPlatformOwnershipTransfer as cancelPlatformOwnershipTransferImpl,
  getPlatformOwnershipTransfer as getPlatformOwnershipTransferImpl,
} from './platform';
import {
  cfpUrl,
  deliver,
  loadPlatform,
  logId,
  queueEmail,
  queueEmails,
  sendViaResend,
  isCoSpeakerInvitationEmail,
  isProfileUpdateRequestEmail,
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
  decodeSpeakerProfilePhotoUpload,
  customScheduleSpeakerPhotoPath,
  findMigratedSpeakerUploadedHeadshots,
  findSpeakerUploadedHeadshots,
  findUploadedHeadshots,
  freezeHeadshot,
  freezeLegacyHeadshotAnswer,
  freezeLegacyHeadshots,
  freezeSpeakerUploadedHeadshots,
  freezeSpeakerProfilePhoto,
  freezeUploadedHeadshots,
  isSpeakerConfirmedHeadshotPath,
  readStoredHeadshot,
  publicSpeakerPhotoDerivative,
  speakerProfilePhotoFrom,
  speakerProfilePhotoMatches,
  speakerConfirmedHeadshotPath,
  speakerWorkingHeadshotFrom,
  speakerWorkingHeadshotMatches,
  speakerWorkingHeadshotPath,
  workingHeadshotFrom,
  workingHeadshotMatches,
  validCustomScheduleSpeakerPhotoRef,
} from './headshots';
import {
  customScheduleSpeakerPhotoAssetFrom,
  type CustomScheduleSpeakerPhotoAsset,
} from './customSchedulePhotos';
import {
  coSpeakerSignInInvitationStillTrue,
  coSpeakerInvitationStillTrue,
  confirmationResponse,
  currentScheduleReleaseContainsProposal,
  currentReleasedSpeakerIds,
  everySpeakerConfirmed,
  primarySpeakerId,
  proposalEventIsCurrent,
  proposalSpeakerIds,
  profileUpdateRequestStillTrue,
  scheduleCancellationSnapshotIsCurrent,
  scheduleCancellationRecipientIds,
  scheduleEmailStillTrue,
  scheduleReleaseIds,
  scheduleReleaseProposalEntryId,
  speakerConfirmationRef,
  speakerParticipantRef,
  usesPerSpeakerLifecycle,
} from './speakerLifecycle';
import { scheduleReleaseNeedsReshare } from './scheduleReadiness';
import {
  newlyScheduledSpeakerIds,
  placementNotificationChanged,
  previousReleaseSpeakerIds,
} from './scheduleNotifications';
import { clearCfpFirestoreChildren, clearCfpStorage } from './deletion';
import { keyHint, readResendKey, writeResendKey } from './secrets';
import {
  emailDomainBindingMatches,
  emailDomainBindingRef,
  ensureLegacyEmailDomainBinding,
  legacyEmailDomainOwnerIsExact,
  platformEmailDomainBindingMatches,
  supersededStagedEmailDomainId,
} from './emailTenancy';
import {
  boundEmailSender,
  emailConfigurationHasInvalidActiveIdentity,
  emailConfigurationFingerprint,
  emailConfigurationFingerprintInTransaction,
  inferredEventEmailMode,
  loadEmailContentContext,
  resolveEmailConfiguration,
  resolvePlatformEmailConfiguration,
  type EmailSource,
  type EventEmailSettings,
} from './emailConfig';
import {
  addDomain,
  cleanDomain,
  getDomain,
  listDomains,
  ResendError,
  verifyDomain,
} from './domains';
import {
  nextSignInLinkCounter,
  normaliseSignInNetwork,
  signInEmailDeliveryReady,
  signInLinkLimitId,
  SIGN_IN_LINKS_PER_ADDRESS,
  SIGN_IN_LINKS_PER_NETWORK,
  SIGN_IN_LINKS_PER_PLATFORM,
  useFreshHostingOrigin,
} from './authLinks';
import {
  reviewerProposalProjection,
  reviewerTravelParticipantIds,
  type ReviewerParticipantSource,
} from './reviewerProjection';
export {
  getCoSpeakerInvitation,
  getProposalRoster,
  inviteCoSpeaker,
  removeCoSpeaker,
  retryCoSpeakerInvitation,
  respondToCoSpeakerInvitation,
  revokeCoSpeakerInvitation,
} from './coSpeakers';
export {
  cancelProposalSpeakerProfileUpdate,
  completeProposalSpeakerProfileUpdate,
  listSpeakerProfileUpdateRequests,
  previewProposalSpeakerProfile,
  refreshProposalSpeakerSnapshot,
  requestProposalSpeakerProfileUpdate,
} from './profileSnapshots';
import {
  cancelPendingProfileUpdateRequest,
  profileUpdateRequestRef,
  requestStateFrom,
  speakerSnapshotFrom,
} from './profileSnapshots';
import {
  SCHEDULE_LIMITS,
  publicScheduleSpeakers,
  resolvedScheduleLanguage,
  scheduleProposalEligible,
  scheduleTaxonomyLabel,
  scheduleConflicts,
  sharedScheduleAudience,
  sharedScheduleEntriesFor,
  sharedScheduleForEntries,
  validateScheduleConfig,
  validateScheduleEntry,
  type CustomScheduleSpeaker,
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
const EMAIL_REVIEW_BATCH_CAP = 100;

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
  cfp?: DocumentSnapshot,
): void {
  const actual = member.get('role');
  const canonicalOwner = cfp?.get('ownerUid');
  const canonicalOwnerMatches = canonicalOwner === member.id;
  const allowed = role === 'owner'
    ? actual === 'owner' && canonicalOwnerMatches
    : actual === 'owner' || actual === 'admin';
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

/** Archive and deletion are reserved to the event owner. */
async function requireOwner(
  request: { auth?: { uid: string } },
  cfpId: string,
  action: string,
): Promise<string> {
  const uid = requireUid(request, action);
  const [cfp, member] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/members/${uid}`),
  );
  const canonicalOwner = cfp.get('ownerUid');
  if (member.get('role') !== 'owner' || canonicalOwner !== uid) {
    throw new HttpsError('permission-denied', `Only an owner can ${action}.`);
  }
  return uid;
}

/** RoleError carries the code the caller should see; anything else is ours. */
function asHttpsError(error: unknown): HttpsError {
  if (error instanceof RoleError) {
    return new HttpsError(
      error.code,
      error.message,
      error.reason ? { reason: error.reason } : undefined,
    );
  }
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

interface ObservedEmailDelivery {
  delivery: EmailDeliveryReadiness;
  settings: EmailSettings;
  keyHint: string;
  domainId: string;
  domain: string;
  templates: TemplateOverrides;
  source: EmailSource;
  senderMode: EmailSource;
  eventSettings: EventEmailSettings;
  templateOverrides: TemplateOverrides;
  configurationFingerprint: string;
}

/** Reads the credential and Resend itself; a Firestore hint is never proof of readiness. */
async function observeEmailDelivery(cfpId: string): Promise<ObservedEmailDelivery> {
  const [resolved, contentContext, providerSnap, apiKey] = await Promise.all([
    resolveEmailConfiguration(db, cfpId),
    loadEmailContentContext(db, cfpId),
    db.doc('config/emailProvider').get(),
    readResendKey(),
  ]);
  const provider = providerSnap.data() ?? {};
  const active = resolved.source === 'event' ? resolved.eventData : resolved.platformData;
  const domainId = String(active.domainId ?? '');
  const configuredDomain = String(active.domain ?? '');
  const bound = resolved.source === 'event' ? resolved.eventBound : resolved.platformBound;
  // Emulator-only fixture: rules keep config/email closed to browsers, and
  // production ignores the marker even if an imported test export contains it.
  // Delivery still sees the empty emulator secret and records `dry_run`.
  if (
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    active.emulatorDeliveryReady === true &&
    bound
  ) {
    return {
      delivery: emailDeliveryReadiness({
        key: 'present',
        domain: configuredDomain,
        domainStatus: 'verified',
        from: resolved.settings.from,
      }),
      settings: resolved.settings,
      keyHint: String(provider.keyHint ?? ''),
      domainId: resolved.source === 'event' ? domainId : '',
      domain: configuredDomain,
      templates: resolved.templates,
      source: resolved.source,
      senderMode: resolved.senderMode,
      eventSettings: resolved.eventSettings,
      templateOverrides: resolved.templateOverrides,
      configurationFingerprint: emailConfigurationFingerprint(resolved, contentContext),
    };
  }
  let domain = bound ? configuredDomain : '';
  let domainStatus = 'unknown';
  let key: 'present' | 'missing' | 'invalid' | 'unavailable' = apiKey
    ? 'present'
    : 'missing';

  if (apiKey && domainId && bound) {
    try {
      const current = await getDomain(apiKey, domainId);
      domain = current.name;
      domainStatus = current.status;
    } catch (error) {
      if (error instanceof ResendError && error.code === 'failed-precondition') {
        key = 'invalid';
      } else if (error instanceof ResendError && error.code === 'not-found') {
        domain = '';
      } else {
        key = 'unavailable';
      }
    }
  }

  return {
    delivery: emailDeliveryReadiness({ key, domain, domainStatus, from: resolved.settings.from }),
    settings: resolved.settings,
    keyHint: String(provider.keyHint ?? ''),
    domainId: resolved.source === 'event' && bound ? domainId : '',
    domain: bound ? domain : '',
    templates: resolved.templates,
    source: resolved.source,
    senderMode: resolved.senderMode,
    eventSettings: resolved.eventSettings,
    templateOverrides: resolved.templateOverrides,
    configurationFingerprint: emailConfigurationFingerprint(resolved, contentContext),
  };
}

async function observePlatformEmailDelivery() {
  const [resolved, providerSnap, apiKey] = await Promise.all([
    resolvePlatformEmailConfiguration(db),
    db.doc('config/emailProvider').get(),
    readResendKey(),
  ]);
  const provider = providerSnap.data() ?? {};
  const configuredDomainId = String(resolved.data.domainId ?? '');
  const configuredDomain = String(resolved.data.domain ?? '');
  const stagedDomainId = String(resolved.data.stagedDomainId ?? '');
  const stagedDomain = String(resolved.data.stagedDomain ?? '').toLowerCase();
  if (
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    resolved.data.emulatorDeliveryReady === true &&
    resolved.bound
  ) {
    return {
      settings: resolved.settings,
      domainId: configuredDomainId,
      domain: configuredDomain,
      stagedDomainId,
      stagedDomain,
      keyHint: String(provider.keyHint ?? ''),
      delivery: emailDeliveryReadiness({
        key: 'present',
        domain: configuredDomain,
        domainStatus: 'verified',
        from: resolved.settings.from,
      }),
    };
  }

  let domain = resolved.bound ? configuredDomain : '';
  let domainStatus = 'unknown';
  let key: 'present' | 'missing' | 'invalid' | 'unavailable' = apiKey ? 'present' : 'missing';
  if (apiKey && configuredDomainId && resolved.bound) {
    try {
      const current = await getDomain(apiKey, configuredDomainId);
      domain = current.name;
      domainStatus = current.status;
    } catch (error) {
      if (error instanceof ResendError && error.code === 'failed-precondition') key = 'invalid';
      else if (error instanceof ResendError && error.code === 'not-found') domain = '';
      else key = 'unavailable';
    }
  }
  return {
    settings: resolved.settings,
    domainId: resolved.bound ? configuredDomainId : '',
    domain: resolved.bound ? domain : '',
    stagedDomainId,
    stagedDomain,
    keyHint: String(provider.keyHint ?? ''),
    delivery: emailDeliveryReadiness({
      key,
      domain,
      domainStatus,
      from: resolved.settings.from,
    }),
  };
}

function platformDomainEmulatorFixture(
  config: DocumentSnapshot,
  domainId: string,
  domain: string,
) {
  if (
    process.env.FUNCTIONS_EMULATOR !== 'true' ||
    config.get('emulatorDeliveryReady') !== true
  ) {
    return null;
  }
  const staged = config.get('stagedDomainId') === domainId;
  return {
    id: domainId,
    name: domain,
    status: staged ? String(config.get('emulatorStagedDomainStatus') ?? 'verified') : 'verified',
    records: [],
  };
}

async function requireEmailDelivery(cfpId: string): Promise<ObservedEmailDelivery> {
  const observed = await observeEmailDelivery(cfpId);
  if (!observed.delivery.ready) {
    throw new HttpsError(
      'failed-precondition',
      'Email delivery setup is incomplete.',
      {
        reason: 'email_delivery_not_ready',
        problems: observed.delivery.problems,
        domainStatus: observed.delivery.domainStatus,
      },
    );
  }
  return observed;
}

function isScheduleEmail(kind: unknown): kind is EmailKind {
  return SCHEDULE_EMAIL_KINDS.includes(kind as EmailKind);
}

/** Working-placement mail follows the newest shared snapshot, then legacy public data. */
function scheduleEmailReleaseId(cfp: DocumentSnapshot | null | undefined): string {
  return String(cfp?.get('sharedScheduleId') ?? cfp?.get('publishedScheduleId') ?? '');
}

function frozenScheduleBaselineIds(
  proposal: FirebaseFirestore.DocumentData,
): string[] | null {
  const stored = proposal.lateSpeakerScheduleBaselineIds;
  if (
    proposal.lateSpeakerSchedulePreserved !== true ||
    !Array.isArray(stored) ||
    stored.length === 0 ||
    !stored.every((uid) => typeof uid === 'string' && Boolean(uid)) ||
    new Set(stored).size !== stored.length
  ) {
    return null;
  }
  return [...stored];
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
): Promise<{
  sendable: QueryDocumentSnapshot[];
  stale: QueryDocumentSnapshot[];
  recipients: Map<string, string>;
}> {
  if (docs.length === 0) return { sendable: [], stale: [], recipients: new Map() };

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
  if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
    return { sendable: [], stale: docs, recipients: new Map() };
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
  const scheduleSource = currentReleaseId
    ? await scheduleReleaseSourceRef(cfpId, currentReleaseId).get()
    : null;
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
  const speakerRecipientUids = [
    ...new Set(
      docs
        .filter(
          (doc) =>
            !isStaffEmail(doc.get('kind')) &&
            !isRoleInvitationEmail(doc.get('kind')) &&
            !isCoSpeakerInvitationEmail(doc.get('kind')),
        )
        .map((doc) => String(doc.get('recipientUid') ?? ''))
        .filter(Boolean),
    ),
  ];
  const speakerRecipients = speakerRecipientUids.length
    ? await db.getAll(...speakerRecipientUids.map((uid) => db.doc(`speakers/${uid}`)))
    : [];
  const speakerRecipientMap = new Map(speakerRecipients.map((speaker) => [speaker.id, speaker]));
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
  const profileRequestDocs = docs.filter((doc) =>
    isProfileUpdateRequestEmail(doc.get('kind')),
  );
  const profileRequestState = await Promise.all(
    profileRequestDocs.map(async (doc) => {
      const proposalId = String(doc.get('proposalId') ?? '');
      const speakerUid = String(doc.get('recipientUid') ?? '');
      if (!proposalId || proposalId.includes('/') || !speakerUid || speakerUid.includes('/')) {
        return [];
      }
      return db.getAll(
        profileUpdateRequestRef(db, cfpId, proposalId, speakerUid),
        db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
        speakerConfirmationRef(db, cfpId, proposalId, speakerUid),
      );
    }),
  );
  const profileRequestMap = new Map(
    profileRequestDocs.map((doc, index) => [
      doc.id,
      profileRequestState[index],
    ]),
  );
  const recipientFor = (doc: QueryDocumentSnapshot): string => {
    const kind = doc.get('kind');
    if (isStaffEmail(kind)) {
      return staffUserMap.get(String(doc.get('recipientUid') ?? ''))?.email ?? '';
    }
    if (isRoleInvitationEmail(kind)) return String(doc.get('grantEmail') ?? '');
    if (isCoSpeakerInvitationEmail(kind)) return String(doc.get('invitationEmail') ?? '');
    const uid = String(doc.get('recipientUid') ?? '');
    if (uid) return String(speakerRecipientMap.get(uid)?.get('email') ?? '');
    return String(doc.get('to') ?? '');
  };
  const resolvedRecipients = new Map(docs.map((doc) => [doc.id, recipientFor(doc)]));
  const sendable = docs.filter((doc) => {
    const kind = doc.get('kind') as string;
    const holds = DECISION_STILL_TRUE[kind];
    if (!resolvedRecipients.get(doc.id)) return false;
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
    if (isProfileUpdateRequestEmail(kind)) {
      const proposalId = String(doc.get('proposalId') ?? '');
      const speakerUid = String(doc.get('recipientUid') ?? '');
      const [updateRequest, proposal, confirmation] = profileRequestMap.get(doc.id) ?? [];
      return profileUpdateRequestStillTrue(
        kind,
        String(doc.get('profileUpdateRequestId') ?? ''),
        Number(doc.get('profileUpdateRequestGeneration') ?? 0),
        cfpId,
        proposalId,
        speakerUid,
        updateRequest,
        proposal,
        confirmation,
      );
    }
    const recipientUid = String(doc.get('recipientUid') ?? '');
    if (
      recipientUid &&
      !isScheduleEmail(kind) &&
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
        proposalMap.get(doc.get('proposalId') as string),
        recipientUid,
        scheduleReleaseProposalEntryId(
          scheduleSource,
          String(doc.get('proposalId') ?? ''),
        ),
      );
    }
    // A kind with no entry is not a decision at all, so nothing to check.
    return !holds || holds.includes(current.get(doc.get('proposalId') as string) ?? '');
  });
  const sendableIds = new Set(sendable.map((doc) => doc.id));
  return {
    sendable,
    stale: docs.filter((doc) => !sendableIds.has(doc.id)),
    recipients: new Map(
      sendable.map((doc) => [doc.id, resolvedRecipients.get(doc.id)!]),
    ),
  };
}

function reviewedEmailRecipients(
  raw: unknown,
  logIds: readonly string[],
  action: 'release' | 'retry',
): Map<string, string> {
  if (!Array.isArray(raw) || raw.length !== logIds.length) {
    throw new HttpsError(
      'invalid-argument',
      `${action === 'release' ? 'Release' : 'Retry'} requires the exact recipients from the reviewed preview.`,
    );
  }
  if (logIds.length > EMAIL_REVIEW_BATCH_CAP) {
    throw new HttpsError(
      'invalid-argument',
      `Review at most ${EMAIL_REVIEW_BATCH_CAP} messages at a time.`,
    );
  }
  const recipients = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpsError('invalid-argument', 'Each reviewed recipient must name one message.');
    }
    const { logId, to } = item as Record<string, unknown>;
    if (
      typeof logId !== 'string' ||
      !logIds.includes(logId) ||
      recipients.has(logId) ||
      typeof to !== 'string' ||
      !to ||
      to.length > 512 ||
      /[\r\n]/.test(to)
    ) {
      throw new HttpsError('invalid-argument', 'The reviewed recipient list is invalid.');
    }
    recipients.set(logId, to);
  }
  if (recipients.size !== logIds.length) {
    throw new HttpsError('invalid-argument', 'The reviewed recipient list is incomplete.');
  }
  return recipients;
}

function reviewedEmailConfigurationFingerprint(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    throw new HttpsError(
      'invalid-argument',
      'Review the current email delivery setup before continuing.',
    );
  }
  return raw;
}

/** Prevents concurrent releases from re-queuing a row the sender already claimed. */
async function advanceEmailQueue(
  cfpId: string,
  actorUid: string,
  configurationFingerprint: string,
  candidates: DocumentSnapshot[],
  from: EmailStatus[],
  reviewedRecipients: ReadonlyMap<string, string>,
): Promise<{ released: number; stale: number }> {
  if (candidates.length > EMAIL_REVIEW_BATCH_CAP) {
    throw new HttpsError(
      'invalid-argument',
      `Review at most ${EMAIL_REVIEW_BATCH_CAP} messages at a time.`,
    );
  }
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
      const [actor, ...rows] = await tx.getAll(
        db.doc(`cfps/${cfpId}/members/${actorUid}`),
        ...candidateChunk.map((doc) => doc.ref),
      );
      assertMutationActor(actor, 'admin');
      const currentConfigurationFingerprint =
        await emailConfigurationFingerprintInTransaction(db, tx, cfpId);
      if (currentConfigurationFingerprint !== configurationFingerprint) {
        throw new HttpsError(
          'failed-precondition',
          'The email delivery setup changed. Review the queue again.',
          { reason: 'email_configuration_changed' },
        );
      }
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
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      const currentReleaseId = scheduleEmailReleaseId(cfp);
      const scheduleSource = currentReleaseId
        ? await tx.get(scheduleReleaseSourceRef(cfpId, currentReleaseId))
        : null;
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
      const speakerRecipientUids = [
        ...new Set(
          rows
            .filter(
              (row) =>
                !isStaffEmail(row.get('kind')) &&
                !isRoleInvitationEmail(row.get('kind')) &&
                !isCoSpeakerInvitationEmail(row.get('kind')),
            )
            .map((row) => String(row.get('recipientUid') ?? ''))
            .filter(Boolean),
        ),
      ];
      const speakerRecipients = speakerRecipientUids.length
        ? await tx.getAll(...speakerRecipientUids.map((uid) => db.doc(`speakers/${uid}`)))
        : [];
      const speakerRecipientMap = new Map(
        speakerRecipients.map((speaker) => [speaker.id, speaker]),
      );
      const profileRequestRows = rows.filter((row) =>
        isProfileUpdateRequestEmail(row.get('kind')),
      );
      const profileRequestStates = await Promise.all(
        profileRequestRows.map(async (row) => {
          const proposalId = String(row.get('proposalId') ?? '');
          const speakerUid = String(row.get('recipientUid') ?? '');
          if (!proposalId || proposalId.includes('/') || !speakerUid || speakerUid.includes('/')) {
            return [];
          }
          return tx.getAll(
            profileUpdateRequestRef(db, cfpId, proposalId, speakerUid),
            db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
            speakerConfirmationRef(db, cfpId, proposalId, speakerUid),
          );
        }),
      );
      const profileRequestMap = new Map(
        profileRequestRows.map((row, index) => [row.id, profileRequestStates[index]]),
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
        if (isProfileUpdateRequestEmail(row.get('kind'))) {
          const proposalId = String(row.get('proposalId') ?? '');
          const speakerUid = String(row.get('recipientUid') ?? '');
          const [updateRequest, proposal, confirmation] = profileRequestMap.get(row.id) ?? [];
          if (
            !profileUpdateRequestStillTrue(
              row.get('kind'),
              String(row.get('profileUpdateRequestId') ?? ''),
              Number(row.get('profileUpdateRequestGeneration') ?? 0),
              cfpId,
              proposalId,
              speakerUid,
              updateRequest,
              proposal,
              confirmation,
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
          !isScheduleEmail(row.get('kind')) &&
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
              proposalMap.get(row.get('proposalId') as string),
              recipientUid,
              scheduleReleaseProposalEntryId(
                scheduleSource,
                String(row.get('proposalId') ?? ''),
              ),
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
        const kind = row.get('kind');
        const liveTo = isStaffEmail(kind)
          ? staffUsers.get(recipientUid)?.email ?? ''
          : isRoleInvitationEmail(kind)
            ? String(row.get('grantEmail') ?? '')
            : isCoSpeakerInvitationEmail(kind)
              ? String(row.get('invitationEmail') ?? '')
              : recipientUid
                ? String(speakerRecipientMap.get(recipientUid)?.get('email') ?? '')
                : String(row.get('to') ?? '');
        if (!liveTo || reviewedRecipients.get(row.id) !== liveTo) {
          throw new HttpsError(
            'failed-precondition',
            'The reviewed email recipients changed. Review the queue again.',
            { reason: 'email_recipients_changed' },
          );
        }
        tx.update(row.ref, {
          status: 'queued' satisfies EmailStatus,
          to: liveTo,
          reviewedTo: liveTo,
          reviewedEmailConfigurationFingerprint: configurationFingerprint,
          sendingClaimId: FieldValue.delete(),
          sendingStartedAt: FieldValue.delete(),
          attemptedAt: FieldValue.delete(),
          sentAt: FieldValue.delete(),
          providerId: FieldValue.delete(),
          error: FieldValue.delete(),
          errorReason: FieldValue.delete(),
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
  recipientIds?: readonly string[],
): Promise<SpeakerEmailContext[]> {
  const speakerIds = recipientIds
    ? [...new Set(recipientIds.filter((uid) => typeof uid === 'string' && Boolean(uid)))]
    : proposalSpeakerIds(proposal);
  if (speakerIds.length === 0) return [];
  const primary = primarySpeakerId(proposal);
  const perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
  const profileRefs = speakerIds.map((uid) => db.doc(`speakers/${uid}`));
  const submissionFormRef = db.doc(`cfps/${cfpId}/config/submissionForm`);
  const participantRefs = perSpeakerLifecycle
    ? speakerIds.map((uid) =>
        speakerParticipantRef(db, cfpId, proposalId, uid),
      )
    : [];
  const snapshots = await tx.getAll(...profileRefs, ...participantRefs, submissionFormRef);
  const profiles = snapshots.slice(0, profileRefs.length);
  const participants = snapshots.slice(
    profileRefs.length,
    profileRefs.length + participantRefs.length,
  );
  const formSnapshot = snapshots[profileRefs.length + participantRefs.length];
  const form = mergeSubmissionForm(formSnapshot.exists ? formSnapshot.data() : undefined);
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
        needsVisa: attendanceNeedsVisa(
          form,
          perSpeakerLifecycle
            ? participant?.attendance
            : isPrimary
              ? proposal.attendance
              : undefined,
        ),
      },
    }];
  });
}

function speakerMessageRecipientsFingerprint(contexts: readonly SpeakerEmailContext[]): string {
  const recipients = contexts
    .map(({ uid, to, locale, data }) => ({ uid, to: to.trim(), locale, ...data }))
    .sort((left, right) => left.uid.localeCompare(right.uid));
  return createHash('sha256').update(JSON.stringify(recipients)).digest('base64url');
}

async function speakerMessageContexts(
  tx: FirebaseFirestore.Transaction,
  cfpId: string,
  proposalId: string,
): Promise<SpeakerEmailContext[]> {
  const [cfp, proposal] = await tx.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
  );
  if (!cfp.exists || cfp.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
  if (!proposal.exists) throw new HttpsError('not-found', 'No such proposal.');
  if (proposal.get('status') === 'draft') {
    throw new HttpsError('failed-precondition', 'That proposal has not been submitted.');
  }

  const contexts = await speakerEmailContexts(tx, cfpId, proposalId, proposal.data()!);
  if (contexts.length === 0) {
    throw new HttpsError('failed-precondition', 'No address on file for that speaker.');
  }
  return contexts;
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
  kind: 'committee_proposal_submitted',
  subjectId: string,
  excludedUids: readonly string[],
  observedProposal: FirebaseFirestore.DocumentSnapshot,
): Promise<number>;
async function queueStaffNotifications(
  cfpId: string,
  kind: 'committee_schedule_shared',
  subjectId: string,
  excludedUids: readonly string[],
): Promise<number>;
async function queueStaffNotifications(
  cfpId: string,
  kind: StaffEmailKind,
  subjectId: string,
  excludedUids: readonly string[],
  observedProposal?: FirebaseFirestore.DocumentSnapshot,
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
            (kind === 'committee_proposal_submitted' &&
              (!observedProposal ||
                !proposalEventIsCurrent(observedProposal, subject))) ||
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
        // Two causes, two remedies: only the caller's own cap is theirs to
        // clear, and they cannot see a co-speaker's other talks at all.
        {
          reason:
            overLimit === 0 ? 'speaker_talk_cap_reached' : 'co_speaker_talk_cap_reached',
        },
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
          'Every co-speaker must complete their required participation details before submission.',
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
        speakerSnapshotFrom(speakerId, speakerByUid.get(speakerId)!),
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
      event.data.after,
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
  return snap.exists ? confirmFormFromData(snap.data()) : EMPTY_FORM;
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

async function deleteProfilePhotoObjectQuietly(
  uid: string,
  pointer: SpeakerProfilePhoto | null,
): Promise<void> {
  if (!pointer || !isSpeakerProfilePhotoPath(pointer.path, uid)) return;
  try {
    await getStorage()
      .bucket()
      .file(pointer.path, { generation: pointer.generation })
      .delete({ ignoreNotFound: true });
  } catch (error) {
    logger.warn('old profile photo cleanup failed', { uid, error: String(error) });
  }
}

/** Uploads the account-owned original; confirmation reuses this exact generation. */
export const uploadProfilePhoto = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'upload a profile photo');
  const email = request.auth?.token.email;
  if (typeof email !== 'string' || !email) {
    throw new HttpsError('failed-precondition', 'Your account has no email address.');
  }
  const data = (request.data ?? {}) as { contentType?: unknown; base64?: unknown };
  const upload = await decodeSpeakerProfilePhotoUpload(data.contentType, data.base64);
  const profileRef = db.doc(`speakers/${uid}`);
  const path = speakerProfilePhotoPath(uid, randomUUID());
  const file = getStorage().bucket().file(path);
  let pointer: SpeakerProfilePhoto | undefined;
  let previous: SpeakerProfilePhoto | null = null;

  try {
    await file.save(upload.bytes, {
      resumable: false,
      metadata: { contentType: upload.contentType, cacheControl: 'private, no-store' },
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
    await db.runTransaction(async (tx) => {
      const profile = await tx.get(profileRef);
      if (profile.exists) {
        previous = speakerProfilePhotoFrom(profile.get('profilePhoto'), uid);
        tx.update(profileRef, {
          profilePhoto: pointer,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.create(profileRef, {
          email,
          profilePhoto: pointer,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (error) {
    if (pointer) {
      try {
        const current = await profileRef.get();
        if (current.exists && speakerProfilePhotoMatches(current.get('profilePhoto'), uid, pointer)) {
          await deleteProfilePhotoObjectQuietly(uid, previous);
          return { ok: true, generation: pointer.generation };
        }
      } catch (verificationError) {
        logger.error('profile photo pointer could not be verified', {
          uid,
          error: String(verificationError),
        });
        throw new HttpsError('unavailable', 'The profile photo upload could not be settled. Try again.');
      }
    }
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (cleanupError) {
      logger.warn('failed profile photo cleanup failed', { uid, error: String(cleanupError) });
    }
    if (error instanceof HttpsError) throw error;
    logger.error('profile photo upload failed', { uid, error: String(error) });
    throw new HttpsError('unavailable', 'The profile photo could not be uploaded. Try again.');
  }

  await deleteProfilePhotoObjectQuietly(uid, previous);
  logger.info('profile photo uploaded', { uid });
  return { ok: true, generation: pointer.generation };
});

/** Owner-only preview; no bucket path or download token reaches the browser. */
export const profilePhotoImage = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'view a profile photo');
  const profile = await db.doc(`speakers/${uid}`).get();
  const pointer = speakerProfilePhotoFrom(profile.get('profilePhoto'), uid);
  if (!pointer) throw new HttpsError('not-found', 'No profile photo has been saved.');
  const stored = await readStoredHeadshot(getStorage().bucket(), pointer.path, pointer.generation);
  if (!stored) throw new HttpsError('not-found', 'The saved profile photo is missing.');
  return {
    ok: true,
    generation: pointer.generation,
    contentType: stored.contentType,
    base64: stored.bytes.toString('base64'),
  };
});

/** Clears only the reusable pointer; event-frozen confirmations remain immutable. */
export const removeProfilePhoto = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'remove a profile photo');
  const profileRef = db.doc(`speakers/${uid}`);
  const previous = await db.runTransaction(async (tx) => {
    const profile = await tx.get(profileRef);
    if (!profile.exists) throw new HttpsError('not-found', 'No speaker profile was found.');
    const current = speakerProfilePhotoFrom(profile.get('profilePhoto'), uid);
    if (!current) return null;
    tx.update(profileRef, {
      profilePhoto: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return current;
  });
  await deleteProfilePhotoObjectQuietly(uid, previous);
  return { ok: true };
});

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
  let profilePhotoSource: SpeakerProfilePhoto | null = null;
  let frozenSpeakerPhoto: ConfirmedSpeakerPhoto | undefined;
  let perSpeakerLifecycle = false;
  let migratedFromLegacy = false;
  if (speakerResponse === 'confirmed') {
    leaseId = await acquireCfpMutation(cfpId, 'speaker-confirmation', async (tx) => {
      const proposal = await readOwnProposal(tx, proposalRef, uid);
      assertDecisionCanBeAnswered(proposal);
      perSpeakerLifecycle = usesPerSpeakerLifecycle(proposal);
    });
    try {
      const form = await loadConfirmForm(cfpId);
      const bucket = getStorage().bucket();
      const [currentProposal, currentConfirmation, currentProfile] = await Promise.all([
        proposalRef.get(),
        confirmationRef.get(),
        db.doc(`speakers/${uid}`).get(),
      ]);
      migratedFromLegacy =
        perSpeakerLifecycle &&
        currentConfirmation.get('migratedFromLegacy') === true &&
        primarySpeakerId(currentProposal.data() ?? {}) === uid;
      const uploads = perSpeakerLifecycle
        ? migratedFromLegacy
          ? await findMigratedSpeakerUploadedHeadshots(
              bucket,
              cfpId,
              proposalId,
              form,
              uid,
              currentConfirmation.get('headshotUploads'),
            )
          : await findSpeakerUploadedHeadshots(
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
      if (form.speakerPhoto) {
        profilePhotoSource = speakerProfilePhotoFrom(currentProfile.get('profilePhoto'), uid);
        if (!profilePhotoSource && form.speakerPhoto.required) {
          throw new HttpsError('invalid-argument', 'Add a speaker photo before confirming.', {
            speakerPhoto: 'required',
          });
        }
        if (profilePhotoSource) {
          frozenSpeakerPhoto = await freezeSpeakerProfilePhoto(
            bucket,
            cfpId,
            proposalId,
            uid,
            profilePhotoSource,
          );
        }
      }
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
      const profileRef = db.doc(`speakers/${uid}`);
      const confirmationRefs = currentPerSpeakerLifecycle
        ? speakerIds.map((speakerId) =>
            speakerConfirmationRef(db, cfpId, proposalId, speakerId),
          )
        : [];
      const profileUpdateRequestRefs = speakerIds.map((speakerId) =>
        profileUpdateRequestRef(db, cfpId, proposalId, speakerId),
      );
      const [latestFormSnap, scheduleConfig, latestProfile, ...personalSnapshots] =
        await tx.getAll(
          formRef,
          configRef,
          profileRef,
          ...confirmationRefs,
          ...profileUpdateRequestRefs,
        );
      const confirmationSnaps = personalSnapshots.slice(0, confirmationRefs.length);
      const profileUpdateRequests = personalSnapshots.slice(confirmationRefs.length);

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
        if (latestForm.speakerPhoto) {
          const latestPhoto = speakerProfilePhotoFrom(latestProfile.get('profilePhoto'), uid);
          if (!latestPhoto && latestForm.speakerPhoto.required) {
            throw new HttpsError('invalid-argument', 'Add a speaker photo before confirming.', {
              speakerPhoto: 'required',
            });
          }
          if (
            (latestPhoto &&
              (!profilePhotoSource ||
                !frozenSpeakerPhoto ||
                !speakerProfilePhotoMatches(latestPhoto, uid, profilePhotoSource))) ||
            (!latestPhoto && (profilePhotoSource || frozenSpeakerPhoto))
          ) {
            throw new HttpsError(
              'aborted',
              'The profile photo changed while the answer was being saved. Try again.',
            );
          }
        } else {
          frozenSpeakerPhoto = undefined;
        }
      }

      const previousSpeakerPhoto = currentPerSpeakerLifecycle
        ? confirmationSnaps[speakerIds.indexOf(uid)]?.get('speakerPhoto')
        : proposal.speakerPhoto;
      const nextSpeakerPhoto =
        speakerResponse === 'confirmed' ? frozenSpeakerPhoto : undefined;
      const speakerPhotoChanged =
        JSON.stringify(stableScheduleValue(previousSpeakerPhoto ?? null)) !==
        JSON.stringify(stableScheduleValue(nextSpeakerPhoto ?? null));

      const primaryUid = primarySpeakerId(proposal);
      const requestsToCancel =
        speakerResponse !== 'declined'
          ? []
          : !currentPerSpeakerLifecycle || uid === primaryUid
            ? profileUpdateRequests
            : profileUpdateRequests.filter((_, index) => speakerIds[index] === uid);

      if (!currentPerSpeakerLifecycle) {
        for (const profileUpdateRequest of requestsToCancel) {
          cancelPendingProfileUpdateRequest(
            tx,
            profileUpdateRequest,
            uid,
            'speaker-declined',
          );
        }
        finalStatus = speakerResponse;
        tx.update(proposalRef, {
          status: finalStatus,
          confirmedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          // Replaced wholesale, not merged: confirming again is how a speaker
          // corrects an answer, and a merge would leave the old one behind.
          ...(speakerResponse === 'confirmed' ? { confirmAnswers: answers } : {}),
          speakerPhoto:
            nextSpeakerPhoto ?? FieldValue.delete(),
        });
        if (speakerPhotoChanged && scheduleConfig.exists) {
          tx.set(
            configRef,
            { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
        }
        return;
      }

      const confirmations = new Map<string, FirebaseFirestore.DocumentData | undefined>(
        confirmationSnaps.map((snap, index) => [speakerIds[index], snap.data()]),
      );
      confirmations.set(uid, { response: speakerResponse });
      const primaryResponse = confirmationResponse(confirmations.get(primaryUid));
      finalStatus =
        primaryResponse === 'declined'
          ? 'declined'
          : everySpeakerConfirmed(speakerIds, confirmations)
            ? 'confirmed'
            : 'accepted';

      const latePendingIds = Array.isArray(proposal.lateSpeakerPendingIds)
        ? proposal.lateSpeakerPendingIds.filter(
            (speakerId): speakerId is string => typeof speakerId === 'string',
          )
        : [];
      const latePendingInvitations = Array.isArray(proposal.lateSpeakerPendingInvitations)
        ? proposal.lateSpeakerPendingInvitations.filter(
            (binding): binding is { uid: string; invitationId: string } =>
              Boolean(
                binding &&
                  typeof binding === 'object' &&
                  typeof binding.uid === 'string' &&
                  typeof binding.invitationId === 'string',
              ),
          )
        : [];
      const lateBaselineIds = frozenScheduleBaselineIds(proposal) ?? [];
      const hasFrozenScheduleBaseline = lateBaselineIds.length > 0;
      const scheduleDeclineNeedsCancellation =
        speakerResponse === 'declined' &&
        ((proposal.lateSpeakerSchedulePreserved === true && lateBaselineIds.includes(uid)) ||
          (proposal.status === 'confirmed' && !hasFrozenScheduleBaseline));
      const hasLiveScheduleRelease =
        scheduleDeclineNeedsCancellation &&
        await currentScheduleReleaseContainsProposal(db, tx, cfpId, proposalId);
      const establishesScheduleBaseline =
        hasLiveScheduleRelease &&
        proposal.status === 'confirmed' &&
        !hasFrozenScheduleBaseline;
      const confirmedLateSpeaker =
        speakerResponse === 'confirmed' && latePendingIds.includes(uid);
      const baselineDeclined =
        scheduleDeclineNeedsCancellation && hasLiveScheduleRelease;
      const baselineRestored =
        speakerResponse === 'confirmed' &&
        proposal.lateSpeakerSchedulePreserved === true &&
        lateBaselineIds.length > 0 &&
        lateBaselineIds.every(
          (speakerId) =>
            speakerIds.includes(speakerId) &&
            confirmationResponse(confirmations.get(speakerId)) === 'confirmed',
        );
      const remainingLateIds = confirmedLateSpeaker
        ? latePendingIds.filter((speakerId) => speakerId !== uid)
        : latePendingIds;
      const remainingLateInvitations = confirmedLateSpeaker
        ? latePendingInvitations.filter((binding) => binding.uid !== uid)
        : latePendingInvitations;

      for (const profileUpdateRequest of requestsToCancel) {
        cancelPendingProfileUpdateRequest(
          tx,
          profileUpdateRequest,
          uid,
          'speaker-declined',
        );
      }

      tx.set(
        confirmationRef,
        {
          cfpId,
          proposalId,
          uid,
          response: speakerResponse,
          answers: speakerResponse === 'confirmed' ? answers : {},
          speakerPhoto:
            nextSpeakerPhoto ?? FieldValue.delete(),
          ...(migratedFromLegacy && speakerResponse === 'confirmed'
            ? { migratedFromLegacy: FieldValue.delete() }
            : {}),
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
        ...(confirmedLateSpeaker
          ? {
              lateSpeakerPendingIds:
                remainingLateIds.length > 0 ? remainingLateIds : FieldValue.delete(),
              lateSpeakerPendingInvitations:
                remainingLateInvitations.length > 0
                  ? remainingLateInvitations
                  : FieldValue.delete(),
            }
          : {}),
        ...(baselineDeclined
          ? {
              scheduleCancellationRequired: true,
              ...(establishesScheduleBaseline
                ? {
                    lateSpeakerSchedulePreserved: true,
                    lateSpeakerScheduleBaselineIds: speakerIds,
                  }
                : {}),
              lateSpeakerPendingIds: FieldValue.delete(),
              lateSpeakerPendingInvitations: FieldValue.delete(),
            }
          : {}),
        ...(baselineRestored
          ? { scheduleCancellationRequired: FieldValue.delete() }
          : {}),
        ...(migratedFromLegacy && speakerResponse === 'confirmed'
          ? {
              confirmAnswers: FieldValue.delete(),
              headshotUploads: FieldValue.delete(),
              speakerPhoto: FieldValue.delete(),
            }
          : {}),
        ...(finalStatus === 'confirmed'
          ? { confirmedAt: FieldValue.serverTimestamp() }
          : { confirmedAt: FieldValue.delete() }),
      });
      if (
        scheduleConfig.exists &&
        (speakerPhotoChanged || (speakerResponse === 'declined' && uid !== primaryUid))
      ) {
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
        ? speakerWorkingHeadshotFrom(uploads, cfpId, proposalId, uid, key) ??
          (confirmation.get('migratedFromLegacy') === true
            ? workingHeadshotFrom(uploads, cfpId, proposalId, key)
            : null)
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
      if (perSpeakerLifecycle && confirmation.get('migratedFromLegacy') !== true) {
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
  if (key === SPEAKER_PHOTO_KEY) {
    let photo = !perSpeakerLifecycle
      ? confirmedScheduleSpeakerPhoto(
          proposal.get('speakerPhoto'),
          cfpId,
          proposalId,
          targetUid,
        )
      : null;
    if (perSpeakerLifecycle) {
      const confirmation = await speakerConfirmationRef(
        db,
        cfpId,
        proposalId,
        targetUid,
      ).get();
      photo = confirmedScheduleSpeakerPhoto(
        confirmation.get('speakerPhoto'),
        cfpId,
        proposalId,
        targetUid,
      );
      if (
        !photo &&
        confirmation.get('migratedFromLegacy') === true &&
        targetUid === primarySpeakerId(proposalData)
      ) {
        photo = confirmedScheduleSpeakerPhoto(
          proposal.get('speakerPhoto'),
          cfpId,
          proposalId,
          targetUid,
        );
      }
    }
    if (photo) {
      const image = await readHeadshotBytes(photo.path);
      return { ok: true, dataUrl: `data:${image.contentType};base64,${image.base64}` };
    }
    // A pre-feature arbitrary image question may already use this key. With no
    // dedicated frozen pointer, let the legacy answer branch below handle it.
  }
  if (perSpeakerLifecycle) {
    const confirmationRef = speakerConfirmationRef(
      db,
      cfpId,
      proposalId,
      targetUid,
    );
    const confirmation = await confirmationRef.get();
    const answers = confirmation.get('answers');
    const path =
      answers && typeof answers === 'object' && !Array.isArray(answers)
        ? (answers as Record<string, unknown>)[key]
        : undefined;
    if (
      typeof path === 'string' &&
      isSpeakerConfirmedHeadshotPath(path, cfpId, proposalId, targetUid, key)
    ) {
      const image = await readHeadshotBytes(path);
      return { ok: true, dataUrl: `data:${image.contentType};base64,${image.base64}` };
    }
    const exactMigratedConfirmation =
      confirmation.exists &&
      confirmation.get('cfpId') === cfpId &&
      confirmation.get('proposalId') === proposalId &&
      confirmation.get('uid') === targetUid &&
      confirmation.get('migratedFromLegacy') === true &&
      targetUid === primarySpeakerId(proposalData);
    if (!exactMigratedConfirmation || typeof path !== 'string') {
      throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
    }
    if (isConfirmedHeadshotPath(path, cfpId, proposalId, key)) {
      const image = await readHeadshotBytes(path);
      return { ok: true, dataUrl: `data:${image.contentType};base64,${image.base64}` };
    }

    const livePath = headshotPath(cfpId, targetUid, key);
    if (path !== livePath) {
      throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
    }
    const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
    const leaseId = await acquireCfpMutation(
      cfpId,
      'legacy-headshot-read',
      async (tx) => assertMutationActor(await tx.get(memberRef), 'admin'),
      { allowArchived: true },
    );
    let imagePath = path;
    try {
      const currentConfirmation = await confirmationRef.get();
      const currentAnswers = currentConfirmation.get('answers');
      const currentPath =
        currentAnswers && typeof currentAnswers === 'object' && !Array.isArray(currentAnswers)
          ? (currentAnswers as Record<string, unknown>)[key]
          : undefined;
      let frozenPath: string | undefined;
      if (
        typeof currentPath === 'string' &&
        isConfirmedHeadshotPath(currentPath, cfpId, proposalId, key)
      ) {
        imagePath = currentPath;
      } else if (currentPath === livePath) {
        const upload = await readStoredHeadshot(getStorage().bucket(), livePath);
        if (!upload) {
          throw new HttpsError(
            'failed-precondition',
            'A confirmed photo is missing. Restore it before viewing this answer.',
          );
        }
        frozenPath = await freezeHeadshot(
          getStorage().bucket(),
          cfpId,
          proposalId,
          key,
          upload,
        );
      } else {
        throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
      }

      await finishCfpMutation(
        cfpId,
        leaseId,
        async (tx) => {
          const [member, currentProposal, currentConfirmation] = await tx.getAll(
            memberRef,
            proposalRef,
            confirmationRef,
          );
          assertMutationActor(member, 'admin');
          if (
            !currentProposal.exists ||
            !currentConfirmation.exists ||
            primarySpeakerId(currentProposal.data()!) !== targetUid ||
            !proposalSpeakerIds(currentProposal.data()!).includes(targetUid) ||
            currentConfirmation.get('cfpId') !== cfpId ||
            currentConfirmation.get('proposalId') !== proposalId ||
            currentConfirmation.get('uid') !== targetUid ||
            currentConfirmation.get('migratedFromLegacy') !== true
          ) {
            throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
          }
          const latestAnswers = currentConfirmation.get('answers');
          const latestPath =
            latestAnswers && typeof latestAnswers === 'object' && !Array.isArray(latestAnswers)
              ? (latestAnswers as Record<string, unknown>)[key]
              : undefined;
          if (
            typeof latestPath === 'string' &&
            isConfirmedHeadshotPath(latestPath, cfpId, proposalId, key)
          ) {
            imagePath = latestPath;
            return;
          }
          if (latestPath !== livePath || !frozenPath) {
            throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
          }
          imagePath = frozenPath;
          tx.update(confirmationRef, {
            answers: {
              ...(latestAnswers as Record<string, unknown>),
              [key]: frozenPath,
            },
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        { allowArchived: true },
      );
      if (!isConfirmedHeadshotPath(imagePath, cfpId, proposalId, key)) {
        throw new HttpsError('not-found', 'No confirmed headshot for that proposal.');
      }
    } catch (error) {
      await releaseCfpMutationQuietly(cfpId, leaseId);
      throw error;
    }
    const image = await readHeadshotBytes(imagePath);
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
  const input = (request.data ?? {}) as { fields?: unknown; speakerPhoto?: unknown };
  const fields = input.fields;
  if (!Array.isArray(fields)) {
    throw new HttpsError('invalid-argument', 'fields must be a list.');
  }

  const form = normaliseForm({ fields, speakerPhoto: input.speakerPhoto } as ConfirmForm);
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
    const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
    const scheduleRef = scheduleConfigRef(cfpId);
    const [current, schedule] = await tx.getAll(formRef, scheduleRef);
    const currentForm = confirmFormFrom(current);
    tx.set(formRef, form);
    if (
      schedule.exists &&
      JSON.stringify(currentForm.speakerPhoto ?? null) !== JSON.stringify(form.speakerPhoto ?? null)
    ) {
      tx.set(
        scheduleRef,
        { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
  });
  logger.info('confirm form saved', { byUid, fields: form.fields.length });
  return { ok: true, ...form };
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

  const rawAttendanceFault = rawSubmissionAttendanceFault(request.data);
  if (rawAttendanceFault) {
    throw new HttpsError(
      'invalid-argument',
      rawAttendanceFault.key
        ? `${rawAttendanceFault.problem} on "${rawAttendanceFault.key}"`
        : rawAttendanceFault.problem,
      rawAttendanceFault,
    );
  }
  const requestedForm = mergeSubmissionForm((request.data ?? {}) as Record<string, unknown>);
  const badVisibility = requestedForm.fields.find(
    (field) =>
      field.reviewerVisible !== undefined && typeof field.reviewerVisible !== 'boolean',
  );
  if (badVisibility) {
    const fault = { problem: 'badReviewerVisibility', key: badVisibility.key } as const;
    throw new HttpsError('invalid-argument', `${fault.problem} on "${fault.key}"`, fault);
  }
  const form = normaliseSubmissionForm(requestedForm);

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

const REVIEW_QUEUE_STATUSES = STATUS_SETS.reviewQueue;
const REVIEW_TRAVEL_READ_CHUNK = 100;
const AGGREGATE_REVISION_FIELD = '_aggregateRevision';
const AGGREGATE_CHUNK = 400;

const isKnownScore = (score: unknown): score is number =>
  (SCORES as readonly unknown[]).includes(score);

const aggregateScorable = (status: unknown): boolean =>
  typeof status === 'string' &&
  (PROPOSAL_STATUSES as readonly string[]).includes(status) &&
  status !== 'draft' &&
  status !== 'withdrawn';

export const reviewQueue = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const reviewerUid = requireVerifiedUid(request, 'load the review queue');
  const [cfp, member, submissionForm] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/members/${reviewerUid}`),
    db.doc(`cfps/${cfpId}/config/submissionForm`),
  );
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (!staffMemberIsActive(member.data(), cfpId, reviewerUid)) {
    throw new HttpsError('permission-denied', 'Only an active reviewer can load this queue.');
  }
  const resolvedSubmissionForm = normaliseSubmissionForm(
    mergeSubmissionForm(submissionForm.exists ? submissionForm.data() : undefined),
  );
  const submissionFields = resolvedSubmissionForm.fields;

  const snapshots = await db
    .collection(`cfps/${cfpId}/proposals`)
    .where('status', 'in', [...REVIEW_QUEUE_STATUSES])
    .get();
  const own = snapshots.docs.filter((proposal) => {
    const data = proposal.data();
    return [
      ...(Array.isArray(data.speakerIds) ? data.speakerIds : []),
      ...(Array.isArray(data.formerSpeakerIds) ? data.formerSpeakerIds : []),
    ].includes(reviewerUid);
  });
  const conflictedIds = new Set(own.map((proposal) => proposal.id));
  const visible = snapshots.docs.filter((proposal) => !conflictedIds.has(proposal.id));
  const participantReads = reviewerAttendanceEnabled(resolvedSubmissionForm)
    ? visible.flatMap((proposal) =>
        reviewerTravelParticipantIds(proposal.data()).map((uid) => ({
          proposalId: proposal.id,
          uid,
          ref: speakerParticipantRef(db, cfpId, proposal.id, uid),
        })),
      )
    : [];
  const participantByProposal = new Map<
    string,
    Map<string, ReviewerParticipantSource>
  >();
  for (let index = 0; index < participantReads.length; index += REVIEW_TRAVEL_READ_CHUNK) {
    const chunk = participantReads.slice(index, index + REVIEW_TRAVEL_READ_CHUNK);
    const participants = await db.getAll(...chunk.map(({ ref }) => ref));
    participants.forEach((participant, participantIndex) => {
      if (!participant.exists) return;
      const { proposalId, uid } = chunk[participantIndex];
      const byUid = participantByProposal.get(proposalId) ?? new Map();
      byUid.set(uid, participant.data() ?? {});
      participantByProposal.set(proposalId, byUid);
    });
  }
  return {
    ok: true,
    own: own.length,
    proposals: visible.map((proposal) =>
      reviewerProposalProjection(
        proposal.id,
        proposal.data(),
        cfp.get('reviewsVisible') === true,
        submissionFields,
        participantByProposal.get(proposal.id),
        resolvedSubmissionForm,
        cfp.get('features.blindReview') === true || cfp.get('blindReview') === true,
      ),
    ),
  };
});

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
      // Distinct from a revoked membership: the role is intact, this one talk
      // is theirs. Telling a reviewer their access ended is a claim they act on.
      throw new HttpsError('permission-denied', 'You cannot review your own proposal.', {
        reason: 'review_own_proposal',
      });
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
 * Only completion metadata leaves this callable. Scores and comments do not.
 */
export const reviewCoverage = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  await requireAdmin(request, cfpId, 'view review coverage');

  const [members, proposalSnaps, reviewSnaps] = await Promise.all([
    db.collection(`cfps/${cfpId}/members`).get(),
    db
      .collection(`cfps/${cfpId}/proposals`)
      .where('status', 'in', [...REVIEW_QUEUE_STATUSES])
      .get(),
    db.collectionGroup('reviews').where('cfpId', '==', cfpId).get(),
  ]);

  const current = proposalSnaps.docs
    .map((proposal) => ({
      id: proposal.id,
      title: String(proposal.get('title') ?? ''),
      speakerIds: ((proposal.get('speakerIds') as unknown[]) ?? []).filter(
        (uid): uid is string => typeof uid === 'string',
      ),
      formerSpeakerIds: ((proposal.get('formerSpeakerIds') as unknown[]) ?? []).filter(
        (uid): uid is string => typeof uid === 'string',
      ),
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const allProposalIds = new Set(current.map((proposal) => proposal.id));
  const activeReviewerIds = new Set(members.docs.map((member) => member.id));

  const reviewByPair = new Map<
    string,
    { score: unknown; conflictOfInterest: boolean }
  >();
  for (const review of reviewSnaps.docs) {
    const proposalId = review.ref.parent.parent?.id;
    if (!proposalId || !allProposalIds.has(proposalId) || !activeReviewerIds.has(review.id)) continue;
    reviewByPair.set(`${proposalId}:${review.id}`, {
      score: review.get('score'),
      conflictOfInterest: review.get('conflictOfInterest') === true,
    });
  }

  const reviewers = members.docs
    .map((member) => {
      const data = member.data();
      const eligible = current.filter(
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
    hiddenOwnProposalCount: 0,
    proposals: current.map(({ id, title }) => ({ id, title })),
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
    const pendingTransfer = await getPlatformOwnershipTransferImpl(db, {
      byUid: identity.uid,
      email: identity.email,
    });
    return {
      role,
      isPlatformAdmin: role === 'owner' || role === 'admin',
      isPlatformOwner: role === 'owner',
      pendingTransfer,
    };
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Platform administrators see delegated access, not the Firebase Auth directory. */
export const listPlatformUsers = onCall(CALLABLE, async (request) => {
  const identity = await requirePlatformAdmin(request, 'list platform administrators');
  return { ok: true, ...(await listPlatformAccess(db, identity)) };
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

export const initiatePlatformOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformOwner(request, 'transfer platform ownership');
  const data = (request.data ?? {}) as Record<string, unknown>;
  try {
    const result = await initiatePlatformOwnershipTransferImpl(db, getAuth(), {
      email: data.email,
      byUid: uid,
    });
    logger.info('platform ownership transfer initiated', { ...result, byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const acceptPlatformOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const identity = requireVerifiedPlatformIdentity(request, 'accept platform ownership transfer');
  try {
    const result = await acceptPlatformOwnershipTransferImpl(db, getAuth(), {
      uid: identity.uid,
      email: identity.email,
    });
    logger.info('platform ownership transfer accepted', { uid: identity.uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const cancelPlatformOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformOwner(request, 'cancel platform ownership transfer');
  try {
    const result = await cancelPlatformOwnershipTransferImpl(db, { byUid: uid });
    logger.info('platform ownership transfer cancelled', { byUid: uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const getPlatformOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.token?.email_verified === true ? request.auth.uid : '';
  const email = request.auth?.token?.email ? String(request.auth.token.email) : undefined;
  try {
    const transfer = await getPlatformOwnershipTransferImpl(db, {
      byUid: uid,
      email,
    });
    return { ok: true, transfer };
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
 * The organization owner or admin who creates it is written as owner. That is what
 * replaced the bootstrap script — there is no moment when a CFP exists with
 * nobody able to administer it.
 */
export const createCfp = onCall(CALLABLE, async (request) => {
  const identity = requireVerifiedPlatformIdentity(request, 'create a call for proposals');
  const { uid } = identity;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = String(data.orgId ?? '').trim().toLowerCase();
  if (validateOrgSlug(orgId)) {
    throw new HttpsError('invalid-argument', 'Organization id is required and must be usable.');
  }
  const token = request.auth!.token;

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

  const ref = db.doc(`cfps/${input.id}`);
  const orgRef = db.doc(`orgs/${orgId}`);
  const orgMemberRef = db.doc(`orgs/${orgId}/members/${uid}`);
  const orgEvents = db.collection('cfps').where('orgId', '==', orgId);
  await db.runTransaction(async (tx) => {
    const [orgSnap, orgMemberSnap, existing, events] = await Promise.all([
      tx.get(orgRef),
      tx.get(orgMemberRef),
      tx.get(ref),
      tx.get(orgEvents),
    ]);
    if (!orgSnap.exists) {
      throw new HttpsError('not-found', 'Organization not found.');
    }
    const orgRole = orgMemberSnap.exists ? orgMemberSnap.get('role') : null;
    if (orgRole !== 'owner' && orgRole !== 'admin') {
      throw new HttpsError(
        'permission-denied',
        'You must be an admin or owner of the organization to create events for it.',
      );
    }
    const activeEventLimit = effectiveActiveEventLimit(orgSnap.get('activeEventLimit'));
    const activeEventCount = events.docs.filter((event) => event.get('archived') !== true).length;
    if (activeEventCount >= activeEventLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'This organization has reached its active event limit.',
        { reason: 'org_event_limit_reached', limit: activeEventLimit },
      );
    }
    if (existing.exists) {
      throw new HttpsError('already-exists', 'That address is taken.');
    }
    tx.set(ref, {
      name: input.name,
      visibility: input.visibility,
      ownerUid: uid,
      orgId,
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
    tx.set(db.doc(`cfps/${input.id}/config/submissionForm`), NEW_CFP_SUBMISSION_FORM);
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

  logger.info('cfp created', { cfpId: input.id, uid, orgId });
  return { ok: true, cfpId: input.id };
});

// ------------------------------------------------------------- organizations

function requireOrgId(data: Record<string, unknown>): string {
  const orgId = String(data.orgId ?? '').trim().toLowerCase();
  if (validateOrgSlug(orgId)) {
    throw new HttpsError('invalid-argument', 'Organization id is required and must be usable.');
  }
  return orgId;
}

function orgOwnerUid(data: Record<string, unknown>): string | undefined {
  return typeof data.ownerUid === 'string' && data.ownerUid ? data.ownerUid : undefined;
}

function readThemeColors(value: unknown): CfpTheme | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Theme must be an object.');
  }
  const source = value as Record<string, unknown>;
  const theme: CfpTheme = {};
  for (const key of ['primaryColor', 'accentColor', 'mastheadBg'] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const color = normaliseThemeColor(source[key]);
    if (color === null) {
      throw new HttpsError('invalid-argument', 'Theme colors must use six-digit hex values.');
    }
    if (color) theme[key] = color;
  }
  return theme;
}

function readCfpTheme(value: unknown): CfpTheme | undefined {
  const theme = readThemeColors(value);
  if (theme === undefined) return undefined;
  const source = value as Record<string, unknown>;
  for (const key of ['logoUrl', 'bannerUrl'] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const url = typeof source[key] === 'string' ? source[key].trim() : '';
    if (url && (url.length > 500 || !/^https:\/\//i.test(url))) {
      throw new HttpsError('invalid-argument', 'Theme asset URLs must use https and fit the field.');
    }
    if (url) theme[key] = url;
  }
  return theme;
}

export const createOrg = onCall(CALLABLE, async (request) => {
  const identity = requireVerifiedPlatformIdentity(request, 'create an organization');
  const { uid, email } = identity;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const name = String(data.name ?? '').trim();
  const slug = String(data.slug ?? '').trim().toLowerCase();

  const slugFault = validateOrgSlug(slug);
  if (slugFault) throw new HttpsError('invalid-argument', slugFault);
  if (!name || name.length > ORG_LIMITS.nameMax) {
    throw new HttpsError(
      'invalid-argument',
      `Organization name is required (max ${ORG_LIMITS.nameMax} chars).`,
    );
  }
  const orgRef = db.doc(`orgs/${slug}`);
  const memberRef = db.doc(`orgs/${slug}/members/${uid}`);
  const limitRef = db.doc(`platformUserLimits/${uid}`);
  const defaultsRef = db.doc('config/platformLimits');
  const ownedOrgs = db
    .collection('orgs')
    .where('ownerUid', '==', uid)
    .limit(ORG_LIMITS.perOwnerMax + 1);

  await db.runTransaction(async (tx) => {
    const [existing, owned, limitSnap, defaultsSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(ownedOrgs),
      tx.get(limitRef),
      tx.get(defaultsRef),
    ]);
    const ownershipDefault = effectiveOrgOwnershipLimit(
      defaultsSnap.get('organizationOwnershipDefault'),
    );
    const ownershipLimit = effectiveOrgOwnershipLimit(
      limitSnap.get('organizationLimit'),
      ownershipDefault,
    );
    if (existing.exists) {
      throw new HttpsError('already-exists', 'That organization slug is already in use.');
    }
    if (owned.size >= ownershipLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'You have reached the organization ownership limit.',
        { reason: 'org_limit_reached', limit: ownershipLimit },
      );
    }

    tx.set(orgRef, {
      name,
      slug,
      ownerUid: uid,
      plan: 'community',
      activeEventLimit: ORG_LIMITS.activeEventsDefault,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: uid,
      billingEmail: email,
    });

    tx.set(memberRef, {
      orgId: slug,
      uid,
      role: 'owner',
      email,
      ...(identity.name ? { name: identity.name } : {}),
      joinedAt: FieldValue.serverTimestamp(),
      grantedBy: uid,
    });
  });

  logger.info('organization created', { orgId: slug, ownerUid: uid });
  return { ok: true, orgId: slug };
});

export const getOrg = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);

  const orgSnap = await db.doc(`orgs/${orgId}`).get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found');

  const uid = request.auth?.token?.email_verified === true ? request.auth.uid : null;
  const userEmail = request.auth?.token?.email ? String(request.auth.token.email).toLowerCase() : null;
  const memberSnap = uid
    ? await db.doc(`orgs/${orgId}/members/${uid}`).get()
    : null;
  const role = memberSnap?.exists ? (memberSnap.get('role') as string) : null;

  const orgData = orgSnap.data()!;
  const ownerUid = orgOwnerUid(orgData);

  const transferSnap = await db.doc(`orgs/${orgId}/transfers/current`).get();
  let pendingTransfer = null;
  if (ownershipTransferIsPending(transferSnap)) {
    const tData = transferSnap.data()!;
    const isOwner = role === 'owner';
    const isTarget =
      (userEmail && String(tData.targetEmail ?? '').toLowerCase() === userEmail) ||
      (uid && tData.targetUid === uid);
    if (isOwner || isTarget) {
      pendingTransfer = ownershipTransferView(transferSnap, 'org', orgId);
    }
  }

  return {
    org: {
      id: orgSnap.id,
      name: orgData.name,
      slug: orgData.slug,
      ...(role ? { ownerUid } : {}),
      description: orgData.description,
      logoUrl: orgData.logoUrl,
      websiteUrl: orgData.websiteUrl || orgData.website,
      plan: orgData.plan,
      activeEventLimit: effectiveActiveEventLimit(orgData.activeEventLimit),
      theme: orgData.theme || orgData.defaultTheme,
    },
    role,
    pendingTransfer,
  };
});

export const listMyOrgs = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'list organizations');
  const [memberships, limitSnap, defaultsSnap] = await Promise.all([
    db.collectionGroup('members').where('uid', '==', uid).get(),
    db.doc(`platformUserLimits/${uid}`).get(),
    db.doc('config/platformLimits').get(),
  ]);
  const ownershipDefault = effectiveOrgOwnershipLimit(
    defaultsSnap.get('organizationOwnershipDefault'),
  );
  const ownershipLimit = effectiveOrgOwnershipLimit(
    limitSnap.get('organizationLimit'),
    ownershipDefault,
  );

  const orgRoles = new Map<string, OrgRole>();
  for (const doc of memberships.docs) {
    const parts = doc.ref.path.split('/');
    if (parts[0] === 'orgs' && parts[1]) {
      orgRoles.set(parts[1], doc.get('role') as OrgRole);
    }
  }

  if (orgRoles.size === 0) {
    return { orgs: [], canCreateOrg: ownershipLimit > 0, ownershipLimit };
  }

  const orgDocs = await Promise.all(
    Array.from(orgRoles).map(([id]) => db.doc(`orgs/${id}`).get()),
  );
  const orgs = await Promise.all(orgDocs
    .filter((d) => d.exists)
    .map(async (d) => {
      const data = d.data()!;
      return {
        id: d.id,
        name: data.name,
        slug: data.slug,
        ownerUid: orgOwnerUid(data),
        description: data.description,
        logoUrl: data.logoUrl,
        websiteUrl: data.websiteUrl || data.website,
        plan: data.plan,
        activeEventLimit: effectiveActiveEventLimit(data.activeEventLimit),
        theme: data.theme || data.defaultTheme,
        membershipRole: orgRoles.get(d.id),
      };
    }));

  return {
    orgs,
    canCreateOrg:
      orgs.filter((org) => org.membershipRole === 'owner').length < ownershipLimit,
    ownershipLimit,
  };
});

async function platformUserLimitSummary(
  uid: string,
  ownedOrganizationCount: number,
  override: FirebaseFirestore.DocumentSnapshot | undefined,
  ownershipDefault: number,
  knownAccount?: UserRecord,
) {
  let account = knownAccount;
  if (!account) {
    try {
      account = await getAuth().getUser(uid);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
    }
  }
  return {
    uid,
    email: account?.email ?? String(override?.get('email') ?? ''),
    name: account?.displayName ?? String(override?.get('name') ?? ''),
    ownedOrganizationCount,
    organizationLimit: effectiveOrgOwnershipLimit(
      override?.get('organizationLimit'),
      ownershipDefault,
    ),
    hasOverride: override?.exists === true,
  };
}

function pageSize(value: unknown, fallback = 5): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 20 ? parsed : fallback;
}

async function ownedOrganizationCount(uid: string): Promise<number> {
  const owned = await db.collection('orgs').where('ownerUid', '==', uid).get();
  return owned.size;
}

/** A bounded page of verified accounts from Auth, including people who own no organizations. */
export const listUserOrgLimits = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'list user organization limits');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const requestedSize = pageSize(data.pageSize);
  const pageToken = typeof data.pageToken === 'string' && data.pageToken ? data.pageToken : undefined;
  const [accounts, defaultsSnap] = await Promise.all([
    getAuth().listUsers(requestedSize, pageToken),
    db.doc('config/platformLimits').get(),
  ]);
  const ownershipDefault = effectiveOrgOwnershipLimit(
    defaultsSnap.get('organizationOwnershipDefault'),
  );
  const visibleAccounts = accounts.users.filter((account) => account.emailVerified && !account.disabled);
  const users = await Promise.all(
    visibleAccounts.map(async (account) =>
      platformUserLimitSummary(account.uid, await ownedOrganizationCount(account.uid),
        await db.doc(`platformUserLimits/${account.uid}`).get(), ownershipDefault, account),
    ),
  );
  return {
    users: users.sort((a, b) => (a.name || a.email || a.uid).localeCompare(b.name || b.email || b.uid)),
    nextPageToken: accounts.pageToken ?? null,
  };
});

/** Exact-email lookup for configuring an account outside the current directory page. */
export const findUserOrgLimit = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'find a user organization limit');
  const data = (request.data ?? {}) as Record<string, unknown>;
  let email: string;
  try {
    email = normalizeEmail(data.email);
  } catch (error) {
    throw asHttpsError(error);
  }
  let account: UserRecord;
  try {
    account = await getAuth().getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string })?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'No verified account uses that email address.');
    }
    throw error;
  }
  if (!account.emailVerified || account.disabled) {
    throw new HttpsError('failed-precondition', 'The account must be verified and enabled.');
  }
  const [override, defaults] = await Promise.all([
    db.doc(`platformUserLimits/${account.uid}`).get(),
    db.doc('config/platformLimits').get(),
  ]);
  return {
    user: await platformUserLimitSummary(
      account.uid,
      await ownedOrganizationCount(account.uid),
      override,
      effectiveOrgOwnershipLimit(defaults.get('organizationOwnershipDefault')),
      account,
    ),
  };
});

export const getPlatformLimitsConfiguration = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'view platform limit defaults');
  const defaults = await db.doc('config/platformLimits').get();
  return {
    organizationOwnershipDefault: effectiveOrgOwnershipLimit(
      defaults.get('organizationOwnershipDefault'),
    ),
  };
});

export const setPlatformLimitsConfiguration = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformAdmin(request, 'change platform limit defaults');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organizationOwnershipDefault = Number(data.organizationOwnershipDefault);
  if (
    !Number.isInteger(organizationOwnershipDefault) ||
    organizationOwnershipDefault < 0 ||
    organizationOwnershipDefault > ORG_LIMITS.perOwnerMax
  ) {
    throw new HttpsError(
      'invalid-argument',
      `Default organization limit must be an integer from 0 to ${ORG_LIMITS.perOwnerMax}.`,
    );
  }
  const defaultsRef = db.doc('config/platformLimits');
  const memberRef = db.doc(`platformMembers/${uid}`);
  await db.runTransaction(async (tx) => {
    const member = await tx.get(memberRef);
    if (member.get('role') !== 'owner' && member.get('role') !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform administrator access is required.');
    }
    tx.set(defaultsRef, {
      organizationOwnershipDefault,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    }, { merge: true });
  });
  logger.info('platform limit defaults changed', { organizationOwnershipDefault, byUid: uid });
  return { ok: true, organizationOwnershipDefault };
});

export const setUserOrgLimit = onCall(CALLABLE, async (request) => {
  const { uid: actorUid } = await requirePlatformAdmin(request, 'change a user organization limit');
  const data = (request.data ?? {}) as Record<string, unknown>;
  let email: string;
  try {
    email = normalizeEmail(data.email);
  } catch (error) {
    throw asHttpsError(error);
  }
  const limit = Number(data.limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > ORG_LIMITS.perOwnerMax) {
    throw new HttpsError(
      'invalid-argument',
      `Organization limit must be an integer from 0 to ${ORG_LIMITS.perOwnerMax}.`,
    );
  }
  let account: UserRecord;
  try {
    account = await getAuth().getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string })?.code === 'auth/user-not-found') {
      throw new HttpsError('failed-precondition', 'The account must exist and be verified.');
    }
    throw error;
  }
  if (!account.emailVerified || account.disabled) {
    throw new HttpsError('failed-precondition', 'The account must be verified and enabled.');
  }
  const limitRef = db.doc(`platformUserLimits/${account.uid}`);
  const actorRef = db.doc(`platformMembers/${actorUid}`);
  await db.runTransaction(async (tx) => {
    const actor = await tx.get(actorRef);
    if (actor.get('role') !== 'owner' && actor.get('role') !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform administrator access is required.');
    }
    tx.set(limitRef, {
      uid: account.uid,
      email,
      ...(account.displayName ? { name: account.displayName } : {}),
      organizationLimit: limit,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });
  });
  const owned = await db.collection('orgs').where('ownerUid', '==', account.uid).get();
  logger.info('user organization limit changed', { targetUid: account.uid, limit, byUid: actorUid });
  return {
    ok: true,
    user: await platformUserLimitSummary(
      account.uid,
      owned.size,
      await limitRef.get(),
      effectiveOrgOwnershipLimit(
        (await db.doc('config/platformLimits').get()).get('organizationOwnershipDefault'),
      ),
    ),
  };
});

export const resetUserOrgLimit = onCall(CALLABLE, async (request) => {
  const { uid: actorUid } = await requirePlatformAdmin(request, 'reset a user organization limit');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const targetUid = String(data.uid ?? '').trim();
  if (!targetUid) throw new HttpsError('invalid-argument', 'uid is required.');
  const limitRef = db.doc(`platformUserLimits/${targetUid}`);
  const actorRef = db.doc(`platformMembers/${actorUid}`);
  const defaultsRef = db.doc('config/platformLimits');
  let ownershipDefault: number = ORG_LIMITS.perOwner;
  await db.runTransaction(async (tx) => {
    const [actor, defaults] = await Promise.all([tx.get(actorRef), tx.get(defaultsRef)]);
    if (actor.get('role') !== 'owner' && actor.get('role') !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform administrator access is required.');
    }
    ownershipDefault = effectiveOrgOwnershipLimit(defaults.get('organizationOwnershipDefault'));
    tx.delete(limitRef);
  });
  logger.info('user organization limit reset', { targetUid, byUid: actorUid });
  return { ok: true, uid: targetUid, limit: ownershipDefault };
});

/** Platform administrators can see and tune only organization event quotas. */
export const listOrgLimits = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'list organization limits');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const requestedSize = pageSize(data.pageSize);
  const cursor = typeof data.cursor === 'string' ? data.cursor.trim().toLowerCase() : '';
  const search = typeof data.query === 'string' ? data.query.trim().toLowerCase() : '';
  let orgQuery = db.collection('orgs').orderBy(FieldPath.documentId()).limit(requestedSize + 1);
  if (search) {
    if (validateOrgSlug(search)) {
      throw new HttpsError('invalid-argument', 'Search with the beginning of an organization slug.');
    }
    orgQuery = db.collection('orgs')
      .orderBy(FieldPath.documentId())
      .startAt(search)
      .endAt(`${search}\uf8ff`)
      .limit(requestedSize + 1);
  } else if (cursor) {
    orgQuery = orgQuery.startAfter(cursor);
  }
  const orgs = await orgQuery.get();
  const visible = orgs.docs.slice(0, requestedSize);
  const activeCounts = await Promise.all(visible.map(async (org) => {
    const aggregate = await db.collection('cfps')
      .where('orgId', '==', org.id)
      .where('archived', '==', false)
      .count()
      .get();
    return aggregate.data().count;
  }));
  return {
    organizations: visible
      .map((org, index) => ({
        id: org.id,
        name: String(org.get('name') ?? org.id),
        activeEventLimit: effectiveActiveEventLimit(org.get('activeEventLimit')),
        activeEventCount: activeCounts[index] ?? 0,
      })),
    nextCursor: orgs.size > requestedSize ? visible.at(-1)?.id ?? null : null,
  };
});

export const setOrgActiveEventLimit = onCall(CALLABLE, async (request) => {
  const { uid } = await requirePlatformAdmin(request, 'change an organization event limit');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const limit = Number(data.limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > ORG_LIMITS.activeEventsMax) {
    throw new HttpsError(
      'invalid-argument',
      `Active event limit must be an integer from 0 to ${ORG_LIMITS.activeEventsMax}.`,
    );
  }
  const orgRef = db.doc(`orgs/${orgId}`);
  const platformMemberRef = db.doc(`platformMembers/${uid}`);
  await db.runTransaction(async (tx) => {
    const [org, member] = await tx.getAll(orgRef, platformMemberRef);
    if (!org.exists) throw new HttpsError('not-found', 'Organization not found.');
    if (member.get('role') !== 'owner' && member.get('role') !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform administrator access is required.');
    }
    tx.update(orgRef, {
      activeEventLimit: limit,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  logger.info('organization active event limit changed', { orgId, limit, byUid: uid });
  return { ok: true, orgId, limit };
});

export const listOrgMembers = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'list organization members');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const actor = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!actor.exists) {
    throw new HttpsError('permission-denied', 'Only organization members can view the team.');
  }

  const snapshot = await db.collection(`orgs/${orgId}/members`).get();
  const rank = { owner: 0, admin: 1, member: 2 } as Record<string, number>;
  const members = snapshot.docs
    .map((doc) => {
      const member = doc.data();
      return {
        uid: doc.id,
        email: String(member.email ?? ''),
        name: String(member.name ?? ''),
        role: String(member.role ?? 'member'),
        joinedAt: member.joinedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    })
    .sort((a, b) =>
      (rank[a.role] ?? 9) - (rank[b.role] ?? 9) ||
      (a.name || a.email).localeCompare(b.name || b.email),
    );

  return { members };
});

export const updateOrg = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'update organization settings');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);

  const name = String(data.name ?? '').trim();
  const description = data.description !== undefined ? String(data.description).trim() : undefined;
  const logoUrl = data.logoUrl !== undefined ? String(data.logoUrl).trim() : undefined;
  const websiteUrl = data.websiteUrl !== undefined ? String(data.websiteUrl).trim() : undefined;
  if (name && name.length > ORG_LIMITS.nameMax) {
    throw new HttpsError('invalid-argument', 'Organization name is too long.');
  }
  if (description !== undefined && description.length > ORG_LIMITS.descriptionMax) {
    throw new HttpsError('invalid-argument', 'Organization description is too long.');
  }
  if (
    [logoUrl, websiteUrl].some(
      (url) => url !== undefined && (url.length > ORG_LIMITS.websiteMax || (url && !/^https:\/\//i.test(url))),
    )
  ) {
    throw new HttpsError('invalid-argument', 'Organization URLs must use https and fit the field.');
  }
  const theme = readThemeColors(data.theme);

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (name) update.name = name;
  if (description !== undefined) update.description = description || FieldValue.delete();
  if (logoUrl !== undefined) update.logoUrl = logoUrl || FieldValue.delete();
  if (websiteUrl !== undefined) update.websiteUrl = websiteUrl || FieldValue.delete();
  if (theme) update.theme = theme;

  const orgRef = db.doc(`orgs/${orgId}`);
  const memberRef = db.doc(`orgs/${orgId}/members/${uid}`);
  await db.runTransaction(async (tx) => {
    const [org, member] = await tx.getAll(orgRef, memberRef);
    if (!org.exists) throw new HttpsError('not-found', 'Organization not found.');
    const role = member.exists ? member.get('role') : null;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError(
        'permission-denied',
        'Only organization admins and owners can update settings.',
      );
    }
    tx.update(orgRef, update);
  });
  logger.info('organization updated', { orgId, uid });
  return { ok: true };
});

export const listOrgEvents = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);

  const uid = request.auth?.token?.email_verified === true ? request.auth.uid : null;
  const memberSnap = uid ? await db.doc(`orgs/${orgId}/members/${uid}`).get() : null;
  const isMember = memberSnap?.exists === true;

  const cfpsSnap = await db.collection('cfps').where('orgId', '==', orgId).get();
  const visibleDocs = cfpsSnap.docs.filter((d) => {
    const data = d.data();
    return isMember || (data.visibility === 'public' && data.archived !== true);
  });
  const eventRoles = uid
    ? await Promise.all(visibleDocs.map((d) => db.doc(`cfps/${d.id}/members/${uid}`).get()))
    : [];
  const events = visibleDocs.map((d, index) => {
    const data = d.data();
    const eventRole = eventRoles[index]?.get('role');
    return {
      id: d.id,
      name: data.name,
      visibility: data.visibility,
      archived: data.archived === true,
      opensAt: data.opensAt?.toDate?.()?.toISOString?.() ?? null,
      closesAt: data.closesAt?.toDate?.()?.toISOString?.() ?? null,
      theme: data.theme,
      features: data.features,
      canAdmin: eventRole === 'owner' || eventRole === 'admin',
    };
  });

  return { events };
});

export const grantOrgRole = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'grant an organization role');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const role = String(data.role ?? 'member');

  if (role !== 'admin' && role !== 'member') {
    throw new HttpsError('invalid-argument', 'Only admin and member roles can be granted.');
  }

  let targetEmail: string;
  try {
    targetEmail = normalizeEmail(data.email);
  } catch (error) {
    throw asHttpsError(error);
  }

  let userRecord: UserRecord | undefined;
  try {
    userRecord = await getAuth().getUserByEmail(targetEmail);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  if (!userRecord?.emailVerified || userRecord.disabled) {
    throw new HttpsError(
      'failed-precondition',
      'That person must create and verify an enabled account first.',
      { reason: 'org_account_not_ready' },
    );
  }

  const targetUid = userRecord.uid;
  await db.runTransaction(async (tx) => {
    const [org, actor, target] = await tx.getAll(
      db.doc(`orgs/${orgId}`),
      db.doc(`orgs/${orgId}/members/${uid}`),
      db.doc(`orgs/${orgId}/members/${targetUid}`),
    );
    if (!org.exists) throw new HttpsError('not-found', 'Organization not found.');
    const actorRole = actor.exists ? actor.get('role') : null;
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      throw new HttpsError('permission-denied', 'Only organization admins and owners can grant roles.');
    }
    const canonicalOwner = org.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === uid;
    if (role === 'admin' && !actorIsOwner) {
      throw new HttpsError('permission-denied', 'Only an organization owner can grant admin roles.', {
        reason: 'org_owner_required',
      });
    }
    if (target.exists && target.get('role') === 'owner') {
      throw new HttpsError('failed-precondition', "An owner's role cannot be changed.", {
        reason: 'org_owner_protected',
      });
    }
    if (target.exists && target.get('role') === 'admin' && role !== 'admin' && !actorIsOwner) {
      throw new HttpsError('permission-denied', 'Only an organization owner can change an admin role.', {
        reason: 'org_owner_required',
      });
    }
    tx.set(
      target.ref,
      {
        orgId,
        uid: targetUid,
        role,
        email: targetEmail,
        ...(userRecord.displayName ? { name: userRecord.displayName } : {}),
        joinedAt: target.exists ? target.get('joinedAt') ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        grantedBy: uid,
        roleUpdatedAt: FieldValue.serverTimestamp(),
        roleUpdatedBy: uid,
      },
      { merge: true },
    );
  });

  logger.info('org role granted', { orgId, email: targetEmail, role, byUid: uid });
  return { ok: true };
});

export const revokeOrgRole = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'revoke an organization role');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const targetUid = String(data.targetUid ?? '').trim();

  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required');

  await db.runTransaction(async (tx) => {
    const [org, actor, target] = await tx.getAll(
      db.doc(`orgs/${orgId}`),
      db.doc(`orgs/${orgId}/members/${uid}`),
      db.doc(`orgs/${orgId}/members/${targetUid}`),
    );
    if (!org.exists) throw new HttpsError('not-found', 'Organization not found.');
    const actorRole = actor.exists ? actor.get('role') : null;
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      throw new HttpsError('permission-denied', 'Only organization admins and owners can revoke roles.');
    }
    if (!target.exists) throw new HttpsError('not-found', 'Member not found.');
    if (target.get('role') === 'owner') {
      throw new HttpsError('failed-precondition', 'Organization owners cannot be removed here.', {
        reason: 'org_owner_protected',
      });
    }
    const canonicalOwner = org.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === uid;
    if (target.get('role') === 'admin' && !actorIsOwner) {
      throw new HttpsError('permission-denied', 'Only an organization owner can revoke an admin.', {
        reason: 'org_owner_required',
      });
    }
    tx.delete(target.ref);
  });
  logger.info('org role revoked', { orgId, targetUid, byUid: uid });
  return { ok: true };
});

export const initiateOrgOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'initiate organization ownership transfer');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const targetEmail = normalizeEmail(data.email);

  let targetUser: UserRecord | undefined;
  try {
    targetUser = await getAuth().getUserByEmail(targetEmail);
  } catch (error) {
    if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
  }
  if (!targetUser?.emailVerified || targetUser.disabled) {
    throw new HttpsError(
      'failed-precondition',
      'The successor account must be verified and enabled.',
      { reason: 'transfer_account_not_ready' },
    );
  }
  if (targetUser.uid === uid) {
    throw new HttpsError(
      'failed-precondition',
      'You are already the organization owner.',
      { reason: 'transfer_already_owner' },
    );
  }

  const transferRef = db.doc(`orgs/${orgId}/transfers/current`);
  const actorRef = db.doc(`orgs/${orgId}/members/${uid}`);
  const orgRef = db.doc(`orgs/${orgId}`);

  await db.runTransaction(async (tx) => {
    const [orgSnap, actorSnap, currentTransfer] = await tx.getAll(
      orgRef,
      actorRef,
      transferRef,
    );
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');
    const canonicalOwner = orgSnap.get('ownerUid');
    if (actorSnap.get('role') !== 'owner' || canonicalOwner !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Only the organization owner can transfer ownership.',
        { reason: 'org_owner_required' },
      );
    }
    if (ownershipTransferIsPending(currentTransfer)) {
      throw new HttpsError(
        'failed-precondition',
        'An ownership transfer is already pending.',
        { reason: 'transfer_already_pending' },
      );
    }
    const transferId = randomUUID();
    archiveOwnershipTransfer(
      tx,
      currentTransfer,
      db.collection(`orgs/${orgId}/transfers`),
      uid,
    );
    tx.set(transferRef, {
      id: transferId,
      scope: 'org',
      scopeId: orgId,
      targetEmail,
      targetUid: targetUser!.uid,
      initiatedBy: uid,
      initiatedAt: FieldValue.serverTimestamp(),
      expiresAt: ownershipTransferExpiry(),
      status: 'pending',
    });
  });

  logger.info('org ownership transfer initiated', { orgId, targetEmail, byUid: uid });
  return { ok: true };
});

export const acceptOrgOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const identity = requireVerifiedPlatformIdentity(request, 'accept organization ownership transfer');
  const { uid, email } = identity;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);

  const orgRef = db.doc(`orgs/${orgId}`);
  const transferRef = db.doc(`orgs/${orgId}/transfers/current`);
  const newOwnerMemberRef = db.doc(`orgs/${orgId}/members/${uid}`);
  const limitRef = db.doc(`platformUserLimits/${uid}`);
  const defaultsRef = db.doc('config/platformLimits');
  const alreadyOwned = db
    .collection('orgs')
    .where('ownerUid', '==', uid)
    .limit(ORG_LIMITS.perOwnerMax + 1);

  await db.runTransaction(async (tx) => {
    const [owned, orgSnap, transferSnap, newMemberSnap, limitSnap, defaultsSnap] = await Promise.all([
      tx.get(alreadyOwned),
      tx.get(orgRef),
      tx.get(transferRef),
      tx.get(newOwnerMemberRef),
      tx.get(limitRef),
      tx.get(defaultsRef),
    ]);
    const ownershipDefault = effectiveOrgOwnershipLimit(
      defaultsSnap.get('organizationOwnershipDefault'),
    );
    const ownershipLimit = effectiveOrgOwnershipLimit(
      limitSnap.get('organizationLimit'),
      ownershipDefault,
    );
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');
    if (!ownershipTransferIsPending(transferSnap)) {
      throw new HttpsError(
        'failed-precondition',
        'No pending ownership transfer was found.',
        { reason: 'transfer_not_found' },
      );
    }
    const targetEmail = String(transferSnap.get('targetEmail') ?? '').toLowerCase();
    const targetUid = transferSnap.get('targetUid');
    if (targetUid ? targetUid !== uid : targetEmail !== email.toLowerCase()) {
      throw new HttpsError(
        'permission-denied',
        'This ownership transfer was not addressed to this account.',
        { reason: 'transfer_wrong_account' },
      );
    }
    if (owned.docs.filter((ownedOrg) => ownedOrg.id !== orgId).length >= ownershipLimit) {
      throw new HttpsError(
        'resource-exhausted',
        'You already own an organization.',
        { reason: 'org_limit_reached', limit: ownershipLimit },
      );
    }

    const initiatedBy = String(transferSnap.get('initiatedBy') ?? '');
    const initiatingOwner = await tx.get(db.doc(`orgs/${orgId}/members/${initiatedBy}`));
    const membersSnap = await tx.get(
      db.collection(`orgs/${orgId}/members`).where('role', '==', 'owner'),
    );
    const canonicalOwner = orgSnap.get('ownerUid');
    if (initiatingOwner.get('role') !== 'owner' || canonicalOwner !== initiatedBy) {
      throw new HttpsError(
        'failed-precondition',
        'The organization owner changed after this transfer was initiated.',
        { reason: 'transfer_not_found' },
      );
    }
    const now = FieldValue.serverTimestamp();

    // Demote all existing owners to admin
    for (const doc of membersSnap.docs) {
      if (doc.id !== uid) {
        tx.update(doc.ref, {
          role: 'admin',
          roleUpdatedAt: now,
          roleUpdatedBy: uid,
        });
      }
    }

    tx.set(
      newOwnerMemberRef,
      {
        orgId,
        uid,
        email,
        ...(identity.name ? { name: identity.name } : {}),
        role: 'owner',
        joinedAt: newMemberSnap.exists ? newMemberSnap.get('joinedAt') ?? now : now,
        grantedBy: uid,
        roleUpdatedAt: now,
        roleUpdatedBy: uid,
      },
      { merge: true },
    );

    tx.update(orgRef, {
      ownerUid: uid,
      updatedAt: now,
    });

    tx.update(transferRef, {
      status: 'accepted',
      acceptedAt: now,
      acceptedBy: uid,
    });
  });

  logger.info('org ownership transfer accepted', { orgId, newOwnerUid: uid });
  return { ok: true };
});

export const cancelOrgOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'cancel organization ownership transfer');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);

  const actorRef = db.doc(`orgs/${orgId}/members/${uid}`);
  const transferRef = db.doc(`orgs/${orgId}/transfers/current`);
  const orgRef = db.doc(`orgs/${orgId}`);

  await db.runTransaction(async (tx) => {
    const [orgSnap, actorSnap, transferSnap] = await tx.getAll(orgRef, actorRef, transferRef);
    const canonicalOwner = orgSnap.get('ownerUid');
    if (actorSnap.get('role') !== 'owner' || canonicalOwner !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Only the organization owner can cancel an ownership transfer.',
        { reason: 'org_owner_required' },
      );
    }
    if (!ownershipTransferIsPending(transferSnap)) {
      throw new HttpsError(
        'failed-precondition',
        'No pending ownership transfer to cancel.',
        { reason: 'transfer_not_found' },
      );
    }
    tx.update(transferRef, {
      status: 'cancelled',
      cancelledBy: uid,
      cancelledAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('org ownership transfer cancelled', { orgId, byUid: uid });
  return { ok: true };
});

export const getOrgOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const uid = request.auth?.token?.email_verified === true ? request.auth.uid : null;
  const userEmail = request.auth?.token?.email ? String(request.auth.token.email).toLowerCase() : null;

  const transferSnap = await db.doc(`orgs/${orgId}/transfers/current`).get();
  if (!ownershipTransferIsPending(transferSnap)) return { ok: true, transfer: null };
  const tData = transferSnap.data()!;

  const [orgSnap, memberSnap] = await Promise.all([
    db.doc(`orgs/${orgId}`).get(),
    uid ? db.doc(`orgs/${orgId}/members/${uid}`).get() : Promise.resolve(null),
  ]);
  const canonicalOwner = orgSnap.get('ownerUid');
  const isOwner = memberSnap?.get('role') === 'owner' && canonicalOwner === uid;
  const isTarget =
    (userEmail && String(tData.targetEmail ?? '').toLowerCase() === userEmail) ||
    (uid && tData.targetUid === uid);
  if (!isOwner && !isTarget) return { ok: true, transfer: null };

  return {
    ok: true,
    transfer: ownershipTransferView(transferSnap, 'org', orgId),
  };
});

export const deleteOrg = onCall(CALLABLE, async (request) => {
  const uid = requireVerifiedUid(request, 'delete organization');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireOrgId(data);
  const confirm = String(data.confirm ?? '').trim().toLowerCase();

  if (confirm !== orgId) {
    throw new HttpsError('invalid-argument', 'Confirmation name does not match organization slug.');
  }

  const orgRef = db.doc(`orgs/${orgId}`);
  const actorRef = db.doc(`orgs/${orgId}/members/${uid}`);

  await db.runTransaction(async (tx) => {
    const [orgSnap, actorSnap] = await tx.getAll(orgRef, actorRef);
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');
    const canonicalOwner = orgSnap.get('ownerUid');
    if (actorSnap.get('role') !== 'owner' || canonicalOwner !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Only the organization owner can delete the organization.',
        { reason: 'org_owner_required' },
      );
    }

    const [events, members, transfers] = await Promise.all([
      tx.get(db.collection('cfps').where('orgId', '==', orgId).limit(1)),
      tx.get(db.collection(`orgs/${orgId}/members`).limit(401)),
      tx.get(db.collection(`orgs/${orgId}/transfers`).limit(51)),
    ]);
    if (!events.empty) {
      throw new HttpsError(
        'failed-precondition',
        'Move or delete every event before deleting this organization.',
        { reason: 'org_has_events' },
      );
    }
    if (members.size > 400 || transfers.size > 50) {
      throw new HttpsError(
        'failed-precondition',
        'This organization is too large for self-service deletion.',
        { reason: 'org_delete_too_large' },
      );
    }
    for (const member of members.docs) tx.delete(member.ref);
    for (const transfer of transfers.docs) tx.delete(transfer.ref);
    tx.delete(orgRef);
  });

  logger.info('organization deleted', { orgId, byUid: uid });
  return { ok: true };
});

export const initiateEventOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = requireVerifiedUid(request, 'transfer event ownership');
  const data = (request.data ?? {}) as Record<string, unknown>;
  try {
    const result = await initiateEventOwnershipTransferImpl(db, getAuth(), {
      cfpId,
      email: data.email,
      byUid,
    });
    logger.info('event ownership transfer initiated', { cfpId, ...result, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const acceptEventOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const identity = requireVerifiedPlatformIdentity(request, 'accept event ownership transfer');
  try {
    const result = await acceptEventOwnershipTransferImpl(db, getAuth(), {
      cfpId,
      uid: identity.uid,
      email: identity.email,
    });
    logger.info('event ownership transfer accepted', { cfpId, uid: identity.uid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const cancelEventOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = requireVerifiedUid(request, 'cancel event ownership transfer');
  try {
    const result = await cancelEventOwnershipTransferImpl(db, {
      cfpId,
      byUid,
    });
    logger.info('event ownership transfer cancelled', { cfpId, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const getEventOwnershipTransfer = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = request.auth?.token?.email_verified === true ? request.auth.uid : '';
  const email = request.auth?.token?.email ? String(request.auth.token.email) : undefined;
  try {
    const transfer = await getEventOwnershipTransferImpl(db, {
      cfpId,
      byUid: uid,
      email,
    });
    return { ok: true, transfer };
  } catch (error) {
    throw asHttpsError(error);
  }
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

  const theme = readCfpTheme(data.theme);

  const features =
    data.features && typeof data.features === 'object' && !Array.isArray(data.features)
      ? {
          blindReview: (data.features as Record<string, unknown>).blindReview === true,
        }
      : undefined;

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`cfps/${cfpId}`);
    await assertCfpNotArchived(tx, cfpId);
    tx.update(ref, {
      name,
      visibility,
      ...writableProfile(profile),
      ...(theme !== undefined ? { theme } : {}),
      ...(features !== undefined ? { features } : {}),
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
      assertMutationActor(member, 'owner', cfp);
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
      assertMutationActor(member, 'owner', cfp);
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
        const [member, cfp] = await tx.getAll(memberRef, cfpRef);
        assertMutationActor(member, 'owner', cfp);
      });
      try {
        await freezeLegacyHeadshots(db, getStorage().bucket(), cfpId);
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          const [member, cfp] = await tx.getAll(memberRef, cfpRef);
          assertMutationActor(member, 'owner', cfp);
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
    const [cfp, lease, member, emailConfig] = await tx.getAll(
      cfpRef,
      mutationLeaseRef(cfpId),
      db.doc(`cfps/${cfpId}/members/${byUid}`),
      db.doc(`cfps/${cfpId}/config/email`),
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    assertMutationActor(member, 'owner', cfp);
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
      ...(emailConfig.get('domainId') || cfp.get('deletingEmailDomainId')
        ? {
            deletingEmailDomainId:
              emailConfig.get('domainId') ?? cfp.get('deletingEmailDomainId'),
            deletingEmailDomain:
              emailConfig.get('domain') ?? cfp.get('deletingEmailDomain') ?? '',
          }
        : {}),
      ...(emailConfig.get('stagedDomainId') || cfp.get('deletingStagedEmailDomainId')
        ? {
            deletingStagedEmailDomainId:
              emailConfig.get('stagedDomainId') ?? cfp.get('deletingStagedEmailDomainId'),
            deletingStagedEmailDomain:
              emailConfig.get('stagedDomain') ?? cfp.get('deletingStagedEmailDomain') ?? '',
          }
        : {}),
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
    assertMutationActor(owner, 'owner', cfp);
    if (
      cfp.get('archived') !== true ||
      cfp.get('deleting') !== true ||
      owner.get('deletionReserved') !== true
    ) {
      throw new HttpsError('failed-precondition', 'This deletion is no longer reserved.');
    }
    const identities = [
      {
        domainId: String(cfp.get('deletingEmailDomainId') ?? ''),
        domain: String(cfp.get('deletingEmailDomain') ?? ''),
      },
      {
        domainId: String(cfp.get('deletingStagedEmailDomainId') ?? ''),
        domain: String(cfp.get('deletingStagedEmailDomain') ?? ''),
      },
    ].filter(
      (identity, index, all) =>
        identity.domainId &&
        all.findIndex((candidate) => candidate.domainId === identity.domainId) === index,
    );
    const bindings = identities.length
      ? await tx.getAll(...identities.map(({ domainId }) => emailDomainBindingRef(db, domainId)))
      : [];
    for (const [index, binding] of bindings.entries()) {
      const identity = identities[index];
      if (emailDomainBindingMatches(binding.data(), cfpId, identity.domainId, identity.domain)) {
        tx.delete(binding.ref);
      }
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
    if (!after?.exists) return;
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

export const createRoleInviteLink = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'create invitation link');
  const data = (request.data ?? {}) as {
    role?: unknown;
    label?: unknown;
    maxClaims?: unknown;
    expiresAt?: unknown;
  };

  try {
    const link = await createInviteLink(db, {
      cfpId,
      role: data.role,
      label: data.label,
      maxClaims: data.maxClaims,
      expiresAt: data.expiresAt,
      byUid,
    });
    logger.info('role invite link created', { cfpId, linkId: link.id, role: link.role, byUid });
    return { ok: true, link };
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const revokeRoleInviteLink = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireAdmin(request, cfpId, 'revoke invitation link');
  const data = (request.data ?? {}) as { token?: unknown };

  try {
    const result = await revokeInviteLink(db, {
      cfpId,
      token: data.token,
      byUid,
    });
    logger.info('role invite link revoked', { cfpId, token: data.token, byUid });
    return result;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const getRoleInviteLinkInfo = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const data = (request.data ?? {}) as { token?: unknown };

  try {
    const info = await getInviteLinkInfo(db, {
      cfpId,
      token: data.token,
    });
    return info;
  } catch (error) {
    throw asHttpsError(error);
  }
});

export const claimRoleInviteLink = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const uid = requireVerifiedUid(request, 'claim invitation link');
  const token = request.auth!.token;
  const email = token.email as string;
  const name = token.name as string | undefined;
  const data = (request.data ?? {}) as { token?: unknown };

  try {
    const result = await claimInviteLink(db, {
      cfpId,
      token: data.token,
      uid,
      email,
      name,
    });
    logger.info('role invite link claimed', { cfpId, role: result.role, uid });
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
const ADMIN_PROPOSAL_STATUSES = STATUS_SETS.adminSettable;

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
    const perSpeakerLifecycle = usesPerSpeakerLifecycle(snap.data()!);
    const resetSpeakerResponses = perSpeakerLifecycle && current !== status;
    const existingScheduleBaseline = frozenScheduleBaselineIds(snap.data()!);
    const scheduleDecisionNeedsCancellation =
      current !== status &&
      (Boolean(existingScheduleBaseline) ||
        (current === 'confirmed' && perSpeakerLifecycle));
    const hasLiveScheduleRelease =
      scheduleDecisionNeedsCancellation &&
      await currentScheduleReleaseContainsProposal(db, tx, cfpId, proposalId, cfp);
    const establishesScheduleBaseline =
      hasLiveScheduleRelease &&
      current === 'confirmed' &&
      perSpeakerLifecycle &&
      !existingScheduleBaseline;
    const speakerIds = proposalSpeakerIds(snap.data()!);
    const confirmationRefs = resetSpeakerResponses
      ? speakerIds.map((speakerId) =>
          speakerConfirmationRef(db, cfpId, proposalId, speakerId),
        )
      : [];
    const profileUpdateRequestRefs =
      current !== status && ['accepted', 'confirmed'].includes(current)
        ? speakerIds.map((speakerId) =>
            profileUpdateRequestRef(db, cfpId, proposalId, speakerId),
          )
        : [];
    const lifecycleSnapshots =
      confirmationRefs.length + profileUpdateRequestRefs.length > 0
        ? await tx.getAll(...confirmationRefs, ...profileUpdateRequestRefs)
        : [];
    const profileUpdateRequests = lifecycleSnapshots.slice(confirmationRefs.length);
    const pendingLateInvitations =
      current !== status
        ? await tx.get(
            ref.collection('speakerInvitations').where('status', '==', 'pending'),
          )
        : null;
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

    for (const profileUpdateRequest of profileUpdateRequests) {
      cancelPendingProfileUpdateRequest(
        tx,
        profileUpdateRequest,
        byUid,
        'decision-reset',
      );
    }
    for (const confirmationRef of confirmationRefs) {
      tx.set(
        confirmationRef,
        {
          response: FieldValue.delete(),
          answers: FieldValue.delete(),
          speakerPhoto: FieldValue.delete(),
          respondedAt: FieldValue.delete(),
          confirmedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    for (const invitation of pendingLateInvitations?.docs ?? []) {
      if (invitation.get('phase') !== 'postAcceptance') continue;
      tx.update(invitation.ref, {
        status: 'revoked',
        revokedBy: byUid,
        revokedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(ref, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(current !== status &&
      (snap.get('lateSpeakerSchedulePreserved') === true || establishesScheduleBaseline)
        ? {
            ...(hasLiveScheduleRelease ? { scheduleCancellationRequired: true } : {}),
            ...(establishesScheduleBaseline
              ? {
                  lateSpeakerSchedulePreserved: true,
                  lateSpeakerScheduleBaselineIds: proposalSpeakerIds(snap.data()!),
                }
              : {}),
            lateSpeakerPendingIds: FieldValue.delete(),
            lateSpeakerPendingInvitations: FieldValue.delete(),
          }
        : {}),
      ...(current !== status
        ? {
            confirmedAt: FieldValue.delete(),
            ...(!perSpeakerLifecycle
              ? {
                  confirmAnswers: FieldValue.delete(),
                  speakerPhoto: FieldValue.delete(),
                }
              : {}),
          }
        : {}),
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
  const reviewedConfigurationFingerprint = ['release', 'retry', 'resend'].includes(action)
    ? reviewedEmailConfigurationFingerprint(data.emailConfigurationFingerprint)
    : '';

  /*
   * The overview needs only setup state. Keeping this ahead of the queue read
   * avoids loading an event's entire delivery history just to draw one setup
   * checklist item.
   */
  if (action === 'readiness') {
    const observed = await observeEmailDelivery(cfpId);
    return {
      ok: true,
      settings: observed.settings,
      keyHint: observed.keyHint,
      domainId: observed.domainId,
      domain: observed.domain,
      delivery: observed.delivery,
      source: observed.source,
      senderMode: observed.senderMode,
      eventSettings: observed.eventSettings,
      templateOverrides: observed.templateOverrides,
      emailConfigurationFingerprint: observed.configurationFingerprint,
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
    if (!logId || logId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid logId is required.');
    }
    const reviewedTo = data.reviewedTo;
    if (
      typeof reviewedTo !== 'string' ||
      !reviewedTo ||
      reviewedTo.length > 512 ||
      /[\r\n]/.test(reviewedTo)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Resend requires the current recipient from the reviewed preview.',
      );
    }
    await assertCfpNotArchivedNow(cfpId);
    const observed = await requireEmailDelivery(cfpId);
    if (observed.configurationFingerprint !== reviewedConfigurationFingerprint) {
      throw new HttpsError(
        'failed-precondition',
        'The email delivery setup changed. Review the queue again.',
        { reason: 'email_configuration_changed' },
      );
    }

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
      const [cfp, snap, actor] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        ref,
        db.doc(`cfps/${cfpId}/members/${byUid}`),
      );
      assertMutationActor(actor, 'admin');
      const currentConfigurationFingerprint =
        await emailConfigurationFingerprintInTransaction(db, tx, cfpId);
      if (currentConfigurationFingerprint !== reviewedConfigurationFingerprint) {
        throw new HttpsError(
          'failed-precondition',
          'The email delivery setup changed. Review the queue again.',
          { reason: 'email_configuration_changed' },
        );
      }
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
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
      let liveTo = '';
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
        liveTo = resendStaffUser.email!;
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
        liveTo = grantEmail;
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
      if (isProfileUpdateRequestEmail(snap.get('kind'))) {
        const proposalId = String(snap.get('proposalId') ?? '');
        const speakerUid = String(snap.get('recipientUid') ?? '');
        const [updateRequest, proposal, confirmation] = await tx.getAll(
          profileUpdateRequestRef(db, cfpId, proposalId, speakerUid),
          db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
          speakerConfirmationRef(db, cfpId, proposalId, speakerUid),
        );
        if (
          !profileUpdateRequestStillTrue(
            snap.get('kind'),
            String(snap.get('profileUpdateRequestId') ?? ''),
            Number(snap.get('profileUpdateRequestGeneration') ?? 0),
            cfpId,
            proposalId,
            speakerUid,
            updateRequest,
            proposal,
            confirmation,
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That profile update request is no longer sendable.',
          );
        }
      }
      const speakerRecipientUid =
        !isStaffEmail(snap.get('kind')) &&
        !isRoleInvitationEmail(snap.get('kind')) &&
        !isCoSpeakerInvitationEmail(snap.get('kind'))
          ? String(snap.get('recipientUid') ?? '')
          : '';
      if (speakerRecipientUid) {
        const [proposal, speaker] = await tx.getAll(
          db.doc(`cfps/${cfpId}/proposals/${String(snap.get('proposalId') ?? '')}`),
          db.doc(`speakers/${speakerRecipientUid}`),
        );
        const currentEmail = speaker.get('email');
        if (
          !proposal.exists ||
          (!isScheduleEmail(snap.get('kind')) &&
            !proposalSpeakerIds(proposal.data()!).includes(speakerRecipientUid)) ||
          !speaker.exists ||
          typeof currentEmail !== 'string' ||
          !currentEmail
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That speaker notification is no longer sendable.',
          );
        }
        liveTo = currentEmail;
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
        const [proposal, source] = proposalId && currentReleaseId
          ? await tx.getAll(
              db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
              scheduleReleaseSourceRef(cfpId, currentReleaseId),
            )
          : [undefined, undefined];
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
            proposal,
            String(snap.get('recipientUid') ?? ''),
            scheduleReleaseProposalEntryId(source, proposalId),
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'That schedule changed, so this message is no longer sendable.',
          );
        }
      }
      if (!liveTo) liveTo = String(snap.get('to') ?? '');
      if (!liveTo || liveTo !== reviewedTo) {
        throw new HttpsError(
          'failed-precondition',
          'The reviewed email recipient changed. Review the queue again.',
          { reason: 'email_recipients_changed' },
        );
      }
      tx.update(ref, {
        status: 'queued' satisfies EmailStatus,
        to: liveTo,
        reviewedTo: liveTo,
        reviewedEmailConfigurationFingerprint: reviewedConfigurationFingerprint,
        sendingClaimId: FieldValue.delete(),
        sendingStartedAt: FieldValue.delete(),
        // A one-row resend is an explicit new delivery. Bulk retry retains an
        // ambiguous provider attempt so its Resend idempotency key stays stable.
        providerAttemptId: FieldValue.delete(),
        attemptedAt: FieldValue.delete(),
        sentAt: FieldValue.delete(),
        providerId: FieldValue.delete(),
        error: FieldValue.delete(),
        errorReason: FieldValue.delete(),
      });
      return current;
    });

    logger.info('email re-queued', { byUid, logId, was: status });
    return { ok: true, logId, delivery: observed.delivery };
  }

  const log = db.collection(`cfps/${cfpId}/emailLog`);
  if (action === 'summary') {
    const [held, failed, dryRun, sending] = await Promise.all(
      (['held', 'failed', 'dry_run', 'sending'] as const).map((status) =>
        log.where('status', '==', status).get(),
      ),
    );
    const expiredSending = sending.docs.filter((doc) =>
      sendingLeaseExpired(doc.get('sendingStartedAt') ?? doc.updateTime),
    );
    const candidates = [...held.docs, ...failed.docs, ...dryRun.docs, ...expiredSending].filter(
      (doc) => !isCoSpeakerInvitationEmail(doc.get('kind')),
    );
    const pending = await currentDecisionEmails(
      cfpId,
      candidates,
    );
    return {
      ok: true,
      waiting: pending.sendable.filter((doc) => doc.get('status') === 'held').length,
      needsAttention: pending.sendable.filter((doc) => doc.get('status') !== 'held').length,
    };
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
  const currentState =
    action === 'preview' || action === 'release' || action === 'retry'
      ? await currentDecisionEmails(cfpId, action === 'preview' ? queueDocs : pendingDocs)
      : { sendable: pendingDocs, stale: [], recipients: new Map<string, string>() };
  const pendingIds = new Set(pendingDocs.map((doc) => doc.id));
  const pendingState = {
    sendable: currentState.sendable.filter((doc) => pendingIds.has(doc.id)),
    stale: currentState.stale.filter((doc) => pendingIds.has(doc.id)),
    recipients: currentState.recipients,
  };
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
    .map((d) => {
      const status = d.get('status') as string;
      const sentAt = at(d, 'sentAt');
      const attemptedAt = at(d, 'attemptedAt') || sentAt; // Legacy terminal rows used sentAt.
      return {
        logId: d.id,
        kind: d.get('kind') as string,
        to: d.get('to') as string,
        currentTo: currentState.recipients.get(d.id) ?? String(d.get('to') ?? ''),
        status,
        attempts: (d.get('attempts') as number) ?? 0,
        title: (d.get('data')?.title as string) ?? '',
        // Only a message has one. Two of them to the same speaker are otherwise
        // indistinguishable in the log.
        subject: (d.get('subject') as string) ?? '',
        // Milliseconds rather than a Timestamp: the client formats it, and a
        // Timestamp does not survive the callable's JSON.
        attemptedAt: attemptedAt || null,
        sentAt: status === 'sent' ? sentAt || null : null,
        // Provider diagnostics stay raw; application-authored reasons carry a
        // stable code so the client can translate them.
        error: (d.get('error') as string) ?? '',
        errorReason: (d.get('errorReason') as string) ?? '',
        recoverable: recoverableSendingIds.has(d.id),
        // The database row remains held so restoring the decision can release it.
        // This flag lets the log describe its effective state truthfully.
        stale: staleIds.has(d.id),
        sortAt:
          attemptedAt ||
          at(d, 'sendingStartedAt') ||
          at(d, 'createdAt') ||
          d.updateTime.toMillis(),
      };
    })
    .sort((a, b) => b.sortAt - a.sortAt || a.logId.localeCompare(b.logId))
    .map(({ sortAt: _sortAt, ...row }) => row);

  if (action === 'preview') {
    const observed = await observeEmailDelivery(cfpId);
    const reviewRow = (d: (typeof snap.docs)[number]) => ({
      logId: d.id,
      kind: d.get('kind') as string,
      to: pendingState.recipients.get(d.id) ?? String(d.get('to') ?? ''),
      title: (d.get('data')?.title as string) ?? '',
      status: d.get('status') as string,
      recoverable: recoverableSendingIds.has(d.id),
    });
    const heldSendable = pendingState.sendable
      .filter((d) => d.get('status') === 'held');
    const retryableSendable = pendingState.sendable
      .filter((d) => d.get('status') !== 'held');
    const held = heldSendable.slice(0, EMAIL_REVIEW_BATCH_CAP).map(reviewRow);
    const retryable = retryableSendable.slice(0, EMAIL_REVIEW_BATCH_CAP).map(reviewRow);
    return {
      ok: true,
      tally,
      settings: observed.settings,
      // Setup state for the panel. `keyHint` is the last four characters of the
      // API key — never the key.
      keyHint: observed.keyHint,
      domainId: observed.domainId,
      // The name, not just the id: the panel compares it against the sender to
      // catch an address on a domain that was never verified.
      domain: observed.domain,
      delivery: observed.delivery,
      templates: observed.templates,
      source: observed.source,
      senderMode: observed.senderMode,
      eventSettings: observed.eventSettings,
      templateOverrides: observed.templateOverrides,
      emailConfigurationFingerprint: observed.configurationFingerprint,
      // Enough to check the copy and the addresses before committing to a send.
      held,
      retryable,
      waiting: heldSendable.length,
      needsAttention: retryableSendable.length,
      heldRemaining: Math.max(0, heldSendable.length - held.length),
      retryableRemaining: Math.max(0, retryableSendable.length - retryable.length),
      staleHeld: pendingState.stale.filter((d) => d.get('status') === 'held').length,
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
  const observed = await requireEmailDelivery(cfpId);
  if (observed.configurationFingerprint !== reviewedConfigurationFingerprint) {
    throw new HttpsError(
      'failed-precondition',
      'The email delivery setup changed. Review the queue again.',
      { reason: 'email_configuration_changed' },
    );
  }

  // `dry_run` counts as unsent, because it is: the row records a message that
  // was rendered while no sender was configured. Retrying picks those up once
  // the domain is, so a receipt written during setup still reaches its speaker.
  const from: EmailStatus[] =
    action === 'release' ? ['held'] : ['failed', 'dry_run', 'sending'];
  let candidates: DocumentSnapshot[];
  let reviewedRecipients = new Map<string, string>();
  if (action === 'release' || action === 'retry') {
    const rawLogIds = data.logIds;
    if (
      !Array.isArray(rawLogIds) ||
      rawLogIds.length === 0 ||
      rawLogIds.some((id) => typeof id !== 'string' || !id || id.includes('/')) ||
      new Set(rawLogIds).size !== rawLogIds.length
    ) {
      throw new HttpsError(
        'invalid-argument',
        `${action === 'release' ? 'Release' : 'Retry'} requires the unique message ids from the reviewed preview.`,
      );
    }
    const reviewedLogIds = rawLogIds as string[];
    reviewedRecipients = reviewedEmailRecipients(
      data.reviewedRecipients,
      reviewedLogIds,
      action,
    );
    candidates = await db.getAll(...reviewedLogIds.map((id) => log.doc(id)));
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
  const { released, stale } = await advanceEmailQueue(
    cfpId,
    byUid,
    reviewedConfigurationFingerprint,
    candidates,
    from,
    reviewedRecipients,
  );

  logger.info('email queue advanced', { byUid, action, count: released, stale });
  return { ok: true, tally, released, stale, delivery: observed.delivery };
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
const SIGN_IN_ROLE_INVITE_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIGN_IN_DESTINATIONS = new Set([
  'submit',
  'join',
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
 * One atomic allowance across the target, best-effort caller network and
 * platform. The network signal can be shared or rotated; the coarse platform
 * breaker is the authoritative cost ceiling and may briefly refuse legitimate
 * links under attack to preserve the shared sender's reputation.
 *
 * Every specific identifier is hashed. The raw address and request IP never
 * enter the counter collection or a log.
 */
async function takeLinkAllowance(
  email: string,
  rawIp: string | undefined,
  callerUid: string | undefined,
): Promise<void> {
  const network = normaliseSignInNetwork(rawIp);
  const caller = network
    ? `network:${network}`
    : callerUid
      ? `uid:${callerUid}`
      : 'network:unknown';
  const refs = [
    // Keep the deployed address bucket id so a rollout cannot reset its window.
    db.doc(`signInLinks/${createHash('sha256').update(email).digest('hex')}`),
    db.doc(`signInLinks/${signInLinkLimitId('caller', caller)}`),
    db.doc(`signInLinks/${signInLinkLimitId('platform', 'all')}`),
  ];
  const limits = [
    SIGN_IN_LINKS_PER_ADDRESS,
    SIGN_IN_LINKS_PER_NETWORK,
    SIGN_IN_LINKS_PER_PLATFORM,
  ];
  await db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...refs);
    const now = Date.now();
    const next = snapshots.map((snapshot, index) =>
      nextSignInLinkCounter(snapshot.data() ?? {}, limits[index], now),
    );
    if (next.some((counter) => counter === null)) {
      throw new HttpsError('resource-exhausted', 'Too many sign-in links. Try again later.');
    }
    refs.forEach((ref, index) => {
      tx.set(ref, { ...next[index]!, updatedAt: FieldValue.serverTimestamp() });
    });
  });
}

/**
 * Mint a sign-in link via Firebase Auth and hand it to Resend.
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
    roleInviteToken?: unknown;
  };
  const email = String(data.email ?? '').trim().toLowerCase();
  const locale: EmailLocale = data.locale === 'fr' ? 'fr' : 'en';
  const cfpIdProvided = data.cfpId !== undefined && data.cfpId !== null;
  if (
    cfpIdProvided &&
    (typeof data.cfpId !== 'string' || validateCfpId(data.cfpId) !== null)
  ) {
    throw new HttpsError('invalid-argument', 'A valid call for proposals is required.');
  }
  const cfpId = typeof data.cfpId === 'string' ? data.cfpId : null;
  const destination =
    typeof data.destination === 'string' && SIGN_IN_DESTINATIONS.has(data.destination)
      ? data.destination
      : 'submit';
  const proposalId = typeof data.proposalId === 'string' ? data.proposalId : '';
  const speakerInvitationProvided = data.speakerInvitationId !== undefined;
  const speakerInvitationId =
    typeof data.speakerInvitationId === 'string' ? data.speakerInvitationId : '';
  const hasSpeakerInvitation = Boolean(speakerInvitationId);
  const hasProposalSelection = Boolean(proposalId);
  const roleInviteToken = typeof data.roleInviteToken === 'string' ? data.roleInviteToken : '';
  const hasRoleInviteToken = Boolean(roleInviteToken);

  if (
    speakerInvitationProvided &&
    (!cfpId ||
      destination !== 'submit' ||
      !SIGN_IN_PROPOSAL_ID.test(proposalId) ||
      !SIGN_IN_SPEAKER_INVITATION_ID.test(speakerInvitationId))
  ) {
    throw new HttpsError('invalid-argument', 'A valid speaker invitation is required.');
  }
  if (
    hasProposalSelection &&
    !hasSpeakerInvitation &&
    (!cfpId || destination !== 'submit' || !SIGN_IN_PROPOSAL_ID.test(proposalId))
  ) {
    throw new HttpsError('invalid-argument', 'A valid proposal selection is required.');
  }
  if (
    hasRoleInviteToken &&
    (!cfpId || destination !== 'join' || !SIGN_IN_ROLE_INVITE_TOKEN.test(roleInviteToken))
  ) {
    throw new HttpsError('invalid-argument', 'A valid invitation token is required.');
  }

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  }

  const [apiKey, platform] = await Promise.all([readResendKey(), loadPlatform(db)]);
  // Named CFP or not, the sender is looked up server-side. Nothing about who
  // this mail comes from is taken from the caller.
  const [resolvedEmail, cfpSnap, invitationSnap, invitationProposalSnap] = await Promise.all([
    cfpId ? resolveEmailConfiguration(db, cfpId) : Promise.resolve(null),
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
  const settings = resolvedEmail?.settings ?? platform.settings;
  if (cfpId && (!cfpSnap?.exists || cfpSnap.get('deleting') === true)) {
    throw new HttpsError('not-found', 'No such call for proposals.');
  }
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
  const emulatedDelivery = process.env.FUNCTIONS_EMULATOR === 'true';
  if (
    (resolvedEmail && emailConfigurationHasInvalidActiveIdentity(resolvedEmail)) ||
    !signInEmailDeliveryReady(apiKey, settings.from, emulatedDelivery)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Sign-in email delivery is not configured.',
      { reason: 'sign_in_email_not_configured' },
    );
  }
  const event = (cfpSnap?.get('name') as string) || platform.name;

  // Throttle before Auth mints a bearer credential. Doing this after link
  // generation would still let a caller burn the Auth OOB quota even when the
  // Resend handoff is refused as rate-limited.
  await takeLinkAllowance(email, request.rawRequest.ip, request.auth?.uid);

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
          : hasProposalSelection
            ? `${cfpUrl(platform.publicUrl, cfpId)}?${new URLSearchParams({
                proposal: proposalId,
              }).toString()}`
          : cfpUrl(platform.publicUrl, cfpId)
        : destination === 'join'
          ? hasRoleInviteToken
            ? `${platform.publicUrl}/c/${cfpId}/join?${new URLSearchParams({
                invite: roleInviteToken,
              }).toString()}`
            : `${platform.publicUrl}/c/${cfpId}/join`
        : `${platform.publicUrl}/c/${cfpId}/${destination}`
      : `${platform.publicUrl}/`,
    handleCodeInApp: true,
  });
  const link = useFreshHostingOrigin(
    generatedLink,
    process.env.GCLOUD_PROJECT,
    emulatedDelivery,
  );

  // Auth link generation can take long enough for a sender or binding to be
  // replaced. Resolve again at the handoff so a deleted CFP cannot borrow the
  // platform sender and a stale event/platform identity is never used.
  const [
    handoffApiKey,
    handoffResolvedEmail,
    handoffPlatform,
    handoffCfp,
    handoffInvitation,
    handoffInvitationProposal,
  ] = await Promise.all([
    readResendKey(),
    cfpId ? resolveEmailConfiguration(db, cfpId) : Promise.resolve(null),
    cfpId ? Promise.resolve(null) : loadPlatform(db),
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
  const handoffSettings =
    handoffResolvedEmail?.settings ?? handoffPlatform?.settings ?? platform.settings;
  if (cfpId && (!handoffCfp?.exists || handoffCfp.get('deleting') === true)) {
    throw new HttpsError('not-found', 'No such call for proposals.');
  }
  if (
    hasSpeakerInvitation &&
    !coSpeakerSignInInvitationStillTrue(
      speakerInvitationId,
      cfpId!,
      proposalId,
      email,
      handoffInvitation,
      handoffInvitationProposal,
      handoffCfp,
    )
  ) {
    throw new HttpsError('not-found', 'That speaker invitation is no longer active.');
  }
  if (
    (handoffResolvedEmail &&
      emailConfigurationHasInvalidActiveIdentity(handoffResolvedEmail)) ||
    !signInEmailDeliveryReady(handoffApiKey, handoffSettings.from, emulatedDelivery)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Sign-in email delivery is not configured.',
      { reason: 'sign_in_email_not_configured' },
    );
  }

  const outcome = await sendViaResend(
    email,
    renderSignInEmail(link, locale, event),
    handoffApiKey,
    handoffSettings,
  );
  // The address is not logged: this line would otherwise be a record of who
  // tried to sign in, sitting in Cloud Logging with a much wider audience than
  // Firestore has.
  logger.info('sign-in link sent', { status: outcome.status });

  if (outcome.status === 'dry_run' && !emulatedDelivery) {
    throw new HttpsError(
      'failed-precondition',
      'Sign-in email delivery is not configured.',
      { reason: 'sign_in_email_not_configured' },
    );
  }
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
  const action = String(data.action ?? 'send');
  if (action !== 'preview' && action !== 'send') {
    throw new HttpsError('invalid-argument', `Unknown action "${action}".`);
  }

  if (action === 'preview') {
    const [contexts, resolved, contentContext] = await Promise.all([
      db.runTransaction((tx) => speakerMessageContexts(tx, cfpId, proposalId)),
      resolveEmailConfiguration(db, cfpId),
      loadEmailContentContext(db, cfpId),
    ]);
    return {
      ok: true,
      kind: MESSAGE_KIND,
      recipientCount: contexts.length,
      recipients: contexts.map(({ uid, to, data: contextData }) => ({
        uid,
        to,
        name: contextData.speakerName,
      })),
      recipientsFingerprint: speakerMessageRecipientsFingerprint(contexts),
      emailConfigurationFingerprint: emailConfigurationFingerprint(resolved, contentContext),
    };
  }

  const subject = String(data.subject ?? '').trim();
  const body = String(data.body ?? '').trim();
  const expectedRecipientsFingerprint = String(data.expectedRecipientsFingerprint ?? '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(expectedRecipientsFingerprint)) {
    throw new HttpsError(
      'invalid-argument',
      'Review the current recipients before queueing this message.',
    );
  }
  const expectedEmailConfigurationFingerprint = reviewedEmailConfigurationFingerprint(
    data.expectedEmailConfigurationFingerprint,
  );

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

  const observed = await requireEmailDelivery(cfpId);
  if (observed.configurationFingerprint !== expectedEmailConfigurationFingerprint) {
    throw new HttpsError(
      'failed-precondition',
      'The email delivery setup changed. Review the message again before queueing.',
      { reason: 'email_configuration_changed' },
    );
  }

  const logIds = await db.runTransaction(async (tx) => {
    const [cfp, member] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      db.doc(`cfps/${cfpId}/members/${byUid}`),
    );
    assertMutationActor(member, 'admin');
    const currentConfigurationFingerprint =
      await emailConfigurationFingerprintInTransaction(db, tx, cfpId);
    if (currentConfigurationFingerprint !== expectedEmailConfigurationFingerprint) {
      throw new HttpsError(
        'failed-precondition',
        'The email delivery setup changed. Review the message again before queueing.',
        { reason: 'email_configuration_changed' },
      );
    }
    if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    const contexts = await speakerMessageContexts(tx, cfpId, proposalId);
    if (speakerMessageRecipientsFingerprint(contexts) !== expectedRecipientsFingerprint) {
      throw new HttpsError(
        'failed-precondition',
        'The speaker recipients changed. Review them again before queueing.',
        { reason: 'speaker_message_recipients_changed' },
      );
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
        reviewedTo: context.to,
        reviewedEmailConfigurationFingerprint: expectedEmailConfigurationFingerprint,
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
  return {
    ok: true,
    logId: logIds[0],
    logIds,
    recipientCount: logIds.length,
    delivery: observed.delivery,
  };
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
  if (data.replyToOnly !== undefined && data.replyToOnly !== true) {
    throw new HttpsError('invalid-argument', 'replyToOnly must be true when provided.');
  }
  if (data.platformSenderNameOnly !== undefined && data.platformSenderNameOnly !== true) {
    throw new HttpsError(
      'invalid-argument',
      'platformSenderNameOnly must be true when provided.',
    );
  }
  const replyToOnly = data.replyToOnly === true;
  const platformSenderNameOnly = data.platformSenderNameOnly === true;
  if (replyToOnly && platformSenderNameOnly) {
    throw new HttpsError('invalid-argument', 'Change one email setting at a time.');
  }
  if (
    (replyToOnly || platformSenderNameOnly || data.senderMode !== undefined) &&
    data.senderMode !== 'platform' &&
    data.senderMode !== 'event'
  ) {
    throw new HttpsError('invalid-argument', 'senderMode must be platform or event.');
  }
  const senderMode: EmailSource = data.senderMode === 'platform' ? 'platform' : 'event';
  const from = typeof data.from === 'string' ? data.from.trim() : '';
  const senderName = typeof data.senderName === 'string' ? data.senderName.trim() : '';
  const replyTo = typeof data.replyTo === 'string' ? data.replyTo.trim() : null;
  if (platformSenderNameOnly) {
    if (senderMode !== 'platform') {
      throw new HttpsError('invalid-argument', 'A platform sender name needs platform mode.');
    }
    if (!validSenderDisplayName(senderName)) {
      throw new HttpsError('invalid-argument', 'The sender name is invalid or too long.');
    }
  } else if (replyToOnly && replyTo) {
    const problem = validateSettings({ from: 'sender@example.org', replyTo, publicUrl: '' });
    if (problem) {
      throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);
    }
  } else if (!replyToOnly && senderMode === 'event') {
    const problem = validateSettings({ from, replyTo: replyTo ?? '', publicUrl: '' });
    if (problem) {
      throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);
    }
  } else if (!replyToOnly && replyTo) {
    const problem = validateSettings({ from: 'sender@example.org', replyTo, publicUrl: '' });
    if (problem) {
      throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);
    }
  }

  const configRef = db.doc(`cfps/${cfpId}/config/email`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
  const currentConfig = await configRef.get();
  const currentData = currentConfig.data() ?? {};
  if (platformSenderNameOnly) {
    const platformRef = db.doc('config/platformEmail');
    await db.runTransaction(async (tx) => {
      const [cfp, config, member, platform] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        configRef,
        memberRef,
        platformRef,
      );
      assertMutationActor(member, 'admin');
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      if (inferredEventEmailMode(config.data() ?? {}) !== 'platform') {
        throw new HttpsError(
          'aborted',
          'The email delivery source changed. Reload before saving the sender.',
        );
      }
      const platformDomainId = String(platform.get('domainId') ?? '');
      const platformDomain = String(platform.get('domain') ?? '').toLowerCase();
      if (!platformDomainId || !platformDomain) {
        throw new HttpsError('failed-precondition', 'Set up the platform sending domain first.');
      }
      const binding = await tx.get(emailDomainBindingRef(db, platformDomainId));
      if (
        !platformEmailDomainBindingMatches(
          binding.data(),
          platformDomainId,
          platformDomain,
        )
      ) {
        throw new HttpsError(
          'failed-precondition',
          'The platform sending domain is not assigned correctly.',
        );
      }
      tx.set(
        configRef,
        { platformSenderName: senderName ? senderName : FieldValue.delete() },
        { merge: true },
      );
    });
    const resolved = await resolveEmailConfiguration(db, cfpId);
    logger.info('event platform sender name changed', {
      byUid,
      cfpId,
      inherited: !senderName,
    });
    return { ok: true, settings: resolved.settings, source: resolved.source };
  }
  if (replyToOnly) {
    await db.runTransaction(async (tx) => {
      const [cfp, config, member] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        configRef,
        memberRef,
      );
      assertMutationActor(member, 'admin');
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      if (inferredEventEmailMode(config.data() ?? {}) !== senderMode) {
        throw new HttpsError(
          'aborted',
          'The email delivery source changed. Reload before saving the reply-to address.',
        );
      }
      tx.set(
        configRef,
        { replyTo: replyTo === null ? FieldValue.delete() : replyTo },
        { merge: true },
      );
    });
    const resolved = await resolveEmailConfiguration(db, cfpId);
    logger.info('email reply-to changed', { byUid, cfpId, senderMode });
    return { ok: true, settings: resolved.settings, source: resolved.source };
  }
  if (senderMode === 'platform') {
    await db.runTransaction(async (tx) => {
      const [cfp, member] = await tx.getAll(db.doc(`cfps/${cfpId}`), memberRef);
      assertMutationActor(member, 'admin');
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
        throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
      }
      const patch: Record<string, unknown> = {
        senderMode: 'platform',
        replyTo: replyTo === null ? FieldValue.delete() : replyTo,
      };
      if (typeof data.from === 'string') patch.from = from;
      tx.set(configRef, patch, { merge: true });
    });
    const resolved = await resolveEmailConfiguration(db, cfpId);
    logger.info('email settings changed', { byUid, cfpId, senderMode });
    return { ok: true, settings: resolved.settings, source: resolved.source };
  }

  const registeredId = String(currentData.stagedDomainId ?? currentData.domainId ?? '');
  const registered = String(currentData.stagedDomain ?? currentData.domain ?? '').toLowerCase();
  if (!registered || !registeredId) {
    throw new HttpsError('failed-precondition', 'Add your sending domain first.');
  }
  const binding = await emailDomainBindingRef(db, registeredId).get();
  if (!emailDomainBindingMatches(binding.data(), cfpId, registeredId, registered)) {
    const legacyCandidate =
      currentData.domainId === registeredId &&
      String(currentData.domain ?? '').toLowerCase() === registered;
    if (!legacyCandidate || !(await ensureLegacyEmailDomainBinding(db, cfpId, currentData))) {
      throw new HttpsError(
        'failed-precondition',
        'This sending domain is not assigned to this call for proposals.',
      );
    }
  }
  const mismatch = senderMismatch(from, registered);
  if (mismatch) {
    throw new HttpsError('invalid-argument', `${mismatch} is not your verified domain.`);
  }
  if (!(process.env.FUNCTIONS_EMULATOR === 'true' && currentData.emulatorDeliveryReady === true)) {
    try {
      const providerDomain = await getDomain(await readResendKey(), registeredId);
      if (
        providerDomain.id !== registeredId ||
        providerDomain.name.toLowerCase() !== registered ||
        providerDomain.status !== 'verified'
      ) {
        throw new HttpsError('failed-precondition', 'Verify this sending domain first.');
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw asResendError(error);
    }
  }

  await db.runTransaction(async (tx) => {
    const oldDomainId = String(currentData.domainId ?? '');
    const refs = [
      db.doc(`cfps/${cfpId}`),
      configRef,
      memberRef,
      emailDomainBindingRef(db, registeredId),
      ...(oldDomainId && oldDomainId !== registeredId
        ? [emailDomainBindingRef(db, oldDomainId)]
        : []),
    ];
    const [cfp, config, member, activeBinding, oldBinding] = await tx.getAll(
      ...refs,
    ) as DocumentSnapshot[];
    assertMutationActor(member, 'admin');
    if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    const latestId = String(config.get('stagedDomainId') ?? config.get('domainId') ?? '');
    const latestDomain = String(config.get('stagedDomain') ?? config.get('domain') ?? '').toLowerCase();
    if (
      latestId !== registeredId ||
      latestDomain !== registered ||
      !emailDomainBindingMatches(activeBinding.data(), cfpId, registeredId, registered)
    ) {
      throw new HttpsError(
        'aborted',
        'The sending domain changed. Try again.',
      );
    }
    tx.set(configRef, {
      senderMode: 'event',
      from,
      replyTo: replyTo === null ? FieldValue.delete() : replyTo,
      domainId: registeredId,
      domain: registered,
      stagedDomainId: FieldValue.delete(),
      stagedDomain: FieldValue.delete(),
    }, { merge: true });
    if (
      oldBinding &&
      emailDomainBindingMatches(
        oldBinding.data(),
        cfpId,
        oldDomainId,
        String(currentData.domain ?? ''),
      )
    ) {
      tx.delete(oldBinding.ref);
    }
  });
  const resolved = await resolveEmailConfiguration(db, cfpId);
  logger.info('email settings changed', { byUid, cfpId, senderMode });
  return { ok: true, settings: resolved.settings, source: resolved.source };
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
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);

  if (data.reset === true) {
    await db.runTransaction(async (tx) => {
      const [cfp, config, member] = await tx.getAll(cfpRef, configRef, memberRef);
      assertMutationActor(member, 'admin');
      if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
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
    const [cfp, member] = await tx.getAll(cfpRef, memberRef);
    assertMutationActor(member, 'admin');
    if (!cfp.exists || cfp.get('archived') === true || cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
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
  await requireEmailDelivery(cfpId);
  const platform = await loadPlatform(db);
  // This is the last check possible before the provider handoff. An archive
  // racing the HTTP request itself cannot recall a message Resend accepted.
  await assertCfpNotArchivedNow(cfpId);
  const finalObserved = await requireEmailDelivery(cfpId);
  const currentUser = await verifiedStaffUser(uid);
  const currentMember = await db.doc(`cfps/${cfpId}/members/${uid}`).get();
  if (
    !currentUser?.email ||
    currentUser.email.trim().toLowerCase() !== to.trim().toLowerCase() ||
    (currentMember.get('role') !== 'owner' && currentMember.get('role') !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Only a current admin can send a test.');
  }
  const finalApiKey = await readResendKey();
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
    finalApiKey,
    finalObserved.settings,
    { id: cfpId, name: (cfpSnap.get('name') as string) || cfpId, publicUrl: platform.publicUrl },
    finalObserved.templates,
  );

  logger.info('test email', { uid, kind, status: outcome.status });
  if (outcome.status === 'failed') {
    throw new HttpsError('unavailable', outcome.error ?? 'Resend refused it.');
  }
  return { ok: true, status: outcome.status, to, delivery: finalObserved.delivery };
});

/** The shared provider credential can be rotated only by platform administration. */
export const setEmailSecret = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const identity = await requirePlatformAdmin(request, 'set the Resend API key');
  const byUid = identity.uid;
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

  // Re-read Auth and the platform role immediately before the external write.
  // Claiming a pending grant above is not enough: either can be revoked while
  // Resend is validating the candidate key.
  const user = await getAuth().getUser(byUid);
  const currentEmail = user.email?.trim().toLowerCase() ?? '';
  const claimedEmail = identity.email.trim().toLowerCase();
  if (
    user.disabled ||
    !user.emailVerified ||
    currentEmail !== claimedEmail
  ) {
    throw new HttpsError(
      'permission-denied',
      'Only a current platform admin can set the Resend API key.',
    );
  }

  const providerRef = db.doc('config/emailProvider');
  const memberRef = db.doc(`platformMembers/${byUid}`);
  const rotationId = randomUUID();
  await db.runTransaction(async (tx) => {
    const [provider, member] = await tx.getAll(providerRef, memberRef);
    if (
      String(member.get('email') ?? '').trim().toLowerCase() !== claimedEmail ||
      (member.get('role') !== 'owner' && member.get('role') !== 'admin')
    ) {
      throw new HttpsError(
        'permission-denied',
        'Only a current platform admin can set the Resend API key.',
      );
    }
    const expiresAt = provider.get('rotationExpiresAt');
    if (expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now()) {
      throw new HttpsError('aborted', 'Another API key rotation is in progress. Try again.');
    }
    tx.set(
      providerRef,
      {
        rotationId,
        rotationBy: byUid,
        rotationExpiresAt: Timestamp.fromMillis(Date.now() + EXTERNAL_MUTATION_LEASE_MS),
      },
      { merge: true },
    );
  });

  try {
    await writeResendKey(apiKey);
    await db.runTransaction(async (tx) => {
      const provider = await tx.get(providerRef);
      if (provider.get('rotationId') !== rotationId) {
        throw new HttpsError('aborted', 'The API key rotation lease expired. Try again.');
      }
      tx.set(
        providerRef,
        {
          keyHint: keyHint(apiKey),
          keySetAt: FieldValue.serverTimestamp(),
          keySetBy: byUid,
          rotationId: FieldValue.delete(),
          rotationBy: FieldValue.delete(),
          rotationExpiresAt: FieldValue.delete(),
        },
        { merge: true },
      );
    });
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const provider = await tx.get(providerRef);
      if (provider.get('rotationId') === rotationId) {
        tx.set(
          providerRef,
          {
            rotationId: FieldValue.delete(),
            rotationBy: FieldValue.delete(),
            rotationExpiresAt: FieldValue.delete(),
          },
          { merge: true },
        );
      }
    });
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

async function requireCurrentPlatformAdmin(
  byUid: string,
  email: string,
): Promise<DocumentSnapshot> {
  const [user, member] = await Promise.all([
    getAuth().getUser(byUid),
    db.doc(`platformMembers/${byUid}`).get(),
  ]);
  const normalized = email.trim().toLowerCase();
  if (
    user.disabled ||
    !user.emailVerified ||
    user.email?.trim().toLowerCase() !== normalized ||
    String(member.get('email') ?? '').trim().toLowerCase() !== normalized ||
    (member.get('role') !== 'owner' && member.get('role') !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Only a current platform admin can do that.');
  }
  return member;
}

async function acquirePlatformEmailMutation(
  identity: { uid: string; email: string },
  kind: string,
): Promise<string> {
  await requireCurrentPlatformAdmin(identity.uid, identity.email);
  const mutationId = randomUUID();
  await db.runTransaction(async (tx) => {
    const configRef = db.doc('config/platformEmail');
    const [member, config] = await tx.getAll(
      db.doc(`platformMembers/${identity.uid}`),
      configRef,
    );
    if (
      String(member.get('email') ?? '').trim().toLowerCase() !== identity.email.toLowerCase() ||
      (member.get('role') !== 'owner' && member.get('role') !== 'admin')
    ) {
      throw new HttpsError('permission-denied', 'Only a current platform admin can do that.');
    }
    const expiresAt = config.get('domainMutationExpiresAt');
    if (expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now()) {
      throw new HttpsError('aborted', 'Another platform email change is in progress. Try again.');
    }
    tx.set(
      configRef,
      {
        domainMutationId: mutationId,
        domainMutationKind: kind,
        domainMutationBy: identity.uid,
        domainMutationExpiresAt: Timestamp.fromMillis(Date.now() + EXTERNAL_MUTATION_LEASE_MS),
      },
      { merge: true },
    );
  });
  return mutationId;
}

async function releasePlatformEmailMutation(mutationId: string): Promise<void> {
  const ref = db.doc('config/platformEmail');
  await db.runTransaction(async (tx) => {
    const config = await tx.get(ref);
    if (config.get('domainMutationId') !== mutationId) return;
    tx.set(
      ref,
      {
        domainMutationId: FieldValue.delete(),
        domainMutationKind: FieldValue.delete(),
        domainMutationBy: FieldValue.delete(),
        domainMutationExpiresAt: FieldValue.delete(),
      },
      { merge: true },
    );
  });
}

export const getPlatformEmailConfiguration = onCall(CALLABLE, async (request) => {
  await requirePlatformAdmin(request, 'view platform email settings');
  return { ok: true, ...(await observePlatformEmailDelivery()) };
});

export const setPlatformEmailSettings = onCall(CALLABLE, async (request) => {
  const identity = await requirePlatformAdmin(request, 'change platform email settings');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const settings: EmailSettings = {
    from: String(data.from ?? '').trim(),
    replyTo: String(data.replyTo ?? '').trim(),
    publicUrl: '',
  };
  const problem = validateSettings(settings);
  if (problem) throw new HttpsError('invalid-argument', `${problem.field}: ${problem.problem}`);

  await requireCurrentPlatformAdmin(identity.uid, identity.email);
  const configRef = db.doc('config/platformEmail');
  await db.runTransaction(async (tx) => {
    const [member, config] = await tx.getAll(
      db.doc(`platformMembers/${identity.uid}`),
      configRef,
    );
    if (
      String(member.get('email') ?? '').trim().toLowerCase() !== identity.email.toLowerCase() ||
      (member.get('role') !== 'owner' && member.get('role') !== 'admin')
    ) {
      throw new HttpsError('permission-denied', 'Only a current platform admin can do that.');
    }
    const domainId = String(config.get('domainId') ?? '');
    const domain = String(config.get('domain') ?? '').toLowerCase();
    if (!domainId || !domain) {
      throw new HttpsError('failed-precondition', 'Add the platform sending domain first.');
    }
    const binding = await tx.get(emailDomainBindingRef(db, domainId));
    if (!platformEmailDomainBindingMatches(binding.data(), domainId, domain)) {
      throw new HttpsError('failed-precondition', 'The platform sending domain is not assigned.');
    }
    const mismatch = senderMismatch(settings.from, domain);
    if (mismatch) throw new HttpsError('invalid-argument', `${mismatch} is not the verified domain.`);
    tx.set(configRef, { from: settings.from, replyTo: settings.replyTo }, { merge: true });
  });
  logger.info('platform email settings changed', { byUid: identity.uid });
  return { ok: true, settings };
});

/** Tests the shared transport with built-in copy; wording remains event-owned. */
export const sendPlatformTestEmail = onCall(CALLABLE, async (request) => {
  const identity = await requirePlatformAdmin(request, 'send a platform email test');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const locale: EmailLocale = data.locale === 'fr' ? 'fr' : 'en';
  const observed = await observePlatformEmailDelivery();
  if (!observed.delivery.ready) {
    throw new HttpsError('failed-precondition', 'Email delivery setup is incomplete.', {
      reason: 'email_delivery_not_ready',
      problems: observed.delivery.problems,
      domainStatus: observed.delivery.domainStatus,
    });
  }
  await requireCurrentPlatformAdmin(identity.uid, identity.email);
  const platform = await loadPlatform(db);
  const finalHandoff = await observePlatformEmailDelivery();
  if (!finalHandoff.delivery.ready) {
    throw new HttpsError('failed-precondition', 'Email delivery setup changed.', {
      reason: 'email_delivery_not_ready',
      problems: finalHandoff.delivery.problems,
      domainStatus: finalHandoff.delivery.domainStatus,
    });
  }
  await requireCurrentPlatformAdmin(identity.uid, identity.email);
  const finalApiKey = await readResendKey();
  const outcome = await deliver(
    {
      kind: 'submission_received',
      locale,
      to: identity.email,
      data: {
        speakerName: identity.name || identity.email,
        title: 'A test of the platform sending setup',
        needsVisa: false,
      },
    },
    finalApiKey,
    finalHandoff.settings,
    { id: 'platform', name: platform.name, publicUrl: platform.publicUrl },
  );
  if (outcome.status === 'failed') throw new HttpsError('unavailable', 'Resend refused the test.');
  return { ok: true, status: outcome.status, to: identity.email, delivery: finalHandoff.delivery };
});

export const platformEmailDomain = onCall(EXTERNAL_MUTATION_CALLABLE, async (request) => {
  const identity = await requirePlatformAdmin(request, 'manage the platform sending domain');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? 'list');
  const configRef = db.doc('config/platformEmail');

  try {
    if (action === 'list' || action === 'get') {
      const [apiKey, config] = await Promise.all([readResendKey(), configRef.get()]);
      const domainId = String(config.get('stagedDomainId') ?? config.get('domainId') ?? '');
      const storedName = String(
        config.get('stagedDomain') ?? config.get('domain') ?? '',
      ).toLowerCase();
      if (!domainId) {
        if (action === 'get') throw new HttpsError('failed-precondition', 'No domain has been added yet.');
        return { ok: true, domains: [] };
      }
      const binding = await emailDomainBindingRef(db, domainId).get();
      if (!platformEmailDomainBindingMatches(binding.data(), domainId, storedName)) {
        throw new HttpsError('failed-precondition', 'The platform sending domain is not assigned.');
      }
      const domain =
        platformDomainEmulatorFixture(config, domainId, storedName) ??
        (await getDomain(apiKey, domainId));
      if (domain.id !== domainId || domain.name.toLowerCase() !== storedName) {
        throw new HttpsError('failed-precondition', 'The stored sending domain no longer matches Resend.');
      }
      return action === 'get' ? { ok: true, domain } : { ok: true, domains: [domain] };
    }

    if (action === 'add') {
      const name = cleanDomain(String(data.domain ?? ''));
      if (!name) throw new HttpsError('invalid-argument', 'That is not a domain name.');
      const mutationId = await acquirePlatformEmailMutation(identity, 'domain-add');
      try {
        const apiKey = await readResendKey();
        const existing = (await listDomains(apiKey)).find((candidate) => candidate.name.toLowerCase() === name);
        const domain = existing ?? (await addDomain(apiKey, name));
        if (!domain.id || domain.name.toLowerCase() !== name) {
          throw new HttpsError('unavailable', 'Resend returned an incomplete domain record.');
        }
        await requireCurrentPlatformAdmin(identity.uid, identity.email);
        await db.runTransaction(async (tx) => {
          const memberRef = db.doc(`platformMembers/${identity.uid}`);
          const config = await tx.get(configRef);
          const activeDomainId = String(config.get('domainId') ?? '');
          const activeDomain = String(config.get('domain') ?? '').toLowerCase();
          const oldStagedDomainId = String(config.get('stagedDomainId') ?? '');
          const oldStagedDomain = String(config.get('stagedDomain') ?? '').toLowerCase();
          if (domain.id === activeDomainId && domain.name.toLowerCase() === activeDomain) {
            throw new HttpsError('failed-precondition', 'That platform sending domain is already active.');
          }
          const refs = [
            memberRef,
            emailDomainBindingRef(db, domain.id),
            ...(oldStagedDomainId &&
            oldStagedDomainId !== domain.id &&
            oldStagedDomainId !== activeDomainId
              ? [emailDomainBindingRef(db, oldStagedDomainId)]
              : []),
          ];
          const [member, binding, oldStagedBinding] = await tx.getAll(
            ...refs,
          ) as DocumentSnapshot[];
          if (
            config.get('domainMutationId') !== mutationId ||
            String(member.get('email') ?? '').trim().toLowerCase() !== identity.email.toLowerCase() ||
            (member.get('role') !== 'owner' && member.get('role') !== 'admin')
          ) {
            throw new HttpsError('aborted', 'The platform email change expired. Try again.');
          }
          const ours = platformEmailDomainBindingMatches(binding.data(), domain.id, domain.name);
          const legacyReferences = await legacyEmailDomainReferences(tx, '__platform__', domain);
          if (
            (binding.exists && !ours) ||
            (existing && !ours && legacyReferences.count > 0)
          ) {
            throw new HttpsError(
              'failed-precondition',
              'This Resend domain is already assigned and cannot become the platform default.',
              { reason: 'email_domain_unavailable' },
            );
          }
          if (!binding.exists) {
            tx.create(emailDomainBindingRef(db, domain.id), {
              scope: 'platform',
              domainId: domain.id,
              domain: domain.name.toLowerCase(),
              assignedBy: identity.uid,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          if (
            oldStagedBinding &&
            platformEmailDomainBindingMatches(
              oldStagedBinding.data(),
              oldStagedDomainId,
              oldStagedDomain,
            )
          ) {
            tx.delete(oldStagedBinding.ref);
          }
          tx.set(
            configRef,
            {
              stagedDomainId: domain.id,
              stagedDomain: domain.name.toLowerCase(),
              domainMutationId: FieldValue.delete(),
              domainMutationKind: FieldValue.delete(),
              domainMutationBy: FieldValue.delete(),
              domainMutationExpiresAt: FieldValue.delete(),
            },
            { merge: true },
          );
        });
        return { ok: true, domain: existing ? await getDomain(apiKey, domain.id) : domain };
      } catch (error) {
        await releasePlatformEmailMutation(mutationId);
        throw error;
      }
    }

    if (action === 'verify') {
      const mutationId = await acquirePlatformEmailMutation(identity, 'domain-verify');
      try {
        const [apiKey, config] = await Promise.all([readResendKey(), configRef.get()]);
        const domainId = String(config.get('stagedDomainId') ?? config.get('domainId') ?? '');
        const storedName = String(
          config.get('stagedDomain') ?? config.get('domain') ?? '',
        ).toLowerCase();
        if (!domainId) throw new HttpsError('failed-precondition', 'No domain has been added yet.');
        const binding = await emailDomainBindingRef(db, domainId).get();
        if (!platformEmailDomainBindingMatches(binding.data(), domainId, storedName)) {
          throw new HttpsError('failed-precondition', 'The platform sending domain is not assigned.');
        }
        const emulatorDomain = platformDomainEmulatorFixture(config, domainId, storedName);
        const current = emulatorDomain ?? (await getDomain(apiKey, domainId));
        if (current.id !== domainId || current.name.toLowerCase() !== storedName) {
          throw new HttpsError('failed-precondition', 'The stored sending domain no longer matches Resend.');
        }
        const domain = emulatorDomain ?? (await verifyDomain(apiKey, domainId));
        await requireCurrentPlatformAdmin(identity.uid, identity.email);
        await db.runTransaction(async (tx) => {
          const [member, latest, exactBinding] = await tx.getAll(
            db.doc(`platformMembers/${identity.uid}`),
            configRef,
            emailDomainBindingRef(db, domainId),
          );
          if (
            latest.get('domainMutationId') !== mutationId ||
            String(latest.get('stagedDomainId') ?? latest.get('domainId') ?? '') !== domainId ||
            String(latest.get('stagedDomain') ?? latest.get('domain') ?? '').toLowerCase() !==
              storedName ||
            String(member.get('email') ?? '').trim().toLowerCase() !== identity.email.toLowerCase() ||
            (member.get('role') !== 'owner' && member.get('role') !== 'admin') ||
            !platformEmailDomainBindingMatches(exactBinding.data(), domainId, storedName)
          ) {
            throw new HttpsError('aborted', 'The platform sending domain changed. Try again.');
          }
          tx.set(
            configRef,
            {
              domainMutationId: FieldValue.delete(),
              domainMutationKind: FieldValue.delete(),
              domainMutationBy: FieldValue.delete(),
              domainMutationExpiresAt: FieldValue.delete(),
            },
            { merge: true },
          );
        });
        return { ok: true, domain };
      } catch (error) {
        await releasePlatformEmailMutation(mutationId);
        throw error;
      }
    }

    if (action === 'activate') {
      const mutationId = await acquirePlatformEmailMutation(identity, 'domain-activate');
      try {
        const [apiKey, config] = await Promise.all([readResendKey(), configRef.get()]);
        const stagedDomainId = String(config.get('stagedDomainId') ?? '');
        const stagedDomain = String(config.get('stagedDomain') ?? '').toLowerCase();
        if (!stagedDomainId || !stagedDomain) {
          throw new HttpsError(
            'failed-precondition',
            'Add and verify a replacement platform sending domain first.',
          );
        }
        const stagedBinding = await emailDomainBindingRef(db, stagedDomainId).get();
        if (
          !platformEmailDomainBindingMatches(
            stagedBinding.data(),
            stagedDomainId,
            stagedDomain,
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'The staged platform sending domain is not assigned.',
          );
        }
        const domain =
          platformDomainEmulatorFixture(config, stagedDomainId, stagedDomain) ??
          (await getDomain(apiKey, stagedDomainId));
        if (
          domain.id !== stagedDomainId ||
          domain.name.toLowerCase() !== stagedDomain ||
          domain.status !== 'verified'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Verify the staged platform sending domain before activating it.',
          );
        }

        await requireCurrentPlatformAdmin(identity.uid, identity.email);
        await db.runTransaction(async (tx) => {
          const memberRef = db.doc(`platformMembers/${identity.uid}`);
          const oldDomainId = String(config.get('domainId') ?? '');
          const reviewedOldDomain = String(config.get('domain') ?? '').toLowerCase();
          const refs = [
            memberRef,
            configRef,
            emailDomainBindingRef(db, stagedDomainId),
            ...(oldDomainId && oldDomainId !== stagedDomainId
              ? [emailDomainBindingRef(db, oldDomainId)]
              : []),
          ];
          const [member, latest, exactStagedBinding, oldBinding] = await tx.getAll(
            ...refs,
          ) as DocumentSnapshot[];
          const latestOldDomainId = String(latest.get('domainId') ?? '');
          const latestOldDomain = String(latest.get('domain') ?? '').toLowerCase();
          if (
            latest.get('domainMutationId') !== mutationId ||
            String(latest.get('stagedDomainId') ?? '') !== stagedDomainId ||
            String(latest.get('stagedDomain') ?? '').toLowerCase() !== stagedDomain ||
            latestOldDomainId !== oldDomainId ||
            latestOldDomain !== reviewedOldDomain ||
            String(member.get('email') ?? '').trim().toLowerCase() !== identity.email.toLowerCase() ||
            (member.get('role') !== 'owner' && member.get('role') !== 'admin') ||
            !platformEmailDomainBindingMatches(
              exactStagedBinding.data(),
              stagedDomainId,
              stagedDomain,
            )
          ) {
            throw new HttpsError('aborted', 'The platform sending domain changed. Try again.');
          }
          const retainedFrom = boundEmailSender(latest.get('from'), stagedDomain);
          tx.set(
            configRef,
            {
              domainId: stagedDomainId,
              domain: stagedDomain,
              from: retainedFrom || FieldValue.delete(),
              stagedDomainId: FieldValue.delete(),
              stagedDomain: FieldValue.delete(),
              emulatorStagedDomainStatus: FieldValue.delete(),
              domainMutationId: FieldValue.delete(),
              domainMutationKind: FieldValue.delete(),
              domainMutationBy: FieldValue.delete(),
              domainMutationExpiresAt: FieldValue.delete(),
            },
            { merge: true },
          );
          if (
            oldBinding &&
            oldDomainId !== stagedDomainId &&
            platformEmailDomainBindingMatches(
              oldBinding.data(),
              oldDomainId,
              latestOldDomain,
            )
          ) {
            tx.delete(oldBinding.ref);
          }
        });
        logger.info('platform email domain activated', {
          byUid: identity.uid,
          domainId: stagedDomainId,
        });
        return { ok: true, activated: true, domain };
      } catch (error) {
        await releasePlatformEmailMutation(mutationId);
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw asResendError(error);
  }
  throw new HttpsError('invalid-argument', `Unknown action "${action}".`);
});

function cfpIdFromEmailConfig(snapshot: QueryDocumentSnapshot): string | null {
  const parts = snapshot.ref.path.split('/');
  return parts.length === 4 && parts[0] === 'cfps' && parts[2] === 'config' && parts[3] === 'email'
    ? parts[1]
    : null;
}

async function legacyEmailDomainReferences(
  tx: FirebaseFirestore.Transaction,
  cfpId: string,
  domain: { id: string; name: string },
): Promise<{ count: number; exactOwner: boolean }> {
  const snapshots = await tx.get(
    db.collectionGroup('config').where('domainId', '==', domain.id),
  );
  const emailConfigs = snapshots.docs
    .map((snapshot) => ({ snapshot, cfpId: cfpIdFromEmailConfig(snapshot) }))
    .filter((entry): entry is { snapshot: QueryDocumentSnapshot; cfpId: string } =>
      Boolean(entry.cfpId),
    );
  const references = emailConfigs.map((entry) => ({
    cfpId: entry.cfpId,
    domain: String(entry.snapshot.get('domain') ?? ''),
  }));
  return {
    count: emailConfigs.length,
    exactOwner: legacyEmailDomainOwnerIsExact(cfpId, domain.name, references),
  };
}

async function migrateLegacyEmailDomainBinding(
  cfpId: string,
  domain: { id: string; name: string },
): Promise<void> {
  const config = await db.doc(`cfps/${cfpId}/config/email`).get();
  if (
    config.get('domainId') === domain.id &&
    String(config.get('domain') ?? '').toLowerCase() === domain.name.toLowerCase() &&
    (await ensureLegacyEmailDomainBinding(db, cfpId, config.data() ?? {}))
  ) {
    return;
  }
  throw new HttpsError(
    'failed-precondition',
    'This existing Resend domain cannot be assigned automatically. Ask a platform administrator to resolve it.',
    { reason: 'email_domain_unavailable' },
  );
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

  const configRef = db.doc(`cfps/${cfpId}/config/email`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${byUid}`);

  try {
    if (action === 'list' || action === 'get') {
      const apiKey = await readResendKey();
      const config = await configRef.get();
      const domainId = String(config.get('stagedDomainId') ?? config.get('domainId') ?? '');
      const storedName = String(config.get('stagedDomain') ?? config.get('domain') ?? '').toLowerCase();
      if (!domainId) {
        if (action === 'get') {
          throw new HttpsError('failed-precondition', 'No domain has been added yet.');
        }
        return { ok: true, domains: [] };
      }
      const domain = await getDomain(apiKey, domainId);
      if (!storedName || domain.id !== domainId || domain.name.toLowerCase() !== storedName) {
        throw new HttpsError(
          'failed-precondition',
          'The stored sending domain no longer matches Resend.',
          { reason: 'email_domain_mismatch' },
        );
      }
      const binding = await emailDomainBindingRef(db, domainId).get();
      if (!emailDomainBindingMatches(binding.data(), cfpId, domainId, storedName)) {
        const isActiveLegacy =
          config.get('domainId') === domainId &&
          String(config.get('domain') ?? '').toLowerCase() === storedName;
        if (!isActiveLegacy) {
          throw new HttpsError('failed-precondition', 'This sending domain is not assigned to this event.');
        }
        await migrateLegacyEmailDomainBinding(cfpId, domain);
      }
      return action === 'get'
        ? { ok: true, domain }
        : { ok: true, domains: [domain] };
    }

    if (action === 'add') {
      const name = cleanDomain(String(data.domain ?? ''));
      if (!name) throw new HttpsError('invalid-argument', 'That is not a domain name.');
      const leaseId = await acquireCfpMutation(cfpId, 'email-domain-add', async (tx) => {
        assertMutationActor(await tx.get(memberRef), 'admin');
      });
      try {
        const apiKey = await readResendKey();
        const existing = (await listDomains(apiKey)).find(
          (candidate) => candidate.name.toLowerCase() === name,
        );
        const domain = existing ?? (await addDomain(apiKey, name));
        if (!domain.id || domain.name.toLowerCase() !== name) {
          throw new HttpsError('unavailable', 'Resend returned an incomplete domain record.');
        }
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          const currentConfig = await tx.get(configRef);
          const currentData = currentConfig.data() ?? {};
          const currentStagedDomainId = String(currentConfig.get('stagedDomainId') ?? '');
          const supersededDomainId = supersededStagedEmailDomainId(
            currentStagedDomainId,
            String(currentConfig.get('domainId') ?? ''),
            domain.id,
          );
          const bindingRef = emailDomainBindingRef(db, domain.id);
          const oldBindingRef = supersededDomainId
            ? emailDomainBindingRef(db, supersededDomainId)
            : null;
          const refs = [memberRef, bindingRef, ...(oldBindingRef ? [oldBindingRef] : [])];
          const [member, binding, oldBinding] = await tx.getAll(...refs) as DocumentSnapshot[];
          assertMutationActor(member, 'admin');

          const legacyReferences = await legacyEmailDomainReferences(tx, cfpId, domain);
          const exactLegacyOwner = legacyReferences.exactOwner;
          const bindingIsOurs = emailDomainBindingMatches(
            binding.data(),
            cfpId,
            domain.id,
            domain.name,
          );
          if (
            (binding.exists && !bindingIsOurs) ||
            (existing && !bindingIsOurs && !exactLegacyOwner) ||
            (!existing && binding.exists) ||
            (!existing && legacyReferences.count > 0)
          ) {
            throw new HttpsError(
              'failed-precondition',
              'This existing Resend domain cannot be assigned automatically. Ask a platform administrator to resolve it.',
              { reason: 'email_domain_unavailable' },
            );
          }

          if (!binding.exists) {
            tx.create(bindingRef, {
              scope: 'event',
              cfpId,
              domainId: domain.id,
              domain: domain.name.toLowerCase(),
              assignedBy: byUid,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          tx.set(
            configRef,
            {
              senderMode: inferredEventEmailMode(currentData),
              stagedDomainId: domain.id,
              stagedDomain: domain.name.toLowerCase(),
            },
            { merge: true },
          );
          if (
            oldBindingRef &&
            oldBinding &&
            emailDomainBindingMatches(
              oldBinding.data(),
              cfpId,
              currentStagedDomainId,
              String(currentConfig.get('stagedDomain') ?? ''),
            )
          ) {
            tx.delete(oldBindingRef);
          }
        });
        return { ok: true, domain: existing ? await getDomain(apiKey, domain.id) : domain };
      } catch (error) {
        await releaseCfpMutationQuietly(cfpId, leaseId);
        throw error;
      }
    }

    if (action === 'verify') {
      const leaseId = await acquireCfpMutation(cfpId, 'email-domain-verify', async (tx) => {
        assertMutationActor(await tx.get(memberRef), 'admin');
      });
      try {
        const apiKey = await readResendKey();
        const config = await configRef.get();
        const currentDomainId = String(config.get('stagedDomainId') ?? config.get('domainId') ?? '');
        const storedName = String(config.get('stagedDomain') ?? config.get('domain') ?? '').toLowerCase();
        if (!currentDomainId) {
          throw new HttpsError('failed-precondition', 'No domain has been added yet.');
        }
        const current = await getDomain(apiKey, currentDomainId);
        if (
          !storedName ||
          current.id !== currentDomainId ||
          current.name.toLowerCase() !== storedName
        ) {
          throw new HttpsError(
            'failed-precondition',
            'The stored sending domain no longer matches Resend.',
            { reason: 'email_domain_mismatch' },
          );
        }
        const currentBinding = await emailDomainBindingRef(db, currentDomainId).get();
        if (!emailDomainBindingMatches(currentBinding.data(), cfpId, currentDomainId, storedName)) {
          const isActiveLegacy =
            config.get('domainId') === currentDomainId &&
            String(config.get('domain') ?? '').toLowerCase() === storedName;
          if (!isActiveLegacy) {
            throw new HttpsError('failed-precondition', 'This sending domain is not assigned to this event.');
          }
          await migrateLegacyEmailDomainBinding(cfpId, current);
        }
        const domain = await verifyDomain(apiKey, currentDomainId);
        if (domain.id !== currentDomainId || domain.name.toLowerCase() !== storedName) {
          throw new HttpsError('unavailable', 'Resend returned an incomplete domain record.');
        }
        await finishCfpMutation(cfpId, leaseId, async (tx) => {
          const [member, latestConfig, binding] = await tx.getAll(
            memberRef,
            configRef,
            emailDomainBindingRef(db, currentDomainId),
          );
          assertMutationActor(member, 'admin');
          if (
            String(latestConfig.get('stagedDomainId') ?? latestConfig.get('domainId') ?? '') !== currentDomainId ||
            !emailDomainBindingMatches(
              binding.data(),
              cfpId,
              currentDomainId,
              String(latestConfig.get('stagedDomain') ?? latestConfig.get('domain') ?? ''),
            )
          ) {
            throw new HttpsError('aborted', 'The sending domain changed. Try again.');
          }
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
const scheduleSpeakerPhotoAssetRef = (cfpId: string, assetRef: string) =>
  db.doc(`cfps/${cfpId}/scheduleSpeakerPhotoAssets/${assetRef}`);
const scheduleReleaseSourceRef = (cfpId: string, releaseId: string) =>
  db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}/internal/source`);
const publicSchedulePhotoCachePath = (
  cfpId: string,
  releaseId: string,
  photoRef: string,
) => `cfps/${cfpId}/publicSchedulePhotos/${releaseId}/${photoRef}.webp`;

/** Admin-owned original; a release later substitutes a different opaque public ref. */
export const uploadCustomScheduleSpeakerPhoto = onCall(
  EXTERNAL_MUTATION_CALLABLE,
  async (request) => {
    const cfpId = requireCfpId(request.data);
    const byUid = await requireScheduleAdmin(request, cfpId, 'upload a programme speaker photo');
    const data = (request.data ?? {}) as { contentType?: unknown; base64?: unknown };
    const upload = await decodeSpeakerProfilePhotoUpload(data.contentType, data.base64);
    const assetRef = randomBytes(32).toString('base64url');
    const assetDoc = scheduleSpeakerPhotoAssetRef(cfpId, assetRef);
    const path = customScheduleSpeakerPhotoPath(cfpId, assetRef);
    const file = getStorage().bucket().file(path);
    let leaseId = '';
    let asset: CustomScheduleSpeakerPhotoAsset | null = null;

    try {
      leaseId = await acquireCfpMutation(cfpId, 'schedule-speaker-photo-upload', async (tx) => {
        const [member, config] = await tx.getAll(
          db.doc(`cfps/${cfpId}/members/${byUid}`),
          scheduleConfigRef(cfpId),
        );
        assertMutationActor(member, 'admin');
        if (!config.exists) {
          throw new HttpsError('failed-precondition', 'Configure the schedule first.');
        }
      });
      await file.save(upload.bytes, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
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
      asset = {
        cfpId,
        assetRef,
        path,
        generation,
        contentType: upload.contentType,
        size: upload.bytes.length,
      };
      await finishCfpMutation(cfpId, leaseId, async (tx) => {
        const [member, config, existing] = await tx.getAll(
          db.doc(`cfps/${cfpId}/members/${byUid}`),
          scheduleConfigRef(cfpId),
          assetDoc,
        );
        assertMutationActor(member, 'admin');
        if (!config.exists) {
          throw new HttpsError('failed-precondition', 'Configure the schedule first.');
        }
        if (existing.exists) throw new HttpsError('already-exists', 'That photo already exists.');
        tx.create(assetDoc, {
          ...asset!,
          createdBy: byUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      if (asset) {
        try {
          const settled = await assetDoc.get();
          const storedAsset = customScheduleSpeakerPhotoAssetFrom(
            settled.data(),
            cfpId,
            assetRef,
          );
          if (storedAsset) return { ok: true, assetRef };
        } catch (verificationError) {
          logger.error('programme speaker photo could not be verified', {
            cfpId,
            assetRef,
            error: String(verificationError),
          });
        }
      }
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (cleanupError) {
        logger.warn('failed programme speaker photo cleanup failed', {
          cfpId,
          assetRef,
          error: String(cleanupError),
        });
      }
      if (leaseId) await releaseCfpMutationQuietly(cfpId, leaseId);
      if (error instanceof HttpsError) throw error;
      logger.error('programme speaker photo upload failed', {
        cfpId,
        assetRef,
        error: String(error),
      });
      throw new HttpsError('unavailable', 'The speaker photo could not be uploaded. Try again.');
    }

    logger.info('programme speaker photo uploaded', { cfpId, assetRef, byUid });
    return { ok: true, assetRef };
  },
);

/** Admin preview of one exact working asset; never exposes its bucket coordinates. */
export const customScheduleSpeakerPhotoImage = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  await requireScheduleAdmin(request, cfpId, 'view a programme speaker photo');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const assetRef = data.assetRef;
  if (!validCustomScheduleSpeakerPhotoRef(assetRef)) {
    throw new HttpsError('invalid-argument', 'A valid programme speaker photo is required.');
  }
  const assetSnap = await scheduleSpeakerPhotoAssetRef(cfpId, assetRef).get();
  const asset = customScheduleSpeakerPhotoAssetFrom(assetSnap.data(), cfpId, assetRef);
  if (!asset) throw new HttpsError('not-found', 'That speaker photo is unavailable.');
  const stored = await readStoredHeadshot(getStorage().bucket(), asset.path, asset.generation);
  if (!stored) throw new HttpsError('not-found', 'That speaker photo is unavailable.');
  const preview = await publicSpeakerPhotoDerivative(stored.bytes);
  return {
    ok: true,
    contentType: preview.contentType,
    base64: preview.bytes.toString('base64'),
  };
});

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

function scheduleSpeakersFrom(value: unknown): CustomScheduleSpeaker[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [null as unknown as CustomScheduleSpeaker];
  return value.slice(0, SCHEDULE_LIMITS.customSpeakers + 1).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item as CustomScheduleSpeaker;
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
    const photoAssetRef = data.photoAssetRef;
    return {
      name: name as string,
      ...(bio !== undefined ? { bio: bio as string } : {}),
      ...(company !== undefined ? { company: company as string } : {}),
      ...(jobTitle !== undefined ? { jobTitle: jobTitle as string } : {}),
      ...(photoAssetRef !== undefined
        ? { photoAssetRef: photoAssetRef as string }
        : {}),
    };
  });
}

function customSchedulePhotoAssetRefs(entries: readonly ScheduleEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.kind === 'custom'
          ? (entry.speakers ?? []).flatMap((speaker) =>
              validCustomScheduleSpeakerPhotoRef(speaker.photoAssetRef)
                ? [speaker.photoAssetRef]
                : [],
            )
          : [],
      ),
    ),
  ];
}

function customSchedulePhotoCount(entries: readonly ScheduleEntry[]): number {
  return entries.reduce(
    (count, entry) =>
      count +
      (entry.kind === 'custom'
        ? (entry.speakers ?? []).filter((speaker) => speaker.photoAssetRef !== undefined).length
        : 0),
    0,
  );
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
    if (customSchedulePhotoCount(entries) > SCHEDULE_LIMITS.speakerPhotos) {
      throw new HttpsError(
        'resource-exhausted',
        `A schedule release can contain at most ${SCHEDULE_LIMITS.speakerPhotos} speaker photos.`,
      );
    }
    const customPhotoAssetRefs = customSchedulePhotoAssetRefs(entries);
    const customPhotoAssets = customPhotoAssetRefs.length
      ? await tx.getAll(
          ...customPhotoAssetRefs.map((assetRef) =>
            scheduleSpeakerPhotoAssetRef(cfpId, assetRef),
          ),
        )
      : [];
    for (const [index, assetRef] of customPhotoAssetRefs.entries()) {
      if (!customScheduleSpeakerPhotoAssetFrom(customPhotoAssets[index]?.data(), cfpId, assetRef)) {
        throw new HttpsError('failed-precondition', 'One programme speaker photo is unavailable.');
      }
    }
    const proposalIds = entries
      .filter((item): item is Extract<ScheduleEntry, { kind: 'proposal' }> => item.kind === 'proposal')
      .map((item) => item.proposalId);
    const proposalSnaps = proposalIds.length
      ? await tx.getAll(...proposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`)))
      : [];
    const proposals = new Map(proposalSnaps.map((snap) => [snap.id, snap.data()]));
    if (entry.kind === 'proposal') {
      const proposal = proposals.get(entry.proposalId);
      if (!proposal || !scheduleProposalEligible(proposal.status)) {
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
  const entriesWithoutPhotoRefs = entries.map((entry) =>
    entry.kind === 'custom'
      ? {
          ...entry,
          ...(entry.speakers
            ? {
                speakers: entry.speakers.map(({ photoRef: _photoRef, ...speaker }) => speaker),
              }
            : {}),
        }
      : {
          ...entry,
          session: {
            ...entry.session,
            speakers: entry.session.speakers.map(({ photoRef: _photoRef, ...speaker }) => speaker),
          },
        },
  );
  const source = stableScheduleValue({
    timeZone: config.timeZone,
    days: config.days,
    rooms: config.rooms,
    entries: entriesWithoutPhotoRefs.sort((left, right) => left.id.localeCompare(right.id)),
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

interface ProposalScheduleReleaseSpeakerPhoto {
  /** Absent on releases created before source records were discriminated. */
  kind?: 'proposal';
  entryId: string;
  speakerIndex: number;
  proposalId: string;
  uid: string;
  path: string;
  sourceGeneration: string;
}

interface CustomScheduleReleaseSpeakerPhoto {
  kind: 'custom';
  entryId: string;
  speakerIndex: number;
  assetRef: string;
  path: string;
  sourceGeneration: string;
}

type ScheduleReleaseSpeakerPhoto =
  | ProposalScheduleReleaseSpeakerPhoto
  | CustomScheduleReleaseSpeakerPhoto;

interface SchedulePhotoProjectionInput {
  cfpId: string;
  releaseId: string;
  form: ConfirmForm;
  confirmations: ReadonlyMap<string, DocumentSnapshot>;
  customAssets: ReadonlyMap<string, DocumentSnapshot>;
}

function scheduleConfirmationKey(proposalId: string, uid: string): string {
  return `${proposalId}\u0000${uid}`;
}

function scheduleConfirmationRefs(
  cfpId: string,
  proposals: readonly DocumentSnapshot[],
): Array<{ key: string; ref: FirebaseFirestore.DocumentReference }> {
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const proposal of proposals) {
    if (!proposal.exists) continue;
    for (const uid of proposalSpeakerIds(proposal.data() ?? {})) {
      const key = scheduleConfirmationKey(proposal.id, uid);
      refs.set(key, speakerConfirmationRef(db, cfpId, proposal.id, uid));
    }
  }
  return [...refs].map(([key, ref]) => ({ key, ref }));
}

function confirmedScheduleSpeakerPhoto(
  value: unknown,
  cfpId: string,
  proposalId: string,
  uid: string,
): ConfirmedSpeakerPhoto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const photo = value as Partial<ConfirmedSpeakerPhoto>;
  if (
    typeof photo.path !== 'string' ||
    typeof photo.sourceGeneration !== 'string' ||
    !photo.sourceGeneration ||
    photo.path !==
      speakerConfirmedHeadshotPath(
        cfpId,
        proposalId,
        uid,
        SPEAKER_PHOTO_KEY,
        photo.sourceGeneration,
      ) ||
    !(IMAGE_TYPES as readonly unknown[]).includes(photo.contentType) ||
    typeof photo.size !== 'number' ||
    !Number.isFinite(photo.size) ||
    photo.size <= 0 ||
    photo.size > FORM_LIMITS.image
  ) {
    return null;
  }
  return photo as ConfirmedSpeakerPhoto;
}

function schedulePhotoRef(
  releaseId: string,
  entryId: string,
  speakerIndex: number,
  sourceGeneration: string,
): string {
  return createHash('sha256')
    .update(`${releaseId}\u0000${entryId}\u0000${speakerIndex}\u0000${sourceGeneration}`)
    .digest('base64url');
}

function scheduleSpeakerPhotoFingerprint(
  photos: Readonly<Record<string, ScheduleReleaseSpeakerPhoto>>,
): string {
  const sources = Object.values(photos).sort((left, right) =>
    `${left.entryId}\u0000${left.speakerIndex}`.localeCompare(
      `${right.entryId}\u0000${right.speakerIndex}`,
    ),
  );
  return createHash('sha256')
    .update(JSON.stringify(stableScheduleValue(sources)))
    .digest('hex');
}

function sharedProjection(
  config: ScheduleConfig,
  entries: readonly ScheduleEntry[],
  proposals: ReadonlyMap<string, DocumentSnapshot>,
  form: SubmissionForm,
  photoInput?: SchedulePhotoProjectionInput,
): {
  entries: PublishedScheduleEntry[];
  omittedCount: number;
  fingerprint: string;
  speakerPhotos: Record<string, ScheduleReleaseSpeakerPhoto>;
  speakerPhotoFingerprint: string;
} {
  const projected: PublishedScheduleEntry[] = [];
  const eligibleDraft: ScheduleEntry[] = [];
  const speakerPhotos: Record<string, ScheduleReleaseSpeakerPhoto> = {};
  const missingRequiredPhotos: string[] = [];
  let omittedCount = 0;

  for (const entry of entries) {
    const problem = validateScheduleEntry(entry, config);
    if (problem) throw new HttpsError('invalid-argument', problem);
    if (entry.kind === 'custom') {
      eligibleDraft.push(entry);
      const { speakers, ...publishedEntry } = entry;
      const publicSpeakers = speakers?.map((speaker, speakerIndex) => {
        const { photoAssetRef, ...publicSpeaker } = speaker;
        if (!photoAssetRef || !photoInput) return publicSpeaker;
        const asset = customScheduleSpeakerPhotoAssetFrom(
          photoInput.customAssets.get(photoAssetRef)?.data(),
          photoInput.cfpId,
          photoAssetRef,
        );
        if (!asset) {
          throw new HttpsError(
            'failed-precondition',
            `The photo for ${speaker.name || `speaker ${speakerIndex + 1}`} is unavailable.`,
          );
        }
        const photoRef = schedulePhotoRef(
          photoInput.releaseId,
          entry.id,
          speakerIndex,
          asset.generation,
        );
        speakerPhotos[photoRef] = {
          kind: 'custom',
          entryId: entry.id,
          speakerIndex,
          assetRef: photoAssetRef,
          path: asset.path,
          sourceGeneration: asset.generation,
        };
        return { ...publicSpeaker, photoRef };
      });
      projected.push({
        ...publishedEntry,
        ...(publicSpeakers ? { speakers: publicSpeakers } : {}),
      });
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
    const snapshots = (data.speakerSnapshot ?? []) as SpeakerSnapshot[];
    const photoRefs = new Map<string, string>();
    if (photoInput?.form.speakerPhoto) {
      const primaryUid = primarySpeakerId(data);
      snapshots.forEach((speaker, speakerIndex) => {
        const confirmation = photoInput.confirmations.get(
          scheduleConfirmationKey(entry.proposalId, speaker.uid),
        );
        const photo =
          confirmedScheduleSpeakerPhoto(
            confirmation?.get('speakerPhoto'),
            photoInput.cfpId,
            entry.proposalId,
            speaker.uid,
          ) ??
          (speaker.uid === primaryUid &&
          (!usesPerSpeakerLifecycle(data) || confirmation?.get('migratedFromLegacy') === true)
            ? confirmedScheduleSpeakerPhoto(
                proposal.get('speakerPhoto'),
                photoInput.cfpId,
                entry.proposalId,
                speaker.uid,
              )
            : null);
        if (!photo) {
          if (photoInput.form.speakerPhoto?.required) {
            missingRequiredPhotos.push(speaker.name || `speaker ${speakerIndex + 1}`);
          }
          return;
        }
        const photoRef = schedulePhotoRef(
          photoInput.releaseId,
          entry.id,
          speakerIndex,
          photo.sourceGeneration,
        );
        photoRefs.set(speaker.uid, photoRef);
        speakerPhotos[photoRef] = {
          kind: 'proposal',
          entryId: entry.id,
          speakerIndex,
          proposalId: entry.proposalId,
          uid: speaker.uid,
          path: photo.path,
          sourceGeneration: photo.sourceGeneration,
        };
      });
    }
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
        speakers: publicScheduleSpeakers(snapshots, photoRefs),
      },
    });
  }

  if (missingRequiredPhotos.length) {
    throw new HttpsError(
      'failed-precondition',
      `Add confirmed speaker photos for: ${[...new Set(missingRequiredPhotos)].join(', ')}.`,
      { speakerPhoto: 'required', speakers: [...new Set(missingRequiredPhotos)] },
    );
  }
  if (Object.keys(speakerPhotos).length > SCHEDULE_LIMITS.speakerPhotos) {
    throw new HttpsError(
      'resource-exhausted',
      `A schedule release can contain at most ${SCHEDULE_LIMITS.speakerPhotos} speaker photos.`,
    );
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
    speakerPhotos,
    speakerPhotoFingerprint: scheduleSpeakerPhotoFingerprint(speakerPhotos),
  };
}

export const shareSchedulePreview = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const byUid = await requireScheduleAdmin(request, cfpId, 'share the schedule preview');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const [configSnap, entriesSnap, cfpBefore, formSnap, confirmFormSnap] = await Promise.all([
    scheduleConfigRef(cfpId).get(),
    scheduleDraft(cfpId).get(),
    db.doc(`cfps/${cfpId}`).get(),
    scheduleSubmissionFormRef(cfpId).get(),
    db.doc(`cfps/${cfpId}/config/confirmForm`).get(),
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
  const releaseRef = db.collection(`cfps/${cfpId}/scheduleReleases`).doc();
  const photoConfirmationRefs = scheduleConfirmationRefs(cfpId, proposalSnaps);
  const customPhotoRefs = customSchedulePhotoAssetRefs(entries);
  const customPhotoDocRefs = customPhotoRefs.map((assetRef) =>
    scheduleSpeakerPhotoAssetRef(cfpId, assetRef),
  );
  const [photoConfirmationSnaps, customPhotoSnaps] = await Promise.all([
    photoConfirmationRefs.length
      ? db.getAll(...photoConfirmationRefs.map(({ ref }) => ref))
      : Promise.resolve([]),
    customPhotoDocRefs.length ? db.getAll(...customPhotoDocRefs) : Promise.resolve([]),
  ]);
  const projection = sharedProjection(config, entries, proposals, form, {
    cfpId,
    releaseId: releaseRef.id,
    form: confirmFormFrom(confirmFormSnap),
    confirmations: new Map(
      photoConfirmationSnaps.map((snap, index) => [photoConfirmationRefs[index].key, snap]),
    ),
    customAssets: new Map(
      customPhotoSnaps.map((snap, index) => [customPhotoRefs[index], snap]),
    ),
  });
  const sharedEntries = projection.entries;
  if (!sharedEntries.length) {
    throw new HttpsError(
      'failed-precondition',
      'Add at least one confirmed session or custom schedule item first.',
    );
  }
  const profileUpdateHandlingKeys = [
    ...new Map(
      sharedEntries.flatMap((entry) => {
        if (entry.kind !== 'proposal') return [];
        const proposal = proposals.get(entry.proposalId);
        return proposalSpeakerIds(proposal?.data() ?? {}).map((speakerUid) => [
          `${entry.proposalId}\u0000${speakerUid}`,
          { proposalId: entry.proposalId, speakerUid },
        ] as const);
      }),
    ).values(),
  ];
  const profileUpdateHandlingRefs = profileUpdateHandlingKeys.map(
    ({ proposalId, speakerUid }) =>
      profileUpdateRequestRef(db, cfpId, proposalId, speakerUid),
  );

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
  const previousSpeakerPhotoFingerprint = String(
    previousSource?.get('speakerPhotoFingerprint') ?? '',
  );
  const previousTaxonomyFingerprint = String(
    previousSource?.get('taxonomyFingerprint') ?? '',
  );
  let previousReleaseFingerprint = '';
  if (previousRelease?.exists && previousEntriesSnap) {
    try {
      previousReleaseFingerprint = scheduleProjectionFingerprint(
        scheduleConfigFrom(previousRelease.data()),
        previousEntriesSnap.docs.map(
          (entry) => ({ id: entry.id, ...entry.data() }) as PublishedScheduleEntry,
        ),
      );
    } catch {
      // An unreadable legacy snapshot is exactly what the next share replaces.
    }
  }
  const projectionChanged =
    previousRelease?.exists !== true ||
    scheduleReleaseNeedsReshare({
      revision: current,
      sourceRevision: Number(
        previousSource?.get('sourceRevision') ?? previousRelease?.get('sourceRevision') ?? -1,
      ),
      sharedRevision: Number(configSnap.get('sharedRevision') ?? -1),
      sourceFingerprint: previousFingerprint,
      sharedFingerprint: String(configSnap.get('sharedFingerprint') ?? ''),
      projectionFingerprint: projection.fingerprint,
      releaseFingerprint: previousReleaseFingerprint,
      sourceTaxonomyFingerprint: previousTaxonomyFingerprint,
      sharedTaxonomyFingerprint: String(
        configSnap.get('sharedTaxonomyFingerprint') ?? '',
      ),
      currentTaxonomyFingerprint: scheduleTaxonomyFingerprint(form),
      sourceSpeakerPhotoFingerprint: previousSpeakerPhotoFingerprint,
      sharedSpeakerPhotoFingerprint: String(
        configSnap.get('sharedSpeakerPhotoFingerprint') ?? '',
      ),
    });
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
  type ScheduleEmailRecipient = {
    change: ScheduleEmailChange;
    uid: string;
    primary: boolean;
  };
  const changes: ScheduleEmailChange[] = [];
  const unchanged: { proposalId: string; entryId: string }[] = [];
  const alreadyCancelled: ScheduleEmailChange[] = [];
  const newlyAssignedRecipients: ScheduleEmailRecipient[] = [];
  const previousScheduledSpeakerIds = previousSource?.get('scheduledSpeakerIds');
  const currentProposalIds = new Set<string>();
  for (const entry of sharedEntries) {
    if (entry.kind !== 'proposal') continue;
    currentProposalIds.add(entry.proposalId);
    const previous = previousEntries.get(entry.proposalId) as
      | (Record<string, any> & { id: string })
      | undefined;
    const moved =
      previous &&
      placementNotificationChanged(
        {
          date: previous.date,
          startsAt: previous.startsAt,
          durationMinutes: previous.durationMinutes,
          roomId: previous.roomId,
          session: previous.session,
          cancelled: previous.cancelled,
        },
        {
          date: entry.date,
          startsAt: entry.startsAt,
          durationMinutes: entry.durationMinutes,
          roomId: entry.roomId,
          session: entry.session,
          cancelled: entry.cancelled,
        },
        previousRooms.get(String(previous.roomId))?.name,
        currentRooms.get(entry.roomId)?.name,
        timeZoneChanged,
      );
    const change: ScheduleEmailChange = {
      kind: previous ? 'schedule_changed' : 'schedule_assigned',
      proposalId: entry.proposalId,
      entryId: entry.id,
      title: entry.session.title,
      date: entry.date,
      startsAt: entry.startsAt,
      room: currentRooms.get(entry.roomId),
    };
    if (!previous || moved) {
      changes.push(change);
    } else {
      unchanged.push({ proposalId: entry.proposalId, entryId: entry.id });
    }
    const proposal = proposals.get(entry.proposalId);
    const currentSpeakerIds = proposalSpeakerIds(proposal?.data() ?? {});
    const releasedSpeakerIds = previousReleaseSpeakerIds(
      previousRelease?.exists === true,
      previousScheduledSpeakerIds,
      entry.proposalId,
      currentReleasedSpeakerIds(proposal),
    );
    const primary = primarySpeakerId(proposal?.data() ?? {});
    for (const uid of newlyScheduledSpeakerIds(currentSpeakerIds, releasedSpeakerIds)) {
      newlyAssignedRecipients.push({
        change: { ...change, kind: 'schedule_assigned' },
        uid,
        primary: uid === primary,
      });
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
  type PendingScheduleCancellation = {
    proposalId: string;
    entryId: string;
    uid: string;
    primary: boolean;
  };
  // The public release no longer has an entry to carry this fact. Its private
  // source keeps the exact frozen recipients until their cancellation is sent.
  const previousPendingCancellations = (
    Array.isArray(previousSource?.get('pendingScheduleCancellations'))
      ? (previousSource?.get('pendingScheduleCancellations') as unknown[])
      : []
  ).flatMap((value): PendingScheduleCancellation[] => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    return typeof record.proposalId === 'string' &&
      record.proposalId.length > 0 &&
      typeof record.entryId === 'string' &&
      record.entryId.length > 0 &&
      typeof record.uid === 'string' &&
      record.uid.length > 0 &&
      typeof record.primary === 'boolean'
      ? [record as PendingScheduleCancellation]
      : [];
  });
  const changeProposalIds = [
    ...new Set([
      ...[...changes, ...alreadyCancelled].map((change) => change.proposalId),
      ...previousPendingCancellations.map((pending) => pending.proposalId),
    ]),
  ];
  const changeProposalSnaps = changeProposalIds.length
    ? await db.getAll(
        ...changeProposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`)),
      )
    : [];

  const notificationProposals = new Map(
    [...proposalSnaps, ...changeProposalSnaps].map((proposal) => [proposal.id, proposal]),
  );
  const recipientsFor = (proposalId: string, kind?: ScheduleEmailChange['kind']) => {
    const proposal = notificationProposals.get(proposalId);
    if (!proposal?.exists) return [];
    const data = proposal.data()!;
    const primary = primarySpeakerId(data);
    const recipientIds =
      kind === 'schedule_cancelled'
        ? scheduleCancellationRecipientIds(proposal)
        : proposalSpeakerIds(data);
    return recipientIds.map((uid) => ({ uid, primary: uid === primary }));
  };
  const newlyAssignedKeys = new Set(
    newlyAssignedRecipients.map(({ change, uid }) => `${change.proposalId}\u0000${uid}`),
  );
  const changeRecipients: ScheduleEmailRecipient[] = [
    ...changes.flatMap((change) =>
      recipientsFor(change.proposalId, change.kind).flatMap((recipient) =>
        change.kind !== 'schedule_cancelled' &&
        newlyAssignedKeys.has(`${change.proposalId}\u0000${recipient.uid}`)
          ? []
          : [{ change, ...recipient }],
      ),
    ),
    ...newlyAssignedRecipients,
  ];

  const cancelledCarrySources: {
    proposalId: string;
    entryId: string;
    uid: string;
    primary: boolean;
    sourceRef: FirebaseFirestore.DocumentReference;
  }[] = [];
  if (previousReleaseId && alreadyCancelled.length) {
    const candidates = alreadyCancelled.flatMap((change) =>
      recipientsFor(change.proposalId, change.kind).map((recipient) => ({ change, ...recipient })),
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

  const rawCarryCandidates = previousReleaseId
    ? [
        ...unchanged.flatMap(({ proposalId, entryId }) =>
          recipientsFor(proposalId).flatMap(({ uid, primary }) =>
            (['schedule_assigned', 'schedule_changed'] as const).map((kind) => ({
              proposalId,
              entryId,
              uid,
              primary,
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
          primary,
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
        ...previousPendingCancellations
          .filter(({ proposalId }) => !currentProposalIds.has(proposalId))
          .map(({ proposalId, entryId, uid, primary }) => ({
            proposalId,
            entryId,
            uid,
            primary,
            sourceRef: db.doc(
              `cfps/${cfpId}/emailLog/${logId(
                'schedule_cancelled',
                proposalId,
                previousReleaseId,
                primary ? undefined : uid,
              )}`,
            ),
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
  const carryCandidates = [
    ...new Map(
      rawCarryCandidates.map((candidate) => [
        `${candidate.sourceRef.path}\u0000${candidate.targetRef.path}`,
        candidate,
      ]),
    ).values(),
  ];
  const previousScheduledProposalEntries = previousSource?.get('scheduledProposalEntries');
  const previousProposalEntryKeys =
    previousReleaseId &&
    previousScheduledProposalEntries &&
    typeof previousScheduledProposalEntries === 'object' &&
    !Array.isArray(previousScheduledProposalEntries)
      ? [...currentProposalIds].flatMap((proposalId) => {
          const entryId = (previousScheduledProposalEntries as Record<string, unknown>)[proposalId];
          return typeof entryId === 'string' && entryId
            ? [{ proposalId, entryId }]
            : [];
        })
      : [];
  const version =
    Math.max(
      Number(configSnap.get('sharedVersion') ?? 0),
      Number(configSnap.get('publishedVersion') ?? 0),
      Number(previousRelease?.get('version') ?? 0),
    ) + 1;
  const { revision, speakerNotificationCount } = await db.runTransaction(async (tx) => {
    const previousReleaseEmails = previousReleaseId
      ? await tx.get(
          db
            .collection(`cfps/${cfpId}/emailLog`)
            .where('dedupeKey', '==', previousReleaseId),
        )
      : null;
    if (
      previousReleaseEmails?.docs.some(
        (email) =>
          isScheduleEmail(email.get('kind')) &&
          (email.get('status') === 'queued' || email.get('status') === 'sending'),
      )
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Wait for the current schedule email delivery to finish before sharing another preview.',
        { reason: 'schedule-email-in-flight' },
      );
    }
    if (
      previousReleaseEmails?.docs.some(
        (email) =>
          isScheduleEmail(email.get('kind')) &&
          CARRY_SCHEDULE_EMAIL_STATUSES.has(email.get('status') as EmailStatus) &&
          typeof email.get('providerAttemptId') === 'string' &&
          Boolean(email.get('providerAttemptId')),
      )
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Retry the current schedule email before sharing another preview.',
        { reason: 'schedule-email-retry-required' },
      );
    }
    if (
      previousReleaseEmails?.docs.some(
        (email) =>
          email.get('kind') === 'schedule_cancelled' &&
          currentProposalIds.has(String(email.get('proposalId') ?? '')) &&
          CARRY_SCHEDULE_EMAIL_STATUSES.has(email.get('status') as EmailStatus),
      )
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Send the current schedule cancellation before restoring that session.',
        { reason: 'schedule-cancellation-pending' },
      );
    }
    const representedCarrySources = new Set(
      carryCandidates.map((candidate) => candidate.sourceRef.path),
    );
    const representedCarryTargets = new Set([
      ...carryCandidates.map((candidate) => candidate.targetRef.path),
      ...changeRecipients.map(({ change, uid, primary }) =>
        db.doc(
          `cfps/${cfpId}/emailLog/${logId(
            change.kind,
            change.proposalId,
            releaseRef.id,
            primary ? undefined : uid,
          )}`,
        ).path,
      ),
    ]);
    const legacyCancellationCarries = (previousReleaseEmails?.docs ?? []).flatMap((email) => {
      if (
        email.get('kind') !== 'schedule_cancelled' ||
        !CARRY_SCHEDULE_EMAIL_STATUSES.has(email.get('status') as EmailStatus) ||
        representedCarrySources.has(email.ref.path)
      ) {
        return [];
      }
      const proposalId = email.get('proposalId');
      const uid = email.get('recipientUid');
      const entryId = email.get('data')?.scheduleEntryId;
      if (
        typeof proposalId !== 'string' ||
        !proposalId ||
        currentProposalIds.has(proposalId) ||
        typeof uid !== 'string' ||
        !uid ||
        typeof entryId !== 'string' ||
        !/^(?!__)[A-Za-z0-9_-]{1,160}$/.test(entryId)
      ) {
        return [];
      }
      const primaryId = logId('schedule_cancelled', proposalId, previousReleaseId!);
      const speakerId = logId('schedule_cancelled', proposalId, previousReleaseId!, uid);
      const primary = email.id === primaryId ? true : email.id === speakerId ? false : null;
      if (primary === null) return [];
      const targetRef = db.doc(
        `cfps/${cfpId}/emailLog/${logId(
          'schedule_cancelled',
          proposalId,
          releaseRef.id,
          primary ? undefined : uid,
        )}`,
      );
      if (representedCarryTargets.has(targetRef.path)) return [];
      representedCarryTargets.add(targetRef.path);
      return [{ proposalId, entryId, uid, primary, source: email, targetRef }];
    });
    const allProposalIds = [
      ...new Set([
        ...proposalEntries.map((entry) => entry.proposalId),
        ...changeProposalIds,
        ...changeRecipients.map(({ change }) => change.proposalId),
        ...carryCandidates.map((candidate) => candidate.proposalId),
        ...legacyCancellationCarries.map((candidate) => candidate.proposalId),
      ]),
    ];
    const proposalRefs = allProposalIds.map((id) => db.doc(`cfps/${cfpId}/proposals/${id}`));
    const speakerIds = [...new Set(changeRecipients.map((recipient) => recipient.uid))];
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
    const previousProposalEntryRefs = previousProposalEntryKeys.map(({ entryId }) =>
      db.doc(
        `cfps/${cfpId}/scheduleReleases/${previousReleaseId}/entries/${entryId}`,
      ),
    );
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
      db.doc(`cfps/${cfpId}/config/confirmForm`),
      ...photoConfirmationRefs.map(({ ref }) => ref),
      ...customPhotoDocRefs,
      ...profileUpdateHandlingRefs,
      ...comparisonRefs,
      ...previousProposalEntryRefs,
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
    const freshConfirmForm = snapshots[3];
    const freshFormValue = scheduleFormFrom(freshForm);
    const photoStart = 4;
    const freshPhotoConfirmations = snapshots.slice(
      photoStart,
      photoStart + photoConfirmationRefs.length,
    );
    const customPhotoStart = photoStart + photoConfirmationRefs.length;
    const freshCustomPhotoAssets = snapshots.slice(
      customPhotoStart,
      customPhotoStart + customPhotoDocRefs.length,
    );
    const profileRequestStart = customPhotoStart + customPhotoDocRefs.length;
    const freshProfileUpdateRequests = snapshots.slice(
      profileRequestStart,
      profileRequestStart + profileUpdateHandlingRefs.length,
    );
    const comparisonStart = profileRequestStart + profileUpdateHandlingRefs.length;
    const previousProposalEntryStart = comparisonStart + comparisonRefs.length;
    const dataStart = previousProposalEntryStart + previousProposalEntryRefs.length;
    const freshPreviousRelease = previousReleaseId ? snapshots[comparisonStart] : null;
    const freshPreviousSource = previousReleaseId ? snapshots[comparisonStart + 1] : null;
    const freshPreviousProposalEntries = snapshots.slice(
      previousProposalEntryStart,
      dataStart,
    );
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
    if (
      freshProposals.some(
        (proposal) => proposal.exists && proposal.get('scheduleCancellationRequired') === true,
      )
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Wait for the current schedule cancellation to finish before sharing another preview.',
        { reason: 'schedule-cancellation-processing' },
      );
    }
    const previousEmailById = new Map(
      (previousReleaseEmails?.docs ?? []).map((email) => [email.id, email]),
    );
    for (const [index, previousEntry] of freshPreviousProposalEntries.entries()) {
      if (!previousEntry.exists || previousEntry.get('cancelled') !== true) continue;
      const { proposalId } = previousProposalEntryKeys[index];
      const proposal = freshProposals.find((candidate) => candidate.id === proposalId);
      if (!proposal?.exists) continue;
      const primary = primarySpeakerId(proposal.data()!);
      const cancellationRows = scheduleCancellationRecipientIds(proposal).map((uid) =>
        previousEmailById.get(
          logId(
            'schedule_cancelled',
            proposalId,
            previousReleaseId!,
            uid === primary ? undefined : uid,
          ),
        ),
      );
      if (cancellationRows.length === 0 || cancellationRows.some((row) => !row?.exists)) {
        throw new HttpsError(
          'failed-precondition',
          'Wait for the current schedule cancellation to finish before sharing another preview.',
          { reason: 'schedule-cancellation-processing' },
        );
      }
      if (cancellationRows.some((row) => row!.get('status') !== 'sent')) {
        throw new HttpsError(
          'failed-precondition',
          'Send the current schedule cancellation before restoring that session.',
          { reason: 'schedule-cancellation-pending' },
        );
      }
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
      {
        cfpId,
        releaseId: releaseRef.id,
        form: confirmFormFrom(freshConfirmForm),
        confirmations: new Map(
          freshPhotoConfirmations.map((snap, index) => [
            photoConfirmationRefs[index].key,
            snap,
          ]),
        ),
        customAssets: new Map(
          freshCustomPhotoAssets.map((snap, index) => [customPhotoRefs[index], snap]),
        ),
      },
    );
    if (
      freshProjection.fingerprint !== projection.fingerprint ||
      freshProjection.speakerPhotoFingerprint !== projection.speakerPhotoFingerprint
    ) {
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
    const freshPreviousSpeakerPhotoFingerprint = String(
      freshPreviousSource?.get('speakerPhotoFingerprint') ?? '',
    );
    const freshPreviousTaxonomyFingerprint = String(
      freshPreviousSource?.get('taxonomyFingerprint') ?? '',
    );
    const freshProjectionChanged =
      freshPreviousRelease?.exists !== true ||
      scheduleReleaseNeedsReshare({
        revision: current,
        sourceRevision: Number(
          freshPreviousSource?.get('sourceRevision') ??
            freshPreviousRelease?.get('sourceRevision') ??
            -1,
        ),
        sharedRevision: Number(freshConfig.get('sharedRevision') ?? -1),
        sourceFingerprint: freshPreviousFingerprint,
        sharedFingerprint: String(freshConfig.get('sharedFingerprint') ?? ''),
        projectionFingerprint: freshProjection.fingerprint,
        releaseFingerprint: previousReleaseFingerprint,
        sourceTaxonomyFingerprint: freshPreviousTaxonomyFingerprint,
        sharedTaxonomyFingerprint: String(
          freshConfig.get('sharedTaxonomyFingerprint') ?? '',
        ),
        currentTaxonomyFingerprint: scheduleTaxonomyFingerprint(freshFormValue),
        sourceSpeakerPhotoFingerprint: freshPreviousSpeakerPhotoFingerprint,
        sharedSpeakerPhotoFingerprint: String(
          freshConfig.get('sharedSpeakerPhotoFingerprint') ?? '',
        ),
      });
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
      sharedSpeakerPhotoFingerprint: projection.speakerPhotoFingerprint,
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
    const freshProposalMap = new Map(freshProposals.map((snap) => [snap.id, snap]));
    for (const [index, updateRequest] of freshProfileUpdateRequests.entries()) {
      if (!updateRequest.exists) continue;
      const key = profileUpdateHandlingKeys[index];
      const proposal = freshProposalMap.get(key.proposalId);
      const state = requestStateFrom(updateRequest);
      if (
        !state ||
        state.status !== 'resolved' ||
        state.handledAt ||
        !includedProposalIds.has(key.proposalId) ||
        !proposalSpeakerIds(proposal?.data() ?? {}).includes(key.speakerUid) ||
        updateRequest.get('cfpId') !== cfpId ||
        updateRequest.get('proposalId') !== key.proposalId ||
        updateRequest.get('speakerUid') !== key.speakerUid
      ) {
        continue;
      }
      countWrite();
      tx.update(updateRequest.ref, {
        handledAt: FieldValue.serverTimestamp(),
        handledBy: byUid,
        handledReleaseId: releaseRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const entryByProposal = new Map(
      proposalEntries.map((entry) => [entry.proposalId, entry] as const),
    );
    for (const proposal of freshProposals) {
      const entry = entryByProposal.get(proposal.id);
      const patch: Record<string, unknown> = {};
      if (entry?.assignedLanguage && includedProposalIds.has(proposal.id)) {
        patch.assignedLanguage = entry.assignedLanguage;
      }
      if (proposal.get('lateSpeakerSchedulePreserved') === true) {
        patch.lateSpeakerSchedulePreserved = FieldValue.delete();
        patch.lateSpeakerScheduleBaselineIds = FieldValue.delete();
      }
      if (Object.keys(patch).length > 0) {
        countWrite();
        tx.update(proposal.ref, {
          ...patch,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    const freshSpeakerMap = new Map(freshSpeakers.map((snap) => [snap.id, snap]));
    const freshParticipantMap = new Map(
      freshParticipants.map((participant, index) => [
        `${participantKeys[index].proposalId}\u0000${participantKeys[index].uid}`,
        participant,
      ]),
    );
    let speakerNotificationCount = 0;
    const pendingScheduleCancellations: PendingScheduleCancellation[] = [];
    for (const [index, recipient] of changeRecipients.entries()) {
      if (existingEmails[index]?.exists) continue;
      const { change, uid: speakerId } = recipient;
      const proposal = freshProposalMap.get(change.proposalId);
      if (change.kind !== 'schedule_cancelled' && proposal?.get('status') !== 'confirmed') {
        continue;
      }
      const allowedRecipients =
        change.kind === 'schedule_cancelled'
          ? scheduleCancellationRecipientIds(proposal)
          : proposalSpeakerIds(proposal?.data() ?? {});
      if (!allowedRecipients.includes(speakerId)) continue;
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
          needsVisa: attendanceNeedsVisa(
            freshFormValue,
            usesPerSpeakerLifecycle(proposal!.data()!)
              ? participant?.get('attendance')
              : isPrimary
                ? proposal?.get('attendance')
                : undefined,
          ),
          scheduleDate,
          scheduleTime: `${change.startsAt} (${config.timeZone})`,
          scheduleRoom: change.room ? localised(change.room.name, locale) : '',
          scheduleEntryId: change.entryId,
        },
        status: 'held' satisfies EmailStatus,
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (change.kind === 'schedule_cancelled') {
        pendingScheduleCancellations.push({
          proposalId: change.proposalId,
          entryId: change.entryId,
          uid: speakerId,
          primary: recipient.primary,
        });
      }
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
      const cancellation = sourceData.kind === 'schedule_cancelled';
      if (
        sourceData.proposalId !== candidate.proposalId ||
        (sourceData.recipientUid !== undefined && sourceData.recipientUid !== candidate.uid)
      ) {
        continue;
      }
      if (!cancellation) {
        if (!proposalSpeakerIds(proposal?.data() ?? {}).includes(candidate.uid)) continue;
        if (proposal?.get('status') !== 'confirmed') continue;
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
      if (cancellation) {
        pendingScheduleCancellations.push({
          proposalId: candidate.proposalId,
          entryId: candidate.entryId,
          uid: candidate.uid,
          primary: candidate.primary,
        });
      }
      speakerNotificationCount += 1;
    }
    for (const candidate of legacyCancellationCarries) {
      const sourceData = candidate.source.data();
      const sourceStatus = sourceData.status as EmailStatus;
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
      pendingScheduleCancellations.push({
        proposalId: candidate.proposalId,
        entryId: candidate.entryId,
        uid: candidate.uid,
        primary: candidate.primary,
      });
      speakerNotificationCount += 1;
    }
    const uniquePendingScheduleCancellations = [
      ...new Map(
        pendingScheduleCancellations.map((pending) => [
          `${pending.proposalId}\u0000${pending.entryId}\u0000${pending.uid}`,
          pending,
        ]),
      ).values(),
    ];
    countWrite();
    tx.create(scheduleReleaseSourceRef(cfpId, releaseRef.id), {
      sourceRevision: current,
      sourceFingerprint: projection.fingerprint,
      speakerPhotoFingerprint: projection.speakerPhotoFingerprint,
      speakerPhotos: projection.speakerPhotos,
      scheduledProposalEntries: Object.fromEntries(
        sharedEntries.flatMap((entry) =>
          entry.kind === 'proposal' ? [[entry.proposalId, entry.id]] : [],
        ),
      ),
      scheduledSpeakerIds: Object.fromEntries(
        sharedEntries.flatMap((entry) =>
          entry.kind === 'proposal'
            ? [[
                entry.proposalId,
                proposalSpeakerIds(freshProposalMap.get(entry.proposalId)?.data() ?? {}),
              ]]
            : [],
        ),
      ),
      pendingScheduleCancellations: uniquePendingScheduleCancellations,
      taxonomyFingerprint: scheduleTaxonomyFingerprint(freshFormValue),
      sharedBy: byUid,
      sharedAt: FieldValue.serverTimestamp(),
    });
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
    const sourceSpeakerPhotoFingerprint = String(
      releaseSource.get('speakerPhotoFingerprint') ?? '',
    );
    const currentTaxonomyFingerprint = scheduleTaxonomyFingerprint(form);
    const taxonomyChanged =
      Boolean(sourceTaxonomyFingerprint) &&
      sourceTaxonomyFingerprint !== currentTaxonomyFingerprint;
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
        ownProposals.docs.flatMap((proposal) => {
          const releasedSpeakerIds = currentReleasedSpeakerIds(proposal);
          return releasedSpeakerIds.includes(uid)
            ? [[proposal.id, releasedSpeakerIds] as const]
            : [];
        }),
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
      proposalSnaps.flatMap((proposal) => {
        const releasedSpeakerIds = currentReleasedSpeakerIds(proposal);
        return releasedSpeakerIds.length > 0
          ? [[proposal.id, releasedSpeakerIds] as const]
          : [];
      }),
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
          scheduleReleaseNeedsReshare({
            revision: Number(configSnap.get('revision') ?? 0),
            sourceRevision,
            sharedRevision: Number(configSnap.get('sharedRevision') ?? -1),
            sourceFingerprint,
            sharedFingerprint: String(configSnap.get('sharedFingerprint') ?? ''),
            projectionFingerprint: currentProjection.fingerprint,
            releaseFingerprint: scheduleProjectionFingerprint(releaseConfig, releaseEntries),
            sourceTaxonomyFingerprint,
            sharedTaxonomyFingerprint: String(
              configSnap.get('sharedTaxonomyFingerprint') ?? '',
            ),
            currentTaxonomyFingerprint,
            sourceSpeakerPhotoFingerprint,
            sharedSpeakerPhotoFingerprint: String(
              configSnap.get('sharedSpeakerPhotoFingerprint') ?? '',
            ),
          });
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
        { reason: 'schedule-preview-stale' },
      );
    }

    const releaseRef = db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`);
    const [release, releaseSource, releaseEntriesSnap, draftSnap, formSnap, confirmFormSnap] =
      await Promise.all([
        tx.get(releaseRef),
        tx.get(scheduleReleaseSourceRef(cfpId, releaseId)),
        tx.get(releaseRef.collection('entries')),
        tx.get(scheduleDraft(cfpId)),
        tx.get(scheduleSubmissionFormRef(cfpId)),
        tx.get(db.doc(`cfps/${cfpId}/config/confirmForm`)),
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
    const photoConfirmationRefs = scheduleConfirmationRefs(cfpId, proposalSnaps);
    const photoConfirmationSnaps = photoConfirmationRefs.length
      ? await tx.getAll(...photoConfirmationRefs.map(({ ref }) => ref))
      : [];
    const customPhotoRefs = customSchedulePhotoAssetRefs(draftEntries);
    const customPhotoSnaps = customPhotoRefs.length
      ? await tx.getAll(
          ...customPhotoRefs.map((assetRef) =>
            scheduleSpeakerPhotoAssetRef(cfpId, assetRef),
          ),
        )
      : [];
    const projection = sharedProjection(
      config,
      draftEntries,
      new Map(proposalSnaps.map((proposal) => [proposal.id, proposal])),
      form,
      {
        cfpId,
        releaseId,
        form: confirmFormFrom(confirmFormSnap),
        confirmations: new Map(
          photoConfirmationSnaps.map((snap, index) => [photoConfirmationRefs[index].key, snap]),
        ),
        customAssets: new Map(
          customPhotoSnaps.map((snap, index) => [customPhotoRefs[index], snap]),
        ),
      },
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
    const sourceSpeakerPhotoFingerprint = String(
      releaseSource.get('speakerPhotoFingerprint') ?? '',
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
      (Boolean(confirmFormFrom(confirmFormSnap).speakerPhoto) &&
        !sourceSpeakerPhotoFingerprint) ||
      (sourceSpeakerPhotoFingerprint &&
        sourceSpeakerPhotoFingerprint !== projection.speakerPhotoFingerprint) ||
      (String(configSnap.get('sharedSpeakerPhotoFingerprint') ?? '') &&
        String(configSnap.get('sharedSpeakerPhotoFingerprint')) !==
          projection.speakerPhotoFingerprint) ||
      projection.fingerprint !== sourceFingerprint ||
      releaseFingerprint !== sourceFingerprint
    ) {
      throw new HttpsError(
        'failed-precondition',
        'The shared schedule is out of date. Share it again before publishing.',
        { reason: 'schedule-preview-stale' },
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

/** Public bytes are derived only from the currently published release member. */
export const publicSchedulePhoto = onCall(CALLABLE, async (request) => {
  const cfpId = requireCfpId(request.data);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const releaseId = typeof data.releaseId === 'string' ? data.releaseId : '';
  const entryId = typeof data.entryId === 'string' ? data.entryId : '';
  const speakerIndex = data.speakerIndex;
  if (
    !releaseId ||
    !entryId ||
    releaseId.length > 256 ||
    entryId.length > 256 ||
    releaseId.includes('/') ||
    entryId.includes('/') ||
    typeof speakerIndex !== 'number' ||
    !Number.isInteger(speakerIndex) ||
    speakerIndex < 0 ||
    speakerIndex >= SCHEDULE_LIMITS.customSpeakers
  ) {
    throw new HttpsError('invalid-argument', 'A valid published schedule photo is required.');
  }

  const releaseRef = db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`);
  const [cfp, release, entry, source] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    releaseRef,
    releaseRef.collection('entries').doc(entryId),
    scheduleReleaseSourceRef(cfpId, releaseId),
  );
  const unavailable = () =>
    new HttpsError('not-found', 'That published speaker photo is unavailable.');
  if (
    !cfp.exists ||
    cfp.get('publishedScheduleId') !== releaseId ||
    !release.exists ||
    !entry.exists ||
    (entry.get('kind') !== 'proposal' && entry.get('kind') !== 'custom') ||
    entry.get('cancelled') === true ||
    !source.exists
  ) {
    throw unavailable();
  }

  const session = entry.get('session');
  const speakers = entry.get('kind') === 'custom'
    ? entry.get('speakers')
    : session && typeof session === 'object' && !Array.isArray(session)
      ? (session as Record<string, unknown>).speakers
      : undefined;
  const speaker = Array.isArray(speakers) ? speakers[speakerIndex] : undefined;
  const photoRef =
    speaker && typeof speaker === 'object' && !Array.isArray(speaker)
      ? (speaker as Record<string, unknown>).photoRef
      : undefined;
  const opaquePhotoRef = typeof photoRef === 'string' ? photoRef : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(opaquePhotoRef)) throw unavailable();
  const storedPhotos = source.get('speakerPhotos');
  const member =
    opaquePhotoRef &&
    storedPhotos &&
    typeof storedPhotos === 'object' &&
    !Array.isArray(storedPhotos)
      ? (storedPhotos as Record<string, unknown>)[opaquePhotoRef]
      : undefined;
  if (!member || typeof member !== 'object' || Array.isArray(member)) throw unavailable();
  const record = member as Partial<ScheduleReleaseSpeakerPhoto>;
  if (
    record.entryId !== entryId ||
    record.speakerIndex !== speakerIndex ||
    typeof record.path !== 'string' ||
    typeof record.sourceGeneration !== 'string' ||
    !record.sourceGeneration
  ) {
    throw unavailable();
  }
  const sourcePath = record.path;
  const sourceGeneration = record.sourceGeneration;
  if (entry.get('kind') === 'custom') {
    const custom = record as Partial<CustomScheduleReleaseSpeakerPhoto>;
    if (
      custom.kind !== 'custom' ||
      !validCustomScheduleSpeakerPhotoRef(custom.assetRef) ||
      typeof custom.path !== 'string' ||
      typeof custom.sourceGeneration !== 'string' ||
      !custom.sourceGeneration ||
      custom.path !== customScheduleSpeakerPhotoPath(cfpId, custom.assetRef)
    ) {
      throw unavailable();
    }
  } else {
    const proposal = record as Partial<ProposalScheduleReleaseSpeakerPhoto>;
    const proposalId = String(entry.get('proposalId') ?? '');
    if (
      (proposal.kind !== undefined && proposal.kind !== 'proposal') ||
      proposal.proposalId !== proposalId ||
      typeof proposal.uid !== 'string' ||
      typeof proposal.path !== 'string' ||
      typeof proposal.sourceGeneration !== 'string' ||
      proposal.path !==
        speakerConfirmedHeadshotPath(
          cfpId,
          proposalId,
          proposal.uid,
          SPEAKER_PHOTO_KEY,
          proposal.sourceGeneration,
        )
    ) {
      throw unavailable();
    }
  }

  const bucket = getStorage().bucket();
  const cachePath = publicSchedulePhotoCachePath(cfpId, releaseId, opaquePhotoRef);
  const cached = await readStoredHeadshot(bucket, cachePath);
  if (cached) {
    if (cached.contentType !== 'image/webp') {
      throw new HttpsError('unavailable', 'That speaker photo is temporarily unavailable.');
    }
    return {
      ok: true,
      contentType: 'image/webp' as const,
      base64: cached.bytes.toString('base64'),
    };
  }

  const stored = await readStoredHeadshot(bucket, sourcePath, sourceGeneration);
  if (!stored) throw unavailable();
  const derivative = await publicSpeakerPhotoDerivative(stored.bytes);
  const cacheFile = bucket.file(cachePath);
  let responseBytes = derivative.bytes;
  try {
    await cacheFile.save(derivative.bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: derivative.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    const code = Number((error as { code?: unknown } | null)?.code ?? 0);
    if (code !== 409 && code !== 412) {
      logger.error('public schedule photo cache write failed', {
        cfpId,
        releaseId,
        entryId,
        error: String(error),
      });
      throw new HttpsError('unavailable', 'That speaker photo is temporarily unavailable.');
    }
    const raced = await readStoredHeadshot(bucket, cachePath);
    if (!raced || raced.contentType !== 'image/webp') {
      throw new HttpsError('unavailable', 'That speaker photo is temporarily unavailable.');
    }
    responseBytes = raced.bytes;
  }

  // Deletion marks the CFP first and clears its bounded Storage prefix second.
  // If this miss began before that fence, do not recreate a cache object after
  // the clear has already passed this release.
  const currentCfp = await db.doc(`cfps/${cfpId}`).get();
  if (
    !currentCfp.exists ||
    currentCfp.get('deleting') === true ||
    currentCfp.get('publishedScheduleId') !== releaseId
  ) {
    try {
      await cacheFile.delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn('stale public schedule photo cache cleanup failed', {
        cfpId,
        releaseId,
        entryId,
        error: String(error),
      });
    }
    throw unavailable();
  }
  return {
    ok: true,
    contentType: derivative.contentType,
    base64: responseBytes.toString('base64'),
  };
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
    const forceCancellationAdded =
      event.data.before.get('scheduleCancellationRequired') !== true &&
      event.data.after.get('scheduleCancellationRequired') === true;
    if (beforeStatus === afterStatus && !forceCancellationAdded) return;
    const { cfpId, proposalId } = event.params;
    const cfpSnap = await db.doc(`cfps/${cfpId}`).get();
    if (!cfpSnap.exists || cfpSnap.get('archived') === true) return;
    const releaseIds = scheduleReleaseIds(cfpSnap);
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

    const observedReleaseId = scheduleEmailReleaseId(cfpSnap);
    const observedReleaseIndex = releaseIds.indexOf(observedReleaseId);
    const observedEntries =
      observedReleaseIndex >= 0 ? releaseMatches[observedReleaseIndex].docs : [];
    const didCancel = await db.runTransaction(async (tx) => {
      const [freshCfp, freshProposal, ...freshObservedEntries] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        event.data!.after.ref,
        ...observedEntries.map((entry) => entry.ref),
      );
      if (!freshCfp.exists || freshCfp.get('archived') === true) return false;
      if (!proposalEventIsCurrent(event.data!.after, freshProposal)) return false;
      // These release queries happened before the transaction. A newer share
      // must keep its cancellation marker for the event that observed it.
      if (!scheduleCancellationSnapshotIsCurrent(releaseIds, freshCfp)) return false;
      const freshStatus = String(freshProposal.get('status') ?? '');
      const cancelNow =
        freshProposal.get('scheduleCancellationRequired') === true ||
        (freshStatus !== 'confirmed' && currentReleasedSpeakerIds(freshProposal).length === 0);
      if (cancelNow) {
        for (const matching of releaseMatches) {
          for (const entry of matching.docs) {
            tx.update(entry.ref, {
              cancelled: true,
              cancelledAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }
      if (freshProposal.get('scheduleCancellationRequired') === true) {
        tx.update(freshProposal.ref, {
          scheduleCancellationRequired: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      const expectedEntryIds =
        freshStatus === 'confirmed' ? draftMatching.docs.map((entry) => entry.id).sort() : [];
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
      return cancelNow;
    });
    if (!didCancel || !hasReleaseEntry) {
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
    const cancellationReleaseId = entryReleaseId;
    await db.runTransaction(async (tx) => {
      const [freshCfp, freshProposal] = await tx.getAll(
        db.doc(`cfps/${cfpId}`),
        event.data!.after.ref,
      );
      if (
        !freshCfp.exists ||
        freshCfp.get('archived') === true ||
        freshCfp.get('deleting') === true ||
        scheduleEmailReleaseId(freshCfp) !== cancellationReleaseId ||
        !proposalEventIsCurrent(event.data!.after, freshProposal)
      ) {
        return;
      }
      const proposal = event.data!.after.data();
      if (!proposal) return;
      const contexts = await speakerEmailContexts(
        tx,
        cfpId,
        proposalId,
        proposal,
        scheduleCancellationRecipientIds(event.data?.after),
      );
      const date = calendarDate(String(entry.get('date') ?? ''));
      await queueEmails(
        db,
        tx,
        cfpId,
        contexts.map((context) => ({
          kind: 'schedule_cancelled' as const,
          proposalId,
          dedupeKey: cancellationReleaseId,
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
