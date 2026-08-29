/**
 * The speaker profile, on its own page.
 *
 * `speakers/{uid}` belongs to the account and is shared by every call for
 * proposals on the platform, so there has to be somewhere to edit it that is
 * not inside one of them — otherwise fixing a job title means opening a form
 * for a call you may not be submitting to.
 *
 * The submission form keeps the same fields inline rather than linking here. A
 * first-time speaker sent to another page halfway through submitting is a
 * speaker who does not come back.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { SpeakerFields } from '../components/SpeakerFields';
import { SpeakerProfilePhoto } from '../components/SpeakerProfilePhoto';
import { useI18n } from '../i18n/context';
import { friendlyError } from '../lib/errors';
import { emptyForm, fromDocuments, toSubmission, type FormState } from '../lib/formState';
import { loadProfile, saveProfile } from '../lib/proposals';
import { goTo } from '../lib/router';
import { speakerSchema } from '@shared/schema';

/**
 * Only the speaker half is validated here. Running the whole submission schema
 * would report a missing talk title on a page that has no talk on it.
 */
function faultsIn(form: FormState, t: ReturnType<typeof useI18n>['t']): Record<string, string> {
  const result = speakerSchema.safeParse(toSubmission(form).speaker);
  if (result.success) return {};

  const faults: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = `speaker.${issue.path.join('.')}`;
    const key = (issue as { params?: { key?: string } }).params?.key;
    faults[path] = (key && t.errors.rules[key]) || t.errors.incomplete;
  }
  return faults;
}

export function ProfilePage({ user }: { user: User }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const page = useRef<HTMLElement>(null);
  const restoringHistory = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError('');
    loadProfile(user, {
      force: loadAttempt > 0,
      onRevalidate: (speaker) => {
        if (!cancelled && !dirty.current) {
          setForm({ ...fromDocuments(undefined, speaker), email: user.email ?? '' });
        }
      },
    })
      .then((speaker) => {
        if (cancelled) return;
        // The address comes from the account either way, so a profile that does
        // not exist yet still opens with the one field we already know.
        setForm({ ...fromDocuments(undefined, speaker), email: user.email ?? '' });
        dirty.current = false;
      })
      .catch((e) => !cancelled && setLoadError(friendlyError(e, tRef.current)))
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [user, loadAttempt]);

  useEffect(() => {
    const pagePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmHistoryNavigation = () => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      if (!dirty.current) return;
      if (window.confirm(t.profile.leaveConfirm)) {
        dirty.current = false;
        return;
      }

      // A popstate cannot be cancelled after the address has moved. Push the
      // profile route back synchronously so App's route subscriber finishes the
      // same event on the page the speaker chose to keep editing.
      restoringHistory.current = true;
      goTo(pagePath);
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (
        !dirty.current ||
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
      if (!(target instanceof Element)) return;
      const signOut = target.closest('.account-menu__action--button');
      const link = target.closest<HTMLAnchorElement>('a[href]');
      const destination = link ? new URL(link.href, window.location.href) : null;
      const leavesPage =
        signOut !== null ||
        (destination !== null &&
          destination.origin === window.location.origin &&
          (destination.pathname !== window.location.pathname ||
            destination.search !== window.location.search));
      if (!leavesPage) return;

      if (window.confirm(t.profile.leaveConfirm)) {
        dirty.current = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('popstate', confirmHistoryNavigation);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('popstate', confirmHistoryNavigation);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [t.profile.leaveConfirm]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    dirty.current = true;
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const faults = faultsIn(form, t);
  const err = (path: string) => (showErrors ? faults[path] : undefined);

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setShowErrors(true);
    setError('');
    if (Object.keys(faults).length > 0) {
      requestAnimationFrame(() => {
        const control = page.current?.querySelector<HTMLElement>(
          'input[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled)',
        );
        control
          ?.closest<HTMLElement>('.field--error')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        control?.focus({ preventScroll: true });
      });
      return;
    }

    setBusy(true);
    try {
      await saveProfile(user, form, locale);
      dirty.current = false;
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="muted">{t.app.loading}</p>;
  if (loadError) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          {t.errors.reload}
        </button>
      </div>
    );
  }

  const complete = Object.keys(faults).length === 0;

  return (
    <section className="profile-page" ref={page}>
      <header className="profile-page__header">
        <div className="profile-page__intro">
          <p className="profile-page__eyebrow">{t.profile.eyebrow}</p>
          <h2>{t.profile.editorTitle}</h2>
          <p>{t.profile.help}</p>
        </div>
        <span
          className={`profile-page__state profile-page__state--${complete ? 'complete' : 'incomplete'}`}
        >
          {complete ? t.profile.complete : t.profile.needsAttention}
        </span>
      </header>

      <form className="profile-editor" onSubmit={save} noValidate>
        <div className="section profile-editor__fields">
          <SpeakerProfilePhoto disabled={busy} />
          <SpeakerFields form={form} set={set} err={err} disabled={busy} />
        </div>

        <footer className="profile-actions">
          <div className="profile-actions__state" aria-live="polite">
            {dirty.current && !busy && !error && t.profile.unsaved}
            {saved && t.profile.saved}
            {error && (
              <span className="field__error" role="alert">
                {error}
              </span>
            )}
            {showErrors && Object.keys(faults).length > 0 && (
              <span className="field__error" role="alert">
                {t.profile.incomplete}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t.profile.saving : t.profile.save}
          </button>
        </footer>
      </form>
    </section>
  );
}
