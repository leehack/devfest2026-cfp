/**
 * Granting, revoking and claiming roles, within one CFP.
 *
 * Lives here rather than in `shared/` because it needs the Admin SDK, and
 * separate from `index.ts` so that "what granting means" is written once.
 *
 * Every function below takes a `cfpId` and touches nothing outside it. There is
 * no platform-wide role: the person who creates a CFP is written as its owner
 * in the same transaction, which is what replaced the bootstrap script.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { CFP_ROLES, type CfpRole } from '../../shared/cfp';

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

/**
 * `owner` is deliberately not grantable. It is written once, to whoever created
 * the CFP, and moves only through `transferCfp` — otherwise an admin could
 * promote themselves and then archive the thing out from under its owner.
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
async function uidForEmail(auth: Auth, email: string): Promise<string | undefined> {
  try {
    const user = await auth.getUserByEmail(email);
    return user.emailVerified ? user.uid : undefined;
  } catch {
    return undefined; // never signed in — the grant waits for them
  }
}

async function adminUids(db: Firestore, cfpId: string): Promise<string[]> {
  const snap = await db
    .collection(`cfps/${cfpId}/members`)
    .where('role', 'in', ['admin', 'owner'])
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * Records a grant, and applies it immediately if the person already has an
 * account. Otherwise it waits in `roleGrants` for `claim` to pick up on their
 * first visit to this CFP.
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
): Promise<{ email: string; role: CfpRole; applied: boolean }> {
  const email = normalizeEmail(rawEmail);
  const role = normalizeRole(rawRole);
  const uid = await uidForEmail(auth, email);

  await grantDoc(db, cfpId, email).set(
    {
      cfpId,
      email,
      role,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: byUid,
      ...(uid ? { claimedBy: uid, claimedAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );

  if (uid) {
    await memberDoc(db, cfpId, uid).set(
      {
        cfpId,
        uid,
        role,
        email,
        createdAt: FieldValue.serverTimestamp(),
        grantedBy: byUid,
      },
      { merge: true },
    );
  }

  return { email, role, applied: Boolean(uid) };
}

/**
 * Removes a role. Refuses to remove the last admin: a CFP with nobody who can
 * administer it can only be repaired by its owner, and the owner may be the
 * person being removed.
 */
export async function revoke(
  db: Firestore,
  auth: Auth,
  { cfpId, email: rawEmail }: { cfpId: string; email: unknown },
): Promise<{ email: string }> {
  const email = normalizeEmail(rawEmail);
  const uid = await uidForEmail(auth, email);

  if (uid) {
    const existing = await memberDoc(db, cfpId, uid).get();
    const role = existing.data()?.role;
    if (role === 'owner') {
      throw new RoleError('failed-precondition', 'An owner cannot be removed.');
    }
    if (existing.exists && role === 'admin') {
      const admins = await adminUids(db, cfpId);
      if (admins.length <= 1) {
        throw new RoleError('failed-precondition', 'That is the only admin left.');
      }
    }
    await memberDoc(db, cfpId, uid).delete();
  }

  await grantDoc(db, cfpId, email).delete();
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
  const existing = await memberDoc(db, cfpId, uid).get();
  if (existing.exists) return (existing.data()?.role ?? null) as CfpRole | null;

  if (!rawEmail) return null;
  const email = rawEmail.trim().toLowerCase();

  const grantSnap = await grantDoc(db, cfpId, email).get();
  if (!grantSnap.exists) return null;

  const granted = grantSnap.data()!;
  const role = normalizeRole(granted.role);

  await memberDoc(db, cfpId, uid).set({
    cfpId,
    uid,
    role,
    email,
    ...(name ? { name } : {}),
    createdAt: FieldValue.serverTimestamp(),
    grantedBy: granted.createdBy ?? 'unknown',
  });
  await grantSnap.ref.set(
    { claimedBy: uid, claimedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  return role;
}
