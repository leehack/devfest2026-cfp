import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { TextField } from '../components/fields';
import { PlatformEmailDefaults } from '../components/PlatformEmailDefaults';
import { useI18n } from '../i18n/context';
import { platformAdminError } from '../lib/errors';
import { goTo } from '../lib/router';
import {
  grantCfpCreator,
  grantPlatformAdmin,
  listPlatformUsers,
  revokeCfpCreator,
  revokePlatformAdmin,
} from '../lib/roles';
import { useLatest } from '../lib/useLatest';
import type { PlatformAccessDirectory } from '@shared/platform';
import { Result } from './admin/Result';

export function PlatformAdminPage({ user }: { user: User }) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [directory, setDirectory] = useState<PlatformAccessDirectory | null>(null);
  const [email, setEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [emailDirty, setEmailDirty] = useState(false);
  // The server cannot see a fragment. Settle it after mount so a direct
  // `/platform#email-defaults` visit hydrates the same Access view it rendered.
  const [section, setSection] = useState<'access' | 'email'>('access');
  const generation = useRef(0);
  const sectionPanel = useRef<HTMLDivElement>(null);
  const sectionMounted = useRef(false);
  const emailDirtyRef = useRef(false);
  const allowedHashChange = useRef(false);
  const restoringHistory = useRef(false);
  emailDirtyRef.current = emailDirty;

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
    setAdminEmail('');
    setBusy('');
    setError('');
    setNote('');
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, user.uid]);

  useEffect(() => {
    let previousHash = window.location.hash;
    const selectHash = () => {
      const nextSection = window.location.hash === '#email-defaults' ? 'email' : 'access';
      if (allowedHashChange.current) {
        allowedHashChange.current = false;
      } else if (
        nextSection !== section &&
        emailDirtyRef.current &&
        !window.confirm(t.admin.unsaved)
      ) {
        window.history.replaceState(null, '', `/platform${previousHash || '#access'}`);
        return;
      }
      previousHash = window.location.hash;
      if (nextSection !== section) setEmailDirty(false);
      setSection(nextSection);
    };
    selectHash();
    window.addEventListener('hashchange', selectHash);
    return () => window.removeEventListener('hashchange', selectHash);
  }, [section, t.admin.unsaved]);

  useEffect(() => {
    if (sectionMounted.current) sectionPanel.current?.focus();
    else sectionMounted.current = true;
  }, [section]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!emailDirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [emailDirty]);

  useEffect(() => {
    const pagePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const allowLeaving = () => {
      emailDirtyRef.current = false;
      setEmailDirty(false);
    };
    const confirmHistoryNavigation = () => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      if (!emailDirtyRef.current) return;
      if (window.confirm(t.admin.unsaved)) {
        allowLeaving();
        return;
      }
      restoringHistory.current = true;
      goTo(pagePath);
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (
        !emailDirtyRef.current ||
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
      if (window.confirm(t.admin.unsaved)) {
        allowLeaving();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('popstate', confirmHistoryNavigation);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('popstate', confirmHistoryNavigation);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [t.admin.unsaved]);

  function changeSection(event: React.MouseEvent<HTMLAnchorElement>, next: 'access' | 'email') {
    if (next === section) return;
    if (emailDirty && !window.confirm(t.admin.unsaved)) {
      event.preventDefault();
      return;
    }
    allowedHashChange.current = true;
    setEmailDirty(false);
  }

  async function grant() {
    const target = email.trim();
    setBusy(`creator:${target}`);
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
    setBusy(`creator:${target}`);
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

  async function grantAdmin() {
    const target = adminEmail.trim();
    setBusy(`admin:${target}`);
    setError('');
    setNote('');
    try {
      const { data } = await grantPlatformAdmin({ email: target });
      setNote(
        data.applied
          ? tRef.current.platformAdmin.adminGrantedActive(data.email)
          : tRef.current.platformAdmin.adminGrantedPending(data.email),
      );
      setAdminEmail('');
      await refresh(false);
    } catch (caught) {
      setError(platformAdminError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  async function revokeAdmin(target: string) {
    if (!window.confirm(t.platformAdmin.adminRevokeConfirm(target))) return;
    setBusy(`admin:${target}`);
    setError('');
    setNote('');
    try {
      const { data } = await revokePlatformAdmin({ email: target });
      setNote(tRef.current.platformAdmin.adminRevoked(data.email));
      await refresh(false);
    } catch (caught) {
      setError(platformAdminError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  const members = directory?.members ?? [];
  const pending = directory?.pending ?? [];
  const owners = members.filter((member) => member.role === 'owner');
  const creators = members.filter((member) => member.role === 'creator');
  const admins = members.filter((member) => member.role === 'admin');
  const pendingOwners = pending.filter((grant) => grant.role === 'owner');
  const pendingCreators = pending.filter((grant) => grant.role === 'creator');
  const pendingAdmins = pending.filter((grant) => grant.role === 'admin');
  const isOwner = owners.some((owner) => owner.uid === user.uid);

  return (
    <div className="platform-admin">
      <header className="platform-admin__intro">
        <p className="platform-admin__eyebrow">{t.platformAdmin.eyebrow}</p>
        <h2>{t.platformAdmin.title}</h2>
        <p>{t.platformAdmin.intro}</p>
      </header>

      <nav className="subnav platform-admin__nav" aria-label={t.platformAdmin.sections}>
        <a
          className={`subnav__tab${section === 'access' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'access' ? 'page' : undefined}
          href="#access"
          onClick={(event) => changeSection(event, 'access')}
        >
          {t.platformAdmin.accessNav}
        </a>
        <a
          className={`subnav__tab${section === 'email' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'email' ? 'page' : undefined}
          href="#email-defaults"
          onClick={(event) => changeSection(event, 'email')}
        >
          {t.platformAdmin.emailDefaultsNav}
        </a>
      </nav>

      {section === 'access' ? (
        <>
          <h2 id="platform-access-title" className="platform-admin__section-title">
            {t.platformAdmin.accessTitle}
          </h2>
          <div
            id="access"
            ref={sectionPanel}
            className="platform-admin__grid"
            tabIndex={-1}
            aria-labelledby="platform-access-title"
          >
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
          ) : owners.length + admins.length + creators.length + pending.length === 0 ? (
            <p className="muted">{t.platformAdmin.empty}</p>
          ) : (
            <ul className="people">
              {[...owners, ...admins, ...creators].map((person) => (
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
                    {person.role === 'creator' ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revoke(person.email)}
                      >
                        {busy === `creator:${person.email}`
                          ? t.platformAdmin.revoking
                          : t.platformAdmin.revoke}
                      </button>
                    ) : person.role === 'admin' && isOwner ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revokeAdmin(person.email)}
                      >
                        {busy === `admin:${person.email}`
                          ? t.platformAdmin.adminRevoking
                          : t.platformAdmin.adminRevoke}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
              {[...pendingOwners, ...pendingAdmins, ...pendingCreators].map((grant) => (
                <li key={grant.email} className="people__row">
                  <span>
                    <strong>{grant.email}</strong>
                    <span className="people__meta">{t.platformAdmin.pending}</span>
                  </span>
                  <span className="people__actions">
                    <span className="people__meta people__meta--plain">
                      {t.platformAdmin.roles[grant.role]}
                    </span>
                    {grant.role === 'creator' ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revoke(grant.email)}
                      >
                        {busy === `creator:${grant.email}`
                          ? t.platformAdmin.revoking
                          : t.platformAdmin.revoke}
                      </button>
                    ) : grant.role === 'admin' && isOwner ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void revokeAdmin(grant.email)}
                      >
                        {busy === `admin:${grant.email}`
                          ? t.platformAdmin.adminRevoking
                          : t.platformAdmin.adminRevoke}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
            </section>

            <div className="platform-admin__controls">
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
                {busy === `creator:${email.trim()}`
                  ? t.platformAdmin.granting
                  : t.platformAdmin.grant}
              </button>
            </form>
              </section>

          {isOwner && (
            <section className="section platform-admin__grant">
              <h3>{t.platformAdmin.adminAddTitle}</h3>
              <p className="section__help">{t.platformAdmin.adminAddHelp}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void grantAdmin();
                }}
              >
                <TextField
                  label={t.platformAdmin.adminEmailLabel}
                  type="email"
                  value={adminEmail}
                  onChange={setAdminEmail}
                  required
                  disabled={Boolean(busy) || directory === null}
                />
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={Boolean(busy) || directory === null || !adminEmail.trim()}
                >
                  {busy === `admin:${adminEmail.trim()}`
                    ? t.platformAdmin.adminGranting
                    : t.platformAdmin.adminGrant}
                </button>
              </form>
            </section>
          )}
            </div>
          </div>

          <p className="platform-admin__boundary">{t.platformAdmin.accessHelp}</p>
          <Result ok={note} error={error} />
        </>
      ) : (
        <div
          id="email-defaults"
          ref={sectionPanel}
          tabIndex={-1}
          aria-labelledby="platform-email-defaults-title"
        >
          <PlatformEmailDefaults onDirtyChange={setEmailDirty} />
        </div>
      )}
    </div>
  );
}
