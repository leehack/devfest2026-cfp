import {
  validateAnswers,
  validateForm,
  type Answers,
  type ConfirmField,
} from '../../shared/confirmForm';
import type { ProposalAggregate, Social, SpeakerSnapshot } from '../../shared/types';

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
  // Submission-time logistics, not a confirmation answer: the committee has
  // always had this, and scoring a talk without knowing the speaker needs a
  // visa is how a session becomes a hole in the grid. `confirmAnswers`, which
  // is answered after acceptance and is presenter-private, stays out.
  'attendance',
  'status',
  'submittedAt',
] as const;

const REVIEWABLE_ANSWER_TYPES = ['text', 'textarea', 'select', 'checkbox'] as const;

/**
 * Submission answers are talk content, but only while the current form still
 * defines them. Re-run the shared answer validator over that explicit subset:
 * it trims text, rejects stale select values and keeps arbitrary proposal maps
 * (including confirmation, travel and photo paths) out of the payload.
 */
function answersFrom(value: unknown, fields: ConfirmField[]): Answers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Answers;
  const reviewable = fields.filter(
    (field) =>
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
  submissionFields: ConfirmField[] = [],
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
  const aggregate = includeAggregate ? aggregateFrom(source.aggregate) : null;
  if (aggregate) projected.aggregate = aggregate;
  return projected;
}
