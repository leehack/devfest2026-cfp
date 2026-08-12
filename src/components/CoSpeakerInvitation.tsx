import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut, type User } from 'firebase/auth';

import type { SpeakerInvitationSummary } from '@shared/coSpeakers';
import { localised, type ConfirmField } from '@shared/confirmForm';
import { LIMITS, type AttendanceStatus } from '@shared/enums';
import { attendanceSchemaFor, speakerSchema } from '@shared/schema';
import { attendanceInputFor, asOptions } from '@shared/submissionForm';

import { auth } from '../firebase';
import { useI18n } from '../i18n/context';
import { validationMessage } from '../i18n/validation';
import {
  emptyForm,
  fromDocuments,
  toDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import {
  coSpeakerInvitationError,
  friendlyError,
  isCoSpeakerInvitationUnavailable,
} from '../lib/errors';
import { COC_URL } from '../lib/env';
import {
  loadCoSpeakerInvitation,
  respondToCoSpeakerInvitation,
} from '../lib/coSpeakers';
import { loadProfile, saveProfile } from '../lib/proposals';
import { href } from '../lib/router';
import { Link } from './Link';
import { Checkbox, RadioGroup, TextField } from './fields';
import { Reveal } from './Reveal';
import { SpeakerFields } from './SpeakerFields';

function profileFaults(
  form: FormState,
  t: ReturnType<typeof useI18n>['t'],
): Record<string, string> {
  const result = speakerSchema.safeParse(toSubmission(form).speaker);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [
      `speaker.${issue.path.join('.')}`,
      validationMessage(issue, t),
    ]),
  );
}

function invitationFaults(
  form: FormState,
  summary: SpeakerInvitationSummary | null,
  t: ReturnType<typeof useI18n>['t'],
): Record<string, string> {
  const faults = profileFaults(form, t);
  if (summary?.phase !== 'postAcceptance' || !summary.participation) return faults;

  for (const acknowledgement of summary.participation.acknowledgements) {
    if (form.acks[acknowledgement.key] !== true) {
      faults[`acks.${acknowledgement.key}`] = t.form.required;
    }
  }
  if (summary.participation.attendance.enabled) {
    const attendance = attendanceSchemaFor(summary.participation.attendance).safeParse(
      toDocuments(form).proposalDoc.attendance,
    );
    if (!attendance.success) {
      for (const issue of attendance.error.issues) {
        faults[`attendance.${issue.path.join('.')}`] = validationMessage(issue, t);
      }
    }
  }
  return faults;
}

function AcknowledgementLabel({ acknowledgement }: { acknowledgement: ConfirmField }) {
  const { t, locale } = useI18n();
  const text = localised(acknowledgement.label, locale);
  if (acknowledgement.key !== 'coc' || !COC_URL) return <>{text}</>;
  return (
    <>
      {text}{' '}
      <a href={COC_URL} target="_blank" rel="noreferrer">
        {t.acks.cocLink}
      </a>
    </>
  );
}

function focusFirstProfileFault(root: HTMLElement | null) {
  const control = root?.querySelector<HTMLElement>(
    'input[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled)',
  );
  control?.closest<HTMLElement>('.field--error')?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
  control?.focus({ preventScroll: true });
}

function focusInvitationState(root: HTMLElement | null) {
  window.scrollTo({ top: 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    });
  });
}

function InvitationState({
  summary,
  cfpId,
  onOpen,
  focusRoot,
}: {
  summary: SpeakerInvitationSummary;
  cfpId: string;
  onOpen: () => void;
  focusRoot: (node: HTMLElement | null) => void;
}) {
  const { t } = useI18n();
  const copy =
    summary.state === 'accepted'
      ? [
          t.coSpeakers.acceptedTitle,
          summary.phase === 'postAcceptance'
            ? t.coSpeakers.lateAcceptedHelp
            : t.coSpeakers.acceptedHelp,
        ]
      : summary.state === 'declined'
        ? [t.coSpeakers.declinedTitle, t.coSpeakers.declinedHelp]
        : summary.state === 'paused'
          ? [t.coSpeakers.pausedTitle, t.coSpeakers.pausedHelp]
          : summary.state === 'unavailable'
            ? [t.coSpeakers.unavailableTitle, t.coSpeakers.unavailableHelp]
        : summary.state === 'expired'
          ? [t.coSpeakers.expiredTitle, t.coSpeakers.expiredHelp]
          : [t.coSpeakers.revokedTitle, t.coSpeakers.revokedHelp];
  return (
    <section className="panel co-speaker-invitation-state" ref={focusRoot}>
      <p className="co-speaker-invitation__eyebrow">{t.coSpeakers.invitationEyebrow}</p>
      <h1 tabIndex={-1}>{copy[0]}</h1>
      <p>{copy[1]}</p>
      <div className="actions__buttons">
        {summary.state === 'accepted' && (
          <button type="button" className="btn btn--primary" onClick={onOpen}>
            {t.coSpeakers.openProposal}
          </button>
        )}
        <Link className="btn" to={href({ route: 'cfp', cfpId })}>
          {t.coSpeakers.backToEvent}
        </Link>
      </div>
    </section>
  );
}

export function CoSpeakerInvitation({
  user,
  cfpId,
  proposalId,
  invitationId,
  onJoined,
}: {
  user: User;
  cfpId: string;
  proposalId: string;
  invitationId: string;
  onJoined: () => void;
}) {
  const { t, locale } = useI18n();
  const tRef = useRef(t);
  const root = useRef<HTMLElement | null>(null);
  const [summary, setSummary] = useState<SpeakerInvitationSummary | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'switch' | null>(null);
  const [actionError, setActionError] = useState('');
  const focusTransition = useRef(false);
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([
      loadCoSpeakerInvitation(cfpId, proposalId, invitationId),
      loadProfile(user),
    ])
      .then(([nextSummary, profile]) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setForm({
          ...fromDocuments(undefined, profile),
          name: profile?.name || user.displayName || '',
          email: user.email ?? '',
        });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(friendlyError(error, tRef.current));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, invitationId, proposalId, user, attempt]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);
  const faults = invitationFaults(form, summary, t);
  const err = (path: string) => (showErrors ? faults[path] : undefined);

  useEffect(() => {
    if (!focusTransition.current || !summary || summary.state === 'pending') return;
    focusTransition.current = false;
    focusInvitationState(root.current);
  }, [summary]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    setActionError('');
    if (Object.keys(faults).length > 0) {
      requestAnimationFrame(() => focusFirstProfileFault(root.current));
      return;
    }
    setBusy('accept');
    let responding = false;
    try {
      await saveProfile(user, form, locale);
      const proposal = toDocuments(form).proposalDoc;
      const attendance = summary?.participation
        ? attendanceInputFor(summary.participation.attendance, proposal.attendance)
        : undefined;
      responding = true;
      await respondToCoSpeakerInvitation(
        cfpId,
        proposalId,
        invitationId,
        'accept',
        summary?.phase === 'postAcceptance'
          ? { acks: proposal.acks, ...(attendance ? { attendance } : {}) }
          : undefined,
      );
      onJoined();
    } catch (error) {
      setActionError(
        responding ? coSpeakerInvitationError(error, t) : friendlyError(error, t),
      );
      if (responding && isCoSpeakerInvitationUnavailable(error)) {
        setAttempt((value) => value + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (!window.confirm(t.coSpeakers.declineConfirm)) return;
    setBusy('decline');
    setActionError('');
    try {
      await respondToCoSpeakerInvitation(cfpId, proposalId, invitationId, 'decline');
      focusTransition.current = true;
      setSummary((current) => (current ? { ...current, state: 'declined', canRespond: false } : current));
    } catch (error) {
      setActionError(coSpeakerInvitationError(error, t));
      if (isCoSpeakerInvitationUnavailable(error)) {
        setAttempt((value) => value + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  async function switchAccount() {
    setBusy('switch');
    setActionError('');
    try {
      await signOut(auth);
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById('sign-in')?.focus({ preventScroll: true });
        });
      });
    } catch (error) {
      setActionError(friendlyError(error, t));
      setBusy(null);
    }
  }

  if (loading) return <p className="muted">{t.app.loading}</p>;
  if (loadError || !summary) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {loadError || t.coSpeakers.loadFailed}
        </p>
        <button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>
          {t.coSpeakers.retry}
        </button>
      </div>
    );
  }

  if (!summary.matchesSignedInEmail) {
    return (
      <section className="co-speaker-invitation" ref={root}>
        <header className="co-speaker-invitation__hero">
          <p className="co-speaker-invitation__eyebrow">{t.coSpeakers.invitationEyebrow}</p>
          <h1>{t.coSpeakers.wrongAccountTitle}</h1>
          <p>{t.coSpeakers.wrongAccountHelp(summary.invitedEmail)}</p>
        </header>
        <dl className="co-speaker-invitation__facts">
          <div>
            <dt>{t.coSpeakers.eventLabel}</dt>
            <dd>{summary.eventName}</dd>
          </div>
          <div>
            <dt>{t.coSpeakers.proposalLabel}</dt>
            <dd>{summary.title}</dd>
          </div>
          <div>
            <dt>{t.coSpeakers.accountLabel}</dt>
            <dd>{summary.invitedEmail}</dd>
          </div>
        </dl>
        {actionError && <p className="field__error" role="alert">{actionError}</p>}
        <div className="co-speaker-invitation__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy !== null}
            onClick={() => void switchAccount()}
          >
            {t.coSpeakers.switchAccount}
          </button>
          <Link className="btn" to={href({ route: 'cfp', cfpId })}>
            {t.coSpeakers.backToEvent}
          </Link>
        </div>
      </section>
    );
  }

  if (summary.state !== 'pending') {
    return (
      <InvitationState
        summary={summary}
        cfpId={cfpId}
        onOpen={onJoined}
        focusRoot={(node) => {
          root.current = node;
        }}
      />
    );
  }

  if (!summary.canRespond) {
    return (
      <InvitationState
        summary={{ ...summary, state: 'unavailable' }}
        cfpId={cfpId}
        onOpen={onJoined}
        focusRoot={(node) => {
          root.current = node;
        }}
      />
    );
  }

  return (
    <section className="co-speaker-invitation" ref={root}>
      <header className="co-speaker-invitation__hero">
        <p className="co-speaker-invitation__eyebrow">{t.coSpeakers.invitationEyebrow}</p>
        <h1>{t.coSpeakers.invitationTitle}</h1>
        <p>
          {summary.phase === 'postAcceptance'
            ? t.coSpeakers.lateInvitationFrom(summary.primaryName)
            : t.coSpeakers.invitationFrom(summary.primaryName)}
        </p>
      </header>

      <dl className="co-speaker-invitation__facts">
        <div>
          <dt>{t.coSpeakers.eventLabel}</dt>
          <dd>{summary.eventName}</dd>
        </div>
        <div>
          <dt>{t.coSpeakers.proposalLabel}</dt>
          <dd>{summary.title}</dd>
        </div>
        <div>
          <dt>{t.coSpeakers.accountLabel}</dt>
          <dd>{summary.invitedEmail}</dd>
        </div>
      </dl>

      {summary.talk && (
        <section
          className="co-speaker-invitation__talk"
          aria-labelledby="co-speaker-invitation-talk-title"
        >
          <h2 id="co-speaker-invitation-talk-title">{t.coSpeakers.talkDetailsTitle}</h2>
          <p>{summary.talk.abstract}</p>
          <dl>
            <div>
              <dt>{t.proposal.category}</dt>
              <dd>{localised(summary.talk.category, locale)}</dd>
            </div>
            <div>
              <dt>{t.proposal.format}</dt>
              <dd>{localised(summary.talk.format, locale)}</dd>
            </div>
            <div>
              <dt>{t.proposal.level}</dt>
              <dd>{localised(summary.talk.level, locale)}</dd>
            </div>
            <div>
              <dt>{t.language.delivery}</dt>
              <dd>{localised(summary.talk.deliveryLanguage, locale)}</dd>
            </div>
          </dl>
        </section>
      )}

      <aside className="co-speaker-invitation__warning">
        <h2>{t.coSpeakers.conflictTitle}</h2>
        <p>{t.coSpeakers.conflictHelp}</p>
      </aside>

      <form className="co-speaker-invitation__profile" onSubmit={accept} noValidate>
        <h2>{t.coSpeakers.profileTitle}</h2>
        <p className="section__help">{t.coSpeakers.profileHelp}</p>
        <SpeakerFields form={form} set={set} err={err} disabled={busy !== null} />
        {summary.participation &&
          (summary.participation.acknowledgements.length > 0 ||
            summary.participation.attendance.enabled) && (
          <section className="co-speaker-invitation__participation">
            <h2>{t.coSpeakers.participationTitle}</h2>
            <p className="section__help">
              {summary.participation.attendance.enabled
                ? summary.participation.acknowledgements.length > 0
                  ? t.coSpeakers.participationHelp
                  : t.coSpeakers.participationHelpTravel
                : t.coSpeakers.participationHelpAcks}
            </p>
            {summary.participation.acknowledgements.map((acknowledgement) => (
              <Checkbox
                key={acknowledgement.key}
                label={<AcknowledgementLabel acknowledgement={acknowledgement} />}
                checked={form.acks[acknowledgement.key] === true}
                onChange={(value) =>
                  set('acks', { ...form.acks, [acknowledgement.key]: value })
                }
                error={err(`acks.${acknowledgement.key}`)}
                disabled={busy !== null}
              />
            ))}
            {summary.participation.attendance.enabled && (
            <>
            <h3>{localised(summary.participation.attendance.title, locale)}</h3>
            <Reveal
              when={form.isGde && Boolean(summary.participation.attendance.gdeGuidance)}
              variant="note"
            >
              {localised(summary.participation.attendance.gdeGuidance, locale)}
            </Reveal>
            <RadioGroup
              label={localised(summary.participation.attendance.question, locale)}
              help={localised(summary.participation.attendance.help, locale)}
              value={form.attendanceStatus}
              options={asOptions(summary.participation.attendance.statuses, locale).map(
                (option) => ({ ...option, value: option.value as AttendanceStatus }),
              )}
              onChange={(value) => set('attendanceStatus', value)}
              error={err('attendance.status')}
              disabled={busy !== null}
              required
            />
            <Reveal
              when={
                summary.participation.attendance.fundingSource.enabled &&
                (form.attendanceStatus === 'secured' || form.attendanceStatus === 'pending')
              }
              onHide={() => set('fundingSource', '')}
            >
              <TextField
                label={localised(summary.participation.attendance.fundingSource.label, locale)}
                help={localised(summary.participation.attendance.fundingSource.help, locale)}
                value={form.fundingSource}
                onChange={(value) => set('fundingSource', value)}
                maxLength={LIMITS.fundingSourceMax}
                error={err('attendance.fundingSource')}
                disabled={busy !== null}
                required
              />
            </Reveal>
            <Reveal
              when={
                summary.participation.attendance.decisionBy.enabled &&
                form.attendanceStatus === 'pending'
              }
              onHide={() => set('decisionBy', '')}
            >
              <TextField
                label={localised(summary.participation.attendance.decisionBy.label, locale)}
                help={localised(summary.participation.attendance.decisionBy.help, locale)}
                value={form.decisionBy}
                onChange={(value) => set('decisionBy', value)}
                type="date"
                error={err('attendance.decisionBy')}
                disabled={busy !== null}
                required
              />
            </Reveal>
            {summary.participation.attendance.needsVisa.enabled && (
              <Checkbox
                label={localised(summary.participation.attendance.needsVisa.label, locale)}
                checked={form.needsVisa}
                onChange={(value) => set('needsVisa', value)}
                disabled={busy !== null}
              />
            )}
            <Reveal
              when={
                summary.participation.attendance.needsVisa.enabled &&
                form.needsVisa &&
                Boolean(summary.participation.attendance.needsVisa.help)
              }
              variant="note"
            >
              {localised(summary.participation.attendance.needsVisa.help, locale)}
            </Reveal>
            </>
            )}
          </section>
        )}
        {showErrors && Object.keys(faults).length > 0 && (
          <p className="field__error" role="alert">
            {t.profile.incomplete}
          </p>
        )}
        {actionError && (
          <p className="field__error" role="alert">
            {actionError}
          </p>
        )}
        <div className="co-speaker-invitation__actions">
          <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => void decline()}>
            {t.coSpeakers.decline}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy !== null}>
            {busy === 'accept'
              ? t.coSpeakers.joining
              : summary.phase === 'postAcceptance'
                ? t.coSpeakers.joinLate
                : t.coSpeakers.join}
          </button>
        </div>
      </form>
    </section>
  );
}
