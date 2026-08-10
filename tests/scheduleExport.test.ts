import { describe, expect, it } from 'vitest';

import type { ProposalRow } from '../src/lib/roles';
import { scheduleCsv } from '../src/screens/admin/scheduleExport';
import type { ScheduleConfig, ScheduleEntry } from '@shared/schedule';
import { DEFAULT_SUBMISSION_FORM } from '@shared/submissionForm';

const config: ScheduleConfig = {
  timeZone: 'America/Toronto',
  revision: 1,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'main', name: { en: 'Main, Hall', fr: 'Salle principale' } }],
};

const entry: ScheduleEntry = {
  id: 'proposal-one',
  kind: 'proposal',
  proposalId: 'proposal-one',
  date: '2026-11-14',
  startsAt: '09:00',
  durationMinutes: 40,
  roomId: 'main',
};

const proposal = {
  id: 'proposal-one',
  status: 'confirmed',
  title: '=HYPERLINK("unsafe")',
  category: 'ai_ml',
  format: 'session_40',
  level: 'intermediate',
  deliveryLanguage: 'en',
  speakerSnapshot: [{ uid: 'speaker-one', name: 'Ada, Lovelace', bio: '' }],
} as ProposalRow;

describe('schedule CSV export', () => {
  const englishLanguageLabels = { en: 'English', fr: 'French', bilingual: 'Bilingual' };
  const frenchLanguageLabels = { en: 'Anglais', fr: 'Français', bilingual: 'Bilingue' };

  it('quotes delimiters and neutralizes spreadsheet formulas', () => {
    const csv = scheduleCsv(
      config,
      [entry],
      new Map([[proposal.id, proposal]]),
      'en',
      DEFAULT_SUBMISSION_FORM,
      englishLanguageLabels,
    );
    expect(csv).toContain('"Main, Hall"');
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"Ada, Lovelace"');
    expect(csv).toContain('category,category_label,format,format_label,level,level_label');
    expect(csv).toContain(
      'delivery_language,delivery_language_label,assigned_language,scheduled_language,scheduled_language_label',
    );
    expect(csv).toContain('ai_ml,AI & ML,session_40,Session — 40 minutes');
    expect(csv).toContain('intermediate,Intermediate,en,English,,en,English');
  });

  it('includes a custom item scheduled language', () => {
    const custom: ScheduleEntry = {
      id: 'community-lounge',
      kind: 'custom',
      customType: 'social',
      language: 'bilingual',
      title: { en: 'Community lounge', fr: 'Salon communautaire' },
      date: '2026-11-14',
      startsAt: '15:00',
      durationMinutes: 45,
      roomId: 'main',
      speakers: [{ name: 'Grace Hopper' }, { name: 'Jean Bartik' }],
    };

    const csv = scheduleCsv(config, [custom], new Map(), 'en', undefined, englishLanguageLabels);
    expect(csv).toContain(',bilingual,Bilingual,social');
    expect(csv).toContain('Grace Hopper; Jean Bartik');
  });

  it('uses stable scheduled-language labels even when the form omits that option', () => {
    const flexibleProposal = {
      ...proposal,
      deliveryLanguage: 'either',
    } as ProposalRow;
    const assigned: ScheduleEntry = {
      ...entry,
      assignedLanguage: 'fr',
    };
    const restrictedForm = {
      ...DEFAULT_SUBMISSION_FORM,
      deliveryLanguage: DEFAULT_SUBMISSION_FORM.deliveryLanguage.filter(
        (option) => option.value === 'either',
      ),
    };

    expect(
      scheduleCsv(
        config,
        [assigned],
        new Map([[proposal.id, flexibleProposal]]),
        'en',
        restrictedForm,
        englishLanguageLabels,
      ),
    ).toContain(',either,Either — you choose,fr,fr,French,');
    expect(
      scheduleCsv(
        config,
        [assigned],
        new Map([[proposal.id, flexibleProposal]]),
        'fr',
        restrictedForm,
        frenchLanguageLabels,
      ),
    ).toContain(',either,L’une ou l’autre — à vous de choisir,fr,fr,Français,');
  });
});
