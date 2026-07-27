import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import type { ProposalStatus, Role } from '@shared/enums';
import type { EmailSettings } from '@shared/emailSettings';
import type { Proposal, Reviewer, RoleGrant } from '@shared/types';

export const claimRole = httpsCallable<void, { role: Role | null }>(functions, 'claimRole');
export const grantRole = httpsCallable<{ email: string; role: Role }, { email: string; role: Role; applied: boolean }>(
  functions,
  'grantRole',
);
export const revokeRole = httpsCallable<{ email: string }, { email: string }>(functions, 'revokeRole');
export const setCfpWindow = httpsCallable<
  { opensAt?: string; closesAt?: string; paused?: boolean; reviewsVisible?: boolean },
  { ok: boolean }
>(functions, 'setCfpWindow');
export const setProposalStatus = httpsCallable<
  { proposalId: string; status: string },
  { ok: boolean; proposalId: string; status: ProposalStatus }
>(functions, 'setProposalStatus');
export const recomputeAggregates = httpsCallable<
  void,
  { ok: boolean; reviewCount: number; proposalCount: number }
>(functions, 'recomputeAggregates');

export interface HeldEmail {
  kind: string;
  to: string;
  title?: string;
}
export const emailQueue = httpsCallable<
  { action: 'preview' | 'release' | 'retry' },
  {
    ok: boolean;
    tally: Record<string, number>;
    held?: HeldEmail[];
    released?: number;
    settings?: EmailSettings;
  }
>(functions, 'emailQueue');

export const setEmailSettings = httpsCallable<EmailSettings, { ok: boolean }>(
  functions,
  'setEmailSettings',
);

/**
 * The signed-in user's role, or null for the ordinary case of a speaker.
 *
 * Reads `reviewers/{uid}` first and only calls `claimRole` when it is missing,
 * so a returning reviewer costs one document read rather than a function
 * invocation. A speaker pays the callable once per session — that is the price
 * of letting a role be granted before its holder has ever signed in.
 */
export function useRole(user: User | null): { role: Role | null; ready: boolean } {
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setRole(null);
      setReady(true);
      return;
    }

    setReady(false);
    (async () => {
      try {
        const mine = await getDoc(doc(db, 'reviewers', user.uid));
        if (cancelled) return;
        if (mine.exists()) {
          setRole((mine.data() as Reviewer).role);
          return;
        }
        const { data } = await claimRole();
        if (!cancelled) setRole(data.role);
      } catch {
        if (!cancelled) setRole(null); // no role is the safe reading
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { role, ready };
}

export interface Person extends Reviewer {
  uid: string;
}

export async function loadCommittee(): Promise<{ people: Person[]; pending: RoleGrant[] }> {
  const [reviewers, grants] = await Promise.all([
    getDocs(collection(db, 'reviewers')),
    getDocs(collection(db, 'roleGrants')),
  ]);

  return {
    people: reviewers.docs.map((d) => ({ uid: d.id, ...(d.data() as Reviewer) })),
    // Only the ones still waiting — a claimed grant is already a person above.
    pending: grants.docs
      .map((d) => d.data() as RoleGrant)
      .filter((g) => !g.claimedBy),
  };
}

export interface ProposalRow extends Proposal {
  id: string;
}

/**
 * Every proposal the committee is entitled to see.
 *
 * The `!= 'draft'` is not a display choice — the rules deny the whole query
 * without it, because an unsubmitted draft is not the committee's to read.
 */
export async function loadAllProposals(): Promise<ProposalRow[]> {
  const snap = await getDocs(query(collection(db, 'proposals'), where('status', '!=', 'draft')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Proposal) }));
}

export interface ReviewQueue {
  proposals: ProposalRow[];
  /**
   * How many were dropped for being the reviewer's own. An empty queue means
   * something different when the answer is "there are none" than when it is
   * "the only one is yours", and the screen has to be able to say which.
   */
  own: number;
}

/**
 * The proposals a reviewer should score: submitted, and not their own.
 *
 * The exclusion is enforced by the rules as well — this only keeps proposals
 * out of a queue where every one of them would fail to save.
 */
export async function loadReviewQueue(uid: string): Promise<ReviewQueue> {
  const snap = await getDocs(
    query(collection(db, 'proposals'), where('status', 'in', ['submitted', 'under_review'])),
  );
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Proposal) }));
  const proposals = all.filter((p) => !(p.speakerIds ?? []).includes(uid));
  return { proposals, own: all.length - proposals.length };
}

export interface SpeakerBrief {
  name?: string;
  company?: string;
  jobTitle?: string;
  basedIn?: string;
  isGde?: boolean;
}

/** Review is not blind (§7), so the card needs who is speaking. Deduped by uid. */
export async function loadSpeakers(uids: string[]): Promise<Map<string, SpeakerBrief>> {
  const unique = [...new Set(uids)];
  const found = await Promise.all(
    unique.map(async (uid) => {
      const snap = await getDoc(doc(db, 'speakers', uid));
      return snap.exists() ? ([uid, snap.data() as SpeakerBrief] as const) : null;
    }),
  );
  return new Map(found.filter((entry): entry is [string, SpeakerBrief] => entry !== null));
}

/** One-shot, refreshed by the caller after a change — §2 allows no listeners. */
export async function loadCfpConfig(): Promise<Record<string, any> | null> {
  const snap = await getDoc(doc(db, 'config', 'cfp'));
  return snap.exists() ? snap.data() : null;
}
