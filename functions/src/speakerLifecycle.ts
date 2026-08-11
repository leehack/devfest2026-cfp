import {
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import type {
  Answers,
  ConfirmedSpeakerPhoto,
  HeadshotUploads,
} from '../../shared/confirmForm';
import { speakerInvitationPhaseOf } from '../../shared/coSpeakers';

export const SPEAKER_PARTICIPANTS = 'speakerParticipants';
export const SPEAKER_CONFIRMATIONS = 'speakerConfirmations';

export type SpeakerResponse = 'confirmed' | 'declined';

export interface SpeakerConfirmationData {
  cfpId: string;
  proposalId: string;
  uid: string;
  response: SpeakerResponse;
  answers: Answers;
  headshotUploads?: HeadshotUploads;
  speakerPhoto?: ConfirmedSpeakerPhoto;
  respondedAt: unknown;
  confirmedAt?: unknown;
  updatedAt: unknown;
}

export function proposalSpeakerIds(proposal: DocumentData): string[] {
  return [
    ...new Set(
      ((proposal.speakerIds ?? []) as unknown[]).filter(
        (uid): uid is string => typeof uid === 'string' && uid.length > 0,
      ),
    ),
  ];
}

export function primarySpeakerId(proposal: DocumentData): string {
  const explicit = proposal.primarySpeakerId;
  return typeof explicit === 'string' && explicit
    ? explicit
    : proposalSpeakerIds(proposal)[0] ?? '';
}

/** A proposal opts in once its roster is initialized, even with one speaker. */
export function usesPerSpeakerLifecycle(proposal: DocumentData): boolean {
  return Boolean(proposal.primarySpeakerId) || proposalSpeakerIds(proposal).length > 1;
}

export function speakerParticipantRef(
  db: Firestore,
  cfpId: string,
  proposalId: string,
  uid: string,
): DocumentReference {
  return db.doc(
    `cfps/${cfpId}/proposals/${proposalId}/${SPEAKER_PARTICIPANTS}/${uid}`,
  );
}

export function speakerConfirmationRef(
  db: Firestore,
  cfpId: string,
  proposalId: string,
  uid: string,
): DocumentReference {
  return db.doc(
    `cfps/${cfpId}/proposals/${proposalId}/${SPEAKER_CONFIRMATIONS}/${uid}`,
  );
}

export function confirmationResponse(data: DocumentData | undefined): SpeakerResponse | null {
  return data?.response === 'confirmed' || data?.response === 'declined'
    ? data.response
    : null;
}

export function everySpeakerConfirmed(
  speakerIds: readonly string[],
  confirmations: ReadonlyMap<string, DocumentData | undefined>,
): boolean {
  return (
    speakerIds.length > 0 &&
    speakerIds.every((uid) => confirmationResponse(confirmations.get(uid)) === 'confirmed')
  );
}

/** The roster covered by the current immutable release while a late addition confirms. */
export function currentReleasedSpeakerIds(
  proposal: DocumentSnapshot | null | undefined,
): string[] {
  if (!proposal?.exists || proposal.get('scheduleCancellationRequired') === true) return [];
  const status = proposal.get('status');
  const active = new Set(proposalSpeakerIds(proposal.data() ?? {}));
  if (proposal.get('lateSpeakerSchedulePreserved') !== true) {
    return status === 'confirmed' ? [...active] : [];
  }

  const pending = proposal.get('lateSpeakerPendingIds');
  const bindings = proposal.get('lateSpeakerPendingInvitations');
  const baseline = proposal.get('lateSpeakerScheduleBaselineIds');
  if (
    !Array.isArray(baseline) ||
    baseline.length === 0 ||
    !baseline.every((uid) => typeof uid === 'string' && active.has(uid)) ||
    new Set(baseline).size !== baseline.length
  ) {
    return [];
  }
  if (status === 'confirmed') return [...baseline];
  const noPendingBindings =
    (pending === undefined || (Array.isArray(pending) && pending.length === 0)) &&
    (bindings === undefined || (Array.isArray(bindings) && bindings.length === 0));
  if (status === 'accepted' && noPendingBindings) return [...baseline];
  if (
    status !== 'accepted' ||
    !Array.isArray(pending) ||
    pending.length === 0 ||
    !pending.every((uid) => typeof uid === 'string' && active.has(uid)) ||
    new Set(pending).size !== pending.length ||
    !Array.isArray(bindings) ||
    bindings.length !== pending.length ||
    !bindings.every(
      (binding) =>
        binding &&
        typeof binding === 'object' &&
        typeof binding.uid === 'string' &&
        typeof binding.invitationId === 'string' &&
        pending.includes(binding.uid),
    ) ||
    baseline.some((uid) => pending.includes(uid))
  ) {
    return [];
  }
  return [...new Set(baseline as string[])];
}

/** The immutable roster addressed when an existing release is cancelled. */
export function scheduleCancellationRecipientIds(
  proposal: DocumentSnapshot | null | undefined,
): string[] {
  if (!proposal?.exists) return [];
  const baseline = proposal.get('lateSpeakerScheduleBaselineIds');
  if (
    proposal.get('lateSpeakerSchedulePreserved') === true &&
    Array.isArray(baseline) &&
    baseline.length > 0 &&
    baseline.every((uid) => typeof uid === 'string' && Boolean(uid)) &&
    new Set(baseline).size === baseline.length
  ) {
    return [...baseline];
  }
  return proposalSpeakerIds(proposal.data() ?? {});
}

export function scheduleReleaseIds(
  cfp: DocumentSnapshot | null | undefined,
): string[] {
  return [
    ...new Set(
      [cfp?.get('sharedScheduleId'), cfp?.get('publishedScheduleId')].filter(
        (value): value is string => typeof value === 'string' && Boolean(value),
      ),
    ),
  ];
}

/** Release queries made before a transaction are safe to apply only to this exact pointer set. */
export function scheduleCancellationSnapshotIsCurrent(
  observedReleaseIds: readonly string[],
  currentCfp: DocumentSnapshot | null | undefined,
): boolean {
  const currentReleaseIds = scheduleReleaseIds(currentCfp);
  return (
    observedReleaseIds.length === currentReleaseIds.length &&
    observedReleaseIds.every((releaseId, index) => releaseId === currentReleaseIds[index])
  );
}

/** A delayed event must not act on a document recreated at the same path. */
export function proposalEventIsCurrent(
  observedProposal: DocumentSnapshot | null | undefined,
  currentProposal: DocumentSnapshot | null | undefined,
): boolean {
  const observedCreateTime = observedProposal?.createTime;
  const currentCreateTime = currentProposal?.createTime;
  return Boolean(
    observedProposal?.exists &&
    currentProposal?.exists &&
    observedCreateTime &&
    currentCreateTime &&
    observedCreateTime.isEqual(currentCreateTime),
  );
}

export function scheduleReleaseProposalEntryId(
  source: DocumentSnapshot | null | undefined,
  proposalId: string,
): string | null {
  const stored = source?.get('scheduledProposalEntries');
  // Releases created before proposal-level schedule email validation have no
  // map. Keep their exact-entry checks working while every new release records
  // an explicit empty string for proposals it does not contain.
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const entryId = (stored as Record<string, unknown>)[proposalId];
  return typeof entryId === 'string' ? entryId : '';
}

/** Whether a current shared or published immutable release serves a proposal. */
export async function currentScheduleReleaseContainsProposal(
  db: Firestore,
  tx: Transaction,
  cfpId: string,
  proposalId: string,
  currentCfp?: DocumentSnapshot,
): Promise<boolean> {
  const cfp = currentCfp ?? await tx.get(db.doc(`cfps/${cfpId}`));
  const releaseIds = scheduleReleaseIds(cfp);

  for (const releaseId of releaseIds) {
    const releaseRef = db.doc(`cfps/${cfpId}/scheduleReleases/${releaseId}`);
    const source = await tx.get(
      releaseRef.collection('internal').doc('source'),
    );
    const mappedEntryId = scheduleReleaseProposalEntryId(source, proposalId);
    if (mappedEntryId === '') continue;
    if (mappedEntryId) {
      const entry = await tx.get(releaseRef.collection('entries').doc(mappedEntryId));
      if (
        entry.exists &&
        entry.get('proposalId') === proposalId &&
        entry.get('cancelled') !== true
      ) {
        return true;
      }
      continue;
    }

    const legacyEntries = await tx.get(
      releaseRef.collection('entries').where('proposalId', '==', proposalId),
    );
    if (legacyEntries.docs.some((entry) => entry.get('cancelled') !== true)) {
      return true;
    }
  }
  return false;
}

export function scheduleEmailStillTrue(
  kind: string,
  rowReleaseId: string,
  currentReleaseId: string,
  entry: DocumentSnapshot | null | undefined,
  proposal: DocumentSnapshot | null | undefined,
  recipientUid: string,
  currentProposalEntryId?: string | null,
): boolean {
  if (!currentReleaseId || rowReleaseId !== currentReleaseId) return false;
  if (kind === 'schedule_cancelled') {
    if (currentProposalEntryId !== null && currentProposalEntryId !== undefined) {
      return (
        currentProposalEntryId === '' ||
        Boolean(
          entry &&
            entry.exists &&
            entry.id === currentProposalEntryId &&
            entry.get('cancelled') === true,
        )
      );
    }
    return Boolean(entry && (!entry.exists || entry.get('cancelled') === true));
  }
  return (
    Boolean(entry) &&
    (currentProposalEntryId === null ||
      currentProposalEntryId === undefined ||
      currentProposalEntryId === entry?.id) &&
    currentReleasedSpeakerIds(proposal).includes(recipientUid) &&
    entry?.exists === true &&
    entry?.get('cancelled') !== true
  );
}

/** Revalidates one profile-request email against its exact pending generation. */
export function profileUpdateRequestStillTrue(
  kind: unknown,
  requestId: string,
  generation: number,
  cfpId: string,
  proposalId: string,
  speakerUid: string,
  updateRequest: DocumentSnapshot | null | undefined,
  proposal: DocumentSnapshot | null | undefined,
  confirmation: DocumentSnapshot | null | undefined,
): boolean {
  if (
    kind !== 'profile_update_requested' ||
    !requestId ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !updateRequest?.exists ||
    !proposal?.exists ||
    updateRequest.get('cfpId') !== cfpId ||
    updateRequest.get('proposalId') !== proposalId ||
    updateRequest.get('speakerUid') !== speakerUid ||
    updateRequest.get('requestId') !== requestId ||
    updateRequest.get('generation') !== generation ||
    updateRequest.get('status') !== 'pending' ||
    !proposalSpeakerIds(proposal.data() ?? {}).includes(speakerUid) ||
    !['accepted', 'confirmed'].includes(String(proposal.get('status') ?? ''))
  ) {
    return false;
  }

  if (!usesPerSpeakerLifecycle(proposal.data() ?? {})) {
    return proposal.get('status') === 'confirmed';
  }
  return Boolean(
    confirmation?.exists &&
      confirmation.get('cfpId') === cfpId &&
      confirmation.get('proposalId') === proposalId &&
      confirmation.get('uid') === speakerUid &&
      confirmation.get('response') === 'confirmed',
  );
}

/** Revalidates a queued invite against the exact private row before delivery. */
export function coSpeakerInvitationStillTrue(
  kind: unknown,
  invitationId: string,
  cfpId: string,
  proposalId: string,
  invitationEmail: string,
  invitation: DocumentSnapshot | null,
  proposal: DocumentSnapshot | null,
  cfp: DocumentSnapshot | null,
  now = Date.now(),
): boolean {
  const phase = speakerInvitationPhaseOf(invitation?.data() ?? {});
  const expiresAt = invitation?.get('expiresAt');
  const opensAt = cfp?.get('opensAt');
  const closesAt = cfp?.get('closesAt');
  const millis = (value: unknown): number =>
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
      ? Number(value.toMillis())
      : Number.NaN;
  const expiresAtMillis = millis(expiresAt);
  const opensAtMillis = millis(opensAt);
  const closesAtMillis = millis(closesAt);
  const proposalStatus = proposal?.get('status');
  const phaseIsCurrent =
    phase === 'draft'
      ? proposalStatus === 'draft' &&
        Number.isFinite(opensAtMillis) &&
        Number.isFinite(closesAtMillis) &&
        now >= opensAtMillis &&
        now < closesAtMillis
      : phase === 'postAcceptance' &&
        (proposalStatus === 'accepted' || proposalStatus === 'confirmed');
  return (
    kind === 'co_speaker_invited' &&
    cfp?.exists === true &&
    cfp.get('archived') !== true &&
    cfp.get('deleting') !== true &&
    cfp.get('paused') !== true &&
    invitation?.exists === true &&
    proposal?.exists === true &&
    phaseIsCurrent &&
    invitation.get('cfpId') === cfpId &&
    invitation.get('proposalId') === proposalId &&
    invitation.get('invitationId') === invitationId &&
    invitation.get('email') === invitationEmail &&
    invitation.get('status') === 'pending' &&
    Number.isFinite(expiresAtMillis) &&
    now < expiresAtMillis
  );
}

/**
 * A pending invitation must still be answerable. Once accepted, its original
 * URL remains a safe sign-in route only while that exact account is still on
 * the proposal; leaving or removal invalidates it immediately.
 */
export function coSpeakerSignInInvitationStillTrue(
  invitationId: string,
  cfpId: string,
  proposalId: string,
  invitationEmail: string,
  invitation: DocumentSnapshot | null,
  proposal: DocumentSnapshot | null,
  cfp: DocumentSnapshot | null,
  now = Date.now(),
): boolean {
  if (
    coSpeakerInvitationStillTrue(
      'co_speaker_invited',
      invitationId,
      cfpId,
      proposalId,
      invitationEmail,
      invitation,
      proposal,
      cfp,
      now,
    )
  ) {
    return true;
  }
  if (
    !cfp?.exists ||
    cfp.get('deleting') === true ||
    !invitation?.exists ||
    !speakerInvitationPhaseOf(invitation.data() ?? {}) ||
    !proposal?.exists ||
    invitation.get('cfpId') !== cfpId ||
    invitation.get('proposalId') !== proposalId ||
    invitation.get('invitationId') !== invitationId ||
    invitation.get('email') !== invitationEmail ||
    invitation.get('status') !== 'accepted'
  ) {
    return false;
  }
  const respondedBy = invitation.get('respondedBy');
  return (
    typeof respondedBy === 'string' &&
    proposalSpeakerIds(proposal.data() ?? {}).includes(respondedBy)
  );
}
