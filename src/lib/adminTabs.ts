/**
 * The overview routes an organiser into six focused jobs rather than one long
 * screen. The tab lives in the URL so it survives a reload and can be linked
 * to — "the email queue is stuck" is worth answering with an exact URL.
 *
 * Its own module because the server needs the list too, and `router.ts` reaches
 * for `window`.
 */
export const ADMIN_TABS = [
  'overview',
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
