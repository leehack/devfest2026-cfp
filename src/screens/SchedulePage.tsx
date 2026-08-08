import { useEffect, useMemo, useState } from 'react';

import { Link } from '../components/Link';
import { sessionDocumentTitle } from '../components/AppNavigation';
import { useI18n } from '../i18n/context';
import { formatCalendarDay } from '../i18n';
import { href } from '../lib/router';
import { track } from '../lib/analytics';
import { loadPublishedSchedule, type PublishedScheduleBundle } from '../lib/schedule';
import { calendarDate } from '@shared/cfp';
import { localised } from '@shared/confirmForm';
import { publicEntryTitle, scheduleIcs } from '@shared/calendar';
import { scheduleEndTime, type PublishedScheduleEntry } from '@shared/schedule';

type PublicLanguage = 'en' | 'fr' | 'bilingual';

interface AgendaFilters {
  day: string;
  room: string;
  language: 'all' | PublicLanguage;
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
  entryId,
  initialBundle,
}: {
  cfpId: string;
  cfpName: string;
  releaseId: string | null;
  entryId: string | null;
  initialBundle?: PublishedScheduleBundle | null;
}) {
  const { t, locale } = useI18n();
  const [bundle, setBundle] = useState<PublishedScheduleBundle | null>(initialBundle ?? null);
  const [loaded, setLoaded] = useState(initialBundle !== undefined);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<AgendaFilters>(() => ({
    day: initialBundle?.schedule.days[0]?.date ?? '',
    room: 'all',
    language: 'all',
  }));
  const filterStorageKey = releaseId ? `cfp.schedule.filters:${cfpId}:${releaseId}` : '';
  const [restoredFilterKey, setRestoredFilterKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    if (!releaseId) {
      setBundle(null);
      setLoaded(true);
      return;
    }
    if (initialBundle !== undefined && initialBundle?.schedule.id === releaseId) {
      setBundle(initialBundle);
      setLoaded(true);
      return;
    }
    loadPublishedSchedule(cfpId, releaseId)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, initialBundle, releaseId]);

  useEffect(() => {
    if (releaseId) track('schedule_viewed', { cfp_id: cfpId, view: entryId ? 'session' : 'agenda' });
  }, [cfpId, entryId, releaseId]);

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
    setFilters((current) => ({
      day: typeof saved.day === 'string' ? saved.day : current.day,
      room: typeof saved.room === 'string' ? saved.room : current.room,
      language:
        saved.language === 'all' ||
        saved.language === 'en' ||
        saved.language === 'fr' ||
        saved.language === 'bilingual'
          ? saved.language
          : current.language,
    }));
    setRestoredFilterKey(filterStorageKey);
  }, [filterStorageKey]);

  useEffect(() => {
    if (!filterStorageKey || restoredFilterKey !== filterStorageKey) return;
    try {
      window.sessionStorage.setItem(filterStorageKey, JSON.stringify(filters));
    } catch {
      // Filters still work for this render when browser storage is unavailable.
    }
  }, [filterStorageKey, filters, restoredFilterKey]);

  useEffect(() => {
    if (!bundle) return;
    const languages = new Set(
      bundle.entries.flatMap((entry) =>
        entry.kind === 'proposal' ? [entry.session.language] : [],
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
  }, [bundle]);

  useEffect(() => {
    if (!entryId) return;
    const entry = bundle?.entries.find((candidate) => candidate.id === entryId);
    document.title = entry
      ? sessionDocumentTitle(publicEntryTitle(entry, locale), cfpName)
      : `${t.schedule.title} — ${cfpName}`;
  }, [bundle, cfpName, entryId, locale, t.schedule.title]);

  if (!loaded) return <p className="muted">{t.app.loading}</p>;
  if (failed) return <p className="field__error" role="alert">{t.errors.unavailable}</p>;
  if (!bundle) return <section className="schedule-empty"><h2>{t.schedule.title}</h2><p>{t.schedule.noPublished}</p></section>;
  if (entryId) {
    const entry = bundle.entries.find((candidate) => candidate.id === entryId);
    return entry ? (
      <SessionDetail cfpId={cfpId} cfpName={cfpName} bundle={bundle} entry={entry} />
    ) : (
      <section className="schedule-empty"><p>{t.errors.notFound}</p><Link className="btn" to={href({ route: 'schedule', cfpId })}>{t.schedule.back}</Link></section>
    );
  }
  return (
    <PublicAgenda
      cfpId={cfpId}
      cfpName={cfpName}
      bundle={bundle}
      filters={filters}
      onFilters={setFilters}
    />
  );
}

function PublicAgenda({
  cfpId,
  cfpName,
  bundle,
  filters,
  onFilters,
}: {
  cfpId: string;
  cfpName: string;
  bundle: PublishedScheduleBundle;
  filters: AgendaFilters;
  onFilters: (next: AgendaFilters | ((current: AgendaFilters) => AgendaFilters)) => void;
}) {
  const { t, locale } = useI18n();
  const { schedule, entries } = bundle;
  const { day, room, language } = filters;
  const rooms = new Map(schedule.rooms.map((item) => [item.id, localised(item.name, locale)]));
  const roomOrder = useMemo(
    () => new Map(schedule.rooms.map((item, index) => [item.id, index])),
    [schedule.rooms],
  );
  const availableLanguages = (['en', 'fr', 'bilingual'] as const).filter((value) =>
    entries.some((entry) => entry.kind === 'proposal' && entry.session.language === value),
  );
  const visible = useMemo(
    () =>
      entries
        .filter((entry) => entry.date === day)
        .filter((entry) => room === 'all' || entry.roomId === room)
        .filter(
          (entry) =>
            language === 'all' ||
            entry.kind === 'custom' ||
            entry.session.language === language,
        )
        .sort(
          (a, b) =>
            a.startsAt.localeCompare(b.startsAt) ||
            (roomOrder.get(a.roomId) ?? Number.MAX_SAFE_INTEGER) -
              (roomOrder.get(b.roomId) ?? Number.MAX_SAFE_INTEGER),
        ),
    [day, entries, language, room, roomOrder],
  );

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
          <h2>{t.schedule.title}</h2>
          <span>{t.schedule.publicHelp} <strong>{schedule.timeZone}</strong></span>
        </div>
        <button type="button" className="btn btn--primary" onClick={saveCalendar}>{t.schedule.calendar}</button>
      </header>

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
        <label>{t.schedule.language}<select value={language} onChange={(event) => { onFilters((current) => ({ ...current, language: event.target.value as AgendaFilters['language'] })); track('schedule_filtered', { cfp_id: cfpId, filter: 'language' }); }}><option value="all">{t.schedule.allLanguages}</option>{availableLanguages.map((value) => <option key={value} value={value}>{t.enums.deliveryLanguage[value]}</option>)}</select></label>
      </div>

      <div
        id="schedule-agenda"
        role="tabpanel"
        aria-labelledby={`schedule-day-${Math.max(schedule.days.findIndex((item) => item.date === day), 0)}`}
      >
        {visible.length ? (
          <ol className="agenda-list">
          {visible.map((entry) => (
            <li key={entry.id} className={`agenda-item${entry.kind === 'proposal' && entry.cancelled ? ' agenda-item--cancelled' : ''}`}>
              <time dateTime={`${entry.date}T${entry.startsAt}`}>
                {entry.startsAt}–{scheduleEndTime(entry)}
              </time>
              <span className="agenda-item__line" aria-hidden="true" />
              <div className="agenda-item__body">
                <div className="agenda-item__meta">
                  <span>{rooms.get(entry.roomId)}</span>
                  {entry.kind === 'proposal' && <span className={`language-chip language-chip--${entry.session.language}`}>{t.enums.deliveryLanguage[entry.session.language]}</span>}
                  {entry.kind === 'custom' && <span>{t.schedule.types[entry.customType]}</span>}
                </div>
                <h3><Link to={href({ route: 'session', cfpId, entryId: entry.id })}>{publicEntryTitle(entry, locale)}</Link></h3>
                {entry.kind === 'proposal' && <p>{entry.session.speakers.map((speaker) => speaker.name).join(', ')}</p>}
                {entry.kind === 'proposal' && entry.cancelled && <strong className="agenda-item__cancelled">{t.schedule.cancelled}</strong>}
              </div>
            </li>
          ))}
          </ol>
        ) : <p className="schedule-empty">{t.schedule.noMatches}</p>}
      </div>
    </div>
  );
}

function SessionDetail({ cfpId, cfpName, bundle, entry }: { cfpId: string; cfpName: string; bundle: PublishedScheduleBundle; entry: PublishedScheduleEntry }) {
  const { t, locale } = useI18n();
  const room = bundle.schedule.rooms.find((candidate) => candidate.id === entry.roomId);
  const oneCalendar = () => {
    track('schedule_calendar_downloaded', { cfp_id: cfpId, scope: 'session' });
    download(
      `${cfpId}-${entry.id}.ics`,
      scheduleIcs(cfpId, cfpName, bundle.schedule, [entry], locale, window.location.origin),
      'text/calendar;charset=utf-8',
    );
  };
  return (
    <article className={`session-detail${entry.kind === 'proposal' && entry.cancelled ? ' session-detail--cancelled' : ''}`}>
      <Link className="session-detail__back" to={href({ route: 'schedule', cfpId })}>← {t.schedule.back}</Link>
      <div className="session-detail__meta">
        <time dateTime={`${entry.date}T${entry.startsAt}`}>{formatCalendarDay(calendarDate(entry.date)!, locale)} · {entry.startsAt}–{scheduleEndTime(entry)}</time>
        <span>{room ? localised(room.name, locale) : entry.roomId}</span>
        {entry.kind === 'proposal' && <span className={`language-chip language-chip--${entry.session.language}`}>{t.enums.deliveryLanguage[entry.session.language]}</span>}
      </div>
      <h2>{publicEntryTitle(entry, locale)}</h2>
      {entry.kind === 'proposal' && entry.cancelled && <div className="session-cancelled" role="status"><strong>{t.schedule.cancelled}</strong><p>{t.schedule.cancelledHelp}</p></div>}
      <p className="session-detail__abstract">{entry.kind === 'proposal' ? entry.session.abstract : localised(entry.description, locale)}</p>
      {entry.kind === 'proposal' && entry.session.speakers.length > 0 && (
        <section className="session-speakers">
          <h3>{t.schedule.speakers}</h3>
          {entry.session.speakers.map((speaker) => (
            <div className="session-speaker" key={speaker.uid}>
              <div className="session-speaker__monogram" aria-hidden="true">{speaker.name.slice(0, 1)}</div>
              <div><h4>{speaker.name}</h4>{(speaker.jobTitle || speaker.company) && <p>{[speaker.jobTitle, speaker.company].filter(Boolean).join(' · ')}</p>}<p>{speaker.bio}</p></div>
            </div>
          ))}
        </section>
      )}
      <button type="button" className="btn btn--primary" onClick={oneCalendar}>{t.schedule.sessionCalendar}</button>
    </article>
  );
}
