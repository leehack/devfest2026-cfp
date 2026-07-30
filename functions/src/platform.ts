/**
 * Platform roles answer one question: who may create CFP workspaces.
 *
 * They do not imply a role on any CFP. A platform admin cannot read proposals,
 * speakers, reviews or email unless that event separately grants them access.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { PLATFORM_ROLES, type PlatformRole } from '../../shared/platform';
import { normalizeEmail, RoleError } from './roles';

const memberDoc = (db: Firestore, uid: string) => db.doc(`platformMembers/${uid}`);
const grantDoc = (db: Firestore, email: string) => db.doc(`platformRoleGrants/${email}`);

function normalizePlatformRole(raw: unknown): PlatformRole {
  const role = String(raw ?? '');
  if (!(PLATFORM_ROLES as readonly string[]).includes(role)) {
    throw new RoleError('invalid-argument', `Unknown platform role: ${role}`);
  }
  return role as PlatformRole;
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
 * Admin grants are written only by the bootstrap script; the app grants
 * creators, but both use the same claim path.
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
    const currentRole = current.exists
      ? normalizePlatformRole(current.get('role'))
      : null;
    const pendingRole = pending.exists
      ? normalizePlatformRole(pending.get('role'))
      : null;
    if (!pendingRole) return currentRole;

    const role: PlatformRole =
      currentRole === 'admin' || pendingRole === 'admin' ? 'admin' : 'creator';
    tx.set(member, {
      uid,
      email,
      ...(name ? { name } : {}),
      role,
      createdAt: current.exists
        ? (current.get('createdAt') ?? FieldValue.serverTimestamp())
        : FieldValue.serverTimestamp(),
      grantedBy:
        current.exists && currentRole === role
          ? (current.get('grantedBy') ?? pending.get('createdBy') ?? 'bootstrap')
          : (pending.get('createdBy') ?? 'bootstrap'),
    }, { merge: true });
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
        grantedBy: String(doc.get('grantedBy') ?? ''),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    pending: grants.docs
      .map((doc) => ({
        email: String(doc.get('email') ?? doc.id),
        role: normalizePlatformRole(doc.get('role')),
        createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
        createdBy: String(doc.get('createdBy') ?? ''),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

/** Platform admins may grant creator access, never another platform admin. */
export async function grantCfpCreator(
  db: Firestore,
  auth: Auth,
  {
    email: rawEmail,
    byUid,
  }: { email: unknown; byUid: string },
): Promise<{ email: string; applied: boolean }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);

  if (user?.emailVerified) {
    const member = memberDoc(db, user.uid);
    const pending = grantDoc(db, email);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(member);
      const existingGrant = await tx.get(pending);
      if (existing.get('role') === 'admin' || existingGrant.get('role') === 'admin') {
        throw new RoleError(
          'failed-precondition',
          'Platform admins are managed by the bootstrap script.',
        );
      }
      tx.set(member, {
        uid: user.uid,
        email,
        ...(user.displayName ? { name: user.displayName } : {}),
        role: 'creator',
        createdAt: existing.exists
          ? (existing.get('createdAt') ?? FieldValue.serverTimestamp())
          : FieldValue.serverTimestamp(),
        grantedBy: byUid,
      }, { merge: true });
      tx.delete(pending);
    });
    return { email, applied: true };
  }

  const pending = grantDoc(db, email);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(pending);
    if (existing.get('role') === 'admin') {
      throw new RoleError(
        'failed-precondition',
        'Platform admins are managed by the bootstrap script.',
      );
    }
    tx.set(pending, {
      email,
      role: 'creator',
      createdAt: existing.exists
        ? (existing.get('createdAt') ?? FieldValue.serverTimestamp())
        : FieldValue.serverTimestamp(),
      createdBy: byUid,
    });
  });
  return { email, applied: false };
}

/** Revocation stops future creation; CFPs the person already owns stay theirs. */
export async function revokeCfpCreator(
  db: Firestore,
  auth: Auth,
  { email: rawEmail }: { email: unknown },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const user = await userForEmail(auth, email);
  const matches = await db
    .collection('platformMembers')
    .where('email', '==', email)
    .get();
  const members = new Map(
    [
      ...(user ? [memberDoc(db, user.uid)] : []),
      ...matches.docs.map((doc) => doc.ref),
    ].map((ref) => [ref.path, ref]),
  );
  const pending = grantDoc(db, email);

  await db.runTransaction(async (tx) => {
    const current = [];
    for (const ref of members.values()) current.push(await tx.get(ref));
    const existingGrant = await tx.get(pending);

    if (
      current.some((member) => member.get('role') === 'admin') ||
      existingGrant.get('role') === 'admin'
    ) {
      throw new RoleError(
        'failed-precondition',
        'Platform admins are managed by the bootstrap script.',
      );
    }
    for (const member of current) {
      if (member.exists) tx.delete(member.ref);
    }
    tx.delete(pending);
  });
  return { email };
}
