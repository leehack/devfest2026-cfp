/**
 * Starting a call for proposals.
 *
 * The address is the document id, so creating one *is* the uniqueness check —
 * there is nothing to reserve and no window in which two people both believe
 * they hold a name. `already-exists` comes back from the callable and is shown
 * against the address field, which is where the fix is.
 */

import { useEffect, useRef, useState } from 'react';
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
  const [addressError, setAddressError] = useState('');
  const [origin, setOrigin] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const addressField = useRef<HTMLDivElement>(null);

  const cfpId = idTouched ? id : idFromName(name);
  const publicPath = cfpId ? `/c/${cfpId}` : '/c/your-event';
  const publicUrl = `${origin}${publicPath}`;
  const ownerName = user.displayName?.trim() || t.platform.ownerFallback;

  // These values only exist in a browser. Keeping the first render independent
  // of them lets Next render this client component on the server without
  // crashing or producing different markup at hydration.
  useEffect(() => {
    setOrigin(window.location.origin);
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  async function create() {
    if (busy) return;
    setError('');
    setAddressError('');
    const fault = validateCfp({ id: cfpId, name, visibility });
    if (fault) {
      const message = t.platform.errors[fault] ?? t.errors.generic;
      if (fault === 'idFormat' || fault === 'idLength') {
        setAddressError(message);
        requestAnimationFrame(() => addressField.current?.querySelector('input')?.focus());
      } else {
        setError(message);
      }
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
      navigate('admin', { cfpId, tab: 'overview' });
    } catch (err: any) {
      const code = String(err?.code ?? '');
      if (code === 'functions/already-exists') {
        setAddressError(t.platform.errors.taken);
        requestAnimationFrame(() => addressField.current?.querySelector('input')?.focus());
      } else {
        setError(
          code === 'functions/resource-exhausted'
            ? t.platform.errors.limit
            : code === 'functions/failed-precondition'
              ? t.platform.errors.unverified
              : code === 'functions/permission-denied'
                ? t.platformAdmin.accessRequiredHelp
                : t.errors.generic,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="new-cfp">
      <header className="new-cfp__intro">
        <p className="new-cfp__eyebrow">{t.platform.createEyebrow}</p>
        <h2 className="new-cfp__title" id="new-cfp-title">
          {t.platform.createDetailsTitle}
        </h2>
        <p className="new-cfp__help">{t.platform.createHelp}</p>
      </header>

      <form
        className="create-form"
        aria-labelledby="new-cfp-title"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <section className="create-form__section" aria-labelledby="create-identity-title">
          <header className="create-form__section-header">
            <p className="create-form__step">{t.platform.createStep.replace('{step}', '1')}</p>
            <h3 className="create-form__section-title" id="create-identity-title">
              {t.platform.createIdentity}
            </h3>
            <p className="create-form__section-help">{t.platform.createIdentityHelp}</p>
          </header>

          <TextField
            label={t.platform.nameLabel}
            help={t.platform.nameHelp}
            value={name}
            onChange={(value) => {
              setName(value);
              if (!idTouched) setAddressError('');
            }}
            required
            maxLength={CFP_LIMITS.nameMax}
            disabled={busy}
          />

          <div ref={addressField}>
            <TextField
              label={t.platform.addressLabel}
              help={t.platform.addressHelp}
              error={addressError}
              value={cfpId}
              onChange={(value) => {
                setIdTouched(true);
                setId(value);
                setAddressError('');
              }}
              required
              maxLength={CFP_LIMITS.idMax}
              disabled={busy}
            />
          </div>

          <div className="url-preview">
            <div className="url-preview__label-row">
              <span className="url-preview__label">{t.platform.addressPreviewLabel}</span>
              <span className="url-preview__lock">{t.platform.addressImmutable}</span>
            </div>
            <code className="url-preview__value">{publicUrl}</code>
            <p className="url-preview__help">{t.platform.addressPreviewHelp}</p>
          </div>
        </section>

        <section className="create-form__section" aria-labelledby="create-access-title">
          <header className="create-form__section-header">
            <p className="create-form__step">{t.platform.createStep.replace('{step}', '2')}</p>
            <h3 className="create-form__section-title" id="create-access-title">
              {t.platform.createAccess}
            </h3>
          </header>

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
        </section>

        <section className="create-form__section" aria-labelledby="create-window-title">
          <header className="create-form__section-header create-form__section-header--split">
            <div>
              <p className="create-form__step">{t.platform.createStep.replace('{step}', '3')}</p>
              <h3 className="create-form__section-title" id="create-window-title">
                {t.platform.createWindow}
              </h3>
            </div>
            <p className="create-form__timezone">
              {t.platform.timeZone.replace(
                '{zone}',
                timeZone || t.platform.timeZoneFallback,
              )}
            </p>
          </header>

          <div className="grid grid--2 create-form__dates">
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
        </section>

        <aside className="create-owner" aria-labelledby="create-owner-title">
          <span className="create-owner__avatar" aria-hidden="true">
            {ownerName.charAt(0).toLocaleUpperCase()}
          </span>
          <div className="create-owner__identity">
            <p className="create-owner__label" id="create-owner-title">
              {t.platform.ownerLabel}
            </p>
            <p className="create-owner__name">{ownerName}</p>
            {user.email && <p className="create-owner__email">{user.email}</p>}
          </div>
          <p className="create-owner__help">{t.platform.ownerHelp}</p>
        </aside>

        <aside className="after-create" aria-labelledby="after-create-title">
          <div className="after-create__header">
            <p className="after-create__eyebrow">{t.platform.afterEyebrow}</p>
            <h3 className="after-create__title" id="after-create-title">
              {t.platform.afterTitle}
            </h3>
          </div>
          <ol className="after-create__steps">
            <li>{t.platform.afterDetails}</li>
            <li>{t.platform.afterForm}</li>
            <li>{t.platform.afterTeam}</li>
          </ol>
          <p className="after-create__help">{t.platform.afterHelp}</p>
        </aside>

        {error && (
          <p className="create-form__error field__error" role="alert">
            {error}
          </p>
        )}

        <div className="create-form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !name.trim() || !cfpId}
          >
            {busy ? t.platform.creating : t.platform.submit}
          </button>
          <p className="create-form__submit-note">{t.platform.submitHelp}</p>
        </div>
      </form>
    </div>
  );
}
