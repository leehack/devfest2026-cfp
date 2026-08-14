import { useCallback, useEffect, useMemo, useState } from 'react';

import { ORG_LIMITS } from '@shared/org';
import { useI18n } from '../i18n/context';
import {
  getPlatformLimitsConfiguration,
  setPlatformLimitsConfiguration,
} from '../lib/orgs';
import { useLatest } from '../lib/useLatest';
import { Result } from '../screens/admin/Result';

export function PlatformGlobalLimits({
  onDirtyChange,
  onSaved,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [current, setCurrent] = useState<number | null>(null);
  const [draft, setDraft] = useState(String(ORG_LIMITS.perOwner));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const dirty = useMemo(() => current !== null && Number(draft) !== current, [current, draft]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await getPlatformLimitsConfiguration({});
      setCurrent(data.organizationOwnershipDefault);
      setDraft(String(data.organizationOwnershipDefault));
      setError('');
    } catch {
      setError(tRef.current.platformAdmin.globalLimitsLoadError);
    }
  }, [tRef]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const organizationOwnershipDefault = Number(draft);
    if (
      !Number.isInteger(organizationOwnershipDefault) ||
      organizationOwnershipDefault < 0 ||
      organizationOwnershipDefault > ORG_LIMITS.perOwnerMax
    ) {
      setError(
        t.platformAdmin.userLimitInvalid.replace('{max}', String(ORG_LIMITS.perOwnerMax)),
      );
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { data } = await setPlatformLimitsConfiguration({ organizationOwnershipDefault });
      setCurrent(data.organizationOwnershipDefault);
      setDraft(String(data.organizationOwnershipDefault));
      setNote(t.platformAdmin.globalLimitsSaved);
      onSaved();
    } catch {
      setError(t.platformAdmin.globalLimitsSaveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="platform-global-limits-title">
      <h2 id="platform-global-limits-title" className="platform-admin__section-title">
        {t.platformAdmin.globalLimitsTitle}
      </h2>
      <p className="platform-admin__boundary">{t.platformAdmin.globalLimitsHelp}</p>
      <Result ok={note} error={error} />
      {current === null ? (
        error ? (
          <button type="button" className="btn" onClick={() => void load()}>
            {t.platformAdmin.retry}
          </button>
        ) : (
          <p className="muted" role="status">
            {t.app.loading}
          </p>
        )
      ) : (
        <form
          className="platform-global-limit section"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="platform-global-limit__copy">
            <p className="platform-admin__eyebrow">{t.platformAdmin.globalLimitsDefaultEyebrow}</p>
            <h3>{t.platformAdmin.globalLimitsOwnershipTitle}</h3>
            <p>{t.platformAdmin.globalLimitsOwnershipHelp}</p>
          </div>
          <label htmlFor="global-ownership-limit" className="platform-global-limit__field">
            <span>{t.platformAdmin.userLimitLabel}</span>
            <input
              id="global-ownership-limit"
              className="field__input platform-limit-input"
              type="number"
              min="0"
              max={ORG_LIMITS.perOwnerMax}
              step="1"
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !dirty}
          >
            {busy ? t.platformAdmin.globalLimitsSaving : t.platformAdmin.globalLimitsSave}
          </button>
        </form>
      )}
    </section>
  );
}
