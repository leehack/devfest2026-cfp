/**
 * An event date is a calendar date, and must print as itself everywhere.
 *
 * This is a regression test for a bug that reached production twice, in opposite
 * directions, because the timezone that exposes it is never the one anybody
 * develops in. CI caught it only by running in UTC.
 *
 * So the assertions are written to be independent of the host timezone: they pin
 * the instant to UTC midnight and format in UTC, which is the invariant, rather
 * than checking a rendered string that happens to be right in Montréal.
 */

import { describe, expect, it } from 'vitest';

import { calendarDate } from '../shared/cfp';
import { formatCalendarDay } from '../src/i18n';

describe('calendarDate', () => {
  it('pins the stored day to UTC midnight', () => {
    // The invariant. Building the day in local time — the previous fix — gives
    // 05:00Z in Montréal and 23:00Z the day before in Berlin, and this fails on
    // both. Only UTC midnight passes wherever the test runs.
    expect(calendarDate('2026-11-14')?.toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });

  it('prints the day it was given, not one either side of it', () => {
    const day = calendarDate('2026-11-14')!;
    for (const locale of ['en', 'fr'] as const) {
      const printed = formatCalendarDay(day, locale);
      expect(printed, `${locale} lost the day`).toMatch(/14/);
      expect(printed, `${locale} drifted to a neighbouring day`).not.toMatch(/\b13\b|\b15\b/);
    }
  });

  it('is stable across the turn of a year, where an off-by-one also moves the year', () => {
    expect(calendarDate('2027-01-01')?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(formatCalendarDay(calendarDate('2027-01-01')!, 'en')).toMatch(/2027/);
  });

  it('refuses a date that would silently roll over', () => {
    // Date.UTC normalises rather than refusing: 2026-02-30 becomes 2 March. An
    // event date that quietly moves is worse than one that is rejected.
    expect(calendarDate('2026-02-30')).toBeNull();
    expect(calendarDate('2026-13-01')).toBeNull();
    expect(calendarDate('2026-11-31')).toBeNull();
  });

  it('refuses anything that is not a plain calendar date', () => {
    for (const bad of ['', '2026-11', '14/11/2026', '2026-11-14T00:00:00Z', 'not a date']) {
      expect(calendarDate(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('accepts a real date with surrounding whitespace, as the validator does', () => {
    expect(calendarDate(' 2026-11-14 ')?.toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });
});
