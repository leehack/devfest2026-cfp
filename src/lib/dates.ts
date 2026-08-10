/**
 * A Firestore Timestamp, an ISO string, or anything else that names a moment.
 * Returns null rather than an Invalid Date, so callers cannot render one.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value === null || value === undefined || value === '') return null;
  /*
   * Epoch millis, which is how a Timestamp survives being handed from the server
   * to the browser — a Timestamp itself does not serialise. Before the branch
   * existed this fell through to `new Date(String(value))`, where a number is
   * either an Invalid Date or, worse, read as a year.
   */
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  const at = new Date(String(value));
  return Number.isNaN(at.valueOf()) ? null : at;
}

/**
 * Formats an instant for a `datetime-local` input, which has no timezone and
 * means local wall-clock — which is also how an admin reads a deadline. The
 * shift is what makes the round trip through `new Date(value)` land back on the
 * same instant; `toISOString().slice(0, 16)` would silently move the deadline by
 * the UTC offset.
 */
export function toDateTimeInput(date: Date | null): string {
  if (!date) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const wallClock = (date: Date, timeZone: string): WallClockParts | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const result = {
      year: value('year'),
      month: value('month'),
      day: value('day'),
      hour: value('hour'),
      minute: value('minute'),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
};

const wallClockValue = ({ year, month, day, hour, minute }: WallClockParts): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Shows an instant as wall-clock time in the event's authoritative IANA zone. */
export function toZonedDateTimeInput(date: Date | null, timeZone: string): string {
  if (!date || Number.isNaN(date.valueOf())) return '';
  const parts = wallClock(date, timeZone);
  return parts ? wallClockValue(parts) : '';
}

/**
 * Turns a timezone-free `datetime-local` value into an instant in the event's
 * IANA zone. Iterating handles ordinary offset changes; the final comparison
 * refuses nonexistent wall-clock times in a daylight-saving jump.
 */
export function zonedDateTimeToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const target: WallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (
    target.month < 1 ||
    target.month > 12 ||
    target.day < 1 ||
    target.day > 31 ||
    target.hour > 23 ||
    target.minute > 59
  ) {
    return null;
  }

  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  let instant = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = wallClock(new Date(instant), timeZone);
    if (!shown) return null;
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
    );
    const correction = targetAsUtc - shownAsUtc;
    if (correction === 0) break;
    instant += correction;
  }

  const result = new Date(instant);
  const shown = wallClock(result, timeZone);
  return shown && wallClockValue(shown) === value ? result.toISOString() : null;
}

/**
 * Moves a wall-clock value by whole calendar days in its IANA zone. This is
 * intentionally not elapsed-hour arithmetic: seven days across a DST boundary
 * still closes at the same local time on the seventh date.
 */
export function addZonedCalendarDays(
  value: string,
  timeZone: string,
  days: number,
): string | null {
  if (!Number.isInteger(days) || !zonedDateTimeToIso(value, timeZone)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const shifted = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + days,
      Number(match[4]),
      Number(match[5]),
    ),
  );
  if (Number.isNaN(shifted.valueOf())) return null;
  const result = wallClockValue({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  });
  return zonedDateTimeToIso(result, timeZone) ? result : null;
}
