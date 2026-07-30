export const PLATFORM_ROLES = ['admin', 'creator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface PlatformMember {
  uid: string;
  email: string;
  name?: string;
  role: PlatformRole;
  createdAt?: unknown;
  grantedBy: string;
}

export interface PlatformRoleGrant {
  email: string;
  role: PlatformRole;
  createdAt?: unknown;
  createdBy: string;
}

export interface PlatformAccessStatus {
  role: PlatformRole | null;
  canCreateCfp: boolean;
  isPlatformAdmin: boolean;
}

export interface PlatformAccessDirectory {
  members: PlatformMember[];
  pending: PlatformRoleGrant[];
}
