import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { Link } from '../components/Link';
import { useI18n } from '../i18n/context';
import { ADMIN_TABS, goTo, href, type AdminTab } from '../lib/router';
import { Committee } from './admin/Committee';
import { Confirmation } from './admin/Confirmation';
import { Submission } from './admin/Submission';
import { Email } from './admin/Email';
import { Overview } from './admin/Overview';
import { Proposals } from './admin/Proposals';
import { Settings } from './admin/Settings';
import type { CfpRole } from '@shared/cfp';

/**
 * The overview links seven organiser jobs without mounting their data-heavy
 * screens. Each job keeps its own URL, so a stuck email queue or submission
 * form can be linked to directly.
 */
export function AdminPage({
  user,
  cfpId,
  cfpName,
  tab,
  role,
}: {
  user: User;
  cfpId: string;
  cfpName: string;
  tab: AdminTab;
  role: CfpRole;
}) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  const restoringHistory = useRef(false);
  const subnav = useRef<HTMLElement>(null);
  dirtyRef.current = dirty;

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 41.99rem)');
    const revealActiveTab = () => {
      if (!mobile.matches) return;
      subnav.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    };

    revealActiveTab();
    mobile.addEventListener('change', revealActiveTab);
    return () => mobile.removeEventListener('change', revealActiveTab);
  }, [tab]);

  useEffect(() => {
    const pagePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const allowLeaving = () => {
      dirtyRef.current = false;
      setDirty(false);
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmHistoryNavigation = () => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      if (!dirtyRef.current) return;
      if (window.confirm(t.admin.unsaved)) {
        allowLeaving();
        return;
      }

      // History has already moved when popstate fires. Put this admin screen
      // back synchronously so App finishes the event on the editor the
      // organiser chose to keep.
      restoringHistory.current = true;
      goTo(pagePath);
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
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

    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('popstate', confirmHistoryNavigation);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('popstate', confirmHistoryNavigation);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [cfpId, t.admin.unsaved, tab]);

  return (
    <>
      <header className="admin-shell-header">
        <div>
          <p className="admin-shell-header__eyebrow">{t.admin.workspace}</p>
          <h2 className="admin-shell-header__title">{cfpName}</h2>
        </div>
        <span className="admin-shell-header__role">{t.enums.role[role]}</span>
      </header>

      <nav className="subnav" aria-label={t.admin.sections} ref={subnav}>
        {ADMIN_TABS.map((name) => (
          <Link
            key={name}
            to={href({ route: 'admin', cfpId, tab: name })}
            className={`subnav__tab${name === tab ? ' subnav__tab--on' : ''}`}
            aria-current={name === tab ? 'page' : undefined}
          >
            {t.admin.tabs[name]}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <Overview cfpId={cfpId} />}
      {tab === 'proposals' && <Proposals cfpId={cfpId} />}
      {tab === 'committee' && <Committee user={user} cfpId={cfpId} />}
      {tab === 'settings' && (
        <Settings cfpId={cfpId} role={role} onDirtyChange={setDirty} />
      )}
      {tab === 'submission' && <Submission cfpId={cfpId} onDirtyChange={setDirty} />}
      {tab === 'confirmation' && <Confirmation cfpId={cfpId} onDirtyChange={setDirty} />}
      {tab === 'email' && (
        <Email cfpId={cfpId} cfpName={cfpName} onDirtyChange={setDirty} />
      )}
    </>
  );
}
