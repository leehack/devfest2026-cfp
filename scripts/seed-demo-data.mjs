/**
 * Seeds rich demo data across all roles, organizations, events, proposals, and reviews.
 *
 * Usage against emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-devfest-cfp node scripts/seed-demo-data.mjs
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-devfest-cfp';

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

console.log('🚀 Seeding comprehensive multi-org demo data...');

// ------------------------------------------------------------------ 1. Accounts
const ACCOUNTS = [
  { uid: 'usr-owner', email: 'owner@example.org', displayName: 'Olivia Owner' },
  { uid: 'usr-admin', email: 'admin@example.org', displayName: 'Alice Admin' },
  { uid: 'usr-reviewer', email: 'reviewer@example.org', displayName: 'Bob Reviewer' },
  { uid: 'usr-speaker', email: 'speaker@example.org', displayName: 'Charlie Speaker' },
  { uid: 'usr-cospeaker', email: 'cospeaker@example.org', displayName: 'Diana Co-Speaker' },
  { uid: 'usr-manager', email: 'manager@example.org', displayName: 'Morgan Manager' },
  { uid: 'usr-alex', email: 'alex.chen@example.org', displayName: 'Alex Chen' },
  { uid: 'usr-sam', email: 'sam.taylor@example.org', displayName: 'Sam Taylor' },
  { uid: 'usr-elena', email: 'elena.rostova@example.org', displayName: 'Dr. Elena Rostova' },
];

const resolvedUids = new Map();

for (const acc of ACCOUNTS) {
  try {
    const existing = await auth.getUserByEmail(acc.email);
    await auth.updateUser(existing.uid, {
      displayName: acc.displayName,
      emailVerified: true,
    });
    resolvedUids.set(acc.uid, existing.uid);
    console.log(`  ✓ Updated user: ${acc.displayName} (${acc.email})`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    try {
      const existing = await auth.getUser(acc.uid);
      await auth.updateUser(existing.uid, {
        email: acc.email,
        displayName: acc.displayName,
        emailVerified: true,
      });
      resolvedUids.set(acc.uid, existing.uid);
      console.log(`  ✓ Updated user: ${acc.displayName} (${acc.email})`);
    } catch (uidError) {
      if (uidError.code !== 'auth/user-not-found') throw uidError;
      const created = await auth.createUser({
        uid: acc.uid,
        email: acc.email,
        displayName: acc.displayName,
        emailVerified: true,
      });
      resolvedUids.set(acc.uid, created.uid);
      console.log(`  ✓ Created user: ${acc.displayName} (${acc.email})`);
    }
  }
}

const uid = (seedUid) => resolvedUids.get(seedUid) ?? seedUid;
const SEEDED_ORG_IDS = ['global-tech', 'ai-society'];
const SEEDED_CFP_IDS = [
  'devfest-mtl-2026',
  'ai-world-summit-2026',
  'cloud-native-days',
];

for (const acc of ACCOUNTS) {
  const resolvedUid = uid(acc.uid);
  if (resolvedUid === acc.uid) continue;

  await Promise.all([
    db.doc(`platformMembers/${acc.uid}`).delete(),
    db.doc(`speakers/${acc.uid}`).delete(),
    ...SEEDED_ORG_IDS.map((orgId) =>
      db.doc(`orgs/${orgId}/members/${acc.uid}`).delete(),
    ),
    ...SEEDED_CFP_IDS.map((cfpId) =>
      db.doc(`cfps/${cfpId}/members/${acc.uid}`).delete(),
    ),
  ]);

  const staleReviews = await Promise.all(
    SEEDED_CFP_IDS.map((cfpId) =>
      db.collection(`cfps/${cfpId}/reviews`).where('reviewerUid', '==', acc.uid).get(),
    ),
  );
  await Promise.all(staleReviews.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref.delete())));
}

for (const collectionName of ['orgs', 'cfps']) {
  const snapshot = await db.collection(collectionName).get();
  for (const document of snapshot.docs) {
    const legacyOwnerUids = document.get('ownerUids');
    if (!Array.isArray(legacyOwnerUids)) continue;

    const existingOwnerUid = document.get('ownerUid');
    const ownerUid =
      typeof existingOwnerUid === 'string' && existingOwnerUid
        ? existingOwnerUid
        : legacyOwnerUids.length === 1 && typeof legacyOwnerUids[0] === 'string'
          ? legacyOwnerUids[0]
          : undefined;
    if (!ownerUid) {
      console.warn(`  ! Skipped ambiguous legacy ownership on ${document.ref.path}`);
      continue;
    }
    await document.ref.update({ ownerUid, ownerUids: FieldValue.delete() });
  }
}

// ------------------------------------------------------------------ 2. Platform Roles
for (const collectionName of ['platformMembers', 'platformRoleGrants']) {
  const obsoleteCreators = await db.collection(collectionName).where('role', '==', 'creator').get();
  await Promise.all(obsoleteCreators.docs.map((doc) => doc.ref.delete()));
}

await db.doc(`platformMembers/${uid('usr-owner')}`).set({
  role: 'owner',
  email: 'owner@example.org',
  grantedBy: 'bootstrap',
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

await db.doc(`platformMembers/${uid('usr-admin')}`).set({
  role: 'admin',
  email: 'admin@example.org',
  grantedBy: uid('usr-owner'),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
console.log('  ✓ Configured Platform roles (Olivia: Owner, Alice: Admin)');

// ------------------------------------------------------------------ 3. Organizations
const ORGS = [
  {
    id: 'global-tech',
    data: {
      name: 'Global Tech Summit',
      slug: 'global-tech',
      description: 'International developer conferences focusing on Cloud, Modern Web, and Distributed Systems.',
      websiteUrl: 'https://globaltechsummit.org',
      logoUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=128&h=128&fit=crop',
      ownerUid: uid('usr-owner'),
      activeEventLimit: 2,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    members: [
      { uid: uid('usr-owner'), role: 'owner', email: 'owner@example.org', name: 'Olivia Owner' },
      { uid: uid('usr-admin'), role: 'admin', email: 'admin@example.org', name: 'Alice Admin' },
      { uid: uid('usr-manager'), role: 'member', email: 'manager@example.org', name: 'Morgan Manager' },
    ],
  },
  {
    id: 'ai-society',
    data: {
      name: 'AI & Data Society',
      slug: 'ai-society',
      description: 'Frontier machine learning research, agentic AI systems, and multimodal intelligence.',
      websiteUrl: 'https://aisociety.example.org',
      logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&h=128&fit=crop',
      ownerUid: uid('usr-owner'),
      activeEventLimit: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    members: [
      { uid: uid('usr-owner'), role: 'owner', email: 'owner@example.org', name: 'Olivia Owner' },
      { uid: uid('usr-admin'), role: 'admin', email: 'admin@example.org', name: 'Alice Admin' },
    ],
  },
];

for (const org of ORGS) {
  await db.doc(`orgs/${org.id}`).set(org.data, { merge: true });
  for (const m of org.members) {
    await db.doc(`orgs/${org.id}/members/${m.uid}`).set({
      uid: m.uid,
      orgId: org.id,
      role: m.role,
      email: m.email,
      name: m.name,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  console.log(`  ✓ Seeded organization: ${org.data.name} (/orgs/${org.id})`);
}

// ------------------------------------------------------------------ 4. Speaker Profiles
const SPEAKERS = [
  {
    uid: uid('usr-speaker'),
    name: 'Charlie Speaker',
    email: 'speaker@example.org',
    bio: 'Staff Cloud Engineer & AI Researcher. Keynote speaker, open-source maintainer, and distributed systems architect.',
    company: 'Antigravity Labs',
    basedIn: 'Montréal, QC, Canada',
    socials: [
      { platform: 'github', handle: 'https://github.com/charliespeaker' },
      { platform: 'linkedin', handle: 'https://linkedin.com/in/charliespeaker' },
      { platform: 'website', handle: 'https://charliespeaker.dev' },
    ],
  },
  {
    uid: uid('usr-cospeaker'),
    name: 'Diana Co-Speaker',
    email: 'cospeaker@example.org',
    bio: 'Principal Distributed Systems Architect. Author of Modern Microservices in Rust.',
    company: 'Quantum Distributed',
    basedIn: 'Toronto, ON, Canada',
    socials: [
      { platform: 'github', handle: 'https://github.com/dianacospeaker' },
    ],
  },
  {
    uid: uid('usr-alex'),
    name: 'Alex Chen',
    email: 'alex.chen@example.org',
    bio: 'Senior Web Performance Engineer at EdgeScale. Chrome Performance contributor.',
    company: 'EdgeScale',
    basedIn: 'San Francisco, CA, USA',
    socials: [],
  },
  {
    uid: uid('usr-elena'),
    name: 'Dr. Elena Rostova',
    email: 'elena.rostova@example.org',
    bio: 'Lead AI Research Scientist at NeuralWorks. PhD in Multimodal Reasoning from Mila.',
    company: 'NeuralWorks',
    basedIn: 'Montréal, QC, Canada',
    socials: [],
  },
];

for (const spk of SPEAKERS) {
  await db.doc(`speakers/${spk.uid}`).set({
    ...spk,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
console.log('  ✓ Seeded speaker profiles');

// ------------------------------------------------------------------ 5. CFPs / Events
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const CFPS = [
  {
    id: 'devfest-mtl-2026',
    data: {
      id: 'devfest-mtl-2026',
      name: 'DevFest Montréal 2026',
      tagline: 'The premier community-driven tech conference in Eastern Canada',
      orgId: 'global-tech',
      visibility: 'public',
      archived: false,
      paused: false,
      ownerUid: uid('usr-owner'),
      opensAt: Timestamp.fromMillis(now - 30 * day),
      closesAt: Timestamp.fromMillis(now + 60 * day),
      reviewsVisible: true,
      description: {
        en: 'DevFest Montréal brings together 1,000+ developers, architects, and designers for two days of deep dives into Cloud, AI/ML, Modern Web, Security, and Mobile architecture.',
        fr: 'Le DevFest Montréal réunit plus de 1 000 développeurs, architectes et concepteurs pour deux jours de conférences approfondies sur le Cloud, l’IA, le Web moderne et la sécurité.',
      },
      eventDate: '2026-11-20',
      eventStartDate: '2026-11-20',
      eventEndDate: '2026-11-21',
      venue: 'Palais des Congrès de Montréal',
      location: 'Montréal, QC, Canada',
      website: 'https://devfest.gdgmontreal.com',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    members: [
      { uid: uid('usr-owner'), role: 'owner', email: 'owner@example.org' },
      { uid: uid('usr-admin'), role: 'admin', email: 'admin@example.org' },
      { uid: uid('usr-reviewer'), role: 'reviewer', email: 'reviewer@example.org' },
    ],
  },
  {
    id: 'ai-world-summit-2026',
    data: {
      id: 'ai-world-summit-2026',
      name: 'AI World Summit 2026',
      tagline: 'Frontier AI, Large Language Models, and Autonomous Agentic Architectures',
      orgId: 'ai-society',
      visibility: 'public',
      archived: false,
      paused: false,
      ownerUid: uid('usr-owner'),
      opensAt: Timestamp.fromMillis(now - 15 * day),
      closesAt: Timestamp.fromMillis(now + 45 * day),
      reviewsVisible: false,
      theme: {
        primaryColor: '#0f766e',
        accentColor: '#0d9488',
        mastheadBg: '#115e59',
      },
      features: {
        blindReview: true,
      },
      description: {
        en: 'Global research gathering on foundational models, reasoning benchmarks, agentic tool-use, and neural efficiency.',
        fr: 'Rassemblement mondial de recherche sur les modèles fondamentaux, les repères de raisonnement et l’efficacité neuronale.',
      },
      eventDate: '2026-12-05',
      eventStartDate: '2026-12-05',
      eventEndDate: '2026-12-06',
      venue: 'Grand Palais Étoile',
      location: 'Paris, France',
      website: 'https://aiworldsummit.example.org',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    members: [
      { uid: uid('usr-owner'), role: 'owner', email: 'owner@example.org' },
      { uid: uid('usr-admin'), role: 'admin', email: 'admin@example.org' },
      { uid: uid('usr-reviewer'), role: 'reviewer', email: 'reviewer@example.org' },
    ],
  },
  {
    id: 'cloud-native-days',
    data: {
      id: 'cloud-native-days',
      name: 'Cloud Native Days 2026',
      tagline: 'Kubernetes, Serverless, Observability, and Platform Engineering',
      orgId: 'global-tech',
      visibility: 'public',
      archived: false,
      paused: false,
      ownerUid: uid('usr-owner'),
      opensAt: Timestamp.fromMillis(now - 10 * day),
      closesAt: Timestamp.fromMillis(now + 80 * day),
      theme: {
        primaryColor: '#4f46e5',
        accentColor: '#6366f1',
        mastheadBg: '#3730a3',
      },
      description: {
        en: 'Hands-on platform engineering conference with live demos on Kubernetes clusters, service meshes, and reactive telemetry.',
        fr: 'Conférence pratique d’ingénierie de plateforme avec démonstrations en direct sur clusters Kubernetes et maillages de services.',
      },
      eventDate: '2026-10-15',
      eventStartDate: '2026-10-15',
      eventEndDate: '2026-10-16',
      venue: 'Metro Toronto Convention Centre',
      location: 'Toronto, ON, Canada',
      website: 'https://cloudnativedays.example.org',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    members: [
      { uid: uid('usr-owner'), role: 'owner', email: 'owner@example.org' },
      { uid: uid('usr-admin'), role: 'admin', email: 'admin@example.org' },
      { uid: uid('usr-reviewer'), role: 'reviewer', email: 'reviewer@example.org' },
    ],
  },
];

for (const cfp of CFPS) {
  await db.doc(`cfps/${cfp.id}`).set(cfp.data, { merge: true });
  for (const m of cfp.members) {
    await db.doc(`cfps/${cfp.id}/members/${m.uid}`).set({
      uid: m.uid,
      cfpId: cfp.id,
      role: m.role,
      email: m.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  console.log(`  ✓ Seeded CFP: ${cfp.data.name} (/c/${cfp.id})`);
}

// ------------------------------------------------------------------ 6. Comprehensive Proposals & Reviews
const PROPOSALS = [
  // --- DevFest Montréal 2026 proposals ---
  {
    cfpId: 'devfest-mtl-2026',
    id: 'prop-agentic-coding',
    speakerIds: [uid('usr-speaker')],
    primarySpeakerId: uid('usr-speaker'),
    title: 'Building Autonomous Agentic Coding Systems: Patterns & Pitfalls',
    abstract: 'Autonomous agentic coding tools represent a massive paradigm shift in software engineering. In this session, we examine production-tested architectures for multi-agent coordination, deterministic tooling loops, subagent delegation, and reactive context management. Attendees will see live code demonstrations and leave with practical architectural patterns.',
    pitch: 'Based on real-world implementations of agentic coding assistants. Highly requested topic by senior developers and architects.',
    category: 'ai_ml',
    format: 'session_40',
    level: 'intermediate',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'local', fundingSource: 'company', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-speaker'),
        name: 'Charlie Speaker',
        bio: 'Staff Cloud Engineer & AI Researcher at Antigravity Labs.',
        company: 'Antigravity Labs',
        location: 'Montréal, QC, Canada',
      },
    ],
    review: { score: 4, comment: 'Exceptional topic with strong practical relevance. Very timely and credible speaker.' },
  },
  {
    cfpId: 'devfest-mtl-2026',
    id: 'prop-zero-trust-cloud',
    speakerIds: [uid('usr-speaker'), uid('usr-cospeaker')],
    primarySpeakerId: uid('usr-speaker'),
    title: 'Zero-Trust Reactive Cloud Architectures at Scale',
    abstract: 'How do you design high-throughput cloud architectures where every service boundary is strictly authenticated, immutable, and event-driven? We dissect real failure modes, zero-trust token flows, and asynchronous messaging pipelines across distributed regions.',
    pitch: 'Co-presented with Diana, author of Modern Microservices in Rust. Packed with concrete benchmarks.',
    category: 'cloud',
    format: 'session_40',
    level: 'advanced',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'secured', fundingSource: 'grant', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-speaker'),
        name: 'Charlie Speaker',
        bio: 'Staff Cloud Engineer & AI Researcher at Antigravity Labs.',
        company: 'Antigravity Labs',
        location: 'Montréal, QC, Canada',
      },
      {
        uid: uid('usr-cospeaker'),
        name: 'Diana Co-Speaker',
        bio: 'Principal Distributed Systems Architect at Quantum Distributed.',
        company: 'Quantum Distributed',
        location: 'Toronto, ON, Canada',
      },
    ],
    review: { score: 4, comment: 'Clear expertise in distributed systems. High audience demand.' },
  },
  {
    cfpId: 'devfest-mtl-2026',
    id: 'prop-modern-css-subgrid',
    speakerIds: [uid('usr-speaker')],
    primarySpeakerId: uid('usr-speaker'),
    title: 'Modern CSS in 2026: Subgrid, Anchor Positioning & View Transitions',
    abstract: 'CSS has evolved faster in the last two years than in the previous decade. Learn how CSS Anchor Positioning replaces complex JavaScript popover positioning libraries, how Subgrid solves alignment across cards, and how native View Transitions deliver native-app smoothness.',
    pitch: 'Visually rich presentation with interactive CodePen demonstrations.',
    category: 'web',
    format: 'lightning_15',
    level: 'all',
    deliveryLanguage: 'fr',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'local', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-speaker'),
        name: 'Charlie Speaker',
        bio: 'Staff Cloud Engineer & AI Researcher at Antigravity Labs.',
        company: 'Antigravity Labs',
        location: 'Montréal, QC, Canada',
      },
    ],
    review: { score: 3, comment: 'Great lightning talk concept. Solid demos and clear takeaways.' },
  },
  {
    cfpId: 'devfest-mtl-2026',
    id: 'prop-web-perf-edge',
    speakerIds: [uid('usr-alex')],
    primarySpeakerId: uid('usr-alex'),
    title: 'Sub-Millisecond Edge Rendering with WASM & Streaming SSR',
    abstract: 'How we reduced global P99 time to interactive to under 80ms by compiling framework runtime kernels to WebAssembly deployed across 300+ edge points of presence.',
    pitch: 'Deep performance metrics and benchmark breakdowns from high-traffic production workloads.',
    category: 'web',
    format: 'session_40',
    level: 'advanced',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'secured', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-alex'),
        name: 'Alex Chen',
        bio: 'Senior Web Performance Engineer at EdgeScale.',
        company: 'EdgeScale',
        location: 'San Francisco, CA, USA',
      },
    ],
    review: { score: 3, comment: 'Very interesting WASM edge benchmarks. Relevant for senior frontend architects.' },
  },

  // --- AI World Summit 2026 proposals (Blind Review) ---
  {
    cfpId: 'ai-world-summit-2026',
    id: 'prop-multimodal-reasoning',
    speakerIds: [uid('usr-speaker')],
    primarySpeakerId: uid('usr-speaker'),
    title: 'Evaluating Reasoning & Plan Verification in Multimodal Foundation Models',
    abstract: 'Foundation models are increasingly tasked with complex visual reasoning and multi-step plan generation. In this talk, we present rigorous benchmark methodologies for detecting reasoning hallucination, measuring chain-of-thought faithfulness, and enforcing invariant safety constraints.',
    pitch: 'Original research paper summary presented at top ML venues.',
    category: 'ai_ml',
    format: 'session_40',
    level: 'advanced',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'secured', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-speaker'),
        name: 'Charlie Speaker',
        bio: 'Staff Cloud Engineer & AI Researcher at Antigravity Labs.',
        company: 'Antigravity Labs',
        location: 'Montréal, QC, Canada',
      },
    ],
    review: { score: 4, comment: 'Top-tier research presentation. Perfect fit for the AI World Summit main stage.' },
  },
  {
    cfpId: 'ai-world-summit-2026',
    id: 'prop-video-diffusion',
    speakerIds: [uid('usr-elena')],
    primarySpeakerId: uid('usr-elena'),
    title: 'Diffusion-Based High-Fidelity Video Synthesis: Real-Time Latent Architectures',
    abstract: 'Exploring temporal attention blocks, 3D causal VAEs, and quantization strategies that enable real-time 60fps video generation on consumer hardware.',
    pitch: 'Presents state-of-the-art architectures in generative video modeling.',
    category: 'ai_ml',
    format: 'session_40',
    level: 'advanced',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'local', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-elena'),
        name: 'Dr. Elena Rostova',
        bio: 'Lead AI Research Scientist at NeuralWorks.',
        company: 'NeuralWorks',
        location: 'Montréal, QC, Canada',
      },
    ],
    review: { score: 4, comment: 'Brilliant technical breakdown of 3D latent video diffusion models.' },
  },

  // --- Cloud Native Days 2026 proposals ---
  {
    cfpId: 'cloud-native-days',
    id: 'prop-k8s-platform-eng',
    speakerIds: [uid('usr-speaker')],
    primarySpeakerId: uid('usr-speaker'),
    title: 'Building Internal Developer Platforms with Kubernetes CRDs & Crossplane',
    abstract: 'How to transition from ticket-ops to self-service cloud infrastructure by defining composite custom resources, GitOps reconciliation loops, and automated compliance policies.',
    pitch: 'Step-by-step architectural blueprint for enterprise platform teams.',
    category: 'cloud',
    format: 'session_40',
    level: 'intermediate',
    deliveryLanguage: 'en',
    status: 'under_review',
    acks: { noTravelSupport: true, coc: true, recording: true },
    attendance: { status: 'secured', needsVisa: false },
    speakerSnapshot: [
      {
        uid: uid('usr-speaker'),
        name: 'Charlie Speaker',
        bio: 'Staff Cloud Engineer & AI Researcher at Antigravity Labs.',
        company: 'Antigravity Labs',
        location: 'Montréal, QC, Canada',
      },
    ],
    review: { score: 3, comment: 'Solid hands-on guide for Kubernetes platform engineering.' },
  },
];

for (const prop of PROPOSALS) {
  const { review, ...propData } = prop;
  await db.doc(`cfps/${prop.cfpId}/proposals/${prop.id}`).set({
    ...propData,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (review) {
    await db.doc(`cfps/${prop.cfpId}/reviews/${uid('usr-reviewer')}_${prop.id}`).set({
      cfpId: prop.cfpId,
      proposalId: prop.id,
      reviewerUid: uid('usr-reviewer'),
      score: review.score,
      comment: review.comment,
      conflictOfInterest: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  console.log(`  ✓ Seeded proposal: "${prop.title}" (${prop.cfpId})`);
}

console.log('\n🎉 Comprehensive Multi-Org Demo Data Seeding Complete!\n');
