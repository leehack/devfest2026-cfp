import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  ATTENDANCE_STATUSES,
  CATEGORIES,
  DELIVERY_LANGUAGES,
  FORMATS,
  LEVELS,
  LIMITS,
  inStatusSet,
} from '@shared/enums';
import { submissionSchema } from '@shared/schema';

import { Checkbox, RadioGroup, SelectField, TextAreaField, TextField } from '../components/fields';
import { Reveal } from '../components/Reveal';
import { SessionizeImport } from '../components/SessionizeImport';
import { SocialsInput } from '../components/SocialsInput';
import { formatDate, useI18n, type Dictionary } from '../i18n';
import { validationMessage } from '../i18n/validation';
import { friendlyError } from '../lib/errors';
import { editScope, type EditScope } from '../lib/lifecycle';
import {
  clearTalk,
  emptyForm,
  fromDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import {
  loadConfirmForm,
  loadMyProposals,
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
  type AnswerFaults,
  type AnswerValue,
  type Answers,
  type ConfirmField,
  type ConfirmForm,
} from '@shared/confirmForm';

type Errors = Record<string, string>;

interface TalkPickerProps {
  talks: LoadedProposal[];
  currentId: string | null;
  /** Live from the form, so the tab renames itself as the title is typed. */
  currentTitle: string;
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
  canAdd,
  atCap,
  onOpen,
  onAdd,
}: TalkPickerProps) {
  const { t } = useI18n();
  if (talks.length === 0 || (talks.length === 1 && !canAdd)) return null;

  const isNew = currentId === null;

  return (
    <nav className="talks" aria-label={t.form.yourTalks}>
      <span className="talks__label">{t.form.yourTalks}</span>
      {talks.map((talk) => {
        const current = talk.id === currentId;
        const title = (current ? currentTitle : talk.proposal.title) || t.form.untitled;
        return (
          <button
            key={talk.id}
            type="button"
            className={`talks__tab${current ? ' talks__tab--on' : ''}`}
            aria-current={current ? 'true' : undefined}
            onClick={() => onOpen(talk.id)}
          >
            {title}
            {talk.status !== 'draft' && (
              <span className="talks__status">{t.enums.status[talk.status]}</span>
            )}
          </button>
        );
      })}
      {isNew && <span className="talks__tab talks__tab--on">{currentTitle || t.form.newTalk}</span>}
      {canAdd && !isNew && (
        <button type="button" className="talks__add" onClick={onAdd}>
          {t.form.addTalk}
        </button>
      )}
      {atCap && <span className="talks__status">{t.form.talkCap(LIMITS.maxTalksPerSpeaker)}</span>}
    </nav>
  );
}

interface QuestionsProps {
  uid: string;
  fields: ConfirmField[];
  answers: Answers;
  faults: AnswerFaults;
  busy: boolean;
  onAnswer: (key: string, value: AnswerValue) => void;
}

/**
 * The organiser's own questions, rendered from `config/confirmForm`.
 *
 * Nothing here is hard-coded — a t-shirt size and a dietary note are one
 * event's questions, not the platform's, and an organiser who cannot add
 * "do you need a power outlet" without a deploy ends up chasing forty people
 * by email instead.
 */
function Questions({ uid, fields, answers, faults, busy, onAnswer }: QuestionsProps) {
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
              onUploaded={() => onAnswer(field.key, headshotPath(uid, field.key))}
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
          key: field.key,
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
          return <TextAreaField {...common} maxLength={FORM_LIMITS.answerTextarea} rows={3} />;
        }
        return <TextField {...common} maxLength={FORM_LIMITS.answerText} />;
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
  /** Present only while an acceptance is unanswered. */
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

  return (
    <div className={`panel${good ? ' panel--good' : ''}`}>
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
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => (hasQuestions ? onAsk() : onRespond('confirm'))}
          >
            {t.form.confirmAccept}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => onRespond('decline')}
          >
            {t.form.confirmDecline}
          </button>
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

      {/* Answered already, but a size guessed in a hurry should not be final. */}
      {onSaveAnswers && hasQuestions && (
        <>
          <h3 className="card__subtitle">{t.form.answersTitle}</h3>
          <Questions {...questions} />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onSaveAnswers}
          >
            {t.form.answersSave}
          </button>
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
function validate(form: FormState, t: Dictionary): Errors {
  const result = submissionSchema.safeParse(toSubmission(form));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = validationMessage(issue, t);
  }
  return errors;
}

interface SubmitPageProps {
  user: User;
  cfp: CfpWindow;
}

export function SubmitPage({ user, cfp }: SubmitPageProps) {
  const { t, locale } = useI18n();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [talks, setTalks] = useState<LoadedProposal[]>([]);
  const [speaker, setSpeaker] = useState<Record<string, any> | undefined>();
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProposalStatus>('draft');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState<ConfirmForm>(EMPTY_FORM);
  const [answers, setAnswers] = useState<Answers>({});
  const [answerFaults, setAnswerFaults] = useState<AnswerFaults>({});
  const [asking, setAsking] = useState(false);

  const dirty = useRef(false);
  const scope = editScope(status, cfp.state === 'open');
  /** The talk itself: what the committee scores. */
  const readOnly = scope !== 'all';
  /** Travel answers: no bearing on the score, so they outlive the freeze. */
  const travelReadOnly = scope === 'none';

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Both at once: the questions are organiser config, and waiting for the
        // proposals first would put a second round trip in front of a page that
        // already loads two documents.
        const [{ talks: found, speaker: profile }, questions] = await Promise.all([
          loadMyProposals(user),
          loadConfirmForm(),
        ]);
        if (cancelled) return;
        setTalks(found);
        setSpeaker(profile);
        setConfirmForm(questions);

        // Open the one they can still work on rather than whichever came back
        // first — landing on a submitted talk looks like the form is broken.
        const open = found.find((talk) => talk.status === 'draft') ?? found[0];
        if (open) {
          setForm(fromDocuments(open.proposal, profile));
          setProposalId(open.id);
          setStatus(open.status);
          setAnswers((open.proposal.confirmAnswers ?? {}) as Answers);
        } else {
          // Prefill from the Google account rather than making people retype it.
          setForm({
            ...emptyForm,
            name: user.displayName ?? '',
            email: user.email ?? '',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // ----------------------------------------------------------------- autosave

  const persist = useCallback(async () => {
    if (scope === 'none') return;
    setSaveState('saving');
    try {
      const id = await saveDraft(user, form, proposalId, scope, locale);
      if (!proposalId) {
        setProposalId(id);
        setTalks((prev) => [...prev, { id, status: 'draft', proposal: {}, speaker: undefined }]);
      }
      // Keeps the picker's label in step with the title being typed.
      setTalks((prev) =>
        prev.map((talk) =>
          talk.id === id ? { ...talk, proposal: { ...talk.proposal, title: form.title } } : talk,
        ),
      );
      dirty.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [form, locale, proposalId, scope, user]);

  useEffect(() => {
    if (loading || scope === 'none' || !dirty.current) return;
    const handle = setTimeout(persist, 1500);
    return () => clearTimeout(handle);
  }, [form, loading, scope, persist]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    dirty.current = true;
    setSaveState('idle');
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Re-validate live once the applicant has seen errors, so fixes clear as they
  // type — and so switching language re-renders the messages in it.
  useEffect(() => {
    if (showErrors) setErrors(validate(form, t));
  }, [form, showErrors, t]);

  function markTalk(id: string, next: ProposalStatus, title?: string) {
    setTalks((prev) => {
      const known = prev.some((talk) => talk.id === id);
      const patch = (talk: LoadedProposal) => ({
        ...talk,
        status: next,
        proposal: title === undefined ? talk.proposal : { ...talk.proposal, title },
      });
      if (known) return prev.map((talk) => (talk.id === id ? patch(talk) : talk));
      return [...prev, patch({ id, status: next, proposal: { title }, speaker: undefined })];
    });
  }

  // -------------------------------------------------------------- switching

  /**
   * Flushes first. The autosave is on a 1.5s debounce, so switching mid-edit
   * would otherwise write the talk you just left into the one you opened.
   */
  async function openTalk(id: string) {
    if (id === proposalId) return;
    if (dirty.current && scope !== 'none') await persist();

    const talk = talks.find((candidate) => candidate.id === id);
    if (!talk) return;
    setForm(fromDocuments(talk.proposal, speaker));
    setProposalId(id);
    setStatus(talk.status);
    setAnswers((talk.proposal.confirmAnswers ?? {}) as Answers);
    setAnswerFaults({});
    setAsking(false);
    setShowErrors(false);
    setBanner(null);
    setSaveState('idle');
    dirty.current = false;
  }

  async function startNewTalk() {
    if (dirty.current && scope !== 'none') await persist();

    // From the form rather than the loaded profile: right after a first save
    // the loaded copy is a page-load old and would blank the bio just typed.
    setForm((prev) => clearTalk(prev));
    setProposalId(null);
    setStatus('draft');
    setShowErrors(false);
    setBanner(null);
    setSaveState('idle');
    dirty.current = false;
  }

  // ------------------------------------------------------------------- submit

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(form, t);
    setErrors(found);
    setShowErrors(true);
    if (Object.keys(found).length > 0) {
      document.querySelector('.field--error, .checkbox.field--error')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const id = await saveDraft(user, form, proposalId, 'all', locale);
      setProposalId(id);
      await submitProposal({ proposalId: id });
      setStatus('submitted');
      markTalk(id, 'submitted', form.title);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    if (!proposalId || !window.confirm(t.form.withdrawConfirm)) return;
    setSubmitting(true);
    try {
      await withdrawProposal({ proposalId });
      setStatus('withdrawn');
      markTalk(proposalId, 'withdrawn');
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRespond(response: 'confirm' | 'decline') {
    if (!proposalId) return;
    // Only the decline is confirmed: saying yes is reversible by declining
    // afterwards, but a decline given by accident gives the slot away.
    if (response === 'decline' && !window.confirm(t.form.confirmDeclineConfirm)) return;
    setSubmitting(true);
    setAnswerFaults({});
    try {
      const { data } = await respondToDecision({
        proposalId,
        response,
        ...(response === 'confirm' ? { answers } : {}),
      });
      setStatus(data.status);
      markTalk(proposalId, data.status);
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

  // -------------------------------------------------------------- option sets

  const options = useMemo(
    () => ({
      category: CATEGORIES.map((v) => ({ value: v, label: t.enums.category[v] })),
      format: FORMATS.map((v) => ({ value: v, label: t.enums.format[v] })),
      level: LEVELS.map((v) => ({ value: v, label: t.enums.level[v] })),
      delivery: DELIVERY_LANGUAGES.map((v) => ({ value: v, label: t.enums.deliveryLanguage[v] })),
      attendance: ATTENDANCE_STATUSES.map((v) => ({
        value: v,
        label: t.attendance[v],
      })),
    }),
    [t],
  );

  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length;

  if (loading) return <p className="muted">{t.app.loading}</p>;

  const submittedCount = talks.filter((talk) =>
    inStatusSet('live', talk.status),
  ).length;

  const picker = (
    <TalkPicker
      talks={talks}
      currentId={proposalId}
      currentTitle={form.title}
      // A draft in progress is already the "new" one, so offer another only
      // once this one exists and there is room under the cap.
      canAdd={
        cfp.state === 'open' &&
        proposalId !== null &&
        talks.length < LIMITS.maxTalksPerSpeaker &&
        submittedCount < LIMITS.maxTalksPerSpeaker
      }
      atCap={submittedCount >= LIMITS.maxTalksPerSpeaker}
      onOpen={openTalk}
      onAdd={startNewTalk}
    />
  );

  const withdrawable = status !== 'draft' && inStatusSet('withdrawable', status);

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {picker}

      {/*
        The talk stays on screen after submitting. A speaker who cannot re-read
        what they sent has no way to check it went in, and the withdraw button
        on its own made the page look like a dead end.
      */}
      {status === 'draft' ? (
        <p className="deadline">
          {t.window.closesAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
        </p>
      ) : (
        <StatusBanner
          status={status}
          scope={scope}
          busy={submitting}
          onWithdraw={withdrawable ? onWithdraw : undefined}
          onRespond={status === 'accepted' ? onRespond : undefined}
          questions={{
            uid: user.uid,
            fields: confirmForm.fields,
            answers,
            faults: answerFaults,
            busy: submitting,
            onAnswer: (key, value) => setAnswers((prev) => ({ ...prev, [key]: value })),
          }}
          asking={asking}
          onAsk={() => setAsking(true)}
          onCancelAsk={() => setAsking(false)}
          onSaveAnswers={status === 'confirmed' ? () => onRespond('confirm') : undefined}
        />
      )}

      {/*
        First, because it fills fields in every section below it — the talk as
        well as the speaker. Buried under "About you" it arrives after the work
        it would have saved.
      */}
      <SessionizeImport
        form={form}
        disabled={readOnly}
        onApply={(patch) => {
          dirty.current = true;
          setSaveState('idle');
          setForm((prev) => ({ ...prev, ...patch }));
        }}
      />

      {/* ------------------------------------------------------- the talk */}
      <section className="section">
        <h2>{t.sections.proposal}</h2>
        <p className="section__help">{t.sections.proposalHelp}</p>

        <TextField
          label={t.proposal.title}
          help={t.proposal.titleHelp}
          value={form.title}
          onChange={(v) => set('title', v)}
          maxLength={LIMITS.title}
          error={err('proposal.title')}
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
        />

        <div className="grid grid--3">
          <SelectField
            label={t.proposal.category}
            value={form.category}
            options={options.category}
            onChange={(v) => set('category', v)}
            error={err('proposal.category')}
            disabled={readOnly}
            required
          />
          <SelectField
            label={t.proposal.format}
            value={form.format}
            options={options.format}
            onChange={(v) => set('format', v)}
            error={err('proposal.format')}
            disabled={readOnly}
            required
          />
          <SelectField
            label={t.proposal.level}
            value={form.level}
            options={options.level}
            onChange={(v) => set('level', v)}
            error={err('proposal.level')}
            disabled={readOnly}
            required
          />
        </div>
      </section>

      {/* ------------------------------------------------------- language */}
      <section className="section">
        <h2>{t.sections.language}</h2>

        <SelectField
          label={t.language.delivery}
          value={form.deliveryLanguage}
          options={options.delivery}
          onChange={(v) => set('deliveryLanguage', v)}
          error={err('proposal.deliveryLanguage')}
          disabled={readOnly}
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
            disabled={readOnly}
          />
        </Reveal>
      </section>

      {/*
        The speaker profile lives on the account (`speakers/{uid}`), not on any
        one talk, and is the same document whichever talk is open. Saying so
        matters: otherwise editing it here reads as editing it "for this talk".
      */}
      <section className="section section--account">
        <h2>{t.sections.speaker}</h2>
        <p className="section__help">{t.sections.speakerHelp}</p>

        <TextField
          label={t.speaker.name}
          value={form.name}
          onChange={(v) => set('name', v)}
          maxLength={LIMITS.nameMax}
          error={err('speaker.name')}
          disabled={false}
          required
        />

        <TextField
          label={t.speaker.email}
          help={t.speaker.emailHelp}
          value={form.email}
          onChange={(v) => set('email', v)}
          type="email"
          error={err('speaker.email')}
          disabled
          required
        />

        <TextAreaField
          label={t.speaker.bio}
          help={t.speaker.bioHelp}
          value={form.bio}
          onChange={(v) => set('bio', v)}
          minLength={LIMITS.bioMin}
          maxLength={LIMITS.bioMax}
          rows={4}
          error={err('speaker.bio')}
          disabled={false}
          required
        />

        <div className="grid grid--2">
          {/* Not required — independents and between-jobs applicants exist (§3). */}
          <TextField
            label={t.speaker.company}
            help={t.speaker.employerHelp}
            value={form.company}
            onChange={(v) => set('company', v)}
            maxLength={LIMITS.companyMax}
            error={err('speaker.company')}
            disabled={false}
          />
          <TextField
            label={t.speaker.jobTitle}
            value={form.jobTitle}
            onChange={(v) => set('jobTitle', v)}
            maxLength={LIMITS.jobTitleMax}
            error={err('speaker.jobTitle')}
            disabled={false}
          />
        </div>

        <TextField
          label={t.speaker.basedIn}
          help={t.speaker.basedInHelp}
          value={form.basedIn}
          onChange={(v) => set('basedIn', v)}
          maxLength={LIMITS.basedInMax}
          error={err('speaker.basedIn')}
          disabled={false}
          required
        />

        <SocialsInput
          value={form.socials}
          onChange={(v) => set('socials', v)}
          disabled={false}
        />

        <TextAreaField
          label={t.speaker.pastTalks}
          help={t.speaker.pastTalksHelp}
          value={form.pastTalks}
          onChange={(v) => set('pastTalks', v)}
          maxLength={LIMITS.pastTalksMax}
          rows={3}
          error={err('speaker.pastTalks')}
          disabled={false}
        />

        <Checkbox
          label={t.speaker.isGde}
          checked={form.isGde}
          onChange={(v) => set('isGde', v)}
          disabled={false}
        />

        {/* Conditional 1 of 3 — shown only to GDEs, per §5. */}
        <Reveal when={form.isGde} variant="note">
          {t.speaker.gdeGuidance}
        </Reveal>
      </section>

      {/* ---------------------------------------------------------- acks */}
      <section className="section">
        <h2>{t.sections.acks}</h2>

        <Checkbox
          label={t.acks.noTravelSupport}
          checked={form.ackNoTravelSupport}
          onChange={(v) => set('ackNoTravelSupport', v)}
          error={err('acks.noTravelSupport')}
          disabled={readOnly}
        />
        <Checkbox
          label={
            import.meta.env.VITE_COC_URL ? (
              <>
                {t.acks.coc}{' '}
                <a href={import.meta.env.VITE_COC_URL} target="_blank" rel="noreferrer">
                  {t.acks.cocLink}
                </a>
              </>
            ) : (
              t.acks.coc
            )
          }
          checked={form.ackCoc}
          onChange={(v) => set('ackCoc', v)}
          error={err('acks.coc')}
          disabled={readOnly}
        />
        <Checkbox
          label={t.acks.recording}
          checked={form.ackRecording}
          onChange={(v) => set('ackRecording', v)}
          error={err('acks.recording')}
          disabled={readOnly}
        />
      </section>

      {/*
        §3: attendance follows immediately after the acknowledgements. The
        question only reads naturally once "travel is not covered" is on screen.
      */}
      <section className="section">
        <h2>{t.sections.attendance}</h2>

        <RadioGroup
          label={t.attendance.question}
          help={t.attendance.help}
          value={form.attendanceStatus}
          options={options.attendance}
          onChange={(v) => set('attendanceStatus', v)}
          error={err('attendance.status')}
          disabled={travelReadOnly}
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
            disabled={travelReadOnly}
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
              disabled={travelReadOnly}
              required
            />
          </Reveal>
        </Reveal>

        <Checkbox
          label={t.attendance.needsVisa}
          checked={form.needsVisa}
          onChange={(v) => set('needsVisa', v)}
          disabled={travelReadOnly}
        />

        {/* At a Montréal event, visas stop more speakers than money does (§5). */}
        <Reveal when={form.needsVisa} variant="note">
          {t.attendance.visaGuidance}
        </Reveal>
      </section>

      {/* -------------------------------------------------------- actions */}
      <div className="actions">
        <div className="actions__status" aria-live="polite">
          {saveState === 'saving' && t.form.saving}
          {saveState === 'saved' && t.form.saved}
          {saveState === 'failed' && <span className="field__error">{t.form.saveFailed}</span>}
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
          <button
            type="button"
            className="btn btn--ghost"
            disabled={scope === 'none' || saveState === 'saving'}
            onClick={persist}
          >
            {status === 'draft' ? t.form.save : t.form.saveChanges}
          </button>
          {status === 'draft' && (
            <button type="submit" className="btn btn--primary" disabled={readOnly || submitting}>
              {submitting ? t.form.submitting : t.form.submit}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
