import type { ProposalRow } from '../../lib/roles';
import type { ScheduleConfig, ScheduleEntry } from '@shared/schedule';
import { localised } from '@shared/confirmForm';

const cell = (value: unknown): string => {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n\t]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function scheduleCsv(
  config: ScheduleConfig,
  entries: readonly ScheduleEntry[],
  proposals: ReadonlyMap<string, ProposalRow>,
  locale: 'en' | 'fr',
): string {
  const rooms = new Map(config.rooms.map((room) => [room.id, localised(room.name, locale)]));
  const header = [
    'entry_id', 'kind', 'date', 'start_time', 'duration_minutes', 'room_id', 'room',
    'proposal_id', 'proposal_status', 'title', 'speakers', 'format', 'delivery_language',
    'assigned_language', 'custom_type',
  ];
  const rows = entries
    .slice()
    .sort((a, b) => `${a.date}${a.startsAt}${a.roomId}`.localeCompare(`${b.date}${b.startsAt}${b.roomId}`))
    .map((entry) => {
      const proposal = entry.kind === 'proposal' ? proposals.get(entry.proposalId) : undefined;
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
        proposal?.speakerSnapshot?.map((speaker) => speaker.name).join('; '),
        proposal?.format,
        proposal?.deliveryLanguage,
        entry.kind === 'proposal' ? entry.assignedLanguage : '',
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
): void {
  const blob = new Blob([`\uFEFF${scheduleCsv(config, entries, proposals, locale)}`], {
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
