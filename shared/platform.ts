import type { OwnershipTransfer } from './types';

export const PLATFORM_ROLES = ['owner', 'admin'] as const;
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
  isPlatformAdmin: boolean;
  isPlatformOwner: boolean;
  pendingTransfer?: OwnershipTransfer | null;
}

export interface PlatformAccessDirectory {
  members: PlatformMember[];
  pending: PlatformRoleGrant[];
  pendingTransfer?: OwnershipTransfer | null;
}
