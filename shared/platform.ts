export const PLATFORM_ROLES = ['owner', 'admin', 'creator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface PlatformMember {
  uid: string;
  email: string;
  name?: string;
  role: PlatformRole;
  createdAt?: unknown;
  createdBy?: string;
  grantedBy: string;
  roleUpdatedAt?: unknown;
  roleUpdatedBy?: string;
}

export interface PlatformRoleGrant {
  email: string;
  role: PlatformRole;
  createdAt?: unknown;
  createdBy: string;
  roleUpdatedAt?: unknown;
  roleUpdatedBy?: string;
}

export interface PlatformAccessStatus {
  role: PlatformRole | null;
  canCreateCfp: boolean;
  isPlatformAdmin: boolean;
  isPlatformOwner: boolean;
}

export interface PlatformAccessDirectory {
  members: PlatformMember[];
  pending: PlatformRoleGrant[];
}
