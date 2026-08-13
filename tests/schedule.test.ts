import { describe, expect, it } from 'vitest';

import {
  SCHEDULE_LIMITS,
  publicScheduleSpeakers,
  nextScheduleRoomId,
  resolvedScheduleLanguage,
  scheduleDurationBounds,
  scheduleEndTime,
  scheduleProposalEligible,
  scheduleConflicts,
  scheduleRoomIdsInUse,
  scheduleTaxonomyLabel,
  sharedScheduleAudience,
  sharedScheduleEntriesFor,
  sharedScheduleForEntries,
  snapScheduleDuration,
  suggestedDuration,
  validateScheduleConfig,
  validateScheduleEntry,
  type ScheduleConfig,
  type ScheduleEntry,
  type PublishedScheduleEntry,
  type SharedSchedule,
} from '@shared/schedule';

const config: ScheduleConfig = {
  timeZone: 'America/Toronto',
  revision: 1,
  days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '18:00' }],
  rooms: [
    { id: 'blue', name: { en: 'Blue room', fr: 'Salle bleue' } },
    { id: 'green', name: { en: 'Green room' } },
  ],
};

const entry = (id: string, roomId: string, startsAt: string, proposalId = id): ScheduleEntry => ({
  id,
  kind: 'proposal',
  proposalId,
  date: '2026-11-14',
  startsAt,
  durationMinutes: 40,
  roomId,
});

describe('schedule validation', () => {
  it('separates schedule eligibility from the rest of the proposal lifecycle', () => {
    expect(scheduleProposalEligible('accepted')).toBe(true);
    expect(scheduleProposalEligible('confirmed')).toBe(true);
    expect(scheduleProposalEligible('under_review')).toBe(false);
    expect(scheduleProposalEligible('withdrawn')).toBe(false);
    expect(scheduleProposalEligible(undefined)).toBe(false);
  });

  it('accepts a multi-room event in an IANA timezone', () => {
    expect(validateScheduleConfig(config)).toBeNull();
    expect(validateScheduleEntry(entry('talk-one', 'blue', '09:00'), config)).toBeNull();
  });

  it('rejects proposal ids that cannot be one Firestore document segment', () => {
    expect(validateScheduleEntry(entry('talk-one', 'blue', '09:00', ''), config)).toBe(
      'entryId',
    );
    expect(
      validateScheduleEntry(
        entry('talk-one', 'blue', '09:00', 'talk/speakerConfirmations/person'),
        config,
      ),
    ).toBe('entryId');
    expect(
      validateScheduleEntry(entry('talk-one', 'blue', '09:00', '__reserved'), config),
    ).toBe('entryId');
  });

  it('rejects invalid windows and entries outside the day', () => {
    expect(validateScheduleConfig({ ...config, timeZone: 'Montreal-ish' })).toBe('timeZone');
    expect(
      validateScheduleConfig({ ...config, days: [{ ...config.days[0], endsAt: '08:00' }] }),
    ).toBe('dayTime');
    expect(
      validateScheduleConfig({
        ...config,
        days: [{ ...config.days[0], startsAt: '09:00', endsAt: '09:04' }],
      }),
    ).toBe('dayTime');
    expect(validateScheduleEntry(entry('talk-one', 'blue', '17:45'), config)).toBe(
      'entryDuration',
    );
    expect(
      validateScheduleEntry(
        { ...entry('talk-one', 'blue', '17:40'), durationMinutes: 20 },
        config,
      ),
    ).toBeNull();
    expect(
      validateScheduleEntry(
        { ...entry('talk-one', 'blue', '17:41'), durationMinutes: 20 },
        config,
      ),
    ).toBe('entryDuration');
  });

  it('requires a real room and localized content for custom items', () => {
    expect(validateScheduleEntry(entry('talk-one', 'missing', '09:00'), config)).toBe(
      'entryRoom',
    );
    expect(
      validateScheduleEntry(
        {
          id: 'lunch',
          kind: 'custom',
          customType: 'meal',
          title: { en: '' },
          date: '2026-11-14',
          startsAt: '12:00',
          durationMinutes: 60,
          roomId: 'blue',
        },
        config,
      ),
    ).toBe('entryTitle');
  });

  it('accepts an optional settled language for custom items', () => {
    const custom: ScheduleEntry = {
      id: 'opening',
      kind: 'custom',
      customType: 'opening',
      title: { en: 'Opening remarks', fr: "Mot d'ouverture" },
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 20,
      roomId: 'blue',
    };

    expect(validateScheduleEntry(custom, config)).toBeNull();
    expect(validateScheduleEntry({ ...custom, language: 'en' }, config)).toBeNull();
    expect(validateScheduleEntry({ ...custom, language: 'fr' }, config)).toBeNull();
    expect(validateScheduleEntry({ ...custom, language: 'bilingual' }, config)).toBeNull();
    expect(
      validateScheduleEntry({ ...custom, language: 'either' } as unknown as ScheduleEntry, config),
    ).toBe('entryLanguage');
  });

  it('validates optional attendee-facing speakers on custom items', () => {
    const custom: ScheduleEntry = {
      id: 'keynote',
      kind: 'custom',
      customType: 'keynote',
      title: { en: 'Opening keynote' },
      date: '2026-11-14',
      startsAt: '09:00',
      durationMinutes: 40,
      roomId: 'blue',
    };
    const speaker = {
      name: 'Grace Hopper',
      jobTitle: 'Rear admiral',
      company: 'United States Navy',
      bio: 'Computer scientist and compiler pioneer.',
    };

    expect(validateScheduleEntry({ ...custom, speakers: [speaker] }, config)).toBeNull();
    expect(validateScheduleEntry({ ...custom, speakers: [{ name: 'Host' }] }, config)).toBeNull();
    expect(
      validateScheduleEntry(
        { ...custom, speakers: [{ name: 'Host', photoAssetRef: 'a'.repeat(43) }] },
        config,
      ),
    ).toBeNull();
    expect(
      validateScheduleEntry(
        { ...custom, speakers: [{ name: 'Host', photoAssetRef: 'bucket/path' }] },
        config,
      ),
    ).toBe('entrySpeakers');
    expect(validateScheduleEntry({ ...custom, speakers: [{ name: '' }] }, config)).toBe(
      'entrySpeakers',
    );
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: [{ name: 'Host', bio: 42 }],
        } as unknown as ScheduleEntry,
        config,
      ),
    ).toBe('entrySpeakers');
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: Array.from({ length: SCHEDULE_LIMITS.customSpeakers + 1 }, (_, index) => ({
            name: `Speaker ${index + 1}`,
          })),
        },
        config,
      ),
    ).toBe('entrySpeakers');
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: [{ name: 'x'.repeat(SCHEDULE_LIMITS.speakerName + 1) }],
        },
        config,
      ),
    ).toBe('entrySpeakers');
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: [{ name: 'Host', bio: 'x'.repeat(SCHEDULE_LIMITS.speakerBio + 1) }],
        },
        config,
      ),
    ).toBe('entrySpeakers');
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: [
            { name: 'Host', company: 'x'.repeat(SCHEDULE_LIMITS.speakerCompany + 1) },
          ],
        },
        config,
      ),
    ).toBe('entrySpeakers');
    expect(
      validateScheduleEntry(
        {
          ...custom,
          speakers: [
            { name: 'Host', jobTitle: 'x'.repeat(SCHEDULE_LIMITS.speakerJobTitle + 1) },
          ],
        },
        config,
      ),
    ).toBe('entrySpeakers');
  });

  it('keeps room ids stable across reordering and refuses a removed room in use', () => {
    const placed = entry('talk-one', 'blue', '09:00');
    const reordered = { ...config, rooms: [...config.rooms].reverse() };
    expect(validateScheduleConfig(reordered)).toBeNull();
    expect(validateScheduleEntry(placed, reordered)).toBeNull();

    const withoutBlue = {
      ...config,
      rooms: config.rooms.filter((room) => room.id !== 'blue'),
    };
    expect(scheduleRoomIdsInUse([placed])).toEqual(new Set(['blue']));
    expect(validateScheduleEntry(placed, withoutBlue)).toBe('entryRoom');
  });

  it('generates a room id that cannot collide after a middle room is removed', () => {
    expect(nextScheduleRoomId([{ id: 'main' }, { id: 'room-2' }, { id: 'room-3' }])).toBe(
      'room-4',
    );
    expect(nextScheduleRoomId([{ id: 'main' }, { id: 'room-3' }])).toBe('room-2');
  });

  it('exposes five-minute resize bounds capped at the configured end of day', () => {
    expect(scheduleDurationBounds('2026-11-14', '17:42', config)).toEqual({
      min: 5,
      max: 18,
      step: 5,
    });
    expect(scheduleDurationBounds('2026-11-14', '17:58', config)).toBeNull();
    expect([15, 20, 45].map((duration) => snapScheduleDuration(duration))).toEqual([15, 20, 45]);
    expect(snapScheduleDuration(43)).toBe(45);
    expect(snapScheduleDuration(2)).toBe(5);
    expect(snapScheduleDuration(500)).toBe(480);
    expect(
      snapScheduleDuration(40, scheduleDurationBounds('2026-11-14', '17:42', config)!),
    ).toBe(18);
    expect(snapScheduleDuration(42, undefined, 42)).toBe(42);
    expect(snapScheduleDuration(47, undefined, 42)).toBe(47);
    expect(snapScheduleDuration(37, undefined, 42)).toBe(37);
  });

  it('keeps server compatibility for existing integer durations between bounds', () => {
    expect(
      validateScheduleEntry({ ...entry('talk-one', 'blue', '09:00'), durationMinutes: 42 }, config),
    ).toBeNull();
    expect(
      validateScheduleEntry({ ...entry('talk-one', 'blue', '09:00'), durationMinutes: 4 }, config),
    ).toBe('entryDuration');
    expect(
      validateScheduleEntry({ ...entry('talk-one', 'blue', '09:00'), durationMinutes: 481 }, config),
    ).toBe('entryDuration');
  });
});

describe('schedule conflicts', () => {
  it('allows adjacent sessions but catches room overlaps', () => {
    expect(scheduleConflicts([entry('one', 'blue', '09:00'), entry('two', 'blue', '09:40')])).toEqual(
      [],
    );
    expect(scheduleConflicts([entry('one', 'blue', '09:00'), entry('two', 'blue', '09:35')])).toEqual(
      [{ kind: 'room', entryIds: ['one', 'two'] }],
    );

    const first = { ...entry('first', 'green', '10:20'), durationMinutes: 15 };
    const second = { ...entry('second', 'green', '10:35'), durationMinutes: 20 };
    expect(scheduleConflicts([first, second])).toEqual([]);
    expect(scheduleConflicts([{ ...first, durationMinutes: 20 }, second])).toEqual([
      { kind: 'room', entryIds: ['first', 'second'] },
    ]);
  });

  it('catches duplicate proposals and speakers booked in different rooms', () => {
    const duplicate = scheduleConflicts([
      entry('first', 'blue', '09:00', 'same-talk'),
      entry('second', 'green', '11:00', 'same-talk'),
    ]);
    expect(duplicate).toEqual([{ kind: 'proposal', entryIds: ['first', 'second'] }]);

    const speakers = new Map([
      ['talk-one', ['speaker-a']],
      ['talk-two', ['speaker-a', 'speaker-b']],
    ]);
    expect(
      scheduleConflicts(
        [entry('talk-one', 'blue', '09:00'), entry('talk-two', 'green', '09:20')],
        speakers,
      ),
    ).toEqual([{ kind: 'speaker', entryIds: ['talk-one', 'talk-two'] }]);
  });
});

describe('schedule helpers', () => {
  it('calculates attendee-facing end times', () => {
    expect(scheduleEndTime({ startsAt: '10:20', durationMinutes: 15 })).toBe('10:35');
    expect(scheduleEndTime({ startsAt: '10:20', durationMinutes: 20 })).toBe('10:40');
    expect(scheduleEndTime({ startsAt: '10:20', durationMinutes: 45 })).toBe('11:05');
    expect(scheduleEndTime({ startsAt: '09:35', durationMinutes: 40 })).toBe('10:15');
    expect(scheduleEndTime({ startsAt: '23:10', durationMinutes: 30 })).toBe('23:40');
  });

  it('uses known format durations and a safe default', () => {
    expect(suggestedDuration('lightning_15')).toBe(15);
    expect(suggestedDuration('workshop_90')).toBe(90);
    expect(suggestedDuration('custom')).toBe(40);
  });

  it('requires flexible sessions to be resolved before publication', () => {
    expect(resolvedScheduleLanguage('either')).toBeNull();
    expect(resolvedScheduleLanguage('either', 'fr')).toBe('fr');
    expect(resolvedScheduleLanguage('bilingual')).toBe('bilingual');
  });

  it('freezes localized taxonomy labels and falls back to legacy codes', () => {
    const options = [
      { value: 'web', label: { en: '  Web platform  ', fr: '  Plateforme Web  ' } },
      { value: 'cloud', label: { en: 'Cloud' } },
    ];
    expect(scheduleTaxonomyLabel(options, 'web')).toEqual({
      en: 'Web platform',
      fr: 'Plateforme Web',
    });
    expect(scheduleTaxonomyLabel(options, 'cloud')).toEqual({ en: 'Cloud' });
    expect(scheduleTaxonomyLabel(options, 'legacy_category')).toEqual({
      en: 'legacy_category',
    });
  });
});

describe('shared schedule disclosure', () => {
  const proposal = (id: string, proposalId: string, cancelled = false): PublishedScheduleEntry => ({
    id,
    kind: 'proposal',
    proposalId,
    date: '2026-11-14',
    startsAt: '09:00',
    durationMinutes: 40,
    roomId: 'blue',
    ...(cancelled ? { cancelled: true } : {}),
    session: {
      proposalId,
      title: proposalId,
      abstract: 'Abstract',
      category: 'app_dev',
      format: 'session_40',
      level: 'intermediate',
      language: 'en',
      speakers: [],
    },
  });
  const custom: PublishedScheduleEntry = {
    id: 'lunch',
    kind: 'custom',
    customType: 'meal',
    title: { en: 'Lunch' },
    date: '2026-11-14',
    startsAt: '12:00',
    durationMinutes: 60,
    roomId: 'blue',
  };
  const confirmed = new Map<string, readonly string[]>([
    ['own-talk', ['speaker-one']],
    ['other-talk', ['speaker-two']],
    ['cancelled-talk', ['speaker-one']],
  ]);

  it('gives active event roles the confirmed agenda and public-safe custom items', () => {
    expect(sharedScheduleAudience('reviewer')).toBe('committee');
    expect(sharedScheduleAudience('admin')).toBe('committee');
    expect(sharedScheduleAudience('owner')).toBe('committee');
    expect(
      sharedScheduleEntriesFor(
        [proposal('own', 'own-talk'), proposal('other', 'other-talk'), custom],
        'committee',
        'reviewer',
        confirmed,
      ).map((item) => item.id),
    ).toEqual(['own', 'other', 'lunch']);
  });

  it('gives a speaker only their still-confirmed, non-cancelled placement', () => {
    expect(sharedScheduleAudience()).toBe('speaker');
    expect(
      sharedScheduleEntriesFor(
        [
          proposal('own', 'own-talk'),
          proposal('other', 'other-talk'),
          proposal('cancelled', 'cancelled-talk', true),
          proposal('stale', 'no-longer-confirmed'),
          custom,
        ],
        'speaker',
        'speaker-one',
        confirmed,
      ).map((item) => item.id),
    ).toEqual(['own']);
  });

  it('keeps only attendee-facing speaker details in an immutable release', () => {
    expect(
      publicScheduleSpeakers([
        {
          uid: 'speaker-one',
          name: 'Ada Speaker',
          bio: 'Builds reliable systems.',
          company: 'Example Co',
          jobTitle: 'Engineer',
          basedIn: 'Montréal',
          socials: [{ platform: 'linkedin', handle: 'ada' }],
          isGde: true,
          pastTalks: 'Private committee context',
          sessionizeUrl: 'https://sessionize.com/ada',
        },
      ]),
    ).toEqual([
      {
        name: 'Ada Speaker',
        bio: 'Builds reliable systems.',
        company: 'Example Co',
        jobTitle: 'Engineer',
      },
    ]);

    expect(
      publicScheduleSpeakers(
        [
          {
            uid: 'speaker-one',
            name: 'Ada Speaker',
            bio: 'Builds reliable systems.',
            basedIn: 'Montréal',
            socials: [],
            isGde: false,
          },
        ],
        new Map([['speaker-one', 'opaque-release-member']]),
      ),
    ).toEqual([
      {
        name: 'Ada Speaker',
        bio: 'Builds reliable systems.',
        photoRef: 'opaque-release-member',
      },
    ]);
  });

  it('returns only the days and rooms referenced by a speaker own entries', () => {
    const schedule: SharedSchedule = {
      id: 'shared-one',
      version: 1,
      timeZone: 'America/Toronto',
      sourceRevision: 4,
      sharedAt: 0,
      days: [
        { date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' },
        { date: '2026-11-15', startsAt: '09:00', endsAt: '17:00' },
      ],
      rooms: [
        { id: 'blue', name: { en: 'Blue room' } },
        { id: 'green', name: { en: 'Green room' } },
      ],
    };
    const own = proposal('own', 'own-talk');

    expect(sharedScheduleForEntries(schedule, [own])).toMatchObject({
      days: [{ date: '2026-11-14', startsAt: '09:00', endsAt: '17:00' }],
      rooms: [{ id: 'blue', name: { en: 'Blue room' } }],
    });
    expect(sharedScheduleForEntries(schedule, [])).toMatchObject({ days: [], rooms: [] });
  });
});
