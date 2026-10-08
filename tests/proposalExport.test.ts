import { describe, expect, it } from 'vitest';

import { DEFAULT_SUBMISSION_FORM, type SubmissionForm } from '@shared/submissionForm';
import type { ConfirmField } from '@shared/confirmForm';
import { selectedSpeakersCsv } from '../src/screens/admin/proposalExport';
import type { ProposalRow } from '../src/lib/roles';

const shape: SubmissionForm = {
  ...DEFAULT_SUBMISSION_FORM,
  fields: [
    {
      key: 'repo',
      type: 'text',
      required: false,
      label: { en: 'Project link', fr: 'Lien du projet' },
    },
  ],
};

const confirmation: ConfirmField[] = [
  {
    key: 'shirt',
    type: 'select',
    required: true,
    label: { en: 'T-shirt size', fr: 'Taille de t-shirt' },
    options: [{ value: 'M', label: { en: 'Medium', fr: 'Moyen' } }],
  },
];

const row: ProposalRow = {
  id: 'talk-1',
  cfpId: 'someone-elses-conf',
  speakerIds: ['speaker-1'],
  speakerSnapshot: [
    {
      uid: 'speaker-1',
      name: 'Sam Speaker',
      bio: 'Builds useful things.\nShares what worked.',
      company: 'Example, Inc.',
      jobTitle: 'Staff Engineer',
      basedIn: 'Montréal, QC',
      socials: [{ platform: 'linkedin', handle: 'sam-speaker' }],
      isGde: true,
      pastTalks: 'https://example.org/previous-talk',
      sessionizeUrl: 'https://sessionize.com/sam',
    },
  ],
  title: 'Shipping, without surprises',
  abstract: 'An abstract with "quotes", and a comma.',
  pitch: 'A practical close.',
  category: 'web',
  format: 'session_40',
  level: 'advanced',
  deliveryLanguage: 'either',
  languagePreference: 'Prefer English',
  assignedLanguage: 'fr',
  acks: { coc: true },
  answers: {
    repo: 'https://example.org/project',
    retired_question: 'An answer to a removed question',
  },
  attendance: {
    status: 'pending',
    fundingSource: 'Employer',
    decisionBy: '2026-09-01',
    needsVisa: true,
  },
  status: 'confirmed',
  confirmAnswers: {
    shirt: 'M',
    retired_confirmation: 'Keep this too',
  },
  submittedAt: new Date('2026-07-01T12:00:00.000Z'),
  confirmedAt: { toDate: () => new Date('2026-07-03T12:00:00.000Z') },
  updatedAt: new Date('2026-07-03T12:00:00.000Z'),
  aggregate: {
    avgScore: 3.5,
    normalizedScore: 0.75,
    reviewCount: 4,
    stdDev: 0.5,
  },
};

describe('selected speaker CSV', () => {
  it('exports programme, speaker, travel, scoring, and current and historical answers', () => {
    const csv = selectedSpeakersCsv([row], shape, confirmation, 'fr', {
      'speaker-1': 'sam@example.org',
      'someone-else': 'other@example.org',
    });
    const [header] = csv.split('\r\n');

    expect(header).toContain('speaker_names,speaker_emails,');
    expect(csv).toContain(',Sam Speaker,sam@example.org,');
    expect(csv).not.toContain('other@example.org');
    expect(header).toContain('speaker_is_gde');
    expect(header).toContain('speaker_past_talks');
    expect(header).toContain('attendance_status');
    expect(header).toContain('average_score');
    expect(header).toContain('submission_repo');
    expect(header).toContain('submission_retired_question');
    expect(header).toContain('confirmation_shirt');
    expect(header).toContain('confirmation_retired_confirmation');

    expect(csv).toContain(',Avancé,');
    expect(csv).toContain('L’une ou l’autre — à vous de choisir');
    expect(csv).toContain(',fr,Français,');
    expect(csv).toContain(',Moyen,');
    expect(csv).toContain('"Shipping, without surprises"');
    expect(csv).toContain('"An abstract with ""quotes"", and a comma."');
    expect(csv).toContain('"Example, Inc."');
    expect(csv).toContain('https://example.org/previous-talk');
    expect(csv).toContain('An answer to a removed question');
    expect(csv).toContain('Keep this too');
    expect(csv).toContain('2026-07-01T12:00:00.000Z');
    expect(csv).toContain('2026-07-03T12:00:00.000Z');
  });

  it('keeps each address in its speaker’s position when one is missing', () => {
    const speakerIds = ['speaker-1', 'speaker-2', 'speaker-3'];
    const emails = { 'speaker-1': 'sam@example.org', 'speaker-3': 'third@example.org' };

    expect(selectedSpeakersCsv([{ ...row, speakerIds }], shape, confirmation, 'en', emails)).toContain(
      ',sam@example.org; ; third@example.org,',
    );
    expect(selectedSpeakersCsv([{ ...row, speakerIds }], shape, confirmation, 'en')).toContain(
      ',Sam Speaker,,',
    );
  });

  it('keeps a stable header-only file when there are no selected talks', () => {
    const csv = selectedSpeakersCsv([], shape, confirmation, 'en');

    expect(csv).toContain('proposal_id,status,title');
    expect(csv).toContain('submission_repo');
    expect(csv).toContain('confirmation_shirt');
    expect(csv).not.toContain('\r\n');
  });

  it.each(['=HYPERLINK("https://evil.example")', '+1+1', '-2+3', '@SUM(1,2)', '\t=1+1', '\r=1+1'])(
    'neutralizes a spreadsheet formula beginning with %j',
    (title) => {
      const csv = selectedSpeakersCsv([{ ...row, title }], shape, confirmation, 'en');
      const protectedCell = `'${title}`;
      const encodedCell = /[",\r\n\t]/.test(protectedCell)
        ? `"${protectedCell.replaceAll('"', '""')}"`
        : protectedCell;

      expect(csv).toContain(encodedCell);
    },
  );

  it('omits literal undefined for optional isGde and falls back to primary speaker participant attendance', () => {
    const rosterRow: ProposalRow = {
      ...row,
      primarySpeakerId: 'speaker-1',
      speakerIds: ['speaker-1', 'speaker-2'],
      speakerSnapshot: [
        {
          uid: 'speaker-2',
          name: 'Alex CoSpeaker',
          basedIn: 'Toronto, Canada',
          bio: 'Co-speaker bio.',
          socials: [],
          isGde: undefined as unknown as boolean,
        },
        {
          uid: 'speaker-1',
          name: 'Sam Speaker',
          basedIn: 'Montréal, Canada',
          bio: 'Lead speaker bio.',
          socials: [],
          isGde: true,
        },
      ],
      attendance: undefined,
      speakerParticipants: [
        {
          uid: 'speaker-1',
          role: 'primary',
          attendance: {
            status: 'pending',
            fundingSource: 'GDE Program',
            decisionBy: '2026-09-15',
            needsVisa: false,
          },
          acks: { coc: true },
        },
        {
          uid: 'speaker-2',
          role: 'coSpeaker',
          attendance: {
            status: 'secured',
          },
          acks: { coc: true },
        },
      ],
    };

    const csv = selectedSpeakersCsv([rosterRow], shape, confirmation, 'en');
    expect(csv).not.toContain('undefined');
    expect(csv).toContain('Sam Speaker: pending; Alex CoSpeaker: secured');
    expect(csv).toContain(',pending,GDE Program,2026-09-15,false,');
  });
});
