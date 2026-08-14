import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  DEFAULT_SUBMISSION_FORM,
  type SubmissionField,
  type SubmissionForm,
} from '@shared/submissionForm';

import {
  REVIEWER_PROPOSAL_FIELDS,
  reviewerProposalProjection,
  reviewerTravelParticipantIds,
} from '../functions/src/reviewerProjection';

describe('reviewer proposal projection', () => {
  const submissionForm = (): SubmissionForm =>
    JSON.parse(JSON.stringify(DEFAULT_SUBMISSION_FORM));
  const submissionFields: SubmissionField[] = [
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
      key: 'sourceAvailable',
      type: 'checkbox',
      required: false,
      label: { en: 'Source available', fr: 'Code source disponible' },
    },
    {
      key: 'organiserOnly',
      type: 'textarea',
      required: false,
      reviewerVisible: false,
      label: { en: 'Organiser-only context' },
    },
  ];

  const proposal = {
    cfpId: 'event',
    speakerIds: ['speaker'],
    formerSpeakerIds: ['former'],
    speakerSnapshot: [
      {
        uid: 'speaker',
        name: 'Speaker',
        bio: 'Public bio',
        basedIn: 'Montréal',
        socials: [{ platform: 'linkedin', handle: 'speaker', email: 'nested@example.org' }],
        isGde: false,
        email: 'private@example.org',
        dietaryNeeds: 'Private dietary need',
      },
    ],
    title: 'Safe title',
    abstract: 'Safe abstract',
    pitch: 'Safe pitch',
    category: 'app_dev',
    format: 'session_40',
    level: 'intermediate',
    deliveryLanguage: 'en',
    languagePreference: 'fr',
    status: 'submitted',
    submittedAt: Timestamp.fromMillis(1_786_464_000_123),
    updatedAt: 11,
    aggregate: {
      avgScore: 3,
      normalizedScore: 0.5,
      reviewCount: 2,
      stdDev: 1,
      reviewerEmails: ['private@example.org'],
    },
    acks: { recording: true },
    answers: {
      reviewerContext: '  The live coding is the core of the session.  ',
      demoMode: 'live',
      sourceAvailable: true,
      organiserOnly: 'The committee must not receive this answer',
      privateTravelNote: 'Never expose this applicant note',
    },
    attendance: {
      status: 'pending',
      fundingSource: 'Community grant',
      decisionBy: '2026-09-15',
      needsVisa: true,
      privateNote: 'Never expose this travel note',
    },
    confirmAnswers: { dietaryNeeds: 'Severe allergy' },
    headshotUploads: { portrait: { path: 'private-working-path' } },
    speakerPhoto: { path: 'private-confirmed-path' },
    confirmDeadline: 12,
    lateSpeakerPendingInvitations: [{ uid: 'late', invitationId: 'secret' }],
  };

  it('uses one explicit field allowlist and strips nested private speaker data', () => {
    const projected = reviewerProposalProjection(
      'proposal-one',
      proposal,
      false,
      submissionFields,
    );

    expect(Object.keys(projected).sort()).toEqual(
      ['id', ...REVIEWER_PROPOSAL_FIELDS, 'speakerTravel'].sort(),
    );
    expect(projected).not.toHaveProperty('aggregate');
    expect(projected).not.toHaveProperty('speakerIds');
    expect(projected).not.toHaveProperty('formerSpeakerIds');
    expect(projected).not.toHaveProperty('attendance');
    expect(projected).not.toHaveProperty('confirmAnswers');
    expect(projected).not.toHaveProperty('headshotUploads');
    expect(projected).not.toHaveProperty('speakerPhoto');
    expect(projected.speakerTravel).toEqual([
      {
        uid: 'speaker',
        name: 'Speaker',
        status: 'pending',
        fundingSource: 'Community grant',
        decisionBy: '2026-09-15',
        needsVisa: true,
      },
    ]);
    expect(projected.answers).toEqual({
      reviewerContext: 'The live coding is the core of the session.',
      demoMode: 'live',
      sourceAvailable: true,
    });
    expect(projected.submittedAt).toBe(1_786_464_000_123);
    expect(typeof projected.submittedAt).toBe('number');
    expect(projected.speakerSnapshot).toEqual([
      {
        uid: 'speaker',
        name: 'Speaker',
        bio: 'Public bio',
        basedIn: 'Montréal',
        socials: [{ platform: 'linkedin', handle: 'speaker' }],
        isGde: false,
      },
    ]);
    expect(JSON.stringify(projected)).not.toContain('private@example.org');
    expect(JSON.stringify(projected)).not.toContain('Private dietary need');
    expect(JSON.stringify(projected)).not.toContain('Never expose this applicant note');
    expect(JSON.stringify(projected)).not.toContain('The committee must not receive this answer');
    expect(JSON.stringify(projected)).not.toContain('Never expose this travel note');
  });

  it('projects only validated active roster travel in current speaker order', () => {
    const roster = {
      ...proposal,
      speakerIds: ['lead', 'inactive', 'malformed', 'rejoined'],
      primarySpeakerId: 'lead',
      formerSpeakerIds: ['removed', 'rejoined'],
      speakerSnapshot: [
        { ...proposal.speakerSnapshot[0], uid: 'rejoined', name: 'Rejoined Speaker' },
        { ...proposal.speakerSnapshot[0], uid: 'lead', name: 'Lead Speaker' },
        { ...proposal.speakerSnapshot[0], uid: 'inactive', name: 'Inactive Speaker' },
        { ...proposal.speakerSnapshot[0], uid: 'malformed', name: 'Malformed Speaker' },
      ],
      // Roster-mode proposals must never fall back to this legacy root value.
      attendance: { status: 'local', needsVisa: false },
    };
    const participants = new Map([
      [
        'lead',
        {
          status: 'active',
          attendance: {
            status: 'secured',
            fundingSource: 'Employer',
            needsVisa: false,
            email: 'private@example.org',
            dietaryNeeds: 'Private dietary need',
          },
        },
      ],
      [
        'inactive',
        { status: 'inactive', attendance: { status: 'local', needsVisa: false } },
      ],
      [
        'malformed',
        {
          status: 'active',
          attendance: { status: 'pending', fundingSource: 'Grant', needsVisa: true },
        },
      ],
      [
        'rejoined',
        {
          status: 'active',
          attendance: {
            status: 'pending',
            fundingSource: 'Community grant',
            decisionBy: '2026-10-01',
            needsVisa: true,
            confirmAnswers: { dietaryNeeds: 'Private' },
          },
        },
      ],
      [
        'removed',
        { status: 'active', attendance: { status: 'local', needsVisa: false } },
      ],
    ]);

    expect(reviewerTravelParticipantIds(roster)).toEqual([
      'lead',
      'inactive',
      'malformed',
      'rejoined',
    ]);
    const projected = reviewerProposalProjection(
      'proposal-roster',
      roster,
      false,
      submissionFields,
      participants,
    );
    expect(projected.speakerTravel).toEqual([
      {
        uid: 'lead',
        name: 'Lead Speaker',
        status: 'secured',
        fundingSource: 'Employer',
        needsVisa: false,
      },
      {
        uid: 'rejoined',
        name: 'Rejoined Speaker',
        status: 'pending',
        fundingSource: 'Community grant',
        decisionBy: '2026-10-01',
        needsVisa: true,
      },
    ]);
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('private@example.org');
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('Private dietary need');
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('confirmAnswers');
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('Inactive Speaker');
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('removed');
  });

  it('does not use the legacy root fallback after roster mode is initialized', () => {
    const projected = reviewerProposalProjection(
      'proposal-solo-roster',
      { ...proposal, primarySpeakerId: 'speaker' },
      false,
      submissionFields,
    );

    expect(projected).not.toHaveProperty('speakerTravel');
    expect(reviewerTravelParticipantIds({ ...proposal, primarySpeakerId: 'speaker' })).toEqual([
      'speaker',
    ]);
  });

  it('omits travel when the event disables the section', () => {
    const form = submissionForm();
    form.attendance.enabled = false;
    const projected = reviewerProposalProjection(
      'proposal-one',
      proposal,
      false,
      submissionFields,
      new Map(),
      form,
    );
    expect(projected).not.toHaveProperty('speakerTravel');
  });

  it('projects only the attendance properties enabled for reviewers', () => {
    const form = submissionForm();
    form.attendance.statusReviewerVisible = false;
    form.attendance.fundingSource.reviewerVisible = false;
    form.attendance.needsVisa.enabled = false;
    const projected = reviewerProposalProjection(
      'proposal-one',
      proposal,
      false,
      submissionFields,
      new Map(),
      form,
    );
    expect(projected.speakerTravel).toEqual([
      { uid: 'speaker', name: 'Speaker', decisionBy: '2026-09-15' },
    ]);
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('Community grant');
    expect(JSON.stringify(projected.speakerTravel)).not.toContain('needsVisa');
  });

  it('omits the travel row when every collected property is hidden from reviewers', () => {
    const form = submissionForm();
    form.attendance.statusReviewerVisible = false;
    form.attendance.fundingSource.reviewerVisible = false;
    form.attendance.decisionBy.reviewerVisible = false;
    form.attendance.needsVisa.reviewerVisible = false;
    const projected = reviewerProposalProjection(
      'proposal-one',
      proposal,
      false,
      submissionFields,
      new Map(),
      form,
    );
    expect(projected).not.toHaveProperty('speakerTravel');
  });

  it('drops stale, invalid and image-shaped answers instead of forwarding raw maps', () => {
    const projected = reviewerProposalProjection(
      'proposal-one',
      {
        ...proposal,
        answers: {
          reviewerContext: 'Still useful',
          demoMode: 'retired-option',
          portrait: 'cfps/event/confirmedHeadshots/proposal-one/private-photo',
          removedQuestion: 'Retired private answer',
        },
      },
      false,
      [
        ...submissionFields,
        {
          key: 'portrait',
          type: 'image',
          required: false,
          label: { en: 'Portrait' },
        },
      ],
    );

    expect(projected.answers).toEqual({ reviewerContext: 'Still useful' });
    expect(JSON.stringify(projected)).not.toContain('private-photo');
    expect(JSON.stringify(projected)).not.toContain('Retired private answer');
    expect(JSON.stringify(projected)).not.toContain('retired-option');
  });

  it('exposes only the numeric aggregate once the review round is visible', () => {
    expect(reviewerProposalProjection('proposal-one', proposal, true).aggregate).toEqual({
      avgScore: 3,
      normalizedScore: 0.5,
      reviewCount: 2,
      stdDev: 1,
    });
  });

  it('never forwards an invalid timestamp object into the callable payload', () => {
    expect(
      reviewerProposalProjection(
        'proposal-one',
        { ...proposal, submittedAt: { toMillis: () => Number.NaN } },
        false,
      ),
    ).not.toHaveProperty('submittedAt');
  });

  it('redacts speakerSnapshot and speakerTravel when blindReview is enabled', () => {
    const blind = reviewerProposalProjection(
      'proposal-one',
      proposal,
      false,
      submissionFields,
      new Map(),
      DEFAULT_SUBMISSION_FORM,
      true,
    );
    expect(blind.speakerSnapshot).toEqual([]);
    expect(blind.speakerTravel).toBeUndefined();
    expect(blind.title).toBe('Safe title');
    expect(blind.abstract).toBe('Safe abstract');
  });
});
