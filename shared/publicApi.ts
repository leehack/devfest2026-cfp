import { localised, type Localised } from './confirmForm';
import {
  scheduleEndTime,
  scheduleEntryAllRooms,
  type PublishedSchedule,
  type PublishedScheduleEntry,
  type ScheduleDay,
} from './schedule';

export type PublicApiLanguage = 'en' | 'fr';

export function publicApiLanguage(value: string | null): PublicApiLanguage {
  return value === 'fr' ? 'fr' : 'en';
}

/** An item written in one language only is still returned, not blanked. */
function text(value: Localised | undefined, language: PublicApiLanguage): string {
  return localised(value, language) || localised(value, language === 'fr' ? 'en' : 'fr') || '';
}

export interface PublicApiOption {
  value: string;
  label: string;
}

export interface PublicApiSpeaker {
  /** Stable within one release only; the programme carries no account identity. */
  id: string;
  name: string;
  bio: string | null;
  company: string | null;
  jobTitle: string | null;
  photoUrl: string | null;
}

export interface PublicApiSession {
  id: string;
  /** `talk` for a selected proposal, otherwise the organiser's item type. */
  type: string;
  title: string;
  description: string;
  date: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  allRooms: boolean;
  roomId: string | null;
  room: string | null;
  language: string | null;
  category: PublicApiOption | null;
  format: PublicApiOption | null;
  level: PublicApiOption | null;
  cancelled: boolean;
  url: string;
  speakers: PublicApiSpeaker[];
}

export interface PublicApiSchedule {
  event: { id: string; name: string; url: string };
  language: PublicApiLanguage;
  version: number;
  publishedAt: string | null;
  timeZone: string;
  days: ScheduleDay[];
  rooms: { id: string; name: string }[];
  sessions: PublicApiSession[];
}

export interface PublicApiSpeakerListing extends PublicApiSpeaker {
  sessionId: string;
}

export interface PublicApiInput {
  cfpId: string;
  eventName: string;
  schedule: PublishedSchedule;
  entries: readonly PublishedScheduleEntry[];
  language: PublicApiLanguage;
  origin: string;
}

export function publicApiSessions({
  cfpId,
  schedule,
  entries,
  language,
  origin,
}: PublicApiInput): PublicApiSession[] {
  const base = `${origin}/c/${encodeURIComponent(cfpId)}`;
  const rooms = new Map(schedule.rooms.map((room) => [room.id, text(room.name, language)]));
  const roomOrder = new Map(schedule.rooms.map((room, index) => [room.id, index]));
  const rank = (entry: PublishedScheduleEntry) =>
    scheduleEntryAllRooms(entry) ? -1 : (roomOrder.get(entry.roomId ?? '') ?? schedule.rooms.length);
  return entries
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startsAt.localeCompare(b.startsAt) ||
        rank(a) - rank(b) ||
        a.id.localeCompare(b.id),
    )
    .map((entry) => {
      const cancelled = entry.kind === 'proposal' && entry.cancelled === true;
      const session = entry.kind === 'proposal' ? entry.session : null;
      const option = (value: string, label: Localised | undefined): PublicApiOption => ({
        value,
        label: text(label, language) || value,
      });
      const speakers = (session ? session.speakers : (entry.kind === 'custom' && entry.speakers) || []).map(
        (speaker, index): PublicApiSpeaker => ({
          id: `${entry.id}-${index}`,
          name: speaker.name,
          bio: speaker.bio ?? null,
          company: speaker.company ?? null,
          jobTitle: speaker.jobTitle ?? null,
          photoUrl:
            speaker.photoRef && !cancelled
              ? `${origin}/api/c/${encodeURIComponent(cfpId)}/schedule/photos/${encodeURIComponent(schedule.id)}/${encodeURIComponent(entry.id)}/${index}`
              : null,
        }),
      );
      return {
        id: entry.id,
        type: entry.kind === 'proposal' ? 'talk' : entry.customType,
        title: entry.kind === 'proposal' ? entry.session.title : text(entry.title, language),
        description:
          entry.kind === 'proposal' ? entry.session.abstract : text(entry.description, language),
        date: entry.date,
        startsAt: entry.startsAt,
        endsAt: scheduleEndTime(entry),
        durationMinutes: entry.durationMinutes,
        allRooms: scheduleEntryAllRooms(entry),
        roomId: entry.roomId ?? null,
        room: entry.roomId ? (rooms.get(entry.roomId) ?? null) : null,
        language: session ? session.language : ((entry.kind === 'custom' && entry.language) || null),
        category: session ? option(session.category, session.categoryLabel) : null,
        format: session ? option(session.format, session.formatLabel) : null,
        level: session ? option(session.level, session.levelLabel) : null,
        cancelled,
        url: `${base}/schedule/${encodeURIComponent(entry.id)}`,
        speakers,
      };
    });
}

export function publicApiSchedule(input: PublicApiInput): PublicApiSchedule {
  const { cfpId, eventName, schedule, language, origin } = input;
  const publishedAt = typeof schedule.publishedAt === 'number' && schedule.publishedAt > 0
    ? new Date(schedule.publishedAt).toISOString()
    : null;
  return {
    event: { id: cfpId, name: eventName, url: `${origin}/c/${encodeURIComponent(cfpId)}/schedule` },
    language,
    version: schedule.version,
    publishedAt,
    timeZone: schedule.timeZone,
    days: schedule.days.map(({ date, startsAt, endsAt }) => ({ date, startsAt, endsAt })),
    rooms: schedule.rooms.map((room) => ({ id: room.id, name: text(room.name, language) })),
    sessions: publicApiSessions(input),
  };
}

/** One row per appearance: the release has no identity that could merge a person across sessions. */
export function publicApiSpeakers(input: PublicApiInput): PublicApiSpeakerListing[] {
  return publicApiSessions(input)
    .filter((session) => !session.cancelled)
    .flatMap((session) =>
      session.speakers.map((speaker) => ({ ...speaker, sessionId: session.id })),
    );
}
