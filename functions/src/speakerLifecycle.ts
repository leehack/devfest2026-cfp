import {
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import type { Answers, HeadshotUploads } from '../../shared/confirmForm';

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
  return (
    kind === 'co_speaker_invited' &&
    cfp?.exists === true &&
    cfp.get('archived') !== true &&
    cfp.get('deleting') !== true &&
    cfp.get('paused') !== true &&
    invitation?.exists === true &&
    proposal?.exists === true &&
    proposal.get('status') === 'draft' &&
    invitation.get('cfpId') === cfpId &&
    invitation.get('proposalId') === proposalId &&
    invitation.get('invitationId') === invitationId &&
    invitation.get('email') === invitationEmail &&
    invitation.get('status') === 'pending' &&
    Number.isFinite(expiresAtMillis) &&
    Number.isFinite(opensAtMillis) &&
    Number.isFinite(closesAtMillis) &&
    now >= opensAtMillis &&
    now < closesAtMillis &&
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
