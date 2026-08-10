export interface AgendaReturnContext {
  version: 1;
  cfpId: string;
  scheduleId: string;
  entryId: string;
  navigationId: string;
  scrollY: number;
  viewportTop: number;
  filters: {
    day: string;
    room: string;
    language: 'all' | 'en' | 'fr' | 'bilingual';
  };
}

export const AGENDA_RETURN_STATE = 'scheduleAgendaReturn';
export const DETAIL_RETURN_STATE = 'scheduleDetailReturn';

function historyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function agendaReturnContext(
  key: typeof AGENDA_RETURN_STATE | typeof DETAIL_RETURN_STATE,
  state: unknown = window.history.state,
): AgendaReturnContext | null {
  const value = historyObject(state)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AgendaReturnContext>;
  return candidate.version === 1 &&
    typeof candidate.cfpId === 'string' &&
    candidate.cfpId.length > 0 &&
    typeof candidate.scheduleId === 'string' &&
    candidate.scheduleId.length > 0 &&
    typeof candidate.entryId === 'string' &&
    candidate.entryId.length > 0 &&
    typeof candidate.navigationId === 'string' &&
    candidate.navigationId.length > 0 &&
    typeof candidate.scrollY === 'number' &&
    Number.isFinite(candidate.scrollY) &&
    candidate.scrollY >= 0 &&
    typeof candidate.viewportTop === 'number' &&
    Number.isFinite(candidate.viewportTop) &&
    candidate.filters !== null &&
    typeof candidate.filters === 'object' &&
    typeof candidate.filters.day === 'string' &&
    typeof candidate.filters.room === 'string' &&
    (candidate.filters.language === 'all' ||
      candidate.filters.language === 'en' ||
      candidate.filters.language === 'fr' ||
      candidate.filters.language === 'bilingual')
    ? (candidate as AgendaReturnContext)
    : null;
}

export function historyStateWith(key: string, value: unknown): Record<string, unknown> {
  return { ...historyObject(window.history.state), [key]: value };
}

export function historyStateWithout(key: string): Record<string, unknown> {
  const next = { ...historyObject(window.history.state) };
  delete next[key];
  return next;
}

export function agendaEntryLinkId(entryId: string): string {
  return `schedule-entry-${entryId}`;
}
