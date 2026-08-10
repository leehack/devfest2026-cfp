/** Firestore rules — the four non-negotiables in §6. `npm run test:rules`. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { LIMITS } from '../shared/enums';

const PROJECT_ID = 'demo-devfest-cfp';

const APPLICANT = 'applicant-anna';
const OTHER_APPLICANT = 'applicant-bruno';
const REVIEWER = 'reviewer-chen';
const OTHER_REVIEWER = 'reviewer-dara';
const OWNER = 'owner-olive';

/**
 * Two tenants throughout, not one.
 *
 * Every fixture below exists in both, so a rule that forgot its `cfpId` passes
 * the single-tenant tests and fails the cross-tenant ones. A suite with one CFP
 * in it cannot tell the difference between "scoped correctly" and "not scoped
 * at all".
 */
const CFP_ID = 'devfest-mtl-2026';
const OTHER_CFP_ID = 'someone-elses-conf';
const CFP = `cfps/${CFP_ID}`;
const OTHER_CFP = `cfps/${OTHER_CFP_ID}`;

const CFP_BASE = {
  name: 'DevFest Montréal 2026',
  ownerUids: ['owner-olive'],
  visibility: 'public',
  archived: false,
};

let env: RulesTestEnvironment;

/** A complete, valid draft. Individual tests mutate a copy. */
const draft = (owner: string, cfpId = CFP_ID) => ({
  cfpId,
  speakerIds: [owner],
  status: 'draft',
  title: 'Shipping Flutter on a budget',
  abstract: 'x'.repeat(400),
  category: 'app_dev',
  format: 'session_40',
  level: 'intermediate',
  deliveryLanguage: 'fr',
  acks: { noTravelSupport: true, coc: true, recording: true },
  attendance: { status: 'local', needsVisa: false },
});

/** Moves a seeded draft into the committee's hands. */
async function submitted(id: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `${CFP}/proposals`, id), { status: 'submitted' });
  });
}

async function seedWindow(opensOffsetMs: number, closesOffsetMs: number, path = CFP) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), {
      ...CFP_BASE,
      opensAt: new Date(Date.now() + opensOffsetMs),
      closesAt: new Date(Date.now() + closesOffsetMs),
      paused: false,
      reviewsVisible: false,
    });
  });
}

/** Patches the CFP document itself — the window, visibility or archive state. */
async function setCfp(fields: Record<string, unknown>, path = CFP) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), path), fields);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Open: started an hour ago, closes in a week.
  await seedWindow(-3_600_000, 7 * 86_400_000);
  await seedWindow(-3_600_000, 7 * 86_400_000, OTHER_CFP);

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const member = (role: string, name: string) => ({
      name,
      email: `${name.toLowerCase()}@example.org`,
      role,
      uid: name.toLowerCase(),
    });
    await setDoc(doc(db, `${CFP}/members`, REVIEWER), {
      ...member('reviewer', 'Chen'),
      cfpId: CFP_ID,
      uid: REVIEWER,
    });
    await setDoc(doc(db, `${CFP}/members`, OWNER), {
      ...member('owner', 'Olive'),
      cfpId: CFP_ID,
      uid: OWNER,
    });
    await setDoc(doc(db, `${CFP}/members`, OTHER_REVIEWER), {
      ...member('reviewer', 'Dara'),
      cfpId: CFP_ID,
      uid: OTHER_REVIEWER,
    });
    await setDoc(doc(db, `${CFP}/proposals`, 'p-anna'), {
      ...draft(APPLICANT),
      pitch: 'I have shipped three of these.',
    });
    // A second, foreign proposal, so the scoped-query test is not passing
    // merely because the collection has nothing else in it.
    await setDoc(doc(db, `${CFP}/proposals`, 'p-bruno'), draft(OTHER_APPLICANT));
    await setDoc(doc(db, `${CFP}/proposals/p-anna/reviews`, REVIEWER), {
      cfpId: CFP_ID,
      score: 3,
      note: 'Strong on the practical side.',
      conflictOfInterest: false,
    });

    // The other tenant, with the same cast in the same shapes. Nothing here is
    // reachable from anything above, and the cross-tenant block proves it.
    await setDoc(doc(db, `${OTHER_CFP}/members`, OTHER_REVIEWER), {
      ...member('admin', 'Dara'),
      cfpId: OTHER_CFP_ID,
      uid: OTHER_REVIEWER,
    });
    await setDoc(doc(db, `${OTHER_CFP}/proposals`, 'p-far'), {
      ...draft(OTHER_APPLICANT, OTHER_CFP_ID),
      status: 'submitted',
    });
    await setDoc(doc(db, `${OTHER_CFP}/proposals/p-far/reviews`, OTHER_REVIEWER), {
      cfpId: OTHER_CFP_ID,
      score: 4,
      conflictOfInterest: false,
    });
    await setDoc(doc(db, `${OTHER_CFP}/config/confirmForm`), { fields: [] });
    await setDoc(doc(db, `${OTHER_CFP}/roleGrants/someone@example.org`), {
      email: 'someone@example.org',
      role: 'admin',
    });
  });
});

/**
 * `signedIn()` requires a verified address, not merely a token — email+password
 * signup proves nothing, and roles are granted by address. Every ordinary actor
 * below therefore carries the claim; `asUnverified` is the one that does not.
 */
const VERIFIED = { email_verified: true };

const asApplicant = () => env.authenticatedContext(APPLICANT, VERIFIED).firestore();
const asOther = () => env.authenticatedContext(OTHER_APPLICANT, VERIFIED).firestore();
const asReviewer = () => env.authenticatedContext(REVIEWER, VERIFIED).firestore();
const asOtherReviewer = () => env.authenticatedContext(OTHER_REVIEWER, VERIFIED).firestore();
const asUnverified = () => env.authenticatedContext(APPLICANT, {}).firestore();
const asOwner = () => env.authenticatedContext(OWNER, VERIFIED).firestore();

describe('schedule drafts, shared previews and published releases', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, CFP), {
        publishedScheduleId: 'release-current',
        sharedScheduleId: 'release-shared',
      });
      await setDoc(doc(db, `${CFP}/config/schedule`), {
        revision: 2,
        timeZone: 'America/Toronto',
        days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
        rooms: [{ id: 'main', name: { en: 'Main room' } }],
      });
      await setDoc(doc(db, `${CFP}/scheduleDraft/talk-one`), {
        kind: 'proposal',
        proposalId: 'p-anna',
        date: '2026-11-14',
        startsAt: '09:00',
        durationMinutes: 40,
        roomId: 'main',
      });
      for (const releaseId of ['release-current', 'release-shared', 'release-old']) {
        await setDoc(doc(db, `${CFP}/scheduleReleases/${releaseId}`), {
          version: releaseId === 'release-current' ? 2 : 1,
          timeZone: 'America/Toronto',
          days: [],
          rooms: [],
        });
        await setDoc(doc(db, `${CFP}/scheduleReleases/${releaseId}/entries/talk-one`), {
          kind: 'proposal',
          proposalId: 'p-anna',
          date: '2026-11-14',
          startsAt: '09:00',
          durationMinutes: 40,
          roomId: 'main',
        });
        await setDoc(doc(db, `${CFP}/scheduleReleases/${releaseId}/internal/source`), {
          sourceRevision: 2,
          sourceFingerprint: `fingerprint-${releaseId}`,
          sharedBy: OWNER,
        });
      }
    });
  });

  it('lets only event admins read the draft', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), `${CFP}/config/schedule`)));
    await assertSucceeds(getDocs(collection(asOwner(), `${CFP}/scheduleDraft`)));
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/config/schedule`)));
    await assertFails(getDocs(collection(asApplicant(), `${CFP}/scheduleDraft`)));
  });

  it('makes every draft mutation callable-only, including for an owner', async () => {
    await assertFails(updateDoc(doc(asOwner(), `${CFP}/config/schedule`), { revision: 3 }));
    await assertFails(deleteDoc(doc(asOwner(), `${CFP}/scheduleDraft/talk-one`)));
    await assertFails(
      setDoc(doc(asOwner(), `${CFP}/scheduleDraft/talk-two`), { kind: 'custom' }),
    );
  });

  it('publishes only the release selected by the CFP document', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anon, `${CFP}/scheduleReleases/release-current`)));
    await assertSucceeds(
      getDocs(collection(anon, `${CFP}/scheduleReleases/release-current/entries`)),
    );
    await assertFails(getDoc(doc(anon, `${CFP}/scheduleReleases/release-old`)));
    await assertFails(getDocs(collection(anon, `${CFP}/scheduleReleases/release-old/entries`)));
  });

  it('never exposes the shared-only release through direct browser reads', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, `${CFP}/scheduleReleases/release-shared`)));
    await assertFails(
      getDocs(collection(anon, `${CFP}/scheduleReleases/release-shared/entries`)),
    );
    await assertFails(getDoc(doc(asApplicant(), `${CFP}/scheduleReleases/release-shared`)));
    await assertFails(
      getDocs(collection(asReviewer(), `${CFP}/scheduleReleases/release-shared/entries`)),
    );
    await assertSucceeds(getDoc(doc(asOwner(), `${CFP}/scheduleReleases/release-shared`)));
    await assertSucceeds(
      getDocs(collection(asOwner(), `${CFP}/scheduleReleases/release-shared/entries`)),
    );
  });

  it('keeps release provenance admin-only even after its programme is public', async () => {
    const source = `${CFP}/scheduleReleases/release-current/internal/source`;
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), source)));
    await assertFails(getDoc(doc(asApplicant(), source)));
    await assertFails(getDoc(doc(asReviewer(), source)));
    await assertSucceeds(getDoc(doc(asOwner(), source)));
  });

  it('never lets a browser change a public release', async () => {
    await assertFails(
      updateDoc(doc(asOwner(), `${CFP}/scheduleReleases/release-current/entries/talk-one`), {
        startsAt: '10:00',
      }),
    );
  });
});

describe('applicants read and write only their own proposal', () => {
  it('reads its own proposal', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`)));
  });

  it('cannot read someone else’s proposal', async () => {
    await assertFails(getDoc(doc(asOther(), `${CFP}/proposals/p-anna`)));
  });

  it('can run the scoped array-contains query it actually uses', async () => {
    const q = query(
      collection(asApplicant(), `${CFP}/proposals`),
      where('speakerIds', 'array-contains', APPLICANT),
    );
    const snap = await assertSucceeds(getDocs(q));
    // Scoped to its own document even though a foreign one exists.
    expect(snap.docs.map((d) => d.id)).toEqual(['p-anna']);
  });

  it('can find its own proposals across CFPs without listing anyone else’s', async () => {
    const q = query(
      collectionGroup(asApplicant(), 'proposals'),
      where('speakerIds', 'array-contains', APPLICANT),
    );
    const snap = await assertSucceeds(getDocs(q));
    expect(snap.docs.map((d) => d.id)).toEqual(['p-anna']);
  });

  it('cannot use the cross-CFP query to find another speaker’s proposals', async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(asApplicant(), 'proposals'),
          where('speakerIds', 'array-contains', OTHER_APPLICANT),
        ),
      ),
    );
    await assertFails(getDocs(collectionGroup(asApplicant(), 'proposals')));
  });

  it('cannot scope a query to someone else', async () => {
    const q = query(
      collection(asApplicant(), `${CFP}/proposals`),
      where('speakerIds', 'array-contains', OTHER_APPLICANT),
    );
    await assertFails(getDocs(q));
  });

  it('cannot list the collection unscoped', async () => {
    await assertFails(getDocs(collection(asOther(), `${CFP}/proposals`)));
  });

  it('cannot write itself onto another applicant’s proposal', async () => {
    await assertFails(
      updateDoc(doc(asOther(), `${CFP}/proposals/p-anna`), {
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('cannot delete a proposal', async () => {
    await assertFails(deleteDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`)));
  });
});

describe('the reviews subcollection is invisible to applicants', () => {
  it('denies reading a review document even on its own proposal', async () => {
    await assertFails(getDoc(doc(asApplicant(), `${CFP}/proposals/p-anna/reviews`, REVIEWER)));
  });

  it('denies listing reviews on its own proposal', async () => {
    await assertFails(getDocs(collection(asApplicant(), `${CFP}/proposals/p-anna/reviews`)));
  });

  it('denies writing a review', async () => {
    await assertFails(
      setDoc(doc(asApplicant(), `${CFP}/proposals/p-anna/reviews`, APPLICANT), {
        cfpId: CFP_ID,
        score: 4,
        conflictOfInterest: false,
      }),
    );
  });
});

describe('status and aggregate are function-writable only', () => {
  it('allows an ordinary content edit', async () => {
    await assertSucceeds(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { title: 'A better title' }),
    );
  });

  // The client clears optional fields with deleteField() sentinels rather than
  // omitting them, because a {merge: true} write ignores absent keys. If the
  // protected-key diff treated a deletion as a protected write, every draft
  // save that cleared a field would fail.
  it('allows clearing an optional field with deleteField()', async () => {
    await assertSucceeds(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { pitch: deleteField() }),
    );
  });

  it('denies deleting a protected field', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { status: deleteField() }),
    );
  });

  /*
   * The confirmation answers are validated by `respondToDecision` against the
   * form as it stands. A speaker who could write the map directly would answer
   * questions that were never asked — or skip the ones that were.
   */
  it('denies writing the confirmation answers directly', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { confirmAnswers: { shirt: 'XXL' } }),
    );
  });

  it('denies writing or planting a server-owned headshot pointer', async () => {
    const headshotUploads = {
      headshot: {
        path: `cfps/${CFP_ID}/workingHeadshots/p-anna/headshot/forged`,
        generation: '1',
        contentType: 'image/png',
        size: 8,
      },
    };
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { headshotUploads }),
    );
    await assertFails(
      addDoc(collection(asApplicant(), `${CFP}/proposals`), {
        ...draft(APPLICANT),
        headshotUploads,
      }),
    );
  });

  /**
   * Naming a co-presenter is a claim about someone else: it hands them write
   * access, and disqualifies them from reviewing the talk. Until there is an
   * invitation flow, the cast is fixed at creation.
   */
  it('denies naming a co-presenter who never agreed', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), {
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('denies creating a proposal with someone else already on it', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), `${CFP}/proposals`), {
        ...draft(APPLICANT),
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('denies putting a proposal in someone else’s name entirely', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(OTHER_APPLICANT)),
    );
  });

  it('denies removing yourself from your own proposal', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { speakerIds: [OTHER_APPLICANT] }),
    );
  });

  it('denies a client-side status change', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { status: 'submitted' }),
    );
  });

  it('denies self-acceptance', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { status: 'accepted' }),
    );
  });

  it('denies writing an aggregate score', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), {
        aggregate: { avgScore: 4, normalizedScore: 4, reviewCount: 9, stdDev: 0 },
      }),
    );
  });

  it('denies creating a proposal that is already submitted', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), `${CFP}/proposals`), {
        ...draft(APPLICANT),
        status: 'submitted',
      }),
    );
  });
});

/**
 * A speaker keeps editing after submitting, until the committee starts reading.
 * After that only the travel answers move, because they carry no weight in the
 * score and change for reasons that have nothing to do with the talk.
 */
describe('editing after submission', () => {
  const setStatus = (status: string) =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `${CFP}/proposals/p-anna`), { status });
    });

  const editContent = () => updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { title: 'Reworked' });
  const editTravel = () =>
    updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), {
      attendance: { status: 'pending', needsVisa: true, fundingSource: 'employer' },
    });

  it('allows content edits while it is still only submitted', async () => {
    await setStatus('submitted');
    await assertSucceeds(editContent());
  });

  it('denies content edits once it is under review', async () => {
    await setStatus('under_review');
    await assertFails(editContent());
  });

  it('still allows the travel answers under review', async () => {
    await setStatus('under_review');
    await assertSucceeds(editTravel());
  });

  it('allows the travel answers on an accepted talk, after the window closes', async () => {
    // The case this exists for: accepted in September, visa refused in October.
    await seedWindow(-14 * 86_400_000, -86_400_000);
    await setStatus('accepted');
    await assertSucceeds(editTravel());
    await assertFails(editContent());
  });

  it('denies everything once withdrawn or rejected', async () => {
    for (const status of ['withdrawn', 'rejected']) {
      await setStatus(status);
      await assertFails(editContent());
      await assertFails(editTravel());
    }
  });

  it('denies smuggling a content change in alongside the travel answers', async () => {
    await setStatus('under_review');
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), {
        // Must differ from the seed, or `affectedKeys()` never names it and the
        // test passes on the abstract alone — which proves nothing about the
        // pairing this is here to reject.
        attendance: { status: 'pending', needsVisa: true, fundingSource: 'employer' },
        abstract: 'y'.repeat(400),
      }),
    );
  });

  it('still denies a status change of their own', async () => {
    await setStatus('submitted');
    await assertFails(updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { status: 'accepted' }));
  });

  // `confirmed` and `declined` are the speaker's own answer, which makes them
  // the two they are likeliest to try writing directly. They still go through
  // `respondToDecision`, because the precondition is "only from accepted" and
  // nothing here would stop a speaker confirming a rejection.
  it('denies answering an acceptance by writing the status', async () => {
    await setStatus('accepted');
    for (const status of ['confirmed', 'declined']) {
      await assertFails(updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { status }));
    }
  });
});

describe('the deadline is enforced server-side', () => {
  it('allows a create while the window is open', async () => {
    await assertSucceeds(addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT)));
  });

  it('denies a create once the window has closed', async () => {
    await seedWindow(-7 * 86_400_000, -3_600_000);
    await assertFails(addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT)));
  });

  it('denies an edit once the window has closed', async () => {
    await seedWindow(-7 * 86_400_000, -3_600_000);
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { title: 'Too late' }),
    );
  });

  it('denies a create before the window opens', async () => {
    await seedWindow(86_400_000, 7 * 86_400_000);
    await assertFails(addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT)));
  });
});

describe('review writes are callable-only', () => {
  // The callable owns status, conflict, score and comment validation.
  beforeEach(() => submitted('p-anna'));

  it('denies a valid direct review create', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 2,
        // `comment`, which is the field that exists. This said `note` until the
        // key list below was added, so it proved the write succeeded without ever
        // touching the field it appeared to be about.
        comment: 'Overlaps with another submission.',
        conflictOfInterest: false,
      }),
    );
  });

  it('denies a direct write even when the comment is within the cap', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 2,
        comment: 'x'.repeat(LIMITS.reviewCommentMax),
        conflictOfInterest: false,
      }),
    );
  });

  it('refuses one character more', async () => {
    // This remains denied at the rules boundary; the callable owns validation.
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 2,
        comment: 'x'.repeat(LIMITS.reviewCommentMax + 1),
        conflictOfInterest: false,
      }),
    );
  });

  it('refuses a key the review model does not have', async () => {
    // Direct writes remain closed regardless of their shape.
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 2,
        conflictOfInterest: false,
        note: 'x'.repeat(LIMITS.reviewCommentMax + 1),
      }),
    );
  });

  it('cannot overwrite a colleague’s score', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER), {
        cfpId: CFP_ID,
        score: 1,
        conflictOfInterest: false,
      }),
    );
  });

  it('denies direct review updates and deletes', async () => {
    await assertFails(
      updateDoc(doc(asReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER), { score: 1 }),
    );
    await assertFails(
      deleteDoc(doc(asReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER)),
    );
  });

  it('cannot read a colleague’s score while the round is open', async () => {
    await assertFails(getDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER)));
  });

  it('can read a colleague’s score once the round closes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), CFP), { reviewsVisible: true });
    });
    await assertSucceeds(getDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER)));
  });

  it('rejects an out-of-range score', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 7,
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot grant itself reviewer status', async () => {
    await assertFails(
      setDoc(doc(asApplicant(), `${CFP}/members`, APPLICANT), {
        name: 'Anna',
        email: 'anna@example.org',
        role: 'admin',
      }),
    );
  });

  it('cannot promote itself to admin', async () => {
    // The reviewers collection is the root of every other permission here, so
    // even an existing reviewer must not be able to edit their own row.
    await assertFails(
      updateDoc(doc(asReviewer(), `${CFP}/members`, REVIEWER), { role: 'admin' }),
    );
  });
});

/**
 * Reviewers and admins may submit talks too, which puts them on both sides of
 * the reviews subcollection. §6's "applicants never read their own reviews"
 * outranks any role.
 */
describe('a reviewer who is also a speaker', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // REVIEWER speaks on this one; OTHER_REVIEWER has already scored it.
      await setDoc(doc(db, `${CFP}/proposals`, 'p-chen'), {
        ...draft(REVIEWER),
        status: 'submitted',
      });
      await setDoc(doc(db, `${CFP}/proposals/p-chen/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 4,
        conflictOfInterest: false,
      });
    });
    // Same reason as above: these must fail for self-review, not for draft.
    await submitted('p-bruno');
  });

  it('cannot review its own proposal', async () => {
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/proposals/p-chen/reviews`, REVIEWER), {
        cfpId: CFP_ID,
        score: 4,
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot read a review on its own proposal', async () => {
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/proposals/p-chen/reviews`, OTHER_REVIEWER)));
  });

  it('cannot list the reviews on its own proposal', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/proposals/p-chen/reviews`)));
  });

  it('still cannot read them once the round closes', async () => {
    // The moment reviewsVisible flips is exactly when this would leak.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), CFP), { reviewsVisible: true });
    });
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/proposals/p-chen/reviews`, OTHER_REVIEWER)));
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/proposals/p-chen/reviews`)));
  });

  it('not even as an admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/proposals/p-chen/reviews`, OTHER_REVIEWER)));
  });

  it('still cannot bypass the review callable for someone else’s proposal', async () => {
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/proposals/p-bruno/reviews`, REVIEWER), {
        cfpId: CFP_ID,
        score: 3,
        conflictOfInterest: false,
      }),
    );
  });

  it('can still submit a talk like anyone else', async () => {
    await assertSucceeds(addDoc(collection(asReviewer(), `${CFP}/proposals`), draft(REVIEWER)));
  });
});

/** What the admin and review screens read before they can render anything. */
/**
 * A draft was never handed to anybody. Someone may have typed something into a
 * pitch and thought better of sending it; the committee has no claim on that.
 */
describe('unsubmitted drafts are private to their author', () => {
  it('denies a reviewer reading a draft', async () => {
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/proposals/p-anna`)));
  });

  it('denies a reviewer listing the collection unfiltered', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/proposals`)));
  });

  it('allows the filtered listing the committee screens actually use', async () => {
    await assertSucceeds(
      getDocs(query(collection(asReviewer(), `${CFP}/proposals`), where('status', '!=', 'draft'))),
    );
  });

  it('lets the author still read their own draft', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`)));
  });

  it('opens it to reviewers the moment it is submitted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `${CFP}/proposals/p-anna`), { status: 'submitted' });
    });
    await assertSucceeds(getDoc(doc(asReviewer(), `${CFP}/proposals/p-anna`)));
  });

  it('keeps direct scoring closed for a draft or withdrawn proposal', async () => {
    // The callable separately enforces the lifecycle state.
    for (const status of ['draft', 'withdrawn']) {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), `${CFP}/proposals/p-bruno`), { status });
      });
      await assertFails(
        setDoc(doc(asReviewer(), `${CFP}/proposals/p-bruno/reviews`, REVIEWER), {
          cfpId: CFP_ID,
          score: 3,
          conflictOfInterest: false,
        }),
      );
    }
  });

  it('keeps direct scoring closed once it is submitted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `${CFP}/proposals/p-bruno`), { status: 'submitted' });
    });
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/proposals/p-bruno/reviews`, REVIEWER), {
        cfpId: CFP_ID,
        score: 3,
        conflictOfInterest: false,
      }),
    );
  });
});

describe('the reviewers collection', () => {
  const makeAdmin = () =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });

  it('lets anyone read their own row, so a speaker can find they have no role', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/members`, APPLICANT)));
  });

  it('denies an applicant reading someone else’s row', async () => {
    await assertFails(getDoc(doc(asApplicant(), `${CFP}/members`, REVIEWER)));
  });

  it('denies an applicant listing the committee', async () => {
    await assertFails(getDocs(collection(asApplicant(), `${CFP}/members`)));
  });

  it('denies a plain reviewer listing the committee', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/members`)));
  });

  it('allows an admin to list the committee', async () => {
    await makeAdmin();
    await assertSucceeds(getDocs(collection(asReviewer(), `${CFP}/members`)));
  });
});

/** The review queue and the admin proposals table are both unscoped listings. */
describe('reviewers read every proposal in their own CFP', () => {
  it('lists every submitted proposal', async () => {
    await submitted('p-anna');
    await submitted('p-bruno');
    const snap = await getDocs(
      query(collection(asReviewer(), `${CFP}/proposals`), where('status', '!=', 'draft')),
    );
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['p-anna', 'p-bruno']);
  });
});

/*
 * A profile belongs to the account rather than to any one talk, so that nobody
 * retypes their bio for every CFP they apply to. Which is exactly why nobody
 * else may read it: a role is per CFP and a profile is not, so "reviewers may
 * read speakers" would have handed every committee on the platform the whole
 * directory. The committee reads `speakerSnapshot` on the proposal instead.
 */
describe('a speaker profile is readable only by its owner', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'speakers', APPLICANT), {
        name: 'Anna',
        email: 'anna@example.org',
        bio: 'x'.repeat(60),
      });
    });
  });

  it('lets the owner read their own', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), 'speakers', APPLICANT)));
  });

  it('denies another applicant, and a reviewer of the CFP they applied to', async () => {
    await assertFails(getDoc(doc(asOther(), 'speakers', APPLICANT)));
    await assertFails(getDoc(doc(asReviewer(), 'speakers', APPLICANT)));
  });

  it('denies listing the directory', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'speakers')));
  });
});

describe('role grants are readable only by admins', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/roleGrants`, 'new@example.org'), {
        email: 'new@example.org',
        role: 'reviewer',
        createdBy: 'someone',
      });
    });
  });

  it('denies an applicant', async () => {
    await assertFails(getDocs(collection(asApplicant(), `${CFP}/roleGrants`)));
  });

  it('denies a plain reviewer — these are email addresses', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/roleGrants`)));
  });

  it('allows an admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertSucceeds(getDocs(collection(asReviewer(), `${CFP}/roleGrants`)));
  });

  it('denies even an admin writing one directly', async () => {
    // Grants are minted by the callables, which validate the email and role.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/roleGrants`, 'x@example.org'), {
        email: 'x@example.org',
        role: 'admin',
      }),
    );
  });
});

/**
 * Enabling email sign-in also enables email+password signup, which verifies
 * nothing. An account that has not proved its address must not be able to act
 * as the person who owns it.
 */
describe('an unverified account is not signed in', () => {
  it('cannot read or write a proposal, even its own', async () => {
    await assertFails(getDoc(doc(asUnverified(), `${CFP}/proposals/p-anna`)));
    await assertFails(updateDoc(doc(asUnverified(), `${CFP}/proposals/p-anna`), { title: 'Mine now' }));
  });

  it('cannot create a proposal at all', async () => {
    await assertFails(addDoc(collection(asUnverified(), `${CFP}/proposals`), draft(APPLICANT)));
  });

  it('cannot claim a speaker profile for the address it has not proved', async () => {
    await assertFails(
      setDoc(doc(asUnverified(), 'speakers', APPLICANT), { email: 'anna@example.org' }),
    );
  });

  it('cannot read the confirmation questions', async () => {
    await assertFails(getDoc(doc(asUnverified(), `${CFP}/config/confirmForm`)));
  });
});

describe('config', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/config/email`), {
        from: 'DevFest <cfp@example.org>',
        replyTo: 'organisers@example.org',
      });
    });
  });

  it('lets a signed-out visitor read the window', async () => {
    // It is on the CFP document rather than in config, because the landing page
    // renders the deadline before asking anyone to sign in.
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), CFP)));
  });

  it('does not expose the rest of the collection', async () => {
    // The read rule names `confirmForm` rather than the collection, so a
    // document added later is shut by default instead of public by default.
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${CFP}/config/email`)));
    await assertFails(getDoc(doc(asApplicant(), `${CFP}/config/email`)));
    await assertFails(getDocs(collection(asApplicant(), `${CFP}/config`)));
    // The platform's own config is shut outright — only the functions read it.
    await assertFails(getDoc(doc(asApplicant(), 'config/platform')));
  });

  it('denies an admin reading it directly — that goes through the callable', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(getDoc(doc(asReviewer(), `${CFP}/config/email`)));
  });

  it('denies writing the window or the sender', async () => {
    // Both are read by the rules themselves or by the sender; a client write
    // here would reopen a closed CFP or redirect the mail.
    await assertFails(updateDoc(doc(asApplicant(), CFP), { paused: false }));
    await assertFails(setDoc(doc(asApplicant(), `${CFP}/config/email`), { from: 'me@evil.example' }));
  });

  /*
   * The one exception to "only `cfp` is readable": the confirmation questions
   * are rendered by the speaker who is about to answer them, so their browser
   * has to be able to read the document.
   */
  it('lets a signed-in speaker read the confirmation questions', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/config/confirmForm`), { fields: [] });
    });
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/config/confirmForm`)));
  });

  it('keeps the questions from a signed-out visitor, and shut to writes', async () => {
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), `${CFP}/config/confirmForm`)),
    );
    // Writable only by the callable — otherwise anyone could ask a speaker
    // anything from a page carrying our name.
    await assertFails(setDoc(doc(asApplicant(), `${CFP}/config/confirmForm`), { fields: [] }));
  });

  /*
   * The submission form goes one further than the confirmation form: it is
   * readable signed out. What a call is asking for is the substance of its
   * public page, and a stranger deciding whether to write a proposal is the
   * person that page exists for.
   */
  it('lets anyone at all read the submission form', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/config/submissionForm`), { category: [] });
    });
    await assertSucceeds(
      getDoc(doc(env.unauthenticatedContext().firestore(), `${CFP}/config/submissionForm`)),
    );
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/config/submissionForm`)));
  });

  it('lets nobody write the submission form', async () => {
    // A speaker who could edit it could delete the consents they are refusing
    // to give, or add a category their own talk happens to be in.
    await assertFails(
      setDoc(doc(asApplicant(), `${CFP}/config/submissionForm`), { category: [] }),
    );
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/config/submissionForm`), { category: [] }),
    );
  });
});

/**
 * The queue holds every applicant's address alongside a decision that has not
 * been announced yet, and a row with `status: 'queued'` is an instruction to
 * send mail from our verified domain. Both halves are worth a test.
 */
describe('emailLog is closed to clients', () => {
  async function makeAdmin() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/members`, REVIEWER), {
        cfpId: CFP_ID,
        uid: REVIEWER,
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
  }

  const row = {
    kind: 'accepted',
    proposalId: 'p1',
    to: 'someone@example.org',
    locale: 'en',
    status: 'queued',
  };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `${CFP}/emailLog`, 'accepted__p1'), row);
    });
  });

  it('denies reads', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/emailLog`)));
  });

  it('denies an applicant reading their own decision early', async () => {
    await assertFails(getDoc(doc(asApplicant(), `${CFP}/emailLog`, 'accepted__p1')));
  });

  it('denies an admin too — the queue is read through the callable', async () => {
    await makeAdmin();
    await assertFails(getDocs(collection(asReviewer(), `${CFP}/emailLog`)));
  });

  it('denies writing a row, which would be a send', async () => {
    // A client that could write `queued` could mail anyone from our domain.
    await assertFails(setDoc(doc(asApplicant(), `${CFP}/emailLog`, 'accepted__p2'), row));
  });

  it('denies releasing a held row', async () => {
    await makeAdmin();
    await assertFails(
      updateDoc(doc(asReviewer(), `${CFP}/emailLog`, 'accepted__p1'), { status: 'queued' }),
    );
  });

  it('denies deleting the audit trail', async () => {
    await makeAdmin();
    await assertFails(deleteDoc(doc(asReviewer(), `${CFP}/emailLog`, 'accepted__p1')));
  });
});

/**
 * The non-negotiable that tenancy adds to the four in §6:
 *
 * > A CFP's owner, admin, reviewer and applicant can read nothing belonging to
 * > any other CFP.
 *
 * Dara is deliberately a reviewer on one CFP and an **admin** on the other, so
 * every assertion below is made by somebody who genuinely holds a role — the
 * question is only whether it is the role they hold *here*. A rule that checked
 * "is a member of some CFP" rather than "is a member of this one" passes every
 * other test in this file and fails these.
 */
describe('nothing crosses between two CFPs', () => {
  const asAdminElsewhere = asOtherReviewer;

  it('denies reading a foreign proposal, one document or the whole list', async () => {
    await assertFails(getDoc(doc(asReviewer(), `${OTHER_CFP}/proposals/p-far`)));
    await assertFails(
      getDocs(query(collection(asReviewer(), `${OTHER_CFP}/proposals`), where('status', '!=', 'draft'))),
    );
  });

  it('denies an admin of one CFP reading the other’s proposals', async () => {
    // Dara administers `someone-elses-conf` and merely reviews this one.
    await submitted('p-anna');
    await assertSucceeds(getDoc(doc(asAdminElsewhere(), `${CFP}/proposals/p-anna`)));
    // ...but Chen, who is only on this one, gets nothing over there.
    await assertFails(getDoc(doc(asReviewer(), `${OTHER_CFP}/proposals/p-far`)));
  });

  it('denies reading a foreign review', async () => {
    await assertFails(
      getDoc(doc(asReviewer(), `${OTHER_CFP}/proposals/p-far/reviews`, OTHER_REVIEWER)),
    );
  });

  it('denies writing a review into a CFP you are not on', async () => {
    await assertFails(
      setDoc(doc(asReviewer(), `${OTHER_CFP}/proposals/p-far/reviews`, REVIEWER), {
        cfpId: OTHER_CFP_ID,
        score: 1,
        conflictOfInterest: false,
      }),
    );
  });

  // The callable derives cfpId from the tenant path; a client cannot forge the
  // denormalised field that aggregate collection-group queries use.
  it('denies a direct review with either a forged or matching cfpId', async () => {
    await submitted('p-anna');
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: OTHER_CFP_ID,
        score: 4,
        conflictOfInterest: false,
      }),
    );
    await assertFails(
      setDoc(doc(asOtherReviewer(), `${CFP}/proposals/p-anna/reviews`, OTHER_REVIEWER), {
        cfpId: CFP_ID,
        score: 4,
        conflictOfInterest: false,
      }),
    );
  });

  it('denies a proposal whose cfpId is not the one it is filed under', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT, OTHER_CFP_ID)),
    );
    await assertSucceeds(addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT)));
  });

  it('denies reading a foreign committee, its grants and its questions', async () => {
    await assertFails(getDocs(collection(asReviewer(), `${OTHER_CFP}/members`)));
    await assertFails(getDocs(collection(asReviewer(), `${OTHER_CFP}/roleGrants`)));
    // The questions are readable to any signed-in speaker by design — they are
    // about to answer them — so this one is scoped by path, not by role.
    await assertSucceeds(getDoc(doc(asReviewer(), `${OTHER_CFP}/config/confirmForm`)));
  });

  it('denies a foreign email log', async () => {
    await assertFails(getDocs(collection(asAdminElsewhere(), `${CFP}/emailLog`)));
  });
});

/**
 * The CFP document itself. `private` means unlisted rather than secret, which
 * is a distinction the rules have to make precisely: hiding a private CFP from
 * somebody holding its link would break the feature rather than protect it.
 */
describe('finding a CFP', () => {
  beforeEach(async () => {
    await setCfp({ visibility: 'private' }, OTHER_CFP);
  });

  const anon = () => env.unauthenticatedContext().firestore();

  it('lets anyone open one by id, public or private', async () => {
    await assertSucceeds(getDoc(doc(anon(), CFP)));
    await assertSucceeds(getDoc(doc(anon(), OTHER_CFP)));
  });

  /**
   * A `list` rule is evaluated against the query rather than against the
   * documents, so the rule can only name fields the query filters on — and the
   * directory query therefore has to carry both of them.
   */
  const directory = (db: ReturnType<typeof anon>) =>
    query(
      collection(db, 'cfps'),
      where('visibility', '==', 'public'),
      where('archived', '==', false),
    );

  it('lists the public ones to a signed-out visitor', async () => {
    const snap = await assertSucceeds(getDocs(directory(anon())));
    expect(snap.docs.map((d) => d.id)).toEqual([CFP_ID]);
  });

  it('denies a listing that does not carry both filters', async () => {
    // Unfiltered would be every private CFP on the platform; filtered on
    // visibility alone would be every archived one.
    await assertFails(getDocs(collection(anon(), 'cfps')));
    await assertFails(getDocs(collection(asApplicant(), 'cfps')));
    await assertFails(
      getDocs(query(collection(anon(), 'cfps'), where('visibility', '==', 'public'))),
    );
  });

  it('drops an archived CFP from the public listing', async () => {
    await setCfp({ visibility: 'public' }, OTHER_CFP);
    await setCfp({ archived: true, archivedAt: new Date() });
    const snap = await assertSucceeds(getDocs(directory(anon())));
    expect(snap.docs.map((d) => d.id)).toEqual([OTHER_CFP_ID]);
  });

  it('lets an owner list their own, private and archived alike', async () => {
    await setCfp({ ownerUids: [APPLICANT], archived: true, archivedAt: new Date() }, OTHER_CFP);
    const snap = await assertSucceeds(
      getDocs(query(collection(asApplicant(), 'cfps'), where('ownerUids', 'array-contains', APPLICANT))),
    );
    expect(snap.docs.map((d) => d.id)).toEqual([OTHER_CFP_ID]);
  });

  it('lets a member find every CFP they are on, and nobody else’s', async () => {
    const mine = await assertSucceeds(
      getDocs(query(collection(asReviewer(), 'cfps'), where('ownerUids', 'array-contains', REVIEWER))),
    );
    expect(mine.empty).toBe(true);

    // The one query that deliberately spans tenants, scoped to the caller's own
    // membership documents by id.
    const memberships = await assertSucceeds(
      getDocs(query(collectionGroup(asOtherReviewer(), 'members'), where('uid', '==', OTHER_REVIEWER))),
    );
    expect(memberships.docs.map((d) => d.data().cfpId).sort()).toEqual([CFP_ID, OTHER_CFP_ID]);
  });

  it('denies sweeping up everybody else’s memberships', async () => {
    await assertFails(
      getDocs(query(collectionGroup(asReviewer(), 'members'), where('uid', '==', OTHER_REVIEWER))),
    );
    await assertFails(getDocs(collectionGroup(asReviewer(), 'members')));
  });

  it('is not client-writable at all', async () => {
    await assertFails(setDoc(doc(asApplicant(), 'cfps/mine'), { ...CFP_BASE, ownerUids: [APPLICANT] }));
    await assertFails(updateDoc(doc(asApplicant(), CFP), { name: 'Mine now' }));
    await assertFails(deleteDoc(doc(asApplicant(), CFP)));
  });
});

describe('platform access is callable-only', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'platformMembers', REVIEWER), {
        uid: REVIEWER,
        email: 'chen@example.org',
        role: 'admin',
        grantedBy: 'bootstrap',
      });
      await setDoc(doc(db, 'platformRoleGrants', 'creator@example.org'), {
        email: 'creator@example.org',
        role: 'creator',
        createdBy: REVIEWER,
      });
    });
  });

  it('does not turn a platform admin into a client-readable user directory', async () => {
    await assertFails(getDoc(doc(asReviewer(), 'platformMembers', REVIEWER)));
    await assertFails(getDocs(collection(asReviewer(), 'platformMembers')));
    await assertFails(getDocs(collection(asReviewer(), 'platformRoleGrants')));
  });

  it('does not expose grants to signed-out or ordinary signed-in visitors', async () => {
    await assertFails(
      getDoc(
        doc(
          env.unauthenticatedContext().firestore(),
          'platformRoleGrants',
          'creator@example.org',
        ),
      ),
    );
    await assertFails(
      getDoc(doc(asApplicant(), 'platformRoleGrants', 'creator@example.org')),
    );
  });

  it('never lets a client grant, promote, revoke, or delete platform access', async () => {
    await assertFails(
      setDoc(doc(asApplicant(), 'platformMembers', APPLICANT), {
        uid: APPLICANT,
        email: 'anna@example.org',
        role: 'admin',
      }),
    );
    await assertFails(
      setDoc(doc(asApplicant(), 'platformMembers', APPLICANT), {
        uid: APPLICANT,
        email: 'anna@example.org',
        role: 'owner',
      }),
    );
    await assertFails(
      updateDoc(doc(asReviewer(), 'platformMembers', REVIEWER), { role: 'creator' }),
    );
    await assertFails(deleteDoc(doc(asReviewer(), 'platformMembers', REVIEWER)));
    await assertFails(
      setDoc(doc(asReviewer(), 'platformRoleGrants', 'friend@example.org'), {
        email: 'friend@example.org',
        role: 'creator',
      }),
    );
  });
});

/** Archiving is how a round is stopped without editing its window. */
describe('an archived CFP is read-only', () => {
  beforeEach(async () => {
    await setCfp({ archived: true, archivedAt: new Date() });
  });

  it('refuses a new proposal', async () => {
    await assertFails(addDoc(collection(asApplicant(), `${CFP}/proposals`), draft(APPLICANT)));
  });

  it('refuses an edit to an existing one', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`), { title: 'A better title' }),
    );
  });

  it('keeps direct review writes closed', async () => {
    await submitted('p-anna');
    await assertFails(
      setDoc(doc(asReviewer(), `${CFP}/proposals/p-anna/reviews`, REVIEWER), {
        cfpId: CFP_ID,
        score: 2,
        conflictOfInterest: false,
      }),
    );
  });

  it('still reads', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), `${CFP}/proposals/p-anna`)));
  });
});
