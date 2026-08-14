/**
 * Moves one legacy CFP into the organization hierarchy without touching its
 * subcollections. Dry-run is the default; writes require the project id twice.
 *
 * Prepare is compatible with the old and new releases: it adds the scalar
 * owner and organization while retaining the legacy owner array. Finalize runs
 * after the new release is verified and removes only retired compatibility data.
 */

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ORG_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function value(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseMigrationArgs(argv, env = process.env) {
  const projectFromFlag = String(value(argv, 'project') ?? '').trim();
  const gcloudProject = String(env.GCLOUD_PROJECT ?? '').trim();
  const googleCloudProject = String(env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  if (gcloudProject && googleCloudProject && gcloudProject !== googleCloudProject) {
    throw new Error('GCLOUD_PROJECT and GOOGLE_CLOUD_PROJECT do not match.');
  }
  const projectFromEnv = gcloudProject || googleCloudProject;
  if (projectFromFlag && projectFromEnv && projectFromFlag !== projectFromEnv) {
    throw new Error('The project flag and environment project do not match.');
  }

  const projectId = projectFromFlag || projectFromEnv;
  const cfpId = String(value(argv, 'cfp') ?? '').trim().toLowerCase();
  const orgId = String(value(argv, 'org') ?? '').trim().toLowerCase();
  const orgName = String(value(argv, 'org-name') ?? '').trim();
  const phase = String(value(argv, 'phase') ?? 'prepare').trim().toLowerCase();
  const apply = argv.includes('--apply');
  const confirmedProject = String(value(argv, 'confirm-project') ?? '').trim();
  const rawLimit = String(value(argv, 'active-event-limit') ?? '1').trim();
  const activeEventLimit = Number(rawLimit);
  const firestoreEmulator = String(env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  const authEmulator = String(env.FIREBASE_AUTH_EMULATOR_HOST ?? '').trim();

  if (!projectId || !cfpId || !orgId) {
    throw new Error('Project, CFP id, and organization id are required.');
  }
  if (!['prepare', 'finalize'].includes(phase)) {
    throw new Error('Phase must be prepare or finalize.');
  }
  if (orgId.length < 3 || orgId.length > 60 || !ORG_SLUG.test(orgId)) {
    throw new Error('Organization id must be a 3-60 character lowercase slug.');
  }
  if (cfpId.length < 3 || cfpId.length > 60 || !ORG_SLUG.test(cfpId)) {
    throw new Error('CFP id must be a 3-60 character lowercase slug.');
  }
  if (phase === 'prepare' && (!orgName || orgName.length > 120)) {
    throw new Error('Prepare requires an organization name of at most 120 characters.');
  }
  if (!Number.isInteger(activeEventLimit) || activeEventLimit < 0 || activeEventLimit > 100) {
    throw new Error('Active event limit must be an integer from 0 to 100.');
  }
  if (apply && confirmedProject !== projectId) {
    throw new Error('Writes require --confirm-project with the exact target project id.');
  }
  if (Boolean(firestoreEmulator) !== Boolean(authEmulator)) {
    throw new Error('Firestore and Auth emulator hosts must either both be set or both be unset.');
  }

  return {
    projectId,
    cfpId,
    orgId,
    orgName,
    phase,
    activeEventLimit,
    apply,
    emulated: Boolean(firestoreEmulator),
  };
}

export function resolveOwnerUid(cfp, ownerMemberIds) {
  const canonical = typeof cfp.ownerUid === 'string' && cfp.ownerUid ? cfp.ownerUid : undefined;
  const legacy = Array.isArray(cfp.ownerUids) ? cfp.ownerUids : [];
  if (legacy.some((uid) => typeof uid !== 'string' || !uid)) {
    throw new Error('The legacy owner array contains an invalid value.');
  }
  if (!canonical && legacy.length !== 1) {
    throw new Error('The CFP must have exactly one unambiguous legacy owner.');
  }
  const ownerUid = canonical ?? legacy[0];
  if (canonical && legacy.length > 0 && (legacy.length !== 1 || legacy[0] !== canonical)) {
    throw new Error('The scalar and legacy CFP owners disagree.');
  }
  if (ownerMemberIds.length !== 1 || ownerMemberIds[0] !== ownerUid) {
    throw new Error('The CFP owner field and owner membership do not match exactly.');
  }
  return ownerUid;
}

function validatePreparedState(cfp, org, orgMember, ownerUid, orgId) {
  if (cfp.orgId && cfp.orgId !== orgId) {
    throw new Error(`The CFP already belongs to organization ${cfp.orgId}.`);
  }
  if (org.exists && org.ownerUid !== ownerUid) {
    throw new Error('The target organization belongs to a different owner.');
  }
  if (cfp.orgId === orgId && (!org.exists || orgMember?.role !== 'owner')) {
    throw new Error('The prepared organization or its owner membership is incomplete.');
  }
}

async function inspect(db, auth, options) {
  const cfpRef = db.doc(`cfps/${options.cfpId}`);
  const cfpSnapshot = await cfpRef.get();
  if (!cfpSnapshot.exists) throw new Error(`CFP ${options.cfpId} does not exist.`);

  const ownerMembers = await cfpRef.collection('members').where('role', '==', 'owner').get();
  const cfp = cfpSnapshot.data() ?? {};
  const ownerUid = resolveOwnerUid(cfp, ownerMembers.docs.map((doc) => doc.id));
  const ownerAccount = await auth.getUser(ownerUid);
  if (ownerAccount.disabled || !ownerAccount.emailVerified || !ownerAccount.email) {
    throw new Error('The owner must have a verified, enabled Auth account with an email address.');
  }

  const orgRef = db.doc(`orgs/${options.orgId}`);
  const [orgSnapshot, orgMemberSnapshot] = await Promise.all([
    orgRef.get(),
    orgRef.collection('members').doc(ownerUid).get(),
  ]);
  const org = { exists: orgSnapshot.exists, ...(orgSnapshot.data() ?? {}) };
  const orgMember = orgMemberSnapshot.exists ? orgMemberSnapshot.data() : undefined;
  validatePreparedState(cfp, org, orgMember, ownerUid, options.orgId);

  const [creatorMembers, creatorGrants] = await Promise.all([
    db.collection('platformMembers').where('role', '==', 'creator').get(),
    db.collection('platformRoleGrants').where('role', '==', 'creator').get(),
  ]);

  return {
    ownerUid,
    ownerEmail: ownerAccount.email,
    ownerName: ownerAccount.displayName,
    cfp,
    orgExists: orgSnapshot.exists,
    orgMemberExists: orgMemberSnapshot.exists,
    creatorMembers: creatorMembers.docs,
    creatorGrants: creatorGrants.docs,
  };
}

async function prepare(db, auth, options, state) {
  if (!options.apply) return;

  const cfpRef = db.doc(`cfps/${options.cfpId}`);
  const orgRef = db.doc(`orgs/${options.orgId}`);
  const orgMemberRef = orgRef.collection('members').doc(state.ownerUid);
  const ownerMembersQuery = cfpRef.collection('members').where('role', '==', 'owner');

  await db.runTransaction(async (tx) => {
    const [cfpSnapshot, orgSnapshot, orgMemberSnapshot, ownerMembers] = await Promise.all([
      tx.get(cfpRef),
      tx.get(orgRef),
      tx.get(orgMemberRef),
      tx.get(ownerMembersQuery),
    ]);
    if (!cfpSnapshot.exists) throw new Error(`CFP ${options.cfpId} disappeared.`);
    const cfp = cfpSnapshot.data() ?? {};
    const ownerUid = resolveOwnerUid(cfp, ownerMembers.docs.map((doc) => doc.id));
    if (ownerUid !== state.ownerUid) throw new Error('The CFP owner changed after preflight.');
    const org = { exists: orgSnapshot.exists, ...(orgSnapshot.data() ?? {}) };
    const orgMember = orgMemberSnapshot.exists ? orgMemberSnapshot.data() : undefined;
    validatePreparedState(cfp, org, orgMember, ownerUid, options.orgId);

    if (!orgSnapshot.exists) {
      tx.create(orgRef, {
        name: options.orgName,
        slug: options.orgId,
        ownerUid,
        plan: 'community',
        activeEventLimit: options.activeEventLimit,
        createdBy: ownerUid,
        billingEmail: state.ownerEmail,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (!orgMemberSnapshot.exists) {
      tx.create(orgMemberRef, {
        orgId: options.orgId,
        uid: ownerUid,
        role: 'owner',
        email: state.ownerEmail,
        ...(state.ownerName ? { name: state.ownerName } : {}),
        joinedAt: FieldValue.serverTimestamp(),
        grantedBy: 'migration-script',
      });
    }
    tx.update(cfpRef, {
      orgId: options.orgId,
      ownerUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const verified = await inspect(db, auth, options);
  if (
    verified.cfp.orgId !== options.orgId ||
    verified.cfp.ownerUid !== verified.ownerUid ||
    !verified.orgExists ||
    !verified.orgMemberExists
  ) {
    throw new Error('Prepare verification failed.');
  }
}

async function finalize(db, auth, options, state) {
  if (state.cfp.orgId !== options.orgId || state.cfp.ownerUid !== state.ownerUid) {
    throw new Error('Run and verify the prepare phase before finalize.');
  }
  if (!state.orgExists || !state.orgMemberExists) {
    throw new Error('The organization hierarchy is incomplete.');
  }
  if (!options.apply) return;

  const cfpRef = db.doc(`cfps/${options.cfpId}`);
  const orgRef = db.doc(`orgs/${options.orgId}`);
  const orgMemberRef = orgRef.collection('members').doc(state.ownerUid);
  await db.runTransaction(async (tx) => {
    const [cfpSnapshot, orgSnapshot, orgMemberSnapshot, creatorMembers, creatorGrants] =
      await Promise.all([
        tx.get(cfpRef),
        tx.get(orgRef),
        tx.get(orgMemberRef),
        tx.get(db.collection('platformMembers').where('role', '==', 'creator')),
        tx.get(db.collection('platformRoleGrants').where('role', '==', 'creator')),
      ]);
    if (
      !cfpSnapshot.exists ||
      cfpSnapshot.get('orgId') !== options.orgId ||
      cfpSnapshot.get('ownerUid') !== state.ownerUid ||
      !orgSnapshot.exists ||
      orgSnapshot.get('ownerUid') !== state.ownerUid ||
      !orgMemberSnapshot.exists ||
      orgMemberSnapshot.get('role') !== 'owner'
    ) {
      throw new Error('Prepared ownership changed before finalize.');
    }

    tx.update(cfpRef, {
      ownerUids: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const document of [...creatorMembers.docs, ...creatorGrants.docs]) {
      tx.delete(document.ref);
    }
  });

  const verified = await inspect(db, auth, options);
  if (Array.isArray(verified.cfp.ownerUids)) {
    throw new Error('Finalize verification found the legacy owner array.');
  }
  if (verified.creatorMembers.length || verified.creatorGrants.length) {
    throw new Error('Finalize verification found obsolete creator roles.');
  }
}

function printPlan(options, state) {
  const mode = options.apply ? 'APPLY' : 'DRY RUN';
  console.log(`${mode}: ${options.phase} organization migration`);
  console.log(`Project: ${options.projectId}`);
  console.log(`Target: ${options.emulated ? 'local emulators' : 'production services'}`);
  console.log(`CFP: ${options.cfpId}`);
  console.log(`Organization: ${options.orgId}`);
  console.log(`Organization exists: ${state.orgExists ? 'yes' : 'no'}`);
  console.log(`Canonical owner present: ${state.cfp.ownerUid ? 'yes' : 'no'}`);
  console.log(`Legacy owner array present: ${Array.isArray(state.cfp.ownerUids) ? 'yes' : 'no'}`);
  console.log(`Obsolete creator records: ${state.creatorMembers.length + state.creatorGrants.length}`);
  if (!options.apply) {
    console.log('No writes performed. Add --apply and --confirm-project to execute this phase.');
  }
}

export async function runMigration(argv = process.argv.slice(2), env = process.env) {
  const options = parseMigrationArgs(argv, env);
  const app = initializeApp({ projectId: options.projectId });
  const db = getFirestore(app);
  const auth = getAuth(app);
  try {
    const state = await inspect(db, auth, options);
    printPlan(options, state);
    if (options.phase === 'prepare') {
      await prepare(db, auth, options, state);
    } else {
      await finalize(db, auth, options, state);
    }
    if (options.apply) console.log(`${options.phase} completed and verified.`);
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runMigration().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
