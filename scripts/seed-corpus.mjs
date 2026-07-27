/**
 * Generates a realistic review corpus so the evaluation side can be exercised.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-devfest-cfp \
 *     node scripts/seed-corpus.mjs --proposals 40
 *
 * Every proposal is given a hidden "true quality", and each reviewer expresses
 * that quality through a persona — generous, harsh, polarised, flat. This is
 * the whole point: with uniformly calibrated reviewers, z-score normalisation
 * is a no-op and the corpus would prove nothing. Because each proposal is seen
 * by a random subset of reviewers, a proposal that happens to draw three
 * generous reviewers gets an inflated raw average, which is exactly the
 * distortion §7 says normalisation exists to correct.
 *
 * The script finishes by ranking the corpus both ways and reporting which
 * ordering better recovers the hidden quality. That number is the evidence for
 * (or against) §7's claim on data shaped like yours.
 *
 * Deterministic: same --seed gives the same corpus, so a ranking change means
 * the code changed.
 */

import { createRequire } from 'node:module';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);

let aggregateReviews;
try {
  ({ aggregateReviews } = require('../functions/lib/shared/aggregate.js'));
} catch {
  console.error('Build the shared code first:  npm --prefix functions run build');
  process.exit(1);
}

// ------------------------------------------------------------------- options

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PROPOSALS = Number(arg('proposals', 40));
const SEED = Number(arg('seed', 20260726));
const REVIEWS_EACH = Number(arg('reviewsEach', 3));

/** mulberry32 — small, seedable, and good enough for fixtures. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];

// ------------------------------------------------------------------ personas

/**
 * Maps a hidden quality in [0,1] to a 1–4 score.
 *
 * Personas differ mainly in *offset* — where they sit on the scale — while all
 * but one span a comparable range. That distinction turns out to matter more
 * than it looks:
 *
 *   Normalisation corrects for offset. It cannot recover information a reviewer
 *   never expressed. A persona clamped into two adjacent values (say, only ever
 *   3 or 4) carries about one bit, and normalising it mostly amplifies rounding
 *   noise — the first draft of this file did exactly that, and normalisation
 *   came out *behind* the raw average.
 *
 * `flat` is kept deliberately: every committee has one reviewer who scores
 * everything the same, and it is worth seeing what they cost you.
 *
 * These are a model of your committee. Change them to match the one you
 * actually have, and the numbers at the end tell you whether §7's claim holds
 * for it.
 */
const REVIEWERS = [
  { uid: 'rev-generous', name: 'Generous', role: 'organizer', score: (q) => clamp(1.9 + q * 2.6) },
  { uid: 'rev-harsh', name: 'Harsh', role: 'organizer', score: (q) => clamp(0.6 + q * 2.6) },
  { uid: 'rev-middling', name: 'Middling', role: 'organizer', score: (q) => clamp(1.3 + q * 2.4) },
  { uid: 'rev-polarised', name: 'Polarised', role: 'organizer', score: (q) => clamp(0.5 + q * 4.0) },
  { uid: 'rev-flat', name: 'Flat', role: 'organizer', score: (q) => clamp(2.6 + q * 0.7) },
  { uid: 'rev-lead', name: 'Lead', role: 'lead', score: (q) => clamp(1.2 + q * 2.7) },
];

function clamp(value) {
  return Math.max(1, Math.min(4, Math.round(value)));
}

// ------------------------------------------------------------------- content

const CATEGORIES = ['app_dev', 'ai_ml', 'cloud', 'web', 'ui_ux', 'soft_skills_career', 'other'];
const FORMATS = ['session_40', 'lightning_15', 'workshop_90'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'all'];
const DELIVERY = ['en', 'en', 'fr', 'fr', 'either', 'bilingual'];
const ATTENDANCE = ['local', 'local', 'local', 'secured', 'pending'];

const TOPIC = ['Shipping', 'Debugging', 'Scaling', 'Rethinking', 'Surviving', 'Automating'];
const THING = ['Flutter builds', 'edge functions', 'vector search', 'design systems',
  'CI pipelines', 'Firestore rules', 'on-call rotations', 'WASM modules'];
const TAIL = ['without the pain', 'at 3am', 'on a budget', 'for real users', 'the boring way'];

const CITIES = ['Montréal, QC', 'Montréal, QC', 'Québec City, QC', 'Toronto, ON',
  'Ottawa, ON', 'Sherbrooke, QC', 'Paris, France', 'Lagos, Nigeria', 'Bengaluru, India'];

function paragraph(minLength) {
  const bank = [
    'This talk walks through what actually happened when we tried it in production.',
    'We will start from a failing build and work back to the decision that caused it.',
    'Expect concrete numbers, a couple of dead ends, and the fix that finally held.',
    'No prior experience with the tooling is assumed, though some context helps.',
    'You will leave with a checklist you can run against your own project on Monday.',
    'The interesting part is not the solution but the three that did not work.',
  ];
  let text = '';
  while (text.length < minLength) text += `${pick(bank)} `;
  return text.trim();
}

// ---------------------------------------------------------------------- main

initializeApp();
const db = getFirestore();

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST. This writes fake data.');
  process.exit(1);
}

const proposals = [];
for (let i = 0; i < PROPOSALS; i += 1) {
  const quality = rand();
  proposals.push({
    id: `seed-p${String(i).padStart(3, '0')}`,
    speakerId: `seed-s${String(i).padStart(3, '0')}`,
    quality,
    title: `${pick(TOPIC)} ${pick(THING)} ${pick(TAIL)}`,
    deliveryLanguage: pick(DELIVERY),
    category: pick(CATEGORIES),
    format: pick(FORMATS),
    level: pick(LEVELS),
    attendance: pick(ATTENDANCE),
    basedIn: pick(CITIES),
  });
}

const batchWrites = [];
const reviewRecords = [];

for (const p of proposals) {
  // Each proposal is seen by a random subset, so coverage is uneven — that is
  // what makes a raw average unfair.
  const panel = [...REVIEWERS].sort(() => rand() - 0.5).slice(0, REVIEWS_EACH);

  batchWrites.push([
    db.doc(`speakers/${p.speakerId}`),
    {
      name: `Seed Speaker ${p.speakerId.slice(-3)}`,
      bio: paragraph(120),
      basedIn: p.basedIn,
      socials: [],
      isGde: rand() < 0.15,
      email: `${p.speakerId}@example.org`,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  ]);

  batchWrites.push([
    db.doc(`proposals/${p.id}`),
    {
      speakerIds: [p.speakerId],
      title: p.title,
      abstract: paragraph(260),
      pitch: rand() < 0.7 ? paragraph(90) : '',
      category: p.category,
      format: p.format,
      level: p.level,
      deliveryLanguage: p.deliveryLanguage,
      ...(p.deliveryLanguage === 'either' ? { languagePreference: 'Slight preference for French' } : {}),
      acks: { noTravelSupport: true, coc: true, recording: true },
      attendance: {
        status: p.attendance,
        ...(p.attendance !== 'local' ? { fundingSource: 'Employer conference budget' } : {}),
        ...(p.attendance === 'pending' ? { decisionBy: '2026-09-30' } : {}),
        needsVisa: !p.basedIn.match(/QC|ON$/) && rand() < 0.8,
      },
      status: 'under_review',
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  ]);

  for (const reviewer of panel) {
    // ~6% conflicts, so exclusion has something to actually exclude.
    const conflict = rand() < 0.06;
    const score = reviewer.score(p.quality);
    batchWrites.push([
      db.doc(`proposals/${p.id}/reviews/${reviewer.uid}`),
      {
        score,
        note: conflict ? 'Former colleague.' : '',
        conflictOfInterest: conflict,
        createdAt: FieldValue.serverTimestamp(),
      },
    ]);
    reviewRecords.push({
      proposalId: p.id,
      reviewerUid: reviewer.uid,
      score,
      conflictOfInterest: conflict,
    });
  }
}

for (const r of REVIEWERS) {
  batchWrites.push([
    db.doc(`reviewers/${r.uid}`),
    { name: r.name, email: `${r.uid}@example.org`, role: r.role },
  ]);
}

// Compute aggregates with the same code the Cloud Function uses.
const aggregates = aggregateReviews(reviewRecords);
for (const [proposalId, aggregate] of aggregates) {
  batchWrites.push([db.doc(`proposals/${proposalId}`), { aggregate }, true]);
}

const CHUNK = 400;
for (let i = 0; i < batchWrites.length; i += CHUNK) {
  const batch = db.batch();
  for (const [ref, data, merge] of batchWrites.slice(i, i + CHUNK)) {
    batch.set(ref, data, { merge: merge === true });
  }
  await batch.commit();
}

// ------------------------------------------------------------- does it work?

/** Spearman rank correlation against the hidden quality. 1.0 = perfect recovery. */
function rankCorrelation(order, truth) {
  const rank = new Map(order.map((id, i) => [id, i]));
  const truthOrder = [...truth.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const truthRank = new Map(truthOrder.map((id, i) => [id, i]));
  const n = order.length;
  if (n < 2) return 1;
  let sumSq = 0;
  for (const id of order) sumSq += (rank.get(id) - truthRank.get(id)) ** 2;
  return 1 - (6 * sumSq) / (n * (n * n - 1));
}

const truth = new Map(proposals.map((p) => [p.id, p.quality]));
const scored = [...aggregates.entries()];
const byRaw = [...scored].sort((a, b) => b[1].avgScore - a[1].avgScore).map(([id]) => id);
const byNorm = [...scored].sort((a, b) => b[1].normalizedScore - a[1].normalizedScore).map(([id]) => id);

const rawR = rankCorrelation(byRaw, truth);
const normR = rankCorrelation(byNorm, truth);

const contested = [...scored].sort((a, b) => b[1].stdDev - a[1].stdDev).slice(0, 5);

console.log(`\nSeeded ${proposals.length} proposals, ${REVIEWERS.length} reviewers, ${reviewRecords.length} reviews.`);
console.log(`Conflicts flagged: ${reviewRecords.filter((r) => r.conflictOfInterest).length}`);
console.log('\nHow well does each ranking recover the hidden quality?');
console.log(`  raw average      ${rawR.toFixed(3)}`);
console.log(`  normalised       ${normR.toFixed(3)}`);
console.log(
  normR > rawR
    ? `  -> normalisation wins by ${(normR - rawR).toFixed(3)}`
    : `  -> normalisation did NOT help here (${(normR - rawR).toFixed(3)})`,
);
console.log('\nHow much of the scale did each reviewer use?');
console.log('  (a reviewer stuck on one or two values cannot be normalised into signal)');
for (const r of REVIEWERS) {
  const mine = reviewRecords.filter((x) => x.reviewerUid === r.uid && !x.conflictOfInterest);
  const counts = [1, 2, 3, 4].map((s) => mine.filter((x) => x.score === s).length);
  const used = counts.filter((c) => c > 0).length;
  console.log(
    `  ${r.name.padEnd(10)} n=${String(mine.length).padStart(3)}  ` +
      `1:${counts[0]} 2:${counts[1]} 3:${counts[2]} 4:${counts[3]}  ` +
      `(${used}/4 values)`,
  );
}

console.log('\nTop 5 by disagreement — this is your committee agenda:');
for (const [id, a] of contested) {
  console.log(`  ${id}  sd=${a.stdDev.toFixed(2)}  avg=${a.avgScore.toFixed(2)}  n=${a.reviewCount}`);
}
console.log('');

process.exit(0);
