import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut, type User } from 'firebase/auth';

import type { SpeakerInvitationSummary } from '@shared/coSpeakers';
import { localised } from '@shared/confirmForm';
import { speakerSchema } from '@shared/schema';

import { auth } from '../firebase';
import { useI18n } from '../i18n/context';
import { validationMessage } from '../i18n/validation';
import {
  emptyForm,
  fromDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import { friendlyError } from '../lib/errors';
import {
  loadCoSpeakerInvitation,
  respondToCoSpeakerInvitation,
} from '../lib/coSpeakers';
import { loadProfile, saveProfile } from '../lib/proposals';
import { href } from '../lib/router';
import { Link } from './Link';
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
      ? [t.coSpeakers.acceptedTitle, t.coSpeakers.acceptedHelp]
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
  const faults = profileFaults(form, t);
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
    try {
      await saveProfile(user, form, locale);
      await respondToCoSpeakerInvitation(cfpId, proposalId, invitationId, 'accept');
      onJoined();
    } catch (error) {
      setActionError(friendlyError(error, t));
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
      setActionError(friendlyError(error, t));
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
        <p>{t.coSpeakers.invitationFrom(summary.primaryName)}</p>
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
            {busy === 'accept' ? t.coSpeakers.joining : t.coSpeakers.join}
          </button>
        </div>
      </form>
    </section>
  );
}
