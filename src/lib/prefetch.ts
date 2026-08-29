/**
 * Route & Component Chunk Prefetching
 *
 * Speeds up client-side page transitions by requesting lazy chunks on hover,
 * focus, or idle before the user clicks.
 */

export const prefetchChunks = {
  submit: () => import('../screens/SubmitPage'),
  admin: () => import('../screens/AdminPage'),
  review: () => import('../screens/ReviewPage'),
  home: () => import('../screens/HomePage'),
  profile: () => import('../screens/ProfilePage'),
  newCfp: () => import('../screens/NewCfpPage'),
  platform: () => import('../screens/PlatformAdminPage'),
  orgs: () => import('../screens/OrgsListPage'),
  org: () => import('../screens/OrgWorkspacePage'),
  join: () => import('../screens/JoinCommitteePage'),
};

export const prefetchAdminTabs = {
  overview: () => import('../screens/admin/Overview'),
  proposals: () => import('../screens/admin/Proposals'),
  committee: () => import('../screens/admin/Committee'),
  submission: () => import('../screens/admin/Submission'),
  confirmation: () => import('../screens/admin/Confirmation'),
  settings: () => import('../screens/admin/Settings'),
  schedule: () => import('../screens/admin/Schedule'),
  email: () => import('../screens/admin/Email'),
};

const prefetchedPaths = new Set<string>();

export function prefetchByPath(path: string): void {
  if (!path || typeof window === 'undefined') return;
  const clean = path.split('?')[0].replace(/^\/+|\/+$/g, '');
  if (prefetchedPaths.has(clean)) return;
  prefetchedPaths.add(clean);

  const parts = clean.split('/');
  if (clean === '' || clean === 'home') {
    void prefetchChunks.home();
  } else if (clean === 'me') {
    void prefetchChunks.profile();
  } else if (clean === 'new') {
    void prefetchChunks.newCfp();
  } else if (clean === 'platform' || clean.startsWith('platform/')) {
    void prefetchChunks.platform();
  } else if (clean === 'orgs') {
    void prefetchChunks.orgs();
  } else if (clean.startsWith('org/')) {
    void prefetchChunks.org();
  } else if (parts[0] === 'c' && parts[1]) {
    const section = parts[2];
    if (section === 'submit') {
      void prefetchChunks.submit();
    } else if (section === 'review') {
      void prefetchChunks.review();
    } else if (section === 'admin') {
      void prefetchChunks.admin();
      const tab = (parts[3] || 'overview') as keyof typeof prefetchAdminTabs;
      if (tab && prefetchAdminTabs[tab]) {
        void prefetchAdminTabs[tab]();
      }
    } else if (section === 'join' || section === 'invite') {
      void prefetchChunks.join();
    }
  }
}
