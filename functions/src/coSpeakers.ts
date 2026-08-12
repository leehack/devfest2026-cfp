import { createHash, randomUUID } from 'node:crypto';

import { getFirestore, FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { validateCfpId } from '../../shared/cfp';
import { acksSchemaFor, attendanceSchema, speakerSchema } from '../../shared/schema';
import { mergeSubmissionForm } from '../../shared/submissionForm';
import {
  MAX_ACTIVE_SPEAKERS,
  MAX_SPEAKER_INVITATION_HISTORY,
  POST_ACCEPTANCE_INVITATION_TTL_MS,
  maskSpeakerEmail,
  normaliseSpeakerEmail,
  primarySpeakerIdOf,
  speakerInvitationPhaseOf,
  type ProposalSpeakerRoster,
  type SpeakerInvitationPhase,
  type SpeakerInvitationSummary,
  type SpeakerInvitationStatus,
  type SpeakerRosterItem,
} from '../../shared/coSpeakers';
import type { SpeakerSnapshot } from '../../shared/types';
import {
  logId,
  queueEmail,
  sendingLeaseExpired,
  staffMemberIsActive,
} from './email';
import {
  coSpeakerInvitationStillTrue,
  currentScheduleReleaseContainsProposal,
  usesPerSpeakerLifecycle,
} from './speakerLifecycle';
import {
  cancelPendingProfileUpdateRequest,
  profileUpdateRequestRef,
  speakerSnapshotFrom,
} from './profileSnapshots';

const CALLABLE = { region: 'northamerica-northeast1', maxInstances: 10 } as const;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const INVITATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;
const INVITES_PER_SPEAKER_WINDOW = 20;
const INVITES_PER_RECIPIENT_WINDOW = 5;
const INVITATION_UNAVAILABLE = { reason: 'co_speaker_invitation_unavailable' } as const;
const INVITATION_REVIEWER_CONFLICT = {
  reason: 'co_speaker_invitation_reviewer_conflict',
} as const;

/** Clears terminal timestamps before the trigger records the next attempt. */
export function coSpeakerInvitationRetryEmailUpdate() {
  return {
    status: 'queued',
    sendingClaimId: FieldValue.delete(),
    sendingStartedAt: FieldValue.delete(),
    attemptedAt: FieldValue.delete(),
    sentAt: FieldValue.delete(),
    providerId: FieldValue.delete(),
    error: FieldValue.delete(),
    errorReason: FieldValue.delete(),
    retryRequestedAt: FieldValue.serverTimestamp(),
  };
}

interface Identity {
  uid: string;
  email: string;
}

function requireIdentity(request: {
  auth?: { uid: string; token?: { email?: unknown; email_verified?: unknown } };
}): Identity {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const email = normaliseSpeakerEmail(request.auth?.token?.email);
  if (request.auth?.token?.email_verified !== true || !email) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return { uid, email };
}

function requireIds(data: unknown): {
  cfpId: string;
  proposalId: string;
  invitationId?: string;
} {
  const input = (data ?? {}) as Record<string, unknown>;
  const cfpId = typeof input.cfpId === 'string' ? input.cfpId : '';
  const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
  if (validateCfpId(cfpId) !== null || !DOCUMENT_ID.test(proposalId)) {
    throw new HttpsError('invalid-argument', 'A valid CFP and proposal are required.');
  }
  const invitationId = input.invitationId;
  if (invitationId !== undefined && (typeof invitationId !== 'string' || !INVITATION_ID.test(invitationId))) {
    throw new HttpsError('invalid-argument', 'A valid invitation is required.');
  }
  return { cfpId, proposalId, ...(typeof invitationId === 'string' ? { invitationId } : {}) };
}

function invitationIdFrom(data: unknown): string {
  const invitationId = requireIds(data).invitationId;
  if (!invitationId) throw new HttpsError('invalid-argument', 'A valid invitation is required.');
  return invitationId;
}

function isOpen(cfp: DocumentSnapshot, now = Date.now()): boolean {
  const opensAt = cfp.get('opensAt');
  const closesAt = cfp.get('closesAt');
  return (
    cfp.exists &&
    cfp.get('archived') !== true &&
    cfp.get('deleting') !== true &&
    cfp.get('paused') !== true &&
    opensAt instanceof Timestamp &&
    closesAt instanceof Timestamp &&
    now >= opensAt.toMillis() &&
    now < closesAt.toMillis()
  );
}

function assertOpen(cfp: DocumentSnapshot, details?: Record<string, string>): void {
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfp.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.', details);
  }
  if (cfp.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.', details);
  }
  if (cfp.get('paused') === true) {
    throw new HttpsError('failed-precondition', 'The CFP is currently paused.', details);
  }
  const opensAt = cfp.get('opensAt');
  const closesAt = cfp.get('closesAt');
  if (!(opensAt instanceof Timestamp) || !(closesAt instanceof Timestamp)) {
    throw new HttpsError('failed-precondition', 'The CFP submission window is unavailable.', details);
  }
  const now = Date.now();
  if (now < opensAt.toMillis()) {
    throw new HttpsError('failed-precondition', 'The CFP has not opened yet.', details);
  }
  if (now >= closesAt.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'The CFP has closed.', details);
  }
}

function assertActive(cfp: DocumentSnapshot, details?: Record<string, string>): void {
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfp.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.', details);
  }
  if (cfp.get('archived') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is archived.', details);
  }
}

function assertLateInvitationWindow(cfp: DocumentSnapshot, details?: Record<string, string>): void {
  assertActive(cfp, details);
  if (cfp.get('paused') === true) {
    throw new HttpsError('failed-precondition', 'The CFP is currently paused.', details);
  }
}

function postAcceptanceStatus(proposal: DocumentSnapshot): boolean {
  return proposal.get('status') === 'accepted' || proposal.get('status') === 'confirmed';
}

function speakerIdsOf(proposal: DocumentSnapshot): string[] {
  const ids = proposal.get('speakerIds');
  return Array.isArray(ids) ? ids.filter((uid): uid is string => typeof uid === 'string' && Boolean(uid)) : [];
}

function roleAllowsManagement(
  member: DocumentSnapshot,
  cfpId: string,
  uid: string,
): boolean {
  return (
    staffMemberIsActive(member.data(), cfpId, uid) &&
    (member.get('role') === 'admin' || member.get('role') === 'owner')
  );
}

function assertDraft(proposal: DocumentSnapshot, details?: Record<string, string>): void {
  if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
  if (proposal.get('status') !== 'draft') {
    throw new HttpsError(
      'failed-precondition',
      'Co-speakers can only be changed while the proposal is a draft.',
      details,
    );
  }
}

function primaryOf(proposal: DocumentSnapshot): string {
  const primary = primarySpeakerIdOf(proposal.data() ?? {});
  if (!primary || !speakerIdsOf(proposal).includes(primary)) {
    throw new HttpsError('failed-precondition', 'The proposal has no valid primary speaker.');
  }
  return primary;
}

function invitationPhase(invitation: DocumentSnapshot): SpeakerInvitationPhase | null {
  return speakerInvitationPhaseOf(invitation.data() ?? {});
}

function canManage(
  identity: Identity,
  cfpId: string,
  proposal: DocumentSnapshot,
  member: DocumentSnapshot,
): boolean {
  if (identity.uid === primaryOf(proposal)) return true;
  return (
    proposal.get('status') !== 'draft' &&
    roleAllowsManagement(member, cfpId, identity.uid)
  );
}

function invitationHasExpired(invitation: DocumentSnapshot, now = Date.now()): boolean {
  const expiresAt = invitation.get('expiresAt');
  return !(expiresAt instanceof Timestamp) || now >= expiresAt.toMillis();
}

function invitationRef(cfpId: string, proposalId: string, invitationId: string) {
  return getFirestore().doc(
    `cfps/${cfpId}/proposals/${proposalId}/speakerInvitations/${invitationId}`,
  );
}

function invitationRateRef(kind: 'speaker' | 'recipient', value: string) {
  const id = createHash('sha256').update(`${kind}:${value}`).digest('hex');
  return getFirestore().doc(`speakerInvitationLimits/${id}`);
}

function nextInvitationRate(
  snap: DocumentSnapshot,
  limit: number,
  now: number,
): { windowStart: number; count: number } {
  const startedAt = Number(snap.get('windowStart') ?? 0);
  const fresh = !Number.isFinite(startedAt) || now - startedAt >= INVITE_RATE_WINDOW_MS;
  const used = fresh ? 0 : Number(snap.get('count') ?? 0);
  if (!Number.isFinite(used) || used < 0 || used >= limit) {
    throw new HttpsError('resource-exhausted', 'Too many co-speaker invitations. Try again later.');
  }
  return { windowStart: fresh ? now : startedAt, count: used + 1 };
}

function participantRef(cfpId: string, proposalId: string, uid: string) {
  return getFirestore().doc(
    `cfps/${cfpId}/proposals/${proposalId}/speakerParticipants/${uid}`,
  );
}

function invitationEmailRef(cfpId: string, proposalId: string, invitationId: string) {
  return getFirestore().doc(
    `cfps/${cfpId}/emailLog/${logId(
      'co_speaker_invited',
      proposalId,
      invitationId,
    )}`,
  );
}

async function rosterFor(
  cfpId: string,
  proposalId: string,
  identity: Identity,
): Promise<ProposalSpeakerRoster> {
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const [cfp, proposal, member, invitations, participants, confirmations, formSnap] = await Promise.all([
    db.doc(`cfps/${cfpId}`).get(),
    proposalRef.get(),
    db.doc(`cfps/${cfpId}/members/${identity.uid}`).get(),
    proposalRef.collection('speakerInvitations').get(),
    proposalRef.collection('speakerParticipants').get(),
    proposalRef.collection('speakerConfirmations').get(),
    db.doc(`cfps/${cfpId}/config/submissionForm`).get(),
  ]);
  if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
  const speakerIds = speakerIdsOf(proposal);
  const primarySpeakerId = primaryOf(proposal);
  const isPrimary = identity.uid === primarySpeakerId;
  const isAdmin = roleAllowsManagement(member, cfpId, identity.uid);
  const managerIdentity =
    isPrimary ||
    (proposal.get('status') !== 'draft' && isAdmin);
  if (!managerIdentity && !speakerIds.includes(identity.uid)) {
    throw new HttpsError('not-found', 'Proposal not found.');
  }
  const draft = proposal.get('status') === 'draft';
  const profiles = draft && speakerIds.length
    ? await db.getAll(...speakerIds.map((uid) => db.doc(`speakers/${uid}`)))
    : [];
  const snapshots = new Map(
    ((proposal.get('speakerSnapshot') ?? []) as SpeakerSnapshot[]).map((speaker) => [speaker.uid, speaker]),
  );
  const participantByUid = new Map(participants.docs.map((participant) => [participant.id, participant]));
  const confirmationByUid = new Map(
    confirmations.docs.map((confirmation) => [confirmation.id, confirmation]),
  );
  const form = mergeSubmissionForm(formSnap.exists ? formSnap.data() : undefined);
  const items: SpeakerRosterItem[] = speakerIds.map((uid, index) => {
    const profile = draft ? profiles[index] : undefined;
    const snapshot = snapshots.get(uid);
    const participant = participantByUid.get(uid);
    const acks = participant?.get('acks') ?? (uid === primarySpeakerId ? proposal.get('acks') : undefined);
    const attendance =
      participant?.get('attendance') ?? (uid === primarySpeakerId ? proposal.get('attendance') : undefined);
    const storedResponse = confirmationByUid.get(uid)?.get('response');
    const response =
      storedResponse === 'confirmed' || storedResponse === 'declined'
        ? storedResponse
        : !usesPerSpeakerLifecycle(proposal.data() ?? {}) && uid === primarySpeakerId &&
            (proposal.get('status') === 'confirmed' || proposal.get('status') === 'declined')
          ? proposal.get('status')
          : undefined;
    const removableUnconfirmedSpeaker =
      isAdmin &&
      proposal.get('status') === 'accepted' &&
      response === undefined &&
      cfp.get('archived') !== true &&
      cfp.get('deleting') !== true;
    return {
      kind: 'active',
      state: 'active',
      uid,
      role: uid === primarySpeakerId ? 'primary' : 'coSpeaker',
      name: String((draft ? profile?.get('name') : undefined) ?? snapshot?.name ?? ''),
      ...(draft && isPrimary && profile?.get('email') ? { email: String(profile.get('email')) } : {}),
      profileComplete: draft
        ? profile?.exists === true && speakerSchema.safeParse(profile.data()).success
        : Boolean(snapshot?.name),
      detailsComplete:
        acksSchemaFor(form).safeParse(acks).success && attendanceSchema.safeParse(attendance).success,
      confirmationState:
        response === 'confirmed' || response === 'declined' ? response : 'none',
      canRemove:
        uid !== primarySpeakerId &&
        (((managerIdentity || uid === identity.uid) &&
          proposal.get('status') === 'draft' &&
          isOpen(cfp)) ||
          (managerIdentity &&
            (response === 'declined' ||
              removableUnconfirmedSpeaker) &&
            cfp.get('archived') !== true &&
            cfp.get('deleting') !== true)),
      isCurrentUser: uid === identity.uid,
    };
  });
  const setupOpen = draft && isOpen(cfp);
  const lateInvitationOpen =
    postAcceptanceStatus(proposal) &&
    cfp.exists &&
    cfp.get('archived') !== true &&
    cfp.get('deleting') !== true &&
    cfp.get('paused') !== true;
  const canInvite = (draft && isPrimary && setupOpen) || (!draft && isAdmin && lateInvitationOpen);
  const invitePhase: SpeakerInvitationPhase | null = canInvite
    ? draft
      ? 'draft'
      : 'postAcceptance'
    : null;
  const visibleInvitations = invitations.docs.filter((invitation) => {
    const phase = invitationPhase(invitation);
    if (draft) return isPrimary && phase === 'draft' && invitation.get('status') !== 'accepted';
    return (
      (isPrimary || isAdmin) &&
      phase === 'postAcceptance' &&
      invitation.get('status') === 'pending' &&
      !invitationHasExpired(invitation)
    );
  });
  if (visibleInvitations.length) {
    const deliveryRows = visibleInvitations.length
      ? await db.getAll(
          ...visibleInvitations.map((invitation) =>
            invitationEmailRef(cfpId, proposalId, invitation.id),
          ),
        )
      : [];
    for (const [index, invitation] of visibleInvitations.entries()) {
      const state = invitation.get('status') as SpeakerInvitationStatus;
      const phase = invitationPhase(invitation);
      if (!phase) continue;
      const email = String(invitation.get('email') ?? '');
      const delivery = deliveryRows[index];
      const storedDelivery = String(delivery?.get('status') ?? '');
      const expiredSending =
        storedDelivery === 'sending' &&
        sendingLeaseExpired(delivery?.get('sendingStartedAt') ?? delivery?.updateTime);
      const deliveryState =
        storedDelivery === 'sent'
          ? 'sent'
          : storedDelivery === 'queued'
            ? 'queued'
            : storedDelivery === 'sending' && !expiredSending
              ? 'sending'
              : 'notDelivered';
      items.push({
        kind: 'invitation',
        state,
        invitationId: invitation.id,
        phase,
        role: 'coSpeaker',
        name: email,
        email,
        deliveryState,
        canRetryDelivery:
          state === 'pending' &&
          canInvite &&
          invitePhase === phase &&
          deliveryState === 'notDelivered' &&
          Number(delivery?.get('attempts') ?? 0) < 5,
        isCurrentUser: email === identity.email,
      });
    }
  }
  const pendingBlocksSubmit =
    setupOpen &&
    (invitations.docs.some(
      (invite) =>
        invitationPhase(invite) === 'draft' && invite.get('status') === 'pending',
    ) ||
      items.some(
        (item) =>
          item.kind === 'active' &&
          item.role === 'coSpeaker' &&
          (!item.profileComplete || !item.detailsComplete),
      ));
  return {
    cfpId,
    proposalId,
    primarySpeakerId,
    canManage: managerIdentity && proposal.get('status') === 'draft' && isOpen(cfp),
    canInvite,
    invitePhase,
    canEditTalk: identity.uid === primarySpeakerId,
    usesPersonalLifecycle: usesPerSpeakerLifecycle(proposal.data() ?? {}),
    setupOpen,
    confirmationOpen: ['accepted', 'confirmed', 'declined'].includes(
      String(proposal.get('status') ?? ''),
    ),
    pendingBlocksSubmit,
    items,
  };
}

export const getProposalRoster = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  return { ok: true, roster: await rosterFor(cfpId, proposalId, identity) };
});

export const inviteCoSpeaker = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const email = normaliseSpeakerEmail((request.data as { email?: unknown } | undefined)?.email);
  if (!email) throw new HttpsError('invalid-argument', 'Enter a usable email address.');
  if (email === identity.email) {
    throw new HttpsError('already-exists', 'You are already the primary speaker.');
  }
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const newInvitationId = randomUUID();
  const newInvitationRef = invitationRef(cfpId, proposalId, newInvitationId);
  const speakerRateRef = invitationRateRef('speaker', identity.uid);
  const recipientRateRef = invitationRateRef('recipient', email);

  await db.runTransaction(async (tx) => {
    const [cfp, proposal, member] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      proposalRef,
      db.doc(`cfps/${cfpId}/members/${identity.uid}`),
    );
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    const phase: SpeakerInvitationPhase = proposal.get('status') === 'draft'
      ? 'draft'
      : postAcceptanceStatus(proposal)
        ? 'postAcceptance'
        : (() => {
            throw new HttpsError(
              'failed-precondition',
              'Co-speakers can only be invited before submission or after acceptance.',
            );
          })();
    if (phase === 'draft') {
      assertOpen(cfp);
      if (!canManage(identity, cfpId, proposal, member)) {
        throw new HttpsError(
          'permission-denied',
          'Only the lead speaker can invite a co-speaker, and only while the proposal is a draft.',
        );
      }
    } else {
      assertLateInvitationWindow(cfp);
      if (!roleAllowsManagement(member, cfpId, identity.uid)) {
        throw new HttpsError(
          'permission-denied',
          'Only an event admin can invite a co-speaker after acceptance.',
        );
      }
    }
    const primarySpeakerId = primaryOf(proposal);
    const primaryParticipant = await tx.get(participantRef(cfpId, proposalId, primarySpeakerId));
    const invitations = await tx.get(proposalRef.collection('speakerInvitations'));
    const activeProfiles = await tx.getAll(
      ...speakerIdsOf(proposal).map((uid) => db.doc(`speakers/${uid}`)),
    );
    const [speakerRate, recipientRate] = await tx.getAll(speakerRateRef, recipientRateRef);
    const title = String(proposal.get('title') ?? '').trim();
    const primaryIndex = speakerIdsOf(proposal).indexOf(primarySpeakerId);
    const frozenSpeakers = proposal.get('speakerSnapshot');
    const primaryName = String(
      phase === 'postAcceptance'
        ? (Array.isArray(frozenSpeakers)
            ? (frozenSpeakers as SpeakerSnapshot[]).find(
                (speaker) => speaker.uid === primarySpeakerId,
              )?.name
            : '')
        : activeProfiles[primaryIndex]?.get('name'),
    ).trim();
    if (!title || !primaryName) {
      throw new HttpsError(
        'failed-precondition',
        'Add the proposal title and complete the lead speaker profile before inviting someone.',
      );
    }
    if (
      activeProfiles.some((profile) => normaliseSpeakerEmail(profile.get('email')) === email) ||
      invitations.docs.some(
        (invite) =>
          invite.get('email') === email &&
          invite.get('status') === 'pending' &&
          !invitationHasExpired(invite),
      )
    ) {
      throw new HttpsError('already-exists', 'That person is already invited.');
    }
    if (invitations.size >= MAX_SPEAKER_INVITATION_HISTORY) {
      throw new HttpsError('resource-exhausted', 'This proposal has reached its invitation history limit.');
    }
    const pendingCount = invitations.docs.filter(
      (invite) => invite.get('status') === 'pending' && !invitationHasExpired(invite),
    ).length;
    if (speakerIdsOf(proposal).length + pendingCount >= MAX_ACTIVE_SPEAKERS) {
      throw new HttpsError('resource-exhausted', `A proposal can have at most ${MAX_ACTIVE_SPEAKERS} speakers.`);
    }
    const now = Date.now();
    const nextSpeakerRate = nextInvitationRate(
      speakerRate,
      INVITES_PER_SPEAKER_WINDOW,
      now,
    );
    const nextRecipientRate = nextInvitationRate(
      recipientRate,
      INVITES_PER_RECIPIENT_WINDOW,
      now,
    );

    const invitationFields = { invitationId: newInvitationId, invitationEmail: email };
    const emailRequest = {
      kind: 'co_speaker_invited' as const,
      proposalId,
      dedupeKey: newInvitationId,
      to: email,
      locale: 'en' as const,
      bilingual: true,
      data: {
        speakerName: email,
        title,
        needsVisa: false,
      },
      ...invitationFields,
    };
    await queueEmail(db, tx, cfpId, emailRequest);
    tx.set(speakerRateRef, {
      ...nextSpeakerRate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(recipientRateRef, {
      ...nextRecipientRate,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (phase === 'draft' && !primaryParticipant.exists) {
      tx.create(primaryParticipant.ref, {
        cfpId,
        proposalId,
        uid: primarySpeakerId,
        role: 'primary',
        status: 'active',
        ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'acks')
          ? { acks: proposal.get('acks') }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'attendance')
          ? { attendance: proposal.get('attendance') }
          : {}),
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (phase === 'draft') {
      tx.set(
        primaryParticipant.ref,
        {
          ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'acks')
            ? { acks: proposal.get('acks') }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'attendance')
            ? { attendance: proposal.get('attendance') }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    if (phase === 'draft') {
      tx.update(proposalRef, {
        primarySpeakerId,
        ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'acks')
          ? { acks: FieldValue.delete() }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(proposal.data() ?? {}, 'attendance')
          ? { attendance: FieldValue.delete() }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Make invite creation conflict with a simultaneous committee decision.
      tx.update(proposalRef, { updatedAt: FieldValue.serverTimestamp() });
    }
    tx.create(newInvitationRef, {
      cfpId,
      proposalId,
      invitationId: newInvitationId,
      email,
      phase,
      status: 'pending',
      expiresAt:
        phase === 'draft'
          ? cfp.get('closesAt')
          : Timestamp.fromMillis(Date.now() + POST_ACCEPTANCE_INVITATION_TTL_MS),
      createdBy: identity.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    ok: true,
    invitationId: newInvitationId,
    roster: await rosterFor(cfpId, proposalId, identity),
  };
});

export const retryCoSpeakerInvitation = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const invitationId = invitationIdFrom(request.data);
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const emailRef = invitationEmailRef(cfpId, proposalId, invitationId);

  await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, invitation, delivery] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      proposalRef,
      db.doc(`cfps/${cfpId}/members/${identity.uid}`),
      invitationRef(cfpId, proposalId, invitationId),
      emailRef,
    );
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    if (!invitation.exists) throw new HttpsError('not-found', 'Invitation not found.');
    const phase = invitationPhase(invitation);
    if (phase === 'draft') {
      assertOpen(cfp);
      assertDraft(proposal);
      if (!canManage(identity, cfpId, proposal, member)) {
        throw new HttpsError(
          'permission-denied',
          'Only the lead speaker can retry a draft co-speaker invitation.',
        );
      }
    } else if (phase === 'postAcceptance') {
      assertLateInvitationWindow(cfp);
      if (!postAcceptanceStatus(proposal)) {
        throw new HttpsError('failed-precondition', 'This invitation is no longer current.');
      }
      if (!roleAllowsManagement(member, cfpId, identity.uid)) {
        throw new HttpsError(
          'permission-denied',
          'Only an event admin can retry a post-acceptance co-speaker invitation.',
        );
      }
    } else {
      throw new HttpsError('failed-precondition', 'This invitation is no longer current.');
    }
    const email = normaliseSpeakerEmail(invitation.get('email'));
    if (
      !email ||
      !coSpeakerInvitationStillTrue(
        'co_speaker_invited',
        invitationId,
        cfpId,
        proposalId,
        email,
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

    const status = String(delivery.get('status') ?? '');
    const expiredSending =
      status === 'sending' &&
      sendingLeaseExpired(delivery.get('sendingStartedAt') ?? delivery.updateTime);
    if (delivery.exists && ['queued', 'sent'].includes(status)) return;
    if (delivery.exists && status === 'sending' && !expiredSending) return;
    if (Number(delivery.get('attempts') ?? 0) >= 5) {
      throw new HttpsError(
        'resource-exhausted',
        'This invitation has reached its delivery-attempt limit.',
      );
    }

    const speakerRateRef = invitationRateRef('speaker', identity.uid);
    const recipientRateRef = invitationRateRef('recipient', email);
    const [speakerRate, recipientRate] = await tx.getAll(speakerRateRef, recipientRateRef);
    const now = Date.now();
    const nextSpeakerRate = nextInvitationRate(
      speakerRate,
      INVITES_PER_SPEAKER_WINDOW,
      now,
    );
    const nextRecipientRate = nextInvitationRate(
      recipientRate,
      INVITES_PER_RECIPIENT_WINDOW,
      now,
    );
    if (!delivery.exists) {
      await queueEmail(db, tx, cfpId, {
        kind: 'co_speaker_invited',
        proposalId,
        dedupeKey: invitationId,
        to: email,
        locale: 'en',
        bilingual: true,
        invitationId,
        invitationEmail: email,
        data: {
          speakerName: email,
          title: String(proposal.get('title') ?? ''),
          needsVisa: false,
        },
      });
    } else {
      tx.update(emailRef, coSpeakerInvitationRetryEmailUpdate());
    }
    tx.set(speakerRateRef, {
      ...nextSpeakerRate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(recipientRateRef, {
      ...nextRecipientRate,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, roster: await rosterFor(cfpId, proposalId, identity) };
});

export const getCoSpeakerInvitation = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const invitationId = invitationIdFrom(request.data);
  const db = getFirestore();
  const [cfp, proposal, invitation, profile, formSnap] = await Promise.all([
    db.doc(`cfps/${cfpId}`).get(),
    db.doc(`cfps/${cfpId}/proposals/${proposalId}`).get(),
    invitationRef(cfpId, proposalId, invitationId).get(),
    db.doc(`speakers/${identity.uid}`).get(),
    db.doc(`cfps/${cfpId}/config/submissionForm`).get(),
  ]);
  if (!cfp.exists || !proposal.exists || !invitation.exists) {
    throw new HttpsError('not-found', 'Invitation not found.');
  }
  const email = String(invitation.get('email') ?? '');
  const matchesSignedInEmail = email === identity.email;
  const phase = invitationPhase(invitation);
  if (!phase) throw new HttpsError('not-found', 'Invitation not found.');
  const storedState = invitation.get('status') as SpeakerInvitationStatus;
  const acceptedSpeakerStillActive =
    storedState !== 'accepted' ||
    speakerIdsOf(proposal).includes(String(invitation.get('respondedBy') ?? ''));
  const state =
    !acceptedSpeakerStillActive
      ? 'unavailable'
      : storedState !== 'pending'
      ? storedState
      : cfp.get('deleting') === true
        ? 'unavailable'
        : invitationHasExpired(invitation)
          ? 'expired'
          : cfp.get('paused') === true
            ? 'paused'
            : cfp.get('archived') === true
              ? 'unavailable'
              : phase === 'draft'
                ? proposal.get('status') === 'draft' && isOpen(cfp)
                  ? 'pending'
                  : 'expired'
                : postAcceptanceStatus(proposal)
                  ? 'pending'
                  : 'unavailable';
  const canViewInvitation = matchesSignedInEmail && state === 'pending';
  const primarySpeakerId = primaryOf(proposal);
  const primaryProfile = canViewInvitation && phase === 'draft'
    ? await db.doc(`speakers/${primarySpeakerId}`).get()
    : null;
  const primarySnapshot = ((proposal.get('speakerSnapshot') ?? []) as SpeakerSnapshot[]).find(
    (speaker) => speaker.uid === primarySpeakerId,
  );
  const form = mergeSubmissionForm(formSnap.exists ? formSnap.data() : undefined);
  const optionLabel = (key: 'category' | 'format' | 'level' | 'deliveryLanguage') =>
    form[key].find((option) => option.value === proposal.get(key))?.label ?? {
      en: String(proposal.get(key) ?? ''),
    };
  const summary: SpeakerInvitationSummary = {
    cfpId,
    proposalId,
    invitationId,
    phase,
    eventName: String(cfp.get('name') ?? cfpId),
    title: canViewInvitation ? String(proposal.get('title') ?? '') : '',
    primaryName: canViewInvitation
      ? String(primaryProfile?.get('name') ?? primarySnapshot?.name ?? '')
      : '',
    invitedEmail: matchesSignedInEmail ? email : maskSpeakerEmail(email),
    state,
    matchesSignedInEmail,
    canRespond: matchesSignedInEmail && state === 'pending',
    needsProfile:
      canViewInvitation && (!profile.exists || !speakerSchema.safeParse(profile.data()).success),
    ...(canViewInvitation && phase === 'postAcceptance'
      ? { participation: { acknowledgements: form.acks } }
      : {}),
    ...(canViewInvitation
      ? {
          talk: {
            abstract: String(proposal.get('abstract') ?? ''),
            category: optionLabel('category'),
            format: optionLabel('format'),
            level: optionLabel('level'),
            deliveryLanguage: optionLabel('deliveryLanguage'),
          },
        }
      : {}),
  };
  return { ok: true, invitation: summary };
});

export const respondToCoSpeakerInvitation = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const invitationId = invitationIdFrom(request.data);
  const input = (request.data ?? {}) as {
    response?: unknown;
    acks?: unknown;
    attendance?: unknown;
  };
  const response = String(input.response ?? '');
  if (response !== 'accept' && response !== 'decline') {
    throw new HttpsError('invalid-argument', 'Response must be accept or decline.');
  }
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  let accepted = false;
  await db.runTransaction(async (tx) => {
    const [cfp, proposal, invitation, profile, formSnap] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      proposalRef,
      invitationRef(cfpId, proposalId, invitationId),
      db.doc(`speakers/${identity.uid}`),
      db.doc(`cfps/${cfpId}/config/submissionForm`),
    );
    if (!invitation.exists || invitation.get('email') !== identity.email) {
      throw new HttpsError('not-found', 'Invitation not found for this account.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    const phase = invitationPhase(invitation);
    if (phase === 'draft') {
      assertOpen(cfp, INVITATION_UNAVAILABLE);
      assertDraft(proposal, INVITATION_UNAVAILABLE);
    } else if (phase === 'postAcceptance') {
      assertLateInvitationWindow(cfp, INVITATION_UNAVAILABLE);
      if (!postAcceptanceStatus(proposal)) {
        throw new HttpsError(
          'failed-precondition',
          'This invitation is no longer current.',
          INVITATION_UNAVAILABLE,
        );
      }
    } else {
      throw new HttpsError(
        'failed-precondition',
        'This invitation is no longer current.',
        INVITATION_UNAVAILABLE,
      );
    }
    if (invitationHasExpired(invitation)) {
      throw new HttpsError(
        'deadline-exceeded',
        'This invitation has expired.',
        INVITATION_UNAVAILABLE,
      );
    }
    const currentState = String(invitation.get('status') ?? '');
    const currentSpeakerIds = speakerIdsOf(proposal);
    if (
      currentState === (response === 'accept' ? 'accepted' : 'declined') &&
      invitation.get('respondedBy') === identity.uid &&
      (response === 'decline' || currentSpeakerIds.includes(identity.uid))
    ) {
      accepted = response === 'accept';
      return;
    }
    if (currentState !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        'This invitation can no longer be answered.',
        INVITATION_UNAVAILABLE,
      );
    }
    const speakerIds = currentSpeakerIds;
    const primarySpeakerId = primaryOf(proposal);
    if (identity.uid === primarySpeakerId || speakerIds.includes(identity.uid)) {
      throw new HttpsError('already-exists', 'This account is already a speaker on the proposal.');
    }
    if (response === 'decline') {
      tx.update(invitation.ref, {
        status: 'declined',
        respondedBy: identity.uid,
        respondedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    if (!profile.exists || !speakerSchema.safeParse(profile.data()).success) {
      throw new HttpsError('failed-precondition', 'Complete your speaker profile before accepting.');
    }
    const form = mergeSubmissionForm(formSnap.exists ? formSnap.data() : undefined);
    const parsedAcks = phase === 'postAcceptance'
      ? acksSchemaFor(form).safeParse(input.acks)
      : null;
    const parsedAttendance = phase === 'postAcceptance'
      ? attendanceSchema.safeParse(input.attendance)
      : null;
    if (
      phase === 'postAcceptance' &&
      (!parsedAcks?.success || !parsedAttendance?.success)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Complete the speaker acknowledgements and attendance details before joining.',
      );
    }
    if (speakerIds.length >= MAX_ACTIVE_SPEAKERS) {
      throw new HttpsError('resource-exhausted', `A proposal can have at most ${MAX_ACTIVE_SPEAKERS} speakers.`);
    }
    const [primaryParticipant, existingReview, scheduleConfig, primaryConfirmation] =
      await tx.getAll(
        participantRef(cfpId, proposalId, primarySpeakerId),
        proposalRef.collection('reviews').doc(identity.uid),
        db.doc(`cfps/${cfpId}/config/schedule`),
        proposalRef.collection('speakerConfirmations').doc(primarySpeakerId),
      );
    if (phase === 'postAcceptance' && existingReview.exists) {
      throw new HttpsError(
        'failed-precondition',
        'This person already reviewed the proposal and cannot be added as a speaker.',
        INVITATION_REVIEWER_CONFLICT,
      );
    }
    const proposalData = proposal.data() ?? {};
    const currentStatus = String(proposal.get('status') ?? '');
    const releasedConfirmedSchedule =
      phase === 'postAcceptance' &&
      currentStatus === 'confirmed' &&
      proposal.get('lateSpeakerSchedulePreserved') !== true &&
      await currentScheduleReleaseContainsProposal(db, tx, cfpId, proposalId, cfp);
    const storedSnapshots = proposal.get('speakerSnapshot');
    const snapshots = Array.isArray(storedSnapshots)
      ? (storedSnapshots as SpeakerSnapshot[])
      : [];
    if (
      phase === 'postAcceptance' &&
      speakerIds.some((uid) => !snapshots.some((speaker) => speaker.uid === uid))
    ) {
      throw new HttpsError(
        'failed-precondition',
        'The accepted proposal has no complete frozen speaker roster.',
      );
    }
    if (!primaryParticipant.exists) {
      tx.create(primaryParticipant.ref, {
        cfpId,
        proposalId,
        uid: primarySpeakerId,
        role: 'primary',
        status: 'active',
        ...(Object.prototype.hasOwnProperty.call(proposalData, 'acks')
          ? { acks: proposal.get('acks') }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(proposalData, 'attendance')
          ? { attendance: proposal.get('attendance') }
          : {}),
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (
      Object.prototype.hasOwnProperty.call(proposalData, 'acks') ||
      Object.prototype.hasOwnProperty.call(proposalData, 'attendance')
    ) {
      tx.set(
        primaryParticipant.ref,
        {
          ...(Object.prototype.hasOwnProperty.call(proposalData, 'acks')
            ? { acks: proposal.get('acks') }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(proposalData, 'attendance')
            ? { attendance: proposal.get('attendance') }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    const legacyConfirmed =
      phase === 'postAcceptance' &&
      currentStatus === 'confirmed' &&
      !usesPerSpeakerLifecycle(proposalData);
    if (legacyConfirmed) {
      const legacyAnswers = proposal.get('confirmAnswers');
      const legacyUploads = proposal.get('headshotUploads');
      const legacySpeakerPhoto = proposal.get('speakerPhoto');
      const confirmedAt = proposal.get('confirmedAt');
      tx.set(
        primaryConfirmation.ref,
        {
          cfpId,
          proposalId,
          uid: primarySpeakerId,
          response: 'confirmed',
          answers:
            legacyAnswers && typeof legacyAnswers === 'object' && !Array.isArray(legacyAnswers)
              ? legacyAnswers
              : {},
          ...(legacyUploads && typeof legacyUploads === 'object' && !Array.isArray(legacyUploads)
            ? { headshotUploads: legacyUploads }
            : {}),
          ...(legacySpeakerPhoto &&
          typeof legacySpeakerPhoto === 'object' &&
          !Array.isArray(legacySpeakerPhoto)
            ? { speakerPhoto: legacySpeakerPhoto }
            : {}),
          migratedFromLegacy: true,
          respondedAt: confirmedAt ?? FieldValue.serverTimestamp(),
          confirmedAt: confirmedAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    const existingLateIds = Array.isArray(proposal.get('lateSpeakerPendingIds'))
      ? (proposal.get('lateSpeakerPendingIds') as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && Boolean(uid),
        )
      : [];
    const lateSpeakerPendingIds = [...new Set([...existingLateIds, identity.uid])];
    const existingLateInvitations = Array.isArray(proposal.get('lateSpeakerPendingInvitations'))
      ? (proposal.get('lateSpeakerPendingInvitations') as unknown[]).filter(
          (value): value is { uid: string; invitationId: string } =>
            Boolean(
              value &&
              typeof value === 'object' &&
              typeof (value as { uid?: unknown }).uid === 'string' &&
              typeof (value as { invitationId?: unknown }).invitationId === 'string',
            ),
        )
      : [];
    const lateSpeakerPendingInvitations = [
      ...existingLateInvitations.filter((value) => value.uid !== identity.uid),
      { uid: identity.uid, invitationId },
    ];
    const preserveConfirmedSchedule =
      phase === 'postAcceptance' &&
      (releasedConfirmedSchedule || proposal.get('lateSpeakerSchedulePreserved') === true);
    const storedBaseline = proposal.get('lateSpeakerScheduleBaselineIds');
    const lateSpeakerScheduleBaselineIds =
      Array.isArray(storedBaseline) &&
      storedBaseline.every((uid) => typeof uid === 'string')
        ? storedBaseline
        : speakerIds;
    tx.update(proposalRef, {
      primarySpeakerId,
      speakerIds: [...speakerIds, identity.uid],
      ...(phase === 'postAcceptance'
        ? {
            speakerSnapshot: [...snapshots, speakerSnapshotFrom(identity.uid, profile.data()!)],
            status: 'accepted',
            confirmedAt: FieldValue.delete(),
            lateSpeakerPendingIds,
            lateSpeakerPendingInvitations,
            ...(preserveConfirmedSchedule
              ? {
                  lateSpeakerSchedulePreserved: true,
                  lateSpeakerScheduleBaselineIds,
                }
              : {}),
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(proposalData, 'acks')
        ? { acks: FieldValue.delete() }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(proposalData, 'attendance')
        ? { attendance: FieldValue.delete() }
        : {}),
      ...(legacyConfirmed
        ? {
            confirmAnswers: FieldValue.delete(),
            headshotUploads: FieldValue.delete(),
            speakerPhoto: FieldValue.delete(),
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      participantRef(cfpId, proposalId, identity.uid),
      {
        cfpId,
        proposalId,
        uid: identity.uid,
        role: 'coSpeaker',
        status: 'active',
        invitationId,
        joinedPhase: phase,
        acks: phase === 'postAcceptance' ? parsedAcks!.data : {},
        attendance: phase === 'postAcceptance' ? parsedAttendance!.data : {},
        joinedAt: FieldValue.serverTimestamp(),
        removedBy: FieldValue.delete(),
        removedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.update(invitation.ref, {
      status: 'accepted',
      respondedBy: identity.uid,
      respondedAt: FieldValue.serverTimestamp(),
    });
    if (phase === 'postAcceptance' && scheduleConfig.exists) {
      tx.update(
        scheduleConfig.ref,
        { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
      );
    }
    accepted = true;
  });
  return {
    ok: true,
    state: accepted ? 'accepted' : 'declined',
    roster: accepted ? await rosterFor(cfpId, proposalId, identity) : null,
  };
});

export const revokeCoSpeakerInvitation = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const invitationId = invitationIdFrom(request.data);
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, invitation] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      proposalRef,
      db.doc(`cfps/${cfpId}/members/${identity.uid}`),
      invitationRef(cfpId, proposalId, invitationId),
    );
    if (!invitation.exists) throw new HttpsError('not-found', 'Invitation not found.');
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    const phase = invitationPhase(invitation);
    if (phase === 'draft') {
      assertOpen(cfp);
      assertDraft(proposal);
      if (!canManage(identity, cfpId, proposal, member)) {
        throw new HttpsError(
          'permission-denied',
          'Only the lead speaker can revoke a draft co-speaker invitation.',
        );
      }
    } else if (phase === 'postAcceptance') {
      assertLateInvitationWindow(cfp);
      if (!postAcceptanceStatus(proposal)) {
        throw new HttpsError('failed-precondition', 'This invitation is no longer current.');
      }
      if (!roleAllowsManagement(member, cfpId, identity.uid)) {
        throw new HttpsError(
          'permission-denied',
          'Only an event admin can revoke a post-acceptance co-speaker invitation.',
        );
      }
    } else {
      throw new HttpsError('failed-precondition', 'This invitation is no longer current.');
    }
    const state = String(invitation.get('status') ?? '');
    if (state === 'revoked') return;
    if (state === 'accepted') {
      throw new HttpsError(
        'failed-precondition',
        'Remove an active co-speaker from the roster instead of revoking their invitation.',
      );
    }
    if (
      (phase === 'draft' && state !== 'pending' && state !== 'declined') ||
      (phase === 'postAcceptance' && state !== 'pending')
    ) {
      throw new HttpsError('failed-precondition', 'This invitation cannot be revoked.');
    }
    tx.update(invitation.ref, {
      status: 'revoked',
      revokedBy: identity.uid,
      revokedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, roster: await rosterFor(cfpId, proposalId, identity) };
});

export const removeCoSpeaker = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireIds(request.data);
  const targetUid = String((request.data as { uid?: unknown } | undefined)?.uid ?? '');
  if (!DOCUMENT_ID.test(targetUid)) {
    throw new HttpsError('invalid-argument', 'A valid speaker is required.');
  }
  const db = getFirestore();
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  let leftProposal = false;
  await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, participant, scheduleConfig, profileUpdateRequest] = await tx.getAll(
      db.doc(`cfps/${cfpId}`),
      proposalRef,
      db.doc(`cfps/${cfpId}/members/${identity.uid}`),
      participantRef(cfpId, proposalId, targetUid),
      db.doc(`cfps/${cfpId}/config/schedule`),
      profileUpdateRequestRef(db, cfpId, proposalId, targetUid),
    );
    assertActive(cfp);
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');
    const lateBindings = Array.isArray(proposal.get('lateSpeakerPendingInvitations'))
      ? (proposal.get('lateSpeakerPendingInvitations') as unknown[]).filter(
          (value): value is { uid: string; invitationId: string } =>
            Boolean(
              value &&
              typeof value === 'object' &&
              typeof (value as { uid?: unknown }).uid === 'string' &&
              typeof (value as { invitationId?: unknown }).invitationId === 'string',
            ),
        )
      : [];
    const participantInvitationId = String(participant.get('invitationId') ?? '');
    const participantClaimsLateJoin =
      participant.exists &&
      participant.get('cfpId') === cfpId &&
      participant.get('proposalId') === proposalId &&
      participant.get('uid') === targetUid &&
      participant.get('role') === 'coSpeaker' &&
      participant.get('status') === 'active' &&
      participant.get('joinedPhase') === 'postAcceptance' &&
      INVITATION_ID.test(participantInvitationId);
    const participantInvitation = participantClaimsLateJoin
      ? await tx.get(invitationRef(cfpId, proposalId, participantInvitationId))
      : null;
    const verifiedLateParticipant =
      participantInvitation?.exists === true &&
      invitationPhase(participantInvitation) === 'postAcceptance' &&
      participantInvitation.get('cfpId') === cfpId &&
      participantInvitation.get('proposalId') === proposalId &&
      participantInvitation.get('invitationId') === participantInvitationId &&
      participantInvitation.get('status') === 'accepted' &&
      participantInvitation.get('respondedBy') === targetUid;
    const adminManager = roleAllowsManagement(member, cfpId, identity.uid);
    const selfLeavingDraft =
      proposal.get('status') === 'draft' && identity.uid === targetUid;
    if (!canManage(identity, cfpId, proposal, member) && !selfLeavingDraft) {
      throw new HttpsError(
        'permission-denied',
        'Only the lead speaker can remove another speaker from a draft. After submission, a declined co-speaker may be removed; an event admin may also remove an unconfirmed speaker blocking an accepted session.',
      );
    }
    const speakerIds = speakerIdsOf(proposal);
    const primarySpeakerId = primaryOf(proposal);
    if (targetUid === primarySpeakerId) {
      throw new HttpsError('failed-precondition', 'The primary speaker cannot be removed.');
    }
    if (!speakerIds.includes(targetUid) || speakerIds.length <= 1) {
      throw new HttpsError('not-found', 'That active co-speaker was not found.');
    }
    const remainingIds = speakerIds.filter((uid) => uid !== targetUid);
    const confirmationRefs = speakerIds.map((uid) =>
      db.doc(`cfps/${cfpId}/proposals/${proposalId}/speakerConfirmations/${uid}`),
    );
    const confirmations = await tx.getAll(...confirmationRefs);
    const confirmationByUid = new Map(confirmations.map((snap) => [snap.id, snap]));
    const targetResponse = confirmationByUid.get(targetUid)?.get('response');
    const currentStatus = String(proposal.get('status') ?? '');
    const removableUnconfirmedLateSpeaker =
      currentStatus !== 'draft' &&
      verifiedLateParticipant &&
      adminManager &&
      targetResponse !== 'confirmed';
    const removableUnconfirmedSpeaker =
      currentStatus === 'accepted' &&
      adminManager &&
      targetResponse === undefined;
    if (
      currentStatus !== 'draft' &&
      targetResponse !== 'declined' &&
      !removableUnconfirmedLateSpeaker &&
      !removableUnconfirmedSpeaker
    ) {
      throw new HttpsError(
        'failed-precondition',
        'After submission, only a declined co-speaker or an unconfirmed speaker blocking an accepted session can be removed.',
      );
    }

    let nextStatus = currentStatus;
    if (['accepted', 'confirmed', 'declined'].includes(currentStatus)) {
      const primaryResponse = confirmationByUid.get(primarySpeakerId)?.get('response');
      nextStatus = primaryResponse === 'declined'
        ? 'declined'
        : remainingIds.every((uid) => confirmationByUid.get(uid)?.get('response') === 'confirmed')
          ? 'confirmed'
          : 'accepted';
    }
    const former = proposal.get('formerSpeakerIds');
    const formerSpeakerIds = [
      ...new Set([
        ...(Array.isArray(former) ? former.filter((uid): uid is string => typeof uid === 'string') : []),
        targetUid,
      ]),
    ];
    if (currentStatus === 'draft') assertOpen(cfp);
    leftProposal = selfLeavingDraft;
    const storedSnapshots = proposal.get('speakerSnapshot');
    const hasSpeakerSnapshots = Array.isArray(storedSnapshots);
    const snapshots = ((storedSnapshots ?? []) as SpeakerSnapshot[]).filter(
      (speaker) => speaker.uid !== targetUid,
    );
    const removedSnapshot = ((proposal.get('speakerSnapshot') ?? []) as SpeakerSnapshot[]).filter(
      (speaker) => speaker.uid === targetUid,
    );
    const formerSpeakerSnapshot = [
      ...((proposal.get('formerSpeakerSnapshot') ?? []) as SpeakerSnapshot[]),
      ...removedSnapshot,
    ].filter(
      (speaker, index, all) => all.findIndex((candidate) => candidate.uid === speaker.uid) === index,
    );
    const remainingLateBindings = lateBindings.filter((value) => value.uid !== targetUid);
    const remainingLateIds = remainingLateBindings.map((value) => value.uid);
    const baseline = Array.isArray(proposal.get('lateSpeakerScheduleBaselineIds'))
      ? (proposal.get('lateSpeakerScheduleBaselineIds') as unknown[]).filter(
          (uid): uid is string => typeof uid === 'string' && Boolean(uid),
        )
      : [];
    const removedBaselineSpeaker =
      currentStatus !== 'draft' &&
      proposal.get('lateSpeakerSchedulePreserved') === true &&
      baseline.includes(targetUid);
    tx.update(proposalRef, {
      speakerIds: remainingIds,
      formerSpeakerIds,
      ...(hasSpeakerSnapshots
        ? { speakerSnapshot: snapshots, formerSpeakerSnapshot }
        : {}),
      status: nextStatus,
      ...(currentStatus !== 'draft'
        ? {
            lateSpeakerPendingIds:
              remainingLateIds.length > 0 ? remainingLateIds : FieldValue.delete(),
            lateSpeakerPendingInvitations:
              remainingLateBindings.length > 0
                ? remainingLateBindings
                : FieldValue.delete(),
            ...(removedBaselineSpeaker ? { scheduleCancellationRequired: true } : {}),
          }
        : {}),
      ...(nextStatus === 'accepted'
        ? { confirmedAt: FieldValue.delete() }
        : nextStatus === 'confirmed' && currentStatus !== 'confirmed'
          ? { confirmedAt: FieldValue.serverTimestamp() }
          : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      participant.ref,
      {
        cfpId,
        proposalId,
        uid: targetUid,
        role: 'coSpeaker',
        status: 'inactive',
        removedBy: identity.uid,
        removedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const targetConfirmation = confirmationByUid.get(targetUid);
    if (targetConfirmation?.exists) tx.delete(targetConfirmation.ref);
    cancelPendingProfileUpdateRequest(
      tx,
      profileUpdateRequest,
      identity.uid,
      'speaker-removed',
    );
    if (scheduleConfig.exists && currentStatus !== 'draft') {
      tx.update(scheduleConfig.ref, {
        needsAttention: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return {
    ok: true,
    roster: leftProposal ? null : await rosterFor(cfpId, proposalId, identity),
  };
});
