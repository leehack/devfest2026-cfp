import { FieldValue, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { validateCfpId } from '../../shared/cfp';
import { speakerSchema } from '../../shared/schema';
import type { SpeakerSnapshot } from '../../shared/types';

const CALLABLE = { region: 'northamerica-northeast1', maxInstances: 10 } as const;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const REFRESHABLE_STATUSES = new Set([
  'submitted',
  'under_review',
  'accepted',
  'confirmed',
  'declined',
  'waitlisted',
  'rejected',
]);

interface Identity {
  uid: string;
}

function requireIdentity(request: {
  auth?: { uid: string; token?: { email_verified?: unknown } };
}): Identity {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update a session profile.');
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return { uid };
}

function requireInput(data: unknown): {
  cfpId: string;
  proposalId: string;
  speakerUid?: string;
} {
  const input = (data ?? {}) as Record<string, unknown>;
  const cfpId = typeof input.cfpId === 'string' ? input.cfpId : '';
  const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
  const speakerUid = input.speakerUid;
  if (validateCfpId(cfpId) !== null || !DOCUMENT_ID.test(proposalId)) {
    throw new HttpsError('invalid-argument', 'A valid CFP and proposal are required.');
  }
  if (
    speakerUid !== undefined &&
    (typeof speakerUid !== 'string' ||
      speakerUid.length === 0 ||
      speakerUid.length > 128 ||
      speakerUid.includes('/'))
  ) {
    throw new HttpsError('invalid-argument', 'A valid speaker is required.');
  }
  return {
    cfpId,
    proposalId,
    ...(typeof speakerUid === 'string' ? { speakerUid } : {}),
  };
}

/** The public, proposal-scoped copy of a private global speaker profile. */
export function speakerSnapshotFrom(
  uid: string,
  speaker: Record<string, unknown>,
): SpeakerSnapshot {
  return {
    uid,
    name: String(speaker.name ?? ''),
    bio: String(speaker.bio ?? ''),
    ...(speaker.company ? { company: String(speaker.company) } : {}),
    ...(speaker.jobTitle ? { jobTitle: String(speaker.jobTitle) } : {}),
    basedIn: String(speaker.basedIn ?? ''),
    socials: (speaker.socials as SpeakerSnapshot['socials']) ?? [],
    isGde: speaker.isGde === true,
    ...(speaker.pastTalks ? { pastTalks: String(speaker.pastTalks) } : {}),
    ...(speaker.sessionizeUrl ? { sessionizeUrl: String(speaker.sessionizeUrl) } : {}),
  };
}

function isEventAdmin(member: DocumentSnapshot): boolean {
  return member.exists && (member.get('role') === 'admin' || member.get('role') === 'owner');
}

/**
 * Explicitly replaces one active speaker's proposal copy from their profile.
 * Existing schedule releases are immutable; a configured working schedule is
 * only marked stale so an organiser can review and share it deliberately.
 */
export const refreshProposalSpeakerSnapshot = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId, speakerUid } = requireInput(request.data);
  const targetUid = speakerUid ?? identity.uid;
  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const profileRef = db.doc(`speakers/${targetUid}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const scheduleRef = db.doc(`cfps/${cfpId}/config/schedule`);

  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, profile, member, schedule] = await tx.getAll(
      cfpRef,
      proposalRef,
      profileRef,
      memberRef,
      scheduleRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');

    const ids = proposal.get('speakerIds');
    const activeSpeakerIds = Array.isArray(ids)
      ? ids.filter((uid): uid is string => typeof uid === 'string' && Boolean(uid))
      : [];
    const admin = isEventAdmin(member);
    if (targetUid !== identity.uid && !admin) {
      throw new HttpsError(
        'permission-denied',
        'Only an event admin can update another speaker\'s session profile.',
      );
    }
    if (!activeSpeakerIds.includes(targetUid)) {
      throw new HttpsError(
        targetUid === identity.uid ? 'permission-denied' : 'failed-precondition',
        'That account is not an active speaker.',
      );
    }
    const status = String(proposal.get('status') ?? '');
    if (!REFRESHABLE_STATUSES.has(status)) {
      throw new HttpsError(
        'failed-precondition',
        'A submitted, active proposal is required before its speaker copy can be refreshed.',
      );
    }
    const current = proposal.get('speakerSnapshot');
    if (!Array.isArray(current)) {
      throw new HttpsError('failed-precondition', 'This proposal has no submitted speaker copy.');
    }
    const index = current.findIndex(
      (entry) => entry && typeof entry === 'object' && entry.uid === targetUid,
    );
    if (index < 0) {
      throw new HttpsError('failed-precondition', 'This proposal has no copy for that speaker.');
    }
    if (!profile.exists || !speakerSchema.safeParse(profile.data()).success) {
      throw new HttpsError(
        'failed-precondition',
        'Complete the speaker profile before updating the session copy.',
      );
    }

    const snapshot = speakerSnapshotFrom(targetUid, profile.data()!);
    const changed = JSON.stringify(current[index]) !== JSON.stringify(snapshot);
    if (changed) {
      const next = [...current];
      next[index] = snapshot;
      tx.update(proposalRef, { speakerSnapshot: next });
      if (schedule.exists) {
        tx.set(
          scheduleRef,
          { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    }
    return { changed, snapshot, scheduleNeedsAttention: changed && schedule.exists };
  });

  logger.info('proposal speaker snapshot refreshed', {
    cfpId,
    proposalId,
    speakerUid: targetUid,
    byUid: identity.uid,
    changed: result.changed,
    scheduleNeedsAttention: result.scheduleNeedsAttention,
  });
  return { ok: true, ...result };
});
