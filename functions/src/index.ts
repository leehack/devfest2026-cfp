/**
 * §6 makes `status` and `aggregate` function-writable only, so the
 * draft → submitted transition cannot happen in the browser. That gives one
 * server-side chokepoint which re-runs validation and re-checks the deadline
 * against the server clock — neither can be bypassed by posting to Firestore.
 */

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { submissionSchema } from '../../shared/schema';
import { aggregateReviews, type ReviewRecord } from '../../shared/aggregate';
import { parseSessionizeProfile, parseSessionizeUrl } from '../../shared/sessionize';

initializeApp();
const db = getFirestore();

const REGION = 'northamerica-northeast1'; // Montréal

interface CfpWindow {
  paused: boolean;
  opensAt: Timestamp;
  closesAt: Timestamp;
}

/** Fails closed: a missing config document must not read as "wide open". */
async function assertCfpOpen(): Promise<void> {
  const snap = await db.doc('config/cfp').get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'CFP is not configured.');
  }
  const cfp = snap.data() as CfpWindow;
  const now = Date.now();
  if (cfp.paused) {
    throw new HttpsError('failed-precondition', 'The CFP is currently paused.');
  }
  if (now < cfp.opensAt.toMillis()) {
    throw new HttpsError('failed-precondition', 'The CFP has not opened yet.');
  }
  if (now >= cfp.closesAt.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'The CFP has closed.');
  }
}

function requireUid(request: { auth?: { uid: string } }, action: string): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', `Sign in to ${action}.`);
  return uid;
}

function requireProposalId(data: unknown): string {
  const id = (data as { proposalId?: unknown } | undefined)?.proposalId;
  if (typeof id !== 'string' || !id) {
    throw new HttpsError('invalid-argument', 'proposalId is required.');
  }
  return id;
}

/**
 * Loads a proposal the caller owns. Non-ownership reports `not-found`, the same
 * as a missing document — an authenticated prober learns nothing about other
 * people's proposals either way.
 */
async function readOwnProposal(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  uid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError('not-found', 'Proposal not found.');
  const proposal = snap.data()!;
  if (!(proposal.speakerIds ?? []).includes(uid)) {
    throw new HttpsError('not-found', 'Proposal not found.');
  }
  return proposal;
}

/**
 * Reassembles the stored draft into the shape `submissionSchema` expects.
 * The proposal document holds the talk; the speaker document holds the person.
 */
function assemble(proposal: FirebaseFirestore.DocumentData, speaker: FirebaseFirestore.DocumentData) {
  return {
    proposal: {
      title: proposal.title,
      abstract: proposal.abstract,
      pitch: proposal.pitch,
      category: proposal.category,
      format: proposal.format,
      level: proposal.level,
      deliveryLanguage: proposal.deliveryLanguage,
      languagePreference: proposal.languagePreference,
    },
    speaker: {
      name: speaker.name,
      bio: speaker.bio,
      company: speaker.company,
      jobTitle: speaker.jobTitle,
      basedIn: speaker.basedIn,
      socials: speaker.socials ?? [],
      isGde: speaker.isGde ?? false,
      pastTalks: speaker.pastTalks,
      email: speaker.email,
    },
    acks: proposal.acks ?? {},
    attendance: proposal.attendance ?? {},
  };
}

export const submitProposal = onCall({ region: REGION }, async (request) => {
  const uid = requireUid(request, 'submit a proposal');
  const proposalId = requireProposalId(request.data);

  await assertCfpOpen();

  const proposalRef = db.doc(`proposals/${proposalId}`);

  const result = await db.runTransaction(async (tx) => {
    const proposal = await readOwnProposal(tx, proposalRef, uid);

    if (proposal.status === 'submitted') {
      return { alreadySubmitted: true };
    }
    if (proposal.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" can no longer be submitted.`,
      );
    }

    const speakerSnap = await tx.get(db.doc(`speakers/${uid}`));
    if (!speakerSnap.exists) {
      throw new HttpsError('failed-precondition', 'Complete your speaker profile first.');
    }

    // The authoritative pass; the browser's copy only renders inline errors.
    const parsed = submissionSchema.safeParse(assemble(proposal, speakerSnap.data()!));
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'The proposal is incomplete.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    tx.update(proposalRef, {
      status: 'submitted',
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { alreadySubmitted: false };
  });

  logger.info('proposal submitted', { proposalId, uid, ...result });

  // The "Submission received" email (build order item 5) hangs off this point,
  // via emailLog so a retry cannot double-send.
  return { ok: true, proposalId, ...result };
});

/**
 * Withdrawal is a status change rather than a delete: the rules block deletes
 * outright so the emailLog audit trail cannot be orphaned.
 */
export const withdrawProposal = onCall({ region: REGION }, async (request) => {
  const uid = requireUid(request, 'withdraw a proposal');
  const proposalId = requireProposalId(request.data);

  const proposalRef = db.doc(`proposals/${proposalId}`);

  await db.runTransaction(async (tx) => {
    const proposal = await readOwnProposal(tx, proposalRef, uid);
    const withdrawable = ['draft', 'submitted', 'under_review', 'accepted', 'waitlisted'];
    if (!withdrawable.includes(proposal.status)) {
      throw new HttpsError(
        'failed-precondition',
        `A proposal with status "${proposal.status}" cannot be withdrawn.`,
      );
    }
    tx.update(proposalRef, {
      status: 'withdrawn',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('proposal withdrawn', { proposalId, uid });
  return { ok: true };
});

/**
 * Recomputes `aggregate` on every reviewed proposal. Run once when the round
 * closes (§8) — a batch job, not a trigger: a z-score is relative to everything
 * that reviewer scored, so one new review moves the normalised score of every
 * proposal they touched. Per-review triggers would fan out across the whole
 * collection and race each other.
 */
export const recomputeAggregates = onCall({ region: REGION }, async (request) => {
  const uid = requireUid(request, 'close the review round');

  const reviewer = await db.doc(`reviewers/${uid}`).get();
  if (!reviewer.exists || reviewer.data()?.role !== 'lead') {
    throw new HttpsError('permission-denied', 'Only a lead organiser can close the round.');
  }

  // Collection group: every review on every proposal, in one read pass.
  const reviewSnaps = await db.collectionGroup('reviews').get();

  const reviews: ReviewRecord[] = reviewSnaps.docs.map((d) => ({
    // reviews live at proposals/{proposalId}/reviews/{reviewerUid}
    proposalId: d.ref.parent.parent!.id,
    reviewerUid: d.id,
    score: d.data().score,
    conflictOfInterest: d.data().conflictOfInterest === true,
  }));

  const aggregates = aggregateReviews(reviews);

  // Firestore caps a batch at 500 writes.
  const entries = [...aggregates.entries()];
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    for (const [proposalId, aggregate] of entries.slice(i, i + CHUNK)) {
      batch.update(db.doc(`proposals/${proposalId}`), {
        aggregate,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  logger.info('aggregates recomputed', {
    uid,
    reviews: reviews.length,
    proposals: aggregates.size,
  });

  return { ok: true, reviewCount: reviews.length, proposalCount: aggregates.size };
});

/**
 * Fetches and parses a public Sessionize profile. Writes nothing.
 *
 * Server-side because sessionize.com sends no CORS headers — which makes it an
 * SSRF surface, so the URL is rebuilt from a validated handle rather than taken
 * from the caller. `parseSessionizeUrl` is unit-tested against host-suffix
 * tricks and link-local addresses.
 */
export const importSessionizeProfile = onCall(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    const uid = requireUid(request, 'import a profile');

    const parsed = parseSessionizeUrl((request.data as { url?: string } | undefined)?.url ?? '');
    if (!parsed) {
      throw new HttpsError(
        'invalid-argument',
        'That does not look like a Sessionize link. Paste your profile (sessionize.com/your-name) or a talk (sessionize.com/s/your-name/…).',
      );
    }

    const { handle, sessionId } = parsed;

    // The profile page even for a talk link: it carries the bio *and* every
    // talk with its full abstract, so it is one request that returns more.
    const target = `https://sessionize.com/${handle}/`;

    let response: Response;
    try {
      response = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          // Identify ourselves rather than pretending to be a browser.
          'user-agent': 'DevFestMTL-CFP/1.0 (+https://sessionize.com/ profile import)',
          accept: 'text/html',
        },
      });
    } catch (error) {
      logger.warn('sessionize fetch failed', { handle, error: String(error) });
      throw new HttpsError('unavailable', 'Could not reach Sessionize. Please try again.');
    }

    // A redirect could still land somewhere else; re-check the final host.
    const finalHost = new URL(response.url || target).hostname.toLowerCase();
    if (finalHost !== 'sessionize.com' && finalHost !== 'www.sessionize.com') {
      throw new HttpsError('permission-denied', 'That link redirected off Sessionize.');
    }

    if (response.status === 404) {
      throw new HttpsError('not-found', `No Sessionize profile found at sessionize.com/${handle}`);
    }
    if (!response.ok) {
      throw new HttpsError('unavailable', `Sessionize returned ${response.status}.`);
    }

    const html = await response.text();
    const profile = parseSessionizeProfile(html, handle);

    // Nothing usable almost always means the markup moved, not an empty
    // profile. Say so, rather than returning a blank the form would ignore.
    if (!profile.bio && !profile.name) {
      logger.error('sessionize parse produced nothing', { handle, warnings: profile.warnings });
      throw new HttpsError(
        'internal',
        'That page loaded but nothing could be read from it. Sessionize may have changed their layout — please fill the form in manually and let the organisers know.',
      );
    }

    // A pasted talk that is no longer listed: say so rather than silently
    // importing a different one.
    const preselect =
      sessionId && profile.sessions.some((s) => s.id === sessionId) ? sessionId : undefined;

    logger.info('sessionize profile imported', {
      handle,
      uid,
      sessions: profile.sessions.length,
      requestedSession: sessionId ?? null,
      matchedSession: preselect ?? null,
      warnings: profile.warnings,
    });

    return {
      ok: true,
      profile,
      preselectSessionId: preselect,
      requestedSessionMissing: Boolean(sessionId && !preselect),
    };
  },
);
