/**
 * Creates a call for proposals from the command line, and optionally its owner.
 *
 * The app has a create form and it is the ordinary route. This exists for the
 * two cases the form cannot serve: seeding a local emulator on every `npm start`,
 * and standing a CFP up in production for an existing verified organiser who
 * is not the person running the command.
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
const owner = String(arg('owner') ?? '').trim().toLowerCase();
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
if (owner && !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(owner)) {
  console.error('The owner must be a usable email address.');
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

const genericSubmissionForm = {
  category: [
    { value: 'app_dev', label: { en: 'App Dev', fr: 'Développement d’applications' } },
    { value: 'ai_ml', label: { en: 'AI & ML', fr: 'IA et apprentissage automatique' } },
    { value: 'cloud', label: { en: 'Cloud', fr: 'Infonuagique' } },
    { value: 'web', label: { en: 'Web', fr: 'Web' } },
    { value: 'ui_ux', label: { en: 'UI & UX', fr: 'Interface et expérience utilisateur' } },
    {
      value: 'soft_skills_career',
      label: { en: 'Soft Skills & Career', fr: 'Compétences humaines et carrière' },
    },
    { value: 'other', label: { en: 'Other', fr: 'Autre' } },
  ],
  format: [
    { value: 'session_40', label: { en: 'Session — 40 minutes', fr: 'Session — 40 minutes' } },
    {
      value: 'lightning_15',
      label: { en: 'Lightning talk — 15 minutes', fr: 'Conférence éclair — 15 minutes' },
    },
    { value: 'workshop_90', label: { en: 'Workshop — 90 minutes', fr: 'Atelier — 90 minutes' } },
  ],
  level: [
    { value: 'beginner', label: { en: 'Beginner', fr: 'Débutant' } },
    { value: 'intermediate', label: { en: 'Intermediate', fr: 'Intermédiaire' } },
    { value: 'advanced', label: { en: 'Advanced', fr: 'Avancé' } },
    { value: 'all', label: { en: 'All levels', fr: 'Tous les niveaux' } },
  ],
  deliveryLanguage: [
    { value: 'en', label: { en: 'English', fr: 'Anglais' } },
    { value: 'fr', label: { en: 'French', fr: 'Français' } },
    {
      value: 'either',
      label: { en: 'Either — you choose', fr: 'L’une ou l’autre — à vous de choisir' },
    },
    {
      value: 'bilingual',
      label: {
        en: 'Bilingual — I switch between both during the talk',
        fr: 'Bilingue — j’alterne entre les deux pendant la conférence',
      },
    },
  ],
  acks: [
    {
      key: 'coc',
      type: 'checkbox',
      required: true,
      label: {
        en: 'I have read and agree to the Code of Conduct.',
        fr: 'J’ai lu et j’accepte le code de conduite.',
      },
    },
    {
      key: 'recording',
      type: 'checkbox',
      required: true,
      label: {
        en: 'I consent to my talk being recorded and published.',
        fr: 'Je consens à ce que ma conférence soit enregistrée et publiée.',
      },
    },
  ],
  fields: [],
  attendance: {
    enabled: false,
    title: { en: 'Travel and attendance', fr: 'Déplacements et présence' },
    question: {
      en: 'If your talk is accepted, what are your attendance plans?',
      fr: 'Si votre conférence est retenue, quels sont vos plans de présence ?',
    },
    help: {
      en: 'This helps the organisers plan the programme and speaker support.',
      fr: "Cela aide l'équipe organisatrice à planifier le programme et le soutien aux conférenciers.",
    },
    statusReviewerVisible: true,
    statuses: [
      { value: 'local', label: { en: 'No travel required', fr: 'Aucun déplacement requis' } },
      {
        value: 'secured',
        label: {
          en: 'My travel and accommodation are arranged',
          fr: 'Mes déplacements et mon hébergement sont organisés',
        },
      },
      {
        value: 'pending',
        label: {
          en: 'My travel arrangements are not confirmed yet',
          fr: 'Mes déplacements ne sont pas encore confirmés',
        },
      },
    ],
    fundingSource: {
      enabled: true,
      reviewerVisible: true,
      label: {
        en: 'How will your travel be funded?',
        fr: 'Comment vos déplacements seront-ils financés ?',
      },
      help: { en: 'A short description is enough.', fr: 'Une brève description suffit.' },
    },
    decisionBy: {
      enabled: true,
      reviewerVisible: true,
      label: {
        en: 'When do you expect your plans to be confirmed?',
        fr: 'Quand pensez-vous que vos plans seront confirmés ?',
      },
    },
    needsVisa: {
      enabled: true,
      reviewerVisible: true,
      label: {
        en: 'I will need entry documentation support',
        fr: "J'aurai besoin d'aide pour les documents d'entrée",
      },
      help: {
        en: 'The organisers can follow up about available documentation.',
        fr: "L'équipe organisatrice pourra vous informer des documents disponibles.",
      },
    },
  },
};

let ownerUid;
if (owner) {
  try {
    const user = await getAuth().getUserByEmail(owner);
    if (!user.emailVerified || user.disabled) {
      console.error('The owner must already have a verified, enabled account.');
      process.exit(1);
    }
    ownerUid = user.uid;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    console.error('The owner must sign in and verify their account before this script is run.');
    process.exit(1);
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

// Preserve an organiser's form on rerun. A brand-new seeded event starts with
// event-neutral logistics disabled, matching in-app CFP creation.
const submissionFormRef = db.doc(`cfps/${id}/config/submissionForm`);
await db.runTransaction(async (tx) => {
  const current = await tx.get(submissionFormRef);
  if (!current.exists) tx.create(submissionFormRef, genericSubmissionForm);
});

if (owner) {
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
}

console.log(
  `cfps/${id} written — open ${opensAt.toISOString()} to ${closesAt.toISOString()}` +
    (owner ? `, owner ${owner}` : ''),
);
process.exit(0);
