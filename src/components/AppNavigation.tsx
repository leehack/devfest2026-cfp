import type { Dictionary } from '../i18n';
import { useI18n } from '../i18n/context';
import { href, type Place, type Route } from '../lib/router';
import { Link } from './Link';
import type { CfpRole } from '@shared/cfp';

type EventRoute = Extract<Route, 'cfp' | 'form' | 'review' | 'admin'>;

function taskLabel(place: Place, t: Dictionary): string {
  if (place.route === 'new') return t.platform.createTitle;
  if (place.route === 'me') return t.profile.title;
  if (place.route === 'cfp') return t.nav.cfp;
  if (place.route === 'form') return t.nav.form;
  if (place.route === 'review') return t.nav.review;
  if (place.route === 'admin') return t.admin.tabs[place.tab];
  return t.app.title;
}

export function headerTitle(place: Place, cfpName: string | null, t: Dictionary): string {
  if (place.cfpId) return cfpName ?? t.app.title;
  return taskLabel(place, t);
}

export function documentTitle(place: Place, cfpName: string | null, t: Dictionary): string {
  if (place.route === 'home') return t.app.title;
  if (!place.cfpId || !cfpName) return `${taskLabel(place, t)} — ${t.app.title}`;
  if (place.route === 'cfp') return cfpName;
  return `${taskLabel(place, t)} — ${cfpName} — ${t.app.title}`;
}

/**
 * The location hierarchy stays visible even when a role-specific workspace is
 * deep enough to have navigation of its own. Ancestors are real links; the
 * current task is text, so the trail never offers a link back to itself.
 */
export function AppBreadcrumb({ place, cfpName }: { place: Place; cfpName: string | null }) {
  const { t } = useI18n();
  if (place.route === 'home') return null;

  const insideCfp = Boolean(place.cfpId && cfpName);
  return (
    <nav className="breadcrumb" aria-label={t.nav.breadcrumb}>
      <ol className="breadcrumb__list">
        <li>
          <Link to={href({ route: 'home' })}>{t.platform.back}</Link>
        </li>
        {insideCfp && place.route !== 'cfp' && (
          <li>
            <Link to={href({ route: 'cfp', cfpId: place.cfpId! })}>{cfpName}</Link>
          </li>
        )}
        {insideCfp && place.route === 'admin' && place.tab !== 'overview' && (
          <li>
            <Link to={href({ route: 'admin', cfpId: place.cfpId!, tab: 'overview' })}>
              {t.nav.admin}
            </Link>
          </li>
        )}
        <li>
          <span aria-current="page">
            {insideCfp && place.route === 'cfp' ? cfpName : taskLabel(place, t)}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * One event map for every audience. Event details and proposals are always
 * present; committee work appears only after the existing role lookup says it
 * belongs to this account.
 */
export function EventNavigation({
  place,
  cfpName,
  role,
}: {
  place: Place;
  cfpName: string;
  role: CfpRole | null;
}) {
  const { t } = useI18n();
  const tabs: Array<{ route: EventRoute; label: string }> = [
    { route: 'cfp', label: t.nav.cfp },
    { route: 'form', label: t.nav.form },
  ];
  if (role) tabs.push({ route: 'review', label: t.nav.review });
  if (role === 'admin' || role === 'owner') {
    tabs.push({ route: 'admin', label: t.nav.admin });
  }

  return (
    <nav className="nav" aria-label={`${cfpName}: ${t.nav.eventSections}`}>
      {tabs.map(({ route, label }) => (
        <Link
          key={route}
          to={href({ route, cfpId: place.cfpId! })}
          className={`nav__tab${route === place.route ? ' nav__tab--on' : ''}`}
          aria-current={
            route !== place.route
              ? undefined
              : route === 'admin' && place.tab !== 'overview'
                ? 'location'
                : 'page'
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
