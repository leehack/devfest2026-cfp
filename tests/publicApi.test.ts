import { describe, expect, it } from 'vitest';

import { scheduleIcs } from '@shared/calendar';
import {
  publicApiLanguage,
  publicApiSchedule,
  publicApiSpeakers,
  type PublicApiInput,
} from '@shared/publicApi';
import type { PublishedScheduleEntry } from '@shared/schedule';

const talk: PublishedScheduleEntry = {
  id: 'talk-one',
  kind: 'proposal',
  proposalId: 'proposal-one',
  date: '2026-11-14',
  startsAt: '10:00',
  durationMinutes: 40,
  roomId: 'amber',
  session: {
    proposalId: 'proposal-one',
    title: 'Shipping safely',
    abstract: 'An abstract.',
    category: 'web',
    categoryLabel: { en: 'Web', fr: 'Le web' },
    format: 'session_40',
    level: 'advanced',
    language: 'fr',
    speakers: [
      { name: 'Ada', bio: 'Bio', company: 'Acme', photoRef: 'a'.repeat(43) },
      { name: 'Grace', bio: 'Bio' },
    ],
  },
};

const lunch: PublishedScheduleEntry = {
  id: 'lunch',
  kind: 'custom',
  customType: 'meal',
  allRooms: true,
  title: { en: '', fr: 'Dîner' },
  date: '2026-11-14',
  startsAt: '10:00',
  durationMinutes: 60,
};

const input = (entries: PublishedScheduleEntry[], language: 'en' | 'fr' = 'en'): PublicApiInput => ({
  cfpId: 'event',
  eventName: 'Event',
  schedule: {
    id: 'release-one',
    version: 3,
    timeZone: 'America/Toronto',
    days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
    rooms: [
      { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
      { id: 'amber', name: { en: 'Amber room' } },
    ],
    publishedAt: Date.UTC(2026, 9, 1),
  },
  entries,
  language,
  origin: 'https://cfp.example.org',
});

describe('public programme API', () => {
  it('defaults to English for an unknown language', () => {
    expect(publicApiLanguage(null)).toBe('en');
    expect(publicApiLanguage('de')).toBe('en');
    expect(publicApiLanguage('fr')).toBe('fr');
  });

  it('resolves rooms, labels and links in the requested language', () => {
    const result = publicApiSchedule(input([talk, lunch], 'fr'));
    expect(result).toMatchObject({
      event: { id: 'event', name: 'Event', url: 'https://cfp.example.org/c/event/schedule' },
      language: 'fr',
      version: 3,
      publishedAt: '2026-10-01T00:00:00.000Z',
      timeZone: 'America/Toronto',
      rooms: [
        { id: 'blue', name: 'Salle bleue' },
        { id: 'amber', name: 'Amber room' },
      ],
    });
    expect(result.sessions.map((session) => session.id)).toEqual(['lunch', 'talk-one']);
    expect(result.sessions[1]).toMatchObject({
      type: 'talk',
      title: 'Shipping safely',
      endsAt: '10:40',
      allRooms: false,
      roomId: 'amber',
      room: 'Amber room',
      language: 'fr',
      category: { value: 'web', label: 'Le web' },
      format: { value: 'session_40', label: 'session_40' },
      cancelled: false,
      url: 'https://cfp.example.org/c/event/schedule/talk-one',
    });
  });

  it('returns an all-room item without a room and keeps a single-language title', () => {
    const [session] = publicApiSchedule(input([lunch])).sessions;
    expect(session).toMatchObject({
      type: 'meal',
      title: 'Dîner',
      allRooms: true,
      roomId: null,
      room: null,
      language: null,
      category: null,
      speakers: [],
    });
  });

  it('links a photo only where the release holds one', () => {
    expect(publicApiSpeakers(input([talk]))).toEqual([
      {
        id: 'talk-one-0',
        sessionId: 'talk-one',
        name: 'Ada',
        bio: 'Bio',
        company: 'Acme',
        jobTitle: null,
        photoUrl: `https://cfp.example.org/api/c/event/schedule/photos/release-one/talk-one/0`,
      },
      {
        id: 'talk-one-1',
        sessionId: 'talk-one',
        name: 'Grace',
        bio: 'Bio',
        company: null,
        jobTitle: null,
        photoUrl: null,
      },
    ]);
  });

  it('keeps a cancelled session listed but drops its speakers from the directory', () => {
    const cancelled = { ...talk, cancelled: true } as PublishedScheduleEntry;
    expect(publicApiSchedule(input([cancelled])).sessions[0]).toMatchObject({
      cancelled: true,
      speakers: [{ photoUrl: null }, { photoUrl: null }],
    });
    expect(publicApiSpeakers(input([cancelled]))).toEqual([]);
  });

  it('omits the calendar location for an all-room item without a host room', () => {
    const { cfpId, eventName, schedule, origin } = input([]);
    const ics = scheduleIcs(cfpId, eventName, schedule, [lunch], 'fr', origin);
    expect(ics).toContain('SUMMARY:Dîner');
    expect(ics).not.toMatch(/^LOCATION:/m);
    expect(scheduleIcs(cfpId, eventName, schedule, [{ ...lunch, roomId: 'blue' }], 'fr', origin))
      .toContain('LOCATION:Salle bleue');
  });
});
