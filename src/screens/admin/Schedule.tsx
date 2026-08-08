import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type CSSProperties,
} from 'react';

import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import { formatCalendarDay } from '../../i18n';
import { calendarDate } from '@shared/cfp';
import { localised } from '@shared/confirmForm';
import {
  CUSTOM_SCHEDULE_TYPES,
  scheduleConflicts,
  suggestedDuration,
  type CustomScheduleType,
  type ScheduleConfig,
  type ScheduleEntry,
  type ScheduleRoom,
} from '@shared/schedule';
import type { ProposalRow } from '../../lib/roles';
import { loadAllProposals, loadCfp } from '../../lib/roles';
import {
  loadScheduleDraft,
  publishSchedule,
  removeScheduleEntry,
  setScheduleConfig,
  upsertScheduleEntry,
} from '../../lib/schedule';
import { scheduleError } from '../../lib/errors';
import { track } from '../../lib/analytics';
import { Result } from './Result';
import { downloadScheduleCsv } from './scheduleExport';

const SLOT_MINUTES = 15;
const SLOT_HEIGHT = 30;

type DragPayload = { kind: 'proposal'; proposalId: string } | { kind: 'entry'; entryId: string };

function datesBetween(start: string, end: string): string[] {
  const first = calendarDate(start);
  const last = calendarDate(end || start);
  if (!first || !last || first > last) return [];
  const dates: string[] = [];
  for (let at = first.getTime(); at <= last.getTime() && dates.length < 10; at += 86_400_000) {
    dates.push(new Date(at).toISOString().slice(0, 10));
  }
  return dates;
}

function initialConfig(cfp: Awaited<ReturnType<typeof loadCfp>>): ScheduleConfig {
  const today = new Date().toISOString().slice(0, 10);
  const start = cfp?.eventStartDate ?? cfp?.eventDate ?? today;
  const end = cfp?.eventEndDate ?? start;
  return {
    timeZone: cfp?.timeZone ?? 'America/Toronto',
    revision: 0,
    days: datesBetween(start, end).map((date) => ({
      date,
      startsAt: '09:00',
      endsAt: '17:00',
    })),
    rooms: [{ id: 'main', name: { en: cfp?.venue || 'Main room', fr: 'Salle principale' } }],
  };
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const timeOf = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

function proposalName(row: ProposalRow): string {
  return (row.speakerSnapshot ?? []).map((speaker) => speaker.name).filter(Boolean).join(', ');
}

function roomName(room: ScheduleRoom, locale: 'en' | 'fr'): string {
  return localised(room.name, locale) || room.id;
}

function entryTitle(entry: ScheduleEntry, proposals: Map<string, ProposalRow>, locale: 'en' | 'fr') {
  return entry.kind === 'proposal'
    ? proposals.get(entry.proposalId)?.title || entry.proposalId
    : localised(entry.title, locale);
}

function dayAfter(value: string): string {
  const date = calendarDate(value);
  if (!date) return new Date().toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const focusable = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useModalFocus(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    first.focus({ preventScroll: true });

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter(
        (element) => !element.hidden && element.getClientRects().length > 0,
      );
      if (!controls.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const firstControl = controls[0];
      const lastControl = controls.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstControl || !dialog.contains(active))) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && active === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener('keydown', containFocus);
    return () => {
      document.removeEventListener('keydown', containFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return dialogRef;
}

export function Schedule({
  cfpId,
  onPublished,
}: {
  cfpId: string;
  onPublished?: () => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [workingConfig, setWorkingConfig] = useState<ScheduleConfig | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [reviewingPublish, setReviewingPublish] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setError('');
    try {
      const [cfp, draft, proposalRows] = await Promise.all([
        loadCfp(cfpId),
        loadScheduleDraft(cfpId),
        loadAllProposals(cfpId),
      ]);
      if (request !== generation.current) return;
      const next = draft.config ?? initialConfig(cfp);
      setConfig(draft.config);
      setWorkingConfig(next);
      setEntries(draft.entries);
      setProposals(
        proposalRows.filter((proposal) => ['accepted', 'confirmed'].includes(proposal.status)),
      );
      setSelectedDay((current) =>
        next.days.some((day) => day.date === current) ? current : next.days[0]?.date ?? '',
      );
      setLoaded(true);
    } catch (caught) {
      if (request === generation.current) {
        setError(scheduleError(caught, t));
        setLoaded(true);
      }
    }
  }, [cfpId, t]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
    return () => {
      generation.current += 1;
    };
    // Locale changes labels, not the stored programme. Do not refetch and erase edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId]);

  const byId = useMemo(() => new Map(proposals.map((proposal) => [proposal.id, proposal])), [proposals]);
  const scheduledProposalIds = useMemo(
    () => new Set(entries.flatMap((entry) => (entry.kind === 'proposal' ? [entry.proposalId] : []))),
    [entries],
  );
  const unscheduled = proposals.filter(
    (proposal) =>
      !scheduledProposalIds.has(proposal.id) &&
      `${proposal.title} ${proposalName(proposal)}`.toLowerCase().includes(search.toLowerCase()),
  );
  const speakerMap = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal.speakerIds ?? []])),
    [proposals],
  );
  const conflicts = scheduleConflicts(entries, speakerMap);
  const tentative = entries.filter(
    (entry) => entry.kind === 'proposal' && byId.get(entry.proposalId)?.status !== 'confirmed',
  );
  const publishReady = Boolean(config && entries.length && !conflicts.length && !tentative.length);
  const canPublish = Boolean(publishReady && config?.needsAttention);

  async function saveConfig() {
    if (!workingConfig) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { data } = await setScheduleConfig({
        cfpId,
        config: workingConfig,
        expectedRevision: config?.revision ?? 0,
      });
      const saved = { ...workingConfig, revision: data.revision, needsAttention: true };
      setConfig(saved);
      setWorkingConfig(saved);
      setSelectedDay((current) =>
        saved.days.some((day) => day.date === current) ? current : (saved.days[0]?.date ?? ''),
      );
      setNote(t.schedule.setupSaved);
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(entry: ScheduleEntry) {
    if (!config) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { data } = await upsertScheduleEntry({
        cfpId,
        entry,
        expectedRevision: config.revision,
      });
      setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]);
      setConfig((current) => (current ? { ...current, revision: data.revision, needsAttention: true } : current));
      setWorkingConfig((current) =>
        current ? { ...current, revision: data.revision, needsAttention: true } : current,
      );
      setEditing(null);
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entry: ScheduleEntry) {
    if (!config || !window.confirm(t.schedule.removeConfirm)) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await removeScheduleEntry({
        cfpId,
        entryId: entry.id,
        expectedRevision: config.revision,
      });
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setConfig((current) => (current ? { ...current, revision: data.revision, needsAttention: true } : current));
      setWorkingConfig((current) =>
        current ? { ...current, revision: data.revision, needsAttention: true } : current,
      );
      setEditing(null);
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!config || !canPublish) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { data } = await publishSchedule({ cfpId, expectedRevision: config.revision });
      setConfig((current) =>
        current
          ? { ...current, revision: data.revision, needsAttention: false }
          : current,
      );
      setWorkingConfig((current) =>
        current
          ? { ...current, revision: data.revision, needsAttention: false }
          : current,
      );
      setNote(`${t.schedule.published} ${t.schedule.publishedVersion(data.version)}`);
      setReviewingPublish(false);
      await onPublished?.();
      track('schedule_published', { cfp_id: cfpId, version: data.version });
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  function editEntry(entry: ScheduleEntry) {
    setError('');
    setNote('');
    setEditing(entry);
  }

  function startProposal(proposal: ProposalRow, date = selectedDay, roomId = config?.rooms[0]?.id, startsAt?: string) {
    if (!config || !date || !roomId) return;
    const day = config.days.find((candidate) => candidate.date === date)!;
    editEntry({
      id: `proposal-${proposal.id}`,
      kind: 'proposal',
      proposalId: proposal.id,
      date,
      startsAt: startsAt ?? day.startsAt,
      durationMinutes: suggestedDuration(proposal.format),
      roomId,
      ...(proposal.deliveryLanguage === 'either' ? {} : undefined),
    });
  }

  function startCustom(date = selectedDay, roomId = config?.rooms[0]?.id, startsAt?: string) {
    if (!config || !date || !roomId) return;
    const day = config.days.find((candidate) => candidate.date === date)!;
    editEntry({
      id: `custom-${Date.now()}`,
      kind: 'custom',
      customType: 'break',
      title: { en: '', fr: '' },
      description: { en: '', fr: '' },
      date,
      startsAt: startsAt ?? day.startsAt,
      durationMinutes: 30,
      roomId,
    });
  }

  function dropped(roomId: string, startsAt: string) {
    if (!dragging) return;
    if (dragging.kind === 'proposal') {
      const proposal = byId.get(dragging.proposalId);
      if (proposal) startProposal(proposal, selectedDay, roomId, startsAt);
    } else {
      const entry = entries.find((candidate) => candidate.id === dragging.entryId);
      if (entry) void saveEntry({ ...entry, date: selectedDay, roomId, startsAt });
    }
    setDragging(null);
  }

  if (!loaded) return <p className="muted">{t.app.loading}</p>;
  if (!workingConfig) return null;

  return (
    <div className="schedule-admin">
      <section className="schedule-command">
        <div>
          <p className="schedule-command__eyebrow">{t.schedule.metrics}</p>
          <h2>{t.schedule.adminTitle}</h2>
          <p>{t.schedule.adminHelp}</p>
        </div>
        <div className="schedule-command__actions">
          {config && entries.length > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => downloadScheduleCsv(cfpId, config, entries, byId, locale)}
            >
              {t.schedule.csv}
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !canPublish}
            title={
              canPublish
                ? undefined
                : config?.needsAttention
                  ? t.schedule.publishBlocked
                  : t.schedule.publishNoChanges
            }
            onClick={() => {
              setError('');
              setNote('');
              setReviewingPublish(true);
            }}
          >
            {t.schedule.publish}
          </button>
        </div>
      </section>

      {!editing && !reviewingPublish && <Result ok={note} error={error} />}

      <div className="schedule-metrics" aria-label={t.schedule.metrics}>
        <strong>{t.schedule.scheduledCount(entries.length)}</strong>
        <span>{t.schedule.unassignedCount(unscheduled.length)}</span>
        <span className={tentative.length ? 'schedule-metric--warn' : ''}>
          {t.schedule.tentativeCount(tentative.length)}
        </span>
        <span className={conflicts.length ? 'schedule-metric--danger' : ''}>
          {t.schedule.conflictCount(conflicts.length)}
        </span>
        {config?.needsAttention && <span className="schedule-metric--accent">{t.schedule.unpublished}</span>}
      </div>

      <details className="section schedule-setup" open={!config}>
        <summary>
          <strong>{t.schedule.configure}</strong>
          <span>{t.schedule.configureHelp}</span>
        </summary>
        <div className="schedule-setup__body">
          <TextField
            label={t.schedule.timeZone}
            value={workingConfig.timeZone}
            onChange={(timeZone) => setWorkingConfig({ ...workingConfig, timeZone })}
            disabled={busy}
            required
          />
          <div className="schedule-setup__heading">
            <h3>{t.schedule.days}</h3>
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={busy || workingConfig.days.length >= 10}
              onClick={() => {
                const previous = workingConfig.days.at(-1);
                setWorkingConfig({
                  ...workingConfig,
                  days: [
                    ...workingConfig.days,
                    {
                      date: dayAfter(previous?.date ?? new Date().toISOString().slice(0, 10)),
                      startsAt: previous?.startsAt ?? '09:00',
                      endsAt: previous?.endsAt ?? '17:00',
                    },
                  ],
                });
              }}
            >
              {t.schedule.addDay}
            </button>
          </div>
          <div className="schedule-config-rows">
            {workingConfig.days.map((day, index) => {
              const hasEntries = entries.some((entry) => entry.date === day.date);
              return (
              <div className="schedule-config-row schedule-config-row--day" key={`${day.date}-${index}`}>
                <TextField
                  label={`${t.schedule.day} ${index + 1}`}
                  type="date"
                  value={day.date}
                  onChange={(date) =>
                    setWorkingConfig({
                      ...workingConfig,
                      days: workingConfig.days.map((item, at) => (at === index ? { ...item, date } : item)),
                    })
                  }
                  disabled={busy}
                  required
                />
                <TextField
                  label={t.schedule.dayStarts}
                  type="time"
                  value={day.startsAt}
                  onChange={(startsAt) =>
                    setWorkingConfig({
                      ...workingConfig,
                      days: workingConfig.days.map((item, at) =>
                        at === index ? { ...item, startsAt } : item,
                      ),
                    })
                  }
                  placeholder="09:00"
                  disabled={busy}
                  required
                />
                <TextField
                  label={t.schedule.dayEnds}
                  type="time"
                  value={day.endsAt}
                  onChange={(endsAt) =>
                    setWorkingConfig({
                      ...workingConfig,
                      days: workingConfig.days.map((item, at) =>
                        at === index ? { ...item, endsAt } : item,
                      ),
                    })
                  }
                  placeholder="17:00"
                  disabled={busy}
                  required
                />
                {workingConfig.days.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--danger btn--compact"
                    disabled={busy || hasEntries}
                    title={hasEntries ? t.schedule.dayHasItems : undefined}
                    onClick={() =>
                      setWorkingConfig({
                        ...workingConfig,
                        days: workingConfig.days.filter((_, at) => at !== index),
                      })
                    }
                  >
                    {t.schedule.removeDay}
                  </button>
                )}
              </div>
              );
            })}
          </div>
          <div className="schedule-setup__heading">
            <h3>{t.schedule.rooms}</h3>
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={busy || workingConfig.rooms.length >= 20}
              onClick={() =>
                setWorkingConfig({
                  ...workingConfig,
                  rooms: [
                    ...workingConfig.rooms,
                    { id: `room-${workingConfig.rooms.length + 1}`, name: { en: '', fr: '' } },
                  ],
                })
              }
            >
              {t.schedule.addRoom}
            </button>
          </div>
          <div className="schedule-config-rows">
            {workingConfig.rooms.map((room, index) => (
              <div className="schedule-config-row" key={room.id}>
                <TextField
                  label={t.schedule.roomNameEn}
                  value={room.name.en}
                  onChange={(en) =>
                    setWorkingConfig({
                      ...workingConfig,
                      rooms: workingConfig.rooms.map((item, at) =>
                        at === index ? { ...item, name: { ...item.name, en } } : item,
                      ),
                    })
                  }
                  disabled={busy}
                  required
                />
                <TextField
                  label={t.schedule.roomNameFr}
                  value={room.name.fr ?? ''}
                  onChange={(fr) =>
                    setWorkingConfig({
                      ...workingConfig,
                      rooms: workingConfig.rooms.map((item, at) =>
                        at === index ? { ...item, name: { ...item.name, fr } } : item,
                      ),
                    })
                  }
                  disabled={busy}
                />
                {workingConfig.rooms.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--danger btn--compact"
                    onClick={() =>
                      setWorkingConfig({
                        ...workingConfig,
                        rooms: workingConfig.rooms.filter((_, at) => at !== index),
                      })
                    }
                  >
                    {t.schedule.removeRoom}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void saveConfig()}>
            {t.schedule.saveSetup}
          </button>
        </div>
      </details>

      {config ? (
        <div className="schedule-workspace">
          <aside className="schedule-pool">
            <div className="schedule-pool__heading">
              <div>
                <h3>{t.schedule.unassigned}</h3>
                <p>{t.schedule.unassignedHelp}</p>
              </div>
              <button type="button" className="btn btn--ghost btn--compact" onClick={() => startCustom()}>
                {t.schedule.custom}
              </button>
            </div>
            <TextField label={t.schedule.search} value={search} onChange={setSearch} />
            {unscheduled.length ? (
              <ul className="schedule-pool__list">
                {unscheduled.map((proposal) => (
                  <li
                    key={proposal.id}
                    className="schedule-pool-card"
                    draggable
                    onDragStart={(event) => {
                      const payload: DragPayload = { kind: 'proposal', proposalId: proposal.id };
                      setDragging(payload);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <span className={`status-dot status-dot--${proposal.status}`} aria-hidden="true" />
                    <div>
                      <strong>{proposal.title}</strong>
                      <span>{proposalName(proposal)}</span>
                      <small>
                        {proposal.format} · {proposal.deliveryLanguage} ·{' '}
                        {proposal.status === 'confirmed' ? t.schedule.confirmed : t.schedule.tentative}
                      </small>
                    </div>
                    <button type="button" className="btn btn--ghost btn--compact" onClick={() => startProposal(proposal)}>
                      {t.schedule.edit}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t.schedule.noUnassigned}</p>
            )}
          </aside>

          <section className="schedule-board" aria-label={t.schedule.adminTitle}>
            <div className="schedule-day-tabs" role="tablist" aria-label={t.schedule.days}>
              {config.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  role="tab"
                  aria-selected={selectedDay === day.date}
                  className={selectedDay === day.date ? 'schedule-day-tab schedule-day-tab--active' : 'schedule-day-tab'}
                  onClick={() => setSelectedDay(day.date)}
                >
                  {formatCalendarDay(calendarDate(day.date)!, locale)}
                </button>
              ))}
            </div>
            <p className="schedule-board__hint">{t.schedule.dragHint}</p>
            <TimeGrid
              config={config}
              date={selectedDay}
              entries={entries}
              proposals={byId}
              locale={locale}
              busy={busy}
              onEdit={editEntry}
              onDrag={(payload) => setDragging(payload)}
              onDrop={dropped}
              onEmpty={startCustom}
              emptySlot={t.schedule.emptySlot}
              moveLabel={t.schedule.move}
            />
          </section>
        </div>
      ) : (
        <p className="panel">{t.schedule.needsSetup}</p>
      )}

      {!editing && !reviewingPublish && error === t.schedule.stale && (
        <button type="button" className="btn" onClick={() => void refresh()}>
          {t.schedule.reload}
        </button>
      )}

      {editing && config && (
        <EntryEditor
          entry={editing}
          config={config}
          proposal={editing.kind === 'proposal' ? byId.get(editing.proposalId) : undefined}
          busy={busy}
          error={error}
          onChange={setEditing}
          onSave={() => void saveEntry(editing)}
          onCancel={() => setEditing(null)}
          onRemove={() => void removeEntry(editing)}
          onReload={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      {reviewingPublish && config && (
        <PublishReview
          scheduled={entries.length}
          unscheduled={unscheduled.length}
          tentative={tentative.length}
          conflicts={conflicts.length}
          busy={busy}
          error={error}
          onCancel={() => setReviewingPublish(false)}
          onPublish={() => void publish()}
        />
      )}
    </div>
  );
}

function TimeGrid({
  config,
  date,
  entries,
  proposals,
  locale,
  busy,
  onEdit,
  onDrag,
  onDrop,
  onEmpty,
  emptySlot,
  moveLabel,
}: {
  config: ScheduleConfig;
  date: string;
  entries: ScheduleEntry[];
  proposals: Map<string, ProposalRow>;
  locale: 'en' | 'fr';
  busy: boolean;
  onEdit: (entry: ScheduleEntry) => void;
  onDrag: (payload: DragPayload) => void;
  onDrop: (roomId: string, startsAt: string) => void;
  onEmpty: (date?: string, roomId?: string, startsAt?: string) => void;
  emptySlot: (time: string, room: string) => string;
  moveLabel: string;
}) {
  const day = config.days.find((candidate) => candidate.date === date) ?? config.days[0];
  if (!day) return null;
  const slots = Array.from(
    { length: Math.ceil((minutes(day.endsAt) - minutes(day.startsAt)) / SLOT_MINUTES) },
    (_, index) => timeOf(minutes(day.startsAt) + index * SLOT_MINUTES),
  );
  return (
    <div className="schedule-grid-scroll">
      <div className="schedule-grid" style={{ '--schedule-rooms': config.rooms.length } as CSSProperties}>
        <div className="schedule-grid__corner" />
        {config.rooms.map((room) => (
          <div className="schedule-grid__room" key={room.id}>{roomName(room, locale)}</div>
        ))}
        <div className="schedule-grid__times" style={{ height: slots.length * SLOT_HEIGHT }}>
          {slots.map((slot, index) => index % 2 === 0 && (
            <time key={slot} style={{ top: index * SLOT_HEIGHT }}>{slot}</time>
          ))}
        </div>
        {config.rooms.map((room, roomIndex) => {
          const roomEntries = entries.filter((entry) => entry.date === date && entry.roomId === room.id);
          return (
            <div
              className="schedule-grid__track"
              key={room.id}
              style={{ height: slots.length * SLOT_HEIGHT, gridColumn: roomIndex + 2 }}
            >
              {slots.map((slot, index) => (
                <button
                  type="button"
                  className="schedule-grid__slot"
                  key={slot}
                  style={{ top: index * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                  aria-label={emptySlot(slot, roomName(room, locale))}
                  disabled={busy}
                  onClick={() => onEmpty(date, room.id, slot)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onDrop(room.id, slot);
                  }}
                />
              ))}
              {roomEntries.map((entry) => {
                const top = ((minutes(entry.startsAt) - minutes(day.startsAt)) / SLOT_MINUTES) * SLOT_HEIGHT;
                const height = Math.max((entry.durationMinutes / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT);
                const proposal = entry.kind === 'proposal' ? proposals.get(entry.proposalId) : undefined;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    className={`schedule-card schedule-card--${entry.kind}${proposal?.status === 'accepted' ? ' schedule-card--tentative' : ''}`}
                    style={{ top, height }}
                    draggable
                    aria-label={`${moveLabel}: ${entryTitle(entry, proposals, locale)}`}
                    onClick={() => onEdit(entry)}
                    onDragStart={(event: DragEvent<HTMLElement>) => {
                      onDrag({ kind: 'entry', entryId: entry.id });
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <time>{entry.startsAt}</time>
                    <strong>{entryTitle(entry, proposals, locale)}</strong>
                    {proposal && <span>{proposalName(proposal)}</span>}
                    <span className="schedule-card__action">{moveLabel}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EntryEditor({
  entry,
  config,
  proposal,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
  onRemove,
  onReload,
}: {
  entry: ScheduleEntry;
  config: ScheduleConfig;
  proposal?: ProposalRow;
  busy: boolean;
  error: string;
  onChange: (entry: ScheduleEntry) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onReload: () => void;
}) {
  const { t, locale } = useI18n();
  const dialogRef = useModalFocus(onCancel);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) feedbackRef.current?.focus({ preventScroll: true });
  }, [error]);

  return (
    <div className="schedule-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section
        ref={dialogRef}
        className="schedule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-editor-title"
        tabIndex={-1}
      >
        <div className="schedule-dialog__heading">
          <div>
            <p>{entry.kind === 'proposal' ? (proposal ? proposalName(proposal) : '') : t.schedule.types[entry.customType]}</p>
            <h3 id="schedule-editor-title">
              {entry.kind === 'proposal' ? proposal?.title : t.schedule.custom}
            </h3>
          </div>
          <button data-autofocus type="button" className="btn btn--ghost btn--compact" onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
        </div>
        <div className="grid grid--2">
          <SelectField
            label={t.schedule.date}
            value={entry.date}
            options={config.days.map((day) => ({
              value: day.date,
              label: formatCalendarDay(calendarDate(day.date)!, locale),
            }))}
            onChange={(date) => onChange({ ...entry, date })}
            disabled={busy}
            required
          />
          <SelectField
            label={t.schedule.room}
            value={entry.roomId}
            options={config.rooms.map((room) => ({ value: room.id, label: roomName(room, locale) }))}
            onChange={(roomId) => onChange({ ...entry, roomId })}
            disabled={busy}
            required
          />
          <TextField
            label={t.schedule.startsAt}
            type="time"
            value={entry.startsAt}
            onChange={(startsAt) => onChange({ ...entry, startsAt })}
            placeholder="09:00"
            disabled={busy}
            required
          />
          <TextField
            label={t.schedule.duration}
            type="number"
            min="5"
            value={String(entry.durationMinutes)}
            onChange={(duration) => onChange({ ...entry, durationMinutes: Number(duration) })}
            disabled={busy}
            required
          />
        </div>
        {entry.kind === 'proposal' && proposal?.deliveryLanguage === 'either' && (
          <SelectField
            label={t.schedule.language}
            value={entry.assignedLanguage ?? ''}
            options={[
              { value: 'en', label: t.enums.deliveryLanguage.en },
              { value: 'fr', label: t.enums.deliveryLanguage.fr },
            ]}
            onChange={(assignedLanguage) => onChange({ ...entry, assignedLanguage })}
            disabled={busy}
            required
          />
        )}
        {entry.kind === 'custom' && (
          <>
            <SelectField<CustomScheduleType>
              label={t.schedule.itemType}
              value={entry.customType}
              options={CUSTOM_SCHEDULE_TYPES.map((value) => ({ value, label: t.schedule.types[value] }))}
              onChange={(customType) => onChange({ ...entry, customType })}
              disabled={busy}
              required
            />
            <div className="grid grid--2">
              <TextField
                label={t.schedule.titleEn}
                value={entry.title.en}
                onChange={(en) => onChange({ ...entry, title: { ...entry.title, en } })}
                disabled={busy}
                required
              />
              <TextField
                label={t.schedule.titleFr}
                value={entry.title.fr ?? ''}
                onChange={(fr) => onChange({ ...entry, title: { ...entry.title, fr } })}
                disabled={busy}
              />
              <TextAreaField
                label={t.schedule.descriptionEn}
                value={entry.description?.en ?? ''}
                onChange={(en) => onChange({ ...entry, description: { ...entry.description, en } })}
                disabled={busy}
                rows={3}
              />
              <TextAreaField
                label={t.schedule.descriptionFr}
                value={entry.description?.fr ?? ''}
                onChange={(fr) =>
                  onChange({
                    ...entry,
                    description: { en: entry.description?.en ?? '', fr },
                  })
                }
                disabled={busy}
                rows={3}
              />
            </div>
          </>
        )}
        {error && (
          <div ref={feedbackRef} className="schedule-dialog__feedback" tabIndex={-1}>
            <Result ok="" error={error} />
            {error === t.schedule.stale && (
              <button type="button" className="btn" onClick={onReload}>
                {t.schedule.reload}
              </button>
            )}
          </div>
        )}
        <div className="schedule-dialog__actions">
          <button type="button" className="btn btn--danger" disabled={busy} onClick={onRemove}>
            {t.schedule.remove}
          </button>
          <span className="schedule-dialog__actions-spacer" />
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>{t.schedule.cancelEdit}</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onSave}>{t.schedule.saveItem}</button>
        </div>
      </section>
    </div>
  );
}

function PublishReview({
  scheduled,
  unscheduled,
  tentative,
  conflicts,
  busy,
  error,
  onCancel,
  onPublish,
}: {
  scheduled: number;
  unscheduled: number;
  tentative: number;
  conflicts: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onPublish: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useModalFocus(onCancel);
  return (
    <div className="schedule-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section
        ref={dialogRef}
        className="schedule-dialog schedule-publish-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-publish-title"
        aria-describedby="schedule-publish-help"
        tabIndex={-1}
      >
        <div className="schedule-dialog__heading">
          <div>
            <p>{t.schedule.metrics}</p>
            <h3 id="schedule-publish-title">{t.schedule.publishTitle}</h3>
          </div>
          <button data-autofocus type="button" className="btn btn--ghost btn--compact" onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
        </div>
        <p id="schedule-publish-help">{t.schedule.publishHelp}</p>
        <div className="schedule-metrics" aria-label={t.schedule.metrics}>
          <strong>{t.schedule.scheduledCount(scheduled)}</strong>
          <span>{t.schedule.unassignedCount(unscheduled)}</span>
          <span>{t.schedule.tentativeCount(tentative)}</span>
          <span>{t.schedule.conflictCount(conflicts)}</span>
        </div>
        {error && <Result ok="" error={error} />}
        <div className="schedule-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onPublish}>
            {t.schedule.publishConfirm}
          </button>
        </div>
      </section>
    </div>
  );
}
