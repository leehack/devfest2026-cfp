import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';

import { functions } from '../firebase';
import type {
  Org,
  OrgRole,
  OrgTheme,
  PlatformLimitsConfiguration,
  PlatformOrgLimitSummary,
  PlatformUserOrgLimitSummary,
} from '@shared/org';
import type { CfpFeatures, CfpTheme } from '@shared/types';

export interface OrgEventSummary {
  id: string;
  name: string;
  visibility: string;
  archived: boolean;
  opensAt: string | null;
  closesAt: string | null;
  theme?: CfpTheme;
  features?: CfpFeatures;
  canAdmin?: boolean;
}

export interface OrgMemberSummary {
  uid: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string | null;
}

export type OrgMembershipSummary = Org & { membershipRole: OrgRole };

export const createOrg = httpsCallable<
  { name: string; slug: string },
  { ok: boolean; orgId: string }
>(functions, 'createOrg');

export const getOrg = httpsCallable<
  { orgId: string },
  { org: Org; role: OrgRole | null; pendingTransfer?: import('@shared/types').OwnershipTransfer | null }
>(functions, 'getOrg');

export const listMyOrgs = httpsCallable<
  Record<string, never>,
  { orgs: OrgMembershipSummary[]; canCreateOrg: boolean; ownershipLimit: number }
>(functions, 'listMyOrgs');

export const listOrgLimits = httpsCallable<
  { pageSize: number; cursor?: string; query?: string },
  { organizations: PlatformOrgLimitSummary[]; nextCursor: string | null }
>(functions, 'listOrgLimits');

export const setOrgActiveEventLimit = httpsCallable<
  { orgId: string; limit: number },
  { ok: boolean; orgId: string; limit: number }
>(functions, 'setOrgActiveEventLimit');

export const listUserOrgLimits = httpsCallable<
  { pageSize: number; pageToken?: string },
  { users: PlatformUserOrgLimitSummary[]; nextPageToken: string | null }
>(functions, 'listUserOrgLimits');

export const findUserOrgLimit = httpsCallable<
  { email: string },
  { user: PlatformUserOrgLimitSummary }
>(functions, 'findUserOrgLimit');

export const setUserOrgLimit = httpsCallable<
  { email: string; limit: number },
  { ok: boolean; user: PlatformUserOrgLimitSummary }
>(functions, 'setUserOrgLimit');

export const resetUserOrgLimit = httpsCallable<
  { uid: string },
  { ok: boolean; uid: string; limit: number }
>(functions, 'resetUserOrgLimit');

export const getPlatformLimitsConfiguration = httpsCallable<
  Record<string, never>,
  PlatformLimitsConfiguration
>(functions, 'getPlatformLimitsConfiguration');

export const setPlatformLimitsConfiguration = httpsCallable<
  PlatformLimitsConfiguration,
  { ok: boolean; organizationOwnershipDefault: number }
>(functions, 'setPlatformLimitsConfiguration');

export const listOrgMembers = httpsCallable<
  { orgId: string },
  { members: OrgMemberSummary[] }
>(functions, 'listOrgMembers');

export const updateOrg = httpsCallable<
  {
    orgId: string;
    name?: string;
    description?: string;
    logoUrl?: string;
    websiteUrl?: string;
    theme?: OrgTheme;
  },
  { ok: boolean }
>(functions, 'updateOrg');

export const listOrgEvents = httpsCallable<
  { orgId: string },
  { events: OrgEventSummary[] }
>(functions, 'listOrgEvents');

export const grantOrgRole = httpsCallable<
  { orgId: string; email: string; role: OrgRole },
  { ok: boolean }
>(functions, 'grantOrgRole');

export const revokeOrgRole = httpsCallable<
  { orgId: string; targetUid: string },
  { ok: boolean }
>(functions, 'revokeOrgRole');

export const initiateOrgOwnershipTransfer = httpsCallable<
  { orgId: string; email: string },
  { ok: boolean }
>(functions, 'initiateOrgOwnershipTransfer');

export const acceptOrgOwnershipTransfer = httpsCallable<
  { orgId: string },
  { ok: boolean }
>(functions, 'acceptOrgOwnershipTransfer');

export const cancelOrgOwnershipTransfer = httpsCallable<
  { orgId: string },
  { ok: boolean }
>(functions, 'cancelOrgOwnershipTransfer');

export const getOrgOwnershipTransfer = httpsCallable<
  { orgId: string },
  { ok: boolean; transfer: import('@shared/types').OwnershipTransfer | null }
>(functions, 'getOrgOwnershipTransfer');

export const deleteOrg = httpsCallable<
  { orgId: string; confirm: string },
  { ok: boolean }
>(functions, 'deleteOrg');

export function useMyOrgs(user: User | null) {
  const [orgs, setOrgs] = useState<OrgMembershipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [canCreateOrg, setCanCreateOrg] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setOrgs([]);
      setCanCreateOrg(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listMyOrgs();
      setOrgs(res.data.orgs);
      setCanCreateOrg(res.data.canCreateOrg);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { orgs, canCreateOrg, loading, error, refresh };
}

export function useOrg(orgId: string | undefined, user: User | null) {
  const [org, setOrg] = useState<Org | null>(null);
  const [role, setRole] = useState<OrgRole | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<import('@shared/types').OwnershipTransfer | null>(null);
  const [events, setEvents] = useState<OrgEventSummary[]>([]);
  const [members, setMembers] = useState<OrgMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setOrg(null);
      setRole(null);
      setPendingTransfer(null);
      setEvents([]);
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (user) await user.getIdToken();
      const [orgRes, eventsRes] = await Promise.all([
        getOrg({ orgId }),
        listOrgEvents({ orgId }),
      ]);
      setOrg(orgRes.data.org);
      setRole(orgRes.data.role);
      setPendingTransfer(orgRes.data.pendingTransfer ?? null);
      setEvents(eventsRes.data.events);
      if (orgRes.data.role) {
        const membersRes = await listOrgMembers({ orgId });
        setMembers(membersRes.data.members);
      } else {
        setMembers([]);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [orgId, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { org, role, pendingTransfer, events, members, loading, error, refresh };
}
