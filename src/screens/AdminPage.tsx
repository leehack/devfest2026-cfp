import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { Link } from '../components/Link';
import { useI18n } from '../i18n/context';
import { ADMIN_TABS, goTo, href, type AdminTab } from '../lib/router';
import { emailQueue } from '../lib/roles';
import { Committee } from './admin/Committee';
import { Confirmation } from './admin/Confirmation';
import { Submission } from './admin/Submission';
import { Email } from './admin/Email';
import { Overview } from './admin/Overview';
import { Proposals } from './admin/Proposals';
import { Settings } from './admin/Settings';
import type { CfpRole } from '@shared/cfp';

interface PendingEmailState {
  cfpId: string;
  count: number | null;
  failed: boolean;
}

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingEmailState, setPendingEmailState] = useState<PendingEmailState | null>(null);
  const dirtyRef = useRef(dirty);
  const restoringHistory = useRef(false);
  const queueRequest = useRef(0);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  dirtyRef.current = dirty;
  const pendingEmailCount =
    pendingEmailState?.cfpId === cfpId ? pendingEmailState.count : null;
  const pendingEmailCheckFailed =
    pendingEmailState?.cfpId === cfpId && pendingEmailState.failed;

  const publishPendingEmailCount = useCallback(
    (count: number) => {
      queueRequest.current += 1;
      setPendingEmailState({ cfpId, count, failed: false });
    },
    [cfpId],
  );

  const refreshPendingEmails = useCallback(async () => {
    const request = ++queueRequest.current;
    try {
      const { data } = await emailQueue({ cfpId, action: 'summary' });
      if (request !== queueRequest.current) return;
      setPendingEmailState({ cfpId, count: data.waiting ?? 0, failed: false });
    } catch {
      if (request !== queueRequest.current) return;
      setPendingEmailState((current) => ({
        cfpId,
        count: current?.cfpId === cfpId ? current.count : null,
        failed: true,
      }));
    }
  }, [cfpId]);

  useEffect(() => {
    void refreshPendingEmails();
    return () => {
      queueRequest.current += 1;
    };
  }, [refreshPendingEmails, tab]);

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

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = mobileMenu.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
      setMobileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = mobileMenu.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault();
      setMobileMenuOpen(false);
      menu.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => setMobileMenuOpen(false), [cfpId, tab]);

  return (
    <>
      <header className="admin-shell-header">
        <div>
          <p className="admin-shell-header__eyebrow">{t.admin.workspace}</p>
          <h2 className="admin-shell-header__title">{t.admin.tabs[tab]}</h2>
        </div>
        <span className="admin-shell-header__role">{t.enums.role[role]}</span>
      </header>

      <nav className="admin-section-menu" aria-label={t.admin.sections}>
        <details
          key={tab}
          ref={mobileMenu}
          open={mobileMenuOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setMobileMenuOpen(open);
            if (open) {
              const nav = event.currentTarget.closest('nav');
              if (nav) {
                const stickyTop = Number.parseFloat(getComputedStyle(nav).top) || 0;
                window.scrollTo({
                  top: window.scrollY + nav.getBoundingClientRect().top - stickyTop,
                });
              }
            }
          }}
        >
          <summary
            role="button"
            aria-expanded={mobileMenuOpen}
            aria-label={`${t.admin.sectionPicker}: ${t.admin.tabs[tab]}`}
            aria-describedby={pendingEmailCount ? 'admin-section-pending-email' : undefined}
          >
            <span className="admin-section-menu__current">
              <span className="admin-section-menu__label">{t.admin.sectionPicker}</span>
              <strong>{t.admin.tabs[tab]}</strong>
            </span>
            {pendingEmailCount ? (
              <>
                <span className="subnav__badge" aria-hidden="true">
                  {pendingEmailCount}
                </span>
                <span className="visually-hidden" id="admin-section-pending-email">
                  {t.admin.pendingEmailTabLabel(pendingEmailCount)}
                </span>
              </>
            ) : null}
          </summary>
          <ul className="admin-section-menu__list">
            {ADMIN_TABS.map((name) => {
              const content = (
                <>
                  <span>{t.admin.tabs[name]}</span>
                  {name === 'email' && pendingEmailCount ? (
                    <span className="subnav__badge" aria-hidden="true">
                      {pendingEmailCount}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li key={name}>
                  {name === tab ? (
                    <span
                      className="admin-section-menu__link admin-section-menu__link--on"
                      aria-current="page"
                    >
                      {content}
                    </span>
                  ) : (
                    <Link
                      to={href({ route: 'admin', cfpId, tab: name })}
                      className="admin-section-menu__link"
                      aria-label={
                        name === 'email' && pendingEmailCount
                          ? t.admin.pendingEmailTabLabel(pendingEmailCount)
                          : undefined
                      }
                    >
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      </nav>

      <nav className="subnav" aria-label={t.admin.sections}>
        {ADMIN_TABS.map((name) => (
          <Link
            key={name}
            to={href({ route: 'admin', cfpId, tab: name })}
            className={`subnav__tab${name === tab ? ' subnav__tab--on' : ''}`}
            aria-current={name === tab ? 'page' : undefined}
            aria-label={
              name === 'email' && pendingEmailCount
                ? t.admin.pendingEmailTabLabel(pendingEmailCount)
                : undefined
            }
          >
            <span>{t.admin.tabs[name]}</span>
            {name === 'email' && pendingEmailCount ? (
              <span className="subnav__badge" aria-hidden="true">
                {pendingEmailCount}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab !== 'email' && pendingEmailCount !== null && pendingEmailCount > 0 && (
        <section
          className="pending-email-notice"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="pending-email-notice__count" aria-hidden="true">
            <strong>{pendingEmailCount}</strong>
            <span>{t.admin.pendingEmailShort}</span>
          </div>
          <div className="pending-email-notice__copy">
            <p className="pending-email-notice__eyebrow">{t.admin.pendingEmailEyebrow}</p>
            <h3>{t.admin.pendingEmailTitle(pendingEmailCount)}</h3>
            <p>{t.admin.pendingEmailHelp}</p>
          </div>
          <Link
            className="btn btn--primary pending-email-notice__action"
            to={href({ route: 'admin', cfpId, tab: 'email' })}
          >
            {t.admin.pendingEmailReview}
          </Link>
        </section>
      )}

      {tab !== 'email' &&
        pendingEmailCheckFailed &&
        (pendingEmailCount === null || pendingEmailCount === 0) && (
          <section className="pending-email-notice pending-email-notice--unknown" role="alert">
            <div className="pending-email-notice__copy">
              <h3>{t.admin.pendingEmailUnknownTitle}</h3>
              <p>{t.admin.pendingEmailUnknownHelp}</p>
            </div>
            <Link
              className="btn pending-email-notice__action"
              to={href({ route: 'admin', cfpId, tab: 'email' })}
            >
              {t.admin.pendingEmailReview}
            </Link>
          </section>
        )}

      {tab === 'overview' && <Overview cfpId={cfpId} />}
      {tab === 'proposals' && (
        <Proposals
          cfpId={cfpId}
          pendingEmailCount={pendingEmailCount}
          pendingEmailCheckFailed={pendingEmailCheckFailed}
          onEmailQueueChange={refreshPendingEmails}
        />
      )}
      {tab === 'committee' && <Committee user={user} cfpId={cfpId} />}
      {tab === 'settings' && (
        <Settings cfpId={cfpId} role={role} onDirtyChange={setDirty} />
      )}
      {tab === 'submission' && <Submission cfpId={cfpId} onDirtyChange={setDirty} />}
      {tab === 'confirmation' && <Confirmation cfpId={cfpId} onDirtyChange={setDirty} />}
      {tab === 'email' && (
        <Email
          cfpId={cfpId}
          cfpName={cfpName}
          onDirtyChange={setDirty}
          onPendingChange={publishPendingEmailCount}
        />
      )}
    </>
  );
}
