import type { Localised } from './confirmForm';
import type { DeliveryLanguage, ResolvedLanguage } from './enums';
import type { SpeakerSnapshot } from './types';

export const CUSTOM_SCHEDULE_TYPES = [
  'keynote',
  'break',
  'meal',
  'social',
  'opening',
  'closing',
  'other',
] as const;
export type CustomScheduleType = (typeof CUSTOM_SCHEDULE_TYPES)[number];

export const SCHEDULE_LIMITS = {
  rooms: 20,
  days: 10,
  entries: 150,
  title: 180,
  description: 3000,
  roomName: 80,
  durationMin: 5,
  durationMax: 480,
} as const;

export interface ScheduleRoom {
  id: string;
  name: Localised;
}

export interface ScheduleDay {
  date: string;
  startsAt: string;
  endsAt: string;
}

export interface ScheduleConfig {
  timeZone: string;
  days: ScheduleDay[];
  rooms: ScheduleRoom[];
  revision: number;
  needsAttention?: boolean;
  updatedAt?: unknown;
}

interface ScheduleEntryBase {
  id: string;
  date: string;
  startsAt: string;
  durationMinutes: number;
  roomId: string;
  updatedAt?: unknown;
}

export interface ProposalScheduleEntry extends ScheduleEntryBase {
  kind: 'proposal';
  proposalId: string;
  /** Required only when the proposal was submitted as `either`. */
  assignedLanguage?: ResolvedLanguage;
}

export interface CustomScheduleEntry extends ScheduleEntryBase {
  kind: 'custom';
  customType: CustomScheduleType;
  title: Localised;
  description?: Localised;
}

export type ScheduleEntry = ProposalScheduleEntry | CustomScheduleEntry;

export interface PublishedProposalSession {
  proposalId: string;
  title: string;
  abstract: string;
  category: string;
  format: string;
  level: string;
  language: Exclude<DeliveryLanguage, 'either'>;
  speakers: SpeakerSnapshot[];
}

export type PublishedScheduleEntry = ScheduleEntryBase &
  (
    | {
        kind: 'proposal';
        proposalId: string;
        session: PublishedProposalSession;
        cancelled?: boolean;
      }
    | {
        kind: 'custom';
        customType: CustomScheduleType;
        title: Localised;
        description?: Localised;
      }
  );

export interface PublishedSchedule {
  id: string;
  version: number;
  timeZone: string;
  days: ScheduleDay[];
  rooms: ScheduleRoom[];
  publishedAt: unknown;
}

/** The local end time attendees need alongside the stored start and duration. */
export function scheduleEndTime(
  entry: Pick<PublishedScheduleEntry, 'startsAt' | 'durationMinutes'>,
): string {
  const start = Number(entry.startsAt.slice(0, 2)) * 60 + Number(entry.startsAt.slice(3));
  const end = start + entry.durationMinutes;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export type ScheduleProblem =
  | 'timeZone'
  | 'days'
  | 'dayDate'
  | 'dayTime'
  | 'rooms'
  | 'roomId'
  | 'roomName'
  | 'entryId'
  | 'entryDate'
  | 'entryTime'
  | 'entryDuration'
  | 'entryRoom'
  | 'entryTitle'
  | 'entryType';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_ID = /^(?!__)[A-Za-z0-9_-]{1,160}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return Boolean(value.trim());
  } catch {
    return false;
  }
}

export function minutesOf(value: string): number | null {
  const match = TIME.exec(value);
  return match ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
}

export function validateScheduleConfig(config: ScheduleConfig): ScheduleProblem | null {
  if (!validTimeZone(config.timeZone)) return 'timeZone';
  if (!config.days.length || config.days.length > SCHEDULE_LIMITS.days) return 'days';
  if (!config.rooms.length || config.rooms.length > SCHEDULE_LIMITS.rooms) return 'rooms';

  const dates = new Set<string>();
  for (const day of config.days) {
    if (!DAY.test(day.date) || Number.isNaN(Date.parse(`${day.date}T00:00:00Z`))) return 'dayDate';
    const start = minutesOf(day.startsAt);
    const end = minutesOf(day.endsAt);
    if (start === null || end === null || start >= end) return 'dayTime';
    if (dates.has(day.date)) return 'dayDate';
    dates.add(day.date);
  }

  const rooms = new Set<string>();
  for (const room of config.rooms) {
    if (!ID.test(room.id) || rooms.has(room.id)) return 'roomId';
    const names = [room.name.en?.trim(), room.name.fr?.trim()].filter(Boolean) as string[];
    if (!names.length || names.some((name) => name.length > SCHEDULE_LIMITS.roomName)) {
      return 'roomName';
    }
    rooms.add(room.id);
  }
  return null;
}

export function validateScheduleEntry(
  entry: ScheduleEntry,
  config: ScheduleConfig,
): ScheduleProblem | null {
  if (!ENTRY_ID.test(entry.id)) return 'entryId';
  const day = config.days.find((candidate) => candidate.date === entry.date);
  if (!day) return 'entryDate';
  const start = minutesOf(entry.startsAt);
  const opens = minutesOf(day.startsAt);
  const closes = minutesOf(day.endsAt);
  if (start === null || opens === null || closes === null) return 'entryTime';
  if (
    !Number.isInteger(entry.durationMinutes) ||
    entry.durationMinutes < SCHEDULE_LIMITS.durationMin ||
    entry.durationMinutes > SCHEDULE_LIMITS.durationMax ||
    start < opens ||
    start + entry.durationMinutes > closes
  ) {
    return 'entryDuration';
  }
  if (!config.rooms.some((room) => room.id === entry.roomId)) return 'entryRoom';
  if (entry.kind === 'proposal') {
    return typeof entry.proposalId === 'string' && entry.proposalId.length <= 160
      ? null
      : 'entryId';
  }
  if (!(CUSTOM_SCHEDULE_TYPES as readonly string[]).includes(entry.customType)) return 'entryType';
  const titles = [entry.title.en?.trim(), entry.title.fr?.trim()].filter(Boolean) as string[];
  if (!titles.length || titles.some((title) => title.length > SCHEDULE_LIMITS.title)) {
    return 'entryTitle';
  }
  const descriptions = [entry.description?.en ?? '', entry.description?.fr ?? ''];
  return descriptions.some((description) => description.length > SCHEDULE_LIMITS.description)
    ? 'entryTitle'
    : null;
}

export interface ScheduleConflict {
  kind: 'room' | 'speaker' | 'proposal';
  entryIds: [string, string];
}

const overlaps = (a: ScheduleEntry, b: ScheduleEntry): boolean => {
  if (a.date !== b.date) return false;
  const aStart = minutesOf(a.startsAt)!;
  const bStart = minutesOf(b.startsAt)!;
  return aStart < bStart + b.durationMinutes && bStart < aStart + a.durationMinutes;
};

export function scheduleConflicts(
  entries: readonly ScheduleEntry[],
  speakersByProposal: ReadonlyMap<string, readonly string[]> = new Map(),
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const a = entries[left];
      const b = entries[right];
      if (a.kind === 'proposal' && b.kind === 'proposal' && a.proposalId === b.proposalId) {
        conflicts.push({ kind: 'proposal', entryIds: [a.id, b.id] });
        continue;
      }
      if (!overlaps(a, b)) continue;
      if (a.roomId === b.roomId) conflicts.push({ kind: 'room', entryIds: [a.id, b.id] });
      if (a.kind !== 'proposal' || b.kind !== 'proposal') continue;
      const aSpeakers = new Set(speakersByProposal.get(a.proposalId) ?? []);
      if ((speakersByProposal.get(b.proposalId) ?? []).some((uid) => aSpeakers.has(uid))) {
        conflicts.push({ kind: 'speaker', entryIds: [a.id, b.id] });
      }
    }
  }
  return conflicts;
}

export const suggestedDuration = (format: string): number =>
  ({ session_40: 40, lightning_15: 15, workshop_90: 90 })[format] ?? 40;

export function resolvedScheduleLanguage(
  delivery: DeliveryLanguage,
  assigned?: ResolvedLanguage,
): Exclude<DeliveryLanguage, 'either'> | null {
  return delivery === 'either' ? assigned ?? null : delivery;
}
