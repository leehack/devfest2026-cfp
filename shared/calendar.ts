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
