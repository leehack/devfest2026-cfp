/**
 * Multi-tenant organization hierarchy.
 *
 * An organization (e.g. `pycon-us`, `gdg-montreal`, `acme-corp`) groups
 * team members and multiple yearly/regional calls for proposals.
 */

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_LIMITS = {
  idMin: 3,
  idMax: 60,
  nameMax: 120,
  descriptionMax: 2000,
  websiteMax: 200,
  /** Legacy fallback when the platform has no configured ownership default. */
  perOwner: 1,
  /** Platform administrators may configure the global or one-account quota up to this value. */
  perOwnerMax: 100,
  /** Legacy organizations without an explicit event quota use this value. */
  activeEventsDefault: 1,
  activeEventsMax: 100,
} as const;

export function effectiveOrgOwnershipLimit(
  value: unknown,
  fallback: number = ORG_LIMITS.perOwner,
): number {
  const safeFallback = typeof fallback === 'number' &&
    Number.isInteger(fallback) &&
    fallback >= 0 &&
    fallback <= ORG_LIMITS.perOwnerMax
    ? fallback
    : ORG_LIMITS.perOwner;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ORG_LIMITS.perOwnerMax
    ? value
    : safeFallback;
}

export interface PlatformLimitsConfiguration {
  organizationOwnershipDefault: number;
}

export function effectiveActiveEventLimit(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ORG_LIMITS.activeEventsMax
    ? value
    : ORG_LIMITS.activeEventsDefault;
}

export interface OrgTheme {
  primaryColor?: string;
  accentColor?: string;
  mastheadBg?: string;
  logoUrl?: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  ownerUid: string;
  description?: string;
  websiteUrl?: string;
  logoUrl?: string;
  theme?: OrgTheme;
  plan?: 'community' | 'pro' | 'enterprise';
  activeEventLimit?: number;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PlatformOrgLimitSummary {
  id: string;
  name: string;
  activeEventLimit: number;
  activeEventCount: number;
}

export interface PlatformUserOrgLimitSummary {
  uid: string;
  email: string;
  name: string;
  ownedOrganizationCount: number;
  organizationLimit: number;
  hasOverride: boolean;
}

export interface OrgMember {
  uid: string;
  email: string;
  name?: string;
  role: OrgRole;
  joinedAt: unknown;
  invitedBy?: string;
}

export interface OrgRoleGrant {
  email: string;
  role: OrgRole;
  createdAt: unknown;
  createdBy: string;
}

const ORG_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateOrgSlug(slug: string): 'slugLength' | 'slugFormat' | null {
  if (slug.length < ORG_LIMITS.idMin || slug.length > ORG_LIMITS.idMax) return 'slugLength';
  return ORG_SLUG_REGEX.test(slug) ? null : 'slugFormat';
}
