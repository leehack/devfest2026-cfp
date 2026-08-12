import type { ProposalStatus } from '@shared/enums';

export interface UndoDecision {
  action: number;
  proposalId: string;
  title: string;
  from: ProposalStatus;
  /** A decision returns to committee review, never to the editable submitted state. */
  previous: ProposalStatus;
  next: ProposalStatus;
}

function latestUndo(decisions: ReadonlyMap<number, UndoDecision>): UndoDecision | null {
  let latestAction = -1;
  let latest: UndoDecision | null = null;
  for (const [action, decision] of decisions) {
    if (action > latestAction) {
      latestAction = action;
      latest = decision;
    }
  }
  return latest;
}

export function invalidateProposalUndoHistory(
  decisions: Map<number, UndoDecision>,
  proposalId: string,
): UndoDecision | null {
  for (const [action, decision] of decisions) {
    if (decision.proposalId === proposalId) decisions.delete(action);
  }
  return latestUndo(decisions);
}
