import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';

import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { CustomScheduleSpeakerPhoto } from '../../components/CustomScheduleSpeakerPhoto';
import { Link } from '../../components/Link';
import { useI18n } from '../../i18n/context';
import { formatCalendarDay, formatDate } from '../../i18n';
import { calendarDate } from '@shared/cfp';
import { cfpState } from '@shared/cfpWindow';
import { localised } from '@shared/confirmForm';
import { labelOf, type SubmissionForm } from '@shared/submissionForm';
import {
  CUSTOM_SCHEDULE_TYPES,
  SCHEDULE_LANGUAGES,
  SCHEDULE_LIMITS,
  nextScheduleRoomId,
  scheduleDurationBounds,
  scheduleEndTime,
  scheduleConflicts,
  scheduleRoomIdsInUse,
  scheduleProposalEligible,
  snapScheduleDuration,
  suggestedDuration,
  resolvedScheduleLanguage,
  type CustomScheduleType,
  type ScheduleConfig,
  type ScheduleEntry,
  type ScheduleLanguage,
  type ScheduleRoom,
  type CustomScheduleSpeaker,
} from '@shared/schedule';
import type { Cfp } from '@shared/types';
import type { ProposalRow } from '../../lib/roles';
import { loadAllProposals, loadCfp } from '../../lib/roles';
import { loadSubmissionForm } from '../../lib/proposals';
import { invalidateCache } from '../../lib/cache';
import {
  loadPublishedSchedule,
  loadScheduleDraft,
  loadSharedSchedule,
  publishSchedule,
  removeScheduleEntry,
  setScheduleConfig,
  shareSchedulePreview,
  unpublishSchedule,
  upsertScheduleEntry,
  type PublishedScheduleBundle,
  type ScheduleDraft,
  type SharedScheduleBundle,
} from '../../lib/schedule';
import { toDate } from '../../lib/dates';
import { href } from '../../lib/router';
import { scheduleError } from '../../lib/errors';
import { track } from '../../lib/analytics';
import { Result } from './Result';
import { downloadScheduleCsv } from './scheduleExport';

const SLOT_MINUTES = 15;
const SLOT_HEIGHT = 24;
const PIXELS_PER_MINUTE = SLOT_HEIGHT / SLOT_MINUTES;

type DragPayload = { kind: 'proposal'; proposalId: string } | { kind: 'entry'; entryId: string };

interface DropTarget {
  roomId: string;
  startsAt: string;
}

interface ResizeGesture {
  entryId: string;
  pointerId: number;
  axis: 'horizontal' | 'vertical';
  startPosition: number;
  initialDuration: number;
  durationMinutes: number;
}

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

function customSpeakerNames(entry: Extract<ScheduleEntry, { kind: 'custom' }>): string {
  return (entry.speakers ?? []).map((speaker) => speaker.name).filter(Boolean).join(', ');
}

function scheduledProposalLanguage(
  proposal: ProposalRow,
  entry?: Extract<ScheduleEntry, { kind: 'proposal' }>,
) {
  return resolvedScheduleLanguage(proposal.deliveryLanguage, entry?.assignedLanguage);
}

function optionLabel(
  options: SubmissionForm['category'] | undefined,
  value: string,
  locale: 'en' | 'fr',
): string {
  const label = labelOf(options, value, locale);
  return label === value
    ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : label;
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
  readOnly = false,
  onDisclosureChanged,
}: {
  cfpId: string;
  readOnly?: boolean;
  onDisclosureChanged?: (stage: 'shared' | 'published' | 'offline') => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [workingConfig, setWorkingConfig] = useState<ScheduleConfig | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [submissionForm, setSubmissionForm] = useState<SubmissionForm | null>(null);
  const [cfp, setCfp] = useState<Cfp | null>(null);
  const [sharedPreview, setSharedPreview] = useState<SharedScheduleBundle | null>(null);
  const [publicProgramme, setPublicProgramme] =
    useState<PublishedScheduleBundle | null>(null);
  const [selectedDay, setSelectedDay] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [pendingRoomFocus, setPendingRoomFocus] = useState('');
  const [reviewingShare, setReviewingShare] = useState(false);
  const [reviewingPublish, setReviewingPublish] = useState(false);
  const [reviewingOffline, setReviewingOffline] = useState(false);
  const generation = useRef(0);
  const mutationEpoch = useRef(0);
  const setupRef = useRef<HTMLDetailsElement>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const workingConfigRef = useRef(workingConfig);
  workingConfigRef.current = workingConfig;
  const configRef = useRef(config);
  configRef.current = config;

  const refresh = useCallback(async (force = false) => {
    const request = ++generation.current;
    const epochAtStart = mutationEpoch.current;
    setError('');
    const applySchedule = async (
      nextCfp: Cfp | null,
      draft: ScheduleDraft,
      proposalRows: ProposalRow[],
      nextShared: SharedScheduleBundle,
      nextSubmissionForm: SubmissionForm,
      isBackgroundRevalidate = false,
    ) => {
      const nextPublic = nextCfp?.publishedScheduleId
        ? await loadPublishedSchedule(cfpId, nextCfp.publishedScheduleId, { force })
        : null;
      if (request !== generation.current || epochAtStart !== mutationEpoch.current) return;
      const next = draft.config ?? initialConfig(nextCfp);
      setCfp(nextCfp);
      setSharedPreview(nextShared);
      setPublicProgramme(nextPublic);
      setSubmissionForm(nextSubmissionForm);
      setProposals(proposalRows);

      const baselineConfig = configRef.current ?? initialConfig(nextCfp);
      const isSetupDirty = Boolean(
        baselineConfig &&
          workingConfigRef.current &&
          JSON.stringify({
            timeZone: baselineConfig.timeZone,
            days: baselineConfig.days,
            rooms: baselineConfig.rooms,
          }) !==
            JSON.stringify({
              timeZone: workingConfigRef.current.timeZone,
              days: workingConfigRef.current.days,
              rooms: workingConfigRef.current.rooms,
            }),
      );

      const isEditingOrDragging = editingRef.current !== null || draggingRef.current !== null;
      if (!isBackgroundRevalidate || (!isSetupDirty && !isEditingOrDragging)) {
        setConfig(draft.config);
        setSetupOpen((current) => current || !draft.config);
        setWorkingConfig(next);
        setEntries(draft.entries);
      }

      setSelectedDay((current) =>
        next.days.some((day: { date: string }) => day.date === current) ? current : next.days[0]?.date ?? '',
      );
      setLoaded(true);
    };

    try {
      let currentDraftResult: ScheduleDraft | null = null;
      let currentProposalsResult: ProposalRow[] | null = null;
      let currentCfpResult: Cfp | null = null;
      let currentSharedResult: SharedScheduleBundle | null = null;
      let currentFormResult: SubmissionForm | null = null;

      const [nextCfp, draft, proposalRows, nextShared, nextSubmissionForm] = await Promise.all([
        loadCfp(cfpId, {
          force,
          onRevalidate: (updatedCfp) => {
            if (request === generation.current) {
              currentCfpResult = updatedCfp;
              if (currentDraftResult && currentProposalsResult && currentSharedResult && currentFormResult) {
                void applySchedule(
                  updatedCfp,
                  currentDraftResult,
                  currentProposalsResult,
                  currentSharedResult,
                  currentFormResult,
                  true,
                );
              }
            }
          },
        }),
        loadScheduleDraft(cfpId, {
          force,
          onRevalidate: (updatedDraft) => {
            if (request === generation.current) {
              currentDraftResult = updatedDraft;
              if (currentCfpResult && currentProposalsResult && currentSharedResult && currentFormResult) {
                void applySchedule(
                  currentCfpResult,
                  updatedDraft,
                  currentProposalsResult,
                  currentSharedResult,
                  currentFormResult,
                  true,
                );
              }
            }
          },
        }),
        loadAllProposals(cfpId, {
          force,
          onRevalidate: (updatedProposals) => {
            if (request === generation.current) {
              currentProposalsResult = updatedProposals;
              if (currentCfpResult && currentDraftResult && currentSharedResult && currentFormResult) {
                void applySchedule(
                  currentCfpResult,
                  currentDraftResult,
                  updatedProposals,
                  currentSharedResult,
                  currentFormResult,
                  true,
                );
              }
            }
          },
        }),
        loadSharedSchedule(cfpId, {
          force,
          audience: 'committee',
          onRevalidate: (updatedShared) => {
            if (request === generation.current) {
              currentSharedResult = updatedShared;
              if (currentCfpResult && currentDraftResult && currentProposalsResult && currentFormResult) {
                void applySchedule(
                  currentCfpResult,
                  currentDraftResult,
                  currentProposalsResult,
                  updatedShared,
                  currentFormResult,
                  true,
                );
              }
            }
          },
        }),
        loadSubmissionForm(cfpId, {
          force,
          onRevalidate: (updatedForm) => {
            if (request === generation.current) {
              currentFormResult = updatedForm;
              if (currentCfpResult && currentDraftResult && currentProposalsResult && currentSharedResult) {
                void applySchedule(
                  currentCfpResult,
                  currentDraftResult,
                  currentProposalsResult,
                  currentSharedResult,
                  updatedForm,
                  true,
                );
              }
            }
          },
        }),
      ]);
      if (request !== generation.current) return;
      currentCfpResult = currentCfpResult ?? nextCfp;
      currentDraftResult = currentDraftResult ?? draft;
      currentProposalsResult = currentProposalsResult ?? proposalRows;
      currentSharedResult = currentSharedResult ?? nextShared;
      currentFormResult = currentFormResult ?? nextSubmissionForm;
      await applySchedule(
        currentCfpResult,
        currentDraftResult,
        currentProposalsResult,
        currentSharedResult,
        currentFormResult,
        false,
      );
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

  useEffect(() => {
    if (!setupOpen || !pendingRoomFocus) return;
    const row = setupRef.current?.querySelector<HTMLElement>(
      `[data-room-id="${pendingRoomFocus}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    row.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    setPendingRoomFocus('');
  }, [pendingRoomFocus, setupOpen, workingConfig]);

  const byId = useMemo(() => new Map(proposals.map((proposal) => [proposal.id, proposal])), [proposals]);
  const categoryLabel = (proposal: ProposalRow) =>
    optionLabel(submissionForm?.category, proposal.category, locale);
  const formatLabel = (proposal: ProposalRow) =>
    optionLabel(submissionForm?.format, proposal.format, locale);
  const levelLabel = (proposal: ProposalRow) =>
    optionLabel(submissionForm?.level, proposal.level, locale);
  const deliveryLanguageLabel = (proposal: ProposalRow) =>
    optionLabel(submissionForm?.deliveryLanguage, proposal.deliveryLanguage, locale);
  const scheduledProposalIds = useMemo(
    () => new Set(entries.flatMap((entry) => (entry.kind === 'proposal' ? [entry.proposalId] : []))),
    [entries],
  );
  const eligibleProposals = useMemo(
    () => proposals.filter((proposal) => scheduleProposalEligible(proposal.status)),
    [proposals],
  );
  const unscheduled = eligibleProposals.filter(
    (proposal) => {
      const searchText = [
        proposal.title,
        proposalName(proposal),
        proposal.category,
        proposal.format,
        proposal.level,
        proposal.deliveryLanguage,
        categoryLabel(proposal),
        formatLabel(proposal),
        levelLabel(proposal),
        deliveryLanguageLabel(proposal),
      ].join(' ').toLowerCase();
      return !scheduledProposalIds.has(proposal.id) && searchText.includes(search.toLowerCase());
    },
  );
  const speakerMap = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal.speakerIds ?? []])),
    [proposals],
  );
  const conflicts = scheduleConflicts(entries, speakerMap);
  const tentative = entries.filter(
    (entry) => entry.kind === 'proposal' && byId.get(entry.proposalId)?.status === 'accepted',
  );
  const ineligible = entries.filter(
    (entry) =>
      entry.kind === 'proposal' &&
      !scheduleProposalEligible(byId.get(entry.proposalId)?.status),
  );
  const shareableEntries = entries.filter(
    (entry) =>
      entry.kind === 'custom' || byId.get(entry.proposalId)?.status === 'confirmed',
  );
  const shareConflicts = scheduleConflicts(shareableEntries, speakerMap);
  const roomIdsInUse = useMemo(() => scheduleRoomIdsInUse(entries), [entries]);
  const baselineConfig = config ?? (cfp ? initialConfig(cfp) : null);
  const setupDirty = Boolean(
    baselineConfig &&
      JSON.stringify({
        timeZone: baselineConfig.timeZone,
        days: baselineConfig.days,
        rooms: baselineConfig.rooms,
      }) !==
        JSON.stringify({
          timeZone: workingConfig?.timeZone,
          days: workingConfig?.days,
          rooms: workingConfig?.rooms,
        }),
  );
  const archived = readOnly || cfp?.archived === true;
  const opens = toDate(cfp?.opensAt);
  const closes = toDate(cfp?.closesAt);
  const callOpen = Boolean(
    cfp &&
      opens &&
      closes &&
      cfpState(
        {
          archived: cfp.archived,
          paused: cfp.paused,
          opensAtMs: opens.getTime(),
          closesAtMs: closes.getTime(),
        },
        Date.now(),
      ) === 'open',
  );
  const shareReady = Boolean(config && shareableEntries.length && !shareConflicts.length);
  const hasSharedPreview = Boolean(sharedPreview?.schedule);
  const sharedStale = Boolean(
    hasSharedPreview && (config?.needsAttention || sharedPreview?.stale),
  );
  const effectiveSharedScheduleId = cfp?.sharedScheduleId ?? cfp?.publishedScheduleId;
  const publicMatchesShared = Boolean(
    cfp?.publishedScheduleId &&
      effectiveSharedScheduleId &&
      cfp.publishedScheduleId === effectiveSharedScheduleId,
  );
  const canShare = Boolean(
    !archived &&
      !setupDirty &&
      (config?.needsAttention || sharedPreview?.stale) &&
      shareReady &&
      (!hasSharedPreview || sharedStale),
  );
  const canPublish = Boolean(
    !archived &&
      !setupDirty &&
      shareReady &&
      hasSharedPreview &&
      !sharedStale &&
      !publicMatchesShared,
  );

  async function saveConfig() {
    if (!workingConfig || archived) return;
    mutationEpoch.current += 1;
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
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`cfp:${cfpId}`);
      setNote(t.schedule.setupSaved);
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(entry: ScheduleEntry): Promise<boolean> {
    if (!config || archived) return false;
    mutationEpoch.current += 1;
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
      invalidateCache(`scheduleDraft:${cfpId}`);
      setEditing(null);
      return true;
    } catch (caught) {
      setError(scheduleError(caught, t));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entry: ScheduleEntry) {
    if (!config || archived || !window.confirm(t.schedule.removeConfirm)) return;
    mutationEpoch.current += 1;
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
      invalidateCache(`scheduleDraft:${cfpId}`);
      setEditing(null);
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!config || !canPublish) return;
    mutationEpoch.current += 1;
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
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache(`publishedSchedule:${cfpId}`);
      invalidateCache(`cfp:${cfpId}`);
      invalidateCache(`cfpWindow:${cfpId}`);
      setNote(`${t.schedule.published} ${t.schedule.publishedVersion(data.version)}`);
      setReviewingPublish(false);
      await refresh(true);
      await onDisclosureChanged?.('published');
      track('schedule_published', { cfp_id: cfpId, version: data.version });
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function sharePreview() {
    if (!config || !canShare) return;
    mutationEpoch.current += 1;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { data } = await shareSchedulePreview({
        cfpId,
        expectedRevision: config.revision,
      });
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache(`cfp:${cfpId}`);
      invalidateCache(`cfpWindow:${cfpId}`);
      setNote(
        `${t.schedule.shared} ${t.schedule.sharedVersion(data.version)} ${t.schedule.sharedSummary(data.sharedCount, data.omittedCount)} ${t.schedule.sharedChannels(data.committeeNotificationCount, data.speakerNotificationCount)}`,
      );
      setReviewingShare(false);
      await refresh(true);
      await onDisclosureChanged?.('shared');
      track('schedule_shared', { cfp_id: cfpId, version: data.version });
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function takeOffline() {
    if (archived || !cfp?.publishedScheduleId) return;
    mutationEpoch.current += 1;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await unpublishSchedule({ cfpId });
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache(`publishedSchedule:${cfpId}`);
      invalidateCache(`cfp:${cfpId}`);
      invalidateCache(`cfpWindow:${cfpId}`);
      setReviewingOffline(false);
      setNote(t.schedule.unpublishedSuccess);
      await refresh(true);
      await onDisclosureChanged?.('offline');
      track('schedule_unpublished', { cfp_id: cfpId });
    } catch (caught) {
      setError(scheduleError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  function editEntry(entry: ScheduleEntry) {
    if (archived) return;
    setError('');
    setNote('');
    setEditing(entry);
  }

  function startProposal(proposal: ProposalRow, date = selectedDay, roomId = config?.rooms[0]?.id, startsAt?: string) {
    if (archived || !config || !date || !roomId) return;
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
    if (archived || !config || !date || !roomId) return;
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
    if (archived || !dragging) return;
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

  const draftAt = toDate(config?.updatedAt);
  const sharedAt = toDate(sharedPreview?.schedule?.sharedAt);
  const publishedAt = toDate(publicProgramme?.schedule.publishedAt);
  const controlsBusy = busy || archived;
  const activeConfig = workingConfig;

  function addRoom() {
    if (controlsBusy || activeConfig.rooms.length >= SCHEDULE_LIMITS.rooms) return;
    const roomId = nextScheduleRoomId(activeConfig.rooms);
    setWorkingConfig({
      ...activeConfig,
      rooms: [
        ...activeConfig.rooms,
        { id: roomId, name: { en: '', fr: '' } },
      ],
    });
    setSetupOpen(true);
    setPendingRoomFocus(roomId);
  }

  function moveRoom(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (controlsBusy || target < 0 || target >= activeConfig.rooms.length) return;
    const rooms = [...activeConfig.rooms];
    [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
    setWorkingConfig({ ...activeConfig, rooms });
  }

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
              onClick={() =>
                downloadScheduleCsv(
                  cfpId,
                  config,
                  entries,
                  byId,
                  locale,
                  submissionForm,
                  t.schedule.languageNames,
                )
              }
            >
              {t.schedule.csv}
            </button>
          )}
        </div>
      </section>

      {!editing && !reviewingShare && !reviewingPublish && !reviewingOffline && (
        <Result ok={note} error={error} />
      )}

      <section className="schedule-release-flow" aria-labelledby="schedule-release-flow-title">
        <div className="schedule-release-flow__heading">
          <div>
            <p className="schedule-command__eyebrow">{t.schedule.releaseFlowEyebrow}</p>
            <h3 id="schedule-release-flow-title">{t.schedule.releaseFlowTitle}</h3>
          </div>
          <p>{t.schedule.releaseFlowHelp}</p>
        </div>
        <ol className="schedule-stages">
          <li className="schedule-stage schedule-stage--private">
            <div className="schedule-stage__topline">
              <span className="schedule-stage__number" aria-hidden="true">1</span>
              <span className="schedule-stage__badge">{t.schedule.privateBadge}</span>
            </div>
            <div>
              <h4>{t.schedule.privateDraftTitle}</h4>
              <p>{t.schedule.privateDraftHelp}</p>
            </div>
            <dl className="schedule-stage__meta">
              <div><dt>{t.schedule.versionLabel}</dt><dd>{t.schedule.revision(config?.revision ?? 0)}</dd></div>
              <div><dt>{t.schedule.audienceLabel}</dt><dd>{t.schedule.privateAudience}</dd></div>
              {draftAt && <div><dt>{t.schedule.updatedLabel}</dt><dd>{formatDate(draftAt, locale)}</dd></div>}
            </dl>
            {tentative.length > 0 && (
              <p className="schedule-stage__note">{t.schedule.privateTentative(tentative.length)}</p>
            )}
            {ineligible.length > 0 && (
              <p className="schedule-stage__attention" role="status">
                {t.schedule.privateIneligible(ineligible.length)}
              </p>
            )}
          </li>

          <li className={`schedule-stage schedule-stage--shared${sharedStale ? ' schedule-stage--stale' : ''}`}>
            <div className="schedule-stage__topline">
              <span className="schedule-stage__number" aria-hidden="true">2</span>
              <span className="schedule-stage__badge">
                {hasSharedPreview ? t.schedule.sharedBadge : t.schedule.notSharedBadge}
              </span>
            </div>
            <div>
              <h4>{t.schedule.sharedPreviewTitle}</h4>
              <p>{t.schedule.sharedPreviewHelp}</p>
            </div>
            <dl className="schedule-stage__meta">
              <div>
                <dt>{t.schedule.versionLabel}</dt>
                <dd>
                  {sharedPreview?.schedule
                    ? t.schedule.sharedVersion(sharedPreview.schedule.version)
                    : '—'}
                </dd>
              </div>
              <div><dt>{t.schedule.audienceLabel}</dt><dd>{t.schedule.sharedAudience}</dd></div>
              {sharedAt && <div><dt>{t.schedule.updatedLabel}</dt><dd>{formatDate(sharedAt, locale)}</dd></div>}
            </dl>
            {sharedStale && (
              <p className="schedule-stage__warning" role="status">
                {t.schedule.sharedStale}
              </p>
            )}
            {setupDirty && (
              <p className="schedule-stage__warning" role="status">
                {t.schedule.saveSetupFirst}
              </p>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !canShare}
              title={
                archived
                  ? t.schedule.archivedHelp
                  : setupDirty
                    ? t.schedule.saveSetupFirst
                  : !shareReady
                    ? t.schedule.shareBlocked
                    : hasSharedPreview && !sharedStale
                      ? t.schedule.shareNoChanges
                      : undefined
              }
              onClick={() => {
                setError('');
                setNote('');
                setReviewingShare(true);
              }}
            >
              {t.schedule.share}
            </button>
          </li>

          <li className={`schedule-stage schedule-stage--public${cfp?.publishedScheduleId ? ' schedule-stage--live' : ''}`}>
            <div className="schedule-stage__topline">
              <span className="schedule-stage__number" aria-hidden="true">3</span>
              <span className="schedule-stage__badge">
                {cfp?.publishedScheduleId ? t.schedule.liveBadge : t.schedule.offlineBadge}
              </span>
            </div>
            <div>
              <h4>{t.schedule.publicProgrammeTitle}</h4>
              <p>{t.schedule.publicProgrammeHelp}</p>
            </div>
            <dl className="schedule-stage__meta">
              <div>
                <dt>{t.schedule.versionLabel}</dt>
                <dd>{publicProgramme ? t.schedule.publishedVersion(publicProgramme.schedule.version) : '—'}</dd>
              </div>
              <div><dt>{t.schedule.audienceLabel}</dt><dd>{t.schedule.publicAudience}</dd></div>
              {publishedAt && <div><dt>{t.schedule.updatedLabel}</dt><dd>{formatDate(publishedAt, locale)}</dd></div>}
            </dl>
            {!hasSharedPreview && (
              <p className="schedule-stage__note">{t.schedule.publishWaitingHelp}</p>
            )}
            {hasSharedPreview && !sharedStale && !publicMatchesShared && (
              <p className="schedule-stage__ready" role="status">
                {t.schedule.publishReadyHelp}
              </p>
            )}
            <div className="schedule-stage__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !canPublish}
                title={
                  archived
                    ? t.schedule.archivedHelp
                    : setupDirty
                      ? t.schedule.saveSetupFirst
                    : !hasSharedPreview
                      ? t.schedule.publishNeedsShare
                      : sharedStale
                        ? t.schedule.publishNeedsReshare
                        : publicMatchesShared
                          ? t.schedule.publishNoChanges
                          : !shareReady
                            ? t.schedule.publishBlocked
                            : undefined
                }
                onClick={() => {
                  setError('');
                  setNote('');
                  setReviewingPublish(true);
                }}
              >
                {t.schedule.publish}
              </button>
              {cfp?.publishedScheduleId && (
                <>
                  <Link className="btn btn--ghost" to={href({ route: 'schedule', cfpId })}>
                    {t.schedule.viewPublic}
                  </Link>
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busy || archived}
                    onClick={() => {
                      setError('');
                      setNote('');
                      setReviewingOffline(true);
                    }}
                  >
                    {t.schedule.takeOffline}
                  </button>
                </>
              )}
            </div>
          </li>
        </ol>
      </section>

      <div className="schedule-metrics" aria-label={t.schedule.metrics}>
        <strong>{t.schedule.scheduledCount(entries.length)}</strong>
        <span>{t.schedule.unassignedCount(unscheduled.length)}</span>
        <span className={tentative.length ? 'schedule-metric--warn' : ''}>
          {t.schedule.tentativeCount(tentative.length)}
        </span>
        {ineligible.length > 0 && (
          <span className="schedule-metric--danger">
            {t.schedule.ineligibleCount(ineligible.length)}
          </span>
        )}
        <span className={conflicts.length ? 'schedule-metric--danger' : ''}>
          {t.schedule.conflictCount(conflicts.length)}
        </span>
        {sharedStale && <span className="schedule-metric--accent">{t.schedule.unpublished}</span>}
      </div>

      <div className="schedule-setup-quick">
        <div>
          <strong>{t.schedule.roomCount(workingConfig.rooms.length)}</strong>
          <span>{t.schedule.configureHelp}</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          disabled={controlsBusy || workingConfig.rooms.length >= SCHEDULE_LIMITS.rooms}
          onClick={addRoom}
        >
          {t.schedule.addRoom}
        </button>
      </div>

      <details
        ref={setupRef}
        className="section schedule-setup"
        open={setupOpen}
        onToggle={(event) => setSetupOpen(event.currentTarget.open)}
      >
        <summary>
          <strong>{t.schedule.configure}</strong>
          <span>{t.schedule.configureHelp}</span>
        </summary>
        <div className="schedule-setup__body">
          <TextField
            label={t.schedule.timeZone}
            value={workingConfig.timeZone}
            onChange={(timeZone) => setWorkingConfig({ ...workingConfig, timeZone })}
            disabled={controlsBusy}
            required
          />
          <div className="schedule-setup__heading">
            <h3>{t.schedule.days}</h3>
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={controlsBusy || workingConfig.days.length >= 10}
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
                  disabled={controlsBusy}
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
                  disabled={controlsBusy}
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
                  disabled={controlsBusy}
                  required
                />
                {workingConfig.days.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--danger btn--compact"
                    disabled={controlsBusy || hasEntries}
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
            <span>{t.schedule.roomCount(workingConfig.rooms.length)}</span>
          </div>
          <div className="schedule-config-rows">
            {workingConfig.rooms.map((room, index) => {
              const displayName = roomName(room, locale) || t.schedule.roomNumber(index + 1);
              const inUse = roomIdsInUse.has(room.id);
              const removalReason = inUse
                ? t.schedule.roomHasItems
                : workingConfig.rooms.length === 1
                  ? t.schedule.oneRoomRequired
                  : undefined;
              return (
              <div
                className="schedule-config-row schedule-config-row--room"
                key={room.id}
                data-room-id={room.id}
              >
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
                  disabled={controlsBusy}
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
                  disabled={controlsBusy}
                />
                <div
                  className="schedule-room-actions"
                  role="group"
                  aria-label={t.schedule.roomOrder(displayName)}
                >
                  <button
                    type="button"
                    className="btn btn--ghost btn--compact schedule-room-order"
                    aria-label={t.schedule.moveRoomUp(displayName)}
                    title={t.schedule.moveRoomUp(displayName)}
                    disabled={controlsBusy || index === 0}
                    onClick={() => moveRoom(index, -1)}
                  >
                    <span aria-hidden="true">&#8593;</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--compact schedule-room-order"
                    aria-label={t.schedule.moveRoomDown(displayName)}
                    title={t.schedule.moveRoomDown(displayName)}
                    disabled={controlsBusy || index === workingConfig.rooms.length - 1}
                    onClick={() => moveRoom(index, 1)}
                  >
                    <span aria-hidden="true">&#8595;</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--compact"
                    disabled={controlsBusy || Boolean(removalReason)}
                    title={removalReason}
                    aria-describedby={removalReason ? `schedule-room-status-${room.id}` : undefined}
                    onClick={() =>
                      setWorkingConfig({
                        ...workingConfig,
                        rooms: workingConfig.rooms.filter((_, at) => at !== index),
                      })
                    }
                  >
                    {t.schedule.removeRoom}
                  </button>
                </div>
                {removalReason && (
                  <small id={`schedule-room-status-${room.id}`} className="schedule-room-status">
                    {removalReason}
                  </small>
                )}
              </div>
              );
            })}
          </div>
          <button type="button" className="btn btn--primary" disabled={controlsBusy} onClick={() => void saveConfig()}>
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
              <button type="button" className="btn btn--ghost btn--compact" disabled={controlsBusy} onClick={() => startCustom()}>
                {t.schedule.custom}
              </button>
            </div>
            <TextField
              label={t.schedule.search}
              help={t.schedule.searchHelp}
              value={search}
              onChange={setSearch}
            />
            {unscheduled.length ? (
              <ul className="schedule-pool__list">
                {unscheduled.map((proposal) => (
                  <li
                    key={proposal.id}
                    className={`schedule-pool-card${dragging?.kind === 'proposal' && dragging.proposalId === proposal.id ? ' schedule-pool-card--dragging' : ''}`}
                    draggable={!archived}
                    onDragStart={(event) => {
                      const payload: DragPayload = { kind: 'proposal', proposalId: proposal.id };
                      setDragging(payload);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', proposal.title);
                    }}
                    onDragEnd={() => setDragging(null)}
                  >
                    <span className={`status-dot status-dot--${proposal.status}`} aria-hidden="true" />
                    <div>
                      <strong>{proposal.title}</strong>
                      <span>{proposalName(proposal)}</span>
                      <small className="schedule-pool-card__facts">
                        <span>{categoryLabel(proposal)}</span>
                        <span>{formatLabel(proposal)}</span>
                        <span>{levelLabel(proposal)}</span>
                        <span>{deliveryLanguageLabel(proposal)}</span>
                        <span>{proposal.status === 'confirmed' ? t.schedule.confirmed : t.schedule.tentative}</span>
                      </small>
                    </div>
                    <button type="button" className="btn btn--ghost btn--compact" disabled={controlsBusy} onClick={() => startProposal(proposal)}>
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
              {config.days.map((day, index) => (
                <button
                  id={`schedule-admin-day-${index}`}
                  key={day.date}
                  type="button"
                  role="tab"
                  aria-selected={selectedDay === day.date}
                  aria-controls="schedule-admin-grid"
                  tabIndex={selectedDay === day.date ? 0 : -1}
                  className={selectedDay === day.date ? 'schedule-day-tab schedule-day-tab--active' : 'schedule-day-tab'}
                  onClick={() => setSelectedDay(day.date)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === 'ArrowRight') next = (index + 1) % config.days.length;
                    else if (event.key === 'ArrowLeft') next = (index - 1 + config.days.length) % config.days.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = config.days.length - 1;
                    else return;
                    event.preventDefault();
                    const nextDay = config.days[next];
                    if (!nextDay) return;
                    setSelectedDay(nextDay.date);
                    requestAnimationFrame(() => document.getElementById(`schedule-admin-day-${next}`)?.focus());
                  }}
                >
                  {formatCalendarDay(calendarDate(day.date)!, locale)}
                </button>
              ))}
            </div>
            <p className="schedule-board__hint">{t.schedule.dragHint}</p>
            <div
              id="schedule-admin-grid"
              role="tabpanel"
              aria-labelledby={`schedule-admin-day-${Math.max(config.days.findIndex((day) => day.date === selectedDay), 0)}`}
            >
              <TimeGrid
                cfpId={cfpId}
                config={config}
                date={selectedDay}
                entries={entries}
                proposals={byId}
                submissionForm={submissionForm}
                locale={locale}
                busy={controlsBusy}
                dragging={dragging}
                onEdit={editEntry}
                onDrag={setDragging}
                onDrop={dropped}
                onResize={saveEntry}
                onEmpty={startCustom}
                emptySlot={t.schedule.emptySlot}
                moveLabel={t.schedule.move}
              />
            </div>
          </section>
        </div>
      ) : (
        <p className="panel">{t.schedule.needsSetup}</p>
      )}

      {!editing && !reviewingShare && !reviewingPublish && !reviewingOffline && error === t.schedule.stale && (
        <button type="button" className="btn" onClick={() => void refresh(true)}>
          {t.schedule.reload}
        </button>
      )}

      {editing && config && (
        <EntryEditor
          cfpId={cfpId}
          entry={editing}
          config={config}
          proposal={editing.kind === 'proposal' ? byId.get(editing.proposalId) : undefined}
          submissionForm={submissionForm}
          busy={busy}
          error={error}
          onChange={setEditing}
          onSave={() => void saveEntry(editing)}
          onCancel={() => setEditing(null)}
          onRemove={() => void removeEntry(editing)}
          onReload={() => {
            setEditing(null);
            void refresh(true);
          }}
        />
      )}

      {reviewingPublish && config && (
        <PublishReview
          scheduled={shareableEntries.length}
          unscheduled={unscheduled.length}
          omitted={tentative.length + ineligible.length}
          conflicts={shareConflicts.length}
          callOpen={callOpen}
          busy={busy}
          error={error}
          onCancel={() => setReviewingPublish(false)}
          onPublish={() => void publish()}
        />
      )}

      {reviewingShare && config && (
        <ShareReview
          scheduled={shareableEntries.length}
          omitted={tentative.length + ineligible.length}
          conflicts={shareConflicts.length}
          busy={busy}
          error={error}
          onCancel={() => setReviewingShare(false)}
          onShare={() => void sharePreview()}
        />
      )}

      {reviewingOffline && (
        <OfflineReview
          busy={busy}
          error={error}
          onCancel={() => setReviewingOffline(false)}
          onConfirm={() => void takeOffline()}
        />
      )}
    </div>
  );
}

function TimeGrid({
  cfpId,
  config,
  date,
  entries,
  proposals,
  submissionForm,
  locale,
  busy,
  dragging,
  onEdit,
  onDrag,
  onDrop,
  onResize,
  onEmpty,
  emptySlot,
  moveLabel,
}: {
  cfpId: string;
  config: ScheduleConfig;
  date: string;
  entries: ScheduleEntry[];
  proposals: Map<string, ProposalRow>;
  submissionForm: SubmissionForm | null;
  locale: 'en' | 'fr';
  busy: boolean;
  dragging: DragPayload | null;
  onEdit: (entry: ScheduleEntry) => void;
  onDrag: (payload: DragPayload | null) => void;
  onDrop: (roomId: string, startsAt: string) => void;
  onResize: (entry: ScheduleEntry) => Promise<boolean>;
  onEmpty: (date?: string, roomId?: string, startsAt?: string) => void;
  emptySlot: (time: string, room: string) => string;
  moveLabel: string;
}) {
  const { t } = useI18n();
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [announcementInvalid, setAnnouncementInvalid] = useState(false);
  const [resizing, setResizing] = useState<ResizeGesture | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  const resizePickerId = useId();
  const resizingRef = useRef<ResizeGesture | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dragging) setDropTarget(null);
  }, [dragging]);

  useEffect(() => setInteractive(true), []);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const day = config.days.find((candidate) => candidate.date === date) ?? config.days[0];
  if (!day) return null;
  const dayStart = minutes(day.startsAt);
  const dayEnd = minutes(day.endsAt);
  const trackHeight = (dayEnd - dayStart) * PIXELS_PER_MINUTE;
  const lineMinutes = [dayStart];
  for (
    let value = Math.ceil((dayStart + 1) / SLOT_MINUTES) * SLOT_MINUTES;
    value < dayEnd;
    value += SLOT_MINUTES
  ) {
    lineMinutes.push(value);
  }
  const speakersByProposal = new Map(
    [...proposals.values()].map((proposal) => [proposal.id, proposal.speakerIds ?? []]),
  );
  const dayEntries = entries
    .filter((entry) => entry.date === date)
    .sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt) || left.roomId.localeCompare(right.roomId),
    );
  const selectedEntry = dayEntries.find((entry) => entry.id === selectedEntryId) ?? dayEntries[0] ?? null;

  function factsFor(entry: ScheduleEntry) {
    if (entry.kind === 'custom') {
      const speaker = customSpeakerNames(entry);
      return {
        speaker,
        category: t.schedule.types[entry.customType],
        categoryLabel: t.schedule.itemType,
        language: entry.language
          ? t.schedule.languageNames[entry.language]
          : t.schedule.languageNeutral,
        status: '',
        format: '',
        level: '',
      };
    }
    const proposal = proposals.get(entry.proposalId);
    if (!proposal) {
      return {
        speaker: '',
        category: '',
        categoryLabel: t.proposal.category,
        language: t.schedule.languageNeeded,
        status: t.schedule.placementIneligible,
        format: '',
        level: '',
      };
    }
    const language = scheduledProposalLanguage(proposal, entry);
    return {
      speaker: proposalName(proposal),
      category: optionLabel(submissionForm?.category, proposal.category, locale),
      categoryLabel: t.proposal.category,
      language: language ? t.schedule.languageNames[language] : t.schedule.languageNeeded,
      status:
        proposal.status === 'confirmed'
          ? t.schedule.confirmed
          : proposal.status === 'accepted'
            ? t.schedule.tentative
            : t.enums.status[proposal.status],
      format: optionLabel(submissionForm?.format, proposal.format, locale),
      level: optionLabel(submissionForm?.level, proposal.level, locale),
    };
  }

  function factDescription(entry: ScheduleEntry): string {
    const facts = factsFor(entry);
    return [
      facts.speaker ? `${t.schedule.speakers}: ${facts.speaker}` : '',
      facts.category ? `${facts.categoryLabel}: ${facts.category}` : '',
      `${t.schedule.language}: ${facts.language}`,
      facts.format ? `${t.proposal.format}: ${facts.format}` : '',
      facts.level ? `${t.proposal.level}: ${facts.level}` : '',
      facts.status ? `${t.schedule.confirmationStatus}: ${facts.status}` : '',
    ].filter(Boolean).join('. ');
  }

  const lineKind = (value: number) =>
    value % 60 === 0 ? 'hour' : value % 30 === 0 ? 'half' : 'quarter';

  function announce(message: string, invalid = false) {
    setAnnouncement(message);
    setAnnouncementInvalid(invalid);
  }

  function targetFromPointer(event: DragEvent<HTMLElement>, roomId: string): DropTarget {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.min(trackHeight, Math.max(0, event.clientY - rect.top));
    const rawMinutes = dayStart + offset / PIXELS_PER_MINUTE;
    const latestStart = Math.max(dayStart, dayEnd - SCHEDULE_LIMITS.durationStep);
    const snappedMinutes = Math.min(latestStart, Math.max(
      dayStart,
      Math.round(rawMinutes / SCHEDULE_LIMITS.durationStep) * SCHEDULE_LIMITS.durationStep,
    ));
    return { roomId, startsAt: timeOf(snappedMinutes) };
  }

  function dropPreviewFor(target: DropTarget | null) {
    if (!target || !dragging) return null;
    let candidate: ScheduleEntry | null = null;
    let title = '';
    if (dragging.kind === 'entry') {
      const entry = entries.find((item) => item.id === dragging.entryId);
      if (entry) {
        candidate = { ...entry, date, roomId: target.roomId, startsAt: target.startsAt };
        title = entryTitle(entry, proposals, locale);
      }
    } else {
      const proposal = proposals.get(dragging.proposalId);
      if (proposal) {
        candidate = {
          id: `drag-${proposal.id}`,
          kind: 'proposal',
          proposalId: proposal.id,
          date,
          roomId: target.roomId,
          startsAt: target.startsAt,
          durationMinutes: suggestedDuration(proposal.format),
        };
        title = proposal.title;
      }
    }
    if (!candidate) return null;
    const range = `${candidate.startsAt}–${scheduleEndTime(candidate)}`;
    const room = config.rooms.find((item) => item.id === target.roomId);
    const roomLabel = room ? roomName(room, locale) : target.roomId;
    const pastEnd = minutes(candidate.startsAt) + candidate.durationMinutes > dayEnd;
    const candidateEntries = [
      ...entries.filter((entry) => entry.id !== candidate?.id),
      candidate,
    ];
    const conflict = scheduleConflicts(candidateEntries, speakersByProposal).some((item) =>
      item.entryIds.includes(candidate.id),
    );
    const invalidReason = pastEnd
      ? t.schedule.dragOutsideDay
      : conflict
        ? t.schedule.dragConflict
        : '';
    return {
      candidate,
      title,
      range,
      roomLabel,
      invalidReason,
      status: `${t.schedule.dragGuide(range, roomLabel)}${invalidReason ? ` ${invalidReason}` : ''}`,
    };
  }

  const dropPreview = dropPreviewFor(dropTarget);

  function resizeConflicts(entry: ScheduleEntry): boolean {
    const candidates = [...entries.filter((item) => item.id !== entry.id), entry];
    return scheduleConflicts(candidates, speakersByProposal).some((item) =>
      item.entryIds.includes(entry.id),
    );
  }

  function placementEligible(entry: ScheduleEntry): boolean {
    return (
      entry.kind === 'custom' ||
      scheduleProposalEligible(proposals.get(entry.proposalId)?.status)
    );
  }

  async function commitResize(entry: ScheduleEntry, durationMinutes: number) {
    if (!placementEligible(entry)) return false;
    if (durationMinutes === entry.durationMinutes) return;
    const candidate = { ...entry, durationMinutes };
    const range = `${candidate.startsAt}–${scheduleEndTime(candidate)}`;
    if (resizeConflicts(candidate)) {
      announce(t.schedule.resizeConflict(range), true);
      return false;
    }
    const saved = await onResize(candidate);
    announce(
      saved
        ? t.schedule.resizeValue(range, durationMinutes)
        : t.schedule.resizeNotSaved,
      !saved,
    );
    return saved;
  }

  function beginResize(
    entry: ScheduleEntry,
    pointerId: number,
    startPosition: number,
    axis: ResizeGesture['axis'],
  ) {
    const gesture: ResizeGesture = {
      entryId: entry.id,
      pointerId,
      axis,
      startPosition,
      initialDuration: entry.durationMinutes,
      durationMinutes: entry.durationMinutes,
    };
    resizingRef.current = gesture;
    setResizing(gesture);
    return gesture;
  }

  function startPointerResize(
    event: ReactPointerEvent<HTMLElement>,
    entry: ScheduleEntry,
    axis: ResizeGesture['axis'],
  ) {
    if (busy || !interactive || !placementEligible(entry)) return;
    event.preventDefault();
    event.stopPropagation();
    if (axis === 'horizontal') event.currentTarget.focus({ preventScroll: true });
    setSelectedEntryId(entry.id);
    const startPosition = axis === 'horizontal' ? event.clientX : event.clientY;
    const gesture = beginResize(entry, event.pointerId, startPosition, axis);
    resizeCleanupRef.current?.();
    const move = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== gesture.pointerId) return;
      nextEvent.preventDefault();
      moveResize(
        gesture.axis === 'horizontal' ? nextEvent.clientX : nextEvent.clientY,
        gesture.pointerId,
        entry,
      );
    };
    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== gesture.pointerId) return;
      resizeCleanupRef.current?.();
      finishResize(gesture.pointerId, entry);
    };
    const cancel = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== gesture.pointerId) return;
      resizeCleanupRef.current?.();
      cancelResize();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  }

  function moveResize(position: number, pointerId: number, entry: ScheduleEntry) {
    const gesture = resizingRef.current;
    if (!gesture || gesture.pointerId !== pointerId || gesture.entryId !== entry.id) return;
    const bounds = scheduleDurationBounds(entry.date, entry.startsAt, config);
    if (!bounds) return;
    const deltaMinutes = (position - gesture.startPosition) / PIXELS_PER_MINUTE;
    const requested = gesture.initialDuration +
      Math.round(deltaMinutes / bounds.step) * bounds.step;
    const durationMinutes = snapScheduleDuration(requested, bounds, gesture.initialDuration);
    const next = { ...gesture, durationMinutes };
    resizingRef.current = next;
    setResizing(next);
    const range = `${entry.startsAt}–${scheduleEndTime({ ...entry, durationMinutes })}`;
    announce(
      requested > bounds.max || requested < bounds.min
        ? t.schedule.resizeLimited(range)
        : t.schedule.resizeValue(range, durationMinutes),
    );
  }

  function finishResize(pointerId: number, entry: ScheduleEntry) {
    const gesture = resizingRef.current;
    if (!gesture || gesture.pointerId !== pointerId || gesture.entryId !== entry.id) return;
    resizingRef.current = null;
    void commitResize(entry, gesture.durationMinutes).finally(() => {
      setResizing((current) => current?.entryId === entry.id ? null : current);
    });
  }

  function cancelResize() {
    resizingRef.current = null;
    setResizing(null);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>, entry: ScheduleEntry) {
    const resizeKey =
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End';
    if (!resizeKey) return;
    if (!placementEligible(entry)) {
      event.preventDefault();
      return;
    }
    if (busy || !interactive) {
      event.preventDefault();
      return;
    }
    const bounds = scheduleDurationBounds(entry.date, entry.startsAt, config);
    if (!bounds) return;
    let requested: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') requested = entry.durationMinutes - bounds.step;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') requested = entry.durationMinutes + bounds.step;
    if (event.key === 'PageUp') requested = entry.durationMinutes - SLOT_MINUTES;
    if (event.key === 'PageDown') requested = entry.durationMinutes + SLOT_MINUTES;
    if (event.key === 'Home') requested = bounds.min;
    if (event.key === 'End') requested = bounds.max;
    if (requested === null) return;
    event.preventDefault();
    event.stopPropagation();
    const durationMinutes = event.key === 'Home'
      ? bounds.min
      : event.key === 'End'
        ? bounds.max
        : snapScheduleDuration(requested, bounds, entry.durationMinutes);
    const range = `${entry.startsAt}–${scheduleEndTime({ ...entry, durationMinutes })}`;
    if (durationMinutes === entry.durationMinutes) {
      announce(t.schedule.resizeLimited(range));
      return;
    }
    void commitResize(entry, durationMinutes);
  }

  const selectedDuration = selectedEntry
    ? resizing?.entryId === selectedEntry.id
      ? resizing.durationMinutes
      : selectedEntry.durationMinutes
    : null;
  const selectedTitle = selectedEntry ? entryTitle(selectedEntry, proposals, locale) : '';
  const selectedRange = selectedEntry && selectedDuration !== null
    ? `${selectedEntry.startsAt}–${scheduleEndTime({ ...selectedEntry, durationMinutes: selectedDuration })}`
    : '';
  const selectedBounds = selectedEntry
    ? scheduleDurationBounds(selectedEntry.date, selectedEntry.startsAt, config)
    : null;
  const selectedFacts = selectedEntry ? factsFor(selectedEntry) : null;
  const selectedEligible = selectedEntry ? placementEligible(selectedEntry) : true;

  function selectEntry(entryId: string, reveal = false) {
    setSelectedEntryId(entryId);
    if (!reveal) return;
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`schedule-grid-entry-${entryId}`);
      const scroller = card?.closest<HTMLElement>('.schedule-grid-scroll');
      if (!card || !scroller) return;
      const cardRect = card.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const stickyHeader = scroller.querySelector<HTMLElement>('.schedule-grid__room');
      const stickyRail = scroller.querySelector<HTMLElement>('.schedule-grid__times');
      const topEdge = scrollerRect.top + (stickyHeader?.offsetHeight ?? 0) + 8;
      const bottomEdge = scrollerRect.bottom - 8;
      const leftEdge = scrollerRect.left + (stickyRail?.offsetWidth ?? 0) + 8;
      const rightEdge = scrollerRect.right - 8;
      let top = scroller.scrollTop;
      let left = scroller.scrollLeft;
      if (cardRect.top < topEdge) top += cardRect.top - topEdge;
      else if (cardRect.bottom > bottomEdge) top += cardRect.bottom - bottomEdge;
      if (cardRect.left < leftEdge) left += cardRect.left - leftEdge;
      else if (cardRect.right > rightEdge) left += cardRect.right - rightEdge;
      scroller.scrollTo({ top, left, behavior: 'auto' });
    });
  }

  return (
    <>
      {selectedEntry && selectedDuration !== null && selectedBounds && (
        <section className="schedule-resize-inspector" aria-label={t.schedule.resizeSession}>
          <label className="schedule-resize-inspector__field" htmlFor={resizePickerId}>
            <span>{t.schedule.selectedSession}</span>
            <select
              id={resizePickerId}
              className="field__input field__input--select"
              value={selectedEntry.id}
              disabled={busy || !interactive}
              onChange={(event) => selectEntry(event.target.value, true)}
            >
              {dayEntries.map((entry) => {
                const room = config.rooms.find((candidate) => candidate.id === entry.roomId);
                const range = `${entry.startsAt}–${scheduleEndTime(entry)}`;
                return (
                  <option key={entry.id} value={entry.id}>
                    {entryTitle(entry, proposals, locale)} · {range} · {room ? roomName(room, locale) : entry.roomId}
                  </option>
                );
              })}
            </select>
            <span className="schedule-resize-inspector__selected-title" aria-hidden="true">
              {selectedTitle}
            </span>
          </label>
          <div className="schedule-resize-inspector__control">
            <span>{t.schedule.duration}</span>
            <button
              type="button"
              role="slider"
              className="schedule-resize-inspector__slider"
              aria-disabled={busy || !interactive || !selectedEligible}
              aria-label={t.schedule.resizeLabel(selectedTitle)}
              aria-orientation="horizontal"
              aria-valuemin={selectedBounds.min}
              aria-valuemax={selectedBounds.max}
              aria-valuenow={selectedDuration}
              aria-valuetext={t.schedule.resizeValue(selectedRange, selectedDuration)}
              title={t.schedule.resizeHint}
              onKeyDown={(event) => resizeWithKeyboard(event, selectedEntry)}
              onPointerDown={(event) => startPointerResize(event, selectedEntry, 'horizontal')}
            >
              <span className="schedule-resize-inspector__summary">
                <strong title={selectedTitle}>{selectedTitle}</strong>
                <time>{selectedRange}</time>
              </span>
              <span className="schedule-resize-inspector__value">
                {t.schedule.durationValue(selectedDuration)}
              </span>
            </button>
            <small>{t.schedule.resizeHint}</small>
          </div>
          <div className="schedule-resize-inspector__action">
            <span>{t.schedule.sessionActions}</span>
            <div className="schedule-resize-inspector__actions">
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                disabled={busy || !interactive}
                onClick={() => onEdit(selectedEntry)}
              >
                {t.schedule.editSelected}
              </button>
              {selectedEntry.kind === 'proposal' && (
                <Link
                  className="btn btn--ghost btn--compact"
                  to={`${href({ route: 'admin', cfpId, tab: 'proposals' })}?manageSpeakers=${encodeURIComponent(selectedEntry.proposalId)}`}
                  aria-label={t.coSpeakers.manageFor(selectedTitle)}
                >
                  {t.coSpeakers.manage}
                </Link>
              )}
            </div>
          </div>
          {!selectedEligible && selectedEntry.kind === 'proposal' && (
            <div className="schedule-placement-warning" role="status">
              <div>
                <strong>{t.schedule.placementIneligibleTitle}</strong>
                <span>{t.schedule.placementIneligibleHelp}</span>
              </div>
              <Link
                className="btn btn--ghost btn--compact"
                to={href({ route: 'admin', cfpId, tab: 'proposals' })}
              >
                {t.schedule.openProposals}
              </Link>
            </div>
          )}
          {selectedFacts && (
            <dl className="schedule-resize-inspector__facts" aria-label={t.schedule.sessionFacts}>
              {selectedFacts.speaker && (
                <div><dt>{t.schedule.speakers}</dt><dd>{selectedFacts.speaker}</dd></div>
              )}
              {selectedFacts.category && (
                <div><dt>{selectedFacts.categoryLabel}</dt><dd>{selectedFacts.category}</dd></div>
              )}
              <div><dt>{t.schedule.language}</dt><dd>{selectedFacts.language}</dd></div>
              {selectedFacts.format && (
                <div><dt>{t.proposal.format}</dt><dd>{selectedFacts.format}</dd></div>
              )}
              {selectedFacts.level && (
                <div><dt>{t.proposal.level}</dt><dd>{selectedFacts.level}</dd></div>
              )}
              {selectedFacts.status && (
                <div><dt>{t.schedule.confirmationStatus}</dt><dd>{selectedFacts.status}</dd></div>
              )}
            </dl>
          )}
        </section>
      )}
      <p className={`schedule-board__status${dropPreview || announcement ? '' : ' schedule-board__status--idle'}${dropPreview?.invalidReason || (!dropPreview && announcementInvalid) ? ' schedule-board__status--invalid' : ''}`} role="status" aria-live="polite">
        {dropPreview?.status ?? announcement}
      </p>
      <div className="schedule-grid-scroll">
        <div className="schedule-grid" style={{ '--schedule-rooms': config.rooms.length } as CSSProperties}>
        <div className="schedule-grid__corner"><span>{t.schedule.time}</span></div>
        {config.rooms.map((room) => (
          <div className="schedule-grid__room" key={room.id}>{roomName(room, locale)}</div>
        ))}
        <div className="schedule-grid__times" style={{ height: trackHeight }}>
          {lineMinutes.map((value) => (value === dayStart || value % 30 === 0) && (
            <time
              key={value}
              className={`schedule-grid__time schedule-grid__time--${lineKind(value)}`}
              dateTime={timeOf(value)}
              style={{ top: (value - dayStart) * PIXELS_PER_MINUTE }}
            >
              {timeOf(value)}
            </time>
          ))}
        </div>
        {config.rooms.map((room, roomIndex) => {
          const roomEntries = entries.filter((entry) => entry.date === date && entry.roomId === room.id);
          return (
            <div
              className="schedule-grid__track"
              key={room.id}
              style={{ height: trackHeight, gridColumn: roomIndex + 2 }}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const target = targetFromPointer(event, room.id);
                setDropTarget((current) =>
                  current?.roomId === target.roomId && current.startsAt === target.startsAt
                    ? current
                    : target,
                );
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(event) => {
                if (!dragging) return;
                event.preventDefault();
                const target = targetFromPointer(event, room.id);
                const preview = dropPreviewFor(target);
                if (preview?.invalidReason) {
                  setDropTarget(target);
                  announce(preview.status, true);
                  return;
                }
                announce(preview?.status ?? '');
                setDropTarget(null);
                onDrop(room.id, target.startsAt);
              }}
            >
              {lineMinutes.map((value, index) => {
                const next = lineMinutes[index + 1] ?? dayEnd;
                const slot = timeOf(value);
                return (
                <button
                  type="button"
                  className={`schedule-grid__slot schedule-grid__slot--${lineKind(value)}`}
                  key={slot}
                  style={{
                    top: (value - dayStart) * PIXELS_PER_MINUTE,
                    height: (next - value) * PIXELS_PER_MINUTE,
                  }}
                  aria-label={emptySlot(slot, roomName(room, locale))}
                  tabIndex={-1}
                  disabled={busy || !interactive}
                  onClick={() => onEmpty(date, room.id, slot)}
                />
                );
              })}
              {dropPreview && dropTarget?.roomId === room.id && (
                <div
                  className={`schedule-drop-guide${dropPreview.invalidReason ? ' schedule-drop-guide--invalid' : ''}`}
                  style={{
                    top: (minutes(dropPreview.candidate.startsAt) - dayStart) * PIXELS_PER_MINUTE,
                    height: dropPreview.candidate.durationMinutes * PIXELS_PER_MINUTE,
                  }}
                  aria-hidden="true"
                >
                  <span className="schedule-drop-guide__label">
                    <time>{dropPreview.range}</time>
                    <strong>{dropPreview.title}</strong>
                    <span>{dropPreview.roomLabel}</span>
                  </span>
                </div>
              )}
              {roomEntries.map((entry) => {
                const top = ((minutes(entry.startsAt) - minutes(day.startsAt)) / SLOT_MINUTES) * SLOT_HEIGHT;
                const displayDuration = resizing?.entryId === entry.id
                  ? resizing.durationMinutes
                  : entry.durationMinutes;
                const height = displayDuration * PIXELS_PER_MINUTE;
                const proposal = entry.kind === 'proposal' ? proposals.get(entry.proposalId) : undefined;
                const eligible = placementEligible(entry);
                const title = entryTitle(entry, proposals, locale);
                const range = `${entry.startsAt}–${scheduleEndTime({ ...entry, durationMinutes: displayDuration })}`;
                const facts = factsFor(entry);
                const factsId = `schedule-card-facts-${entry.id}`;
                const description = factDescription(entry);
                return (
                  <div
                    id={`schedule-grid-entry-${entry.id}`}
                    key={entry.id}
                    className={`schedule-card schedule-card--${entry.kind}${selectedEntry?.id === entry.id ? ' schedule-card--selected' : ''}${displayDuration < 15 ? ' schedule-card--micro' : displayDuration <= 20 ? ' schedule-card--compact' : ''}${displayDuration <= 45 ? ' schedule-card--condensed' : ''}${proposal?.status === 'accepted' ? ' schedule-card--tentative' : ''}${!eligible ? ' schedule-card--ineligible' : ''}${dragging?.kind === 'entry' && dragging.entryId === entry.id ? ' schedule-card--dragging' : ''}${resizing?.entryId === entry.id ? ' schedule-card--resizing' : ''}`}
                    style={{ top, height }}
                  >
                    <button
                      type="button"
                      className="schedule-card__body"
                      draggable={!busy && interactive && eligible}
                      disabled={busy || !interactive}
                      aria-label={`${moveLabel}: ${title}, ${range}`}
                      aria-describedby={factsId}
                      title={`${title} · ${range} · ${description}`}
                      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                        if (!eligible) {
                          event.preventDefault();
                          return;
                        }
                        setSelectedEntryId(entry.id);
                        onDrag({ kind: 'entry', entryId: entry.id });
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', title);
                      }}
                      onDragEnd={() => onDrag(null)}
                      onClick={() => {
                        setSelectedEntryId(entry.id);
                        onEdit(entry);
                      }}
                    >
                      <time>{range}</time>
                      <strong title={title}>{title}</strong>
                      <span className="schedule-card__facts" aria-hidden="true">
                        {facts.speaker && <span className="schedule-card__speaker">{facts.speaker}</span>}
                        {facts.category && <span className="schedule-card__category">{facts.category}</span>}
                        <span className="schedule-card__language">{facts.language}</span>
                        {facts.status && <span className="schedule-card__status">{facts.status}</span>}
                      </span>
                      <span id={factsId} className="visually-hidden">{description}</span>
                    </button>
                    {interactive && !busy && eligible && displayDuration >= SLOT_MINUTES && (
                      <span
                        className="schedule-card__resize-direct"
                        aria-hidden="true"
                        title={t.schedule.resizeHint}
                        onPointerDown={(event) => startPointerResize(event, entry, 'vertical')}
                      >
                        <span />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        </div>
      </div>
    </>
  );
}

function EntryEditor({
  cfpId,
  entry,
  config,
  proposal,
  submissionForm,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
  onRemove,
  onReload,
}: {
  cfpId: string;
  entry: ScheduleEntry;
  config: ScheduleConfig;
  proposal?: ProposalRow;
  submissionForm: SubmissionForm | null;
  busy: boolean;
  error: string;
  onChange: Dispatch<SetStateAction<ScheduleEntry | null>>;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onReload: () => void;
}) {
  const { t, locale } = useI18n();
  const [photoBusy, setPhotoBusy] = useState(false);
  const proposalLanguage = proposal && entry.kind === 'proposal'
    ? scheduledProposalLanguage(proposal, entry)
    : null;
  const placementLocked =
    entry.kind === 'proposal' && !scheduleProposalEligible(proposal?.status);
  const dialogRef = useModalFocus(() => {
    if (!busy && !photoBusy) onCancel();
  });
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) feedbackRef.current?.focus({ preventScroll: true });
  }, [error]);

  const customSpeakers = entry.kind === 'custom' ? entry.speakers ?? [] : [];
  const customSpeakerNamesReady = customSpeakers.every((speaker) => speaker.name.trim());

  function updateCustomSpeaker(index: number, patch: Partial<CustomScheduleSpeaker>) {
    onChange((current) => {
      if (current?.kind !== 'custom') return current;
      const speakers = [...(current.speakers ?? [])];
      const speaker = speakers[index];
      if (!speaker) return current;
      const updated = { ...speaker, ...patch };
      if ('photoAssetRef' in patch && patch.photoAssetRef === undefined) {
        delete updated.photoAssetRef;
      }
      speakers[index] = updated;
      return { ...current, speakers };
    });
  }

  function addCustomSpeaker() {
    onChange((current) => {
      if (current?.kind !== 'custom') return current;
      const speakers = current.speakers ?? [];
      if (speakers.length >= SCHEDULE_LIMITS.customSpeakers) return current;
      return { ...current, speakers: [...speakers, { name: '' }] };
    });
    requestAnimationFrame(() => {
      const speakerNames = dialogRef.current
        ?.querySelectorAll<HTMLInputElement>('.schedule-custom-speaker input[aria-required="true"]');
      speakerNames?.item(speakerNames.length - 1)?.focus();
    });
  }

  function removeCustomSpeaker(index: number) {
    onChange((current) => {
      if (current?.kind !== 'custom') return current;
      const speakers = (current.speakers ?? []).filter(
        (_, speakerIndex) => speakerIndex !== index,
      );
      if (speakers.length) return { ...current, speakers };
      const withoutSpeakers = { ...current };
      delete withoutSpeakers.speakers;
      return withoutSpeakers;
    });
  }

  return (
    <div
      className="schedule-dialog-backdrop"
      onMouseDown={(event) => {
        if (!busy && !photoBusy && event.target === event.currentTarget) onCancel();
      }}
    >
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
            <p>
              {entry.kind === 'proposal'
                ? (proposal ? proposalName(proposal) : '')
                : [t.schedule.types[entry.customType], customSpeakerNames(entry)]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
            <h3 id="schedule-editor-title">
              {entry.kind === 'proposal' ? proposal?.title : t.schedule.custom}
            </h3>
            {entry.kind === 'proposal' && proposal && (
              <div className="schedule-dialog__facts">
                <span>{optionLabel(submissionForm?.category, proposal.category, locale)}</span>
                <span>{optionLabel(submissionForm?.format, proposal.format, locale)}</span>
                <span>{optionLabel(submissionForm?.level, proposal.level, locale)}</span>
                <span>
                  {proposalLanguage
                    ? t.schedule.languageNames[proposalLanguage]
                    : t.schedule.languageNeeded}
                </span>
                <span>
                  {proposal.status === 'confirmed'
                    ? t.schedule.confirmed
                    : proposal.status === 'accepted'
                      ? t.schedule.tentative
                      : t.enums.status[proposal.status]}
                </span>
              </div>
            )}
          </div>
          <button
            data-autofocus
            type="button"
            className="btn btn--ghost btn--compact"
            disabled={busy || photoBusy}
            onClick={onCancel}
          >
            {t.schedule.cancelEdit}
          </button>
        </div>
        {placementLocked && (
          <div className="schedule-placement-warning" role="status">
            <div>
              <strong>{t.schedule.placementIneligibleTitle}</strong>
              <span>{t.schedule.placementIneligibleHelp}</span>
            </div>
            <Link
              className="btn btn--ghost btn--compact"
              to={href({ route: 'admin', cfpId, tab: 'proposals' })}
            >
              {t.schedule.openProposals}
            </Link>
          </div>
        )}
        <div className="grid grid--2">
          <SelectField
            label={t.schedule.date}
            value={entry.date}
            options={config.days.map((day) => ({
              value: day.date,
              label: formatCalendarDay(calendarDate(day.date)!, locale),
            }))}
            onChange={(date) => onChange({ ...entry, date })}
            disabled={busy || placementLocked}
            required
          />
          <SelectField
            label={t.schedule.room}
            value={entry.roomId}
            options={config.rooms.map((room) => ({ value: room.id, label: roomName(room, locale) }))}
            onChange={(roomId) => onChange({ ...entry, roomId })}
            disabled={busy || placementLocked}
            required
          />
          <TextField
            label={t.schedule.startsAt}
            type="time"
            value={entry.startsAt}
            onChange={(startsAt) => onChange({ ...entry, startsAt })}
            placeholder="09:00"
            disabled={busy || placementLocked}
            required
          />
          <div className="field">
            <label className="field__label" htmlFor="schedule-entry-duration">
              {t.schedule.duration}
              <span className="field__requirement">{t.form.required}</span>
            </label>
            <input
              id="schedule-entry-duration"
              className="field__input"
              type="number"
              min={SCHEDULE_LIMITS.durationMin}
              max={SCHEDULE_LIMITS.durationMax}
              step={SCHEDULE_LIMITS.durationStep}
              value={entry.durationMinutes}
              onChange={(event) => onChange({ ...entry, durationMinutes: Number(event.target.value) })}
              disabled={busy || placementLocked}
              required
              aria-required="true"
            />
          </div>
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
            disabled={busy || placementLocked}
            required
          />
        )}
        {entry.kind === 'custom' && (
          <>
            <div className="grid grid--2 grid--align-controls">
              <SelectField<CustomScheduleType>
                label={t.schedule.itemType}
                value={entry.customType}
                options={CUSTOM_SCHEDULE_TYPES.map((value) => ({ value, label: t.schedule.types[value] }))}
                onChange={(customType) => onChange({ ...entry, customType })}
                disabled={busy}
                required
              />
              <SelectField<ScheduleLanguage | ''>
                label={t.schedule.language}
                help={t.schedule.customLanguageHelp}
                value={entry.language ?? ''}
                options={[
                  { value: '', label: t.schedule.languageNeutral },
                  ...SCHEDULE_LANGUAGES.map((value) => ({
                    value,
                    label: t.schedule.languageNames[value],
                  })),
                ]}
                onChange={(language) => {
                  if (language) {
                    onChange({ ...entry, language });
                    return;
                  }
                  const neutralEntry = { ...entry };
                  delete neutralEntry.language;
                  onChange(neutralEntry);
                }}
                disabled={busy}
              />
            </div>
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
            <fieldset className="schedule-custom-speakers">
              <legend>{t.schedule.customSpeakersTitle}</legend>
              <div className="schedule-custom-speakers__heading">
                <div>
                  <p>{t.schedule.customSpeakersHelp}</p>
                  <span>{t.schedule.customSpeakerCount(customSpeakers.length, SCHEDULE_LIMITS.customSpeakers)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--compact"
                  disabled={
                    busy || photoBusy || customSpeakers.length >= SCHEDULE_LIMITS.customSpeakers
                  }
                  onClick={addCustomSpeaker}
                >
                  {t.schedule.addCustomSpeaker}
                </button>
              </div>
              {customSpeakers.length === 0 ? (
                <p className="schedule-custom-speakers__empty">{t.schedule.noCustomSpeakers}</p>
              ) : (
                <div className="schedule-custom-speakers__list">
                  {customSpeakers.map((speaker, index) => (
                    <fieldset
                      className="schedule-custom-speaker"
                      key={index}
                    >
                      <legend className="visually-hidden">
                        {t.schedule.customSpeakerNumber(index + 1)}
                      </legend>
                      <div className="schedule-custom-speaker__heading">
                        <strong>{speaker.name.trim() || t.schedule.customSpeakerNumber(index + 1)}</strong>
                        <button
                          type="button"
                          className="btn btn--ghost btn--compact"
                          disabled={busy || photoBusy}
                          onClick={() => removeCustomSpeaker(index)}
                          aria-label={t.schedule.removeCustomSpeaker(index + 1)}
                        >
                          {t.schedule.removeCustomSpeakerShort}
                        </button>
                      </div>
                      <CustomScheduleSpeakerPhoto
                        cfpId={cfpId}
                        speakerNumber={index + 1}
                        photoAssetRef={speaker.photoAssetRef}
                        disabled={busy || photoBusy}
                        onBusyChange={setPhotoBusy}
                        onChange={(photoAssetRef) =>
                          updateCustomSpeaker(index, { photoAssetRef })
                        }
                      />
                      <div className="grid grid--2 schedule-custom-speaker__fields">
                        <TextField
                          label={t.schedule.customSpeakerName(index + 1)}
                          value={speaker.name}
                          onChange={(name) => updateCustomSpeaker(index, { name })}
                          maxLength={SCHEDULE_LIMITS.speakerName}
                          disabled={busy}
                          error={!speaker.name.trim() ? t.schedule.customSpeakerNameMissing : undefined}
                          required
                        />
                        <TextField
                          label={t.schedule.customSpeakerJobTitle(index + 1)}
                          value={speaker.jobTitle ?? ''}
                          onChange={(jobTitle) => updateCustomSpeaker(index, { jobTitle })}
                          maxLength={SCHEDULE_LIMITS.speakerJobTitle}
                          disabled={busy}
                        />
                        <TextField
                          label={t.schedule.customSpeakerCompany(index + 1)}
                          value={speaker.company ?? ''}
                          onChange={(company) => updateCustomSpeaker(index, { company })}
                          maxLength={SCHEDULE_LIMITS.speakerCompany}
                          disabled={busy}
                        />
                        <TextAreaField
                          label={t.schedule.customSpeakerBio(index + 1)}
                          value={speaker.bio ?? ''}
                          onChange={(bio) => updateCustomSpeaker(index, { bio })}
                          maxLength={SCHEDULE_LIMITS.speakerBio}
                          disabled={busy}
                          rows={3}
                        />
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
              {!customSpeakerNamesReady && (
                <p className="schedule-custom-speakers__validation" role="status">
                  {t.schedule.customSpeakerNameRequired}
                </p>
              )}
            </fieldset>
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
          <button type="button" className="btn btn--danger" disabled={busy || photoBusy} onClick={onRemove}>
            {t.schedule.remove}
          </button>
          <span className="schedule-dialog__actions-spacer" />
          <button type="button" className="btn" disabled={busy || photoBusy} onClick={onCancel}>{t.schedule.cancelEdit}</button>
          <button type="button" className="btn btn--primary" disabled={busy || photoBusy || placementLocked || !customSpeakerNamesReady} onClick={onSave}>{t.schedule.saveItem}</button>
        </div>
      </section>
    </div>
  );
}

function PublishReview({
  scheduled,
  unscheduled,
  omitted,
  conflicts,
  callOpen,
  busy,
  error,
  onCancel,
  onPublish,
}: {
  scheduled: number;
  unscheduled: number;
  omitted: number;
  conflicts: number;
  callOpen: boolean;
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
        {callOpen && (
          <div className="schedule-publish-warning" role="status">
            <strong>{t.schedule.publishOpenTitle}</strong>
            <span>{t.schedule.publishOpenHelp}</span>
          </div>
        )}
        <div className="schedule-metrics" aria-label={t.schedule.metrics}>
          <strong>{t.schedule.scheduledCount(scheduled)}</strong>
          <span>{t.schedule.unassignedCount(unscheduled)}</span>
          <span>{t.schedule.omittedCount(omitted)}</span>
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

function ShareReview({
  scheduled,
  omitted,
  conflicts,
  busy,
  error,
  onCancel,
  onShare,
}: {
  scheduled: number;
  omitted: number;
  conflicts: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onShare: () => void;
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
        aria-labelledby="schedule-share-title"
        aria-describedby="schedule-share-help schedule-share-delivery"
        tabIndex={-1}
      >
        <div className="schedule-dialog__heading">
          <div>
            <p>{t.schedule.sharedPreviewTitle}</p>
            <h3 id="schedule-share-title">{t.schedule.shareTitle}</h3>
          </div>
          <button data-autofocus type="button" className="btn btn--ghost btn--compact" onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
        </div>
        <p id="schedule-share-help">{t.schedule.shareHelp}</p>
        <p id="schedule-share-delivery" className="schedule-share-delivery">
          {t.schedule.shareDeliveryHelp}
        </p>
        <ul className="schedule-audience-list">
          <li>{t.schedule.shareSpeakerAudience}</li>
          <li>{t.schedule.shareCommitteeAudience}</li>
          <li>{t.schedule.sharePublicAudience}</li>
        </ul>
        <div className="schedule-metrics" aria-label={t.schedule.metrics}>
          <strong>{t.schedule.sharedCount(scheduled)}</strong>
          <span>{t.schedule.omittedCount(omitted)}</span>
          <span>{t.schedule.conflictCount(conflicts)}</span>
        </div>
        {error && <Result ok="" error={error} />}
        <div className="schedule-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onShare}>
            {t.schedule.shareConfirm}
          </button>
        </div>
      </section>
    </div>
  );
}

function OfflineReview({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useModalFocus(onCancel);
  return (
    <div className="schedule-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section
        ref={dialogRef}
        className="schedule-dialog schedule-offline-review"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="schedule-offline-title"
        aria-describedby="schedule-offline-help"
        tabIndex={-1}
      >
        <div className="schedule-dialog__heading">
          <div>
            <p>{t.schedule.publicProgrammeTitle}</p>
            <h3 id="schedule-offline-title">{t.schedule.takeOfflineTitle}</h3>
          </div>
          <button data-autofocus type="button" className="btn btn--ghost btn--compact" onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
        </div>
        <p id="schedule-offline-help">{t.schedule.takeOfflineHelp}</p>
        <p className="schedule-offline-review__kept">{t.schedule.takeOfflineKept}</p>
        {error && <Result ok="" error={error} />}
        <div className="schedule-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t.schedule.cancelEdit}
          </button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={onConfirm}>
            {t.schedule.takeOfflineConfirm}
          </button>
        </div>
      </section>
    </div>
  );
}
