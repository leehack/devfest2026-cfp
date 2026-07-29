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

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { SpeakerFields } from '../components/SpeakerFields';
import { useI18n } from '../i18n/context';
import { friendlyError } from '../lib/errors';
import { emptyForm, fromDocuments, toSubmission, type FormState } from '../lib/formState';
import { loadProfile, saveProfile } from '../lib/proposals';
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
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadProfile(user)
      .then((speaker) => {
        if (cancelled) return;
        // The address comes from the account either way, so a profile that does
        // not exist yet still opens with the one field we already know.
        setForm({ ...fromDocuments(undefined, speaker), email: user.email ?? '' });
      })
      .catch((e) => !cancelled && setError(friendlyError(e, t)))
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [user, t]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const faults = faultsIn(form, t);
  const err = (path: string) => (showErrors ? faults[path] : undefined);

  async function save() {
    setShowErrors(true);
    setError('');
    if (Object.keys(faults).length > 0) return;

    setBusy(true);
    try {
      await saveProfile(user, form, locale);
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="muted">{t.app.loading}</p>;

  return (
    <section className="section">
      <h2>{t.profile.title}</h2>
      <p className="section__help">{t.profile.help}</p>

      <SpeakerFields form={form} set={set} err={err} />

      <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
        {busy ? t.profile.saving : t.profile.save}
      </button>

      {saved && (
        <p className="note note--inline" role="status">
          {t.profile.saved}
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {showErrors && Object.keys(faults).length > 0 && (
        <p className="field__error" role="alert">
          {t.profile.incomplete}
        </p>
      )}
    </section>
  );
}
