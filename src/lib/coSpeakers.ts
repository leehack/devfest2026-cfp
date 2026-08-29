import { httpsCallable } from 'firebase/functions';

import type {
  ProposalSpeakerRoster,
  SpeakerInvitationSummary,
  SpeakerInvitationViewState,
} from '@shared/coSpeakers';

import { functions } from '../firebase';
import { invalidateCache } from './cache';

export interface CoSpeakerInviteQuery {
  proposalId: string;
  invitationId: string;
}

export function coSpeakerInviteQuery(search: string): CoSpeakerInviteQuery | null {
  const params = new URLSearchParams(search);
  const proposalId = params.get('proposal')?.trim();
  const invitationId = params.get('speakerInvite')?.trim();
  return proposalId && invitationId ? { proposalId, invitationId } : null;
}

type RosterEnvelope = ProposalSpeakerRoster | { roster: ProposalSpeakerRoster };
type NullableRosterEnvelope =
  | ProposalSpeakerRoster
  | { roster: ProposalSpeakerRoster | null }
  | null;
type InvitationEnvelope =
  | SpeakerInvitationSummary
  | { invitation: SpeakerInvitationSummary };

const invite = httpsCallable<
  { cfpId: string; proposalId: string; email: string },
  RosterEnvelope
>(functions, 'inviteCoSpeaker');

const invitation = httpsCallable<
  { cfpId: string; proposalId: string; invitationId: string },
  InvitationEnvelope
>(functions, 'getCoSpeakerInvitation');

const respond = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    invitationId: string;
    response: 'accept' | 'decline';
    acks?: Record<string, boolean>;
    attendance?: Record<string, unknown>;
  },
  {
    ok: boolean;
    state: 'accepted' | 'declined';
    roster: ProposalSpeakerRoster | null;
  }
>(functions, 'respondToCoSpeakerInvitation');

const revoke = httpsCallable<
  { cfpId: string; proposalId: string; invitationId: string },
  RosterEnvelope
>(functions, 'revokeCoSpeakerInvitation');

const retryInvitation = httpsCallable<
  { cfpId: string; proposalId: string; invitationId: string },
  RosterEnvelope
>(functions, 'retryCoSpeakerInvitation');

const remove = httpsCallable<
  { cfpId: string; proposalId: string; uid: string },
  NullableRosterEnvelope
>(functions, 'removeCoSpeaker');

const roster = httpsCallable<
  { cfpId: string; proposalId: string },
  RosterEnvelope
>(functions, 'getProposalRoster');

function unwrapRoster(value: RosterEnvelope): ProposalSpeakerRoster {
  return 'roster' in value ? value.roster : value;
}

function unwrapNullableRoster(value: NullableRosterEnvelope): ProposalSpeakerRoster | null {
  if (!value) return null;
  return 'roster' in value ? value.roster : value;
}

function unwrapInvitation(value: InvitationEnvelope): SpeakerInvitationSummary {
  return 'invitation' in value ? value.invitation : value;
}

export async function loadProposalRoster(
  cfpId: string,
  proposalId: string,
): Promise<ProposalSpeakerRoster> {
  const result = await roster({ cfpId, proposalId });
  return unwrapRoster(result.data);
}

export async function inviteProposalSpeaker(
  cfpId: string,
  proposalId: string,
  email: string,
): Promise<ProposalSpeakerRoster> {
  const result = await invite({ cfpId, proposalId, email });
  return unwrapRoster(result.data);
}

export async function revokeProposalSpeakerInvitation(
  cfpId: string,
  proposalId: string,
  invitationId: string,
): Promise<ProposalSpeakerRoster> {
  const result = await revoke({ cfpId, proposalId, invitationId });
  return unwrapRoster(result.data);
}

export async function retryProposalSpeakerInvitation(
  cfpId: string,
  proposalId: string,
  invitationId: string,
): Promise<ProposalSpeakerRoster> {
  const result = await retryInvitation({ cfpId, proposalId, invitationId });
  return unwrapRoster(result.data);
}

export async function removeProposalSpeaker(
  cfpId: string,
  proposalId: string,
  uid: string,
): Promise<ProposalSpeakerRoster | null> {
  const result = await remove({ cfpId, proposalId, uid });
  invalidateCache('myProposals');
  invalidateCache(`allProposals:${cfpId}`);
  invalidateCache(`scheduleDraft:${cfpId}`);
  invalidateCache(`sharedSchedule:${cfpId}`);
  return unwrapNullableRoster(result.data);
}

export async function loadCoSpeakerInvitation(
  cfpId: string,
  proposalId: string,
  invitationId: string,
): Promise<SpeakerInvitationSummary> {
  const result = await invitation({ cfpId, proposalId, invitationId });
  return unwrapInvitation(result.data);
}

export async function respondToCoSpeakerInvitation(
  cfpId: string,
  proposalId: string,
  invitationId: string,
  response: 'accept' | 'decline',
  participation?: {
    acks: Record<string, boolean>;
    attendance?: Record<string, unknown>;
  },
): Promise<{ state: SpeakerInvitationViewState; proposalId: string }> {
  const result = await respond({
    cfpId,
    proposalId,
    invitationId,
    response,
    ...(response === 'accept' && participation ? participation : {}),
  });
  invalidateCache('myProposals');
  invalidateCache(`allProposals:${cfpId}`);
  invalidateCache(`scheduleDraft:${cfpId}`);
  invalidateCache(`sharedSchedule:${cfpId}`);
  invalidateCache(`reviewQueue:${cfpId}`);
  return { state: result.data.state, proposalId };
}
