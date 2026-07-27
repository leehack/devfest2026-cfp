/**
 * Cloud Functions for the DevFest Montréal 2026 CFP.
 *
 * Build order item 1 needs exactly one function. §6 makes `status` and
 * `aggregate` function-writable only, which means the draft -> submitted
 * transition cannot happen in the browser. That constraint is a feature: it
 * gives us one server-side chokepoint that re-runs validation and re-checks the
 * deadline against the server clock, so neither can be bypassed by posting
 * directly to Firestore.
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

async function loadCfpWindow(): Promise<CfpWindow> {
  const snap = await db.doc('config/cfp').get();
  if (!snap.exists) {
    // Fail closed. A missing config document must not read as "wide open".
    throw new HttpsError('failed-precondition', 'CFP is not configured.');
  }
  return snap.data() as CfpWindow;
}

function assertWindowOpen(cfp: CfpWindow): void {
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to submit a proposal.');
  }

  const proposalId = (request.data ?? {}).proposalId;
  if (typeof proposalId !== 'string' || !proposalId) {
    throw new HttpsError('invalid-argument', 'proposalId is required.');
  }

  const cfp = await loadCfpWindow();
  assertWindowOpen(cfp);

  const proposalRef = db.doc(`proposals/${proposalId}`);

  const result = await db.runTransaction(async (tx) => {
    const proposalSnap = await tx.get(proposalRef);
    if (!proposalSnap.exists) {
      throw new HttpsError('not-found', 'Proposal not found.');
    }
    const proposal = proposalSnap.data()!;

    const speakerIds: string[] = proposal.speakerIds ?? [];
    if (!speakerIds.includes(uid)) {
      // Same message as not-found on purpose — do not confirm the existence of
      // other people's proposals to an authenticated prober.
      throw new HttpsError('not-found', 'Proposal not found.');
    }

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

    // The authoritative validation pass. The browser ran the same schema, but
    // that copy is only there to render inline errors.
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to withdraw a proposal.');
  }

  const proposalId = (request.data ?? {}).proposalId;
  if (typeof proposalId !== 'string' || !proposalId) {
    throw new HttpsError('invalid-argument', 'proposalId is required.');
  }

  const proposalRef = db.doc(`proposals/${proposalId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(proposalRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Proposal not found.');
    }
    const proposal = snap.data()!;
    if (!(proposal.speakerIds ?? []).includes(uid)) {
      throw new HttpsError('not-found', 'Proposal not found.');
    }
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
 * Recomputes `aggregate` on every reviewed proposal.
 *
 * Deliberately a batch job rather than a Firestore trigger on review writes. A
 * z-score is relative to everything that reviewer scored, so a single new
 * review changes that reviewer's mean and therefore the normalised score of
 * every other proposal they touched. Per-review triggers would fan out across
 * the whole collection on each keystroke and race each other doing it.
 *
 * §8 runs this once when the review round closes.
 */
export const recomputeAggregates = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

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

  // Firestore caps a batch at 500 writes; ~200 proposals fits, but chunking
  // keeps this correct if the CFP grows.
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
 * Fetches a speaker's public Sessionize profile and returns it parsed.
 *
 * Writes nothing. The result goes back to the browser, which prefills only the
 * fields the speaker has left blank and tells them what it filled — importing
 * must never silently overwrite something they already typed.
 *
 * Why a function rather than a browser fetch: sessionize.com sends no CORS
 * headers, so the request has to be server-side. That makes it an SSRF surface,
 * which is why the URL is rebuilt from a validated handle rather than taken
 * from the caller — `normalizeSessionizeHandle` accepts a single path segment
 * on sessionize.com and nothing else, and is unit-tested against host-suffix
 * tricks and link-local addresses.
 */
export const importSessionizeProfile = onCall(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }

    const parsed = parseSessionizeUrl((request.data ?? {}).url ?? '');
    if (!parsed) {
      throw new HttpsError(
        'invalid-argument',
        'That does not look like a Sessionize link. Paste your profile (sessionize.com/your-name) or a talk (sessionize.com/s/your-name/…).',
      );
    }

    const { handle, sessionId } = parsed;

    // Always fetch the profile page, even for a pasted talk link. A profile
    // carries the bio *and* every talk with its full abstract, whereas a
    // session page has the talk but no bio — so this is one request instead of
    // two, and returns strictly more.
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

    // A profile with nothing usable almost always means the markup moved, not
    // that the speaker has an empty profile. Say so plainly rather than
    // returning a blank object the form would silently ignore.
    if (!profile.bio && !profile.name) {
      logger.error('sessionize parse produced nothing', { handle, warnings: profile.warnings });
      throw new HttpsError(
        'internal',
        'That page loaded but nothing could be read from it. Sessionize may have changed their layout — please fill the form in manually and let the organisers know.',
      );
    }

    // A pasted talk link that is not on the profile means Sessionize moved it
    // or the speaker unlisted it. Say so rather than silently importing a
    // different talk.
    const preselect =
      sessionId && profile.sessions.some((s) => s.id === sessionId) ? sessionId : undefined;

    logger.info('sessionize profile imported', {
      handle,
      uid: request.auth.uid,
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
