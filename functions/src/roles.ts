/**
 * Granting, revoking and claiming roles.
 *
 * Lives here rather than in `shared/` because it needs the Admin SDK, and is
 * separate from `index.ts` so the bootstrap script can call exactly the same
 * code as the callable — "what granting means" must not drift between the two.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ROLES, type Role } from '../../shared/enums';

export class RoleError extends Error {
  constructor(
    readonly code: 'invalid-argument' | 'failed-precondition' | 'not-found',
    message: string,
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

export function normalizeRole(raw: unknown): Role {
  const role = String(raw ?? '');
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new RoleError('invalid-argument', `Unknown role: ${role}`);
  }
  return role as Role;
}

async function uidForEmail(auth: Auth, email: string): Promise<string | undefined> {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch {
    return undefined; // never signed in — the grant waits for them
  }
}

async function adminUids(db: Firestore): Promise<string[]> {
  const snap = await db.collection('reviewers').where('role', '==', 'admin').get();
  return snap.docs.map((d) => d.id);
}

/**
 * Records a grant, and applies it immediately if the person already has an
 * account. Otherwise it waits in `roleGrants` for `claim` to pick up on their
 * first sign-in.
 */
export async function grant(
  db: Firestore,
  auth: Auth,
  { email: rawEmail, role: rawRole, byUid }: { email: unknown; role: unknown; byUid: string },
): Promise<{ email: string; role: Role; applied: boolean }> {
  const email = normalizeEmail(rawEmail);
  const role = normalizeRole(rawRole);
  const uid = await uidForEmail(auth, email);

  await db.doc(`roleGrants/${email}`).set(
    {
      email,
      role,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: byUid,
      ...(uid ? { claimedBy: uid, claimedAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );

  if (uid) {
    await db.doc(`reviewers/${uid}`).set(
      { role, email, createdAt: FieldValue.serverTimestamp(), grantedBy: byUid },
      { merge: true },
    );
  }

  return { email, role, applied: Boolean(uid) };
}

/**
 * Removes a role. Refuses to remove the last admin: an empty admin list can
 * only be repaired by running the bootstrap script again with credentials
 * nobody has to hand in the middle of a review round.
 */
export async function revoke(
  db: Firestore,
  auth: Auth,
  { email: rawEmail }: { email: unknown },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const uid = await uidForEmail(auth, email);

  if (uid) {
    const existing = await db.doc(`reviewers/${uid}`).get();
    if (existing.exists && existing.data()?.role === 'admin') {
      const admins = await adminUids(db);
      if (admins.length <= 1) {
        throw new RoleError('failed-precondition', 'That is the only admin left.');
      }
    }
    await db.doc(`reviewers/${uid}`).delete();
  }

  await db.doc(`roleGrants/${email}`).delete();
  return { email };
}

/**
 * Turns a pending grant into a role, on sign-in. Returns null for the ordinary
 * case of a speaker with no grant waiting.
 *
 * Trusts the email on the verified auth token, never one supplied by the caller.
 */
export async function claim(
  db: Firestore,
  { uid, email: rawEmail, name }: { uid: string; email?: string; name?: string },
): Promise<Role | null> {
  const existing = await db.doc(`reviewers/${uid}`).get();
  if (existing.exists) return (existing.data()?.role ?? null) as Role | null;

  if (!rawEmail) return null;
  const email = rawEmail.trim().toLowerCase();

  const grantSnap = await db.doc(`roleGrants/${email}`).get();
  if (!grantSnap.exists) return null;

  const granted = grantSnap.data()!;
  const role = normalizeRole(granted.role);

  await db.doc(`reviewers/${uid}`).set({
    role,
    email,
    ...(name ? { name } : {}),
    createdAt: FieldValue.serverTimestamp(),
    grantedBy: granted.createdBy ?? 'bootstrap',
  });
  await grantSnap.ref.set(
    { claimedBy: uid, claimedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  return role;
}
