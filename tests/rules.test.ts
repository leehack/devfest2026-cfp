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

/** Moves a seeded draft into the committee's hands. */
async function submitted(id: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'proposals', id), { status: 'submitted' });
  });
}

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

  /**
   * Naming a co-presenter is a claim about someone else: it hands them write
   * access, and disqualifies them from reviewing the talk. Until there is an
   * invitation flow, the cast is fixed at creation.
   */
  it('denies naming a co-presenter who never agreed', async () => {
    await assertFails(
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), {
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('denies creating a proposal with someone else already on it', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), 'proposals'), {
        ...draft(APPLICANT),
        speakerIds: [APPLICANT, OTHER_APPLICANT],
      }),
    );
  });

  it('denies putting a proposal in someone else’s name entirely', async () => {
    await assertFails(
      addDoc(collection(asApplicant(), 'proposals'), draft(OTHER_APPLICANT)),
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

/**
 * A speaker keeps editing after submitting, until the committee starts reading.
 * After that only the travel answers move, because they carry no weight in the
 * score and change for reasons that have nothing to do with the talk.
 */
describe('editing after submission', () => {
  const setStatus = (status: string) =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'proposals/p-anna'), { status });
    });

  const editContent = () => updateDoc(doc(asApplicant(), 'proposals/p-anna'), { title: 'Reworked' });
  const editTravel = () =>
    updateDoc(doc(asApplicant(), 'proposals/p-anna'), {
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
      updateDoc(doc(asApplicant(), 'proposals/p-anna'), {
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
    await assertFails(updateDoc(doc(asApplicant(), 'proposals/p-anna'), { status: 'accepted' }));
  });

  // `confirmed` and `declined` are the speaker's own answer, which makes them
  // the two they are likeliest to try writing directly. They still go through
  // `respondToDecision`, because the precondition is "only from accepted" and
  // nothing here would stop a speaker confirming a rejection.
  it('denies answering an acceptance by writing the status', async () => {
    await setStatus('accepted');
    for (const status of ['confirmed', 'declined']) {
      await assertFails(updateDoc(doc(asApplicant(), 'proposals/p-anna'), { status }));
    }
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
  // Scoring a draft is denied outright, so every refusal below would otherwise
  // pass for that reason rather than the one it is written to prove.
  beforeEach(() => submitted('p-anna'));

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
      await setDoc(doc(db, 'proposals', 'p-chen'), {
        ...draft(REVIEWER),
        status: 'submitted',
      });
      await setDoc(doc(db, 'proposals/p-chen/reviews', OTHER_REVIEWER), {
        score: 4,
        conflictOfInterest: false,
      });
    });
    // Same reason as above: these must fail for self-review, not for draft.
    await submitted('p-bruno');
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

/** What the admin and review screens read before they can render anything. */
/**
 * A draft was never handed to anybody. Someone may have typed something into a
 * pitch and thought better of sending it; the committee has no claim on that.
 */
describe('unsubmitted drafts are private to their author', () => {
  it('denies a reviewer reading a draft', async () => {
    await assertFails(getDoc(doc(asReviewer(), 'proposals/p-anna')));
  });

  it('denies a reviewer listing the collection unfiltered', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'proposals')));
  });

  it('allows the filtered listing the committee screens actually use', async () => {
    await assertSucceeds(
      getDocs(query(collection(asReviewer(), 'proposals'), where('status', '!=', 'draft'))),
    );
  });

  it('lets the author still read their own draft', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), 'proposals/p-anna')));
  });

  it('opens it to reviewers the moment it is submitted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'proposals/p-anna'), { status: 'submitted' });
    });
    await assertSucceeds(getDoc(doc(asReviewer(), 'proposals/p-anna')));
  });

  it('denies scoring a draft or a withdrawn proposal', async () => {
    // Otherwise the review would count towards an aggregate for something
    // nobody submitted.
    for (const status of ['draft', 'withdrawn']) {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), 'proposals/p-bruno'), { status });
      });
      await assertFails(
        setDoc(doc(asReviewer(), 'proposals/p-bruno/reviews', REVIEWER), {
          score: 3,
          conflictOfInterest: false,
        }),
      );
    }
  });

  it('allows scoring once it is submitted', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'proposals/p-bruno'), { status: 'submitted' });
    });
    await assertSucceeds(
      setDoc(doc(asReviewer(), 'proposals/p-bruno/reviews', REVIEWER), {
        score: 3,
        conflictOfInterest: false,
      }),
    );
  });
});

describe('the reviewers collection', () => {
  const makeAdmin = () =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });

  it('lets anyone read their own row, so a speaker can find they have no role', async () => {
    await assertSucceeds(getDoc(doc(asApplicant(), 'reviewers', APPLICANT)));
  });

  it('denies an applicant reading someone else’s row', async () => {
    await assertFails(getDoc(doc(asApplicant(), 'reviewers', REVIEWER)));
  });

  it('denies an applicant listing the committee', async () => {
    await assertFails(getDocs(collection(asApplicant(), 'reviewers')));
  });

  it('denies a plain reviewer listing the committee', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'reviewers')));
  });

  it('allows an admin to list the committee', async () => {
    await makeAdmin();
    await assertSucceeds(getDocs(collection(asReviewer(), 'reviewers')));
  });
});

/** The review queue and the admin proposals table are both unscoped listings. */
describe('reviewers read every proposal and speaker', () => {
  it('lists every submitted proposal', async () => {
    await submitted('p-anna');
    await submitted('p-bruno');
    const snap = await getDocs(
      query(collection(asReviewer(), 'proposals'), where('status', '!=', 'draft')),
    );
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['p-anna', 'p-bruno']);
  });

  it('reads a speaker profile for the review card', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'speakers', APPLICANT), {
        name: 'Anna',
        email: 'anna@example.org',
        bio: 'x'.repeat(60),
      });
    });
    await assertSucceeds(getDoc(doc(asReviewer(), 'speakers', APPLICANT)));
  });

  it('denies an applicant reading another speaker’s profile', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'speakers', OTHER_APPLICANT), {
        name: 'Bruno',
        email: 'bruno@example.org',
        bio: 'x'.repeat(60),
      });
    });
    await assertFails(getDoc(doc(asApplicant(), 'speakers', OTHER_APPLICANT)));
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

describe('config', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'config/email'), {
        from: 'DevFest <cfp@example.org>',
        replyTo: 'organisers@example.org',
      });
    });
  });

  it('lets a signed-out visitor read the window', async () => {
    // The landing page renders the deadline before asking anyone to sign in.
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/cfp')));
  });

  it('does not expose the rest of the collection', async () => {
    // The read rule names `cfp` rather than the collection, so a document added
    // later is shut by default instead of public by default.
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/email')));
    await assertFails(getDoc(doc(asApplicant(), 'config/email')));
    await assertFails(getDocs(collection(asApplicant(), 'config')));
  });

  it('denies an admin reading it directly — that goes through the callable', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
        name: 'Chen',
        email: 'chen@example.org',
        role: 'admin',
      });
    });
    await assertFails(getDoc(doc(asReviewer(), 'config/email')));
  });

  it('denies writing the window or the sender', async () => {
    // Both are read by the rules themselves or by the sender; a client write
    // here would reopen a closed CFP or redirect the mail.
    await assertFails(updateDoc(doc(asApplicant(), 'config/cfp'), { paused: false }));
    await assertFails(setDoc(doc(asApplicant(), 'config/email'), { from: 'me@evil.example' }));
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
      await setDoc(doc(ctx.firestore(), 'reviewers', REVIEWER), {
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
      await setDoc(doc(ctx.firestore(), 'emailLog', 'accepted__p1'), row);
    });
  });

  it('denies reads', async () => {
    await assertFails(getDocs(collection(asReviewer(), 'emailLog')));
  });

  it('denies an applicant reading their own decision early', async () => {
    await assertFails(getDoc(doc(asApplicant(), 'emailLog', 'accepted__p1')));
  });

  it('denies an admin too — the queue is read through the callable', async () => {
    await makeAdmin();
    await assertFails(getDocs(collection(asReviewer(), 'emailLog')));
  });

  it('denies writing a row, which would be a send', async () => {
    // A client that could write `queued` could mail anyone from our domain.
    await assertFails(setDoc(doc(asApplicant(), 'emailLog', 'accepted__p2'), row));
  });

  it('denies releasing a held row', async () => {
    await makeAdmin();
    await assertFails(
      updateDoc(doc(asReviewer(), 'emailLog', 'accepted__p1'), { status: 'queued' }),
    );
  });

  it('denies deleting the audit trail', async () => {
    await makeAdmin();
    await assertFails(deleteDoc(doc(asReviewer(), 'emailLog', 'accepted__p1')));
  });
});
