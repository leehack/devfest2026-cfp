import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  ATTENDANCE_STATUSES,
  CATEGORIES,
  DELIVERY_LANGUAGES,
  FORMATS,
  LEVELS,
  LIMITS,
} from '@shared/enums';
import { submissionSchema } from '@shared/schema';

import { Checkbox, RadioGroup, SelectField, TextAreaField, TextField } from '../components/fields';
import { Reveal } from '../components/Reveal';
import { SessionizeImport } from '../components/SessionizeImport';
import { SocialsInput } from '../components/SocialsInput';
import { formatDate, useI18n } from '../i18n';
import {
  emptyForm,
  fromDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import {
  loadMyProposal,
  saveDraft,
  submitProposal,
  withdrawProposal,
  type CfpWindow,
} from '../lib/proposals';
import type { ProposalStatus } from '@shared/enums';

type Errors = Record<string, string>;

/** Flattens zod issue paths into the dotted keys the fields look themselves up by. */
function validate(form: FormState): Errors {
  const result = submissionSchema.safeParse(toSubmission(form));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = issue.message;
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
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProposalStatus>('draft');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const dirty = useRef(false);
  const readOnly = status !== 'draft' || cfp.state !== 'open';

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await loadMyProposal(user);
        if (cancelled) return;
        if (existing) {
          setForm(fromDocuments(existing.proposal, existing.speaker));
          setProposalId(existing.id);
          setStatus(existing.status);
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
    if (readOnly) return;
    setSaveState('saving');
    try {
      const id = await saveDraft(user, form, proposalId);
      if (!proposalId) setProposalId(id);
      dirty.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [form, proposalId, readOnly, user]);

  useEffect(() => {
    if (loading || readOnly || !dirty.current) return;
    const handle = setTimeout(persist, 1500);
    return () => clearTimeout(handle);
  }, [form, loading, readOnly, persist]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    dirty.current = true;
    setSaveState('idle');
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Re-validate live once the applicant has seen errors, so fixes clear as they type.
  useEffect(() => {
    if (showErrors) setErrors(validate(form));
  }, [form, showErrors]);

  // ------------------------------------------------------------------- submit

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(form);
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
      const id = await saveDraft(user, form, proposalId);
      setProposalId(id);
      await submitProposal({ proposalId: id });
      setStatus('submitted');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      setBanner(error?.message ?? t.errors.generic);
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
    } catch (error: any) {
      setBanner(error?.message ?? t.errors.generic);
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

  if (status === 'submitted' || status === 'under_review') {
    return (
      <div className="panel panel--good">
        <h2>{t.form.submitted}</h2>
        <p>{t.form.submittedHelp}</p>
        <button type="button" className="btn btn--ghost" disabled={submitting} onClick={onWithdraw}>
          {t.form.withdraw}
        </button>
        {banner && <p className="field__error">{banner}</p>}
      </div>
    );
  }

  if (status === 'withdrawn') {
    return (
      <div className="panel">
        <h2>{t.form.withdraw}</h2>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <p className="deadline">
        {t.window.closesAt} <strong>{formatDate(cfp.closesAt, locale)}</strong>
      </p>

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

      {/* --------------------------------------------------------- speaker */}
      <section className="section">
        <h2>{t.sections.speaker}</h2>

        <SessionizeImport
          form={form}
          disabled={readOnly}
          onApply={(patch) => {
            dirty.current = true;
            setSaveState('idle');
            setForm((prev) => ({ ...prev, ...patch }));
          }}
        />

        <TextField
          label={t.speaker.name}
          value={form.name}
          onChange={(v) => set('name', v)}
          maxLength={LIMITS.nameMax}
          error={err('speaker.name')}
          disabled={readOnly}
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
          disabled={readOnly}
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
            disabled={readOnly}
          />
          <TextField
            label={t.speaker.jobTitle}
            value={form.jobTitle}
            onChange={(v) => set('jobTitle', v)}
            maxLength={LIMITS.jobTitleMax}
            error={err('speaker.jobTitle')}
            disabled={readOnly}
          />
        </div>

        <TextField
          label={t.speaker.basedIn}
          help={t.speaker.basedInHelp}
          value={form.basedIn}
          onChange={(v) => set('basedIn', v)}
          maxLength={LIMITS.basedInMax}
          error={err('speaker.basedIn')}
          disabled={readOnly}
          required
        />

        <SocialsInput
          value={form.socials}
          onChange={(v) => set('socials', v)}
          disabled={readOnly}
        />

        <TextAreaField
          label={t.speaker.pastTalks}
          help={t.speaker.pastTalksHelp}
          value={form.pastTalks}
          onChange={(v) => set('pastTalks', v)}
          maxLength={LIMITS.pastTalksMax}
          rows={3}
          error={err('speaker.pastTalks')}
          disabled={readOnly}
        />

        <Checkbox
          label={t.speaker.isGde}
          checked={form.isGde}
          onChange={(v) => set('isGde', v)}
          disabled={readOnly}
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
          disabled={readOnly}
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
            disabled={readOnly}
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
              disabled={readOnly}
              required
            />
          </Reveal>
        </Reveal>

        <Checkbox
          label={t.attendance.needsVisa}
          checked={form.needsVisa}
          onChange={(v) => set('needsVisa', v)}
          disabled={readOnly}
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
            disabled={readOnly || saveState === 'saving'}
            onClick={persist}
          >
            {t.form.save}
          </button>
          <button type="submit" className="btn btn--primary" disabled={readOnly || submitting}>
            {submitting ? t.form.submitting : t.form.submit}
          </button>
        </div>
      </div>
    </form>
  );
}
