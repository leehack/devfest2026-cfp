import { inStatusSet, type ProposalStatus } from '@shared/enums';

/**
 * How much of a talk its speaker may still change.
 *
 *   all         everything — it is a draft, or submitted but not yet read
 *   logistics   the travel answers only; the content is in front of reviewers
 *   none        frozen, because it is withdrawn, rejected, or the window shut
 *
 * The speaker profile is not in here on purpose: it lives on the account, not
 * on any talk, and stays editable throughout. See `firestore.rules`, which is
 * where this is actually enforced — this only decides what to disable.
 */
export type EditScope = 'all' | 'logistics' | 'none';

export function editScope(
  status: ProposalStatus,
  windowOpen: boolean,
  archived = false,
): EditScope {
  // Archiving is stronger than closing. The storage lifetime may continue for
  // records, but Firestore deliberately refuses every applicant update.
  if (archived) return 'none';

  // Submitting is not what closes a proposal — the deadline is. Until then a
  // speaker can keep improving what the committee has not started reading.
  if ((status === 'draft' || status === 'submitted') && windowOpen) return 'all';
  if (inStatusSet('underConsideration', status)) return 'logistics';
  return 'none';
}
