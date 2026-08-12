import {
  validateAnswers,
  validateForm,
  type Answers,
} from '../../shared/confirmForm';
import { MAX_ACTIVE_SPEAKERS } from '../../shared/coSpeakers';
import { attendanceSchemaFor } from '../../shared/schema';
import {
  DEFAULT_SUBMISSION_FORM,
  reviewerAttendanceEnabled,
  type SubmissionField,
  type SubmissionForm,
} from '../../shared/submissionForm';
import type {
  Attendance,
  ProposalAggregate,
  Social,
  SpeakerSnapshot,
} from '../../shared/types';

/** The complete proposal surface a plain reviewer may receive. */
export const REVIEWER_PROPOSAL_FIELDS = [
  'speakerSnapshot',
  'title',
  'abstract',
  'pitch',
  'category',
  'format',
  'level',
  'deliveryLanguage',
  'languagePreference',
  'answers',
  'status',
  'submittedAt',
] as const;

const REVIEWABLE_ANSWER_TYPES = ['text', 'textarea', 'select', 'checkbox'] as const;

export interface ReviewerSpeakerTravel extends Partial<Attendance> {
  uid: string;
  name: string;
  status?: Attendance['status'];
}

export interface ReviewerParticipantSource {
  status?: unknown;
  attendance?: unknown;
}

/**
 * Submission answers are talk content, but only while the current form still
 * defines them. Re-run the shared answer validator over that explicit subset:
 * it trims text, rejects stale select values and keeps arbitrary proposal maps
 * (including confirmation, travel and photo paths) out of the payload.
 */
function answersFrom(value: unknown, fields: SubmissionField[]): Answers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Answers;
  const reviewable = fields.filter(
    (field) =>
      field.reviewerVisible !== false &&
      (REVIEWABLE_ANSWER_TYPES as readonly string[]).includes(field.type) &&
      Object.prototype.hasOwnProperty.call(source, field.key),
  );
  if (reviewable.length === 0 || validateForm({ fields: reviewable })) return null;

  const clean = validateAnswers({ fields: reviewable }, source).clean;
  return Object.keys(clean).length > 0 ? clean : null;
}

function socialFrom(value: unknown): Social | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const social = value as Record<string, unknown>;
  if (typeof social.platform !== 'string' || typeof social.handle !== 'string') return null;
  return { platform: social.platform as Social['platform'], handle: social.handle };
}

function speakerFrom(value: unknown): SpeakerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const speaker = value as Record<string, unknown>;
  if (typeof speaker.uid !== 'string' || !speaker.uid) return null;
  return {
    uid: speaker.uid,
    name: String(speaker.name ?? ''),
    bio: String(speaker.bio ?? ''),
    ...(speaker.company ? { company: String(speaker.company) } : {}),
    ...(speaker.jobTitle ? { jobTitle: String(speaker.jobTitle) } : {}),
    basedIn: String(speaker.basedIn ?? ''),
    socials: Array.isArray(speaker.socials)
      ? speaker.socials.flatMap((social) => socialFrom(social) ?? [])
      : [],
    isGde: speaker.isGde === true,
    ...(speaker.pastTalks ? { pastTalks: String(speaker.pastTalks) } : {}),
    ...(speaker.sessionizeUrl ? { sessionizeUrl: String(speaker.sessionizeUrl) } : {}),
  };
}

function currentSpeakerIds(source: Record<string, unknown>): string[] {
  if (!Array.isArray(source.speakerIds)) return [];
  return [
    ...new Set(
      source.speakerIds.filter(
        (uid): uid is string =>
          typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.includes('/'),
      ),
    ),
  ].slice(0, MAX_ACTIVE_SPEAKERS);
}

function usesRosterTravel(source: Record<string, unknown>, speakerIds: readonly string[]): boolean {
  return (
    (typeof source.primarySpeakerId === 'string' && source.primarySpeakerId.length > 0) ||
    speakerIds.length > 1
  );
}

/** Exact participant documents the queue must read for a roster-mode proposal. */
export function reviewerTravelParticipantIds(source: Record<string, unknown>): string[] {
  const speakerIds = currentSpeakerIds(source);
  return usesRosterTravel(source, speakerIds) ? speakerIds : [];
}

/**
 * The committee's travel view is a new DTO, never a forwarded private map.
 * Zod strips unknown keys and rejects incomplete conditional answers before
 * any value crosses the callable boundary.
 */
function speakerTravelFrom(
  source: Record<string, unknown>,
  participants: ReadonlyMap<string, ReviewerParticipantSource>,
  form: SubmissionForm,
): ReviewerSpeakerTravel[] {
  const config = form.attendance;
  if (!reviewerAttendanceEnabled(config)) return [];
  const speakerIds = currentSpeakerIds(source);
  const rosterMode = usesRosterTravel(source, speakerIds);
  const names = new Map(
    (Array.isArray(source.speakerSnapshot) ? source.speakerSnapshot : [])
      .flatMap((value) => speakerFrom(value) ?? [])
      .map((speaker) => [speaker.uid, speaker.name]),
  );

  return speakerIds.flatMap((uid, index) => {
    const participant = participants.get(uid);
    if (rosterMode && participant?.status !== 'active') return [];
    const candidate = rosterMode
      ? participant?.attendance
      : index === 0
        ? source.attendance
        : undefined;
    const parsed = attendanceSchemaFor(form).safeParse(candidate);
    if (!parsed.success) return [];
    const attendance = parsed.data;
    if (!attendance) return [];
    const visible = {
      ...(config.statusReviewerVisible ? { status: attendance.status } : {}),
      ...(config.fundingSource.enabled && config.fundingSource.reviewerVisible
        ? { fundingSource: attendance.fundingSource }
        : {}),
      ...(config.decisionBy.enabled && config.decisionBy.reviewerVisible
        ? { decisionBy: attendance.decisionBy }
        : {}),
      ...(config.needsVisa.enabled && config.needsVisa.reviewerVisible
        ? { needsVisa: attendance.needsVisa }
        : {}),
    };
    const clean = Object.fromEntries(
      Object.entries(visible).filter(([, value]) => value !== undefined),
    );
    return Object.keys(clean).length > 0
      ? [{ uid, name: names.get(uid) ?? '', ...clean }]
      : [];
  });
}

function aggregateFrom(value: unknown): ProposalAggregate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const aggregate = value as Record<string, unknown>;
  if (
    !['avgScore', 'normalizedScore', 'reviewCount', 'stdDev'].every(
      (field) => typeof aggregate[field] === 'number' && Number.isFinite(aggregate[field]),
    )
  ) {
    return null;
  }
  return {
    avgScore: aggregate.avgScore as number,
    normalizedScore: aggregate.normalizedScore as number,
    reviewCount: aggregate.reviewCount as number,
    stdDev: aggregate.stdDev as number,
  };
}

function epochMillis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { toMillis?: unknown }).toMillis !== 'function'
  ) {
    return null;
  }
  try {
    const millis = (value as { toMillis: () => unknown }).toMillis();
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

export function reviewerProposalProjection(
  id: string,
  source: Record<string, unknown>,
  includeAggregate: boolean,
  submissionFields: SubmissionField[] = [],
  participants: ReadonlyMap<string, ReviewerParticipantSource> = new Map(),
  submissionForm: SubmissionForm = DEFAULT_SUBMISSION_FORM,
): Record<string, unknown> & { id: string } {
  const projected: Record<string, unknown> & { id: string } = { id };
  for (const field of REVIEWER_PROPOSAL_FIELDS) {
    if (
      field !== 'submittedAt' &&
      field !== 'answers' &&
      Object.prototype.hasOwnProperty.call(source, field)
    ) {
      projected[field] = source[field];
    }
  }
  const submittedAt = epochMillis(source.submittedAt);
  if (submittedAt !== null) projected.submittedAt = submittedAt;
  projected.speakerSnapshot = Array.isArray(source.speakerSnapshot)
    ? source.speakerSnapshot.flatMap((speaker) => speakerFrom(speaker) ?? [])
    : [];
  const answers = answersFrom(source.answers, submissionFields);
  if (answers) projected.answers = answers;
  const speakerTravel = speakerTravelFrom(source, participants, submissionForm);
  if (speakerTravel.length > 0) projected.speakerTravel = speakerTravel;
  const aggregate = includeAggregate ? aggregateFrom(source.aggregate) : null;
  if (aggregate) projected.aggregate = aggregate;
  return projected;
}
