import { randomUUID } from 'node:crypto';

import type { Auth, UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import { PLATFORM_ROLES, type PlatformRole } from '../../shared/platform';
import type { OwnershipTransfer } from '../../shared/types';
import {
  archiveOwnershipTransfer,
  ownershipTransferExpiry,
  ownershipTransferIsPending,
  ownershipTransferView,
} from './ownership';
import { normalizeEmail, RoleError } from './roles';

const memberDoc = (db: Firestore, uid: string) => db.doc(`platformMembers/${uid}`);
const grantDoc = (db: Firestore, email: string) => db.doc(`platformRoleGrants/${email}`);
const transferDoc = (db: Firestore) => db.doc('config/platformOwnershipTransfer');
const roleRank: Record<PlatformRole, number> = { admin: 1, owner: 2 };

function normalizePlatformRole(raw: unknown): PlatformRole {
  const role = String(raw ?? '');
  if (!(PLATFORM_ROLES as readonly string[]).includes(role)) {
    throw new RoleError('invalid-argument', `Unknown platform role: ${role}`);
  }
  return role as PlatformRole;
}

function roleOf(snapshot: DocumentSnapshot): PlatformRole | null {
  return snapshot.exists ? normalizePlatformRole(snapshot.get('role')) : null;
}

function strongestRole(roles: Array<PlatformRole | null>): PlatformRole | null {
  return roles.reduce<PlatformRole | null>(
    (strongest, role) =>
      role && (!strongest || roleRank[role] > roleRank[strongest]) ? role : strongest,
    null,
  );
}

function refuseHigherRole(
  roles: Array<PlatformRole | null>,
  requested: 'admin',
): void {
  const strongest = strongestRole(roles);
  if (strongest && roleRank[strongest] > roleRank[requested]) {
    throw new RoleError(
      'failed-precondition',
      `A ${strongest} role cannot be changed through ${requested} access.`,
    );
  }
}

async function userForEmail(auth: Auth, email: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

/**
 * Claims an email grant after the auth token proves ownership of the address.
 * A pending role can upgrade an existing one, but never downgrade it.
 */
export async function claimPlatformRole(
  db: Firestore,
  {
    uid,
    email: rawEmail,
    name,
  }: { uid: string; email: string; name?: string },
): Promise<PlatformRole | null> {
  const email = normalizeEmail(rawEmail);
  const member = memberDoc(db, uid);
  const grant = grantDoc(db, email);
  return await db.runTransaction(async (tx) => {
    const current = await tx.get(member);
    const pending = await tx.get(grant);
    const currentRole = roleOf(current);
    const pendingRole = roleOf(pending);
    if (!pendingRole) return currentRole;

    const role = strongestRole([currentRole, pendingRole])!;
    const existingOwners = role === 'owner'
      ? await tx.get(db.collection('platformMembers').where('role', '==', 'owner'))
      : null;
    const now = FieldValue.serverTimestamp();
    const roleChanged = currentRole !== role;
    const createdBy = String(
      current.get('createdBy') ??
        current.get('grantedBy') ??
        pending.get('createdBy') ??
        'bootstrap-script',
    );
    const roleUpdatedBy = String(
      roleChanged
        ? (pending.get('roleUpdatedBy') ?? pending.get('createdBy') ?? 'bootstrap-script')
        : (current.get('roleUpdatedBy') ?? current.get('grantedBy') ?? createdBy),
    );

    for (const owner of existingOwners?.docs ?? []) {
      if (owner.id !== uid) {
        tx.update(owner.ref, {
          role: 'admin',
          roleUpdatedAt: now,
          roleUpdatedBy,
        });
      }
    }
    tx.set(
      member,
      {
        uid,
        email,
        ...(name ? { name } : {}),
        role,
        createdAt:
          current.get('createdAt') ?? pending.get('createdAt') ?? now,
        createdBy,
        grantedBy: roleUpdatedBy,
        roleUpdatedAt: roleChanged
          ? (pending.get('roleUpdatedAt') ?? pending.get('createdAt') ?? now)
          : (current.get('roleUpdatedAt') ?? current.get('createdAt') ?? now),
        roleUpdatedBy,
      },
      { merge: true },
    );
    tx.delete(pending.ref);
    return role;
  });
}

export async function listPlatformAccess(
  db: Firestore,
  user?: { uid: string; email?: string },
) {
  const [members, grants, transferSnap] = await Promise.all([
    db.collection('platformMembers').get(),
    db.collection('platformRoleGrants').get(),
    transferDoc(db).get(),
  ]);

  let pendingTransfer: OwnershipTransfer | null = null;
  if (ownershipTransferIsPending(transferSnap)) {
    const data = transferSnap.data()!;
    const isOwner = user?.uid && members.docs.some((d) => d.id === user.uid && d.get('role') === 'owner');
    const isTarget = user && ((user.email && user.email.toLowerCase() === String(data.targetEmail ?? '').toLowerCase()) || user.uid === data.targetUid);
    if (isOwner || isTarget) {
      pendingTransfer = ownershipTransferView(transferSnap, 'platform');
    }
  }

  return {
    members: members.docs
      .map((doc) => ({
        uid: doc.id,
        email: String(doc.get('email') ?? ''),
        name: String(doc.get('name') ?? ''),
        role: normalizePlatformRole(doc.get('role')),
        createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
        createdBy: String(doc.get('createdBy') ?? ''),
        grantedBy: String(doc.get('grantedBy') ?? ''),
        roleUpdatedAt: doc.get('roleUpdatedAt')?.toMillis?.() ?? null,
        roleUpdatedBy: String(doc.get('roleUpdatedBy') ?? doc.get('grantedBy') ?? ''),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    pending: grants.docs
      .map((doc) => ({
        email: String(doc.get('email') ?? doc.id),
        role: normalizePlatformRole(doc.get('role')),
        createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
        createdBy: String(doc.get('createdBy') ?? ''),
        roleUpdatedAt: doc.get('roleUpdatedAt')?.toMillis?.() ?? null,
        roleUpdatedBy: String(doc.get('roleUpdatedBy') ?? doc.get('createdBy') ?? ''),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    pendingTransfer,
  };
}

async function grantPlatformRole(
  db: Firestore,
  auth: Auth,
  {
    email: rawEmail,
    role,
    byUid,
  }: {
    email: unknown;
    role: 'admin';
    byUid: string;
  },
): Promise<{ email: string; applied: boolean }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);
  const member = user ? memberDoc(db, user.uid) : null;
  const pending = grantDoc(db, email);
  const matches = db.collection('platformMembers').where('email', '==', email);

  return await db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(memberDoc(db, byUid));
    const actorRole = roleOf(actorSnap);
    if (role === 'admin' && actorRole !== 'owner') {
      throw new RoleError(
        'permission-denied',
        'Only a platform owner can grant administrator access.',
        'platform_owner_required',
      );
    }
    const matching = await tx.get(matches);
    const current =
      member && !matching.docs.some((snapshot) => snapshot.ref.path === member.path)
        ? await tx.get(member)
        : matching.docs.find((snapshot) => snapshot.ref.path === member?.path) ?? null;
    const existingGrant = await tx.get(pending);
    refuseHigherRole(
      [...matching.docs.map(roleOf), current ? roleOf(current) : null, roleOf(existingGrant)],
      role,
    );

    if (user?.emailVerified && member) {
      const now = FieldValue.serverTimestamp();
      const existingRole = current ? roleOf(current) : null;
      const roleChanged = existingRole !== role;
      tx.set(
        member,
        {
          uid: user.uid,
          email,
          ...(user.displayName ? { name: user.displayName } : {}),
          role,
          createdAt: current?.get('createdAt') ?? now,
          createdBy:
            current?.get('createdBy') ?? current?.get('grantedBy') ?? byUid,
          grantedBy: roleChanged ? byUid : (current?.get('grantedBy') ?? byUid),
          roleUpdatedAt: roleChanged
            ? now
            : (current?.get('roleUpdatedAt') ?? current?.get('createdAt') ?? now),
          roleUpdatedBy: roleChanged
            ? byUid
            : (current?.get('roleUpdatedBy') ?? current?.get('grantedBy') ?? byUid),
        },
        { merge: true },
      );
      tx.delete(pending);
      return { email, applied: true };
    }

    const now = FieldValue.serverTimestamp();
    const pendingRole = roleOf(existingGrant);
    const roleChanged = pendingRole !== role;
    tx.set(pending, {
      email,
      role,
      createdAt: existingGrant.get('createdAt') ?? now,
      createdBy: existingGrant.get('createdBy') ?? byUid,
      roleUpdatedAt: roleChanged
        ? now
        : (existingGrant.get('roleUpdatedAt') ?? existingGrant.get('createdAt') ?? now),
      roleUpdatedBy: roleChanged
        ? byUid
        : (existingGrant.get('roleUpdatedBy') ?? existingGrant.get('createdBy') ?? byUid),
    });
    return { email, applied: false };
  });
}

/** Platform owners may delegate platform administration. */
export async function grantPlatformAdmin(
  db: Firestore,
  auth: Auth,
  input: { email: unknown; byUid: string },
) {
  return await grantPlatformRole(db, auth, { ...input, role: 'admin' });
}

async function revokePlatformRole(
  db: Firestore,
  auth: Auth,
  {
    email: rawEmail,
    role,
    byUid,
  }: {
    email: unknown;
    role: 'admin';
    byUid: string;
  },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);
  const target = user ? memberDoc(db, user.uid) : null;
  const pending = grantDoc(db, email);
  const matches = db.collection('platformMembers').where('email', '==', email);

  await db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(memberDoc(db, byUid));
    const actorRole = roleOf(actorSnap);
    if (role === 'admin' && actorRole !== 'owner') {
      throw new RoleError(
        'permission-denied',
        'Only a platform owner can revoke administrator access.',
        'platform_owner_required',
      );
    }
    const matching = await tx.get(matches);
    const current: DocumentSnapshot[] = [...matching.docs];
    if (target && !current.some((snapshot) => snapshot.ref.path === target.path)) {
      current.push(await tx.get(target));
    }
    const existingGrant = await tx.get(pending);

    if (current.some((snapshot) => snapshot.id === byUid)) {
      throw new RoleError('failed-precondition', 'You cannot remove your own platform access.');
    }
    refuseHigherRole([...current.map(roleOf), roleOf(existingGrant)], role);

    for (const snapshot of current) {
      if (snapshot.exists && roleOf(snapshot) === role) tx.delete(snapshot.ref);
    }
    if (roleOf(existingGrant) === role) tx.delete(pending);
  });
  return { email };
}

/** Only owners call this; owner records remain bootstrap-managed. */
export async function revokePlatformAdmin(
  db: Firestore,
  auth: Auth,
  input: { email: unknown; byUid: string },
) {
  return await revokePlatformRole(db, auth, { ...input, role: 'admin' });
}

export async function initiatePlatformOwnershipTransfer(
  db: Firestore,
  auth: Auth,
  { email: rawEmail, byUid }: { email: unknown; byUid: string },
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
      'You are already the platform owner.',
      'transfer_already_owner',
    );
  }

  const transferRef = transferDoc(db);
  const actorRef = memberDoc(db, byUid);
  const history = db.collection('platformOwnershipTransfers');

  return await db.runTransaction(async (tx) => {
    const [actorSnap, currentTransfer] = await tx.getAll(actorRef, transferRef);
    if (roleOf(actorSnap) !== 'owner') {
      throw new RoleError(
        'permission-denied',
        'Only the platform owner can transfer ownership.',
        'platform_owner_required',
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
    archiveOwnershipTransfer(tx, currentTransfer, history, byUid);
    tx.set(transferRef, {
      id: transferId,
      scope: 'platform',
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

export async function acceptPlatformOwnershipTransfer(
  db: Firestore,
  auth: Auth,
  { uid, email: rawEmail }: { uid: string; email: string },
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

  const transferRef = transferDoc(db);
  const newOwnerRef = memberDoc(db, uid);

  return await db.runTransaction(async (tx) => {
    const transferSnap = await tx.get(transferRef);
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
    const [currentMemberSnap, initiatingOwner] = await tx.getAll(
      newOwnerRef,
      memberDoc(db, initiatedBy),
    );
    const ownersSnap = await tx.get(
      db.collection('platformMembers').where('role', '==', 'owner'),
    );
    if (roleOf(initiatingOwner) !== 'owner') {
      throw new RoleError(
        'failed-precondition',
        'The platform owner changed after this transfer was initiated.',
        'transfer_not_found',
      );
    }
    const now = FieldValue.serverTimestamp();

    // Demote all other platform owners to admin so single owner invariant holds
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
      newOwnerRef,
      {
        uid,
        email,
        ...(userRecord.displayName ? { name: userRecord.displayName } : {}),
        role: 'owner',
        createdAt: currentMemberSnap.exists ? currentMemberSnap.get('createdAt') ?? now : now,
        createdBy: currentMemberSnap.exists
          ? currentMemberSnap.get('createdBy') ?? uid
          : (transferSnap.get('initiatedBy') ?? uid),
        grantedBy: uid,
        roleUpdatedAt: now,
        roleUpdatedBy: uid,
      },
      { merge: true },
    );

    tx.update(transferRef, {
      status: 'accepted',
      acceptedAt: now,
      acceptedBy: uid,
    });

    return { ok: true };
  });
}

export async function cancelPlatformOwnershipTransfer(
  db: Firestore,
  { byUid }: { byUid: string },
) {
  const transferRef = transferDoc(db);
  const actorRef = memberDoc(db, byUid);

  return await db.runTransaction(async (tx) => {
    const [actorSnap, transferSnap] = await tx.getAll(actorRef, transferRef);
    if (roleOf(actorSnap) !== 'owner') {
      throw new RoleError(
        'permission-denied',
        'Only the platform owner can cancel an ownership transfer.',
        'platform_owner_required',
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

export async function getPlatformOwnershipTransfer(
  db: Firestore,
  { byUid, email }: { byUid: string; email?: string },
) {
  const transferRef = transferDoc(db);
  const snap = await transferRef.get();
  if (!ownershipTransferIsPending(snap)) return null;
  const data = snap.data()!;
  const targetEmail = String(data.targetEmail ?? '').toLowerCase();
  const normalizedEmail = email ? email.toLowerCase() : '';
  const memberSnap = byUid ? await db.doc(`platformMembers/${byUid}`).get() : null;
  const isOwner = memberSnap?.exists === true && memberSnap.get('role') === 'owner';
  const isTarget =
    (normalizedEmail && targetEmail === normalizedEmail) || data.targetUid === byUid;
  if (!isOwner && !isTarget) return null;
  return ownershipTransferView(snap, 'platform');
}
