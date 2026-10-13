import { randomUUID } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { ROLE_INVITE_LINK_LIMITS } from '../../shared/cfp';
import { LIMITS, inStatusSet } from '../../shared/enums';
import type { LateSubmissionLink, LateSubmissionLinkPublicInfo } from '../../shared/types';
import { RoleError, normalizeEmail, normalizeInviteToken } from './roles';

export const lateSubmissionLinkDoc = (db: Firestore, cfpId: string, token: string) =>
  db.doc(`cfps/${cfpId}/lateSubmissionLinks/${token}`);

/**
 * Whether a proposal created from a late-submission link may still be edited,
 * managed by its primary speaker, or submitted while the main CFP window is closed.
 */
export function lateSubmissionLinkOpenForProposal(
  cfp: DocumentSnapshot,
  proposal: DocumentSnapshot,
  lateLink: DocumentSnapshot | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!cfp.exists || cfp.get('deleting') === true || cfp.get('archived') === true) {
    return false;
  }
  const rawLinkId = proposal.get('lateSubmissionLinkId');
  const linkId = typeof rawLinkId === 'string' ? rawLinkId.trim() : '';
  if (!linkId || !lateLink || !lateLink.exists || lateLink.id !== linkId) {
    return false;
  }
  if (lateLink.get('revokedAt')) {
    return false;
  }
  const expiresAt = lateLink.get('expiresAt') as Timestamp | null | undefined;
  if (expiresAt && expiresAt.toMillis() <= nowMs) {
    return false;
  }
  const speakerIds = Array.isArray(proposal.get('speakerIds'))
    ? (proposal.get('speakerIds') as string[])
    : [];
  const rawPrimary = proposal.get('primarySpeakerId');
  const primaryUid =
    typeof rawPrimary === 'string' && rawPrimary.trim()
      ? rawPrimary.trim()
      : (speakerIds[0] ?? '');
  if (!primaryUid) {
    return false;
  }
  const claimedUids = (lateLink.get('claimedUids') ?? {}) as Record<
    string,
    { proposalId?: string } | undefined
  >;
  return claimedUids[primaryUid]?.proposalId === proposal.id;
}

export async function createLateSubmissionLink(
  db: Firestore,
  {
    cfpId,
    label: rawLabel,
    maxClaims: rawMaxClaims,
    expiresAt: rawExpiresAt,
    byUid,
  }: {
    cfpId: string;
    label?: unknown;
    maxClaims?: unknown;
    expiresAt?: unknown;
    byUid: string;
  },
): Promise<LateSubmissionLink> {
  let label: string | undefined;
  if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel === 'string') {
    const trimmed = rawLabel.trim();
    if (trimmed.length > ROLE_INVITE_LINK_LIMITS.labelMax) {
      throw new RoleError(
        'invalid-argument',
        `Label must be at most ${ROLE_INVITE_LINK_LIMITS.labelMax} characters.`,
      );
    }
    if (trimmed) label = trimmed;
  }

  let maxClaims: number | null = null;
  if (rawMaxClaims !== undefined && rawMaxClaims !== null && rawMaxClaims !== '') {
    const parsed = Number(rawMaxClaims);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < ROLE_INVITE_LINK_LIMITS.maxClaimsMin ||
      parsed > ROLE_INVITE_LINK_LIMITS.maxClaimsMax
    ) {
      throw new RoleError(
        'invalid-argument',
        `Max claims must be between ${ROLE_INVITE_LINK_LIMITS.maxClaimsMin} and ${ROLE_INVITE_LINK_LIMITS.maxClaimsMax}.`,
      );
    }
    maxClaims = parsed;
  }

  let expiresAtTimestamp: Timestamp | null = null;
  if (rawExpiresAt !== undefined && rawExpiresAt !== null && rawExpiresAt !== '') {
    const date = new Date(rawExpiresAt as string | number);
    if (isNaN(date.getTime())) {
      throw new RoleError('invalid-argument', 'Invalid expiration date.');
    }
    if (date.getTime() <= Date.now()) {
      throw new RoleError('invalid-argument', 'Expiration date must be in the future.');
    }
    expiresAtTimestamp = Timestamp.fromDate(date);
  }

  const token = randomUUID();
  const linkRef = lateSubmissionLinkDoc(db, cfpId, token);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const actorRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
    const [cfp, actor] = await tx.getAll(cfpRef, actorRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true || cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }
    const actorRole = actor.get('role');
    if (!actor.exists || (actorRole !== 'admin' && actorRole !== 'owner')) {
      throw new RoleError(
        'permission-denied',
        'Only an admin or owner can create late submission links.',
      );
    }

    const newLink: LateSubmissionLink = {
      id: token,
      cfpId,
      ...(label ? { label } : {}),
      maxClaims,
      claimedCount: 0,
      claimedUids: {},
      expiresAt: expiresAtTimestamp,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: byUid,
    };

    tx.set(linkRef, newLink);
    return newLink;
  });
}

export async function revokeLateSubmissionLink(
  db: Firestore,
  {
    cfpId,
    token: rawToken,
    byUid,
  }: {
    cfpId: string;
    token: unknown;
    byUid: string;
  },
): Promise<{ ok: true; token: string }> {
  const token = normalizeInviteToken(rawToken);
  const linkRef = lateSubmissionLinkDoc(db, cfpId, token);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const actorRef = db.doc(`cfps/${cfpId}/members/${byUid}`);
    const [cfp, actor, link] = await tx.getAll(cfpRef, actorRef, linkRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (!link.exists) throw new RoleError('not-found', 'Invitation link not found.');
    const actorRole = actor.get('role');
    if (!actor.exists || (actorRole !== 'admin' && actorRole !== 'owner')) {
      throw new RoleError(
        'permission-denied',
        'Only an admin or owner can revoke late submission links.',
      );
    }

    if (link.get('revokedAt')) {
      return { ok: true as const, token };
    }

    tx.update(linkRef, {
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: byUid,
    });

    return { ok: true as const, token };
  });
}

export async function getLateSubmissionLinkInfo(
  db: Firestore,
  {
    cfpId,
    token: rawToken,
    uid,
  }: {
    cfpId: string;
    token: unknown;
    uid?: string;
  },
): Promise<LateSubmissionLinkPublicInfo> {
  const token = normalizeInviteToken(rawToken);
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const linkRef = lateSubmissionLinkDoc(db, cfpId, token);

  const [cfp, link] = await Promise.all([cfpRef.get(), linkRef.get()]);
  if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
  if (!link.exists) throw new RoleError('not-found', 'Invitation link not found.');

  const expiresAt = link.get('expiresAt') as Timestamp | null;
  const maxClaims = (link.get('maxClaims') as number | null) ?? null;
  const claimedCount = Number(link.get('claimedCount') ?? 0);
  const isRevoked = Boolean(link.get('revokedAt'));
  const isExpired = expiresAt ? expiresAt.toMillis() <= Date.now() : false;
  const isExhausted = maxClaims !== null && claimedCount >= maxClaims;
  const isArchived = cfp.get('archived') === true || cfp.get('deleting') === true;

  let claimedProposalId: string | null = null;
  if (uid) {
    const claimedUids = (link.get('claimedUids') ?? {}) as Record<
      string,
      { proposalId?: string } | undefined
    >;
    const candidateProposalId = claimedUids[uid]?.proposalId;
    if (typeof candidateProposalId === 'string' && candidateProposalId.trim()) {
      const propSnap = await db.doc(`cfps/${cfpId}/proposals/${candidateProposalId}`).get();
      if (propSnap.exists) {
        claimedProposalId = candidateProposalId;
      }
    }
  }

  const isOpenForClaimedProposal =
    Boolean(claimedProposalId) && !isRevoked && !isExpired && !isArchived;
  const isValid =
    !isRevoked && !isExpired && !isArchived && (Boolean(claimedProposalId) || !isExhausted);

  return {
    cfpId,
    eventName: String(cfp.get('name') ?? cfpId),
    label: (link.get('label') as string | undefined) ?? null,
    maxClaims,
    claimedCount,
    expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null,
    isRevoked,
    isExpired,
    isExhausted,
    isValid,
    ...(claimedProposalId ? { claimedProposalId, isOpenForClaimedProposal } : {}),
  };
}

export async function claimLateSubmissionLink(
  db: Firestore,
  {
    cfpId,
    token: rawToken,
    uid,
    email: rawEmail,
    name,
  }: {
    cfpId: string;
    token: unknown;
    uid: string;
    email: string;
    name?: string;
  },
): Promise<{ ok: true; cfpId: string; proposalId: string; alreadyClaimed?: boolean }> {
  const token = normalizeInviteToken(rawToken);
  const email = normalizeEmail(rawEmail);
  const linkRef = lateSubmissionLinkDoc(db, cfpId, token);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [cfp, link] = await tx.getAll(cfpRef, linkRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true || cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!link.exists) throw new RoleError('not-found', 'Invitation link not found.');

    if (link.get('revokedAt')) {
      throw new RoleError(
        'failed-precondition',
        'This invitation link has been revoked.',
        'invite_link_revoked',
      );
    }

    const expiresAt = link.get('expiresAt') as Timestamp | null;
    if (expiresAt && expiresAt.toMillis() <= Date.now()) {
      throw new RoleError(
        'failed-precondition',
        'This invitation link has expired.',
        'invite_link_expired',
      );
    }

    const claimedUids = (link.get('claimedUids') ?? {}) as Record<
      string,
      { proposalId?: string } | undefined
    >;
    const existingClaim = claimedUids[uid];
    if (existingClaim?.proposalId) {
      const existingProposalRef = db.doc(`cfps/${cfpId}/proposals/${existingClaim.proposalId}`);
      const existingProposalSnap = await tx.get(existingProposalRef);
      if (existingProposalSnap.exists) {
        return {
          ok: true as const,
          cfpId,
          proposalId: existingClaim.proposalId,
          alreadyClaimed: true,
        };
      }
    }

    const existingProposals = await tx.get(
      db.collection(`cfps/${cfpId}/proposals`).where('speakerIds', 'array-contains', uid),
    );
    const liveCount = existingProposals.docs.filter((d) =>
      inStatusSet('live', String(d.get('status') ?? '')),
    ).length;
    if (liveCount >= LIMITS.maxTalksPerSpeaker) {
      throw new RoleError(
        'resource-exhausted',
        `Maximum of ${LIMITS.maxTalksPerSpeaker} proposals per speaker reached.`,
        'speaker_talk_cap_reached',
      );
    }

    const maxClaims = (link.get('maxClaims') as number | null) ?? null;
    const currentClaimedCount = Number(link.get('claimedCount') ?? 0);
    const alreadyCounted = Boolean(existingClaim);

    if (!alreadyCounted && maxClaims !== null && currentClaimedCount >= maxClaims) {
      throw new RoleError(
        'failed-precondition',
        'This invitation link has reached its maximum number of claims.',
        'invite_link_exhausted',
      );
    }

    const proposalRef = db.collection(`cfps/${cfpId}/proposals`).doc();
    tx.set(proposalRef, {
      cfpId,
      speakerIds: [uid],
      primarySpeakerId: uid,
      status: 'draft',
      lateSubmissionLinkId: token,
      title: '',
      abstract: '',
      category: '',
      format: '',
      level: '',
      deliveryLanguage: 'en',
      acks: {},
      answers: {},
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(linkRef, {
      ...(alreadyCounted ? {} : { claimedCount: FieldValue.increment(1) }),
      [`claimedUids.${uid}`]: {
        email,
        ...(name ? { name } : {}),
        proposalId: proposalRef.id,
        claimedAt: FieldValue.serverTimestamp(),
      },
    });

    return { ok: true as const, cfpId, proposalId: proposalRef.id };
  });
}
