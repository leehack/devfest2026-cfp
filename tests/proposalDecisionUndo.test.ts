import { describe, expect, it } from 'vitest';

import {
  invalidateProposalUndoHistory,
  type UndoDecision,
} from '../src/screens/admin/proposalDecisionUndo';

function decision(action: number, proposalId: string): UndoDecision {
  return {
    action,
    proposalId,
    title: proposalId,
    from: 'submitted',
    previous: 'under_review',
    next: 'accepted',
  };
}

describe('proposal decision Undo history', () => {
  it('removes every older action for a destructively reset proposal', () => {
    const decisions = new Map([
      [1, decision(1, 'reset-talk')],
      [2, decision(2, 'other-talk')],
      [3, decision(3, 'reset-talk')],
    ]);

    expect(invalidateProposalUndoHistory(decisions, 'reset-talk')).toEqual(
      decision(2, 'other-talk'),
    );
    expect([...decisions.keys()]).toEqual([2]);
  });

  it('returns no Undo when the reset proposal owned the remaining history', () => {
    const decisions = new Map([[4, decision(4, 'reset-talk')]]);

    expect(invalidateProposalUndoHistory(decisions, 'reset-talk')).toBeNull();
    expect(decisions.size).toBe(0);
  });
});
