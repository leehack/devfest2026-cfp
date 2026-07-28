/**
 * Creates a call for proposals from the command line, and optionally its owner.
 *
 * The app has a create form and it is the ordinary route. This exists for the
 * two cases the form cannot serve: seeding a local emulator on every `npm start`,
 * and standing a CFP up in production for someone who is not the person running
 * the command.
 *
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-devfest-cfp \
 *     node scripts/seed-cfp.mjs --id devfest-mtl-2026 --name "DevFest Montréal 2026" \
 *       --opens 2026-10-01 --closes 2026-11-21
 *
 * Production (needs application-default credentials):
 *   GCLOUD_PROJECT=<project-id> node scripts/seed-cfp.mjs --id … --owner you@example.org
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const id = arg('id');
const name = arg('name') ?? id;
const opens = arg('opens');
const closes = arg('closes');
const owner = arg('owner');
const visibility = arg('visibility') ?? 'public';

if (!id || !opens || !closes) {
  console.error(
    'Usage: node scripts/seed-cfp.mjs --id <slug> [--name "…"] --opens YYYY-MM-DD --closes YYYY-MM-DD [--owner email] [--visibility public|private]',
  );
  process.exit(1);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error('The id must be lower case letters, digits and single hyphens.');
  process.exit(1);
}

const ZONE = 'America/Toronto';

/**
 * Resolves a local wall-clock time in `ZONE` to a UTC instant.
 *
 * A hardcoded -05:00 is wrong for most of the year: Montréal is on EDT (-04:00)
 * from March to November, which covers any realistic CFP window. Solving for
 * the offset at that specific date handles both sides of the DST boundary.
 */
function zonedTime(date, time) {
  const asUtc = new Date(`${date}T${time}Z`);
  if (Number.isNaN(asUtc.valueOf())) return asUtc;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(asUtc)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );

  const seenLocally = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
  return new Date(asUtc.getTime() - (seenLocally - asUtc.getTime()));
}

// Submissions close at 23:59:59 Montréal time on the closing date. Using a bare
// date would close the CFP at midnight UTC, which is 19:00 or 20:00 locally —
// an unpleasant surprise for anyone submitting on the last evening.
const opensAt = zonedTime(opens, '00:00:00');
const closesAt = zonedTime(closes, '23:59:59');

if (Number.isNaN(opensAt.valueOf()) || Number.isNaN(closesAt.valueOf())) {
  console.error('Dates must be YYYY-MM-DD.');
  process.exit(1);
}
if (closesAt <= opensAt) {
  console.error('The closing date must be after the opening date.');
  process.exit(1);
}

initializeApp();
const db = getFirestore();

/**
 * The owner's uid, if they have an account. Absent is fine and common — a CFP
 * stood up before its organiser has ever signed in gets a pending `roleGrants`
 * entry instead, which `claimRole` turns into a membership on their first visit.
 */
let ownerUid;
if (owner) {
  try {
    ownerUid = (await getAuth().getUserByEmail(owner)).uid;
  } catch {
    ownerUid = undefined;
  }
}

// Merged, so re-running this against a live CFP moves the window rather than
// wiping the ownership and visibility somebody has since changed.
await db.doc(`cfps/${id}`).set(
  {
    name,
    visibility,
    archived: false,
    opensAt: Timestamp.fromDate(opensAt),
    closesAt: Timestamp.fromDate(closesAt),
    paused: false,
    // Reviewers cannot see each other's scores until this flips (§7, anchoring).
    reviewsVisible: false,
    ...(ownerUid ? { ownerUids: FieldValue.arrayUnion(ownerUid) } : {}),
    createdBy: ownerUid ?? 'script',
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

if (owner) {
  if (ownerUid) {
    await db.doc(`cfps/${id}/members/${ownerUid}`).set(
      {
        cfpId: id,
        uid: ownerUid,
        role: 'owner',
        email: owner,
        createdAt: FieldValue.serverTimestamp(),
        grantedBy: 'script',
      },
      { merge: true },
    );
  } else {
    // `owner` is not grantable through the callable, deliberately. Writing the
    // grant here is the one place it can be handed to somebody who has never
    // signed in, and it is the same shape `claimRole` reads.
    await db.doc(`cfps/${id}/roleGrants/${owner}`).set(
      {
        cfpId: id,
        email: owner,
        role: 'owner',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'script',
      },
      { merge: true },
    );
  }
}

console.log(
  `cfps/${id} written — open ${opensAt.toISOString()} to ${closesAt.toISOString()}` +
    (owner ? `, owner ${owner}${ownerUid ? '' : ' (pending first sign-in)'}` : ''),
);
process.exit(0);
