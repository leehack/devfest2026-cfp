/**
 * Everything needed to get email sending, in the order it has to happen: key,
 * domain, addresses. Each step says whether it is done, because the failure
 * mode this replaces was a silent one — the pipeline queued perfectly and sent
 * nothing, and there was no screen that said why.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { TextField } from './fields';
import { useI18n } from '../i18n/context';
import { resendError } from '../lib/errors';
import { emailDomain, setEmailSecret, type Domain } from '../lib/roles';
import { useLatest } from '../lib/useLatest';

/** Numbered, because the order is the only part of this that is not obvious. */
function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="steps">
      {items.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className={`step ${done ? 'step--done' : ''}`}>
      <h4 className="step__title">
        <span className="step__mark" aria-hidden="true">
          {done ? '✓' : '•'}
        </span>
        {title}
      </h4>
      {children}
    </div>
  );
}

export function EmailSetup({
  cfpId,
  keyHint,
  domainId,
  readOnly = false,
  onKeySet,
  onDomainChanged,
  onDirtyChange,
}: {
  cfpId: string;
  keyHint: string;
  domainId: string;
  readOnly?: boolean;
  onKeySet: (hint: string) => void;
  onDomainChanged?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [apiKey, setApiKey] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const activeCfp = useRef(cfpId);
  const refreshGeneration = useRef(0);
  activeCfp.current = cfpId;
  const dirty = !readOnly && (apiKey !== '' || name !== '');

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const active = domains.find((d) => d.id === domainId) ?? domains[0];
  const verified = active?.status === 'verified';

  const refresh = useCallback(async () => {
    const scope = cfpId;
    const generation = ++refreshGeneration.current;
    const current = () =>
      activeCfp.current === scope && refreshGeneration.current === generation;
    if (!keyHint) {
      if (current()) setDomains([]);
      return;
    }
    try {
      // At most one: `list` returns the domain this CFP registered and nothing
      // else, because the Resend account is shared across the whole platform.
      const { data } = await emailDomain({ cfpId, action: 'list' });
      if (current()) setDomains(data.domains ?? []);
    } catch (e) {
      if (current()) setError(resendError(e, tRef.current));
    }
  }, [cfpId, keyHint, tRef]);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    refreshGeneration.current += 1;
    setApiKey('');
    setDomains([]);
    setName('');
    setChanging(false);
    setBusy(false);
    setNote('');
    setError('');
    void refresh();
  }, [cfpId, keyHint, refresh]);

  async function run(fn: (current: () => boolean) => Promise<string>) {
    if (readOnly) return;
    const scope = cfpId;
    const current = () => activeCfp.current === scope;
    setBusy(true);
    setNote('');
    setError('');
    try {
      const nextNote = await fn(current);
      if (current()) setNote(nextNote);
    } catch (e) {
      if (current()) setError(resendError(e, tRef.current));
    } finally {
      if (current()) setBusy(false);
    }
  }

  return (
    <div className="setup">
      <Step done={Boolean(keyHint)} title={t.admin.emailStepKey}>
        <p className="field__help">{t.admin.emailKeyHelp}</p>
        <Steps items={t.admin.emailKeySteps} />
        <p>
          <a className="link" href="https://resend.com/api-keys" target="_blank" rel="noreferrer">
            {t.admin.emailKeyLink}
          </a>
        </p>
        {keyHint && <p className="muted">{t.admin.emailKeySet.replace('{hint}', keyHint)}</p>}
        <div className="grid grid--2">
          <TextField
            label={t.admin.emailKeyLabel}
            type="password"
            required
            value={apiKey}
            onChange={setApiKey}
            disabled={busy || readOnly}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || readOnly || !apiKey.trim()}
          onClick={() =>
            run(async (current) => {
              const { data } = await setEmailSecret({ cfpId, apiKey: apiKey.trim() });
              if (!current()) return '';
              // Out of the page as soon as it is stored; it is not ours to keep.
              setApiKey('');
              onKeySet(data.keyHint);
              await refresh();
              return current() ? tRef.current.admin.emailKeySaved : '';
            })
          }
        >
          {keyHint ? t.admin.emailKeyReplace : t.admin.emailKeySave}
        </button>
      </Step>

      <Step done={verified} title={t.admin.emailStepDomain}>
        <p className="field__help">{t.admin.emailDomainHelp}</p>
        <Steps items={t.admin.emailDomainSteps} />

        {!keyHint ? (
          <p className="muted">{t.admin.emailKeyFirst}</p>
        ) : !active || changing ? (
          <>
            <div className="grid grid--2">
              <TextField
                label={t.admin.emailDomainLabel}
                required
                value={name}
                onChange={setName}
                disabled={busy || readOnly}
              />
            </div>
            <div className="row row--wrap">
              <button
                type="button"
                className="btn"
                disabled={busy || readOnly || !name.trim()}
                onClick={() =>
                  run(async (current) => {
                    await emailDomain({ cfpId, action: 'add', domain: name.trim() });
                    if (!current()) return '';
                    setName('');
                    setChanging(false);
                    await refresh();
                    if (!current()) return '';
                    await onDomainChanged?.();
                    return current() ? tRef.current.admin.emailDomainAdded : '';
                  })
                }
              >
                {t.admin.emailDomainAdd}
              </button>
              {active && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => {
                    setName('');
                    setChanging(false);
                  }}
                >
                  {t.form.answersCancel}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className={verified ? 'note note--inline email-domain__state' : 'muted email-domain__state'}>
              <strong>{active.name}</strong> — {t.admin.emailDomainStatus[active.status] ?? active.status}
            </p>

            {!verified && active.records.length > 0 && (
              <>
                <p className="field__help">{t.admin.emailDnsHelp}</p>
                <div
                  className="table__scroll"
                  role="region"
                  aria-label={t.admin.emailDnsRecords}
                  tabIndex={0}
                >
                  <table className="table table--dns">
                    <thead>
                      <tr>
                        <th scope="col">{t.admin.emailDnsType}</th>
                        <th scope="col">{t.admin.emailDnsName}</th>
                        <th scope="col">{t.admin.emailDnsValue}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.records.map((r, i) => (
                        <tr key={`${r.type}-${r.name}-${i}`}>
                          <td>{r.type}</td>
                          <td className="mono">{r.name}</td>
                          <td className="mono mono--wrap">
                            {r.value}
                            {r.priority !== undefined && ` (priority ${r.priority})`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="row row--wrap">
              <button
                type="button"
                className="btn"
                disabled={busy || readOnly}
                onClick={() =>
                  run(async (current) => {
                    const { data } = await emailDomain({ cfpId, action: 'verify' });
                    if (!current()) return '';
                    await refresh();
                    if (!current()) return '';
                    return data.domain?.status === 'verified'
                      ? tRef.current.admin.emailDomainVerified
                      : tRef.current.admin.emailDomainChecking;
                  })
                }
              >
                {t.admin.emailDomainVerify}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || readOnly}
                onClick={() => {
                  setName('');
                  setChanging(true);
                }}
              >
                {t.consent.change}
              </button>
            </div>
          </>
        )}
      </Step>

      <div
        className={note ? 'note note--inline' : undefined}
        role="status"
        aria-atomic="true"
      >
        {note}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
