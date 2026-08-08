import { useEffect, useState } from 'react';

import { ADMIN_TABS, isAdminTab, type AdminTab } from './adminTabs';
import { paths } from './paths';
import { validateCfpId } from '@shared/cfp';

// Re-exported so the 20-odd existing importers do not all have to move at once.
export { ADMIN_TABS };
export type { AdminTab };
export { pageShape } from './pageShape';

/**
 * Path routing, in a hundred lines, because this is a small tool.
 *
 * It used to be the hash, so that nothing depended on the server rewriting
 * unknown URLs. That reason expired: a call for proposals is a public page now,
 * and everything that reads a URL from the outside — a crawler, a link preview
 * in Slack, a canonical tag — is blind to what comes after the `#`.
 *
 * This still owns navigation inside the app. The framework routes to a single
 * catch-all and hands the matched path in, so what changed is where the first
 * path comes from, not who decides what it means.
 *
 * The links mailed before the move are handled by the inline script in
 * `shared/legacyHash.ts`, which has to run before the first paint.
 */
export type Route =
  | 'home'
  | 'new'
  | 'platform'
  | 'me'
  | 'cfp'
  | 'form'
  | 'admin'
  | 'review'
  | 'schedule'
  | 'session';

export interface Place {
  route: Route;
  /**
   * Which CFP, for every route under `/c/`. Null on the platform's own pages.
   * It is a URL segment rather than stored state so that two CFPs can be open
   * in two tabs — an organiser running last year's and this year's at once is
   * the ordinary case, not an edge one.
   */
  cfpId: string | null;
  /** Only meaningful on `admin`; the first tab is the default. */
  tab: AdminTab;
  entryId?: string | null;
}

const HOME: Place = { route: 'home', cfpId: null, tab: ADMIN_TABS[0], entryId: null };

/**
 * Anything unrecognised reads as home rather than as a blank screen, because a
 * stale bookmark is far more likely than a hand-typed URL.
 */
export function placeOf(path: string): Place {
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return HOME;
  if (trimmed === 'new') return { ...HOME, route: 'new' };
  if (trimmed === 'platform') return { ...HOME, route: 'platform' };
  if (trimmed === 'me') return { ...HOME, route: 'me' };

  const [prefix, cfpId = '', section = '', detail = ''] = trimmed.split('/');
  if (prefix !== 'c' || validateCfpId(cfpId) !== null) return HOME;

  // Anything unrecognised under a CFP is its front page, for the same reason
  // the root is: a stale link should land somewhere, not nowhere.
  const route: Route =
    section === 'admin'
      ? 'admin'
      : section === 'schedule'
        ? detail
          ? 'session'
          : 'schedule'
      : section === 'review'
        ? 'review'
        : section === 'submit'
          ? 'form'
          : 'cfp';
  return {
    route,
    cfpId,
    tab: section === 'admin' && isAdminTab(detail) ? detail : ADMIN_TABS[0],
    entryId: route === 'session' ? decodeURIComponent(detail) : null,
  };
}

/**
 * Where we are, or `home` when asked somewhere with no address bar. A server
 * render has no `window`; `usePlace` is given the path it rendered instead, so
 * nothing has to guess.
 */
export function currentPlace(): Place {
  if (typeof window === 'undefined') return HOME;
  return placeOf(window.location.pathname);
}

/** The path for a place, so links and `navigate` cannot drift apart. */
export function href(place: {
  route: Route;
  cfpId?: string | null;
  tab?: AdminTab;
  entryId?: string;
}): string {
  if (place.route === 'home') return paths.home();
  if (place.route === 'new') return paths.new();
  if (place.route === 'platform') return paths.platform();
  if (place.route === 'me') return paths.me();
  const cfpId = place.cfpId ?? '';
  if (place.route === 'cfp') return paths.cfp(cfpId);
  if (place.route === 'form') return paths.submit(cfpId);
  if (place.route === 'schedule') return paths.schedule(cfpId);
  if (place.route === 'session') return paths.session(cfpId, place.entryId ?? '');
  if (place.route === 'admin') return paths.admin(cfpId, place.tab);
  return paths.review(cfpId);
}

/** The one place that moves the address bar. `Link` and `navigate` both land here. */
export function goTo(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  // `pushState` deliberately fires nothing, so the subscribers below would
  // never hear about our own navigations without this.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigate(
  route: Route,
  options: { cfpId?: string | null; tab?: AdminTab; entryId?: string } = {},
): void {
  goTo(href({ route, ...options }));
}

/**
 * `initialPath` comes from the server, which knows the URL it rendered. Without
 * it the first client render would read `window` and disagree with HTML built
 * from nothing — a hydration mismatch on every page but the listing.
 */
export function usePlace(initialPath?: string): Place {
  const [place, setPlace] = useState(() => (initialPath ? placeOf(initialPath) : currentPlace()));
  useEffect(() => {
    /*
     * Sync once, because the address bar can already disagree with what the
     * server rendered: a `#/c/{id}` link sends no fragment, so the server sees
     * `/` and the inline legacy-hash script has rewritten the path by the time
     * this runs. A no-op on every ordinary visit.
     */
    const now = currentPlace();
    // Only when it genuinely differs. Setting an equal-but-new object would
    // re-render the whole tree for nothing, and a re-render mid-edit is how a
    // form loses what somebody just typed.
    setPlace((was) =>
      was.route === now.route &&
      was.cfpId === now.cfpId &&
      was.tab === now.tab &&
      was.entryId === now.entryId
        ? was
        : now,
    );
    const onChange = () => {
      // Navigation guards run on the same event and may synchronously restore
      // the current URL while they save. Read the final address after every
      // listener has had that chance; consuming the first Back value here
      // unmounted a dirty form before its own popstate handler could protect it.
      queueMicrotask(() => setPlace(currentPlace()));
    };
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return place;
}
