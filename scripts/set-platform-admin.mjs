/**
 * Bootstraps platform roles that are deliberately above ordinary CFP access.
 *
 * `admin` remains the default for backwards compatibility. The first owner,
 * and any later owner handoff, must be explicit with `--role owner`.
 *
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform-admin.mjs --email you@example.org
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform-admin.mjs --email you@example.org --role owner
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform-admin.mjs --email you@example.org --role owner --remove
 */

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = String(arg('email') ?? '').trim().toLowerCase();
const role = String(arg('role') ?? 'admin').trim().toLowerCase();
const remove = process.argv.includes('--remove');
const gcloudProject = String(process.env.GCLOUD_PROJECT ?? '').trim();
const googleCloudProject = String(process.env.GOOGLE_CLOUD_PROJECT ?? '').trim();
const projectId = gcloudProject || googleCloudProject;
if (
  !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) ||
  !['admin', 'owner'].includes(role) ||
  !projectId ||
  (gcloudProject && googleCloudProject && gcloudProject !== googleCloudProject)
) {
  console.error(
    'Usage: GCLOUD_PROJECT=my-project node scripts/set-platform-admin.mjs --email you@example.org [--role admin|owner] [--remove]',
  );
  process.exit(1);
}

console.log(`Target project: ${projectId}`);
const app = initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();
const grant = db.doc(`platformRoleGrants/${email}`);
const actor = 'bootstrap-script';
const label = role === 'owner' ? 'owner' : 'admin';

async function finish(code = 0) {
  await db.terminate();
  await deleteApp(app);
  process.exit(code);
}

async function usablePlatformUids() {
  const [owners, admins] = await Promise.all([
    db.collection('platformMembers').where('role', '==', 'owner').get(),
    db.collection('platformMembers').where('role', '==', 'admin').get(),
  ]);
  const uids = [...new Set([...owners.docs, ...admins.docs].map((doc) => doc.id))];
  const usable = new Set();
  for (let start = 0; start < uids.length; start += 100) {
    const batch = await auth.getUsers(
      uids.slice(start, start + 100).map((uid) => ({ uid })),
    );
    for (const record of batch.users) {
      if (!record.disabled && record.emailVerified) usable.add(record.uid);
    }
  }
  return usable;
}

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  user = null;
}
const member = user ? db.doc(`platformMembers/${user.uid}`) : null;

if (remove) {
  try {
    // Auth and Firestore cannot share one transaction. This preflight can race
    // a later Auth disable, but the Firestore transaction still pins the set of
    // role documents it validated and removes atomically.
    const usableUids = await usablePlatformUids();
    const removed = await db.runTransaction(async (tx) => {
      const members = await tx.get(
        db.collection('platformMembers').where('role', '==', role),
      );
      const pending = await tx.get(
        db.collection('platformRoleGrants').where('role', '==', role),
      );
      const owners =
        role === 'owner'
          ? members
          : await tx.get(
              db.collection('platformMembers').where('role', '==', 'owner'),
            );
      const matchingMembers = members.docs.filter(
        (doc) =>
          doc.id === member?.id ||
          String(doc.get('email') ?? '').trim().toLowerCase() === email,
      );
      const matchingIds = new Set(matchingMembers.map((doc) => doc.id));
      const otherActive = members.docs.filter((doc) => !matchingIds.has(doc.id));
      const removesPending = pending.docs.some((doc) => doc.id === email);
      const otherUsable = otherActive.filter((doc) => usableUids.has(doc.id));
      const usableOwners = owners.docs.filter((doc) => usableUids.has(doc.id));

      if (
        role === 'owner' &&
        matchingMembers.length > 0 &&
        otherUsable.length === 0
      ) {
        throw new Error('LAST_PLATFORM_OWNER');
      }
      if (
        role === 'admin' &&
        matchingMembers.length > 0 &&
        usableOwners.length === 0 &&
        otherUsable.length === 0
      ) {
        throw new Error('LAST_LEGACY_PLATFORM_ADMIN');
      }
      for (const doc of matchingMembers) tx.delete(doc.ref);
      if (removesPending) tx.delete(grant);
      return matchingMembers.length > 0 || removesPending;
    });
    console.log(
      removed
        ? `Platform ${label} removed: ${email}`
        : `No platform ${label} found: ${email}`,
    );
  } catch (error) {
    if (error?.message === 'LAST_PLATFORM_OWNER') {
      console.error('Refusing to remove the last platform owner.');
      await finish(1);
    }
    if (error?.message === 'LAST_LEGACY_PLATFORM_ADMIN') {
      console.error(
        'Refusing to remove the last usable platform administrator before an owner is active.',
      );
      await finish(1);
    }
    throw error;
  }
  await finish();
}

const applied = await db.runTransaction(async (tx) => {
  const current = member ? await tx.get(member) : null;
  const pending = await tx.get(grant);
  const currentRole = String(current?.get('role') ?? '');
  const pendingRole = String(pending.get('role') ?? '');
  const nextRole =
    role === 'owner' || currentRole === 'owner' || pendingRole === 'owner'
      ? 'owner'
      : 'admin';
  const now = FieldValue.serverTimestamp();

  if (user?.emailVerified && member) {
    const roleChanged = currentRole !== nextRole;
    tx.set(
      member,
      {
        uid: user.uid,
        email,
        ...(user.displayName ? { name: user.displayName } : {}),
        role: nextRole,
        createdAt: current?.get('createdAt') ?? now,
        createdBy: current?.get('createdBy') ?? current?.get('grantedBy') ?? actor,
        grantedBy: roleChanged ? actor : (current?.get('grantedBy') ?? actor),
        roleUpdatedAt: roleChanged
          ? now
          : (current?.get('roleUpdatedAt') ?? current?.get('createdAt') ?? now),
        roleUpdatedBy: roleChanged
          ? actor
          : (current?.get('roleUpdatedBy') ?? current?.get('grantedBy') ?? actor),
      },
      { merge: true },
    );
    tx.delete(grant);
    return { active: true, role: nextRole };
  }

  const roleChanged = pendingRole !== nextRole;
  tx.set(grant, {
    email,
    role: nextRole,
    createdAt: pending.get('createdAt') ?? now,
    createdBy: pending.get('createdBy') ?? actor,
    roleUpdatedAt: roleChanged
      ? now
      : (pending.get('roleUpdatedAt') ?? pending.get('createdAt') ?? now),
    roleUpdatedBy: roleChanged
      ? actor
      : (pending.get('roleUpdatedBy') ?? pending.get('createdBy') ?? actor),
  });
  return { active: false, role: nextRole };
});

const appliedLabel = applied.role === 'owner' ? 'owner' : 'admin';
console.log(
  applied.active
    ? `Platform ${appliedLabel} active: ${email}`
    : `Platform ${appliedLabel} pending verified sign-in: ${email}`,
);
await finish();
