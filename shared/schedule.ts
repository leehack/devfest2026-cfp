import type { FieldOption, Localised } from './confirmForm';
import type { CfpRole } from './cfp';
import { LIMITS, type DeliveryLanguage, type ResolvedLanguage } from './enums';
import type { SpeakerSnapshot } from './types';

export const SCHEDULE_LANGUAGES = ['en', 'fr', 'bilingual'] as const;
export type ScheduleLanguage = (typeof SCHEDULE_LANGUAGES)[number];

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
  durationStep: 5,
  customSpeakers: 20,
  speakerPhotos: 200,
  speakerName: LIMITS.nameMax,
  speakerBio: LIMITS.bioMax,
  speakerCompany: LIMITS.companyMax,
  speakerJobTitle: LIMITS.jobTitleMax,
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
  /** Omitted for language-neutral items such as breaks or meals. */
  language?: ScheduleLanguage;
  title: Localised;
  description?: Localised;
  /** Optional attendee-facing people for keynotes, panels, and ceremonies. */
  speakers?: CustomScheduleSpeaker[];
}

export type ScheduleEntry = ProposalScheduleEntry | CustomScheduleEntry;

export interface PublishedProposalSession {
  proposalId: string;
  title: string;
  abstract: string;
  category: string;
  /** Frozen attendee-facing label. Absent on releases created before labels were snapshotted. */
  categoryLabel?: Localised;
  format: string;
  /** Frozen attendee-facing label. Absent on releases created before labels were snapshotted. */
  formatLabel?: Localised;
  level: string;
  /** Frozen attendee-facing label. Absent on releases created before labels were snapshotted. */
  levelLabel?: Localised;
  language: ScheduleLanguage;
  speakers: PublicScheduleSpeaker[];
}

/** A release-safe taxonomy label, retaining the code when an old option no longer exists. */
export function scheduleTaxonomyLabel(
  options: readonly FieldOption[],
  value: string,
): Localised {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) return { en: value };
  const en = option.label.en.trim() || value;
  const fr = option.label.fr?.trim();
  return { en, ...(fr ? { fr } : {}) };
}

/** The frozen speaker details attendees need, without committee/profile metadata. */
export interface PublicScheduleSpeaker {
  name: string;
  /** Proposal speakers always have a bio; custom-item speakers may omit it. */
  bio?: string;
  company?: string;
  jobTitle?: string;
  /** Opaque release member id. It is never a Storage path or account uid. */
  photoRef?: string;
}

/** Draft-only custom speaker data. Releases replace the asset ref with `photoRef`. */
export interface CustomScheduleSpeaker extends Omit<PublicScheduleSpeaker, 'photoRef'> {
  /** Opaque callable-owned asset; never a bucket path or object generation. */
  photoAssetRef?: string;
}

export function publicScheduleSpeakers(
  speakers: readonly SpeakerSnapshot[],
  photoRefs: ReadonlyMap<string, string> = new Map(),
): PublicScheduleSpeaker[] {
  return speakers.map((speaker) => ({
    name: speaker.name,
    bio: speaker.bio,
    ...(speaker.company ? { company: speaker.company } : {}),
    ...(speaker.jobTitle ? { jobTitle: speaker.jobTitle } : {}),
    ...(photoRefs.get(speaker.uid) ? { photoRef: photoRefs.get(speaker.uid) } : {}),
  }));
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
        language?: ScheduleLanguage;
        title: Localised;
        description?: Localised;
        speakers?: PublicScheduleSpeaker[];
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

/** One immutable working snapshot, shared only through the role-filtered callable. */
export interface SharedSchedule {
  id: string;
  version: number;
  timeZone: string;
  days: ScheduleDay[];
  rooms: ScheduleRoom[];
  sourceRevision: number;
  sharedAt: unknown;
  /** Present after this same snapshot is promoted to the public programme. */
  publishedAt?: unknown;
}

export type SharedScheduleAudience = 'committee' | 'speaker';

export function sharedScheduleAudience(role?: CfpRole): SharedScheduleAudience {
  return role === 'reviewer' || role === 'admin' || role === 'owner'
    ? 'committee'
    : 'speaker';
}

/**
 * Applies the callable's final disclosure boundary to an already-safe snapshot.
 * The map contains only proposals that are still confirmed at read time.
 */
export function sharedScheduleEntriesFor(
  entries: readonly PublishedScheduleEntry[],
  audience: SharedScheduleAudience,
  uid: string,
  confirmedSpeakersByProposal: ReadonlyMap<string, readonly string[]>,
): PublishedScheduleEntry[] {
  return entries.filter((entry) => {
    if (entry.kind === 'custom') return audience === 'committee';
    if (entry.cancelled === true) return false;
    const speakerIds = confirmedSpeakersByProposal.get(entry.proposalId);
    if (!speakerIds) return false;
    return audience === 'committee' || speakerIds.includes(uid);
  });
}

/** Removes unreleased days and rooms that are unrelated to a speaker's own placements. */
export function sharedScheduleForEntries(
  schedule: SharedSchedule,
  entries: readonly PublishedScheduleEntry[],
): SharedSchedule {
  const dates = new Set(entries.map((entry) => entry.date));
  const roomIds = new Set(entries.map((entry) => entry.roomId));
  return {
    ...schedule,
    days: schedule.days.filter((day) => dates.has(day.date)),
    rooms: schedule.rooms.filter((room) => roomIds.has(room.id)),
  };
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
  | 'entryType'
  | 'entryLanguage'
  | 'entrySpeakers';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_ID = /^(?!__)[A-Za-z0-9_-]{1,160}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CUSTOM_SPEAKER_PHOTO_REF = /^[A-Za-z0-9_-]{43}$/;

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

export interface ScheduleDurationBounds {
  min: number;
  max: number;
  step: number;
}

/** The resize range for one placement, capped at the configured end of day. */
export function scheduleDurationBounds(
  date: string,
  startsAt: string,
  config: Pick<ScheduleConfig, 'days'>,
): ScheduleDurationBounds | null {
  const day = config.days.find((candidate) => candidate.date === date);
  if (!day) return null;
  const start = minutesOf(startsAt);
  const opens = minutesOf(day.startsAt);
  const closes = minutesOf(day.endsAt);
  if (start === null || opens === null || closes === null || start < opens || start >= closes) {
    return null;
  }
  const max = Math.min(SCHEDULE_LIMITS.durationMax, closes - start);
  return max < SCHEDULE_LIMITS.durationMin
    ? null
    : {
        min: SCHEDULE_LIMITS.durationMin,
        max,
        step: SCHEDULE_LIMITS.durationStep,
      };
}

/** Snaps an interactive resize to its supported step and safe bounds. */
export function snapScheduleDuration(
  durationMinutes: number,
  bounds: ScheduleDurationBounds = {
    min: SCHEDULE_LIMITS.durationMin,
    max: SCHEDULE_LIMITS.durationMax,
    step: SCHEDULE_LIMITS.durationStep,
  },
  relativeTo = 0,
): number {
  if (!Number.isFinite(durationMinutes)) return bounds.min;
  const snapped =
    relativeTo + Math.round((durationMinutes - relativeTo) / bounds.step) * bounds.step;
  return Math.min(bounds.max, Math.max(bounds.min, snapped));
}

/** Room ids referenced by the live draft; those rooms cannot be removed yet. */
export function scheduleRoomIdsInUse(entries: readonly ScheduleEntry[]): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.roomId));
}

/** Generates a collision-free id that remains independent of room ordering. */
export function nextScheduleRoomId(rooms: readonly Pick<ScheduleRoom, 'id'>[]): string {
  const ids = new Set(rooms.map((room) => room.id));
  let suffix = 2;
  while (ids.has(`room-${suffix}`)) suffix += 1;
  return `room-${suffix}`;
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
    if (
      start === null ||
      end === null ||
      end - start < SCHEDULE_LIMITS.durationMin
    ) {
      return 'dayTime';
    }
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
    return typeof entry.proposalId === 'string' && ENTRY_ID.test(entry.proposalId)
      ? null
      : 'entryId';
  }
  if (!(CUSTOM_SCHEDULE_TYPES as readonly string[]).includes(entry.customType)) return 'entryType';
  if (
    entry.language !== undefined &&
    !(SCHEDULE_LANGUAGES as readonly string[]).includes(entry.language)
  ) {
    return 'entryLanguage';
  }
  if (entry.speakers !== undefined) {
    if (!Array.isArray(entry.speakers) || entry.speakers.length > SCHEDULE_LIMITS.customSpeakers) {
      return 'entrySpeakers';
    }
    for (const speaker of entry.speakers) {
      if (!speaker || typeof speaker !== 'object' || Array.isArray(speaker)) {
        return 'entrySpeakers';
      }
      if (
        typeof speaker.name !== 'string' ||
        !speaker.name.trim() ||
        speaker.name.length > SCHEDULE_LIMITS.speakerName ||
        (speaker.bio !== undefined &&
          (typeof speaker.bio !== 'string' ||
            speaker.bio.length > SCHEDULE_LIMITS.speakerBio)) ||
        (speaker.company !== undefined &&
          (typeof speaker.company !== 'string' ||
            speaker.company.length > SCHEDULE_LIMITS.speakerCompany)) ||
        (speaker.jobTitle !== undefined &&
          (typeof speaker.jobTitle !== 'string' ||
            speaker.jobTitle.length > SCHEDULE_LIMITS.speakerJobTitle)) ||
        (speaker.photoAssetRef !== undefined &&
          (typeof speaker.photoAssetRef !== 'string' ||
            !CUSTOM_SPEAKER_PHOTO_REF.test(speaker.photoAssetRef)))
      ) {
        return 'entrySpeakers';
      }
    }
  }
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
): ScheduleLanguage | null {
  return delivery === 'either' ? assigned ?? null : delivery;
}
