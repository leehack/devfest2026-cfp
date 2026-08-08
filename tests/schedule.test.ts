import { describe, expect, it } from 'vitest';

import {
  resolvedScheduleLanguage,
  scheduleEndTime,
  scheduleConflicts,
  suggestedDuration,
  validateScheduleConfig,
  validateScheduleEntry,
  type ScheduleConfig,
  type ScheduleEntry,
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
  it('accepts a multi-room event in an IANA timezone', () => {
    expect(validateScheduleConfig(config)).toBeNull();
    expect(validateScheduleEntry(entry('talk-one', 'blue', '09:00'), config)).toBeNull();
  });

  it('rejects invalid windows and entries outside the day', () => {
    expect(validateScheduleConfig({ ...config, timeZone: 'Montreal-ish' })).toBe('timeZone');
    expect(
      validateScheduleConfig({ ...config, days: [{ ...config.days[0], endsAt: '08:00' }] }),
    ).toBe('dayTime');
    expect(validateScheduleEntry(entry('talk-one', 'blue', '17:45'), config)).toBe(
      'entryDuration',
    );
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
});

describe('schedule conflicts', () => {
  it('allows adjacent sessions but catches room overlaps', () => {
    expect(scheduleConflicts([entry('one', 'blue', '09:00'), entry('two', 'blue', '09:40')])).toEqual(
      [],
    );
    expect(scheduleConflicts([entry('one', 'blue', '09:00'), entry('two', 'blue', '09:35')])).toEqual(
      [{ kind: 'room', entryIds: ['one', 'two'] }],
    );
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
});
