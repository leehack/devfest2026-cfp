import type { ProposalRow } from '../../lib/roles';
import { resolvedScheduleLanguage, type ScheduleConfig, type ScheduleEntry } from '@shared/schedule';
import { localised } from '@shared/confirmForm';
import { labelOf, type SubmissionForm } from '@shared/submissionForm';

const cell = (value: unknown): string => {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n\t]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

const optionLabel = (
  options: SubmissionForm['category'] | undefined,
  value: string,
  locale: 'en' | 'fr',
): string => {
  const label = labelOf(options, value, locale);
  return label === value
    ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : label;
};

type ScheduleLanguageLabels = Readonly<Record<'en' | 'fr' | 'bilingual', string>>;

const scheduleLanguageLabel = (
  value: string,
  locale: 'en' | 'fr',
  labels?: ScheduleLanguageLabels,
): string => labels?.[value as keyof ScheduleLanguageLabels] ?? optionLabel(undefined, value, locale);

export function scheduleCsv(
  config: ScheduleConfig,
  entries: readonly ScheduleEntry[],
  proposals: ReadonlyMap<string, ProposalRow>,
  locale: 'en' | 'fr',
  submissionForm?: SubmissionForm | null,
  languageLabels?: ScheduleLanguageLabels,
): string {
  const rooms = new Map(config.rooms.map((room) => [room.id, localised(room.name, locale)]));
  const header = [
    'entry_id', 'kind', 'date', 'start_time', 'duration_minutes', 'room_id', 'room',
    'proposal_id', 'proposal_status', 'title', 'speakers',
    'category', 'category_label', 'format', 'format_label', 'level', 'level_label',
    'delivery_language', 'delivery_language_label', 'assigned_language',
    'scheduled_language', 'scheduled_language_label', 'custom_type',
  ];
  const rows = entries
    .slice()
    .sort((a, b) => `${a.date}${a.startsAt}${a.roomId}`.localeCompare(`${b.date}${b.startsAt}${b.roomId}`))
    .map((entry) => {
      const proposal = entry.kind === 'proposal' ? proposals.get(entry.proposalId) : undefined;
      const scheduledLanguage = entry.kind === 'proposal' && proposal
        ? resolvedScheduleLanguage(proposal.deliveryLanguage, entry.assignedLanguage)
        : entry.kind === 'custom'
          ? entry.language
          : '';
      return [
        entry.id,
        entry.kind,
        entry.date,
        entry.startsAt,
        entry.durationMinutes,
        entry.roomId,
        rooms.get(entry.roomId),
        proposal?.id,
        proposal?.status,
        proposal?.title ?? (entry.kind === 'custom' ? localised(entry.title, locale) : ''),
        proposal?.speakerSnapshot?.map((speaker) => speaker.name).join('; ') ??
          (entry.kind === 'custom' ? entry.speakers?.map((speaker) => speaker.name).join('; ') : ''),
        proposal?.category,
        proposal ? optionLabel(submissionForm?.category, proposal.category, locale) : '',
        proposal?.format,
        proposal ? optionLabel(submissionForm?.format, proposal.format, locale) : '',
        proposal?.level,
        proposal ? optionLabel(submissionForm?.level, proposal.level, locale) : '',
        proposal?.deliveryLanguage,
        proposal
          ? optionLabel(submissionForm?.deliveryLanguage, proposal.deliveryLanguage, locale)
          : '',
        entry.kind === 'proposal' ? entry.assignedLanguage : '',
        scheduledLanguage,
        scheduledLanguage ? scheduleLanguageLabel(scheduledLanguage, locale, languageLabels) : '',
        entry.kind === 'custom' ? entry.customType : '',
      ].map(cell).join(',');
    });
  return [header.map(cell).join(','), ...rows].join('\r\n');
}

export function downloadScheduleCsv(
  cfpId: string,
  config: ScheduleConfig,
  entries: readonly ScheduleEntry[],
  proposals: ReadonlyMap<string, ProposalRow>,
  locale: 'en' | 'fr',
  submissionForm?: SubmissionForm | null,
  languageLabels?: ScheduleLanguageLabels,
): void {
  const blob = new Blob([
    `\uFEFF${scheduleCsv(config, entries, proposals, locale, submissionForm, languageLabels)}`,
  ], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${cfpId}-schedule.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
