import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import { invalidateCache } from './cache';
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
  cfpId: string,
  uid: string,
  proposalIds: string[],
): Promise<Map<string, Review>> {
  const found = await Promise.all(
    proposalIds.map(async (id) => {
      const snap = await getDoc(doc(db, 'cfps', cfpId, 'proposals', id, 'reviews', uid));
      return snap.exists() ? ([id, snap.data() as Review] as const) : null;
    }),
  );
  return new Map(found.filter((entry): entry is [string, Review] => entry !== null));
}

const saveReviewCall = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    score: Score;
    conflictOfInterest: boolean;
    comment: string;
  },
  { ok: true; proposalId: string; status: string }
>(functions, 'saveReview');

/** The callable writes the review and freezes a first-read proposal atomically. */
export async function saveReview(
  cfpId: string,
  proposalId: string,
  _uid: string,
  draft: ReviewDraft,
): Promise<void> {
  await saveReviewCall({
    cfpId,
    proposalId,
    score: draft.score,
    conflictOfInterest: draft.conflictOfInterest,
    comment: draft.comment.trim(),
  });
  invalidateCache(`reviewQueue:${cfpId}`);
  invalidateCache(`allProposals:${cfpId}`);
}

export interface ReviewRow extends Review {
  reviewerUid: string;
}

/** Every review on one proposal — admins, or reviewers once the round closes. */
export async function loadReviewsFor(cfpId: string, proposalId: string): Promise<ReviewRow[]> {
  const snap = await getDocs(collection(db, 'cfps', cfpId, 'proposals', proposalId, 'reviews'));
  return snap.docs.map((d) => ({ reviewerUid: d.id, ...(d.data() as Review) }));
}
