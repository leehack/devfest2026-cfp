import type { AdminTab } from './adminTabs';

/**
 * Every URL this app can name, built in one place.
 *
 * Split out of `router.ts` because a server component needs to emit links and
 * `router.ts` reaches for `window`. Nothing here touches a browser global, so
 * the sitemap, the emails and the client all spell a path the same way.
 */
export const paths = {
  home: () => '/',
  new: () => '/new',
  platform: () => '/platform',
  me: () => '/me',
  cfp: (cfpId: string) => `/c/${cfpId}`,
  submit: (cfpId: string) => `/c/${cfpId}/submit`,
  review: (cfpId: string) => `/c/${cfpId}/review`,
  /** No tab means the bare `/admin`, which the nav links to and the app defaults. */
  admin: (cfpId: string, tab?: AdminTab) =>
    tab ? `/c/${cfpId}/admin/${tab}` : `/c/${cfpId}/admin`,
} as const;
