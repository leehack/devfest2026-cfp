import { useEffect, useMemo, useRef, useState } from 'react';

import { Link } from '../components/Link';
import { sessionDocumentTitle } from '../components/AppNavigation';
import { PublicSpeakerPhoto } from '../components/PublicSpeakerPhoto';
import { useI18n } from '../i18n/context';
import { formatCalendarDay } from '../i18n';
import { goTo, href } from '../lib/router';
import { track } from '../lib/analytics';
import {
  AGENDA_RETURN_STATE,
  DETAIL_RETURN_STATE,
  agendaEntryLinkId,
  agendaReturnContext,
  historyStateWith,
  historyStateWithout,
  type AgendaReturnContext,
} from '../lib/scheduleHistory';
import {
  loadPublishedSchedule,
  loadSharedSchedule,
  type PublishedScheduleBundle,
  type SharedScheduleBundle,
} from '../lib/schedule';
import { calendarDate } from '@shared/cfp';
import type { CfpRole } from '@shared/cfp';
import { localised } from '@shared/confirmForm';
import { publicEntryTitle, scheduleIcs } from '@shared/calendar';
import {
  SCHEDULE_LANGUAGES,
  scheduleEndTime,
  type PublishedProposalSession,
  type PublishedScheduleEntry,
  type ScheduleLanguage,
} from '@shared/schedule';

function scrollInstantly(top: number) {
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  try {
    window.scrollTo(0, Math.max(0, top));
  } finally {
    root.style.scrollBehavior = previous;
  }
}

interface AgendaFilters {
  day: string;
  room: string;
  language: 'all' | ScheduleLanguage;
}

function plainLinkClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function openSessionFromAgenda(
  event: React.MouseEvent<HTMLAnchorElement>,
  cfpId: string,
  scheduleId: string,
  entryId: string,
  filters: AgendaFilters,
) {
  if (!plainLinkClick(event)) return;
  event.preventDefault();
  const context: AgendaReturnContext = {
    version: 1,
    cfpId,
    scheduleId,
    entryId,
    navigationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scrollY: window.scrollY,
    viewportTop: event.currentTarget.getBoundingClientRect().top,
    filters: { ...filters },
  };
  window.history.replaceState(
    historyStateWith(AGENDA_RETURN_STATE, context),
    '',
    window.location.href,
  );
  goTo(href({ route: 'session', cfpId, entryId }), {
    [DETAIL_RETURN_STATE]: context,
  });
}

function humaniseTaxonomyCode(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function taxonomyLabel(
  value: string,
  label: PublishedProposalSession['categoryLabel'],
  locale: 'en' | 'fr',
): string {
  const resolved = localised(label, locale);
  return resolved && resolved !== value ? resolved : humaniseTaxonomyCode(value);
}

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SchedulePage({
  cfpId,
  cfpName,
  releaseId,
  sharedReleaseId,
  viewerRole,
  accessReady,
  entryId,
  initialBundle,
  onPageLabelChange,
}: {
  cfpId: string;
  cfpName: string;
  releaseId: string | null;
  sharedReleaseId: string | null;
  viewerRole: CfpRole | null;
  accessReady: boolean;
  entryId: string | null;
  initialBundle?: PublishedScheduleBundle | null;
  onPageLabelChange?: (entryId: string, label: string) => void;
}) {
  const { t, locale } = useI18n();
  const previewReleaseId =
    viewerRole && sharedReleaseId && sharedReleaseId !== releaseId ? sharedReleaseId : null;
  const visibleReleaseId = previewReleaseId ?? releaseId;
  const [bundle, setBundle] = useState<PublishedScheduleBundle | null>(initialBundle ?? null);
  const [loaded, setLoaded] = useState(initialBundle !== undefined);
  const [settledReleaseId, setSettledReleaseId] = useState<string | null>(() =>
    initialBundle?.schedule.id === visibleReleaseId ? visibleReleaseId : null,
  );
  const [failed, setFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const [filters, setFilters] = useState<AgendaFilters>(() => ({
    day: initialBundle?.schedule.days[0]?.date ?? '',
    room: 'all',
    language: 'all',
  }));
  const filterStorageKey = visibleReleaseId
    ? `cfp.schedule.filters:${cfpId}:${visibleReleaseId}`
    : '';
  const [restoredFilterKey, setRestoredFilterKey] = useState('');
  const restoredNavigation = useRef('');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSettledReleaseId(null);
    setFailed(false);
    if (!accessReady) return;
    if (!visibleReleaseId) {
      setBundle(null);
      setPreview(false);
      setLoaded(true);
      return;
    }
    if (
      !previewReleaseId &&
      initialBundle !== undefined &&
      initialBundle?.schedule.id === releaseId
    ) {
      setBundle(initialBundle);
      setPreview(false);
      setLoaded(true);
      setSettledReleaseId(visibleReleaseId);
      return;
    }

    const loadPublic = () =>
      releaseId
        ? loadPublishedSchedule(cfpId, releaseId, {
            force: loadAttempt > 0,
            onRevalidate: (updated) => {
              if (!cancelled && !previewReleaseId) {
                setBundle(updated);
              }
            },
          })
        : Promise.resolve(null);
    const loadPreview = async (): Promise<PublishedScheduleBundle | null> => {
      const shared: SharedScheduleBundle = await loadSharedSchedule(cfpId, {
        releaseId: previewReleaseId,
        audience: 'committee',
        force: loadAttempt > 0,
        onRevalidate: (updatedShared) => {
          if (!cancelled && previewReleaseId) {
            if (!updatedShared.schedule) {
              setBundle(null);
            } else {
              setBundle({
                schedule: {
                  ...updatedShared.schedule,
                  publishedAt: updatedShared.schedule.publishedAt ?? updatedShared.schedule.sharedAt,
                },
                entries: updatedShared.entries,
              });
            }
          }
        },
        onError: async () => {
          if (!cancelled && previewReleaseId) {
            try {
              const fallback = await loadPublic();
              if (!cancelled) {
                setBundle(fallback);
                setPreview(false);
              }
            } catch {
              if (!cancelled) {
                setBundle(null);
                setFailed(true);
              }
            }
          }
        },
      });
      if (!shared.schedule) return null;
      return {
        schedule: {
          ...shared.schedule,
          publishedAt: shared.schedule.publishedAt ?? shared.schedule.sharedAt,
        },
        entries: shared.entries,
      };
    };

    (previewReleaseId ? loadPreview() : loadPublic())
      .then((next) => {
        if (cancelled) return;
        setBundle(next);
        setPreview(Boolean(previewReleaseId && next));
      })
      .catch(async () => {
        // A live public programme remains a safe, useful fallback if the
        // committee-only projection is temporarily unavailable.
        if (!previewReleaseId || !releaseId) {
          if (!cancelled) setFailed(true);
          return;
        }
        try {
          const next = await loadPublic();
          if (!cancelled) {
            setBundle(next);
            setPreview(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
          setSettledReleaseId(visibleReleaseId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessReady, cfpId, initialBundle, loadAttempt, previewReleaseId, releaseId, visibleReleaseId]);

  useEffect(() => {
    if (accessReady && loaded && visibleReleaseId && bundle?.schedule.id === visibleReleaseId) {
      track('schedule_viewed', {
        cfp_id: cfpId,
        view: preview ? 'committee_preview' : entryId ? 'session' : 'agenda',
      });
    }
  }, [accessReady, bundle?.schedule.id, cfpId, entryId, loaded, preview, visibleReleaseId]);

  useEffect(() => {
    if (!filterStorageKey) {
      setRestoredFilterKey('');
      return;
    }
    let saved: Partial<AgendaFilters> = {};
    try {
      const value = window.sessionStorage.getItem(filterStorageKey);
      saved = value ? (JSON.parse(value) as Partial<AgendaFilters>) : {};
    } catch {
      // A blocked or malformed browser store should never block the programme.
    }
    const agendaReturn = agendaReturnContext(AGENDA_RETURN_STATE);
    const returnedFilters =
      agendaReturn?.cfpId === cfpId && agendaReturn.scheduleId === visibleReleaseId
        ? agendaReturn.filters
        : null;
    setFilters((current) =>
      returnedFilters ?? {
        day: typeof saved.day === 'string' ? saved.day : current.day,
        room: typeof saved.room === 'string' ? saved.room : current.room,
        language:
          saved.language === 'all' ||
          saved.language === 'en' ||
          saved.language === 'fr' ||
          saved.language === 'bilingual'
            ? saved.language
            : current.language,
      },
    );
    setRestoredFilterKey(filterStorageKey);
  }, [cfpId, filterStorageKey, visibleReleaseId]);

  useEffect(() => {
    if (!filterStorageKey || restoredFilterKey !== filterStorageKey) return;
    try {
      window.sessionStorage.setItem(filterStorageKey, JSON.stringify(filters));
    } catch {
      // Filters still work for this render when browser storage is unavailable.
    }
  }, [filterStorageKey, filters, restoredFilterKey]);

  useEffect(() => {
    if (!bundle || bundle.schedule.id !== visibleReleaseId) return;
    const languages = new Set(
      bundle.entries.flatMap((entry) =>
        entry.kind === 'proposal'
          ? [entry.session.language]
          : entry.language
            ? [entry.language]
            : [],
      ),
    );
    setFilters((current) => ({
      day: bundle.schedule.days.some((day) => day.date === current.day)
        ? current.day
        : (bundle.schedule.days[0]?.date ?? ''),
      room: bundle.schedule.rooms.some((room) => room.id === current.room)
        ? current.room
        : 'all',
      language:
        current.language === 'all' || languages.has(current.language)
          ? current.language
          : 'all',
    }));
  }, [bundle, visibleReleaseId]);

  useEffect(() => {
    if (entryId) {
      restoredNavigation.current = '';
      return;
    }
    if (!bundle || !filterStorageKey || restoredFilterKey !== filterStorageKey) return;
    const context = agendaReturnContext(AGENDA_RETURN_STATE);
    if (!context || context.cfpId !== cfpId) return;
    if (context.scheduleId !== visibleReleaseId) {
      window.history.replaceState(
        historyStateWithout(AGENDA_RETURN_STATE),
        '',
        window.location.href,
      );
      document.getElementById('main-content')?.focus();
      return;
    }
    // The server can initially render the public release while an authenticated
    // committee member's newer shared preview is still loading. Do not consume
    // the return marker against that temporary bundle.
    if (!loaded || settledReleaseId !== visibleReleaseId) return;
    if (bundle.schedule.id !== visibleReleaseId) {
      window.history.replaceState(
        historyStateWithout(AGENDA_RETURN_STATE),
        '',
        window.location.href,
      );
      document.getElementById('main-content')?.focus();
      return;
    }
    if (restoredNavigation.current === context.navigationId) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = document.getElementById(agendaEntryLinkId(context.entryId));
        if (!target) {
          restoredNavigation.current = context.navigationId;
          scrollInstantly(context.scrollY);
          document.getElementById('main-content')?.focus({ preventScroll: true });
          window.history.replaceState(
            historyStateWithout(AGENDA_RETURN_STATE),
            '',
            window.location.href,
          );
          return;
        }
        restoredNavigation.current = context.navigationId;
        const top = window.scrollY + target.getBoundingClientRect().top - context.viewportTop;
        scrollInstantly(top);
        target.focus({ preventScroll: true });
        window.history.replaceState(
          historyStateWithout(AGENDA_RETURN_STATE),
          '',
          window.location.href,
        );
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [bundle, cfpId, entryId, filterStorageKey, loaded, restoredFilterKey, settledReleaseId, visibleReleaseId]);

  useEffect(() => {
    if (!entryId || !loaded) return;
    const entry = bundle?.entries.find((candidate) => candidate.id === entryId);
    const label = entry
      ? sessionDocumentTitle(publicEntryTitle(entry, locale), cfpName)
      : `${t.schedule.title} — ${cfpName}`;
    document.title = label;
    onPageLabelChange?.(entryId, label);
  }, [bundle, cfpName, entryId, loaded, locale, onPageLabelChange, t.schedule.title]);

  if (!accessReady || !loaded) return <p className="muted">{t.app.loading}</p>;
  if (failed) {
    return (
      <section className="schedule-empty">
        <p className="field__error" role="alert">{t.errors.unavailable}</p>
        <button type="button" className="btn" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          {t.schedule.reload}
        </button>
      </section>
    );
  }
  if (!bundle) return <section className="schedule-empty"><h2>{t.schedule.title}</h2><p>{t.schedule.noPublished}</p></section>;
  if (entryId) {
    const entry = bundle.entries.find((candidate) => candidate.id === entryId);
    return entry ? (
      <SessionDetail
        cfpId={cfpId}
        cfpName={cfpName}
        bundle={bundle}
        entry={entry}
        preview={preview}
      />
    ) : (
      <section className="schedule-empty"><p>{t.schedule.sessionNotFound}</p><Link className="btn" to={href({ route: 'schedule', cfpId })}>{t.schedule.back}</Link></section>
    );
  }
  return (
    <PublicAgenda
      cfpId={cfpId}
      cfpName={cfpName}
      bundle={bundle}
      filters={filters}
      onFilters={setFilters}
      preview={preview}
    />
  );
}

function PublicAgenda({
  cfpId,
  cfpName,
  bundle,
  filters,
  onFilters,
  preview,
}: {
  cfpId: string;
  cfpName: string;
  bundle: PublishedScheduleBundle;
  filters: AgendaFilters;
  onFilters: (next: AgendaFilters | ((current: AgendaFilters) => AgendaFilters)) => void;
  preview: boolean;
}) {
  const { t, locale } = useI18n();
  const { schedule, entries } = bundle;
  const { day, room, language } = filters;
  const rooms = new Map(schedule.rooms.map((item) => [item.id, localised(item.name, locale)]));
  const roomOrder = useMemo(
    () => new Map(schedule.rooms.map((item, index) => [item.id, index])),
    [schedule.rooms],
  );
  const availableLanguages = SCHEDULE_LANGUAGES.filter((value) =>
    entries.some((entry) =>
      entry.kind === 'proposal' ? entry.session.language === value : entry.language === value,
    ),
  );
  const visible = useMemo(
    () =>
      entries
        .filter((entry) => entry.date === day)
        .filter((entry) => room === 'all' || entry.roomId === room)
        .filter(
          (entry) =>
            language === 'all' ||
            (entry.kind === 'custom'
              ? entry.language === undefined || entry.language === language
              : entry.session.language === language),
        )
        .sort(
          (a, b) =>
            a.startsAt.localeCompare(b.startsAt) ||
            (roomOrder.get(a.roomId) ?? Number.MAX_SAFE_INTEGER) -
              (roomOrder.get(b.roomId) ?? Number.MAX_SAFE_INTEGER),
        ),
    [day, entries, language, room, roomOrder],
  );
  const timeGroups = useMemo(() => {
    const groups = new Map<string, PublishedScheduleEntry[]>();
    for (const entry of visible) {
      const group = groups.get(entry.startsAt);
      if (group) group.push(entry);
      else groups.set(entry.startsAt, [entry]);
    }
    return [...groups].map(([startsAt, groupEntries]) => ({ startsAt, entries: groupEntries }));
  }, [visible]);

  const selectDay = (nextDay: string) => {
    onFilters((current) => ({ ...current, day: nextDay }));
  };

  const moveDay = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % schedule.days.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + schedule.days.length) % schedule.days.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = schedule.days.length - 1;
    else return;
    event.preventDefault();
    selectDay(schedule.days[next].date);
    document.getElementById(`schedule-day-${next}`)?.focus();
  };

  const saveCalendar = () => {
    track('schedule_calendar_downloaded', { cfp_id: cfpId, scope: 'full' });
    download(
      `${cfpId}-schedule.ics`,
      scheduleIcs(cfpId, cfpName, schedule, entries, locale, window.location.origin),
      'text/calendar;charset=utf-8',
    );
  };

  return (
    <div className="public-schedule">
      <header className="public-schedule__hero">
        <div className="public-schedule__rail" aria-hidden="true"><i /><i /><i /><i /></div>
        <div>
          <p>{cfpName}</p>
          <h2>{preview ? t.schedule.committeePreviewTitle : t.schedule.title}</h2>
          <span>
            {preview ? t.schedule.committeePreviewHelp : t.schedule.publicHelp}{' '}
            <strong>{schedule.timeZone}</strong>
          </span>
        </div>
        {preview ? (
          <span className="schedule-preview-badge">{t.schedule.notPublic}</span>
        ) : (
          <button type="button" className="btn btn--primary" onClick={saveCalendar}>
            {t.schedule.calendar}
          </button>
        )}
      </header>

      {preview && (
        <aside
          className="committee-preview-next"
          role="note"
          aria-labelledby="committee-preview-next-title"
        >
          <h3 id="committee-preview-next-title">{t.schedule.committeeNextTitle}</h3>
          <p>{t.schedule.committeeNextHelp}</p>
        </aside>
      )}

      <div className="public-schedule__days" role="tablist" aria-label={t.schedule.days}>
        {schedule.days.map((item, index) => (
          <button
            id={`schedule-day-${index}`}
            type="button"
            role="tab"
            aria-selected={day === item.date}
            aria-controls="schedule-agenda"
            tabIndex={day === item.date ? 0 : -1}
            className={day === item.date ? 'public-schedule__day public-schedule__day--active' : 'public-schedule__day'}
            key={item.date}
            onClick={() => selectDay(item.date)}
            onKeyDown={(event) => moveDay(event, index)}
          >
            {formatCalendarDay(calendarDate(item.date)!, locale)}
          </button>
        ))}
      </div>

      <div className="public-schedule__filters">
        <label>{t.schedule.room}<select value={room} onChange={(event) => { onFilters((current) => ({ ...current, room: event.target.value })); track('schedule_filtered', { cfp_id: cfpId, filter: 'room' }); }}><option value="all">{t.schedule.allRooms}</option>{schedule.rooms.map((item) => <option key={item.id} value={item.id}>{rooms.get(item.id)}</option>)}</select></label>
        <label>{t.schedule.language}<select value={language} onChange={(event) => { onFilters((current) => ({ ...current, language: event.target.value as AgendaFilters['language'] })); track('schedule_filtered', { cfp_id: cfpId, filter: 'language' }); }}><option value="all">{t.schedule.allLanguages}</option>{availableLanguages.map((value) => <option key={value} value={value}>{t.schedule.languageNames[value]}</option>)}</select></label>
      </div>

      <div
        id="schedule-agenda"
        role="tabpanel"
        aria-labelledby={`schedule-day-${Math.max(schedule.days.findIndex((item) => item.date === day), 0)}`}
      >
        {visible.length ? (
          room === 'all' ? (
            <ol className="agenda-list agenda-list--all-rooms">
              {timeGroups.map((group) => (
                <li
                  className="agenda-group"
                  key={group.startsAt}
                  aria-label={t.schedule.sessionsAt(group.startsAt)}
                >
                  <time dateTime={`${day}T${group.startsAt}`}>{group.startsAt}</time>
                  <span className="agenda-item__line" aria-hidden="true" />
                  <ol className="agenda-group__sessions">
                    {group.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className={`agenda-item agenda-item--card agenda-item--room-${(roomOrder.get(entry.roomId) ?? 0) % 4}${entry.kind === 'proposal' && entry.cancelled ? ' agenda-item--cancelled' : ''}`}
                      >
                        <AgendaEntryBody
                          cfpId={cfpId}
                          scheduleId={schedule.id}
                          photosEnabled={!preview}
                          filters={filters}
                          entry={entry}
                          roomName={rooms.get(entry.roomId) ?? entry.roomId}
                          showRange
                        />
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="agenda-list agenda-list--one-room">
              {visible.map((entry) => (
                <li key={entry.id} className={`agenda-item${entry.kind === 'proposal' && entry.cancelled ? ' agenda-item--cancelled' : ''}`}>
                  <time dateTime={`${entry.date}T${entry.startsAt}`}>
                    {entry.startsAt}–{scheduleEndTime(entry)}
                  </time>
                  <span className="agenda-item__line" aria-hidden="true" />
                  <AgendaEntryBody
                    cfpId={cfpId}
                    scheduleId={schedule.id}
                    photosEnabled={!preview}
                    filters={filters}
                    entry={entry}
                    roomName={rooms.get(entry.roomId) ?? entry.roomId}
                  />
                </li>
              ))}
            </ol>
          )
        ) : <p className="schedule-empty">{t.schedule.noMatches}</p>}
      </div>
    </div>
  );
}

function AgendaEntryBody({
  cfpId,
  scheduleId,
  photosEnabled,
  filters,
  entry,
  roomName,
  showRange = false,
}: {
  cfpId: string;
  scheduleId: string;
  photosEnabled: boolean;
  filters: AgendaFilters;
  entry: PublishedScheduleEntry;
  roomName: string;
  showRange?: boolean;
}) {
  const { t, locale } = useI18n();
  const speakers = entry.kind === 'proposal' ? entry.session.speakers : entry.speakers ?? [];
  const category = entry.kind === 'proposal'
    ? taxonomyLabel(entry.session.category, entry.session.categoryLabel, locale)
    : t.schedule.types[entry.customType];
  return (
    <article className="agenda-item__body">
      <div className="agenda-item__meta">
        {showRange && (
          <time className="agenda-item__range" dateTime={`${entry.date}T${entry.startsAt}`}>
            {entry.startsAt}–{scheduleEndTime(entry)}
          </time>
        )}
        <span className="agenda-item__room">{roomName}</span>
        <span
          className="taxonomy-chip agenda-item__category"
          aria-label={`${entry.kind === 'proposal' ? t.proposal.category : t.schedule.itemType}: ${category}`}
        >
          {category}
        </span>
        {entry.kind === 'proposal' && <span className={`language-chip language-chip--${entry.session.language}`}>{t.schedule.languageNames[entry.session.language]}</span>}
        {entry.kind === 'custom' && entry.language && <span className={`language-chip language-chip--${entry.language}`}>{t.schedule.languageNames[entry.language]}</span>}
      </div>
      <h3>
        <Link
          id={agendaEntryLinkId(entry.id)}
          to={href({ route: 'session', cfpId, entryId: entry.id })}
          onClick={(event) =>
            openSessionFromAgenda(event, cfpId, scheduleId, entry.id, filters)
          }
        >
          {publicEntryTitle(entry, locale)}
        </Link>
      </h3>
      {speakers.length > 0 && (
        <div className="agenda-item__speakers">
          <span className="agenda-item__speaker-photos">
            {speakers.slice(0, 3).map((speaker, index) => (
              <PublicSpeakerPhoto
                key={`${speaker.name}-${index}`}
                cfpId={cfpId}
                releaseId={scheduleId}
                entryId={entry.id}
                speakerIndex={index}
                name={speaker.name}
                photoRef={speaker.photoRef}
                enabled={photosEnabled}
                compact
              />
            ))}
          </span>
          <p>{speakers.map((speaker) => speaker.name).join(', ')}</p>
        </div>
      )}
      {entry.kind === 'proposal' && entry.cancelled && <strong className="agenda-item__cancelled">{t.schedule.cancelled}</strong>}
    </article>
  );
}

function SessionDetail({ cfpId, cfpName, bundle, entry, preview }: { cfpId: string; cfpName: string; bundle: PublishedScheduleBundle; entry: PublishedScheduleEntry; preview: boolean }) {
  const { t, locale } = useI18n();
  const room = bundle.schedule.rooms.find((candidate) => candidate.id === entry.roomId);
  const speakers = entry.kind === 'proposal' ? entry.session.speakers : entry.speakers ?? [];
  const category = entry.kind === 'proposal'
    ? taxonomyLabel(entry.session.category, entry.session.categoryLabel, locale)
    : t.schedule.types[entry.customType];
  const oneCalendar = () => {
    track('schedule_calendar_downloaded', { cfp_id: cfpId, scope: 'session' });
    download(
      `${cfpId}-${entry.id}.ics`,
      scheduleIcs(cfpId, cfpName, bundle.schedule, [entry], locale, window.location.origin),
      'text/calendar;charset=utf-8',
    );
  };
  const backToAgenda = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!plainLinkClick(event)) return;
    const context = agendaReturnContext(DETAIL_RETURN_STATE);
    if (
      !context ||
      context.cfpId !== cfpId ||
      context.scheduleId !== bundle.schedule.id ||
      context.entryId !== entry.id
    ) {
      return;
    }
    event.preventDefault();
    window.history.back();
  };
  return (
    <article className={`session-detail${entry.kind === 'proposal' && entry.cancelled ? ' session-detail--cancelled' : ''}`}>
      <Link
        className="session-detail__back"
        to={href({ route: 'schedule', cfpId })}
        onClick={backToAgenda}
      >
        ← {t.schedule.back}
      </Link>
      <div className="session-detail__meta">
        <time dateTime={`${entry.date}T${entry.startsAt}`}>{formatCalendarDay(calendarDate(entry.date)!, locale)} · {entry.startsAt}–{scheduleEndTime(entry)}</time>
        <span>{room ? localised(room.name, locale) : entry.roomId}</span>
        {entry.kind === 'custom' && (
          <span className="taxonomy-chip" aria-label={`${t.schedule.itemType}: ${category}`}>
            {category}
          </span>
        )}
        {entry.kind === 'proposal' && <span className={`language-chip language-chip--${entry.session.language}`}>{t.schedule.languageNames[entry.session.language]}</span>}
        {entry.kind === 'custom' && entry.language && <span className={`language-chip language-chip--${entry.language}`}>{t.schedule.languageNames[entry.language]}</span>}
      </div>
      <h2>{publicEntryTitle(entry, locale)}</h2>
      {entry.kind === 'proposal' && (
        <dl className="session-detail__facts" aria-label={t.schedule.sessionFacts}>
          <div>
            <dt>{t.proposal.category}</dt>
            <dd>{category}</dd>
          </div>
          <div>
            <dt>{t.proposal.format}</dt>
            <dd>{taxonomyLabel(entry.session.format, entry.session.formatLabel, locale)}</dd>
          </div>
          <div>
            <dt>{t.proposal.level}</dt>
            <dd>{taxonomyLabel(entry.session.level, entry.session.levelLabel, locale)}</dd>
          </div>
        </dl>
      )}
      {entry.kind === 'proposal' && entry.cancelled && <div className="session-cancelled" role="status"><strong>{t.schedule.cancelled}</strong><p>{t.schedule.cancelledHelp}</p></div>}
      <p className="session-detail__abstract">{entry.kind === 'proposal' ? entry.session.abstract : localised(entry.description, locale)}</p>
      {speakers.length > 0 && (
        <section className="session-speakers">
          <h3>{t.schedule.speakers}</h3>
          {speakers.map((speaker, index) => (
            <div className="session-speaker" key={`${speaker.name}-${index}`}>
              <PublicSpeakerPhoto
                cfpId={cfpId}
                releaseId={bundle.schedule.id}
                entryId={entry.id}
                speakerIndex={index}
                name={speaker.name}
                photoRef={speaker.photoRef}
                enabled={!preview}
              />
              <div><h4>{speaker.name}</h4>{(speaker.jobTitle || speaker.company) && <p>{[speaker.jobTitle, speaker.company].filter(Boolean).join(' · ')}</p>}{speaker.bio && <p>{speaker.bio}</p>}</div>
            </div>
          ))}
        </section>
      )}
      {preview ? (
        <p className="schedule-preview-note" role="status">
          <strong>{t.schedule.committeePreviewTitle}</strong>
          <span>{t.schedule.committeePreviewDetail}</span>
          <span>{t.schedule.committeeNextHelp}</span>
        </p>
      ) : (
        <button type="button" className="btn btn--primary" onClick={oneCalendar}>{t.schedule.sessionCalendar}</button>
      )}
    </article>
  );
}
