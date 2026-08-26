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
  seedSpeakerParticipant,
  setSubmissionFormDirect,
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
      hiddenOwnProposalCount: 0,
      proposals: [
        { id: 'admin-own', title: 'Admin’s private coverage' },
        { id: 'first-own', title: 'First reviewer’s talk' },
        { id: 'general', title: 'General talk' },
      ],
    });

    const byUid = new Map(
      coverage.reviewers.map((reviewer: { uid: string }) => [reviewer.uid, reviewer]),
    );
    expect(byUid.get(first.uid)).toMatchObject({
      eligibleCount: 2,
      scoredProposalIds: ['admin-own', 'general'],
      conflictProposalIds: [],
      missingProposalIds: [],
    });
    expect(byUid.get(second.uid)).toMatchObject({
      eligibleCount: 3,
      scoredProposalIds: ['first-own'],
      conflictProposalIds: ['general'],
      missingProposalIds: ['admin-own'],
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

  test('returns a complete review deck projection without legacy private speaker state', async () => {
    const [reviewer, speaker] = await Promise.all([
      createAccount(FIRST),
      createAccount(SPEAKER),
    ]);
    await seedMember(reviewer.uid, 'reviewer', undefined, FIRST.email);
    await setSubmissionFormDirect({
      fields: [
        {
          key: 'reviewerContext',
          type: 'textarea',
          required: false,
          label: { en: 'Reviewer context', fr: 'Contexte pour le comité' },
        },
        {
          key: 'demoMode',
          type: 'select',
          required: false,
          label: { en: 'Demo format', fr: 'Format de la démo' },
          options: [{ value: 'live', label: { en: 'Live demo', fr: 'Démo en direct' } }],
        },
        {
          key: 'organiserOnly',
          type: 'textarea',
          required: false,
          reviewerVisible: false,
          label: { en: 'Organiser-only context' },
        },
      ],
    });
    await Promise.all([
      seedProposal('projected', {
        speakerUid: speaker.uid,
        title: 'Projected proposal',
        status: 'submitted',
        submittedAt: 1_786_464_000_123,
        speaker: {
          name: 'Public Speaker',
          email: 'private-speaker@example.org',
          dietaryNeeds: 'Private dietary detail',
        },
        attendance: {
          status: 'pending',
          fundingSource: 'Employer request',
          decisionBy: '2026-10-01',
          needsVisa: true,
          privateArrivalInstructions: 'Private itinerary',
        },
        confirmAnswers: { dietaryNeeds: 'Severe allergy' },
        headshotUploads: { portrait: { path: 'private-working-photo' } },
        speakerPhoto: { path: 'private-confirmed-photo' },
        answers: {
          reviewerContext: '  The live coding is the core of the session.  ',
          demoMode: 'live',
          organiserOnly: 'The committee must not receive this answer',
          privateTravelNote: 'Never expose this applicant note',
        },
      }),
      seedProposal('reviewer-own', {
        speakerUid: reviewer.uid,
        title: 'Reviewer conflict',
        status: 'under_review',
      }),
      seedProposal('already-decided', {
        speakerUid: speaker.uid,
        title: 'Not in the active deck',
        status: 'accepted',
      }),
    ]);

    const queue = await callJson(reviewer.idToken, 'reviewQueue', {});
    expect(queue).toMatchObject({
      ok: true,
      own: 1,
      proposals: [
        expect.objectContaining({
          id: 'projected',
          title: 'Projected proposal',
          submittedAt: expect.any(Number),
          speakerSnapshot: [expect.objectContaining({ name: 'Public Speaker' })],
          answers: {
            reviewerContext: 'The live coding is the core of the session.',
            demoMode: 'live',
          },
          speakerTravel: [
            {
              uid: speaker.uid,
              name: 'Public Speaker',
              status: 'pending',
              fundingSource: 'Employer request',
              decisionBy: '2026-10-01',
              needsVisa: true,
            },
          ],
        }),
      ],
    });
    expect(queue.proposals.map((proposal: { id: string }) => proposal.id)).toEqual(['projected']);
    for (const field of [
      'acks',
      'attendance',
      'confirmAnswers',
      'headshotUploads',
      'speakerPhoto',
    ]) {
      expect(queue.proposals[0]).not.toHaveProperty(field);
    }
    for (const privateValue of [
      'private-speaker@example.org',
      'Private dietary detail',
      'Severe allergy',
      'private-working-photo',
      'private-confirmed-photo',
      'Never expose this applicant note',
      'The committee must not receive this answer',
      'Private itinerary',
    ]) {
      expect(JSON.stringify(queue)).not.toContain(privateValue);
    }

    expect(await callAs(speaker.idToken, 'reviewQueue', {})).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  test('projects only safe active-speaker travel for a roster proposal', async () => {
    const [reviewer, lead] = await Promise.all([
      createAccount(FIRST),
      createAccount(SPEAKER),
    ]);
    await seedMember(reviewer.uid, 'reviewer', undefined, FIRST.email);

    const coSpeakerUid = 'roster-co-speaker';
    const inactiveUid = 'roster-inactive-speaker';
    const formerUid = 'roster-former-speaker';
    await seedProposal('roster-travel', {
      speakerUid: lead.uid,
      title: 'Roster travel projection',
      status: 'submitted',
      speakerIds: [coSpeakerUid, inactiveUid, lead.uid],
      primarySpeakerId: lead.uid,
      formerSpeakerIds: [formerUid],
      speakerSnapshot: [
        {
          uid: lead.uid,
          name: 'Lead Speaker',
          bio: 'x'.repeat(120),
          basedIn: 'Montréal, QC',
          socials: [],
          isGde: false,
        },
        {
          uid: coSpeakerUid,
          name: 'Co-speaker',
          bio: 'y'.repeat(120),
          basedIn: 'Toronto, ON',
          socials: [],
          isGde: false,
        },
        {
          uid: inactiveUid,
          name: 'Inactive Speaker',
          bio: 'z'.repeat(120),
          basedIn: 'Ottawa, ON',
          socials: [],
          isGde: false,
        },
      ],
      attendance: {
        status: 'secured',
        fundingSource: 'Stale root funding',
        needsVisa: false,
      },
    });
    await Promise.all([
      seedSpeakerParticipant('roster-travel', coSpeakerUid, {
        role: 'coSpeaker',
        attendance: {
          status: 'pending',
          fundingSource: 'Community grant',
          decisionBy: '2026-10-01',
          needsVisa: true,
          privateArrivalInstructions: 'Co-speaker private itinerary',
        },
      }),
      seedSpeakerParticipant('roster-travel', inactiveUid, {
        role: 'coSpeaker',
        status: 'inactive',
        attendance: { status: 'local', needsVisa: false },
      }),
      seedSpeakerParticipant('roster-travel', lead.uid, {
        role: 'primary',
        attendance: {
          status: 'secured',
          fundingSource: 'Employer budget',
          needsVisa: false,
          dietaryNeeds: 'Lead private dietary detail',
        },
      }),
      seedSpeakerParticipant('roster-travel', formerUid, {
        role: 'coSpeaker',
        attendance: { status: 'local', needsVisa: false },
      }),
    ]);

    const queue = await callJson(reviewer.idToken, 'reviewQueue', {});
    expect(queue.proposals).toHaveLength(1);
    expect(queue.proposals[0]).toMatchObject({
      id: 'roster-travel',
      speakerTravel: [
        {
          uid: coSpeakerUid,
          name: 'Co-speaker',
          status: 'pending',
          fundingSource: 'Community grant',
          decisionBy: '2026-10-01',
          needsVisa: true,
        },
        {
          uid: lead.uid,
          name: 'Lead Speaker',
          status: 'secured',
          fundingSource: 'Employer budget',
          needsVisa: false,
        },
      ],
    });
    expect(queue.proposals[0]).not.toHaveProperty('attendance');
    for (const privateValue of [
      'Stale root funding',
      'Inactive Speaker',
      formerUid,
      'Co-speaker private itinerary',
      'Lead private dietary detail',
    ]) {
      expect(JSON.stringify(queue.proposals[0].speakerTravel)).not.toContain(privateValue);
    }
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
