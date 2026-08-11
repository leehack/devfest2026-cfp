import { describe, expect, it } from 'vitest';

import {
  newlyScheduledSpeakerIds,
  placementNotificationChanged,
  previousReleaseSpeakerIds,
} from '../functions/src/scheduleNotifications';

const entry = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-14',
  startsAt: '10:00',
  durationMinutes: 40,
  roomId: 'main',
  session: {
    title: 'Reliable releases',
    language: 'en',
    speakers: [{ name: 'Old name', bio: 'Old bio', photoRef: 'old-photo' }],
  },
  ...over,
});

describe('schedule speaker notification classification', () => {
  it('does not call public speaker metadata or photo changes a placement change', () => {
    const current = entry({
      session: {
        title: 'Reliable releases',
        language: 'en',
        speakers: [
          { name: 'New name', bio: 'New bio', company: 'New company', photoRef: 'new-photo' },
        ],
      },
    });

    expect(
      placementNotificationChanged(entry(), current, { en: 'Main room' }, { en: 'Main room' }, false),
    ).toBe(false);
  });

  it('still reports actual placement and non-speaker session changes', () => {
    expect(
      placementNotificationChanged(
        entry(),
        entry({ startsAt: '11:00' }),
        { en: 'Main room' },
        { en: 'Main room' },
        false,
      ),
    ).toBe(true);
    expect(
      placementNotificationChanged(
        entry(),
        entry({
          session: {
            title: 'Reliable releases',
            language: 'fr',
            speakers: [{ name: 'Old name', bio: 'Old bio' }],
          },
        }),
        { en: 'Main room' },
        { en: 'Main room' },
        false,
      ),
    ).toBe(true);
  });

  it('finds a late speaker from the immutable roster and supports legacy baselines', () => {
    expect(
      previousReleaseSpeakerIds(
        true,
        { talk: ['lead', 'guest'] },
        'talk',
        ['wrong-fallback'],
      ),
    ).toEqual(['lead', 'guest']);
    expect(previousReleaseSpeakerIds(true, {}, 'talk', ['lead', 'guest'])).toEqual([
      'lead',
      'guest',
    ]);
    expect(previousReleaseSpeakerIds(false, {}, 'talk', ['lead', 'guest'])).toEqual([]);
    expect(newlyScheduledSpeakerIds(['lead', 'guest', 'late'], ['lead', 'guest'])).toEqual([
      'late',
    ]);
  });
});
