import { createHash, randomUUID } from 'node:crypto';

import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { validateCfpId } from '../../shared/cfp';
import {
  FORM_LIMITS,
  IMAGE_TYPES,
  SPEAKER_PHOTO_KEY,
  confirmFormFromData,
  type ConfirmedSpeakerPhoto,
} from '../../shared/confirmForm';
import { speakerSchema } from '../../shared/schema';
import type {
  SpeakerProfilePreviewChange,
  SpeakerProfilePreviewField,
  SpeakerProfilePreviewFields,
  SpeakerProfilePreviewValue,
  SpeakerProfileUpdateRequestState,
  SpeakerProfileUpdateRequestSummary,
  SpeakerProfileUpdateScope,
  SpeakerSnapshot,
} from '../../shared/types';
import { speakerConfirmedHeadshotPath, speakerProfilePhotoFrom } from './headshots';
import { queueEmail } from './email';
import { speakerConfirmationRef, usesPerSpeakerLifecycle } from './speakerLifecycle';

const CALLABLE = { region: 'northamerica-northeast1', maxInstances: 10 } as const;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SPEAKER_UID = /^[^/]{1,128}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const PROFILE_UPDATE_SCOPES = ['profile', 'photo'] as const satisfies readonly SpeakerProfileUpdateScope[];
const PREVIEW_FIELDS = [
  'name',
  'bio',
  'company',
  'jobTitle',
  'basedIn',
  'socials',
  'isGde',
  'pastTalks',
  'sessionizeUrl',
] as const satisfies readonly SpeakerProfilePreviewField[];
const REFRESHABLE_STATUSES = new Set([
  'submitted',
  'under_review',
  'accepted',
  'confirmed',
  'declined',
  'waitlisted',
  'rejected',
]);

interface Identity {
  uid: string;
}

function requireIdentity(request: {
  auth?: { uid: string; token?: { email_verified?: unknown } };
}): Identity {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update a session profile.');
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return { uid };
}

function requireInput(data: unknown): {
  cfpId: string;
  proposalId: string;
  speakerUid?: string;
} {
  const input = (data ?? {}) as Record<string, unknown>;
  const cfpId = typeof input.cfpId === 'string' ? input.cfpId : '';
  const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
  const speakerUid = input.speakerUid;
  if (validateCfpId(cfpId) !== null || !DOCUMENT_ID.test(proposalId)) {
    throw new HttpsError('invalid-argument', 'A valid CFP and proposal are required.');
  }
  if (
    speakerUid !== undefined &&
    (typeof speakerUid !== 'string' ||
      !SPEAKER_UID.test(speakerUid))
  ) {
    throw new HttpsError('invalid-argument', 'A valid speaker is required.');
  }
  return {
    cfpId,
    proposalId,
    ...(typeof speakerUid === 'string' ? { speakerUid } : {}),
  };
}

function requireCfpInput(data: unknown): string {
  const cfpId = typeof (data as Record<string, unknown> | null)?.cfpId === 'string'
    ? String((data as Record<string, unknown>).cfpId)
    : '';
  if (validateCfpId(cfpId) !== null) {
    throw new HttpsError('invalid-argument', 'A valid CFP is required.');
  }
  return cfpId;
}

function requireScopes(value: unknown): SpeakerProfileUpdateScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError('invalid-argument', 'Choose profile details, speaker photo, or both.');
  }
  const unique = new Set<SpeakerProfileUpdateScope>();
  for (const scope of value) {
    if (!(PROFILE_UPDATE_SCOPES as readonly unknown[]).includes(scope)) {
      throw new HttpsError('invalid-argument', 'A requested profile section is not supported.');
    }
    unique.add(scope as SpeakerProfileUpdateScope);
  }
  return PROFILE_UPDATE_SCOPES.filter((scope) => unique.has(scope));
}

function requireExpectedFingerprints(data: unknown): {
  expectedCurrentFingerprint: string;
  expectedLatestFingerprint: string;
} {
  const input = (data ?? {}) as Record<string, unknown>;
  const expectedCurrentFingerprint = input.expectedCurrentFingerprint;
  const expectedLatestFingerprint = input.expectedLatestFingerprint;
  if (
    typeof expectedCurrentFingerprint !== 'string' ||
    !FINGERPRINT.test(expectedCurrentFingerprint) ||
    typeof expectedLatestFingerprint !== 'string' ||
    !FINGERPRINT.test(expectedLatestFingerprint)
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Preview the session profile immediately before applying it.',
    );
  }
  return { expectedCurrentFingerprint, expectedLatestFingerprint };
}

function requireRequestId(data: unknown): string {
  const requestId = (data as Record<string, unknown> | null)?.requestId;
  if (typeof requestId !== 'string' || !DOCUMENT_ID.test(requestId)) {
    throw new HttpsError('invalid-argument', 'A valid profile update request is required.');
  }
  return requestId;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function confirmedSpeakerPhotoFrom(
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
    photo.path !== speakerConfirmedHeadshotPath(
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

/** The comparison surface always excludes identity and private pointers. */
export function speakerProfilePreviewFrom(
  value: unknown,
  includeBasedIn = false,
): SpeakerProfilePreviewFields {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const socials = Array.isArray(data.socials)
    ? data.socials.flatMap((social) => {
        if (!social || typeof social !== 'object' || Array.isArray(social)) return [];
        const entry = social as Record<string, unknown>;
        return typeof entry.platform === 'string' && typeof entry.handle === 'string'
          ? [{ platform: entry.platform, handle: entry.handle }]
          : [];
      }) as SpeakerProfilePreviewFields['socials']
    : [];
  return {
    name: safeString(data.name),
    bio: safeString(data.bio),
    ...(data.company ? { company: safeString(data.company) } : {}),
    ...(data.jobTitle ? { jobTitle: safeString(data.jobTitle) } : {}),
    ...(includeBasedIn && data.basedIn ? { basedIn: safeString(data.basedIn) } : {}),
    socials,
    isGde: data.isGde === true,
    ...(data.pastTalks ? { pastTalks: safeString(data.pastTalks) } : {}),
    ...(data.sessionizeUrl ? { sessionizeUrl: safeString(data.sessionizeUrl) } : {}),
  };
}

function previewValue(
  profile: SpeakerProfilePreviewFields,
  field: SpeakerProfilePreviewField,
): SpeakerProfilePreviewValue {
  const value = profile[field];
  return value === undefined ? null : value;
}

export function speakerProfilePreviewChanges(
  current: SpeakerProfilePreviewFields,
  latest: SpeakerProfilePreviewFields,
): SpeakerProfilePreviewChange[] {
  return PREVIEW_FIELDS.flatMap((field) => {
    const before = previewValue(current, field);
    const after = previewValue(latest, field);
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before, after }];
  });
}

export function speakerProfilePreviewFingerprint(profile: SpeakerProfilePreviewFields): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

export function profileUpdateRequestRef(
  db: Firestore,
  cfpId: string,
  proposalId: string,
  speakerUid: string,
) {
  return db.doc(
    `cfps/${cfpId}/proposals/${proposalId}/profileUpdateRequests/${speakerUid}`,
  );
}

export function requestStateFrom(snapshot: DocumentSnapshot): SpeakerProfileUpdateRequestState | null {
  if (!snapshot.exists) return null;
  const requestId = snapshot.get('requestId');
  const generation = snapshot.get('generation');
  const scopes = requireStoredScopes(snapshot.get('scopes'), false);
  const resolvedScopes = requireStoredScopes(snapshot.get('resolvedScopes'), true);
  const status = snapshot.get('status');
  if (
    typeof requestId !== 'string' ||
    !DOCUMENT_ID.test(requestId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !['pending', 'resolved', 'cancelled'].includes(status) ||
    !snapshot.get('requestedAt') ||
    resolvedScopes.some((scope) => !scopes.includes(scope)) ||
    (status === 'pending' && resolvedScopes.length === scopes.length) ||
    (status === 'resolved' &&
      (resolvedScopes.length !== scopes.length || !snapshot.get('resolvedAt'))) ||
    (status === 'cancelled' && !snapshot.get('cancelledAt')) ||
    (snapshot.get('handledAt') && status !== 'resolved')
  ) {
    throw new HttpsError('failed-precondition', 'The saved profile update request is invalid.');
  }
  return {
    requestId,
    generation,
    status,
    scopes,
    resolvedScopes,
    requestedAt: snapshot.get('requestedAt') ?? null,
    ...(status === 'resolved' && snapshot.get('resolvedAt')
      ? { resolvedAt: snapshot.get('resolvedAt') }
      : {}),
    ...(status === 'cancelled' && snapshot.get('cancelledAt')
      ? { cancelledAt: snapshot.get('cancelledAt') }
      : {}),
    ...(status === 'resolved' && snapshot.get('handledAt')
      ? { handledAt: snapshot.get('handledAt') }
      : {}),
  };
}

function timestampMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function requestSummary(
  proposalId: string,
  speakerUid: string,
  request: SpeakerProfileUpdateRequestState,
): SpeakerProfileUpdateRequestSummary {
  return {
    proposalId,
    speakerUid,
    requestId: request.requestId,
    generation: request.generation,
    state: request.status === 'pending' ? 'waiting' : 'ready',
    scopes: request.scopes,
    resolvedScopes: request.resolvedScopes,
    requestedAt: timestampMillis(request.requestedAt),
    resolvedAt: timestampMillis(request.resolvedAt),
  };
}

function requireStoredScopes(
  value: unknown,
  allowEmpty: boolean,
): SpeakerProfileUpdateScope[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((scope) => !(PROFILE_UPDATE_SCOPES as readonly unknown[]).includes(scope)) ||
    new Set(value).size !== value.length
  ) {
    throw new HttpsError('failed-precondition', 'The saved profile update request is invalid.');
  }
  const stored = new Set(value as SpeakerProfileUpdateScope[]);
  return PROFILE_UPDATE_SCOPES.filter((scope) => stored.has(scope));
}

function assertRequestBinding(
  snapshot: DocumentSnapshot,
  cfpId: string,
  proposalId: string,
  speakerUid: string,
): void {
  if (
    snapshot.exists &&
    (snapshot.get('cfpId') !== cfpId ||
      snapshot.get('proposalId') !== proposalId ||
      snapshot.get('speakerUid') !== speakerUid)
  ) {
    throw new HttpsError('failed-precondition', 'The saved profile update request is invalid.');
  }
}

export function completedProfileUpdateScopes(
  request: SpeakerProfileUpdateRequestState,
  ready: readonly SpeakerProfileUpdateScope[],
): SpeakerProfileUpdateScope[] {
  const completed = new Set([...request.resolvedScopes, ...ready]);
  return PROFILE_UPDATE_SCOPES.filter(
    (scope) => request.scopes.includes(scope) && completed.has(scope),
  );
}

/** Terminates a pending generation when the speaker/session lifecycle invalidates it. */
export function cancelPendingProfileUpdateRequest(
  tx: Transaction,
  request: DocumentSnapshot,
  cancelledBy: string,
  cancellationReason: 'admin-cancelled' | 'decision-reset' | 'speaker-declined' | 'speaker-removed',
): boolean {
  if (!request.exists || request.get('status') !== 'pending') return false;
  tx.update(request.ref, {
    status: 'cancelled',
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy,
    cancellationReason,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/** The public, proposal-scoped copy of a private global speaker profile. */
export function speakerSnapshotFrom(
  uid: string,
  speaker: Record<string, unknown>,
): SpeakerSnapshot {
  return {
    uid,
    name: String(speaker.name ?? ''),
    bio: String(speaker.bio ?? ''),
    ...(speaker.company ? { company: String(speaker.company) } : {}),
    ...(speaker.jobTitle ? { jobTitle: String(speaker.jobTitle) } : {}),
    basedIn: String(speaker.basedIn ?? ''),
    socials: (speaker.socials as SpeakerSnapshot['socials']) ?? [],
    isGde: speaker.isGde === true,
    ...(speaker.pastTalks ? { pastTalks: String(speaker.pastTalks) } : {}),
    ...(speaker.sessionizeUrl ? { sessionizeUrl: String(speaker.sessionizeUrl) } : {}),
  };
}

function isEventAdmin(member: DocumentSnapshot): boolean {
  return member.exists && (member.get('role') === 'admin' || member.get('role') === 'owner');
}

function speakerHasConfirmed(
  proposal: DocumentSnapshot,
  confirmation: DocumentSnapshot,
): boolean {
  return usesPerSpeakerLifecycle(proposal.data()!)
    ? confirmation.get('response') === 'confirmed'
    : proposal.get('status') === 'confirmed';
}

/** Safe one-shot attention feed for the speaker picker and organiser dashboard. */
export const listSpeakerProfileUpdateRequests = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const cfpId = requireCfpInput(request.data);
  const db = getFirestore();
  const [cfp, member] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/members/${identity.uid}`),
  );
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfp.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
  if (cfp.get('archived') === true) return { ok: true, own: [], admin: [] };

  const eventAdmin = isEventAdmin(member);
  const requestDocs = await db
    .collectionGroup('profileUpdateRequests')
    .where(eventAdmin ? 'cfpId' : 'speakerUid', '==', eventAdmin ? cfpId : identity.uid)
    .get();
  const candidates = requestDocs.docs.flatMap((snapshot) => {
    const parts = snapshot.ref.path.split('/');
    if (
      parts.length !== 6 ||
      parts[0] !== 'cfps' ||
      parts[1] !== cfpId ||
      parts[2] !== 'proposals' ||
      parts[4] !== 'profileUpdateRequests'
    ) {
      return [];
    }
    const proposalId = parts[3];
    const speakerUid = parts[5];
    assertRequestBinding(snapshot, cfpId, proposalId, speakerUid);
    const state = requestStateFrom(snapshot);
    return state && state.status !== 'cancelled'
      ? [{ snapshot, proposalId, speakerUid, state }]
      : [];
  });
  const lifecycleSnapshots = candidates.length
    ? await db.getAll(
        ...candidates.flatMap(({ proposalId, speakerUid }) => [
          db.doc(`cfps/${cfpId}/proposals/${proposalId}`),
          speakerConfirmationRef(db, cfpId, proposalId, speakerUid),
        ]),
      )
    : [];
  const own: SpeakerProfileUpdateRequestSummary[] = [];
  const admin: SpeakerProfileUpdateRequestSummary[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const proposal = lifecycleSnapshots[index * 2];
    const confirmation = lifecycleSnapshots[index * 2 + 1];
    const activeSpeakerIds = Array.isArray(proposal?.get('speakerIds'))
      ? (proposal.get('speakerIds') as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && Boolean(uid),
        )
      : [];
    const active =
      proposal?.exists === true &&
      ['accepted', 'confirmed'].includes(String(proposal.get('status') ?? '')) &&
      activeSpeakerIds.includes(candidate.speakerUid) &&
      speakerHasConfirmed(proposal, confirmation);
    if (!active) continue;

    const summary = requestSummary(
      candidate.proposalId,
      candidate.speakerUid,
      candidate.state,
    );
    if (candidate.speakerUid === identity.uid && candidate.state.status === 'pending') {
      own.push(summary);
    }
    if (
      eventAdmin &&
      (candidate.state.status === 'pending' ||
        (candidate.state.status === 'resolved' && !candidate.state.handledAt))
    ) {
      admin.push(summary);
    }
  }
  const newestFirst = (
    left: SpeakerProfileUpdateRequestSummary,
    right: SpeakerProfileUpdateRequestSummary,
  ) => (right.requestedAt ?? 0) - (left.requestedAt ?? 0);
  own.sort(newestFirst);
  admin.sort(newestFirst);
  return { ok: true, own, admin };
});

/**
 * Compares the event copy with the latest account profile without returning
 * private source pointers or any confirmation/logistics data.
 */
export const previewProposalSpeakerProfile = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId, speakerUid } = requireInput(request.data);
  const targetUid = speakerUid ?? identity.uid;
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const profileRef = db.doc(`speakers/${targetUid}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, targetUid);
  const updateRequestRef = profileUpdateRequestRef(db, cfpId, proposalId, targetUid);
  const [cfp, proposal, profile, member, form, confirmation, updateRequest] = await db.getAll(
    cfpRef,
    proposalRef,
    profileRef,
    memberRef,
    formRef,
    confirmationRef,
    updateRequestRef,
  );
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfp.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
  if (cfp.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
  }
  if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
  const activeSpeakerIds = Array.isArray(proposal.get('speakerIds'))
    ? (proposal.get('speakerIds') as unknown[]).filter(
        (uid): uid is string => typeof uid === 'string' && Boolean(uid),
      )
    : [];
  const own = targetUid === identity.uid;
  if (!own && !isEventAdmin(member)) {
    throw new HttpsError(
      'permission-denied',
      'Only an event admin can preview another speaker\'s session profile.',
    );
  }
  if (!activeSpeakerIds.includes(targetUid)) {
    throw new HttpsError(
      own ? 'permission-denied' : 'failed-precondition',
      'That account is not an active speaker.',
    );
  }
  if (!REFRESHABLE_STATUSES.has(String(proposal.get('status') ?? ''))) {
    throw new HttpsError(
      'failed-precondition',
      'A submitted, active proposal is required before its speaker copy can be previewed.',
    );
  }
  const snapshots = proposal.get('speakerSnapshot');
  if (!Array.isArray(snapshots)) {
    throw new HttpsError('failed-precondition', 'This proposal has no submitted speaker copy.');
  }
  const stored = snapshots.find(
    (entry) => entry && typeof entry === 'object' && entry.uid === targetUid,
  );
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new HttpsError('failed-precondition', 'This proposal has no copy for that speaker.');
  }
  const parsedProfile = profile.exists ? speakerSchema.safeParse(profile.data()) : null;
  if (!parsedProfile?.success) {
    throw new HttpsError(
      'failed-precondition',
      'Complete the speaker profile before comparing the session copy.',
    );
  }
  const current = speakerProfilePreviewFrom(stored, own);
  const latest = speakerProfilePreviewFrom(parsedProfile.data, own);
  const configuredForm = confirmFormFromData(form.data());
  const photoEnabled = Boolean(configuredForm.speakerPhoto);
  const frozenPhoto = photoEnabled
    ? confirmedSpeakerPhotoFrom(
        usesPerSpeakerLifecycle(proposal.data()!)
          ? confirmation.get('speakerPhoto')
          : proposal.get('speakerPhoto'),
        cfpId,
        proposalId,
        targetUid,
      )
    : null;
  const profilePhoto = photoEnabled
    ? speakerProfilePhotoFrom(profile.get('profilePhoto'), targetUid)
    : null;
  assertRequestBinding(updateRequest, cfpId, proposalId, targetUid);
  return {
    ok: true,
    speakerUid: targetUid,
    current,
    latest,
    currentFingerprint: speakerProfilePreviewFingerprint(current),
    latestFingerprint: speakerProfilePreviewFingerprint(latest),
    changes: speakerProfilePreviewChanges(current, latest),
    photo: {
      enabled: photoEnabled,
      current: frozenPhoto ? 'present' : 'absent',
      latest: profilePhoto ? 'present' : 'absent',
      changed: frozenPhoto?.sourceGeneration !== profilePhoto?.generation,
    },
    request: requestStateFrom(updateRequest),
  };
});

/** Creates one in-app request generation and its targeted notification. */
export const requestProposalSpeakerProfileUpdate = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId, speakerUid } = requireInput(request.data);
  if (!speakerUid) throw new HttpsError('invalid-argument', 'Choose a speaker to contact.');
  const scopes = requireScopes((request.data as Record<string, unknown> | null)?.scopes);
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, speakerUid);
  const profileRef = db.doc(`speakers/${speakerUid}`);
  const updateRequestRef = profileUpdateRequestRef(db, cfpId, proposalId, speakerUid);
  const now = Timestamp.now();
  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, form, confirmation, profile, currentRequest] = await tx.getAll(
      cfpRef,
      proposalRef,
      memberRef,
      formRef,
      confirmationRef,
      profileRef,
      updateRequestRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!isEventAdmin(member)) {
      throw new HttpsError('permission-denied', 'Only an event admin can request a profile update.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    if (!['accepted', 'confirmed'].includes(String(proposal.get('status') ?? ''))) {
      throw new HttpsError(
        'failed-precondition',
        'Profile update requests are available only for accepted or confirmed sessions.',
      );
    }
    const activeSpeakerIds = Array.isArray(proposal.get('speakerIds'))
      ? (proposal.get('speakerIds') as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && Boolean(uid),
        )
      : [];
    if (!activeSpeakerIds.includes(speakerUid)) {
      throw new HttpsError('failed-precondition', 'That account is not an active speaker.');
    }
    if (!speakerHasConfirmed(proposal, confirmation)) {
      throw new HttpsError(
        'failed-precondition',
        'That speaker must confirm before an organiser can request a profile update.',
      );
    }
    const snapshots = proposal.get('speakerSnapshot');
    if (
      !Array.isArray(snapshots) ||
      !snapshots.some(
        (entry) => entry && typeof entry === 'object' && entry.uid === speakerUid,
      )
    ) {
      throw new HttpsError('failed-precondition', 'This proposal has no copy for that speaker.');
    }
    if (scopes.includes('photo') && !confirmFormFromData(form.data()).speakerPhoto) {
      throw new HttpsError(
        'failed-precondition',
        'This event has not enabled programme speaker photos.',
      );
    }

    assertRequestBinding(currentRequest, cfpId, proposalId, speakerUid);
    const current = requestStateFrom(currentRequest);
    if (current?.status === 'pending') {
      if (JSON.stringify(current.scopes) !== JSON.stringify(scopes)) {
        throw new HttpsError(
          'failed-precondition',
          'Cancel the pending profile update request before changing its sections.',
          { reason: 'profile-update-request-pending', requestId: current.requestId },
        );
      }
      return { created: false, changed: false, request: current };
    }

    const requestId = randomUUID();
    const generation = (current?.generation ?? 0) + 1;
    const email = profile.get('email');
    if (typeof email !== 'string' || !email) {
      throw new HttpsError(
        'failed-precondition',
        'That speaker has no verified profile email for this request.',
      );
    }
    const next: SpeakerProfileUpdateRequestState = {
      requestId,
      generation,
      status: 'pending',
      scopes,
      resolvedScopes: [],
      requestedAt: now,
    };
    const storedSnapshot = (snapshots as Record<string, unknown>[]).find(
      (entry) => entry && typeof entry === 'object' && entry.uid === speakerUid,
    );
    await queueEmail(db, tx, cfpId, {
      kind: 'profile_update_requested',
      proposalId,
      dedupeKey: `generation-${generation}`,
      logIdSuffix: speakerUid,
      recipientUid: speakerUid,
      profileUpdateRequestId: requestId,
      profileUpdateRequestGeneration: generation,
      to: email,
      locale: profile.get('locale') === 'fr' ? 'fr' : 'en',
      data: {
        speakerName: safeString(profile.get('name')) || safeString(storedSnapshot?.name) || email,
        title: safeString(proposal.get('title')),
        needsVisa: false,
      },
    });
    tx.set(updateRequestRef, {
      cfpId,
      proposalId,
      speakerUid,
      requestId,
      generation,
      status: 'pending',
      scopes,
      resolvedScopes: [],
      requestedBy: identity.uid,
      requestedAt: now,
      updatedAt: now,
    });
    return { created: true, changed: true, request: next };
  });

  logger.info('proposal speaker profile update requested', {
    cfpId,
    proposalId,
    speakerUid,
    byUid: identity.uid,
    scopes: result.request.scopes,
    created: result.created,
    changed: result.changed,
  });
  return { ok: true, ...result };
});

/** Cancels only the exact pending generation an admin reviewed. */
export const cancelProposalSpeakerProfileUpdate = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId, speakerUid } = requireInput(request.data);
  const requestId = requireRequestId(request.data);
  if (!speakerUid) throw new HttpsError('invalid-argument', 'Choose a speaker request to cancel.');
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const updateRequestRef = profileUpdateRequestRef(db, cfpId, proposalId, speakerUid);
  const now = Timestamp.now();
  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, currentRequest] = await tx.getAll(
      cfpRef,
      proposalRef,
      memberRef,
      updateRequestRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true || cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is read-only.');
    }
    if (!isEventAdmin(member)) {
      throw new HttpsError('permission-denied', 'Only an event admin can cancel this request.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    const current = requestStateFrom(currentRequest);
    if (!current || current.requestId !== requestId) {
      throw new HttpsError('failed-precondition', 'That profile update request is no longer current.');
    }
    assertRequestBinding(currentRequest, cfpId, proposalId, speakerUid);
    if (current.status === 'cancelled') return { changed: false, request: current };
    if (current.status === 'resolved') {
      throw new HttpsError('failed-precondition', 'A completed profile update cannot be cancelled.');
    }
    tx.update(updateRequestRef, {
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: identity.uid,
      cancellationReason: 'admin-cancelled',
      updatedAt: now,
    });
    return {
      changed: true,
      request: { ...current, status: 'cancelled' as const, cancelledAt: now },
    };
  });
  logger.info('proposal speaker profile update cancelled', {
    cfpId,
    proposalId,
    speakerUid,
    requestId,
    byUid: identity.uid,
    changed: result.changed,
  });
  return { ok: true, ...result };
});

/**
 * A speaker explicitly acknowledges every requested scope that now matches
 * their account profile. Admins cannot complete this on somebody else's behalf.
 */
export const completeProposalSpeakerProfileUpdate = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireInput(request.data);
  const requestId = requireRequestId(request.data);
  const speakerUid = identity.uid;
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const profileRef = db.doc(`speakers/${speakerUid}`);
  const formRef = db.doc(`cfps/${cfpId}/config/confirmForm`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, speakerUid);
  const scheduleRef = db.doc(`cfps/${cfpId}/config/schedule`);
  const updateRequestRef = profileUpdateRequestRef(db, cfpId, proposalId, speakerUid);
  const now = Timestamp.now();
  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, profile, form, confirmation, schedule, currentRequest] = await tx.getAll(
      cfpRef,
      proposalRef,
      profileRef,
      formRef,
      confirmationRef,
      scheduleRef,
      updateRequestRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true || cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is read-only.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    if (!['accepted', 'confirmed'].includes(String(proposal.get('status') ?? ''))) {
      throw new HttpsError(
        'failed-precondition',
        'This session no longer accepts profile update completion.',
      );
    }
    const activeSpeakerIds = Array.isArray(proposal.get('speakerIds'))
      ? (proposal.get('speakerIds') as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && Boolean(uid),
        )
      : [];
    if (!activeSpeakerIds.includes(speakerUid)) {
      throw new HttpsError('permission-denied', 'You are not an active speaker on this session.');
    }
    if (!speakerHasConfirmed(proposal, confirmation)) {
      throw new HttpsError(
        'failed-precondition',
        'Confirm this session before completing a later profile update request.',
      );
    }
    const current = requestStateFrom(currentRequest);
    if (!current || current.requestId !== requestId) {
      throw new HttpsError('failed-precondition', 'That profile update request is no longer current.');
    }
    assertRequestBinding(currentRequest, cfpId, proposalId, speakerUid);
    if (current.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This profile update request was cancelled.');
    }
    if (current.status === 'resolved') {
      return { changed: false, request: current, remainingScopes: [] as SpeakerProfileUpdateScope[] };
    }

    const snapshots = proposal.get('speakerSnapshot');
    const stored = Array.isArray(snapshots)
      ? snapshots.find(
          (entry) => entry && typeof entry === 'object' && entry.uid === speakerUid,
        )
      : null;
    const parsedProfile = profile.exists ? speakerSchema.safeParse(profile.data()) : null;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !parsedProfile?.success) {
      throw new HttpsError(
        'failed-precondition',
        'Complete and adopt the speaker profile before finishing this request.',
      );
    }

    const ready: SpeakerProfileUpdateScope[] = [];
    if (
      current.scopes.includes('profile') &&
      speakerProfilePreviewChanges(
        speakerProfilePreviewFrom(stored, true),
        speakerProfilePreviewFrom(parsedProfile.data, true),
      ).length === 0
    ) {
      ready.push('profile');
    }
    if (current.scopes.includes('photo')) {
      const configuredForm = confirmFormFromData(form.data());
      if (!configuredForm.speakerPhoto) {
        throw new HttpsError(
          'failed-precondition',
          'This event no longer accepts programme speaker photos.',
        );
      }
      const frozenPhoto = confirmedSpeakerPhotoFrom(
        usesPerSpeakerLifecycle(proposal.data()!)
          ? confirmation.get('speakerPhoto')
          : proposal.get('speakerPhoto'),
        cfpId,
        proposalId,
        speakerUid,
      );
      const profilePhoto = speakerProfilePhotoFrom(profile.get('profilePhoto'), speakerUid);
      const photoMatches = Boolean(
        frozenPhoto &&
        profilePhoto &&
        frozenPhoto.sourceGeneration === profilePhoto.generation,
      );
      const optionalAndBothAbsent =
        configuredForm.speakerPhoto.required === false && !frozenPhoto && !profilePhoto;
      if (photoMatches || optionalAndBothAbsent) ready.push('photo');
    }

    const resolvedScopes = completedProfileUpdateScopes(current, ready);
    const remainingScopes = current.scopes.filter((scope) => !resolvedScopes.includes(scope));
    const changed = resolvedScopes.length !== current.resolvedScopes.length;
    if (!changed && remainingScopes.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        'Update and adopt the requested profile sections before completing this request.',
        { reason: 'profile-update-not-ready', remainingScopes },
      );
    }
    const complete = remainingScopes.length === 0;
    const next: SpeakerProfileUpdateRequestState = {
      ...current,
      status: complete ? 'resolved' : 'pending',
      resolvedScopes,
      ...(complete ? { resolvedAt: now } : {}),
    };
    tx.update(updateRequestRef, {
      resolvedScopes,
      status: next.status,
      updatedAt: now,
      ...(ready.includes('profile') && !current.resolvedScopes.includes('profile')
        ? { profileResolvedAt: now }
        : {}),
      ...(ready.includes('photo') && !current.resolvedScopes.includes('photo')
        ? { photoResolvedAt: now }
        : {}),
      ...(complete ? { resolvedAt: now, resolvedBy: speakerUid } : {}),
    });
    if (complete && schedule.exists) {
      tx.set(
        scheduleRef,
        { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    return { changed, request: next, remainingScopes };
  });
  logger.info('proposal speaker profile update completed', {
    cfpId,
    proposalId,
    speakerUid,
    requestId,
    changed: result.changed,
    remainingScopes: result.remainingScopes,
  });
  return { ok: true, ...result };
});

/**
 * Explicitly replaces one active speaker's proposal copy from their profile.
 * Existing schedule releases are immutable; a configured working schedule is
 * only marked stale so an organiser can review and share it deliberately.
 */
export const refreshProposalSpeakerSnapshot = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId, speakerUid } = requireInput(request.data);
  const { expectedCurrentFingerprint, expectedLatestFingerprint } =
    requireExpectedFingerprints(request.data);
  const targetUid = speakerUid ?? identity.uid;
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const profileRef = db.doc(`speakers/${targetUid}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const scheduleRef = db.doc(`cfps/${cfpId}/config/schedule`);

  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, profile, member, schedule] = await tx.getAll(
      cfpRef,
      proposalRef,
      profileRef,
      memberRef,
      scheduleRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');

    const ids = proposal.get('speakerIds');
    const activeSpeakerIds = Array.isArray(ids)
      ? ids.filter((uid): uid is string => typeof uid === 'string' && Boolean(uid))
      : [];
    const own = targetUid === identity.uid;
    if (!own && !isEventAdmin(member)) {
      throw new HttpsError(
        'permission-denied',
        'Only an event admin can update another speaker\'s session profile.',
      );
    }
    if (!activeSpeakerIds.includes(targetUid)) {
      throw new HttpsError(
        own ? 'permission-denied' : 'failed-precondition',
        'That account is not an active speaker.',
      );
    }
    const status = String(proposal.get('status') ?? '');
    if (!REFRESHABLE_STATUSES.has(status)) {
      throw new HttpsError(
        'failed-precondition',
        'A submitted, active proposal is required before its speaker copy can be refreshed.',
      );
    }
    const current = proposal.get('speakerSnapshot');
    if (!Array.isArray(current)) {
      throw new HttpsError('failed-precondition', 'This proposal has no submitted speaker copy.');
    }
    const index = current.findIndex(
      (entry) => entry && typeof entry === 'object' && entry.uid === targetUid,
    );
    if (index < 0) {
      throw new HttpsError('failed-precondition', 'This proposal has no copy for that speaker.');
    }
    const parsedProfile = profile.exists ? speakerSchema.safeParse(profile.data()) : null;
    if (!parsedProfile?.success) {
      throw new HttpsError(
        'failed-precondition',
        'Complete the speaker profile before updating the session copy.',
      );
    }

    const currentPreview = speakerProfilePreviewFrom(current[index], own);
    const latestPreview = speakerProfilePreviewFrom(parsedProfile.data, own);
    const currentFingerprint = speakerProfilePreviewFingerprint(currentPreview);
    const latestFingerprint = speakerProfilePreviewFingerprint(latestPreview);
    if (
      currentFingerprint !== expectedCurrentFingerprint ||
      latestFingerprint !== expectedLatestFingerprint
    ) {
      throw new HttpsError(
        'aborted',
        'The session or account profile changed after the preview. Review it again.',
        { reason: 'profile-preview-stale' },
      );
    }
    const refreshed = speakerSnapshotFrom(targetUid, parsedProfile.data);
    const stored = current[index] as Record<string, unknown>;
    const snapshot = own
      ? refreshed
      : { ...refreshed, basedIn: safeString(stored.basedIn) };
    const changed = speakerProfilePreviewChanges(currentPreview, latestPreview).length > 0;
    if (changed) {
      const next = [...current];
      next[index] = snapshot;
      tx.update(proposalRef, { speakerSnapshot: next });
      if (schedule.exists) {
        tx.set(
          scheduleRef,
          { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    }
    return {
      changed,
      speakerUid: targetUid,
      snapshot,
      currentFingerprint: latestFingerprint,
      latestFingerprint,
      scheduleNeedsAttention: changed && schedule.exists,
    };
  });

  logger.info('proposal speaker snapshot refreshed', {
    cfpId,
    proposalId,
    speakerUid: targetUid,
    byUid: identity.uid,
    changed: result.changed,
    scheduleNeedsAttention: result.scheduleNeedsAttention,
  });
  return { ok: true, ...result };
});
