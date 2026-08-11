import type { ConfirmField } from '@shared/confirmForm';
import { labelOf, type SubmissionForm } from '@shared/submissionForm';
import type { ProposalRow } from '../../lib/roles';

const csvCell = (value: unknown): string => {
  const raw = String(value ?? '');
  // A CSV is commonly opened in a spreadsheet, where speaker-controlled text
  // beginning with one of these characters is evaluated as a formula. The
  // apostrophe is Excel/Sheets' plain-text marker and remains harmless in
  // importers that do not interpret formulas.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n\t]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const answer = (
  value: unknown,
  field: ConfirmField | undefined,
  locale: 'en' | 'fr',
): string => {
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return '';
  return field?.type === 'select' ? labelOf(field.options, value, locale) : value;
};

const dateValue = (value: unknown): string => {
  if (!value) return '';
  const fromTimestamp = (value as { toDate?: () => Date }).toDate?.();
  const date =
    fromTimestamp instanceof Date
      ? fromTimestamp
      : value instanceof Date
        ? value
        : typeof value === 'string' || typeof value === 'number'
          ? new Date(value)
          : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
};

function answerKeys(
  configured: readonly ConfirmField[],
  rows: readonly ProposalRow[],
  pick: (row: ProposalRow) => Record<string, unknown> | undefined,
): string[] {
  const ordered = configured.map((field) => field.key);
  const known = new Set(ordered);
  const historical = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(pick(row) ?? {})) {
      if (!known.has(key)) historical.add(key);
    }
  }
  return [...ordered, ...[...historical].sort()];
}

const speakerName = (row: ProposalRow, uid: string): string => {
  const index = (row.speakerIds ?? []).indexOf(uid);
  return row.speakerSnapshot?.[index]?.name || uid;
};

const confirmationAnswers = (row: ProposalRow): Record<string, unknown> | undefined => {
  if (!row.speakerConfirmations?.length) return row.confirmAnswers;
  return Object.assign({}, ...row.speakerConfirmations.map((item) => item.answers ?? {}));
};

const perSpeakerConfirmation = (
  row: ProposalRow,
  key: string,
  field: ConfirmField | undefined,
  locale: 'en' | 'fr',
): string => {
  if (!row.speakerConfirmations?.length) {
    return answer(row.confirmAnswers?.[key], field, locale);
  }
  return row.speakerConfirmations
    .map((item) => {
      const value = answer(item.answers?.[key], field, locale);
      return value ? `${speakerName(row, item.uid)}: ${value}` : '';
    })
    .filter(Boolean)
    .join('; ');
};

/**
 * One stable row per selected talk. Human labels sit beside stored codes, while
 * custom answers get their own columns so the file is useful in a spreadsheet
 * without first unpacking JSON.
 */
export function selectedSpeakersCsv(
  rows: readonly ProposalRow[],
  shape: SubmissionForm,
  confirmation: readonly ConfirmField[],
  locale: 'en' | 'fr',
): string {
  const submissionKeys = answerKeys(shape.fields, rows, (row) => row.answers);
  const confirmationKeys = answerKeys(confirmation, rows, confirmationAnswers);
  const submissionFields = new Map(shape.fields.map((field) => [field.key, field]));
  const confirmationFields = new Map(confirmation.map((field) => [field.key, field]));
  const headers = [
    'proposal_id',
    'status',
    'title',
    'abstract',
    'pitch',
    'category',
    'category_label',
    'format',
    'format_label',
    'level',
    'level_label',
    'delivery_language',
    'delivery_language_label',
    'language_preference',
    'assigned_language',
    'assigned_language_label',
    'speaker_names',
    'speaker_bios',
    'speaker_companies',
    'speaker_job_titles',
    'speaker_locations',
    'speaker_is_gde',
    'speaker_past_talks',
    'speaker_socials',
    'speaker_sessionize_urls',
    'speaker_confirmation_statuses',
    'speaker_attendance_statuses',
    'speaker_funding_sources',
    'speaker_funding_decision_dates',
    'speaker_needs_visa',
    'speaker_acknowledgements',
    'attendance_status',
    'funding_source',
    'funding_decision_by',
    'needs_visa',
    'submitted_at',
    'confirmed_at',
    'average_score',
    'normalized_score',
    'review_count',
    'score_spread',
    ...submissionKeys.map((key) => `submission_${key}`),
    ...confirmationKeys.map((key) => `confirmation_${key}`),
  ];

  const lines = rows.map((row) => {
    const speakers = row.speakerSnapshot ?? [];
    const values = [
      row.id,
      row.status,
      row.title,
      row.abstract,
      row.pitch,
      row.category,
      labelOf(shape.category, row.category, locale),
      row.format,
      labelOf(shape.format, row.format, locale),
      row.level,
      labelOf(shape.level, row.level, locale),
      row.deliveryLanguage,
      labelOf(shape.deliveryLanguage, row.deliveryLanguage, locale),
      row.languagePreference,
      row.assignedLanguage,
      row.assignedLanguage
        ? labelOf(shape.deliveryLanguage, row.assignedLanguage, locale)
        : '',
      speakers.map((speaker) => speaker.name).filter(Boolean).join('; '),
      speakers.map((speaker) => speaker.bio).filter(Boolean).join('\n---\n'),
      speakers.map((speaker) => speaker.company).filter(Boolean).join('; '),
      speakers.map((speaker) => speaker.jobTitle).filter(Boolean).join('; '),
      speakers.map((speaker) => speaker.basedIn).filter(Boolean).join('; '),
      speakers.map((speaker) => String(speaker.isGde)).join('; '),
      speakers.map((speaker) => speaker.pastTalks).filter(Boolean).join('\n---\n'),
      speakers
        .flatMap((speaker) =>
          (speaker.socials ?? []).map((social) => `${social.platform}:${social.handle}`),
        )
        .join('; '),
      speakers.map((speaker) => speaker.sessionizeUrl).filter(Boolean).join('; '),
      (row.speakerConfirmations ?? [])
        .map((item) => `${speakerName(row, item.uid)}: ${item.response ?? 'pending'}`)
        .join('; '),
      (row.speakerParticipants ?? [])
        .map((item) => `${speakerName(row, item.uid)}: ${item.attendance?.status ?? ''}`)
        .join('; '),
      (row.speakerParticipants ?? [])
        .map((item) => `${speakerName(row, item.uid)}: ${item.attendance?.fundingSource ?? ''}`)
        .join('; '),
      (row.speakerParticipants ?? [])
        .map((item) => `${speakerName(row, item.uid)}: ${item.attendance?.decisionBy ?? ''}`)
        .join('; '),
      (row.speakerParticipants ?? [])
        .map((item) => `${speakerName(row, item.uid)}: ${String(item.attendance?.needsVisa ?? '')}`)
        .join('; '),
      (row.speakerParticipants ?? [])
        .map((item) =>
          `${speakerName(row, item.uid)}: ${Object.entries(item.acks ?? {})
            .map(([key, value]) => `${key}=${String(value)}`)
            .join('|')}`,
        )
        .join('; '),
      row.attendance?.status,
      row.attendance?.fundingSource,
      row.attendance?.decisionBy,
      row.attendance ? String(row.attendance.needsVisa) : '',
      dateValue(row.submittedAt),
      dateValue(row.confirmedAt),
      row.aggregate?.avgScore,
      row.aggregate?.normalizedScore,
      row.aggregate?.reviewCount,
      row.aggregate?.stdDev,
      ...submissionKeys.map((key) =>
        answer(row.answers?.[key], submissionFields.get(key), locale),
      ),
      ...confirmationKeys.map((key) =>
        perSpeakerConfirmation(row, key, confirmationFields.get(key), locale),
      ),
    ];
    return values.map(csvCell).join(',');
  });

  return [headers.map(csvCell).join(','), ...lines].join('\r\n');
}

export function downloadSelectedSpeakersCsv(
  cfpId: string,
  rows: readonly ProposalRow[],
  shape: SubmissionForm,
  confirmation: readonly ConfirmField[],
  locale: 'en' | 'fr',
): void {
  const blob = new Blob([`\uFEFF${selectedSpeakersCsv(rows, shape, confirmation, locale)}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${cfpId}-selected-speakers.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari may still be resolving the object URL when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
