import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readProposalById,
  reset,
  seedMember,
  seedProposal,
  seedReview,
  setProposalStatusDirect,
} from './backend';

const ADMIN = { sub: 'coverage-admin', email: 'admin@coverage.test', name: 'Ada Admin' };
const FIRST = { sub: 'coverage-first', email: 'first@coverage.test', name: 'First Reviewer' };
const SECOND = { sub: 'coverage-second', email: 'second@coverage.test', name: 'Second Reviewer' };
const SPEAKER = { sub: 'coverage-speaker', email: 'speaker@coverage.test', name: 'Sam Speaker' };

test.describe('review backend operations', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('reports missing, scored and conflicted work without exposing the admin’s own talk', async () => {
    const [admin, first, second, speaker] = await Promise.all([
      createAccount(ADMIN),
      createAccount(FIRST),
      createAccount(SECOND),
      createAccount(SPEAKER),
    ]);
    await Promise.all([
      seedMember(admin.uid, 'admin', undefined, ADMIN.email),
      seedMember(first.uid, 'reviewer', undefined, FIRST.email),
      seedMember(second.uid, 'reviewer', undefined, SECOND.email),
    ]);
    await Promise.all([
      seedProposal('general', {
        speakerUid: speaker.uid,
        title: 'General talk',
        status: 'under_review',
      }),
      seedProposal('first-own', {
        speakerUid: first.uid,
        title: 'First reviewer’s talk',
        status: 'submitted',
      }),
      seedProposal('admin-own', {
        speakerUid: admin.uid,
        title: 'Admin’s private coverage',
        status: 'submitted',
      }),
      seedProposal('decided', {
        speakerUid: speaker.uid,
        title: 'Already decided',
        status: 'accepted',
      }),
      seedProposal('withdrawn', {
        speakerUid: speaker.uid,
        title: 'Withdrawn',
        status: 'withdrawn',
      }),
    ]);
    await Promise.all([
      seedReview('general', first.uid, 3),
      seedReview('general', second.uid, 1, undefined, true),
      seedReview('first-own', second.uid, 4),
      // This row must not influence any metadata returned to its speaker/admin.
      seedReview('admin-own', first.uid, 2),
    ]);

    const coverage = await callJson(admin.idToken, 'reviewCoverage', {});
    expect(coverage).toMatchObject({
      ok: true,
      hiddenOwnProposalCount: 1,
      proposals: [
        { id: 'first-own', title: 'First reviewer’s talk' },
        { id: 'general', title: 'General talk' },
      ],
    });

    const byUid = new Map(
      coverage.reviewers.map((reviewer: { uid: string }) => [reviewer.uid, reviewer]),
    );
    expect(byUid.get(first.uid)).toMatchObject({
      eligibleCount: 1,
      scoredProposalIds: ['general'],
      conflictProposalIds: [],
      missingProposalIds: [],
    });
    expect(byUid.get(second.uid)).toMatchObject({
      eligibleCount: 2,
      scoredProposalIds: ['first-own'],
      conflictProposalIds: ['general'],
      missingProposalIds: [],
    });
    expect(byUid.get(admin.uid)).toMatchObject({
      eligibleCount: 2,
      scoredProposalIds: [],
      conflictProposalIds: [],
      missingProposalIds: ['first-own', 'general'],
    });

    expect(await callAs(first.idToken, 'reviewCoverage', {})).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  test('refreshes and removes derived aggregates as reviewability changes', async () => {
    const reviewer = await createAccount(FIRST);
    const speaker = await createAccount(SPEAKER);
    await Promise.all([
      seedProposal('one', { speakerUid: speaker.uid, title: 'One', status: 'submitted' }),
      seedProposal('two', { speakerUid: speaker.uid, title: 'Two', status: 'under_review' }),
    ]);

    await seedReview('one', reviewer.uid, 4);
    await expect
      .poll(async () => (await readProposalById('one'))?.aggregate)
      .toMatchObject({ avgScore: 4, reviewCount: 1 });

    await seedReview('two', reviewer.uid, 2);
    await expect
      .poll(async () => (await readProposalById('two'))?.aggregate)
      .toMatchObject({ avgScore: 2, reviewCount: 1 });

    await setProposalStatusDirect('one', 'withdrawn');
    await expect.poll(async () => (await readProposalById('one'))?.aggregate).toBeUndefined();

    await seedReview('two', reviewer.uid, 2, undefined, true);
    await expect.poll(async () => (await readProposalById('two'))?.aggregate).toBeUndefined();
  });

  test('a concurrent withdrawal or decision is never overwritten by the first review', async () => {
    const [admin, reviewer, speaker] = await Promise.all([
      createAccount(ADMIN),
      createAccount(FIRST),
      createAccount(SPEAKER),
    ]);
    await Promise.all([
      seedMember(admin.uid, 'admin', undefined, ADMIN.email),
      seedMember(reviewer.uid, 'reviewer', undefined, FIRST.email),
      seedProposal('withdraw-race', {
        speakerUid: speaker.uid,
        title: 'Withdrawal wins the race',
        status: 'submitted',
      }),
      seedProposal('decision-race', {
        speakerUid: speaker.uid,
        title: 'Decision wins the race',
        status: 'submitted',
      }),
    ]);

    const [withdrawReview, withdrawal] = await Promise.all([
      callAs(reviewer.idToken, 'saveReview', {
        proposalId: 'withdraw-race',
        score: 3,
        conflictOfInterest: false,
        comment: 'Concurrent review',
      }),
      callAs(speaker.idToken, 'withdrawProposal', { proposalId: 'withdraw-race' }),
    ]);
    expect(withdrawal.ok).toBe(true);
    expect(
      withdrawReview.ok || withdrawReview.code === 'FAILED_PRECONDITION',
    ).toBe(true);
    expect((await readProposalById('withdraw-race'))?.status).toBe('withdrawn');

    const [decisionReview, decision] = await Promise.all([
      callAs(reviewer.idToken, 'saveReview', {
        proposalId: 'decision-race',
        score: 4,
        conflictOfInterest: false,
        comment: 'Concurrent review',
      }),
      callAs(admin.idToken, 'setProposalStatus', {
        proposalId: 'decision-race',
        status: 'accepted',
      }),
    ]);
    expect(decision.ok).toBe(true);
    expect(decisionReview.ok || decisionReview.code === 'FAILED_PRECONDITION').toBe(true);
    expect((await readProposalById('decision-race'))?.status).toBe('accepted');
  });

  test('deletes only a pristine draft owned by the caller', async () => {
    const author = await createAccount(SPEAKER);
    const other = await createAccount(FIRST);
    await seedProposal('draft', {
      speakerUid: author.uid,
      title: 'Disposable draft',
      status: 'draft',
      includeSpeakerSnapshot: false,
    });

    expect(
      await callAs(author.idToken, 'withdrawProposal', { proposalId: 'draft' }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    expect(await callAs(other.idToken, 'deleteDraftProposal', { proposalId: 'draft' })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await callJson(author.idToken, 'deleteDraftProposal', { proposalId: 'draft' }),
    ).toMatchObject({ ok: true, proposalId: 'draft' });
    expect(await readProposalById('draft')).toBeNull();

    await seedProposal('historic', {
      speakerUid: author.uid,
      title: 'Historic draft',
      status: 'draft',
      includeSpeakerSnapshot: false,
      aggregate: { avgScore: 3, normalizedScore: 0, reviewCount: 1, stdDev: 0 },
    });
    expect(
      await callAs(author.idToken, 'deleteDraftProposal', { proposalId: 'historic' }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await seedMember(author.uid, 'admin', undefined, SPEAKER.email);
    await callJson(author.idToken, 'recomputeAggregates', {});
    await expect
      .poll(async () => (await readProposalById('historic'))?.aggregate)
      .toBeUndefined();
  });
});
