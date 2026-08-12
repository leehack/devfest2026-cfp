import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { ConfirmField } from '@shared/confirmForm';

import {
  REVIEWER_PROPOSAL_FIELDS,
  reviewerProposalProjection,
} from '../functions/src/reviewerProjection';

describe('reviewer proposal projection', () => {
  const submissionFields: ConfirmField[] = [
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
      privateTravelNote: 'Never expose this applicant note',
    },
    attendance: { status: 'pending', needsVisa: true },
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
      ['id', ...REVIEWER_PROPOSAL_FIELDS].sort(),
    );
    expect(projected).not.toHaveProperty('aggregate');
    expect(projected).not.toHaveProperty('attendance');
    expect(projected).not.toHaveProperty('speakerIds');
    expect(projected).not.toHaveProperty('formerSpeakerIds');
    expect(projected).not.toHaveProperty('confirmAnswers');
    expect(projected).not.toHaveProperty('headshotUploads');
    expect(projected).not.toHaveProperty('speakerPhoto');
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
});
