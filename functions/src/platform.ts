/**
 * Platform roles answer who may create CFPs and who may delegate that access.
 *
 * They never imply a role on a CFP. Platform owners and admins cannot read an
 * event's proposals, speakers, reviews or email unless that event separately
 * grants them access.
 */

import type { Auth } from 'firebase-admin/auth';
import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import { PLATFORM_ROLES, type PlatformRole } from '../../shared/platform';
import { normalizeEmail, RoleError } from './roles';

const memberDoc = (db: Firestore, uid: string) => db.doc(`platformMembers/${uid}`);
const grantDoc = (db: Firestore, email: string) => db.doc(`platformRoleGrants/${email}`);
const roleRank: Record<PlatformRole, number> = { creator: 0, admin: 1, owner: 2 };

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
  requested: 'admin' | 'creator',
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

export async function listPlatformAccess(db: Firestore) {
  const [members, grants] = await Promise.all([
    db.collection('platformMembers').get(),
    db.collection('platformRoleGrants').get(),
  ]);
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
    role: 'admin' | 'creator';
    byUid: string;
  },
): Promise<{ email: string; applied: boolean }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);
  const member = user ? memberDoc(db, user.uid) : null;
  const pending = grantDoc(db, email);
  const matches = db.collection('platformMembers').where('email', '==', email);

  return await db.runTransaction(async (tx) => {
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

/** Platform owners and admins may grant creator access. */
export async function grantCfpCreator(
  db: Firestore,
  auth: Auth,
  input: { email: unknown; byUid: string },
) {
  return await grantPlatformRole(db, auth, { ...input, role: 'creator' });
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
    role: 'admin' | 'creator';
    byUid: string;
  },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);
  const target = user ? memberDoc(db, user.uid) : null;
  const pending = grantDoc(db, email);
  const matches = db.collection('platformMembers').where('email', '==', email);

  await db.runTransaction(async (tx) => {
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

/** Revocation stops future creation; CFPs the person already owns stay theirs. */
export async function revokeCfpCreator(
  db: Firestore,
  auth: Auth,
  input: { email: unknown; byUid: string },
) {
  return await revokePlatformRole(db, auth, { ...input, role: 'creator' });
}

/** Only owners call this; owner records remain bootstrap-managed. */
export async function revokePlatformAdmin(
  db: Firestore,
  auth: Auth,
  input: { email: unknown; byUid: string },
) {
  return await revokePlatformRole(db, auth, { ...input, role: 'admin' });
}
