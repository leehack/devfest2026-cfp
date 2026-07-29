/**
 * Starting a call for proposals.
 *
 * The address is the document id, so creating one *is* the uniqueness check —
 * there is nothing to reserve and no window in which two people both believe
 * they hold a name. `already-exists` comes back from the callable and is shown
 * against the address field, which is where the fix is.
 */

import { useState } from 'react';
import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { navigate } from '../lib/router';
import { createCfp } from '../lib/roles';
import { RadioGroup, TextField } from '../components/fields';
import { CFP_LIMITS, idFromName, validateCfp, type Visibility } from '@shared/cfp';

/** Local midnight, as the `datetime-local` input wants it. */
function localInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const inWeeks = (weeks: number) => {
  const at = new Date();
  at.setDate(at.getDate() + weeks * 7);
  at.setHours(23, 59, 0, 0);
  return at;
};

export function NewCfpPage({ user }: { user: User }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  // Follows the name until the address is typed into directly — after that it
  // is the author's, because an address that keeps changing under you is worse
  // than one you have to finish.
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [opensAt, setOpensAt] = useState(localInput(new Date()));
  const [closesAt, setClosesAt] = useState(localInput(inWeeks(6)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cfpId = idTouched ? id : idFromName(name);

  async function create() {
    setError('');
    const fault = validateCfp({ id: cfpId, name, visibility });
    if (fault) {
      setError(t.platform.errors[fault] ?? t.errors.generic);
      return;
    }
    if (new Date(closesAt) <= new Date(opensAt)) {
      setError(t.platform.errors.dates);
      return;
    }

    setBusy(true);
    try {
      await createCfp({
        cfpId,
        name: name.trim(),
        visibility,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
      });
      navigate('admin', { cfpId, tab: 'settings' });
    } catch (err: any) {
      const code = String(err?.code ?? '');
      setError(
        code === 'functions/already-exists'
          ? t.platform.errors.taken
          : code === 'functions/resource-exhausted'
            ? t.platform.errors.limit
            : code === 'functions/failed-precondition'
              ? t.platform.errors.unverified
              : (t.platform.errors[String(err?.message ?? '')] ?? t.errors.generic),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="card__title">{t.platform.createTitle}</h2>
      <p className="muted">{t.platform.createHelp}</p>

      <TextField
        label={t.platform.nameLabel}
        help={t.platform.nameHelp}
        value={name}
        onChange={setName}
        required
        maxLength={CFP_LIMITS.nameMax}
        disabled={busy}
      />

      <TextField
        label={t.platform.addressLabel}
        help={
          cfpId
            ? t.platform.addressPreview.replace('{url}', `${location.origin}/c/${cfpId}`)
            : t.platform.addressHelp
        }
        value={cfpId}
        onChange={(value) => {
          setIdTouched(true);
          setId(value);
        }}
        required
        maxLength={CFP_LIMITS.idMax}
        disabled={busy}
      />

      <RadioGroup
        label={t.platform.visibilityLabel}
        help={t.platform.visibilityHelp}
        value={visibility}
        onChange={setVisibility}
        required
        disabled={busy}
        options={[
          { value: 'public', label: t.platform.visibilityPublic },
          { value: 'private', label: t.platform.visibilityPrivate },
        ]}
      />

      <div className="grid grid--2">
        <TextField
          label={t.platform.opensLabel}
          type="datetime-local"
          value={opensAt}
          onChange={setOpensAt}
          required
          disabled={busy}
        />
        <TextField
          label={t.platform.closesLabel}
          type="datetime-local"
          value={closesAt}
          onChange={setClosesAt}
          required
          disabled={busy}
        />
      </div>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !name.trim() || !cfpId}
        onClick={create}
      >
        {busy ? t.platform.creating : t.platform.submit}
      </button>
      <p className="field__help">{user.email}</p>
    </section>
  );
}
