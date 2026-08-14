import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { TextField } from '../components/fields';
import { Link } from '../components/Link';
import { PlatformEmailDefaults } from '../components/PlatformEmailDefaults';
import { PlatformGlobalLimits } from '../components/PlatformGlobalLimits';
import { PlatformOrganizationLimits } from '../components/PlatformOrganizationLimits';
import { PlatformUserOrganizationLimits } from '../components/PlatformUserOrganizationLimits';
import { useI18n } from '../i18n/context';
import { platformAdminError, transferError } from '../lib/errors';
import { goTo } from '../lib/router';
import {
  acceptPlatformOwnershipTransfer,
  cancelPlatformOwnershipTransfer,
  grantPlatformAdmin,
  initiatePlatformOwnershipTransfer,
  listPlatformUsers,
  revokePlatformAdmin,
} from '../lib/roles';
import { useLatest } from '../lib/useLatest';
import type { PlatformAccessDirectory } from '@shared/platform';
import { Result } from './admin/Result';

type PlatformAdminSection = 'home' | 'access' | 'limits' | 'email';

export function PlatformAdminPage({
  user,
  section,
}: {
  user: User;
  section: PlatformAdminSection;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [directory, setDirectory] = useState<PlatformAccessDirectory | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [transferEmail, setTransferEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sectionDirty, setSectionDirty] = useState(false);
  const [globalLimitsDirty, setGlobalLimitsDirty] = useState(false);
  const [userLimitsDirty, setUserLimitsDirty] = useState(false);
  const [orgLimitsDirty, setOrgLimitsDirty] = useState(false);
  const [limitsRefreshKey, setLimitsRefreshKey] = useState(0);
  const generation = useRef(0);
  const sectionPanel = useRef<HTMLDivElement>(null);
  const sectionMounted = useRef(false);
  const sectionDirtyRef = useRef(false);
  const restoringHistory = useRef(false);
  sectionDirtyRef.current = sectionDirty;

  const refresh = useCallback(async (reportError = true) => {
    const request = ++generation.current;
    try {
      const { data } = await listPlatformUsers({});
      if (generation.current !== request) return false;
      setDirectory({
        members: data.members,
        pending: data.pending,
        pendingTransfer: data.pendingTransfer,
      });
      if (reportError) setError('');
      return true;
    } catch {
      if (generation.current !== request) return false;
      if (reportError) setError(tRef.current.platformAdmin.loadError);
      return false;
    }
  }, [tRef]);

  useEffect(() => {
    if (section !== 'access') return;
    generation.current += 1;
    setDirectory(null);
    setAdminEmail('');
    setBusy('');
    setError('');
    setNote('');
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, section, user.uid]);

  useEffect(() => {
    if (section !== 'home') return;
    if (window.location.hash === '#email-defaults') goTo('/platform/email');
    if (window.location.hash === '#organization-limits') goTo('/platform/limits');
    if (window.location.hash === '#access') goTo('/platform/access');
  }, [section]);

  useEffect(() => {
    setSectionDirty(
      section === 'limits' && (globalLimitsDirty || userLimitsDirty || orgLimitsDirty),
    );
  }, [globalLimitsDirty, orgLimitsDirty, section, userLimitsDirty]);

  useEffect(() => {
    if (sectionMounted.current) sectionPanel.current?.focus();
    else sectionMounted.current = true;
  }, [section]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!sectionDirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [sectionDirty]);

  useEffect(() => {
    const pagePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const allowLeaving = () => {
      sectionDirtyRef.current = false;
      setSectionDirty(false);
    };
    const confirmHistoryNavigation = () => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      if (!sectionDirtyRef.current) return;
      if (window.confirm(t.admin.unsaved)) {
        allowLeaving();
        return;
      }
      restoringHistory.current = true;
      goTo(pagePath);
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (
        !sectionDirtyRef.current ||
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

  async function initiateTransfer() {
    const target = transferEmail.trim();
    if (!window.confirm(t.transfer.confirmPrompt)) return;
    setBusy(`transfer:${target}`);
    setError('');
    setNote('');
    try {
      await initiatePlatformOwnershipTransfer({ email: target });
      setNote(tRef.current.transfer.pendingBanner(target));
      setTransferEmail('');
      await refresh(false);
    } catch (caught) {
      setError(transferError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  async function cancelTransfer() {
    setBusy('cancelTransfer');
    setError('');
    setNote('');
    try {
      await cancelPlatformOwnershipTransfer({});
      setNote(tRef.current.transfer.cancelled);
      await refresh(false);
    } catch (caught) {
      setError(transferError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  async function acceptTransfer() {
    setBusy('acceptTransfer');
    setError('');
    setNote('');
    try {
      await acceptPlatformOwnershipTransfer({});
      setNote(tRef.current.transfer.transferred);
      await refresh(false);
    } catch (caught) {
      setError(transferError(caught, tRef.current));
    } finally {
      setBusy('');
    }
  }

  const members = directory?.members ?? [];
  const pending = directory?.pending ?? [];
  const pendingTransfer = directory?.pendingTransfer;
  const owners = members.filter((member) => member.role === 'owner');
  const admins = members.filter((member) => member.role === 'admin');
  const pendingOwners = pending.filter((grant) => grant.role === 'owner');
  const pendingAdmins = pending.filter((grant) => grant.role === 'admin');
  const isOwner = owners.some((owner) => owner.uid === user.uid);
  const isTransferTarget =
    pendingTransfer &&
    ((user.email &&
      pendingTransfer.targetEmail.toLowerCase() === user.email.toLowerCase()) ||
      pendingTransfer.targetUid === user.uid);

  return (
    <div className="platform-admin">
      <header className="platform-admin__intro">
        <p className="platform-admin__eyebrow">{t.platformAdmin.eyebrow}</p>
        <h2>{t.platformAdmin.title}</h2>
        <p>{t.platformAdmin.intro}</p>
      </header>

      {isTransferTarget && (
        <section className="section section--highlight" style={{ marginBottom: '1.5rem' }}>
          <h3>{t.transfer.acceptTitle}</h3>
          <p>{t.transfer.acceptBanner(t.platformAdmin.roles.owner)}</p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void acceptTransfer()}
          >
            {busy === 'acceptTransfer' ? t.transfer.accepting : t.transfer.acceptButton}
          </button>
        </section>
      )}

      <nav className="subnav platform-admin__nav" aria-label={t.platformAdmin.sections}>
        <Link
          className={`subnav__tab${section === 'home' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'home' ? 'page' : undefined}
          to="/platform"
        >
          {t.platformAdmin.overviewNav}
        </Link>
        <Link
          className={`subnav__tab${section === 'access' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'access' ? 'page' : undefined}
          to="/platform/access"
        >
          {t.platformAdmin.accessNav}
        </Link>
        <Link
          className={`subnav__tab${section === 'limits' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'limits' ? 'page' : undefined}
          to="/platform/limits"
        >
          {t.platformAdmin.limitsNav}
        </Link>
        <Link
          className={`subnav__tab${section === 'email' ? ' subnav__tab--on' : ''}`}
          aria-current={section === 'email' ? 'page' : undefined}
          to="/platform/email"
        >
          {t.platformAdmin.emailDefaultsNav}
        </Link>
      </nav>

      {section === 'home' ? (
        <div ref={sectionPanel} className="platform-admin-hub" tabIndex={-1}>
          <header className="platform-admin-hub__header">
            <p className="platform-admin__eyebrow">{t.platformAdmin.overviewEyebrow}</p>
            <h2>{t.platformAdmin.overviewTitle}</h2>
            <p>{t.platformAdmin.overviewHelp}</p>
          </header>
          <div className="platform-admin-hub__cards">
            {([
              ['access', '/platform/access', t.platformAdmin.accessNav, t.platformAdmin.accessCardHelp],
              ['limits', '/platform/limits', t.platformAdmin.limitsNav, t.platformAdmin.limitsCardHelp],
              ['email', '/platform/email', t.platformAdmin.emailDefaultsNav, t.platformAdmin.emailCardHelp],
            ] as const).map(([key, to, title, help], index) => (
              <Link className="platform-admin-hub__card" to={to} key={key}>
                <span className="platform-admin-hub__number" aria-hidden="true">
                  0{index + 1}
                </span>
                <strong>{title}</strong>
                <span>{help}</span>
                <span className="platform-admin-hub__open">{t.platformAdmin.openSection} →</span>
              </Link>
            ))}
          </div>
        </div>
      ) : section === 'access' ? (
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
              <dl className="platform-role-guide">
                {(['owner', 'admin'] as const).map((role) => (
                  <div className="platform-role-guide__item" key={role}>
                    <dt>{t.platformAdmin.roles[role]}</dt>
                    <dd>{t.platformAdmin.roleHelp[role]}</dd>
                  </div>
                ))}
              </dl>

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
          ) : owners.length + admins.length + pending.length === 0 ? (
            <p className="muted">{t.platformAdmin.empty}</p>
          ) : (
            <ul className="people">
              {[...owners, ...admins].map((person) => (
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
                    {person.role === 'admin' && isOwner ? (
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
              {[...pendingOwners, ...pendingAdmins].map((grant) => (
                <li key={grant.email} className="people__row">
                  <span>
                    <strong>{grant.email}</strong>
                    <span className="people__meta">{t.platformAdmin.pending}</span>
                  </span>
                  <span className="people__actions">
                    <span className="people__meta people__meta--plain">
                      {t.platformAdmin.roles[grant.role]}
                    </span>
                    {grant.role === 'admin' && isOwner ? (
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
          {isOwner && (
            <>
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

              <section className="section platform-admin__grant">
                <h3>{t.platformAdmin.transferTitle}</h3>
                <p className="section__help">{t.platformAdmin.transferHelp}</p>

                {pendingTransfer ? (
                  <div className="pending-transfer-notice">
                    <p>{t.transfer.pendingBanner(pendingTransfer.targetEmail)}</p>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={Boolean(busy)}
                      onClick={() => void cancelTransfer()}
                    >
                      {busy === 'cancelTransfer'
                        ? t.transfer.cancelling
                        : t.transfer.cancelButton}
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void initiateTransfer();
                    }}
                  >
                    <TextField
                      label={t.transfer.emailLabel}
                      type="email"
                      value={transferEmail}
                      onChange={setTransferEmail}
                      required
                      disabled={Boolean(busy) || directory === null}
                    />
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={Boolean(busy) || directory === null || !transferEmail.trim()}
                    >
                      {busy === `transfer:${transferEmail.trim()}`
                        ? t.transfer.initiating
                        : t.transfer.initiateButton}
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
            </div>
          </div>

          <p className="platform-admin__boundary">{t.platformAdmin.accessHelp}</p>
          <Result ok={note} error={error} />
        </>
      ) : section === 'limits' ? (
        <div ref={sectionPanel} className="platform-limits-page" tabIndex={-1}>
          <header className="platform-limits-page__header">
            <h2>{t.platformAdmin.limitsTitle}</h2>
            <p>{t.platformAdmin.limitsHelp}</p>
          </header>
          <PlatformGlobalLimits
            onDirtyChange={setGlobalLimitsDirty}
            onSaved={() => setLimitsRefreshKey((current) => current + 1)}
          />
          <PlatformUserOrganizationLimits
            onDirtyChange={setUserLimitsDirty}
            refreshKey={limitsRefreshKey}
          />
          <PlatformOrganizationLimits onDirtyChange={setOrgLimitsDirty} />
        </div>
      ) : (
        <div
          id="email-defaults"
          ref={sectionPanel}
          tabIndex={-1}
          aria-labelledby="platform-email-defaults-title"
        >
          <PlatformEmailDefaults onDirtyChange={setSectionDirty} />
        </div>
      )}
    </div>
  );
}
