import type { SpeakerProfileUpdateRequestSummary } from '@shared/types';

export type ProfileUpdateRequestAttention = 'waiting' | 'ready';
export type ProfileUpdateRequestSummary = SpeakerProfileUpdateRequestSummary;

export function profileUpdateRequestsByProposal(
  requests: readonly ProfileUpdateRequestSummary[],
): Map<string, ProfileUpdateRequestSummary[]> {
  const grouped = new Map<string, ProfileUpdateRequestSummary[]>();
  for (const request of requests) {
    const current = grouped.get(request.proposalId) ?? [];
    current.push(request);
    grouped.set(request.proposalId, current);
  }
  return grouped;
}

export function proposalHasProfileUpdateAttention(
  requests: readonly ProfileUpdateRequestSummary[],
  state: ProfileUpdateRequestAttention | 'all',
): boolean {
  return state === 'all' || requests.some((request) => request.state === state);
}
