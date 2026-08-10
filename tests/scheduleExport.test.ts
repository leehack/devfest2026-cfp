import { describe, expect, it } from 'vitest';

import type { ProposalRow } from '../src/lib/roles';
import { scheduleCsv } from '../src/screens/admin/scheduleExport';
import type { ScheduleConfig, ScheduleEntry } from '@shared/schedule';

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
  format: 'session_40',
  deliveryLanguage: 'en',
  speakerSnapshot: [{ uid: 'speaker-one', name: 'Ada, Lovelace', bio: '' }],
} as ProposalRow;

describe('schedule CSV export', () => {
  it('quotes delimiters and neutralizes spreadsheet formulas', () => {
    const csv = scheduleCsv(config, [entry], new Map([[proposal.id, proposal]]), 'en');
    expect(csv).toContain('"Main, Hall"');
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"Ada, Lovelace"');
  });
});
