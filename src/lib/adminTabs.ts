/**
 * The admin screen is six unrelated jobs, so it is six tabs rather than one
 * scroll. The tab lives in the URL rather than in component state so that it
 * survives a reload and can be linked to — "the email queue is stuck" is worth
 * being able to answer with a URL.
 *
 * Its own module because the server needs the list too, and `router.ts` reaches
 * for `window`.
 */
export const ADMIN_TABS = [
  'proposals',
  'committee',
  'settings',
  'submission',
  'confirmation',
  'email',
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

export const isAdminTab = (value: string): value is AdminTab =>
  (ADMIN_TABS as readonly string[]).includes(value);
