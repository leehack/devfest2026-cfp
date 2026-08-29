import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit as queryLimit,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { auth, db, functions } from '../firebase';
import { getCached, swrFetch } from './cache';
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
import type {
  Cfp,
  CfpFeatures,
  CfpMember,
  CfpTheme,
  Proposal,
  RoleGrant,
} from '@shared/types';
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
export const grantPlatformAdmin = httpsCallable<
  { email: string },
  { email: string; applied: boolean }
>(functions, 'grantPlatformAdmin');
export const revokePlatformAdmin = httpsCallable<{ email: string }, { email: string }>(
  functions,
  'revokePlatformAdmin',
);
export const initiatePlatformOwnershipTransfer = httpsCallable<
  { email: string },
  { ok: boolean; transferId?: string }
>(functions, 'initiatePlatformOwnershipTransfer');
export const acceptPlatformOwnershipTransfer = httpsCallable<
  Record<string, never>,
  { ok: boolean }
>(functions, 'acceptPlatformOwnershipTransfer');
export const cancelPlatformOwnershipTransfer = httpsCallable<
  Record<string, never>,
  { ok: boolean }
>(functions, 'cancelPlatformOwnershipTransfer');
export const getPlatformOwnershipTransfer = httpsCallable<
  Record<string, never>,
  { ok: boolean; transfer: import('@shared/types').OwnershipTransfer | null }
>(functions, 'getPlatformOwnershipTransfer');

export const initiateEventOwnershipTransfer = httpsCallable<
  In<{ email: string }>,
  { ok: boolean; transferId?: string }
>(functions, 'initiateEventOwnershipTransfer');
export const acceptEventOwnershipTransfer = httpsCallable<
  Just,
  { ok: boolean }
>(functions, 'acceptEventOwnershipTransfer');
export const cancelEventOwnershipTransfer = httpsCallable<
  Just,
  { ok: boolean }
>(functions, 'cancelEventOwnershipTransfer');
export const getEventOwnershipTransfer = httpsCallable<
  Just,
  { ok: boolean; transfer: import('@shared/types').OwnershipTransfer | null }
>(functions, 'getEventOwnershipTransfer');

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
}

export const getPlatformEmailConfiguration = httpsCallable<
  Record<string, never>,
  PlatformEmailConfiguration
>(functions, 'getPlatformEmailConfiguration');
export const setPlatformEmailSettings = httpsCallable<
  Pick<EmailSettings, 'from' | 'replyTo'>,
  { ok: boolean }
>(functions, 'setPlatformEmailSettings');
export const sendPlatformTestEmail = httpsCallable<
  { locale: 'en' | 'fr' },
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
  } | null>(() => {
    if (!uid) return null;
    const cached = getCached<PlatformAccessStatus>(`platformAccess:${uid}`);
    if (cached !== undefined) {
      return { uid, status: cached, ready: true, error: false };
    }
    return null;
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setLookup(null);
      return;
    }

    const cached = getCached<PlatformAccessStatus>(`platformAccess:${uid}`);
    if (cached !== undefined && attempt === 0) {
      setLookup({ uid, status: cached, ready: true, error: false });
    } else {
      setLookup((prev) =>
        prev?.uid === uid ? prev : { uid, status: null, ready: false, error: false },
      );
    }

    void swrFetch(
      `platformAccess:${uid}`,
      async () => {
        const { data } = await platformAccess({});
        return data;
      },
      {
        force: attempt > 0,
        backgroundRevalidate: cached !== undefined && attempt === 0,
        onRevalidate: (fresh) => {
          if (!cancelled) setLookup({ uid, status: fresh, ready: true, error: false });
        },
      },
    )
      .then((data) => {
        if (!cancelled) setLookup({ uid, status: data, ready: true, error: false });
      })
      .catch(() => {
        if (!cancelled) {
          if (cached === undefined || attempt > 0) {
            setLookup({ uid, status: null, ready: true, error: true });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, uid]);

  if (!uid) return { status: null, ready: true, error: false, retry };
  if (!lookup || lookup.uid !== uid) {
    const cached = getCached<PlatformAccessStatus>(`platformAccess:${uid}`);
    if (cached !== undefined) {
      return { status: cached, ready: true, error: false, retry };
    }
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

export const createRoleInviteLink = httpsCallable<
  In<{
    role: CfpRole;
    label?: string;
    maxClaims?: number | null;
    expiresAt?: string | number | null;
  }>,
  { ok: boolean; link: import('@shared/types').RoleInviteLink }
>(functions, 'createRoleInviteLink');

export const revokeRoleInviteLink = httpsCallable<
  In<{ token: string }>,
  { ok: boolean; token: string }
>(functions, 'revokeRoleInviteLink');

export const getRoleInviteLinkInfo = httpsCallable<
  In<{ token: string }>,
  import('@shared/types').RoleInviteLinkPublicInfo
>(functions, 'getRoleInviteLinkInfo');

export const claimRoleInviteLink = httpsCallable<
  In<{ token: string }>,
  { ok: boolean; role: CfpRole; cfpId: string; alreadyMember?: boolean }
>(functions, 'claimRoleInviteLink');
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
  { cfpId: string; name: string; visibility: Visibility; opensAt: string; closesAt: string; orgId: string },
  { ok: boolean; cfpId: string }
>(functions, 'createCfp');

export const updateCfp = httpsCallable<
  In<{ name: string; visibility: Visibility; theme?: CfpTheme; features?: CfpFeatures } & CfpProfile>,
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
      platformSenderName: string;
      replyTo: string | null;
      domainId: string;
      domain: string;
    };
    /** Only leaves stored by this event; absent leaves use built-in copy. */
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
    senderName?: string;
    platformSenderNameOnly?: boolean;
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
  } | null>(() => {
    if (!uid || !cfpId) return null;
    const cached = getCached<CfpRole | null>(`role:${cfpId}:${uid}`);
    if (cached !== undefined) {
      return { uid, cfpId, role: cached, ready: true, error: false };
    }
    return null;
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!uid || !cfpId) {
      setLookup(null);
      return;
    }

    const scope = { uid, cfpId };
    const cached = getCached<CfpRole | null>(`role:${cfpId}:${uid}`);
    if (cached !== undefined && attempt === 0) {
      setLookup({ ...scope, role: cached, ready: true, error: false });
    } else {
      setLookup((prev) =>
        prev?.uid === uid && prev.cfpId === cfpId
          ? prev
          : { ...scope, role: null, ready: false, error: false },
      );
    }

    void swrFetch(
      `role:${cfpId}:${uid}`,
      async () => {
        const mine = await getDoc(doc(db, 'cfps', cfpId, 'members', uid));
        if (mine.exists()) {
          return (mine.data() as CfpMember).role;
        }
        const { data } = await claimRole({ cfpId });
        return data.role;
      },
      {
        force: attempt > 0,
        backgroundRevalidate: cached !== undefined && attempt === 0,
        onRevalidate: (freshRole) => {
          if (!cancelled) {
            setLookup({ ...scope, role: freshRole, ready: true, error: false });
          }
        },
      },
    )
      .then((role) => {
        if (!cancelled) {
          setLookup({ ...scope, role, ready: true, error: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (cached === undefined || attempt > 0) {
            setLookup({ ...scope, role: null, ready: true, error: true });
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [uid, cfpId, attempt]);

  if (!uid || !cfpId) return { role: null, ready: true, error: false, retry };
  if (!lookup || lookup.uid !== uid || lookup.cfpId !== cfpId) {
    const cached = getCached<CfpRole | null>(`role:${cfpId}:${uid}`);
    if (cached !== undefined) {
      return { role: cached, ready: true, error: false, retry };
    }
    return { role: null, ready: false, error: false, retry };
  }
  return { role: lookup.role, ready: lookup.ready, error: lookup.error, retry };
}

export interface Person extends CfpMember {
  uid: string;
}

function getLinkTimestamp(raw: unknown): number {
  if (!raw) return 0;
  if (typeof (raw as any)?.toMillis === 'function') return (raw as any).toMillis();
  if (typeof (raw as any)?.seconds === 'number') return (raw as any).seconds * 1000;
  if (typeof raw === 'string' || typeof raw === 'number') return new Date(raw).getTime();
  return 0;
}

export async function loadInviteLinks(
  cfpId: string,
  isOwner = false,
): Promise<import('@shared/types').RoleInviteLink[]> {
  const col = collection(db, 'cfps', cfpId, 'roleInviteLinks');
  const q = isOwner ? col : query(col, where('role', '==', 'reviewer'));
  const snap = await getDocs(q);
  const links: import('@shared/types').RoleInviteLink[] = [];
  snap.forEach((d) => {
    links.push({ id: d.id, ...(d.data() as Omit<import('@shared/types').RoleInviteLink, 'id'>) });
  });
  links.sort((a, b) => getLinkTimestamp(b.createdAt) - getLinkTimestamp(a.createdAt));
  return links;
}

export async function loadCommittee(
  cfpId: string,
  options: {
    force?: boolean;
    onRevalidate?: (committee: {
      people: Person[];
      pending: RoleGrant[];
      inviteLinks: import('@shared/types').RoleInviteLink[];
    }) => void;
  } = {},
): Promise<{
  people: Person[];
  pending: RoleGrant[];
  inviteLinks: import('@shared/types').RoleInviteLink[];
}> {
  const viewerUid = auth.currentUser?.uid ?? 'anon';
  return swrFetch(
    `committee:${cfpId}:${viewerUid}`,
    async () => {
      const col = collection(db, 'cfps', cfpId, 'roleInviteLinks');
      const [members, grants] = await Promise.all([
        getDocs(collection(db, 'cfps', cfpId, 'members')),
        getDocs(collection(db, 'cfps', cfpId, 'roleGrants')),
      ]);

      const people = members.docs.map((d) => ({ ...(d.data() as CfpMember), uid: d.id }));
      const linksSnap = await getDocs(col).catch(async () => {
        return getDocs(query(col, where('role', '==', 'reviewer'))).catch(() => ({ docs: [] }));
      });

      const inviteLinks: import('@shared/types').RoleInviteLink[] = linksSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<import('@shared/types').RoleInviteLink, 'id'>),
      }));
      inviteLinks.sort((a, b) => getLinkTimestamp(b.createdAt) - getLinkTimestamp(a.createdAt));

      return {
        people,
        // Only the ones still waiting — a claimed grant is already a person above.
        pending: grants.docs
          .map((d) => d.data() as RoleGrant)
          .filter((g) => !g.claimedBy),
        inviteLinks,
      };
    },
    { force: options.force, backgroundRevalidate: true, onRevalidate: options.onRevalidate },
  );
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
  options: {
    speakerDetails?: boolean;
    force?: boolean;
    onRevalidate?: (proposals: ProposalRow[]) => void;
  } = {},
): Promise<ProposalRow[]> {
  const key = `allProposals:${cfpId}:${Boolean(options.speakerDetails)}`;
  return swrFetch(
    key,
    async () => {
      const snap = await getDocs(
        query(collection(db, 'cfps', cfpId, 'proposals'), where('status', '!=', 'draft')),
      );
      const multiSpeaker = options.speakerDetails
        ? snap.docs.filter((proposal) => {
            const data = proposal.data();
            return (
              Boolean(data.primarySpeakerId) ||
              (Array.isArray(data.speakerIds) && data.speakerIds.length > 1)
            );
          })
        : [];
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
    },
    {
      force: options.force,
      backgroundRevalidate: true,
      onRevalidate: options.onRevalidate,
    },
  );
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
export async function loadReviewQueue(
  cfpId: string,
  options: { force?: boolean; onRevalidate?: (queue: ReviewQueue) => void } = {},
): Promise<ReviewQueue> {
  const uid = auth.currentUser?.uid ?? 'anon';
  return swrFetch(
    `reviewQueue:${cfpId}:${uid}`,
    async () => {
      const { data } = await reviewQueueCall({ cfpId });
      return { proposals: data.proposals, own: data.own };
    },
    { force: options.force, backgroundRevalidate: true, onRevalidate: options.onRevalidate },
  );
}

/** One-shot, refreshed by the caller after a change — §2 allows no listeners. */
export async function loadCfp(
  cfpId: string,
  options: { force?: boolean; onRevalidate?: (cfp: Cfp | null) => void } = {},
): Promise<Cfp | null> {
  return swrFetch(
    `cfp:${cfpId}`,
    async () => {
      const snap = await getDoc(doc(db, 'cfps', cfpId));
      return snap.exists() ? (snap.data() as Cfp) : null;
    },
    { force: options.force, backgroundRevalidate: true, onRevalidate: options.onRevalidate },
  );
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
export const PUBLIC_CFP_PAGE_SIZE = 12;
export type PublicCfpCursor = QueryDocumentSnapshot<DocumentData>;

export async function loadPublicCfpPage(cursor?: PublicCfpCursor): Promise<{
  cfps: CfpSummary[];
  cursor: PublicCfpCursor | null;
  hasMore: boolean;
}> {
  const snap = await getDocs(
    query(
      collection(db, 'cfps'),
      where('visibility', '==', 'public'),
      where('archived', '==', false),
      ...(cursor ? [startAfter(cursor)] : []),
      queryLimit(PUBLIC_CFP_PAGE_SIZE + 1),
    ),
  );
  const visible = snap.docs.slice(0, PUBLIC_CFP_PAGE_SIZE);
  return {
    cfps: visible.map((d) => ({ id: d.id, ...(d.data() as Cfp) })),
    cursor: snap.size > PUBLIC_CFP_PAGE_SIZE ? visible.at(-1) ?? null : null,
    hasMore: snap.size > PUBLIC_CFP_PAGE_SIZE,
  };
}

/** The CFPs this account owns — including private and archived ones. */
export async function loadMyCfps(uid: string): Promise<CfpSummary[]> {
  const snap = await getDocs(
    query(collection(db, 'cfps'), where('ownerUid', '==', uid)),
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
