/**
 * The URL with its variable parts named rather than filled in.
 *
 * `/c/devfest-mtl-2026/admin/email` becomes `/c/{cfpId}/admin/{tab}`. The CFP
 * slug still travels as its own parameter — it is public and it is the thing an
 * organiser wants to group by — but keeping it out of the path means GA's page
 * reports have one row per screen instead of one per call, which is the report
 * anybody actually reads.
 *
 * Its own module so the analytics tests can reach it without pulling in
 * `router.ts` and, through it, `window`.
 */
export function pageShape(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'c' || parts.length < 2) return `/${parts.join('/')}`;
  const rest = parts.slice(2);
  if (rest[0] === 'admin') return '/c/{cfpId}/admin/{tab}';
  if (rest[0] === 'schedule' && rest.length > 1) return '/c/{cfpId}/schedule/{entryId}';
  return rest.length ? `/c/{cfpId}/${rest.join('/')}` : '/c/{cfpId}';
}
