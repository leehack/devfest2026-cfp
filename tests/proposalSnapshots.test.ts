import { describe, expect, it } from 'vitest';

import type { ProposalRow } from '../src/lib/roles';
import { reconcileProposalSpeakerSnapshot } from '../src/screens/admin/proposalSnapshots';

const refreshed = {
  uid: 'speaker-2',
  name: 'New programme name',
  bio: 'A newly approved biography for the current programme.',
  company: 'New Company',
  jobTitle: 'Principal Engineer',
  basedIn: 'Montréal, QC',
  socials: [],
  isGde: false,
};

describe('proposal speaker snapshot reconciliation', () => {
  it('replaces only the refreshed speaker in the matching proposal', () => {
    const other = { id: 'other-talk', speakerSnapshot: [] } as unknown as ProposalRow;
    const proposal = {
      id: 'target-talk',
      speakerSnapshot: [
        { uid: 'speaker-1', name: 'Lead', bio: 'Lead biography.' },
        { uid: 'speaker-2', name: 'Old programme name', bio: 'Old biography.' },
      ],
    } as unknown as ProposalRow;
    const rows = [other, proposal];

    const next = reconcileProposalSpeakerSnapshot(
      rows,
      'target-talk',
      'speaker-2',
      refreshed,
    );

    expect(next).not.toBe(rows);
    expect(next[0]).toBe(other);
    expect(next[1]).not.toBe(proposal);
    expect(next[1].speakerSnapshot).toEqual([
      proposal.speakerSnapshot?.[0],
      refreshed,
    ]);
    expect(rows[1].speakerSnapshot?.[1]?.name).toBe('Old programme name');
  });

  it('leaves state untouched when the proposal or speaker is no longer loaded', () => {
    const rows = [
      {
        id: 'target-talk',
        speakerSnapshot: [{ uid: 'speaker-1', name: 'Lead', bio: 'Lead biography.' }],
      } as unknown as ProposalRow,
    ];

    expect(
      reconcileProposalSpeakerSnapshot(rows, 'missing-talk', 'speaker-1', refreshed),
    ).toBe(rows);
    expect(
      reconcileProposalSpeakerSnapshot(rows, 'target-talk', 'missing-speaker', refreshed),
    ).toBe(rows);
  });
});
