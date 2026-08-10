import { describe, expect, it } from 'vitest';

import { scheduleIcs } from '@shared/calendar';
import type { PublishedSchedule, PublishedScheduleEntry } from '@shared/schedule';

const schedule: PublishedSchedule = {
  id: 'release-one',
  version: 2,
  timeZone: 'America/Toronto',
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
  rooms: [{ id: 'blue', name: { en: 'Blue, Room', fr: 'Salle bleue' } }],
  publishedAt: 0,
};

const entry: PublishedScheduleEntry = {
  id: 'talk-one',
  kind: 'proposal',
  proposalId: 'proposal-one',
  date: '2026-11-14',
  startsAt: '09:15',
  durationMinutes: 40,
  roomId: 'blue',
  session: {
    proposalId: 'proposal-one',
    title: 'Shipping; safely',
    abstract: 'Line one\nLine two',
    category: 'web',
    format: 'session_40',
    level: 'advanced',
    language: 'fr',
    speakers: [],
  },
};

describe('schedule calendar export', () => {
  it('uses local event times, stable ids, sequence numbers, and escaped content', () => {
    const ics = scheduleIcs(
      'devfest-mtl-2026',
      'DevFest Montréal 2026',
      schedule,
      [entry],
      'en',
      'https://cfp.example.org',
      new Date('2026-08-08T12:00:00Z'),
    );
    expect(ics).toContain('DTSTART;TZID=America/Toronto:20261114T091500');
    expect(ics).toContain('DTEND;TZID=America/Toronto:20261114T095500');
    expect(ics).toContain('UID:devfest-mtl-2026-talk-one@cfp.gdgmontreal.com');
    expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('SUMMARY:Shipping\\; safely');
    expect(ics).toContain('LOCATION:Blue\\, Room');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('marks a cancelled published session', () => {
    const ics = scheduleIcs('event', 'Event', schedule, [{ ...entry, cancelled: true }], 'en', 'https://x');
    expect(ics).toContain('STATUS:CANCELLED');
  });
});
