import { localised } from './confirmForm';
import {
  scheduleEndTime,
  type PublishedSchedule,
  type PublishedScheduleEntry,
} from './schedule';

const escapeIcs = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

const fold = (line: string): string => {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    pieces.push(rest.slice(0, 73));
    rest = rest.slice(73);
  }
  pieces.push(rest);
  return pieces.join('\r\n ');
};

const compactDateTime = (date: string, time: string): string =>
  `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;

const MINUTE = 60_000;
const ZONE_SCAN_STEP = 6 * 60 * MINUTE;
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

const offsetMinutes = (timeZone: string, at: number): number => {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  const name = formatter
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = name?.match(/^GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/);
  if (!match) throw new RangeError(`Could not resolve offset for ${timeZone}.`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
};

const compactOffset = (minutes: number): string => {
  const absolute = Math.abs(minutes);
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}${String(
    absolute % 60,
  ).padStart(2, '0')}`;
};

const compactLocalInstant = (utc: number, offset: number): string => {
  const local = new Date(utc + offset * MINUTE);
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, '0')}${String(
    local.getUTCDate(),
  ).padStart(2, '0')}T${String(local.getUTCHours()).padStart(2, '0')}${String(
    local.getUTCMinutes(),
  ).padStart(2, '0')}00`;
};

const transitionAt = (
  timeZone: string,
  low: number,
  high: number,
  previousOffset: number,
  nextOffset: number,
): number => {
  let before = low;
  let after = high;
  while (after - before > MINUTE) {
    const middle = before + Math.floor((after - before) / 2);
    if (offsetMinutes(timeZone, middle) === previousOffset) before = middle;
    else after = middle;
  }
  const floor = Math.floor(after / MINUTE) * MINUTE;
  return offsetMinutes(timeZone, floor) === nextOffset ? floor : floor + MINUTE;
};

/** Defines every named offset used by this release for clients without an IANA database. */
const timeZoneLines = (
  timeZone: string,
  dates: readonly string[],
  fallbackYear: number,
): string[] => {
  const years = dates
    .map((date) => Number(date.slice(0, 4)))
    .filter((year) => Number.isInteger(year) && year >= 1970 && year <= 9999);
  const firstYear = (years.length ? Math.min(...years) : fallbackYear) - 1;
  const lastYear = (years.length ? Math.max(...years) : fallbackYear) + 1;
  const start = Date.UTC(firstYear, 0, 1);
  const end = Date.UTC(lastYear + 1, 0, 1);
  const transitions: Array<{ at: number; from: number; to: number }> = [];
  let previousAt = start;
  let previousOffset = offsetMinutes(timeZone, start);

  for (let at = start + ZONE_SCAN_STEP; at <= end; at += ZONE_SCAN_STEP) {
    const nextOffset = offsetMinutes(timeZone, at);
    if (nextOffset !== previousOffset) {
      transitions.push({
        at: transitionAt(timeZone, previousAt, at, previousOffset, nextOffset),
        from: previousOffset,
        to: nextOffset,
      });
      previousOffset = nextOffset;
    }
    previousAt = at;
  }

  const lines = [
    'BEGIN:VTIMEZONE',
    `TZID:${escapeIcs(timeZone)}`,
    `X-LIC-LOCATION:${escapeIcs(timeZone)}`,
  ];
  if (transitions.length === 0) {
    const offset = offsetMinutes(timeZone, start);
    lines.push(
      'BEGIN:STANDARD',
      `DTSTART:${firstYear}0101T000000`,
      `TZOFFSETFROM:${compactOffset(offset)}`,
      `TZOFFSETTO:${compactOffset(offset)}`,
      'END:STANDARD',
    );
  } else {
    for (const transition of transitions) {
      const type = transition.to > transition.from ? 'DAYLIGHT' : 'STANDARD';
      lines.push(
        `BEGIN:${type}`,
        `DTSTART:${compactLocalInstant(transition.at, transition.from)}`,
        `TZOFFSETFROM:${compactOffset(transition.from)}`,
        `TZOFFSETTO:${compactOffset(transition.to)}`,
        `END:${type}`,
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
};

export function publicEntryTitle(entry: PublishedScheduleEntry, locale: 'en' | 'fr'): string {
  return entry.kind === 'proposal' ? entry.session.title : localised(entry.title, locale);
}

export function scheduleIcs(
  cfpId: string,
  eventName: string,
  schedule: PublishedSchedule,
  entries: readonly PublishedScheduleEntry[],
  locale: 'en' | 'fr',
  origin: string,
  generatedAt = new Date(),
): string {
  const rooms = new Map(schedule.rooms.map((room) => [room.id, localised(room.name, locale)]));
  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GDG Montreal//CFP Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(eventName)}`,
    `X-WR-TIMEZONE:${escapeIcs(schedule.timeZone)}`,
    ...timeZoneLines(
      schedule.timeZone,
      [...schedule.days.map((day) => day.date), ...entries.map((entry) => entry.date)],
      generatedAt.getUTCFullYear(),
    ),
  ];
  for (const entry of entries) {
    const detailUrl = `${origin}/c/${cfpId}/schedule/${encodeURIComponent(entry.id)}`;
    const description =
      entry.kind === 'proposal'
        ? entry.session.abstract
        : localised(entry.description, locale);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(`${cfpId}-${entry.id}@cfp.gdgmontreal.com`)}`,
      `SEQUENCE:${schedule.version}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${schedule.timeZone}:${compactDateTime(entry.date, entry.startsAt)}`,
      `DTEND;TZID=${schedule.timeZone}:${compactDateTime(entry.date, scheduleEndTime(entry))}`,
      `SUMMARY:${escapeIcs(publicEntryTitle(entry, locale))}`,
      `LOCATION:${escapeIcs(rooms.get(entry.roomId) ?? entry.roomId)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      `URL:${detailUrl}`,
      ...(entry.kind === 'proposal' && entry.cancelled ? ['STATUS:CANCELLED'] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
