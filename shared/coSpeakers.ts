/** Proposal-scoped speaker invitations and the safe roster returned by callables. */

import type { ConfirmField, Localised } from './confirmForm';
import type { SubmissionAttendanceConfig } from './submissionForm';

export const MAX_ACTIVE_SPEAKERS = 4;
export const MAX_SPEAKER_INVITATION_HISTORY = 20;
export const POST_ACCEPTANCE_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export const SPEAKER_INVITATION_PHASES = ['draft', 'postAcceptance'] as const;
export type SpeakerInvitationPhase = (typeof SPEAKER_INVITATION_PHASES)[number];

export const SPEAKER_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'revoked',
] as const;
export type SpeakerInvitationStatus = (typeof SPEAKER_INVITATION_STATUSES)[number];
export type SpeakerInvitationViewState = SpeakerInvitationStatus | 'expired' | 'paused' | 'unavailable';
export type SpeakerInvitationDeliveryState =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'notDelivered';

export type SpeakerParticipantRole = 'primary' | 'coSpeaker';

/** Callable-only. Pending invitations confer no proposal access. */
export interface SpeakerInvitation {
  cfpId: string;
  proposalId: string;
  invitationId: string;
  email: string;
  /** Missing on historic rows, which are draft invitations. */
  phase?: SpeakerInvitationPhase;
  status: SpeakerInvitationStatus;
  createdBy: string;
  createdAt: unknown;
  respondedBy?: string;
  respondedAt?: unknown;
  revokedBy?: string;
  revokedAt?: unknown;
}

/** Callable-only membership record. `speakerIds` remains the query/auth projection. */
export interface SpeakerParticipant {
  cfpId: string;
  proposalId: string;
  uid: string;
  role: SpeakerParticipantRole;
  status: 'active' | 'inactive';
  joinedAt: unknown;
  invitationId?: string;
  joinedPhase?: SpeakerInvitationPhase;
  acks?: Record<string, boolean>;
  attendance?: Record<string, unknown>;
  updatedAt?: unknown;
  removedBy?: string;
  removedAt?: unknown;
}

export interface ActiveSpeakerRosterItem {
  kind: 'active';
  state: 'active';
  uid: string;
  role: SpeakerParticipantRole;
  name: string;
  email?: string;
  profileComplete: boolean;
  detailsComplete: boolean;
  confirmationState: 'none' | 'confirmed' | 'declined';
  canRemove: boolean;
  isCurrentUser: boolean;
}

export interface InvitedSpeakerRosterItem {
  kind: 'invitation';
  state: SpeakerInvitationStatus;
  invitationId: string;
  phase: SpeakerInvitationPhase;
  role: 'coSpeaker';
  name: string;
  email?: string;
  deliveryState: SpeakerInvitationDeliveryState;
  canRetryDelivery: boolean;
  isCurrentUser: boolean;
}

export type SpeakerRosterItem = ActiveSpeakerRosterItem | InvitedSpeakerRosterItem;

export interface ProposalSpeakerRoster {
  cfpId: string;
  proposalId: string;
  primarySpeakerId: string;
  canManage: boolean;
  canInvite: boolean;
  invitePhase: SpeakerInvitationPhase | null;
  canEditTalk: boolean;
  usesPersonalLifecycle: boolean;
  setupOpen: boolean;
  confirmationOpen: boolean;
  pendingBlocksSubmit: boolean;
  items: SpeakerRosterItem[];
}

export function speakerInvitationPhaseOf(invitation: {
  phase?: unknown;
}): SpeakerInvitationPhase | null {
  if (invitation.phase === 'postAcceptance') return 'postAcceptance';
  if (invitation.phase === undefined || invitation.phase === 'draft') return 'draft';
  return null;
}

export interface SpeakerInvitationSummary {
  cfpId: string;
  proposalId: string;
  invitationId: string;
  phase: SpeakerInvitationPhase;
  eventName: string;
  title: string;
  primaryName: string;
  invitedEmail: string;
  state: SpeakerInvitationViewState;
  matchesSignedInEmail: boolean;
  canRespond: boolean;
  needsProfile: boolean;
  /** Required only when accepting after the proposal was already accepted. */
  participation?: {
    acknowledgements: ConfirmField[];
    attendance: SubmissionAttendanceConfig;
  };
  /** Present only for the verified invited account, never for a mismatched user. */
  talk?: {
    abstract: string;
    category: Localised;
    format: Localised;
    level: Localised;
    deliveryLanguage: Localised;
  };
}

export function primarySpeakerIdOf(proposal: {
  primarySpeakerId?: unknown;
  speakerIds?: unknown;
}): string | null {
  if (typeof proposal.primarySpeakerId === 'string' && proposal.primarySpeakerId) {
    return proposal.primarySpeakerId;
  }
  const ids = proposal.speakerIds;
  return Array.isArray(ids) && typeof ids[0] === 'string' && ids[0] ? ids[0] : null;
}

export function normaliseSpeakerEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)
    ? email
    : null;
}

/** Enough context to recognize the address without exposing it to another account. */
export function maskSpeakerEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 1)}${'*'.repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}
