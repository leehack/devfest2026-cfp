import type { PlatformOrgLimitSummary, PlatformUserOrgLimitSummary } from '@shared/org';

function normalizedQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function filterPlatformUserLimits(
  users: PlatformUserOrgLimitSummary[],
  search: string,
): PlatformUserOrgLimitSummary[] {
  const query = normalizedQuery(search);
  if (!query) return users;
  return users.filter((user) =>
    [user.name, user.email, user.uid].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
}

export function filterPlatformOrgLimits(
  organizations: PlatformOrgLimitSummary[],
  search: string,
): PlatformOrgLimitSummary[] {
  const query = normalizedQuery(search);
  if (!query) return organizations;
  return organizations.filter((organization) =>
    [organization.name, organization.id].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
}
