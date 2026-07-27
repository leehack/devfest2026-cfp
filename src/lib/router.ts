import { useEffect, useState } from 'react';

/**
 * Hash routing, in a dozen lines, because this is a four-page internal tool.
 *
 * The hash rather than the path so nothing depends on the server rewriting
 * unknown URLs — the emulator, `vite preview` and Hosting then all behave the
 * same, which is one fewer difference between what is tested and what ships.
 */
export type Route = 'form' | 'admin' | 'review';

const ROUTES: Record<string, Route> = {
  '#/admin': 'admin',
  '#/review': 'review',
};

export function currentRoute(): Route {
  return ROUTES[window.location.hash] ?? 'form';
}

export function navigate(route: Route): void {
  window.location.hash = route === 'form' ? '#/' : `#/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
