/**
 * Granting, revoking and claiming roles, within one CFP.
 *
 * Lives here rather than in `shared/` because it needs the Admin SDK, and
 * separate from `index.ts` so that "what granting means" is written once.
 *
 * Every function below takes a `cfpId` and touches nothing outside it. Creating
 * a CFP still writes its event owner in one transaction.
 */

import { randomUUID } from 'node:crypto';

import type { Auth, UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { CFP_ROLES, ROLE_INVITE_LINK_LIMITS, type CfpRole } from '../../shared/cfp';
import type { RoleInviteLink, RoleInviteLinkPublicInfo } from '../../shared/types';
import {
  archiveOwnershipTransfer,
  ownershipTransferExpiry,
  ownershipTransferIsPending,
  ownershipTransferView,
} from './ownership';

export class RoleError extends Error {
  constructor(
    readonly code:
      | 'invalid-argument'
      | 'failed-precondition'
      | 'not-found'
      | 'permission-denied',
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** Doc ids cannot contain `/`, and the regex rejects that along with the rest. */
export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
    throw new RoleError('invalid-argument', `Not a usable email address: ${String(raw)}`);
  }
  return email;
}

/**
 * `owner` is deliberately not grantable or transferable by event admins. It is
 * written by `createCfp`; a lost owner account requires an out-of-band repair.
 */
export function normalizeRole(raw: unknown): CfpRole {
  const role = String(raw ?? '');
  if (role === 'owner' || !(CFP_ROLES as readonly string[]).includes(role)) {
    throw new RoleError('invalid-argument', `Unknown role: ${role}`);
  }
  return role as CfpRole;
}

const memberDoc = (db: Firestore, cfpId: string, uid: string) =>
  db.doc(`cfps/${cfpId}/members/${uid}`);
const grantDoc = (db: Firestore, cfpId: string, email: string) =>
  db.doc(`cfps/${cfpId}/roleGrants/${email}`);

/**
 * The account that owns this address, if it has proved that it does.
 *
 * An unverified account is treated as no account at all, so the grant stays
 * pending and `claim` applies it when someone signs in who has actually proved
 * the mailbox. Email+password signup verifies nothing, so without this an
 * attacker could register a colleague's address, wait for the grant, and be
 * handed the role — never having read a single message sent to it.
 */
async function userForEmail(auth: Auth, email: string): Promise<UserRecord | undefined> {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return undefined;
    throw error;
  }
}

async function assertAdminInTransaction(
  tx: Transaction,
  db: Firestore,
  cfpId: string,
  uid: string,
) {
  const member = await tx.get(memberDoc(db, cfpId, uid));
  if (member.get('role') !== 'admin' && member.get('role') !== 'owner') {
    throw new RoleError('permission-denied', 'Only an admin can change event roles.');
  }
  return member;
}

/**
 * Records a grant, and applies it immediately if the person already has an
 * account. Otherwise it waits in `roleGrants` for `claim` to pick up on their
 * first visit to this CFP.
 *
 * Granting to someone who already holds a role re-roles them in place, which is
 * how the committee list changes a role. That makes it a way *down* as well as
 * up, so it carries the same two refusals as `revoke`: the owner is not an
 * admin's to demote, and the last admin cannot be demoted out of the job.
 * Both are checked before either write, so a refused change leaves nothing
 * behind in `roleGrants` either.
 */
export async function grant(
  db: Firestore,
  auth: Auth,
  {
    cfpId,
    email: rawEmail,
    role: rawRole,
    byUid,
  }: { cfpId: string; email: unknown; role: unknown; byUid: string },
): Promise<{ email: string; role: CfpRole; applied: boolean; invitationId?: string }> {
  const email = normalizeEmail(rawEmail);
  const role = normalizeRole(rawRole);
  const user = await userForEmail(auth, email);
  const eligibleUid = user?.emailVerified && !user.disabled ? user.uid : undefined;
  const grantRef = grantDoc(db, cfpId, email);
  const result = await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const cfp = await tx.get(cfpRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }

    const existingGrant = await tx.get(grantRef);
    const actor = await assertAdminInTransaction(tx, db, cfpId, byUid);
    const actorRole = actor.get('role');
    const canonicalOwner = cfp.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === byUid;
    if (role === 'admin' && !actorIsOwner) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can grant admin roles.',
        'event_owner_required',
      );
    }
    const membersByEmail = await tx.get(
      db.collection(`cfps/${cfpId}/members`).where('email', '==', email),
    );
    const claimedUid = existingGrant.get('claimedBy');
    if (claimedUid && typeof claimedUid !== 'string') {
      throw new RoleError('failed-precondition', 'That invitation is not usable.');
    }
    if (eligibleUid && claimedUid && eligibleUid !== claimedUid) {
      throw new RoleError(
        'failed-precondition',
        'That invitation has already been claimed by another account.',
      );
    }

    // A claimed grant or uniquely matching member remains manageable even if
    // Auth is temporarily disabled or the account was deleted.
    const memberUids = new Set(membersByEmail.docs.map((member) => member.id));
    const externallyResolvedUid = eligibleUid ?? (claimedUid as string | undefined);
    if (
      membersByEmail.size > 1 ||
      (externallyResolvedUid !== undefined &&
        membersByEmail.size === 1 &&
        !memberUids.has(externallyResolvedUid))
    ) {
      throw new RoleError(
        'failed-precondition',
        'That address is linked to more than one committee identity. Revoke the stale entry first.',
      );
    }
    const uid =
      eligibleUid ??
      (claimedUid as string | undefined) ??
      membersByEmail.docs[0]?.id;
    const currentMember = uid
      ? uid === byUid
        ? actor
        : await tx.get(memberDoc(db, cfpId, uid))
      : null;
    const storedLocale = [currentMember?.get('locale'), existingGrant.get('locale')].find(
      (value) => value === 'en' || value === 'fr',
    );
    const relatedMembers = new Map<string, DocumentSnapshot>(
      membersByEmail.docs.map((member) => [member.id, member] as const),
    );
    if (currentMember) relatedMembers.set(currentMember.id, currentMember);
    if ([...relatedMembers.values()].some((member) => member.get('role') === 'owner')) {
      throw new RoleError('failed-precondition', "An owner's role cannot be changed.");
    }
    const isTargetAdmin = [...relatedMembers.values()].some((member) => member.get('role') === 'admin');
    if (role !== 'admin' && isTargetAdmin && !actorIsOwner) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can change an admin role.',
        'event_owner_required',
      );
    }
    if (
      role !== 'admin' &&
      isTargetAdmin
    ) {
      const admins = await tx.get(
        db.collection(`cfps/${cfpId}/members`).where('role', 'in', ['admin', 'owner']),
      );
      const remainingAdmins = admins.docs.filter((member) => !relatedMembers.has(member.id));
      if (remainingAdmins.length === 0) {
        throw new RoleError(
          'failed-precondition',
          'That is the only admin left.',
          'event_last_admin',
        );
      }
    }

    const invitationId = String(existingGrant.get('invitationId') ?? randomUUID());
    if (uid) {
      tx.set(grantRef, {
        cfpId,
        email,
        role,
        invitationId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: byUid,
        claimedBy: uid,
        claimedAt: FieldValue.serverTimestamp(),
        ...(storedLocale ? { locale: storedLocale } : {}),
      });
      tx.set(
        memberDoc(db, cfpId, uid),
        {
          cfpId,
          uid,
          role,
          email,
          createdAt: FieldValue.serverTimestamp(),
          grantedBy: byUid,
          ...(storedLocale ? { locale: storedLocale } : {}),
        },
        { merge: true },
      );
      return { applied: true as const, invitationId };
    }

    tx.set(grantRef, {
      cfpId,
      email,
      role,
      invitationId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: byUid,
      ...(storedLocale ? { locale: storedLocale } : {}),
    });
    return { applied: false as const, invitationId };
  });

  return { email, role, ...result };
}

/**
 * Removes a role. Refuses to remove the last admin: a CFP with nobody who can
 * administer it can only be repaired by its owner, and the owner may be the
 * person being removed.
 */
export async function revoke(
  db: Firestore,
  auth: Auth,
  { cfpId, email: rawEmail, byUid }: { cfpId: string; email: unknown; byUid: string },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const authUid = (await userForEmail(auth, email))?.uid;
  const grantRef = grantDoc(db, cfpId, email);

  await db.runTransaction(async (tx) => {
    const [cfp, grant] = await tx.getAll(db.doc(`cfps/${cfpId}`), grantRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is being deleted.');
    }
    const actor = await assertAdminInTransaction(tx, db, cfpId, byUid);
    const actorRole = actor.get('role');
    const canonicalOwner = cfp.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === byUid;
    const byEmail = await tx.get(
      db.collection(`cfps/${cfpId}/members`).where('email', '==', email),
    );
    const claimedUid = grant.get('claimedBy');
    const targetUids = [
      ...(typeof claimedUid === 'string' ? [claimedUid] : []),
      ...(authUid ? [authUid] : []),
      ...byEmail.docs.map((member) => member.id),
    ].filter((uid, index, all) => all.indexOf(uid) === index);
    const targets = await Promise.all(
      targetUids.map((uid) =>
        uid === byUid ? Promise.resolve(actor) : tx.get(memberDoc(db, cfpId, uid)),
      ),
    );

    if (targets.some((member) => member.get('role') === 'owner')) {
      throw new RoleError('failed-precondition', 'An owner cannot be removed.');
    }
    const removingAdmin = targets.some((member) => member.get('role') === 'admin');
    if (removingAdmin && !actorIsOwner) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can revoke an admin.',
        'event_owner_required',
      );
    }
    if (removingAdmin) {
      const admins = await tx.get(
        db.collection(`cfps/${cfpId}/members`).where('role', 'in', ['admin', 'owner']),
      );
      const remaining = admins.docs.filter((member) => !targetUids.includes(member.id));
      if (remaining.length === 0) {
        throw new RoleError(
          'failed-precondition',
          'That is the only admin left.',
          'event_last_admin',
        );
      }
    }

    for (const uid of targetUids) tx.delete(memberDoc(db, cfpId, uid));
    tx.delete(grantRef);
  });
  return { email };
}

/**
 * Turns a pending grant into a role, on first visit to a CFP. Returns null for
 * the ordinary case of a speaker with no grant waiting.
 *
 * Trusts the email on the verified auth token, never one supplied by the caller.
 */
export async function claim(
  db: Firestore,
  { cfpId, uid, email: rawEmail, name }: { cfpId: string; uid: string; email?: string; name?: string },
): Promise<CfpRole | null> {
  const memberRef = memberDoc(db, cfpId, uid);
  const email = rawEmail?.trim().toLowerCase();

  return db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [existing, cfp] = await tx.getAll(memberRef, cfpRef);
    if (existing.exists) return (existing.data()?.role ?? null) as CfpRole | null;
    if (!email) return null;

    const grantRef = grantDoc(db, cfpId, email);
    const grantSnap = await tx.get(grantRef);
    if (!grantSnap.exists) return null;
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }

    const granted = grantSnap.data()!;
    const claimedBy = granted.claimedBy;
    if (claimedBy && claimedBy !== uid) {
      throw new RoleError(
        'failed-precondition',
        'That invitation has already been claimed by another account.',
      );
    }
    const role = normalizeRole(granted.role);

    tx.set(memberRef, {
      cfpId,
      uid,
      role,
      email,
      ...(name ? { name } : {}),
      createdAt: FieldValue.serverTimestamp(),
      grantedBy: granted.createdBy ?? 'unknown',
      ...(granted.locale === 'en' || granted.locale === 'fr'
        ? { locale: granted.locale }
        : {}),
    });
    tx.update(grantRef, {
      claimedBy: uid,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return role;
  });
}

export async function initiateEventOwnershipTransfer(
  db: Firestore,
  auth: Auth,
  {
    cfpId,
    email: rawEmail,
    byUid,
  }: { cfpId: string; email: unknown; byUid: string },
) {
  const email = normalizeEmail(rawEmail);
  const targetUser = await userForEmail(auth, email);
  if (!targetUser?.emailVerified || targetUser.disabled) {
    throw new RoleError(
      'failed-precondition',
      'The successor account must be verified and enabled.',
      'transfer_account_not_ready',
    );
  }
  if (targetUser.uid === byUid) {
    throw new RoleError(
      'failed-precondition',
      'You are already the event owner.',
      'transfer_already_owner',
    );
  }

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const actorRef = memberDoc(db, cfpId, byUid);
    const transferRef = db.doc(`cfps/${cfpId}/transfers/current`);
    const [cfp, actor, currentTransfer] = await tx.getAll(cfpRef, actorRef, transferRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }
    const canonicalOwner = cfp.get('ownerUid');
    if (actor.get('role') !== 'owner' || canonicalOwner !== byUid) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can transfer ownership.',
        'event_owner_required',
      );
    }
    if (ownershipTransferIsPending(currentTransfer)) {
      throw new RoleError(
        'failed-precondition',
        'An ownership transfer is already pending.',
        'transfer_already_pending',
      );
    }

    const transferId = randomUUID();
    archiveOwnershipTransfer(
      tx,
      currentTransfer,
      db.collection(`cfps/${cfpId}/transfers`),
      byUid,
    );
    tx.set(transferRef, {
      id: transferId,
      scope: 'event',
      scopeId: cfpId,
      targetEmail: email,
      targetUid: targetUser.uid,
      initiatedBy: byUid,
      initiatedAt: FieldValue.serverTimestamp(),
      expiresAt: ownershipTransferExpiry(),
      status: 'pending',
    });
    return { ok: true, transferId, targetEmail: email };
  });
}

export async function acceptEventOwnershipTransfer(
  db: Firestore,
  auth: Auth,
  { cfpId, uid, email: rawEmail }: { cfpId: string; uid: string; email: string },
) {
  const email = normalizeEmail(rawEmail);
  let userRecord: UserRecord | undefined;
  try {
    userRecord = await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string })?.code === 'auth/user-not-found') {
      throw new RoleError('not-found', 'User account not found.', 'transfer_not_eligible');
    }
    throw err;
  }
  if (!userRecord.emailVerified || userRecord.disabled) {
    throw new RoleError(
      'failed-precondition',
      'The successor account must be verified and enabled.',
      'transfer_account_not_ready',
    );
  }

  const cfpRef = db.doc(`cfps/${cfpId}`);
  const transferRef = db.doc(`cfps/${cfpId}/transfers/current`);
  const newOwnerMemberRef = memberDoc(db, cfpId, uid);

  return await db.runTransaction(async (tx) => {
    const [cfp, transferSnap, newMemberSnap] = await tx.getAll(
      cfpRef,
      transferRef,
      newOwnerMemberRef,
    );
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (!ownershipTransferIsPending(transferSnap)) {
      throw new RoleError(
        'failed-precondition',
        'No pending ownership transfer was found.',
        'transfer_not_found',
      );
    }
    const targetEmail = String(transferSnap.get('targetEmail') ?? '').toLowerCase();
    const targetUid = transferSnap.get('targetUid');
    if (targetUid ? targetUid !== uid : targetEmail !== email) {
      throw new RoleError(
        'permission-denied',
        'This ownership transfer was not addressed to this account.',
        'transfer_wrong_account',
      );
    }

    const initiatedBy = String(transferSnap.get('initiatedBy') ?? '');
    const initiatingOwner = await tx.get(memberDoc(db, cfpId, initiatedBy));
    const ownersSnap = await tx.get(
      db.collection(`cfps/${cfpId}/members`).where('role', '==', 'owner'),
    );
    const canonicalOwner = cfp.get('ownerUid');
    if (initiatingOwner.get('role') !== 'owner' || canonicalOwner !== initiatedBy) {
      throw new RoleError(
        'failed-precondition',
        'The event owner changed after this transfer was initiated.',
        'transfer_not_found',
      );
    }
    const now = FieldValue.serverTimestamp();

    // Demote any existing owner to admin so exact single owner invariant holds
    for (const doc of ownersSnap.docs) {
      if (doc.id !== uid) {
        tx.update(doc.ref, {
          role: 'admin',
          roleUpdatedAt: now,
          roleUpdatedBy: uid,
        });
      }
    }

    tx.set(
      newOwnerMemberRef,
      {
        cfpId,
        uid,
        email,
        ...(userRecord.displayName ? { name: userRecord.displayName } : {}),
        role: 'owner',
        createdAt: newMemberSnap.exists ? newMemberSnap.get('createdAt') ?? now : now,
        grantedBy: uid,
        roleUpdatedAt: now,
        roleUpdatedBy: uid,
      },
      { merge: true },
    );

    tx.update(cfpRef, {
      ownerUid: uid,
      updatedAt: now,
    });

    tx.update(transferRef, {
      status: 'accepted',
      acceptedAt: now,
      acceptedBy: uid,
    });

    return { ok: true };
  });
}

export async function cancelEventOwnershipTransfer(
  db: Firestore,
  { cfpId, byUid }: { cfpId: string; byUid: string },
) {
  const actorRef = memberDoc(db, cfpId, byUid);
  const transferRef = db.doc(`cfps/${cfpId}/transfers/current`);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [cfp, actor, transferSnap] = await tx.getAll(cfpRef, actorRef, transferRef);
    const canonicalOwner = cfp.get('ownerUid');
    if (actor.get('role') !== 'owner' || canonicalOwner !== byUid) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can cancel an ownership transfer.',
        'event_owner_required',
      );
    }
    if (!ownershipTransferIsPending(transferSnap)) {
      throw new RoleError(
        'failed-precondition',
        'No pending ownership transfer to cancel.',
        'transfer_not_found',
      );
    }

    tx.update(transferRef, {
      status: 'cancelled',
      cancelledBy: byUid,
      cancelledAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  });
}

export async function getEventOwnershipTransfer(
  db: Firestore,
  { cfpId, byUid, email }: { cfpId: string; byUid: string; email?: string },
) {
  const transferRef = db.doc(`cfps/${cfpId}/transfers/current`);
  const snap = await transferRef.get();
  if (!ownershipTransferIsPending(snap)) return null;
  const data = snap.data()!;
  const targetEmail = String(data.targetEmail ?? '').toLowerCase();
  const normalizedEmail = email ? email.toLowerCase() : '';
  const [cfp, memberSnap] = await Promise.all([
    db.doc(`cfps/${cfpId}`).get(),
    byUid ? db.doc(`cfps/${cfpId}/members/${byUid}`).get() : Promise.resolve(null),
  ]);
  const canonicalOwner = cfp.get('ownerUid');
  const isOwner =
    memberSnap?.exists === true &&
    memberSnap.get('role') === 'owner' &&
    canonicalOwner === byUid;
  const isTarget =
    (normalizedEmail && targetEmail === normalizedEmail) || data.targetUid === byUid;
  if (!isOwner && !isTarget) return null;
  return ownershipTransferView(snap, 'event', cfpId);
}

const inviteLinkDoc = (db: Firestore, cfpId: string, token: string) =>
  db.doc(`cfps/${cfpId}/roleInviteLinks/${token}`);

export function normalizeInviteToken(raw: unknown): string {
  const token = String(raw ?? '').trim();
  if (!ROLE_INVITE_LINK_LIMITS.tokenRegex.test(token)) {
    throw new RoleError('invalid-argument', 'Invalid invitation token.');
  }
  return token;
}

export async function createInviteLink(
  db: Firestore,
  {
    cfpId,
    role: rawRole,
    label: rawLabel,
    maxClaims: rawMaxClaims,
    expiresAt: rawExpiresAt,
    byUid,
  }: {
    cfpId: string;
    role: unknown;
    label?: unknown;
    maxClaims?: unknown;
    expiresAt?: unknown;
    byUid: string;
  },
): Promise<RoleInviteLink> {
  const role = normalizeRole(rawRole);
  if (role === 'owner') {
    throw new RoleError('invalid-argument', 'Owner role cannot be invited via link.');
  }

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
  const linkRef = inviteLinkDoc(db, cfpId, token);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [cfp, actor] = await tx.getAll(cfpRef, memberDoc(db, cfpId, byUid));
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('archived') === true) {
      throw new RoleError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!actor.exists) {
      throw new RoleError('permission-denied', 'Only an admin or owner can create invitation links.');
    }
    const actorRole = actor.get('role');
    if (actorRole !== 'admin' && actorRole !== 'owner') {
      throw new RoleError('permission-denied', 'Only an admin or owner can create invitation links.');
    }
    const canonicalOwner = cfp.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === byUid;
    if (role === 'admin' && !actorIsOwner) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can create admin invitation links.',
        'event_owner_required',
      );
    }

    const newLink: RoleInviteLink = {
      id: token,
      cfpId,
      role,
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

export async function revokeInviteLink(
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
  const linkRef = inviteLinkDoc(db, cfpId, token);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [cfp, actor, link] = await tx.getAll(cfpRef, memberDoc(db, cfpId, byUid), linkRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (!link.exists) throw new RoleError('not-found', 'Invitation link not found.');
    if (!actor.exists) {
      throw new RoleError('permission-denied', 'Only an admin or owner can revoke invitation links.');
    }
    const actorRole = actor.get('role');
    if (actorRole !== 'admin' && actorRole !== 'owner') {
      throw new RoleError('permission-denied', 'Only an admin or owner can revoke invitation links.');
    }
    const canonicalOwner = cfp.get('ownerUid');
    const actorIsOwner = actorRole === 'owner' && canonicalOwner === byUid;
    if (link.get('role') === 'admin' && !actorIsOwner) {
      throw new RoleError(
        'permission-denied',
        'Only an event owner can revoke admin invitation links.',
        'event_owner_required',
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

export async function getInviteLinkInfo(
  db: Firestore,
  {
    cfpId,
    token: rawToken,
  }: {
    cfpId: string;
    token: unknown;
  },
): Promise<RoleInviteLinkPublicInfo> {
  const token = normalizeInviteToken(rawToken);
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const linkRef = inviteLinkDoc(db, cfpId, token);

  const [cfp, link] = await Promise.all([cfpRef.get(), linkRef.get()]);
  if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
  if (!link.exists) throw new RoleError('not-found', 'Invitation link not found.');

  const expiresAt = link.get('expiresAt') as Timestamp | null;
  const maxClaims = (link.get('maxClaims') as number | null) ?? null;
  const claimedCount = Number(link.get('claimedCount') ?? 0);
  const isRevoked = Boolean(link.get('revokedAt'));
  const isExpired = expiresAt ? expiresAt.toMillis() <= Date.now() : false;
  const isExhausted = maxClaims !== null && claimedCount >= maxClaims;
  const isArchived = cfp.get('archived') === true;
  const isValid = !isRevoked && !isExpired && !isExhausted && !isArchived;

  return {
    cfpId,
    eventName: String(cfp.get('name') ?? cfpId),
    role: link.get('role'),
    label: (link.get('label') as string | undefined) ?? null,
    maxClaims,
    claimedCount,
    expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null,
    isRevoked,
    isExpired,
    isExhausted,
    isValid,
  };
}

export async function claimInviteLink(
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
): Promise<{ ok: true; role: CfpRole; cfpId: string; alreadyMember?: boolean }> {
  const token = normalizeInviteToken(rawToken);
  const email = normalizeEmail(rawEmail);
  const memberRef = memberDoc(db, cfpId, uid);
  const linkRef = inviteLinkDoc(db, cfpId, token);
  const grantRef = grantDoc(db, cfpId, email);

  return await db.runTransaction(async (tx) => {
    const cfpRef = db.doc(`cfps/${cfpId}`);
    const [cfp, link, member, grant] = await tx.getAll(cfpRef, linkRef, memberRef, grantRef);
    if (!cfp.exists) throw new RoleError('not-found', 'No such call for proposals.');
    if (cfp.get('archived') === true) {
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

    const claimedUids = (link.get('claimedUids') ?? {}) as Record<string, unknown>;
    const alreadyClaimedByThisUser = Boolean(claimedUids[uid]);
    const maxClaims = (link.get('maxClaims') as number | null) ?? null;
    const currentClaimedCount = Number(link.get('claimedCount') ?? 0);

    const targetRole = normalizeRole(link.get('role'));
    const currentRole = member.exists ? (member.get('role') as CfpRole) : null;

    if (currentRole === 'owner') {
      return { ok: true as const, role: 'owner' as const, cfpId, alreadyMember: true };
    }
    if (currentRole === 'admin' && targetRole === 'reviewer') {
      return { ok: true as const, role: 'admin' as const, cfpId, alreadyMember: true };
    }
    if (currentRole === targetRole) {
      return { ok: true as const, role: targetRole, cfpId, alreadyMember: true };
    }

    if (!alreadyClaimedByThisUser && maxClaims !== null && currentClaimedCount >= maxClaims) {
      throw new RoleError(
        'failed-precondition',
        'This invitation link has reached its maximum number of claims.',
        'invite_link_exhausted',
      );
    }

    if (!alreadyClaimedByThisUser) {
      tx.update(linkRef, {
        claimedCount: FieldValue.increment(1),
        [`claimedUids.${uid}`]: {
          email,
          ...(name ? { name } : {}),
          claimedAt: FieldValue.serverTimestamp(),
        },
      });
    }

    tx.set(
      memberRef,
      {
        cfpId,
        uid,
        role: targetRole,
        email,
        ...(name ? { name } : {}),
        createdAt: member.exists ? member.get('createdAt') : FieldValue.serverTimestamp(),
        grantedBy: `invite_link:${token}`,
        inviteLinkId: token,
        roleUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      grantRef,
      {
        cfpId,
        email,
        role: targetRole,
        createdAt: grant.exists ? grant.get('createdAt') : FieldValue.serverTimestamp(),
        createdBy: `invite_link:${token}`,
        claimedBy: uid,
        claimedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true as const, role: targetRole, cfpId };
  });
}
