import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { db, functions } from '../firebase';
import { STATUS_SETS, type AttendanceStatus, type ProposalStatus } from '@shared/enums';
import type { CfpProfile, CfpRole, Visibility } from '@shared/cfp';
import type { EmailSettings } from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
import type {
  ConfirmedSpeakerPhoto,
  ConfirmField,
  SpeakerPhotoQuestion,
} from '@shared/confirmForm';
import type { SubmissionForm } from '@shared/submissionForm';
import type { Cfp, CfpMember, Proposal, RoleGrant } from '@shared/types';
import type {
  PlatformAccessDirectory,
  PlatformAccessStatus,
} from '@shared/platform';

/**
 * Every callable below takes a `cfpId`, and the server checks the caller's role
 * against that id rather than against whatever CFP it might have guessed. The
 * type says so, so a call site cannot forget it.
 */
type In<T = unknown> = T & { cfpId: string };

/** The ones whose only argument is which CFP. */
type Just = { cfpId: string };

export const platformAccess = httpsCallable<Record<string, never>, PlatformAccessStatus>(
  functions,
  'platformAccess',
);
export const listPlatformUsers = httpsCallable<
  Record<string, never>,
  { ok: boolean } & PlatformAccessDirectory
>(functions, 'listPlatformUsers');
export const grantCfpCreator = httpsCallable<
  { email: string },
  { email: string; applied: boolean }
>(functions, 'grantCfpCreator');
export const revokeCfpCreator = httpsCallable<{ email: string }, { email: string }>(
  functions,
  'revokeCfpCreator',
);
export const grantPlatformAdmin = httpsCallable<
  { email: string },
  { email: string; applied: boolean }
>(functions, 'grantPlatformAdmin');
export const revokePlatformAdmin = httpsCallable<{ email: string }, { email: string }>(
  functions,
  'revokePlatformAdmin',
);

export interface PlatformEmailConfiguration {
  ok: boolean;
  settings: EmailSettings;
  keyHint: string;
  /** Active, platform-bound identity used by inheriting events. */
  domainId: string;
  domain: string;
  /** Candidate identity under DNS setup; it is inert until explicit activation. */
  stagedDomainId: string;
  stagedDomain: string;
  delivery: EmailDeliveryReadiness;
  templates: TemplateOverrides;
}

export const getPlatformEmailConfiguration = httpsCallable<
  Record<string, never>,
  PlatformEmailConfiguration
>(functions, 'getPlatformEmailConfiguration');
export const setPlatformEmailSettings = httpsCallable<
  Pick<EmailSettings, 'from' | 'replyTo'>,
  { ok: boolean }
>(functions, 'setPlatformEmailSettings');
export const setPlatformEmailTemplate = httpsCallable<
  { kind: string; locale: string; subject?: string; body?: string; reset?: boolean },
  { ok: boolean }
>(functions, 'setPlatformEmailTemplate');
export const sendPlatformTestEmail = httpsCallable<
  { kind: string; locale: string; needsVisa?: boolean },
  { ok: boolean; status: string; to: string }
>(functions, 'sendPlatformTestEmail');

export function usePlatformAccess(user: User | null): {
  status: PlatformAccessStatus | null;
  ready: boolean;
  error: boolean;
  retry: () => void;
} {
  const uid = user?.uid ?? null;
  const [lookup, setLookup] = useState<{
    uid: string;
    status: PlatformAccessStatus | null;
    ready: boolean;
    error: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setLookup(null);
      return;
    }

    setLookup({ uid, status: null, ready: false, error: false });
    platformAccess({})
      .then(({ data }) => {
        if (!cancelled) setLookup({ uid, status: data, ready: true, error: false });
      })
      .catch(() => {
        if (!cancelled) setLookup({ uid, status: null, ready: true, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, uid]);

  if (!uid) return { status: null, ready: true, error: false, retry };
  if (!lookup || lookup.uid !== uid) {
    return { status: null, ready: false, error: false, retry };
  }
  return { status: lookup.status, ready: lookup.ready, error: lookup.error, retry };
}

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

export interface ReviewCoverageReviewer {
  uid: string;
  name: string;
  email: string;
  role: CfpRole;
  eligibleCount: number;
  scoredProposalIds: string[];
  conflictProposalIds: string[];
  missingProposalIds: string[];
}

export interface ReviewCoverageResult {
  ok: boolean;
  hiddenOwnProposalCount: number;
  proposals: Array<{ id: string; title: string }>;
  reviewers: ReviewCoverageReviewer[];
}

export const reviewCoverage = httpsCallable<Just, ReviewCoverageResult>(
  functions,
  'reviewCoverage',
);

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
  logId: string;
  kind: string;
  to: string;
  title?: string;
}

export type EmailDeliveryProblem =
  | 'missing_key'
  | 'invalid_key'
  | 'missing_domain'
  | 'domain_unverified'
  | 'invalid_sender'
  | 'sender_domain_mismatch'
  | 'setup_unavailable';

export interface EmailDeliveryReadiness {
  ready: boolean;
  problems: EmailDeliveryProblem[];
  domainStatus: string;
}

export interface RetryableEmail extends HeldEmail {
  status: string;
  recoverable?: boolean;
}

export const emailQueue = httpsCallable<
  | In<{ action: 'readiness' | 'summary' | 'preview' }>
  | In<{
      action: 'release' | 'retry';
      logIds: string[];
      reviewedRecipients: Array<{ logId: string; to: string }>;
      emailConfigurationFingerprint: string;
    }>
  | In<{
      action: 'resend';
      logId: string;
      reviewedTo: string;
      emailConfigurationFingerprint: string;
    }>,
  {
    ok: boolean;
    /** Sendable decision emails, without returning their recipient data. */
    waiting?: number;
    tally?: Record<string, number>;
    held?: HeldEmail[];
    /** Additional sendable held rows available after this bounded review batch. */
    heldRemaining?: number;
    /** Held rows whose proposal no longer has that decision. */
    staleHeld?: number;
    /** Sending rows whose delivery lease expired and can be retried safely. */
    recoverableSending?: number;
    /** Current failed, setup-incomplete, or expired deliveries needing an admin. */
    needsAttention?: number;
    /** Exact current rows the bulk retry action would move back to the queue. */
    retryable?: RetryableEmail[];
    /** Additional retryable rows available after this bounded review batch. */
    retryableRemaining?: number;
    /** Server-checked provider and sender readiness for delivery actions. */
    delivery?: EmailDeliveryReadiness;
    released?: number;
    emailConfigurationFingerprint?: string;
    settings?: EmailSettings;
    /** Last four characters of the API key — never the key. */
    keyHint?: string;
    domainId?: string;
    /** The verified domain's name, to check the sender against. */
    domain?: string;
    templates?: TemplateOverrides;
    /** Effective source after resolving the event's selected mode. */
    source?: 'platform' | 'event';
    senderMode?: 'platform' | 'event';
    eventSettings?: {
      from: string;
      replyTo: string | null;
      domainId: string;
      domain: string;
    };
    /** Only leaves stored by this event; effective `templates` may include platform defaults. */
    templateOverrides?: TemplateOverrides;
    rows?: EmailRow[];
    /** How many rows the cap left out, so it never reads as "that is all". */
    truncated?: number;
  }
>(functions, 'emailQueue');

export interface EmailRow {
  logId: string;
  kind: string;
  /** Current server-resolved address used when an admin reviews a resend. */
  currentTo: string;
  /** Historical address used by the recorded attempt. */
  to: string;
  status: string;
  attempts: number;
  title: string;
  /** Only a message has one — the templates take theirs from the copy. */
  subject: string;
  /** Milliseconds, because a Timestamp does not survive the callable's JSON. */
  sentAt: number | null;
  /** The latest provider attempt, whether it delivered or not. */
  attemptedAt: number | null;
  error: string;
  /** Stable code for failures authored by this application; provider prose has none. */
  errorReason: string;
  /** Retained in storage, but not currently eligible for release. */
  stale?: boolean;
  /** Its sending lease expired, so the bulk retry action can recover it. */
  recoverable?: boolean;
}

export const setEmailSettings = httpsCallable<
  In<{
    senderMode: 'platform' | 'event';
    from?: string;
    replyTo?: string | null;
    replyToOnly?: boolean;
  }>,
  { ok: boolean }
>(
  functions,
  'setEmailSettings',
);

/** The key goes up and never comes back — `keyHint` is the last four characters. */
export const setEmailSecret = httpsCallable<{ apiKey: string }, { ok: boolean; keyHint: string }>(
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

export const platformEmailDomain = httpsCallable<
  { action: 'list' | 'add' | 'get' | 'verify' | 'activate'; domain?: string },
  { ok: boolean; domains?: Domain[]; domain?: Domain; activated?: boolean }
>(functions, 'platformEmailDomain');

export const setEmailTemplate = httpsCallable<
  In<{ kind: string; locale: string; subject?: string; body?: string; reset?: boolean }>,
  { ok: boolean }
>(functions, 'setEmailTemplate');

export const sendTestEmail = httpsCallable<
  In<{ kind: string; locale: string; needsVisa?: boolean }>,
  { ok: boolean; status: string; to: string }
>(functions, 'sendTestEmail');

export const headshotImage = httpsCallable<
  In<{ proposalId: string; key: string; speakerUid?: string }>,
  { ok: boolean; dataUrl: string }
>(functions, 'headshotImage');

export const setConfirmForm = httpsCallable<
  In<{ fields: ConfirmField[]; speakerPhoto?: SpeakerPhotoQuestion }>,
  { ok: true; fields: ConfirmField[]; speakerPhoto?: SpeakerPhotoQuestion }
>(functions, 'setConfirmForm');

export const setSubmissionForm = httpsCallable<
  In<SubmissionForm>,
  { ok: boolean; form: SubmissionForm }
>(functions, 'setSubmissionForm');

export interface SpeakerMessageRecipient {
  uid: string;
  to: string;
  name: string;
}

export const sendSpeakerMessage = httpsCallable<
  In<
    | { action: 'preview'; proposalId: string }
    | {
        action: 'send';
        proposalId: string;
        subject: string;
        body: string;
        expectedRecipientsFingerprint: string;
        expectedEmailConfigurationFingerprint: string;
      }
  >,
  {
    ok: boolean;
    logId?: string;
    logIds?: string[];
    recipientCount?: number;
    recipients?: SpeakerMessageRecipient[];
    recipientsFingerprint?: string;
    emailConfigurationFingerprint?: string;
  }
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
): { role: CfpRole | null; ready: boolean; error: boolean; retry: () => void } {
  const uid = user?.uid ?? null;
  const [lookup, setLookup] = useState<{
    uid: string;
    cfpId: string;
    role: CfpRole | null;
    ready: boolean;
    error: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!uid || !cfpId) {
      setLookup(null);
      return;
    }

    const scope = { uid, cfpId };
    setLookup({ ...scope, role: null, ready: false, error: false });
    (async () => {
      let role: CfpRole | null = null;
      let error = false;
      try {
        const mine = await getDoc(doc(db, 'cfps', cfpId, 'members', uid));
        if (cancelled) return;
        if (mine.exists()) {
          role = (mine.data() as CfpMember).role;
        } else {
          const { data } = await claimRole({ cfpId });
          if (cancelled) return;
          role = data.role;
        }
      } catch {
        // A missing membership is an ordinary speaker and is answered by
        // `claimRole` with `{role:null}`. Reaching here means neither read nor
        // claim completed, so calling it "forbidden" would turn an outage into a
        // false statement about the person's account.
        error = true;
      } finally {
        if (!cancelled) setLookup({ ...scope, role, ready: true, error });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, cfpId, attempt]);

  if (!uid || !cfpId) return { role: null, ready: true, error: false, retry };
  if (!lookup || lookup.uid !== uid || lookup.cfpId !== cfpId) {
    return { role: null, ready: false, error: false, retry };
  }
  return { role: lookup.role, ready: lookup.ready, error: lookup.error, retry };
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
  speakerConfirmations?: Array<{
    uid: string;
    response?: 'confirmed' | 'declined';
    answers?: Record<string, any>;
    speakerPhoto?: ConfirmedSpeakerPhoto;
  }>;
  speakerParticipants?: Array<{
    uid: string;
    role?: 'primary' | 'coSpeaker';
    acks?: Record<string, boolean>;
    attendance?: Record<string, any>;
  }>;
}

/** Admin-only proposal load for decisions, exports, and organiser operations. */
export async function loadAllProposals(
  cfpId: string,
  options: { speakerDetails?: boolean } = {},
): Promise<ProposalRow[]> {
  const snap = await getDocs(
    query(collection(db, 'cfps', cfpId, 'proposals'), where('status', '!=', 'draft')),
  );
  const multiSpeaker = options.speakerDetails ? snap.docs.filter((proposal) => {
    const data = proposal.data();
    return Boolean(data.primarySpeakerId) ||
      (Array.isArray(data.speakerIds) && data.speakerIds.length > 1);
  }) : [];
  const [confirmationReads, participantReads] = await Promise.all([
    Promise.all(
      multiSpeaker.map((proposal) =>
        getDocs(
          collection(
            db,
            'cfps',
            cfpId,
            'proposals',
            proposal.id,
            'speakerConfirmations',
          ),
        ),
      ),
    ),
    Promise.all(
      multiSpeaker.map((proposal) =>
        getDocs(
          collection(
            db,
            'cfps',
            cfpId,
            'proposals',
            proposal.id,
            'speakerParticipants',
          ),
        ),
      ),
    ),
  ]);
  const confirmations = new Map(
    multiSpeaker.map((proposal, index) => [proposal.id, confirmationReads[index]]),
  );
  const participants = new Map(
    multiSpeaker.map((proposal, index) => [proposal.id, participantReads[index]]),
  );
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Proposal),
    speakerConfirmations: (confirmations.get(d.id)?.docs ?? [])
      .filter((confirmation) => {
        const speakerIds = d.data().speakerIds;
        return Array.isArray(speakerIds) && speakerIds.includes(confirmation.id);
      })
      .map((confirmation) => ({
        uid: confirmation.id,
        response: confirmation.data().response,
        answers: confirmation.data().answers,
        speakerPhoto: confirmation.data().speakerPhoto,
      })),
    speakerParticipants: (participants.get(d.id)?.docs ?? [])
      .filter((participant) => participant.data().status === 'active')
      .map((participant) => ({
        uid: participant.id,
        role: participant.data().role,
        acks: participant.data().acks,
        attendance: participant.data().attendance,
      })),
  }));
}

export interface ReviewQueue {
  proposals: ReviewerProposalRow[];
  /**
   * How many were dropped for being the reviewer's own. An empty queue means
   * something different when the answer is "there are none" than when it is
   * "the only one is yours", and the screen has to be able to say which.
   */
  own: number;
}

export interface ReviewerSpeakerTravel {
  uid: string;
  /** Frozen with the proposal, like the speaker profile shown on the review card. */
  name: string;
  status?: AttendanceStatus;
  fundingSource?: string;
  decisionBy?: string;
  needsVisa?: boolean;
}

export type ReviewerProposalRow = Pick<
  Proposal,
  | 'speakerSnapshot'
  | 'title'
  | 'abstract'
  | 'pitch'
  | 'category'
  | 'format'
  | 'level'
  | 'deliveryLanguage'
  | 'languagePreference'
  | 'answers'
  | 'aggregate'
> & {
  id: string;
  status: (typeof STATUS_SETS.reviewQueue)[number];
  submittedAt?: number;
  /** A callable-owned, field-by-field projection for each active speaker. */
  speakerTravel?: ReviewerSpeakerTravel[];
};

const reviewQueueCall = httpsCallable<
  Just,
  { ok: boolean; proposals: ReviewerProposalRow[]; own: number }
>(functions, 'reviewQueue');

/**
 * The proposals a reviewer should score: submitted, and not their own.
 *
 * The callable filters active and former speakers before returning its public
 * review projection. Review writes enforce the same conflict independently.
 */
export async function loadReviewQueue(cfpId: string): Promise<ReviewQueue> {
  const { data } = await reviewQueueCall({ cfpId });
  return { proposals: data.proposals, own: data.own };
}

/** One-shot, refreshed by the caller after a change — §2 allows no listeners. */
export async function loadCfp(cfpId: string): Promise<Cfp | null> {
  const snap = await getDoc(doc(db, 'cfps', cfpId));
  return snap.exists() ? (snap.data() as Cfp) : null;
}

export interface CfpSummary extends Cfp {
  id: string;
}

export interface CfpMembershipSummary extends CfpSummary {
  role: CfpRole;
}

export interface CfpProposalActivity extends CfpSummary {
  proposalStatuses: ProposalStatus[];
  activityUpdatedAt: unknown;
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
export async function loadMyMemberships(uid: string): Promise<CfpMembershipSummary[]> {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)));
  const roles = new Map(
    snap.docs
      .map((d) => d.data() as CfpMember)
      .filter((member) => member.cfpId)
      .map((member) => [member.cfpId, member.role] as const),
  );

  const found = await Promise.all(
    [...roles].map(async ([id, role]) => {
      const cfp = await getDoc(doc(db, 'cfps', id));
      return cfp.exists()
        ? ({ id, role, ...(cfp.data() as Cfp) } as CfpMembershipSummary)
        : null;
    }),
  );
  return found.filter((cfp): cfp is CfpMembershipSummary => cfp !== null);
}

/**
 * Every CFP where this account has written a proposal, including private,
 * closed and archived ones. The direct collection-group query is why proposals
 * carry `cfpId` and why `speakerIds` has a collection-group index.
 */
export async function loadMyProposalCfps(uid: string): Promise<CfpProposalActivity[]> {
  const snap = await getDocs(
    query(collectionGroup(db, 'proposals'), where('speakerIds', 'array-contains', uid)),
  );
  const grouped = new Map<
    string,
    { statuses: ProposalStatus[]; updatedAt: unknown; updatedMillis: number }
  >();

  for (const proposalDoc of snap.docs) {
    const proposal = proposalDoc.data() as Proposal;
    if (!proposal.cfpId) continue;
    const updatedMillis =
      (proposal.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const current = grouped.get(proposal.cfpId);
    grouped.set(proposal.cfpId, {
      statuses: [...(current?.statuses ?? []), proposal.status],
      updatedAt:
        !current || updatedMillis >= current.updatedMillis
          ? proposal.updatedAt
          : current.updatedAt,
      updatedMillis: Math.max(updatedMillis, current?.updatedMillis ?? 0),
    });
  }

  const found = await Promise.all(
    [...grouped].map(async ([id, activity]) => {
      const cfp = await getDoc(doc(db, 'cfps', id));
      return cfp.exists()
        ? ({
            id,
            ...(cfp.data() as Cfp),
            proposalStatuses: activity.statuses,
            activityUpdatedAt: activity.updatedAt,
          } as CfpProposalActivity)
        : null;
    }),
  );
  return found.filter((cfp): cfp is CfpProposalActivity => cfp !== null);
}
