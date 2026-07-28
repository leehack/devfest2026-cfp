import { useEffect, useState } from 'react';

import { validateCfpId } from '@shared/cfp';

/**
 * Hash routing, in a hundred lines, because this is a small tool.
 *
 * The hash rather than the path so nothing depends on the server rewriting
 * unknown URLs — the emulator, `vite preview` and Hosting then all behave the
 * same, which is one fewer difference between what is tested and what ships.
 */
export type Route = 'home' | 'new' | 'form' | 'admin' | 'review';

/**
 * The admin screen is five unrelated jobs, so it is five tabs rather than one
 * scroll. The tab lives in the hash rather than in component state so that it
 * survives a reload and can be linked to — "the email queue is stuck" is worth
 * being able to answer with a URL.
 */
export const ADMIN_TABS = ['proposals', 'committee', 'settings', 'confirmation', 'email'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export interface Place {
  route: Route;
  /**
   * Which CFP, for every route under `#/c/`. Null on the platform's own pages.
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
export function currentPlace(): Place {
  const hash = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  if (!hash) return HOME;
  if (hash === 'new') return { ...HOME, route: 'new' };

  const [prefix, cfpId = '', section = '', tab = ''] = hash.split('/');
  if (prefix !== 'c' || validateCfpId(cfpId) !== null) return HOME;

  const route: Route = section === 'admin' ? 'admin' : section === 'review' ? 'review' : 'form';
  return { route, cfpId, tab: isTab(tab) ? tab : ADMIN_TABS[0] };
}

/** The hash for a place, so links and `navigate` cannot drift apart. */
export function href(place: { route: Route; cfpId?: string | null; tab?: AdminTab }): string {
  if (place.route === 'home') return '#/';
  if (place.route === 'new') return '#/new';
  const base = `#/c/${place.cfpId}`;
  if (place.route === 'form') return base;
  if (place.route === 'admin') return place.tab ? `${base}/admin/${place.tab}` : `${base}/admin`;
  return `${base}/review`;
}

export function navigate(
  route: Route,
  options: { cfpId?: string | null; tab?: AdminTab } = {},
): void {
  window.location.hash = href({ route, ...options });
}

/** Within the CFP already open, which is what every in-page link wants. */
export function goInCfp(cfpId: string, route: Route, tab?: AdminTab): void {
  navigate(route, { cfpId, tab });
}

export function usePlace(): Place {
  const [place, setPlace] = useState(currentPlace);
  useEffect(() => {
    const onChange = () => setPlace(currentPlace());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return place;
}
