import { SCORES, type Score } from '@shared/enums';

export interface ReviewDraft {
  score: Score | null;
  conflictOfInterest: boolean;
  comment: string;
}

const keyFor = (cfpId: string, uid: string) => `cfp.review-drafts:${cfpId}:${uid}`;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(cfpId: string, uid: string): Record<string, ReviewDraft> {
  try {
    const value = storage()?.getItem(keyFor(cfpId, uid));
    if (!value) return {};
    const parsed = JSON.parse(value) as Record<string, Partial<ReviewDraft>>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, draft]) => {
        const score = draft.score;
        if (
          typeof draft.comment !== 'string' ||
          typeof draft.conflictOfInterest !== 'boolean' ||
          (score !== null && !SCORES.includes(score as Score))
        ) {
          return [];
        }
        return [[id, { score: score as Score | null, conflictOfInterest: draft.conflictOfInterest, comment: draft.comment }]];
      }),
    );
  } catch {
    return {};
  }
}

function write(cfpId: string, uid: string, drafts: Record<string, ReviewDraft>): void {
  try {
    const target = storage();
    if (!target) return;
    if (Object.keys(drafts).length) target.setItem(keyFor(cfpId, uid), JSON.stringify(drafts));
    else target.removeItem(keyFor(cfpId, uid));
  } catch {
    // The in-memory draft still works when storage is unavailable.
  }
}

export function loadReviewDrafts(cfpId: string, uid: string): Map<string, ReviewDraft> {
  return new Map(Object.entries(read(cfpId, uid)));
}

export function keepReviewDraft(
  cfpId: string,
  uid: string,
  proposalId: string,
  draft: ReviewDraft,
): void {
  write(cfpId, uid, { ...read(cfpId, uid), [proposalId]: draft });
}

export function clearReviewDraft(
  cfpId: string,
  uid: string,
  proposalId: string,
  saved: ReviewDraft,
): void {
  const drafts = read(cfpId, uid);
  const current = drafts[proposalId];
  if (!current || JSON.stringify(current) !== JSON.stringify(saved)) return;
  delete drafts[proposalId];
  write(cfpId, uid, drafts);
}
