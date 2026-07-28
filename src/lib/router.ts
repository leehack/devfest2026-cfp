import { useEffect, useState } from 'react';

/**
 * Hash routing, in a few dozen lines, because this is a small internal tool.
 *
 * The hash rather than the path so nothing depends on the server rewriting
 * unknown URLs — the emulator, `vite preview` and Hosting then all behave the
 * same, which is one fewer difference between what is tested and what ships.
 */
export type Route = 'form' | 'admin' | 'review';

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
  /** Only meaningful on `admin`; the first tab is the default. */
  tab: AdminTab;
}

const ROUTES: Record<string, Route> = {
  '#/admin': 'admin',
  '#/review': 'review',
};

const isTab = (value: string): value is AdminTab =>
  (ADMIN_TABS as readonly string[]).includes(value);

export function currentPlace(): Place {
  const [, head = '', tab = ''] = /^(#\/[a-z]*)\/?([a-z]*)$/.exec(window.location.hash) ?? [];
  return {
    route: ROUTES[head] ?? 'form',
    // An unknown tab falls back rather than rendering nothing, so a stale
    // bookmark opens the admin screen instead of a blank panel.
    tab: isTab(tab) ? tab : ADMIN_TABS[0],
  };
}

export function navigate(route: Route, tab?: AdminTab): void {
  if (route === 'form') window.location.hash = '#/';
  else window.location.hash = route === 'admin' && tab ? `#/admin/${tab}` : `#/${route}`;
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
