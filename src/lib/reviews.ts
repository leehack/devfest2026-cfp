import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '../firebase';
import type { Score } from '@shared/enums';
import type { Review } from '@shared/types';

export interface ReviewDraft {
  score: Score;
  conflictOfInterest: boolean;
  comment: string;
}

/**
 * A reviewer's own reviews, one `get` per proposal.
 *
 * A collection-group query would be one round trip instead of N, but listing
 * `reviews` is denied until the round closes — reading your own document by id
 * is the only access the rules give a reviewer before then.
 */
export async function loadMyReviews(
  uid: string,
  proposalIds: string[],
): Promise<Map<string, Review>> {
  const found = await Promise.all(
    proposalIds.map(async (id) => {
      const snap = await getDoc(doc(db, 'proposals', id, 'reviews', uid));
      return snap.exists() ? ([id, snap.data() as Review] as const) : null;
    }),
  );
  return new Map(found.filter((entry): entry is [string, Review] => entry !== null));
}

/** Full overwrite, not a merge: clearing the comment has to actually clear it. */
export async function saveReview(
  proposalId: string,
  uid: string,
  draft: ReviewDraft,
): Promise<void> {
  const comment = draft.comment.trim();
  await setDoc(doc(db, 'proposals', proposalId, 'reviews', uid), {
    score: draft.score,
    conflictOfInterest: draft.conflictOfInterest,
    ...(comment ? { comment } : {}),
    updatedAt: serverTimestamp(),
  });
}

export interface ReviewRow extends Review {
  reviewerUid: string;
}

/** Every review on one proposal — admins, or reviewers once the round closes. */
export async function loadReviewsFor(proposalId: string): Promise<ReviewRow[]> {
  const snap = await getDocs(collection(db, 'proposals', proposalId, 'reviews'));
  return snap.docs.map((d) => ({ reviewerUid: d.id, ...(d.data() as Review) }));
}
