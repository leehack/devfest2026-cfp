/**
 * Bootstraps the platform role that the app deliberately cannot grant.
 *
 * A verified account is written directly to `platformMembers`. If the address
 * has never signed in, the grant waits by email and `platformAccess` claims it
 * after that person proves ownership of the mailbox.
 *
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform-admin.mjs --email you@example.org
 *   GCLOUD_PROJECT=<project-id> node scripts/set-platform-admin.mjs --email you@example.org --remove
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = String(arg('email') ?? '').trim().toLowerCase();
const remove = process.argv.includes('--remove');
if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
  console.error('Usage: node scripts/set-platform-admin.mjs --email you@example.org [--remove]');
  process.exit(1);
}

initializeApp();
const db = getFirestore();
const auth = getAuth();
const grant = db.doc(`platformRoleGrants/${email}`);

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  user = null;
}
const member = user ? db.doc(`platformMembers/${user.uid}`) : null;

if (remove) {
  const [admins, pendingAdmins] = await Promise.all([
    db.collection('platformMembers').where('role', '==', 'admin').get(),
    db.collection('platformRoleGrants').where('role', '==', 'admin').get(),
  ]);
  const matchingMembers = admins.docs.filter(
    (doc) =>
      doc.id === member?.id ||
      String(doc.get('email') ?? '').trim().toLowerCase() === email,
  );
  const matchingIds = new Set(matchingMembers.map((doc) => doc.id));
  const otherActive = admins.docs.filter((doc) => !matchingIds.has(doc.id));
  const removesPending = pendingAdmins.docs.some((doc) => doc.id === email);
  const otherPending = pendingAdmins.docs.filter((doc) => doc.id !== email);
  if (
    (matchingMembers.length > 0 && otherActive.length === 0) ||
    (admins.empty && removesPending && otherPending.length === 0)
  ) {
    console.error('Refusing to remove the last platform admin.');
    process.exit(1);
  }
  await Promise.all([...matchingMembers.map((doc) => doc.ref.delete()), grant.delete()]);
  console.log(`Platform admin removed: ${email}`);
  process.exit(0);
}

if (user?.emailVerified && member) {
  await member.set(
    {
      uid: user.uid,
      email,
      ...(user.displayName ? { name: user.displayName } : {}),
      role: 'admin',
      createdAt: FieldValue.serverTimestamp(),
      grantedBy: 'bootstrap-script',
    },
    { merge: true },
  );
  await grant.delete();
  console.log(`Platform admin active: ${email}`);
} else {
  await grant.set({
    email,
    role: 'admin',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'bootstrap-script',
  });
  console.log(`Platform admin pending verified sign-in: ${email}`);
}
process.exit(0);
