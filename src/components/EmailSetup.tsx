/**
 * Everything needed to get email sending, in the order it has to happen: key,
 * domain, addresses. Each step says whether it is done, because the failure
 * mode this replaces was a silent one — the pipeline queued perfectly and sent
 * nothing, and there was no screen that said why.
 */

import { useCallback, useEffect, useState } from 'react';

import { TextField } from './fields';
import { useI18n } from '../i18n/context';
import { resendError } from '../lib/errors';
import { emailDomain, setEmailSecret, type Domain } from '../lib/roles';

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
  onKeySet,
}: {
  cfpId: string;
  keyHint: string;
  domainId: string;
  onKeySet: (hint: string) => void;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const active = domains.find((d) => d.id === domainId) ?? domains[0];
  const verified = active?.status === 'verified';

  const refresh = useCallback(async () => {
    if (!keyHint) return;
    try {
      // At most one: `list` returns the domain this CFP registered and nothing
      // else, because the Resend account is shared across the whole platform.
      const { data } = await emailDomain({ cfpId, action: 'list' });
      setDomains(data.domains ?? []);
    } catch (e) {
      setError(resendError(e, t));
    }
  }, [cfpId, keyHint, t]);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId, keyHint]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setNote('');
    setError('');
    try {
      setNote(await fn());
    } catch (e) {
      setError(resendError(e, t));
    } finally {
      setBusy(false);
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
            disabled={busy}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || !apiKey.trim()}
          onClick={() =>
            run(async () => {
              const { data } = await setEmailSecret({ cfpId, apiKey: apiKey.trim() });
              // Out of the page as soon as it is stored; it is not ours to keep.
              setApiKey('');
              onKeySet(data.keyHint);
              await refresh();
              return t.admin.emailKeySaved;
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
        ) : !active ? (
          <>
            <div className="grid grid--2">
              <TextField
                label={t.admin.emailDomainLabel}
                required
                value={name}
                onChange={setName}
                disabled={busy}
              />
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  await emailDomain({ cfpId, action: 'add', domain: name.trim() });
                  await refresh();
                  return t.admin.emailDomainAdded;
                })
              }
            >
              {t.admin.emailDomainAdd}
            </button>
          </>
        ) : (
          <>
            <p className={verified ? 'note note--inline' : 'muted'}>
              <strong>{active.name}</strong> — {t.admin.emailDomainStatus[active.status] ?? active.status}
            </p>

            {!verified && active.records.length > 0 && (
              <>
                <p className="field__help">{t.admin.emailDnsHelp}</p>
                <div className="table__scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.admin.emailDnsType}</th>
                        <th>{t.admin.emailDnsName}</th>
                        <th>{t.admin.emailDnsValue}</th>
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

            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { data } = await emailDomain({ cfpId, action: 'verify' });
                  await refresh();
                  return data.domain?.status === 'verified'
                    ? t.admin.emailDomainVerified
                    : t.admin.emailDomainChecking;
                })
              }
            >
              {t.admin.emailDomainVerify}
            </button>
          </>
        )}
      </Step>

      {note && <p className="note note--inline">{note}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
