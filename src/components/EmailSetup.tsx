/**
 * Everything needed to get email sending, in the order it has to happen: key,
 * domain, addresses. Each step says whether it is done, because the failure
 * mode this replaces was a silent one — the pipeline queued perfectly and sent
 * nothing, and there was no screen that said why.
 */

import { useCallback, useEffect, useState } from 'react';

import { TextField } from './fields';
import { useI18n } from '../i18n';
import { adminError } from '../lib/errors';
import { emailDomain, setEmailSecret, type Domain } from '../lib/roles';

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
  keyHint,
  domainId,
  onKeySet,
}: {
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
      const { data } = await emailDomain({ action: 'list' });
      const found = data.domains ?? [];
      // The list endpoint omits the DNS records, and those are the whole point
      // of this panel — so fetch the active one in full.
      const target = found.find((d) => d.id === domainId) ?? found[0];
      if (target) {
        const { data: full } = await emailDomain({ action: 'get', domainId: target.id });
        setDomains(found.map((d) => (d.id === target.id && full.domain ? full.domain : d)));
      } else {
        setDomains(found);
      }
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [domainId, keyHint, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setNote('');
    setError('');
    try {
      setNote(await fn());
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <Step done={Boolean(keyHint)} title={t.admin.emailStepKey}>
        <p className="field__help">{t.admin.emailKeyHelp}</p>
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
              const { data } = await setEmailSecret({ apiKey: apiKey.trim() });
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
                  await emailDomain({ action: 'add', domain: name.trim() });
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
                  const { data } = await emailDomain({ action: 'verify', domainId: active.id });
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
