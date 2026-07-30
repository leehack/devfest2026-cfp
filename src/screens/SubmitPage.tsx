import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { ATTENDANCE_STATUSES, LIMITS, inStatusSet } from '@shared/enums';
import { submissionSchema } from '@shared/schema';
import {
  DEFAULT_SUBMISSION_FORM,
  asOptions,
  type SubmissionForm,
} from '@shared/submissionForm';

import { useToast } from '../components/Toast';
import { Checkbox, RadioGroup, SelectField, TextAreaField, TextField } from '../components/fields';
import { FormProgress, type FormProgressItem } from '../components/FormProgress';
import { Reveal } from '../components/Reveal';
import { SessionizeImport } from '../components/SessionizeImport';
import {
  SpeakerFields,
  SpeakerProfileSummary,
  speakerProfileComplete,
} from '../components/SpeakerFields';
import { formatDate, type Dictionary } from '../i18n';
import { useI18n } from '../i18n/context';
import { COC_URL } from '../lib/env';
import { validationMessage } from '../i18n/validation';
import { friendlyError } from '../lib/errors';
import { track } from '../lib/analytics';
import { editScope, type EditScope } from '../lib/lifecycle';
import { goTo } from '../lib/router';
import {
  clearTalk,
  emptyForm,
  fromDocuments,
  toDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import {
  loadConfirmForm,
  loadSubmissionForm,
  loadMyProposals,
  deleteDraftProposal,
  saveDraft,
  submitProposal,
  respondToDecision,
  withdrawProposal,
  type CfpWindow,
  type LoadedProposal,
} from '../lib/proposals';
import type { ProposalStatus } from '@shared/enums';
import { HeadshotField } from '../components/HeadshotField';
import {
  EMPTY_FORM,
  FORM_LIMITS,
  headshotPath,
  localised,
  validateAnswers,
  type AnswerFaults,
  type AnswerValue,
  type Answers,
  type ConfirmField,
  type ConfirmForm,
} from '@shared/confirmForm';

type Errors = Record<string, string>;
type SaveSource = 'background' | 'manual' | 'transition';
const PAST_STATUSES = new Set<ProposalStatus>(['withdrawn', 'rejected', 'declined']);

function isPastTalk(talk: LoadedProposal): boolean {
  return PAST_STATUSES.has(talk.status);
}

interface TalkPickerProps {
  talks: LoadedProposal[];
  currentId: string | null;
  /** Live from the form, so the tab renames itself as the title is typed. */
  currentTitle: string;
  busy: boolean;
  canAdd: boolean;
  atCap: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

/** Hidden until there is a second talk to switch to — one talk needs no chooser. */
function TalkPicker({
  talks,
  currentId,
  currentTitle,
  busy,
  canAdd,
  atCap,
  onOpen,
  onAdd,
}: TalkPickerProps) {
  const { t } = useI18n();
  const isNew = currentId === null;
  const currentTalks = talks.filter((talk) => !isPastTalk(talk));
  const pastTalks = talks.filter(isPastTalk);
  const currentIsPast = pastTalks.some((talk) => talk.id === currentId);
  const [pastOpen, setPastOpen] = useState(currentIsPast);

  useEffect(() => {
    if (currentIsPast) setPastOpen(true);
  }, [currentIsPast]);

  if (talks.length === 0 || (talks.length === 1 && !canAdd && pastTalks.length === 0)) {
    return null;
  }

  const renderTab = (talk: LoadedProposal) => {
    const current = talk.id === currentId;
    const title = (current ? currentTitle : talk.proposal.title) || t.form.untitled;
    return (
      <button
        key={talk.id}
        type="button"
        className={`talks__tab${current ? ' talks__tab--on' : ''}`}
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={() => onOpen(talk.id)}
      >
        {title}
        {talk.status !== 'draft' && (
          <span className="talks__status">{t.enums.status[talk.status]}</span>
        )}
      </button>
    );
  };

  return (
    <nav className="talks" aria-label={t.form.yourTalks}>
      <span className="talks__label">{t.form.yourTalks}</span>
      {currentTalks.map(renderTab)}
      {isNew && <span className="talks__tab talks__tab--on">{currentTitle || t.form.newTalk}</span>}
      {canAdd && !isNew && (
        <button type="button" className="talks__add" disabled={busy} onClick={onAdd}>
          {t.form.addTalk}
        </button>
      )}
      {pastTalks.length > 0 && (
        <details
          className="talks__past"
          open={pastOpen}
          onToggle={(event) => setPastOpen(event.currentTarget.open)}
        >
          <summary>{t.form.pastTalksCount(pastTalks.length)}</summary>
          <div className="talks__past-list">{pastTalks.map(renderTab)}</div>
        </details>
      )}
      {atCap && <span className="talks__status">{t.form.talkCap(LIMITS.maxTalksPerSpeaker)}</span>}
    </nav>
  );
}

/**
 * An acknowledgement's text, plus the Code of Conduct link when there is one.
 *
 * The URL is a deployment setting (`NEXT_PUBLIC_COC_URL`) rather than part of the
 * form, so it attaches to the seeded `coc` acknowledgement by key. An organiser
 * writing their own puts the address in the label; that is one unclickable URL
 * against a build-time variable every tenant would otherwise share.
 */
function AckLabel({ ack }: { ack: ConfirmField }) {
  const { t, locale } = useI18n();
  const text = localised(ack.label, locale);
  const url = COC_URL;
  if (ack.key !== 'coc' || !url) return <>{text}</>;
  return (
    <>
      {text}{' '}
      <a href={url} target="_blank" rel="noreferrer">
        {t.acks.cocLink}
      </a>
    </>
  );
}

interface QuestionsProps {
  cfpId: string;
  uid: string;
  fields: ConfirmField[];
  answers: Answers;
  faults: AnswerFaults;
  busy: boolean;
  onAnswer: (key: string, value: AnswerValue) => void;
  onUploadBusyChange?: (key: string, busy: boolean) => void;
}

/**
 * The organiser's own questions, rendered from `cfps/{cfpId}/config/confirmForm`.
 *
 * Nothing here is hard-coded — a t-shirt size and a dietary note are one
 * event's questions, not the platform's, and an organiser who cannot add
 * "do you need a power outlet" without a deploy ends up chasing forty people
 * by email instead.
 */
function Questions({
  cfpId,
  uid,
  fields,
  answers,
  faults,
  busy,
  onAnswer,
  onUploadBusyChange,
}: QuestionsProps) {
  const { t, locale } = useI18n();
  const message = (key: string) => {
    const fault = faults[key];
    return fault ? t.form.answerErrors[fault] : undefined;
  };

  return (
    <>
      {fields.map((field) => {
        const label = localised(field.label, locale);
        const help = localised(field.help, locale) || undefined;
        const value = answers[field.key];

        if (field.type === 'image') {
          return (
            <HeadshotField
              key={field.key}
              cfpId={cfpId}
              uid={uid}
              fieldKey={field.key}
              label={label}
              help={help}
              required={field.required}
              error={message(field.key)}
              disabled={busy}
              // The stored answer is the path, so its presence is what says a
              // file exists. Set locally on upload too, purely so the control
              // updates — the callable re-derives it from the bucket regardless.
              uploaded={typeof value === 'string' && value !== ''}
              onUploaded={() => onAnswer(field.key, headshotPath(cfpId, uid, field.key))}
              onBusyChange={(next) => onUploadBusyChange?.(field.key, next)}
            />
          );
        }

        if (field.type === 'checkbox') {
          // `field` for the spacing every other question already gets — a
          // checkbox carries none of its own and ends up against the buttons.
          return (
            <div key={field.key} className="field">
              <Checkbox
                label={label}
                checked={value === true}
                onChange={(next) => onAnswer(field.key, next)}
                disabled={busy}
                error={message(field.key)}
              />
              {help && <p className="field__help">{help}</p>}
            </div>
          );
        }

        const text = typeof value === 'string' ? value : '';
        const common = {
          label,
          help,
          required: field.required,
          disabled: busy,
          error: message(field.key),
          value: text,
          onChange: (next: string) => onAnswer(field.key, next),
        };

        if (field.type === 'select') {
          return (
            <SelectField
              key={field.key}
              {...common}
              options={[
                { value: '', label: t.form.answerPick },
                ...(field.options ?? []).map((option) => ({
                  value: option.value,
                  label: localised(option.label, locale),
                })),
              ]}
            />
          );
        }
        if (field.type === 'textarea') {
          return (
            <TextAreaField
              key={field.key}
              {...common}
              maxLength={FORM_LIMITS.answerTextarea}
              rows={3}
            />
          );
        }
        return <TextField key={field.key} {...common} maxLength={FORM_LIMITS.answerText} />;
      })}
    </>
  );
}

interface StatusBannerProps {
  status: ProposalStatus;
  scope: EditScope;
  busy: boolean;
  /** Absent once withdrawing is no longer something they can do. */
  onWithdraw?: () => void;
  /** Present while the speaker can set or change their acceptance response. */
  onRespond?: (response: 'confirm' | 'decline') => void;
  questions: QuestionsProps;
  /** Open once they have said yes and there is something left to ask. */
  asking: boolean;
  onAsk: () => void;
  onCancelAsk: () => void;
  /** Present once confirmed, so an answer can still be corrected afterwards. */
  onSaveAnswers?: () => void;
}

/** Where the talk stands, and what is still theirs to change about it. */
function StatusBanner({
  status,
  scope,
  busy,
  onWithdraw,
  onRespond,
  questions,
  asking,
  onAsk,
  onCancelAsk,
  onSaveAnswers,
}: StatusBannerProps) {
  const { t } = useI18n();
  const good = status === 'accepted' || status === 'confirmed';
  const hasQuestions = questions.fields.length > 0;
  const canConfirm = status !== 'confirmed';
  const canDecline = status !== 'declined';

  return (
    <div className={`panel submission-status${good ? ' panel--good' : ''}`}>
      <h2>{t.enums.status[status]}</h2>
      <p>{t.form.statusHelp[status] ?? t.form.submittedHelp}</p>

      {/*
        The whole point of the acceptance email's link. Both answers are here
        because an accepted speaker who cannot come needs a way to say so that
        is not "ignore it until someone chases me" — an unanswered slot is the
        expensive one for the programme.

        Declining never asks the questions. Someone who cannot come should not
        have to pick a t-shirt size to say so.
      */}
      {onRespond && !asking && (
        <div className="card__actions">
          {canConfirm && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => (hasQuestions ? onAsk() : onRespond('confirm'))}
            >
              {t.form.confirmAccept}
            </button>
          )}
          {canDecline && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => onRespond('decline')}
            >
              {t.form.confirmDecline}
            </button>
          )}
        </div>
      )}

      {onRespond && asking && (
        <>
          <p className="field__help">{t.form.answersHelp}</p>
          <Questions {...questions} />
          <div className="card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => onRespond('confirm')}
            >
              {t.form.answersSubmit}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancelAsk}>
              {t.form.answersCancel}
            </button>
          </div>
        </>
      )}

      {/* Answered already, but a size guessed in a hurry should not be final.
          An archived round keeps the answers readable while omitting the save
          action; `questions.busy` freezes every control in that case. */}
      {status === 'confirmed' && hasQuestions && (
        <>
          <h3 className="card__subtitle">{t.form.answersTitle}</h3>
          <Questions {...questions} />
          {onSaveAnswers && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onSaveAnswers}
            >
              {t.form.answersSave}
            </button>
          )}
        </>
      )}

      <p className="muted">{t.form.editHelp[scope]}</p>
      {onWithdraw && (
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onWithdraw}>
          {t.form.withdraw}
        </button>
      )}
    </div>
  );
}

/** Flattens zod issue paths into the dotted keys the fields look themselves up by. */
function validate(form: FormState, shape: SubmissionForm, t: Dictionary): Errors {
  const result = submissionSchema(shape).safeParse(toSubmission(form));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = validationMessage(issue, t);
  }
  return errors;
}

function focusFirstInvalidField() {
  const control = document.querySelector<HTMLElement>(
    'input[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled)',
  );
  const field =
    control?.closest<HTMLElement>('.field--error') ??
    document.querySelector<HTMLElement>('.field--error');
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  control?.focus({ preventScroll: true });
}

interface SubmitPageProps {
  user: User;
  cfp: CfpWindow;
  cfpId: string;
}

export function SubmitPage({ user, cfp, cfpId }: SubmitPageProps) {
  const { t, locale } = useI18n();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [talks, setTalks] = useState<LoadedProposal[]>([]);
  const [speaker, setSpeaker] = useState<Record<string, any> | undefined>();
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProposalStatus>('draft');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState<ConfirmForm>(EMPTY_FORM);
  /** What this call asks for. Defaults until the config comes back, so the
      dropdowns are never momentarily empty. */
  const [shape, setShape] = useState<SubmissionForm>(DEFAULT_SUBMISSION_FORM);
  const [answers, setAnswers] = useState<Answers>({});
  const [answerFaults, setAnswerFaults] = useState<AnswerFaults>({});
  const [answerSaveState, setAnswerSaveState] =
    useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [uploadingAnswer, setUploadingAnswer] = useState(false);
  /**
   * Faults on *this call's own* questions, kept apart from `answerFaults`.
   * Those belong to the acceptance form and are filled in by the callable at
   * confirmation time; sharing one map would let a stale confirmation fault
   * mark a submission field red, and vice versa.
   */
  const [extraFaults, setExtraFaults] = useState<AnswerFaults>({});
  const [asking, setAsking] = useState(false);
  const [speakerEditing, setSpeakerEditing] = useState(true);

  const dirty = useRef(false);
  const revision = useRef(0);
  const activeSave = useRef<Promise<string> | null>(null);
  const answerDirty = useRef(false);
  const answerRevision = useRef(0);
  const activeAnswerSave = useRef<Promise<boolean> | null>(null);
  const uploadingFields = useRef(new Set<string>());
  const historyGuard = useRef(false);
  const historyTransition = useRef(false);
  const archived = cfp.state === 'archived';
  const scope = editScope(status, cfp.state === 'open', archived);
  const formRef = useRef(form);
  const proposalIdRef = useRef(proposalId);
  const scopeRef = useRef(scope);
  const talksRef = useRef(talks);
  const speakerRef = useRef(speaker);
  const statusRef = useRef(status);
  const answersRef = useRef(answers);
  const savedAnswersRef = useRef<Answers>({});
  const tRef = useRef(t);
  const localeRef = useRef(locale);
  formRef.current = form;
  proposalIdRef.current = proposalId;
  scopeRef.current = scope;
  talksRef.current = talks;
  speakerRef.current = speaker;
  statusRef.current = status;
  answersRef.current = answers;
  tRef.current = t;
  localeRef.current = locale;
  /** The talk itself: what the committee scores. */
  const readOnly = scope !== 'all';
  /** Travel answers: no bearing on the score, so they outlive the freeze. */
  const travelReadOnly = scope === 'none';
  const talkDisabled = readOnly || submitting;
  const travelDisabled = travelReadOnly || submitting;

  /*
   * Next owns browser Back before this client screen sees `popstate`. A guard
   * entry on the same URL makes the first Back stay on this mounted form, so we
   * can finish its write and only then continue to the entry underneath.
   */
  const armHistoryGuard = useCallback(() => {
    if (historyGuard.current) return;
    const state =
      history.state && typeof history.state === 'object'
        ? history.state
        : {};
    history.pushState(
      { ...state, __cfpFormGuard: `${cfpId}:${user.uid}` },
      '',
      `${location.pathname}${location.search}${location.hash}`,
    );
    historyGuard.current = true;
  }, [cfpId, user.uid]);

  const collapseHistoryGuard = useCallback(() => {
    if (!historyGuard.current || historyTransition.current) return;
    historyGuard.current = false;
    history.back();
  }, []);

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        // Both at once: the questions are organiser config, and waiting for the
        // proposals first would put a second round trip in front of a page that
        // already loads two documents.
        const [{ talks: found, speaker: profile }, questions, asked] = await Promise.all([
          loadMyProposals(cfpId, user),
          loadConfirmForm(cfpId),
          loadSubmissionForm(cfpId),
        ]);
        if (cancelled) return;
        setTalks(found);
        talksRef.current = found;
        setSpeaker(profile);
        speakerRef.current = profile;
        setConfirmForm(questions);
        setShape(asked);

        // Open the one they can still work on rather than whichever came back
        // first — landing on a submitted talk looks like the form is broken.
        const currentTalks = found.filter((talk) => !isPastTalk(talk));
        const open =
          cfp.state === 'open'
            ? (currentTalks.find((talk) => talk.status === 'draft') ?? currentTalks[0])
            : (currentTalks.find((talk) => talk.status === 'accepted') ??
              currentTalks.find((talk) => inStatusSet('speakerResponse', talk.status)) ??
              currentTalks[0] ??
              found[0]);
        if (open) {
          const next = fromDocuments(open.proposal, profile);
          setForm(next);
          setSpeakerEditing(!speakerProfileComplete(next));
          setProposalId(open.id);
          proposalIdRef.current = open.id;
          setStatus(open.status);
          const loadedAnswers = (open.proposal.confirmAnswers ?? {}) as Answers;
          setAnswers(loadedAnswers);
          savedAnswersRef.current = loadedAnswers;
          answerDirty.current = false;
        } else {
          // No talk here yet — but `speakers/{uid}` is global, so anyone who has
          // submitted to another call or filled in `/me` has already written all
          // of this. Starting them from blank was asking for it twice.
          const next = {
            ...fromDocuments(undefined, profile),
            name: profile?.name || user.displayName || '',
            email: user.email ?? '',
          };
          setForm(next);
          setSpeakerEditing(!speakerProfileComplete(next));
          setAnswers({});
          savedAnswersRef.current = {};
          answerDirty.current = false;
        }
      } catch (error) {
        if (!cancelled) setLoadError(friendlyError(error, tRef.current));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfp.state, cfpId, loadAttempt, user]);

  // ----------------------------------------------------------------- autosave

  const { showToast } = useToast();

  const setConfirmationAnswer = useCallback((key: string, value: AnswerValue) => {
    armHistoryGuard();
    answerDirty.current = true;
    answerRevision.current += 1;
    setAnswerSaveState('idle');
    setAnswers((previous) => ({ ...previous, [key]: value }));
  }, [armHistoryGuard]);

  const setAnswerUploadBusy = useCallback((key: string, busy: boolean) => {
    if (busy) uploadingFields.current.add(key);
    else uploadingFields.current.delete(key);
    setUploadingAnswer(uploadingFields.current.size > 0);
  }, []);

  /**
   * Once a speaker has confirmed, changing a logistical answer is idempotent:
   * the same callable writes the new answers while leaving the status confirmed.
   * An unanswered acceptance is never autosaved, because that would accept a
   * slot before the speaker presses the explicit confirmation button.
   */
  const saveConfirmationAnswers = useCallback(
    async (source: SaveSource = 'background'): Promise<boolean> => {
      if (activeAnswerSave.current) {
        const saved = await activeAnswerSave.current;
        if (!saved) return false;
      }
      if (!answerDirty.current) return true;
      if (
        archived ||
        statusRef.current !== 'confirmed' ||
        uploadingFields.current.size > 0 ||
        proposalIdRef.current === null
      ) {
        return false;
      }

      const savedRevision = answerRevision.current;
      const snapshot = answersRef.current;
      const id = proposalIdRef.current;
      setAnswerSaveState('saving');

      const request = (async () => {
        try {
          await respondToDecision({
            cfpId,
            proposalId: id,
            response: 'confirm',
            answers: snapshot,
          });
          if (answerRevision.current === savedRevision) {
            answerDirty.current = false;
            savedAnswersRef.current = snapshot;
            setAnswerSaveState('saved');
            if (source !== 'transition' && !dirty.current) collapseHistoryGuard();
          } else {
            setAnswerSaveState('idle');
          }
          setBanner(null);
          return true;
        } catch (error) {
          setAnswerSaveState('failed');
          setBanner(friendlyError(error, tRef.current));
          return false;
        } finally {
          activeAnswerSave.current = null;
        }
      })();
      activeAnswerSave.current = request;
      const saved = await request;
      if (!saved) return false;
      return source !== 'background' && answerDirty.current
        ? saveConfirmationAnswers(source)
        : true;
    },
    [archived, cfpId, collapseHistoryGuard],
  );

  useEffect(() => {
    if (archived || status !== 'confirmed' || uploadingAnswer || !answerDirty.current) return;
    const handle = window.setTimeout(() => void saveConfirmationAnswers('background'), 1500);
    return () => clearTimeout(handle);
  }, [answers, archived, saveConfirmationAnswers, status, uploadingAnswer]);

  const persist = useCallback(async (source: SaveSource = 'background'): Promise<boolean> => {
    if (scopeRef.current === 'none' && proposalIdRef.current === null) return false;

    // A visibility flush and the debounce can meet. Let the first write finish,
    // then decide whether a newer revision still needs its own write.
    if (activeSave.current) {
      try {
        await activeSave.current;
      } catch {
        return false;
      }
    }

    if (!dirty.current) {
      return true;
    }

    const savedRevision = revision.current;
    const snapshot = formRef.current;
    const currentId = proposalIdRef.current;
    const currentScope = scopeRef.current;
    setSaveState('saving');
    setSaveError('');

    const request = saveDraft(cfpId, user, snapshot, currentId, currentScope, localeRef.current);
    activeSave.current = request;
    let shouldFlushAgain = false;

    try {
      const id = await request;
      const { proposalDoc, speakerDoc } = toDocuments(snapshot);
      const cachedSpeaker = {
        ...speakerRef.current,
        ...speakerDoc,
        email: user.email ?? '',
      };
      speakerRef.current = cachedSpeaker;
      setSpeaker(cachedSpeaker);

      if (!currentId) {
        proposalIdRef.current = id;
        setProposalId(id);
      }
      // Switching is entirely local after the save. Cache every field that was
      // written, not only the picker title, or returning to this talk restores
      // the page-load copy and the next save overwrites the fresh one.
      const previousTalks = talksRef.current;
      const cachedTalks: LoadedProposal[] = previousTalks.some((talk) => talk.id === id)
        ? previousTalks.map((talk) =>
            talk.id === id
              ? {
                  ...talk,
                  proposal: { ...talk.proposal, ...proposalDoc },
                  speaker: cachedSpeaker,
                }
              : talk,
          )
        : [
            ...previousTalks,
            {
              id,
              status: 'draft',
              proposal: proposalDoc,
              speaker: cachedSpeaker,
            },
          ];
      talksRef.current = cachedTalks;
      setTalks(cachedTalks);

      if (revision.current === savedRevision) {
        dirty.current = false;
        setSaveState('saved');
        if (source === 'manual') {
          showToast(
            currentScope === 'none'
              ? tRef.current.profile.saved
              : tRef.current.form.saved,
            'success',
          );
        }
        if (source !== 'transition' && !answerDirty.current) collapseHistoryGuard();
      } else {
        shouldFlushAgain = source !== 'background';
        setSaveState('idle');
      }
    } catch (error) {
      setSaveState('failed');
      setSaveError(friendlyError(error, tRef.current));
      return false;
    } finally {
      if (activeSave.current === request) activeSave.current = null;
    }

    return shouldFlushAgain ? persist(source) : true;
  }, [cfpId, collapseHistoryGuard, showToast, user]);

  useEffect(() => {
    if (loading || (scope === 'none' && proposalId === null) || !dirty.current) return;
    const handle = window.setTimeout(() => void persist('background'), 1500);
    return () => clearTimeout(handle);
  }, [form, loading, persist, proposalId, scope]);

  useLayoutEffect(() => {
    const hasPendingChanges = () => dirty.current || answerDirty.current;
    const saveForTransition = async () => {
      if (dirty.current && !(await persist('transition'))) return false;
      if (answerDirty.current && !(await saveConfirmationAnswers('transition'))) {
        showToast(t.form.unsaved, 'warning');
        return false;
      }
      return true;
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden' && dirty.current) void persist('background');
      if (document.visibilityState === 'hidden' && answerDirty.current) {
        void saveConfirmationAnswers('background');
      }
    };
    const formPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const saveBeforeHistoryMove = () => {
      if (!historyGuard.current || !hasPendingChanges()) return;

      const arrivedAt =
        `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (arrivedAt !== formPath) {
        /*
         * `goTo` pushes its destination before emitting popstate. That is not
         * the Back button consuming our same-URL guard entry, even though both
         * arrive through this handler. Keep the current history slot, restore
         * the form in it while its write finishes, then replace it with the
         * intended destination and let the router observe that settled path.
         */
        const destinationState = history.state;
        history.replaceState(destinationState, '', formPath);
        if (historyTransition.current) return;

        historyTransition.current = true;
        void saveForTransition()
          .then((saved) => {
            if (!saved) return;
            historyGuard.current = false;
            history.replaceState(destinationState, '', arrivedAt);
            window.dispatchEvent(new PopStateEvent('popstate'));
          })
          .finally(() => {
            historyTransition.current = false;
          });
        return;
      }

      // We are now on the same-URL base entry. Re-arm while the write is in
      // flight so repeated Back presses cannot outrun the one save.
      const state =
        history.state && typeof history.state === 'object'
          ? history.state
          : {};
      history.pushState(
        { ...state, __cfpFormGuard: `${cfpId}:${user.uid}` },
        '',
        formPath,
      );

      // A second Back while the first save is pending is restored above, but it
      // must not launch another write or replace the original destination.
      if (historyTransition.current) return;
      historyTransition.current = true;
      void saveForTransition()
        .then((saved) => {
          if (saved) {
            historyGuard.current = false;
            // Skip both the re-armed guard and this form's base entry. That is
            // the Back the person originally asked for.
            history.go(-2);
          }
        })
        .finally(() => {
          historyTransition.current = false;
        });
    };
    const leaveAfterCollapsingGuard = (leave: () => void) => {
      if (!historyGuard.current) {
        leave();
        return;
      }
      historyGuard.current = false;
      window.addEventListener('popstate', leave, { once: true });
      history.back();
    };
    const saveThenLeave = (leave: () => void) => {
      if (historyTransition.current) return;
      historyTransition.current = true;
      void saveForTransition()
        .then((saved) => {
          if (!saved) {
            historyTransition.current = false;
            return;
          }
          leaveAfterCollapsingGuard(() => {
            historyTransition.current = false;
            leave();
          });
        })
        .catch(() => {
          historyTransition.current = false;
        });
    };
    const saveBeforeInternalLink = (event: MouseEvent) => {
      if (
        !hasPendingChanges() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const signOut =
        target instanceof Element
          ? target.closest<HTMLButtonElement>('.account-menu__action--button')
          : null;
      if (signOut) {
        event.preventDefault();
        event.stopPropagation();
        saveThenLeave(() => signOut.click());
        return;
      }

      const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      saveThenLeave(() =>
        goTo(`${destination.pathname}${destination.search}${destination.hash}`),
      );
    };

    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('popstate', saveBeforeHistoryMove);
    document.addEventListener('visibilitychange', saveWhenHidden);
    document.addEventListener('click', saveBeforeInternalLink, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('popstate', saveBeforeHistoryMove);
      document.removeEventListener('visibilitychange', saveWhenHidden);
      document.removeEventListener('click', saveBeforeInternalLink, true);
      if (dirty.current) void persist('background');
      if (answerDirty.current) void saveConfirmationAnswers('background');
    };
  }, [cfpId, persist, saveConfirmationAnswers, showToast, t.form.unsaved, user.uid]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    armHistoryGuard();
    dirty.current = true;
    revision.current += 1;
    setSaveState((current) => (current === 'failed' ? current : 'idle'));
    setForm((prev) => ({ ...prev, [key]: value }));
  }, [armHistoryGuard]);

  const liveErrors = useMemo(() => validate(form, shape, t), [form, shape, t]);
  const liveExtraFaults = useMemo(
    () => validateAnswers({ fields: shape.fields }, form.answers).faults,
    [form.answers, shape.fields],
  );

  // Re-validate live once the applicant has seen errors, so fixes clear as they
  // type — and so switching language re-renders the messages in it.
  useEffect(() => {
    if (!showErrors) return;
    setErrors(liveErrors);
    setExtraFaults(liveExtraFaults);
  }, [liveErrors, liveExtraFaults, showErrors]);

  function markTalk(id: string, next: ProposalStatus, title?: string) {
    const previousTalks = talksRef.current;
    const known = previousTalks.some((talk) => talk.id === id);
    const patch = (talk: LoadedProposal) => ({
      ...talk,
      status: next,
      proposal: title === undefined ? talk.proposal : { ...talk.proposal, title },
    });
    const updated = known
      ? previousTalks.map((talk) => (talk.id === id ? patch(talk) : talk))
      : [...previousTalks, patch({ id, status: next, proposal: { title }, speaker: undefined })];
    talksRef.current = updated;
    setTalks(updated);
  }

  // -------------------------------------------------------------- switching

  function showTalk(talk?: LoadedProposal) {
    revision.current += 1;
    if (talk) {
      setForm(fromDocuments(talk.proposal, speakerRef.current));
      setProposalId(talk.id);
      proposalIdRef.current = talk.id;
      setStatus(talk.status);
      const loadedAnswers = (talk.proposal.confirmAnswers ?? {}) as Answers;
      setAnswers(loadedAnswers);
      savedAnswersRef.current = loadedAnswers;
    } else {
      setForm((previous) => clearTalk(previous));
      setProposalId(null);
      proposalIdRef.current = null;
      setStatus('draft');
      setAnswers({});
      savedAnswersRef.current = {};
    }
    answerDirty.current = false;
    setAnswerSaveState('idle');
    setAnswerFaults({});
    setAsking(false);
    setShowErrors(false);
    setBanner(null);
    setSaveState('idle');
    dirty.current = false;
  }

  /**
   * Flushes first. The autosave is on a 1.5s debounce, so switching mid-edit
   * would otherwise write the talk you just left into the one you opened.
   */
  async function openTalk(id: string) {
    if (id === proposalId) return;
    if (dirty.current && !(await persist('transition'))) return;

    const talk = talksRef.current.find((candidate) => candidate.id === id);
    if (!talk) return;
    showTalk(talk);
  }

  async function startNewTalk() {
    if (dirty.current && !(await persist('transition'))) return;

    // From the form rather than the loaded profile: right after a first save
    // the loaded copy is a page-load old and would blank the bio just typed.
    showTalk();
  }

  // ------------------------------------------------------------------- submit

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = liveErrors;
    const faults = liveExtraFaults;
    setErrors(found);
    setExtraFaults(faults);
    setShowErrors(true);
    if (Object.keys(found).length > 0 || Object.keys(faults).length > 0) {
      if (Object.keys(found).some((key) => key.startsWith('speaker.'))) {
        setSpeakerEditing(true);
      }
      requestAnimationFrame(focusFirstInvalidField);
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      // Join any debounce already in flight before submitting. Without this, a
      // first autosave and the submit click can both create a draft while the
      // proposal id is still null.
      if (dirty.current && !(await persist('transition'))) return;

      // The flush may have waited for an autosave that was already in flight.
      // Validate the revision that actually won that race, not the render that
      // supplied the original click handler.
      const latest = formRef.current;
      const latestErrors = validate(latest, shape, t);
      const latestFaults = validateAnswers({ fields: shape.fields }, latest.answers).faults;
      if (Object.keys(latestErrors).length > 0 || Object.keys(latestFaults).length > 0) {
        setErrors(latestErrors);
        setExtraFaults(latestFaults);
        if (Object.keys(latestErrors).some((key) => key.startsWith('speaker.'))) {
          setSpeakerEditing(true);
        }
        requestAnimationFrame(focusFirstInvalidField);
        return;
      }

      let id = proposalIdRef.current;
      if (!id) {
        id = await saveDraft(cfpId, user, latest, null, 'all', locale);
        setProposalId(id);
        proposalIdRef.current = id;
        dirty.current = false;
        setSaveState('saved');
      }
      await submitProposal({ cfpId, proposalId: id });
      // Codes only — never the title, the abstract or anything about the
      // person. This answers "which tracks are people proposing to", which is
      // the one thing page views cannot tell an organiser.
      track('proposal_submitted', {
        cfp_id: cfpId,
        category: latest.category,
        format: latest.format,
        delivery_language: latest.deliveryLanguage,
      });
      setStatus('submitted');
      markTalk(id, 'submitted', latest.title);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    if (archived || !proposalId || !window.confirm(t.form.withdrawConfirm)) return;
    setSubmitting(true);
    try {
      await withdrawProposal({ cfpId, proposalId });
      setStatus('withdrawn');
      markTalk(proposalId, 'withdrawn');
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeleteDraft() {
    const target = proposalIdRef.current;
    if (
      archived ||
      submitting ||
      statusRef.current !== 'draft' ||
      !target ||
      !window.confirm(t.form.deleteDraftConfirm)
    ) {
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      // The same form owns the account-wide profile. Flush it before removing
      // the talk so a quick profile edit is kept as promised by the dialog.
      // This also joins any autosave already in flight.
      if (!(await persist('transition'))) return;

      // Stop any queued debounce after the flush. Nothing may recreate the row
      // once the callable removes it.
      dirty.current = false;
      revision.current += 1;
      await activeSave.current?.catch(() => undefined);
      await deleteDraftProposal({ cfpId, proposalId: target });

      const remaining = talksRef.current.filter((talk) => talk.id !== target);
      talksRef.current = remaining;
      setTalks(remaining);
      const currentTalks = remaining.filter((talk) => !isPastTalk(talk));
      const next =
        cfp.state === 'open'
          ? (currentTalks.find((talk) => talk.status === 'draft') ?? currentTalks[0])
          : (currentTalks[0] ?? remaining[0]);
      showTalk(next);
      showToast(t.form.draftDeleted, 'success');
    } catch (error) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRespond(response: 'confirm' | 'decline') {
    if (archived || !proposalId || uploadingFields.current.size > 0) return;
    // Only the decline is confirmed: saying yes is reversible by declining
    // afterwards, but a decline given by accident gives the slot away.
    if (response === 'decline' && !window.confirm(t.form.confirmDeclineConfirm)) return;
    setSubmitting(true);
    setAnswerFaults({});
    try {
      // Preserve any corrected details before changing a confirmed response to
      // declined. Otherwise a quick edit followed by decline races the debounce
      // and the old answers win if the speaker later confirms again.
      if (
        response === 'decline' &&
        statusRef.current === 'confirmed' &&
        answerDirty.current &&
        !(await saveConfirmationAnswers('transition'))
      ) {
        return;
      }
      if (activeAnswerSave.current && !(await activeAnswerSave.current)) return;

      const responseAnswers = answersRef.current;
      const { data } = await respondToDecision({
        cfpId,
        proposalId,
        response,
        ...(response === 'confirm' ? { answers: responseAnswers } : {}),
      });
      setStatus(data.status);
      statusRef.current = data.status;
      markTalk(proposalId, data.status);
      if (response === 'confirm') savedAnswersRef.current = responseAnswers;
      answerDirty.current = false;
      setAnswerSaveState(response === 'confirm' ? 'saved' : 'idle');
      setAsking(false);
      setBanner(null);
    } catch (error: any) {
      /*
       * The callable answers a bad form with the faults keyed by field, so the
       * questions can mark themselves rather than showing one banner that does
       * not say which of eight answers is the problem.
       */
      const faults = error?.details as AnswerFaults | undefined;
      if (error?.code === 'functions/invalid-argument' && faults && typeof faults === 'object') {
        setAnswerFaults(faults);
        setBanner(t.form.answersIncomplete);
      } else {
        setBanner(friendlyError(error, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function cancelConfirmationAnswers() {
    setAnswers(savedAnswersRef.current);
    answersRef.current = savedAnswersRef.current;
    answerDirty.current = false;
    setAnswerFaults({});
    setAnswerSaveState('idle');
    setAsking(false);
  }

  // -------------------------------------------------------------- option sets

  // The four taxonomy lists come from this call's own config; attendance does
  // not, because it feeds `§5`'s funding logic rather than being a label set.
  const options = useMemo(
    () => ({
      category: asOptions(shape.category, locale),
      format: asOptions(shape.format, locale),
      level: asOptions(shape.level, locale),
      delivery: asOptions(shape.deliveryLanguage, locale),
      attendance: ATTENDANCE_STATUSES.map((v) => ({
        value: v,
        label: t.attendance[v],
      })),
    }),
    [shape, locale, t],
  );

  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length + Object.keys(extraFaults).length;

  if (loading) return <p className="muted">{t.app.loading}</p>;
  if (loadError) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {loadError}
        </p>
        <button type="button" className="btn" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          {t.errors.reload}
        </button>
      </div>
    );
  }
  if (cfp.state !== 'open' && talks.length === 0) {
    return (
      <div className="panel">
        <p>{cfp.state === 'paused' ? t.window.paused : t.window.closed}</p>
        {cfp.state === 'closed' && (
          <p>
            {t.window.closedAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
          </p>
        )}
      </div>
    );
  }

  const submittedCount = talks.filter((talk) =>
    inStatusSet('live', talk.status),
  ).length;

  const picker = (
    <TalkPicker
      talks={talks}
      currentId={proposalId}
      currentTitle={form.title}
      busy={
        submitting ||
        saveState === 'saving' ||
        answerSaveState === 'saving' ||
        uploadingAnswer
      }
      // A draft in progress is already the "new" one, so offer another only
      // once this one exists and there is room under the cap.
      canAdd={
        cfp.state === 'open' &&
        proposalId !== null &&
        submittedCount < LIMITS.maxTalksPerSpeaker
      }
      atCap={submittedCount >= LIMITS.maxTalksPerSpeaker}
      onOpen={openTalk}
      onAdd={startNewTalk}
    />
  );

  const withdrawable = status !== 'draft' && inStatusSet('withdrawable', status);
  const profileOnly = scope === 'none';
  const liveErrorKeys = Object.keys(liveErrors);
  const hasAny = (keys: string[]) => keys.some((key) => liveErrorKeys.includes(key));
  const hasPrefix = (prefix: string) => liveErrorKeys.some((key) => key.startsWith(prefix));
  const progressItems: FormProgressItem[] = [
    {
      id: 'submission-talk',
      label: t.sections.proposal,
      complete: !liveErrorKeys.some(
        (key) =>
          key.startsWith('proposal.') &&
          key !== 'proposal.deliveryLanguage' &&
          key !== 'proposal.languagePreference',
      ),
      attention:
        showErrors &&
        liveErrorKeys.some(
          (key) =>
            key.startsWith('proposal.') &&
            key !== 'proposal.deliveryLanguage' &&
            key !== 'proposal.languagePreference',
        ),
    },
    {
      id: 'submission-language',
      label: t.sections.language,
      complete: !hasAny(['proposal.deliveryLanguage', 'proposal.languagePreference']),
      attention:
        showErrors && hasAny(['proposal.deliveryLanguage', 'proposal.languagePreference']),
    },
    {
      id: 'submission-speaker',
      label: t.sections.speaker,
      complete: !hasPrefix('speaker.'),
      attention: showErrors && hasPrefix('speaker.'),
    },
    ...(shape.fields.length > 0
      ? [
          {
            id: 'submission-extra',
            label: t.sections.extra,
            complete: Object.keys(liveExtraFaults).length === 0,
            attention: showErrors && Object.keys(liveExtraFaults).length > 0,
          },
        ]
      : []),
    ...(shape.acks.length > 0
      ? [
          {
            id: 'submission-acknowledgements',
            label: t.sections.acks,
            complete: !hasPrefix('acks.'),
            attention: showErrors && hasPrefix('acks.'),
          },
        ]
      : []),
    {
      id: 'submission-attendance',
      label: t.sections.attendance,
      complete: !hasPrefix('attendance.'),
      attention: showErrors && hasPrefix('attendance.'),
    },
  ];

  return (
    <form className="form submission-form" onSubmit={onSubmit} noValidate>
      {picker}

      <section className="submission-context" aria-label={t.form.submissionContext}>
        <div className="submission-context__identity">
          <span className="submission-context__event">{cfp.name}</span>
          <span
            className={`submission-context__status submission-context__status--${status === 'draft' && cfp.state === 'open' ? 'open' : 'set'}`}
          >
            {status === 'draft' && cfp.state === 'open'
              ? t.form.acceptingNow
              : t.enums.status[status]}
          </span>
        </div>
        <div className="submission-context__deadline">
          <span>{t.form.deadline}</span>
          <strong>
            <time dateTime={cfp.closesAt.toISOString()}>{formatDate(cfp.closesAt, locale)}</time>
          </strong>
          <span className="submission-context__timezone">{t.form.deadlineTimeZone}</span>
        </div>
      </section>

      {/*
        The talk stays on screen after submitting. A speaker who cannot re-read
        what they sent has no way to check it went in, and the withdraw button
        on its own made the page look like a dead end.
      */}
      {status !== 'draft' && (
        <StatusBanner
          status={status}
          scope={scope}
          busy={archived || submitting || answerSaveState === 'saving' || uploadingAnswer}
          onWithdraw={!archived && withdrawable ? onWithdraw : undefined}
          onRespond={
            !archived && (status === 'accepted' || inStatusSet('speakerResponse', status))
              ? onRespond
              : undefined
          }
          questions={{
            cfpId,
            uid: user.uid,
            fields: confirmForm.fields,
            answers,
            faults: answerFaults,
            busy: archived || submitting || answerSaveState === 'saving' || uploadingAnswer,
            onAnswer: setConfirmationAnswer,
            onUploadBusyChange: setAnswerUploadBusy,
          }}
          asking={asking}
          onAsk={() => setAsking(true)}
          onCancelAsk={cancelConfirmationAnswers}
          onSaveAnswers={
            !archived && status === 'confirmed'
              ? () => void saveConfirmationAnswers('manual')
              : undefined
          }
        />
      )}

      <div className="submission-workspace">
        <FormProgress items={progressItems} />
        <div className="submission-workspace__content">
      {/*
        First, because it fills fields in every section below it — the talk as
        well as the speaker. Buried under "About you" it arrives after the work
        it would have saved.
      */}
      <SessionizeImport
        form={form}
        disabled={talkDisabled}
        onApply={(patch) => {
          armHistoryGuard();
          dirty.current = true;
          revision.current += 1;
          setSaveState((current) => (current === 'failed' ? current : 'idle'));
          setForm((prev) => ({ ...prev, ...patch }));
        }}
      />

      {/* ------------------------------------------------------- the talk */}
      <section className="section submission-section" id="submission-talk" tabIndex={-1}>
        <h2>{t.sections.proposal}</h2>
        <p className="section__help">{t.sections.proposalHelp}</p>

        <TextField
          label={t.proposal.title}
          help={t.proposal.titleHelp}
          value={form.title}
          onChange={(v) => set('title', v)}
          maxLength={LIMITS.title}
          error={err('proposal.title')}
          disabled={talkDisabled}
          required
        />

        <TextAreaField
          label={t.proposal.abstract}
          help={t.proposal.abstractHelp}
          value={form.abstract}
          onChange={(v) => set('abstract', v)}
          minLength={LIMITS.abstractMin}
          maxLength={LIMITS.abstractMax}
          error={err('proposal.abstract')}
          disabled={talkDisabled}
          required
        />

        <TextAreaField
          label={t.proposal.pitch}
          help={t.proposal.pitchHelp}
          value={form.pitch}
          onChange={(v) => set('pitch', v)}
          maxLength={LIMITS.pitchMax}
          rows={4}
          error={err('proposal.pitch')}
          disabled={talkDisabled}
        />

        <div className="grid grid--3">
          <SelectField
            label={t.proposal.category}
            value={form.category}
            options={options.category}
            onChange={(v) => set('category', v)}
            error={err('proposal.category')}
            disabled={talkDisabled}
            required
          />
          <SelectField
            label={t.proposal.format}
            value={form.format}
            options={options.format}
            onChange={(v) => set('format', v)}
            error={err('proposal.format')}
            disabled={talkDisabled}
            required
          />
          <SelectField
            label={t.proposal.level}
            value={form.level}
            options={options.level}
            onChange={(v) => set('level', v)}
            error={err('proposal.level')}
            disabled={talkDisabled}
            required
          />
        </div>
      </section>

      {/* ------------------------------------------------------- language */}
      <section className="section submission-section" id="submission-language" tabIndex={-1}>
        <h2>{t.sections.language}</h2>

        <SelectField
          label={t.language.delivery}
          value={form.deliveryLanguage}
          options={options.delivery}
          onChange={(v) => set('deliveryLanguage', v)}
          error={err('proposal.deliveryLanguage')}
          disabled={talkDisabled}
          required
        />

        {/*
          §4 warned that a mid-talk switch costs half the session for anyone
          comfortable in only one language. The option exists by decision, so
          the mitigation moves to the programme: tell the applicant up front
          how the session will be labelled.
        */}
        <Reveal when={form.deliveryLanguage === 'bilingual'} variant="note">
          {t.language.bilingualNote}
        </Reveal>

        {/* Conditional 3 of 3 */}
        <Reveal
          when={form.deliveryLanguage === 'either'}
          onHide={() => set('languagePreference', '')}
        >
          <TextField
            label={t.language.preference}
            help={t.language.preferenceHelp}
            value={form.languagePreference}
            onChange={(v) => set('languagePreference', v)}
            maxLength={LIMITS.languagePreferenceMax}
            error={err('proposal.languagePreference')}
            disabled={talkDisabled}
          />
        </Reveal>
      </section>

      {/*
        The speaker profile lives on the account (`speakers/{uid}`), not on any
        one talk, and is the same document whichever talk is open. Saying so
        matters: otherwise editing it here reads as editing it "for this talk".
      */}
      <section
        className="section section--account submission-section submission-section--speaker"
        id="submission-speaker"
        tabIndex={-1}
      >
        <h2>{t.sections.speaker}</h2>
        <p className="section__help">{t.sections.speakerHelp}</p>

        {speakerEditing || !speakerProfileComplete(form) ? (
          <div className="speaker-editor">
            <SpeakerFields form={form} set={set} err={err} disabled={submitting} />
          </div>
        ) : (
          <SpeakerProfileSummary
            form={form}
            onEdit={() => {
              setSpeakerEditing(true);
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(
                    '#submission-speaker input:not([disabled]), #submission-speaker textarea:not([disabled])',
                  )
                  ?.focus();
              });
            }}
          />
        )}
      </section>

      {/* --------------------------------------------- this call's own questions */}
      {shape.fields.length > 0 && (
        <section className="section submission-section" id="submission-extra" tabIndex={-1}>
          <h2>{t.sections.extra}</h2>
          <Questions
            cfpId={cfpId}
            uid={user.uid}
            fields={shape.fields}
            answers={form.answers}
            faults={extraFaults}
            busy={talkDisabled}
            onAnswer={(key, value) => set('answers', { ...form.answers, [key]: value })}
          />
        </section>
      )}

      {/* ---------------------------------------------------------- acks */}
      {shape.acks.length > 0 && (
        <section
          className="section submission-section"
          id="submission-acknowledgements"
          tabIndex={-1}
        >
          <h2>{t.sections.acks}</h2>
          {shape.acks.map((ack) => (
            <Checkbox
              key={ack.key}
              label={<AckLabel ack={ack} />}
              checked={form.acks[ack.key] === true}
              onChange={(v) => set('acks', { ...form.acks, [ack.key]: v })}
              error={err(`acks.${ack.key}`)}
              disabled={talkDisabled}
            />
          ))}
        </section>
      )}

      {/*
        §3: attendance follows immediately after the acknowledgements. The
        question only reads naturally once "travel is not covered" is on screen.
      */}
      <section className="section submission-section" id="submission-attendance" tabIndex={-1}>
        <h2>{t.sections.attendance}</h2>

        <RadioGroup
          label={t.attendance.question}
          help={t.attendance.help}
          value={form.attendanceStatus}
          options={options.attendance}
          onChange={(v) => set('attendanceStatus', v)}
          error={err('attendance.status')}
          disabled={travelDisabled}
          required
        />

        {/* Conditional 2 of 3 */}
        <Reveal
          when={form.attendanceStatus === 'secured' || form.attendanceStatus === 'pending'}
          onHide={() => {
            set('fundingSource', '');
            set('decisionBy', '');
          }}
        >
          <TextField
            label={t.attendance.fundingSource}
            help={t.attendance.fundingSourceHelp}
            value={form.fundingSource}
            onChange={(v) => set('fundingSource', v)}
            maxLength={LIMITS.fundingSourceMax}
            error={err('attendance.fundingSource')}
            disabled={travelDisabled}
            required
          />

          <Reveal
            when={form.attendanceStatus === 'pending'}
            onHide={() => set('decisionBy', '')}
          >
            <TextField
              label={t.attendance.decisionBy}
              help={t.attendance.decisionByHelp}
              value={form.decisionBy}
              onChange={(v) => set('decisionBy', v)}
              type="date"
              error={err('attendance.decisionBy')}
              disabled={travelDisabled}
              required
            />
          </Reveal>
        </Reveal>

        <Checkbox
          label={t.attendance.needsVisa}
          checked={form.needsVisa}
          onChange={(v) => set('needsVisa', v)}
          disabled={travelDisabled}
        />

        {/* At a Montréal event, visas stop more speakers than money does (§5). */}
        <Reveal when={form.needsVisa} variant="note">
          {t.attendance.visaGuidance}
        </Reveal>
      </section>

      {/* -------------------------------------------------------- actions */}
      <div className="actions">
        <div className="actions__status" aria-live="polite">
          {saveState === 'saving' && (profileOnly ? t.profile.saving : t.form.saving)}
          {saveState === 'saved' && (profileOnly ? t.profile.saved : t.form.saved)}
          {saveState === 'idle' &&
            dirty.current &&
            (profileOnly ? t.profile.unsaved : t.form.unsaved)}
          {saveState === 'failed' && (
            <div className="actions__save-failure" role="alert">
              <span className="field__error">
                {saveError || (profileOnly ? t.profile.saveFailed : t.form.saveFailed)}
              </span>
              <button
                type="button"
                className="btn btn--ghost actions__retry"
                onClick={() => void persist('manual')}
              >
                {profileOnly ? t.profile.retrySave : t.form.retrySave}
              </button>
            </div>
          )}
        </div>

        {showErrors && errorCount > 0 && (
          <p className="field__error" role="alert">
            {t.form.fixErrors} {t.form.errorCount(errorCount)}
          </p>
        )}
        {banner && (
          <p className="field__error" role="alert">
            {banner}
          </p>
        )}

        <div className="actions__buttons">
          {(!profileOnly || dirty.current) && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!dirty.current || saveState === 'saving' || submitting}
              onClick={() => void persist('manual')}
            >
              {profileOnly
                ? t.profile.save
                : status === 'draft'
                  ? t.form.save
                  : t.form.saveChanges}
            </button>
          )}
          {!archived && status === 'draft' && proposalId !== null && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={submitting || saveState === 'saving'}
              onClick={() => void onDeleteDraft()}
            >
              {t.form.deleteDraft}
            </button>
          )}
          {status === 'draft' && (
            <button type="submit" className="btn btn--primary" disabled={talkDisabled}>
              {submitting ? t.form.submitting : t.form.submit}
            </button>
          )}
        </div>
      </div>
        </div>
      </div>
    </form>
  );
}
