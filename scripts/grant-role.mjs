/**
 * Grants a role from the command line — the only way to make the first admin,
 * since the admin page needs one to exist before anybody can open it.
 *
 * Calls the same code as the `grantRole` callable, so "what granting means"
 * cannot drift between the two.
 *
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-devfest-cfp \
 *     node scripts/grant-role.mjs --email you@example.org --role admin
 *
 * Production (needs application-default credentials):
 *   GCLOUD_PROJECT=devfest-mtl-2026-cfp \
 *     node scripts/grant-role.mjs --email you@example.org --role admin
 */

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

/**
 * Everything resolves through `functions/node_modules`, including firebase-admin.
 * The repo root has its own copy, and mixing the two means the compiled
 * `roles.js` mints a `serverTimestamp()` sentinel that the root's Firestore
 * refuses to serialise.
 */
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));

let roles, initializeApp, getAuth, getFirestore;
try {
  roles = require('../functions/lib/functions/src/roles.js');
  ({ initializeApp } = requireFromFunctions('firebase-admin/app'));
  ({ getAuth } = requireFromFunctions('firebase-admin/auth'));
  ({ getFirestore } = requireFromFunctions('firebase-admin/firestore'));
} catch {
  console.error('Build the functions first:  npm --prefix functions run build');
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = arg('email');
const role = arg('role') ?? 'admin';
const revoking = process.argv.includes('--revoke');

if (!email) {
  console.error('Usage: node scripts/grant-role.mjs --email you@example.org [--role admin|reviewer] [--revoke]');
  process.exit(1);
}

initializeApp();
const db = getFirestore();
const auth = getAuth();

try {
  if (revoking) {
    const result = await roles.revoke(db, auth, { email });
    console.log(`Revoked every role for ${result.email}.`);
  } else {
    const result = await roles.grant(db, auth, { email, role, byUid: 'bootstrap' });
    console.log(
      result.applied
        ? `${result.email} is now ${result.role} — they already had an account, so it is live.`
        : `${result.email} will become ${result.role} the first time they sign in.`,
    );
  }
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
