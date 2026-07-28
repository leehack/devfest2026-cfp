import { useEffect, useState } from 'react';

import { validateCfpId } from '@shared/cfp';

/**
 * Path routing, in a hundred lines, because this is a small tool.
 *
 * It used to be the hash, so that nothing depended on the server rewriting
 * unknown URLs. That reason expired: a call for proposals is a public page now,
 * and everything that reads a URL from the outside — a crawler, a link preview
 * in Slack, a canonical tag — is blind to what comes after the `#`. Hosting
 * already rewrites `**` to the shell, and Vite's dev server does the same, so
 * the difference between what is tested and what ships stays where it was.
 *
 * `adoptLegacyHash` handles the links that were mailed before the move.
 */
export type Route = 'home' | 'new' | 'form' | 'admin' | 'review';

/**
 * The admin screen is five unrelated jobs, so it is five tabs rather than one
 * scroll. The tab lives in the URL rather than in component state so that it
 * survives a reload and can be linked to — "the email queue is stuck" is worth
 * being able to answer with a URL.
 */
export const ADMIN_TABS = ['proposals', 'committee', 'settings', 'confirmation', 'email'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

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
}

const isTab = (value: string): value is AdminTab =>
  (ADMIN_TABS as readonly string[]).includes(value);

const HOME: Place = { route: 'home', cfpId: null, tab: ADMIN_TABS[0] };

/**
 * Anything unrecognised reads as home rather than as a blank screen, because a
 * stale bookmark is far more likely than a hand-typed URL.
 */
export function placeOf(path: string): Place {
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return HOME;
  if (trimmed === 'new') return { ...HOME, route: 'new' };

  const [prefix, cfpId = '', section = '', tab = ''] = trimmed.split('/');
  if (prefix !== 'c' || validateCfpId(cfpId) !== null) return HOME;

  const route: Route = section === 'admin' ? 'admin' : section === 'review' ? 'review' : 'form';
  return { route, cfpId, tab: isTab(tab) ? tab : ADMIN_TABS[0] };
}

export function currentPlace(): Place {
  return placeOf(window.location.pathname);
}

/** The path for a place, so links and `navigate` cannot drift apart. */
export function href(place: { route: Route; cfpId?: string | null; tab?: AdminTab }): string {
  if (place.route === 'home') return '/';
  if (place.route === 'new') return '/new';
  const base = `/c/${place.cfpId}`;
  if (place.route === 'form') return base;
  if (place.route === 'admin') return place.tab ? `${base}/admin/${place.tab}` : `${base}/admin`;
  return `${base}/review`;
}

/**
 * Turns a `#/c/{id}` URL into its path equivalent, before anything renders.
 *
 * Those links are in people's mailboxes — every acceptance, every sign-in link
 * sent before this — and a mailed link is not something we get to reissue. The
 * query string survives the rewrite because a sign-in link carries its one-time
 * code there.
 */
export function adoptLegacyHash(): void {
  const { hash, search, pathname } = window.location;
  if (!hash.startsWith('#/')) return;
  // Only from the root: a path that already says where it is going wins over a
  // fragment, which by then is a leftover rather than an instruction.
  const path = pathname === '/' ? href(placeOf(hash.slice(1))) : pathname;
  window.history.replaceState(null, '', `${path}${search}`);
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
  options: { cfpId?: string | null; tab?: AdminTab } = {},
): void {
  goTo(href({ route, ...options }));
}

/** Within the CFP already open, which is what every in-page link wants. */
export function goInCfp(cfpId: string, route: Route, tab?: AdminTab): void {
  navigate(route, { cfpId, tab });
}

export function usePlace(): Place {
  const [place, setPlace] = useState(currentPlace);
  useEffect(() => {
    const onChange = () => setPlace(currentPlace());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return place;
}
