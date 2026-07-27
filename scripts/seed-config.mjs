/**
 * Seeds config/cfp. The rules and submitProposal both read it and both fail
 * closed without it, so nothing works until this has run once.
 *
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-cfp \
 *     node scripts/seed-config.mjs --opens 2026-10-01 --closes 2026-11-21
 *
 * Production (needs application-default credentials):
 *   GCLOUD_PROJECT=<project-id> node scripts/seed-config.mjs \
 *     --opens 2026-10-01 --closes 2026-11-21
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const opens = arg('opens');
const closes = arg('closes');

if (!opens || !closes) {
  console.error('Usage: node scripts/seed-config.mjs --opens YYYY-MM-DD --closes YYYY-MM-DD');
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

await getFirestore().doc('config/cfp').set({
  opensAt: Timestamp.fromDate(opensAt),
  closesAt: Timestamp.fromDate(closesAt),
  paused: false,
  // Reviewers cannot see each other's scores until this flips (§7, anchoring).
  reviewsVisible: false,
});

console.log(`config/cfp written — open ${opensAt.toISOString()} to ${closesAt.toISOString()}`);
process.exit(0);
