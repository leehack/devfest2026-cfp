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

const PROJECT_ID = 'demo-devfest-cfp';

const APPLICANT = 'applicant-anna';
const OTHER_APPLICANT = 'applicant-bruno';
const REVIEWER = 'reviewer-chen';
const OTHER_REVIEWER = 'reviewer-dara';

let env: RulesTestEnvironment;

/** A complete, valid draft. Individual tests mutate a copy. */
const draft = (owner: string) => ({
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

async function seedWindow(opensOffsetMs: number, closesOffsetMs: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config/cfp'), {
      opensAt: new Date(Date.now() + opensOffsetMs),
      closesAt: new Date(Date.now() + closesOffsetMs),
      paused: false,
      reviewsVisible: false,
    });
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

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'reviewers', REVIEWER), {
      name: 'Chen',
      email: 'chen@example.org',
      role: 'reviewer',
    });
    await setDoc(doc(db, 'reviewers', OTHER_REVIEWER), {
      name: 'Dara',
      email: 'dara@example.org',
      role: 'reviewer',
    });
    await setDoc(doc(db, 'proposals', 'p-anna'), {
      ...draft(APPLICANT),
      pitch: 'I have shipped three of these.',
    });
    // A second, foreign proposal, so the scoped-query test is not passing
    // merely because the collection has nothing else in it.
    await setDoc(doc(db, 'proposals', 'p-bruno'), draft(OTHER_APPLICANT));
    await setDoc(doc(db, 'proposals/p-anna/reviews', REVIEWER), {
      score: 3,
      note: 'Strong on the practical side.',
      conflictOfInterest: false,
    });
  });
});

const asApplicant = () => env.authenticatedContext(APPLICANT).firestore();
const asOther = () => env.authenticatedContext(OTHER_APPLICANT).firestore();
const asReviewer = () => env.authenticatedContext(REVIEWER).firestore();
const asOtherReviewer = () => env.authenticatedContext(OTHER_REVIEWER).firestore();

describe('applicants read and write only their own proposal', () => {
  it('reads its own proposal', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), 'proposals/p-anna')));
  });

  it('cannot read someone else’s proposal', async () => {
    await assertFails(getDoc(doc(asOther(), 'proposals/p-anna')));
  });

  it('can run the scoped array-contains query it actually uses', async () => {
    const q = query(
      collection(asApplicant(), 'proposals'),
      where('speakerIds', 'array-contains', APPLICANT),
    );
    const snap = await assertSucceeds(getDocs(q));
    // Scoped to its own document even though a foreign one exists.
    expect(snap.docs.map((d) => d.id)).toEqual(['p-anna']);
  });

  it('cannot scope a query to someone else', async () => {
    const q = query(
      collection(asApplicant(), 'proposals'),
      where('speakerIds', 'array-contains', OTHER_APPLICANT),
    );
    await assertFails(getDocs(q));
  });

  it('cannot list the collection unscoped', async () => {
    await assertFails(getDocs(collection(asOther(), 'proposals')));
  });

  it('cannot write itself onto another applicant’s proposal', async () => {
    await assertFails(
      updateDoc(doc(asOther(), 'proposals/p-anna'), {
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('cannot delete a proposal', async () => {
    await assertFails(deleteDoc(doc(asApplicant(), 'proposals/p-anna')));
  });
});

describe('the reviews subcollection is invisible to applicants', () => {
  it('denies reading a review document even on its own proposal', async () => {
    await assertFails(getDoc(doc(asApplicant(), 'proposals/p-anna/reviews', REVIEWER)));
  });

  it('denies listing reviews on its own proposal', async () => {
    await assertFails(getDocs(collection(asApplicant(), 'proposals/p-anna/reviews')));
  });

  it('denies writing a review', async () => {
    await assertFails(
      setDoc(doc(asApplicant(), 'proposals/p-anna/reviews', APPLICANT), {
        score: 4,
        conflictOfInterest: false,
      }),
    );
  });
});

describe('status and aggregate are function-writable only', () => {
  it('allows an ordinary content edit', async () => {
    await assertSucceeds(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { title: 'A better title' }),
    );
  });

  // The client clears optional fields with deleteField() sentinels rather than
  // omitting them, because a {merge: true} write ignores absent keys. If the
  // protected-key diff treated a deletion as a protected write, every draft
  // save that cleared a field would fail.
  it('allows clearing an optional field with deleteField()', async () => {
    await assertSucceeds(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { pitch: deleteField() }),
    );
  });

  it('denies deleting a protected field', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { status: deleteField() }),
    );
  });

  it('allows adding a co-presenter', async () => {
    await assertSucceeds(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), {
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('denies removing yourself from your own proposal', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { speakerIds: [OTHER_APPLICANT] }),
    );
  });

  it('denies a client-side status change', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { status: 'submitted' }),
    );
  });

  it('denies self-acceptance', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { status: 'accepted' }),
    );
  });

  it('denies writing an aggregate score', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), {
        aggregate: { avgScore: 4, normalizedScore: 4, reviewCount: 9, stdDev: 0 },
      }),
    );
  });

  it('denies creating a proposal that is already submitted', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), 'proposals'), {
        ...draft(APPLICANT),
        status: 'submitted',
      }),
    );
  });
});

describe('the deadline is enforced server-side', () => {
  it('allows a create while the window is open', async () => {
    await assertSucceeds(addDoc(collection(asApplicant(), 'proposals'), draft(APPLICANT)));
  });

  it('denies a create once the window has closed', async () => {
    await seedWindow(-7 * 86_400_000, -3_600_000);
    await assertFails(addDoc(collection(asApplicant(), 'proposals'), draft(APPLICANT)));
  });

  it('denies an edit once the window has closed', async () => {
    await seedWindow(-7 * 86_400_000, -3_600_000);
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), { title: 'Too late' }),
    );
  });

  it('denies a create before the window opens', async () => {
    await seedWindow(86_400_000, 7 * 86_400_000);
    await assertFails(addDoc(collection(asApplicant(), 'proposals'), draft(APPLICANT)));
  });
});

describe('reviewers write only their own review', () => {
  it('writes its own review', async () => {
    await assertSucceeds(
      setDoc(doc(asOtherReviewer(), 'proposals/p-anna/reviews', OTHER_REVIEWER), {
        score: 2,
        note: 'Overlaps with another submission.',
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot overwrite a colleague’s score', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), 'proposals/p-anna/reviews', REVIEWER), {
        score: 1,
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot read a colleague’s score while the round is open', async () => {
    await assertFails(getDoc(doc(asOtherReviewer(), 'proposals/p-anna/reviews', REVIEWER)));
  });

  it('can read a colleague’s score once the round closes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'config/cfp'), { reviewsVisible: true });
    });
    await assertSucceeds(getDoc(doc(asOtherReviewer(), 'proposals/p-anna/reviews', REVIEWER)));
  });

  it('rejects an out-of-range score', async () => {
    await assertFails(
      setDoc(doc(asOtherReviewer(), 'proposals/p-anna/reviews', OTHER_REVIEWER), {
        score: 7,
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot grant itself reviewer status', async () => {
    await assertFails(
      setDoc(doc(asApplicant(), 'reviewers', APPLICANT), {
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
      updateDoc(doc(asReviewer(), 'reviewers', REVIEWER), { role: 'admin' }),
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
      await setDoc(doc(db, 'proposals', 'p-chen'), draft(REVIEWER));
      await setDoc(doc(db, 'proposals/p-chen/reviews', OTHER_REVIEWER), {
        score: 4,
        conflictOfInterest: false,
      });
    });
  });

  it('cannot review its own proposal', async () => {
    await assertFails(
      setDoc(doc(asReviewer(), 'proposals/p-chen/reviews', REVIEWER), {
        score: 4,
        conflictOfInterest: false,
      }),
    );
  });

  it('cannot read a review on its own proposal', async () => {
    await assertFails(getDoc(doc(asReviewer(), 'proposals/p-chen/reviews', OTHER_REVIEWER)));
  });

  it('cannot list the reviews on its own proposal', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'proposals/p-chen/reviews')));
  });

  it('still cannot read them once the round closes', async () => {
    // The moment reviewsVisible flips is exactly when this would leak.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'config/cfp'), { reviewsVisible: true });
    });
    await assertFails(getDoc(doc(asReviewer(), 'proposals/p-chen/reviews', OTHER_REVIEWER)));
    await assertFails(getDocs(collection(asReviewer(), 'proposals/p-chen/reviews')));
  });

  it('not even as an admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(getDoc(doc(asReviewer(), 'proposals/p-chen/reviews', OTHER_REVIEWER)));
  });

  it('reviews everyone else’s proposals as normal', async () => {
    await assertSucceeds(
      setDoc(doc(asReviewer(), 'proposals/p-bruno/reviews', REVIEWER), {
        score: 3,
        conflictOfInterest: false,
      }),
    );
  });

  it('can still submit a talk like anyone else', async () => {
    await assertSucceeds(addDoc(collection(asReviewer(), 'proposals'), draft(REVIEWER)));
  });
});

describe('role grants are readable only by admins', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'roleGrants', 'new@example.org'), {
        email: 'new@example.org',
        role: 'reviewer',
        createdBy: 'someone',
      });
    });
  });

  it('denies an applicant', async () => {
    await assertFails(getDocs(collection(asApplicant(), 'roleGrants')));
  });

  it('denies a plain reviewer — these are email addresses', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'roleGrants')));
  });

  it('allows an admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertSucceeds(getDocs(collection(asReviewer(), 'roleGrants')));
  });

  it('denies even an admin writing one directly', async () => {
    // Grants are minted by the callables, which validate the email and role.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(
      setDoc(doc(asReviewer(), 'roleGrants', 'x@example.org'), {
        email: 'x@example.org',
        role: 'admin',
      }),
    );
  });
});

describe('emailLog is closed to clients', () => {
  it('denies reads', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'emailLog')));
  });
});
