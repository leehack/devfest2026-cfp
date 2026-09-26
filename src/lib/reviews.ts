import { collection, getDocs } from 'firebase/firestore/lite';
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
