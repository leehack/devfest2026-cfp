import { useEffect, useState } from 'react';
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import type { ProposalStatus } from '@shared/enums';
import type { CfpProfile, CfpRole, Visibility } from '@shared/cfp';
import type { EmailSettings } from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
import type { ConfirmField } from '@shared/confirmForm';
import type { Cfp, CfpMember, Proposal, RoleGrant } from '@shared/types';

/**
 * Every callable below takes a `cfpId`, and the server checks the caller's role
 * against that id rather than against whatever CFP it might have guessed. The
 * type says so, so a call site cannot forget it.
 */
type In<T = unknown> = T & { cfpId: string };

/** The ones whose only argument is which CFP. */
type Just = { cfpId: string };

export const claimRole = httpsCallable<Just, { role: CfpRole | null }>(functions, 'claimRole');
export const grantRole = httpsCallable<
  In<{ email: string; role: CfpRole }>,
  { email: string; role: CfpRole; applied: boolean }
>(functions, 'grantRole');
export const revokeRole = httpsCallable<In<{ email: string }>, { email: string }>(
  functions,
  'revokeRole',
);
export const setCfpWindow = httpsCallable<
  In<{ opensAt?: string; closesAt?: string; paused?: boolean; reviewsVisible?: boolean }>,
  { ok: boolean }
>(functions, 'setCfpWindow');
export const setProposalStatus = httpsCallable<
  In<{ proposalId: string; status: string }>,
  { ok: boolean; proposalId: string; status: ProposalStatus }
>(functions, 'setProposalStatus');
export const recomputeAggregates = httpsCallable<
  Just,
  { ok: boolean; reviewCount: number; proposalCount: number }
>(functions, 'recomputeAggregates');

// ------------------------------------------------------------ the CFP itself

export const createCfp = httpsCallable<
  { cfpId: string; name: string; visibility: Visibility; opensAt: string; closesAt: string },
  { ok: boolean; cfpId: string }
>(functions, 'createCfp');

export const updateCfp = httpsCallable<
  In<{ name: string; visibility: Visibility } & CfpProfile>,
  { ok: boolean }
>(functions, 'updateCfp');

export const archiveCfp = httpsCallable<In<{ archived: boolean }>, { ok: boolean; archived: boolean }>(
  functions,
  'archiveCfp',
);

/** `confirm` is the id typed back. Deleting takes other people's writing with it. */
export const deleteCfp = httpsCallable<In<{ confirm: string }>, { ok: boolean }>(
  functions,
  'deleteCfp',
);

export interface HeldEmail {
  kind: string;
  to: string;
  title?: string;
}
export const emailQueue = httpsCallable<
  In<{ action: 'preview' | 'release' | 'retry' | 'resend'; logId?: string }>,
  {
    ok: boolean;
    tally: Record<string, number>;
    held?: HeldEmail[];
    released?: number;
    settings?: EmailSettings;
    /** Last four characters of the API key — never the key. */
    keyHint?: string;
    domainId?: string;
    /** The verified domain's name, to check the sender against. */
    domain?: string;
    templates?: TemplateOverrides;
    rows?: EmailRow[];
    /** How many rows the cap left out, so it never reads as "that is all". */
    truncated?: number;
  }
>(functions, 'emailQueue');

export interface EmailRow {
  logId: string;
  kind: string;
  to: string;
  status: string;
  attempts: number;
  title: string;
  /** Only a message has one — the templates take theirs from the copy. */
  subject: string;
  /** Milliseconds, because a Timestamp does not survive the callable's JSON. */
  sentAt: number | null;
  error: string;
}

export const setEmailSettings = httpsCallable<In<EmailSettings>, { ok: boolean }>(
  functions,
  'setEmailSettings',
);

/** The key goes up and never comes back — `keyHint` is the last four characters. */
export const setEmailSecret = httpsCallable<In<{ apiKey: string }>, { ok: boolean; keyHint: string }>(
  functions,
  'setEmailSecret',
);

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}
export interface Domain {
  id: string;
  name: string;
  status: string;
  records: DnsRecord[];
}

export const emailDomain = httpsCallable<
  In<{ action: 'list' | 'add' | 'get' | 'verify'; domain?: string }>,
  { ok: boolean; domains?: Domain[]; domain?: Domain }
>(functions, 'emailDomain');

export const setEmailTemplate = httpsCallable<
  In<{ kind: string; locale: string; subject?: string; body?: string; reset?: boolean }>,
  { ok: boolean }
>(functions, 'setEmailTemplate');

export const sendTestEmail = httpsCallable<
  In<{ kind: string; locale: string; needsVisa?: boolean }>,
  { ok: boolean; status: string; to: string }
>(functions, 'sendTestEmail');

export const headshotImage = httpsCallable<
  In<{ speakerUid: string; key: string }>,
  { ok: boolean; dataUrl: string }
>(functions, 'headshotImage');

export const setConfirmForm = httpsCallable<
  In<{ fields: ConfirmField[] }>,
  { ok: boolean; fields: ConfirmField[] }
>(functions, 'setConfirmForm');

export const sendSpeakerMessage = httpsCallable<
  In<{ proposalId: string; subject: string; body: string }>,
  { ok: boolean; logId: string }
>(functions, 'sendSpeakerMessage');

/**
 * The signed-in user's role on one CFP, or null for the ordinary case of a
 * speaker.
 *
 * Reads `cfps/{cfpId}/members/{uid}` first and only calls `claimRole` when it is
 * missing, so a returning reviewer costs one document read rather than a
 * function invocation. A speaker pays the callable once per CFP per session —
 * that is the price of letting a role be granted before its holder has ever
 * signed in.
 */
export function useRole(
  user: User | null,
  cfpId: string | null,
): { role: CfpRole | null; ready: boolean } {
  const [role, setRole] = useState<CfpRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user || !cfpId) {
      setRole(null);
      setReady(true);
      return;
    }

    setReady(false);
    (async () => {
      try {
        const mine = await getDoc(doc(db, 'cfps', cfpId, 'members', user.uid));
        if (cancelled) return;
        if (mine.exists()) {
          setRole((mine.data() as CfpMember).role);
          return;
        }
        const { data } = await claimRole({ cfpId });
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
  }, [user, cfpId]);

  return { role, ready };
}

export interface Person extends CfpMember {
  uid: string;
}

export async function loadCommittee(
  cfpId: string,
): Promise<{ people: Person[]; pending: RoleGrant[] }> {
  const [members, grants] = await Promise.all([
    getDocs(collection(db, 'cfps', cfpId, 'members')),
    getDocs(collection(db, 'cfps', cfpId, 'roleGrants')),
  ]);

  return {
    people: members.docs.map((d) => ({ ...(d.data() as CfpMember), uid: d.id })),
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
export async function loadAllProposals(cfpId: string): Promise<ProposalRow[]> {
  const snap = await getDocs(
    query(collection(db, 'cfps', cfpId, 'proposals'), where('status', '!=', 'draft')),
  );
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
export async function loadReviewQueue(cfpId: string, uid: string): Promise<ReviewQueue> {
  const snap = await getDocs(
    query(
      collection(db, 'cfps', cfpId, 'proposals'),
      where('status', 'in', ['submitted', 'under_review']),
    ),
  );
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Proposal) }));
  const proposals = all.filter((p) => !(p.speakerIds ?? []).includes(uid));
  return { proposals, own: all.length - proposals.length };
}

/** One-shot, refreshed by the caller after a change — §2 allows no listeners. */
export async function loadCfp(cfpId: string): Promise<Cfp | null> {
  const snap = await getDoc(doc(db, 'cfps', cfpId));
  return snap.exists() ? (snap.data() as Cfp) : null;
}

export interface CfpSummary extends Cfp {
  id: string;
}

/**
 * The public directory.
 *
 * Both filters are carried by the query rather than applied afterwards. Rules
 * are not filters: the `list` rule allows exactly this query, and a listing that
 * asked for anything wider would be denied outright rather than trimmed.
 */
export async function loadPublicCfps(): Promise<CfpSummary[]> {
  const snap = await getDocs(
    query(
      collection(db, 'cfps'),
      where('visibility', '==', 'public'),
      where('archived', '==', false),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Cfp) }));
}

/** The CFPs this account owns — including private and archived ones. */
export async function loadMyCfps(uid: string): Promise<CfpSummary[]> {
  const snap = await getDocs(
    query(collection(db, 'cfps'), where('ownerUids', 'array-contains', uid)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Cfp) }));
}

/**
 * The CFPs this account has a role on, owner or not.
 *
 * A collection-group query on `members`, which is why `uid` is denormalised
 * onto each membership document: the rule matches on that field, since a rule
 * cannot read the path wildcard of a collection-group match.
 *
 * Then one `get` each, because a private CFP is not listable — `allow get: if
 * true` is what makes "private means unlisted, not secret" work, and it is
 * exactly the access needed here. Without this, somebody invited to review a
 * private call could only ever reach it through the link in their invitation.
 */
export async function loadMyMemberships(uid: string): Promise<CfpSummary[]> {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)));
  const ids = [...new Set(snap.docs.map((d) => (d.data() as CfpMember).cfpId).filter(Boolean))];

  const found = await Promise.all(
    ids.map(async (id) => {
      const cfp = await getDoc(doc(db, 'cfps', id));
      return cfp.exists() ? ({ id, ...(cfp.data() as Cfp) } as CfpSummary) : null;
    }),
  );
  return found.filter((cfp): cfp is CfpSummary => cfp !== null);
}
