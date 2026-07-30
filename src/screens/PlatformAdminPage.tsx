import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { TextField } from '../components/fields';
import { useI18n } from '../i18n/context';
import { platformAdminError } from '../lib/errors';
import {
  grantCfpCreator,
  listPlatformUsers,
  revokeCfpCreator,
} from '../lib/roles';
import { useLatest } from '../lib/useLatest';
import type { PlatformAccessDirectory } from '@shared/platform';
import { Result } from './admin/Result';

export function PlatformAdminPage({ user }: { user: User }) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [directory, setDirectory] = useState<PlatformAccessDirectory | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const generation = useRef(0);

  const refresh = useCallback(async (reportError = true) => {
    const request = ++generation.current;
    try {
      const { data } = await listPlatformUsers({});
      if (generation.current !== request) return false;
      setDirectory({ members: data.members, pending: data.pending });
      if (reportError) setError('');
      return true;
    } catch {
      if (generation.current !== request) return false;
      if (reportError) setError(tRef.current.platformAdmin.loadError);
      return false;
    }
  }, [tRef]);

  useEffect(() => {
    generation.current += 1;
    setDirectory(null);
    setEmail('');
    setBusy('');
    setError('');
    setNote('');
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, user.uid]);

  async function grant() {
    const target = email.trim();
    setBusy(target);
    setError('');
    setNote('');
    try {
      const { data } = await grantCfpCreator({ email: target });
      setNote(
        data.applied
          ? tRef.current.platformAdmin.grantedActive(data.email)
          : tRef.current.platformAdmin.grantedPending(data.email),
      );
      setEmail('');
      await refresh(false);
    } catch (caught) {
      setError(platformAdminError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  async function revoke(target: string) {
    if (!window.confirm(t.platformAdmin.revokeConfirm(target))) return;
    setBusy(target);
    setError('');
    setNote('');
    try {
      const { data } = await revokeCfpCreator({ email: target });
      setNote(tRef.current.platformAdmin.revoked(data.email));
      await refresh(false);
    } catch (caught) {
      setError(platformAdminError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  const members = directory?.members ?? [];
  const pending = directory?.pending ?? [];
  const creators = members.filter((member) => member.role === 'creator');
  const admins = members.filter((member) => member.role === 'admin');
  const pendingCreators = pending.filter((grant) => grant.role === 'creator');
  const pendingAdmins = pending.filter((grant) => grant.role === 'admin');

  return (
    <div className="platform-admin">
      <header className="platform-admin__intro">
        <p className="platform-admin__eyebrow">{t.platformAdmin.eyebrow}</p>
        <h2>{t.platformAdmin.accessTitle}</h2>
        <p>{t.platformAdmin.intro}</p>
      </header>

      <div className="platform-admin__grid">
        <section className="section platform-admin__directory">
          <h3>{t.platformAdmin.activeTitle}</h3>
          <p className="section__help">{t.platformAdmin.activeHelp}</p>

          {directory === null ? (
            error ? (
              <button type="button" className="btn" onClick={() => void refresh()}>
                {t.platformAdmin.retry}
              </button>
            ) : (
              <p className="muted" role="status">
                {t.app.loading}
              </p>
            )
          ) : admins.length + creators.length + pending.length === 0 ? (
            <p className="muted">{t.platformAdmin.empty}</p>
          ) : (
            <ul className="people">
              {[...admins, ...creators].map((person) => (
                <li key={person.uid} className="people__row">
                  <span>
                    <strong>{person.name || person.email}</strong>
                    {person.name && <span className="people__meta">{person.email}</span>}
                    {person.uid === user.uid && (
                      <span className="people__meta">{t.platformAdmin.isYou}</span>
                    )}
                  </span>
                  <span className="people__actions">
                    <span className="people__meta people__meta--plain">
                      {t.platformAdmin.roles[person.role]}
                    </span>
                    {person.role === 'creator' && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revoke(person.email)}
                      >
                        {busy === person.email
                          ? t.platformAdmin.revoking
                          : t.platformAdmin.revoke}
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {[...pendingAdmins, ...pendingCreators].map((grant) => (
                <li key={grant.email} className="people__row">
                  <span>
                    <strong>{grant.email}</strong>
                    <span className="people__meta">{t.platformAdmin.pending}</span>
                  </span>
                  <span className="people__actions">
                    <span className="people__meta people__meta--plain">
                      {t.platformAdmin.roles[grant.role]}
                    </span>
                    {grant.role === 'creator' && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revoke(grant.email)}
                      >
                        {busy === grant.email
                          ? t.platformAdmin.revoking
                          : t.platformAdmin.revoke}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section platform-admin__grant">
          <h3>{t.platformAdmin.addTitle}</h3>
          <p className="section__help">{t.platformAdmin.addHelp}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void grant();
            }}
          >
            <TextField
              label={t.platformAdmin.emailLabel}
              type="email"
              value={email}
              onChange={setEmail}
              required
              disabled={Boolean(busy) || directory === null}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={Boolean(busy) || directory === null || !email.trim()}
            >
              {busy === email.trim() ? t.platformAdmin.granting : t.platformAdmin.grant}
            </button>
          </form>
        </section>
      </div>

      <p className="platform-admin__boundary">{t.platformAdmin.accessHelp}</p>
      <Result ok={note} error={error} />
    </div>
  );
}
