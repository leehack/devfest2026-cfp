import type { SpeakerSnapshot } from '@shared/types';

import type { ProposalRow } from '../../lib/roles';

export function reconcileProposalSpeakerSnapshot(
  rows: ProposalRow[],
  proposalId: string,
  speakerUid: string,
  snapshot: SpeakerSnapshot,
): ProposalRow[] {
  const proposalIndex = rows.findIndex((row) => row.id === proposalId);
  if (proposalIndex < 0) return rows;

  const proposal = rows[proposalIndex];
  const speakerIndex = proposal.speakerSnapshot?.findIndex(
    (speaker) => speaker.uid === speakerUid,
  );
  if (speakerIndex === undefined || speakerIndex < 0 || !proposal.speakerSnapshot) return rows;

  const speakers = [...proposal.speakerSnapshot];
  speakers[speakerIndex] = snapshot;
  const next = [...rows];
  next[proposalIndex] = { ...proposal, speakerSnapshot: speakers };
  return next;
}
