import { describe, expect, it } from 'vitest';

import {
  profileUpdateRequestsByProposal,
  proposalHasProfileUpdateAttention,
  type ProfileUpdateRequestSummary,
} from '../src/lib/profileUpdateRequestSummary';

function summary(
  proposalId: string,
  speakerUid: string,
  state: 'waiting' | 'ready',
): ProfileUpdateRequestSummary {
  return {
    proposalId,
    speakerUid,
    requestId: `${proposalId}-${speakerUid}`,
    generation: 1,
    state,
    scopes: ['profile'],
    resolvedScopes: state === 'ready' ? ['profile'] : [],
    requestedAt: null,
    resolvedAt: null,
  };
}

describe('profile update request summaries', () => {
  it('groups every speaker task under its exact proposal', () => {
    const grouped = profileUpdateRequestsByProposal([
      summary('talk-a', 'speaker-1', 'waiting'),
      summary('talk-a', 'speaker-2', 'ready'),
      summary('talk-b', 'speaker-3', 'waiting'),
    ]);

    expect(grouped.get('talk-a')?.map((request) => request.speakerUid)).toEqual([
      'speaker-1',
      'speaker-2',
    ]);
    expect(grouped.get('talk-b')?.map((request) => request.speakerUid)).toEqual([
      'speaker-3',
    ]);
  });

  it('keeps waiting and ready filters distinct while all includes empty rows', () => {
    const requests = [
      summary('talk-a', 'speaker-1', 'waiting'),
      summary('talk-a', 'speaker-2', 'ready'),
    ];

    expect(proposalHasProfileUpdateAttention(requests, 'waiting')).toBe(true);
    expect(proposalHasProfileUpdateAttention(requests, 'ready')).toBe(true);
    expect(proposalHasProfileUpdateAttention([], 'waiting')).toBe(false);
    expect(proposalHasProfileUpdateAttention([], 'all')).toBe(true);
  });
});
