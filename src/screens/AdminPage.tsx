import type { User } from 'firebase/auth';

import { useI18n } from '../i18n/context';
import { ADMIN_TABS, navigate, type AdminTab } from '../lib/router';
import { Committee } from './admin/Committee';
import { Confirmation } from './admin/Confirmation';
import { Submission } from './admin/Submission';
import { Email } from './admin/Email';
import { Proposals } from './admin/Proposals';
import { Settings } from './admin/Settings';
import type { CfpRole } from '@shared/cfp';

/**
 * Five jobs that share nothing but an audience.
 *
 * They were one page once, and it was seven sections of scroll in which the
 * table worked through every day sat below a Resend API key set once a year.
 * Splitting them by tab rather than by collapsing sections keeps each one a
 * whole screen, and keeps its state from being mounted at all until asked for —
 * the proposals table and the email log are a query each.
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

  return (
    <>
      <nav className="subnav" aria-label={t.admin.sections}>
        {ADMIN_TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={`subnav__tab${name === tab ? ' subnav__tab--on' : ''}`}
            aria-current={name === tab ? 'page' : undefined}
            onClick={() => navigate('admin', { cfpId, tab: name })}
          >
            {t.admin.tabs[name]}
          </button>
        ))}
      </nav>

      {tab === 'proposals' && <Proposals cfpId={cfpId} />}
      {tab === 'committee' && <Committee user={user} cfpId={cfpId} />}
      {tab === 'settings' && <Settings cfpId={cfpId} role={role} />}
      {tab === 'submission' && <Submission cfpId={cfpId} />}
      {tab === 'confirmation' && <Confirmation cfpId={cfpId} />}
      {tab === 'email' && <Email cfpId={cfpId} cfpName={cfpName} />}
    </>
  );
}
