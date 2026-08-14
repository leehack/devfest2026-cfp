import { describe, expect, it } from 'vitest';
import {
  adminError,
  orgError,
  roleAdminError,
  transferError,
} from '../src/lib/errors';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import type { Cfp, OwnershipTransfer } from '@shared/types';
import {
  ORG_LIMITS,
  effectiveActiveEventLimit,
  effectiveOrgOwnershipLimit,
  type Org,
} from '@shared/org';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import {
  OWNERSHIP_TRANSFER_TTL_MS,
  ownershipTransferIsPending,
} from '../functions/src/ownership';
import {
  filterPlatformOrgLimits,
  filterPlatformUserLimits,
} from '../src/lib/platformLimits';

function transferSnapshot(data: Record<string, unknown>): DocumentSnapshot {
  return {
    exists: true,
    id: 'current',
    data: () => data,
    get: (field: string) => data[field],
  } as unknown as DocumentSnapshot;
}

describe('organization quotas', () => {
  it('defaults legacy organizations to one active event and accepts bounded overrides', () => {
    expect(effectiveActiveEventLimit(undefined)).toBe(ORG_LIMITS.activeEventsDefault);
    expect(effectiveActiveEventLimit(-1)).toBe(ORG_LIMITS.activeEventsDefault);
    expect(effectiveActiveEventLimit(1.5)).toBe(ORG_LIMITS.activeEventsDefault);
    expect(effectiveActiveEventLimit(0)).toBe(0);
    expect(effectiveActiveEventLimit(8)).toBe(8);
  });

  it('defaults accounts to one organization and accepts bounded per-user overrides', () => {
    expect(effectiveOrgOwnershipLimit(undefined)).toBe(ORG_LIMITS.perOwner);
    expect(effectiveOrgOwnershipLimit(-1)).toBe(ORG_LIMITS.perOwner);
    expect(effectiveOrgOwnershipLimit(1.5)).toBe(ORG_LIMITS.perOwner);
    expect(effectiveOrgOwnershipLimit(0)).toBe(0);
    expect(effectiveOrgOwnershipLimit(12)).toBe(12);
    expect(effectiveOrgOwnershipLimit(ORG_LIMITS.perOwnerMax + 1)).toBe(ORG_LIMITS.perOwner);
    expect(effectiveOrgOwnershipLimit(undefined, 4)).toBe(4);
    expect(effectiveOrgOwnershipLimit(undefined, -1)).toBe(ORG_LIMITS.perOwner);
    expect(effectiveOrgOwnershipLimit(0, 4)).toBe(0);
  });
});

describe('Single-Owner Access Control & Ownership Transfers', () => {
  describe('Error mapping & bilingual support', () => {
    it('maps owner-required errors across platform, org, and event scopes', () => {
      const eventOwnerErr = {
        code: 'functions/permission-denied',
        details: { reason: 'event_owner_required' },
      };
      const orgOwnerErr = {
        code: 'functions/permission-denied',
        details: { reason: 'org_owner_required' },
      };
      const platformOwnerErr = {
        code: 'functions/permission-denied',
        details: { reason: 'platform_owner_required' },
      };

      // Event scope
      expect(roleAdminError(eventOwnerErr, en)).toBe(en.admin.ownerRequired);
      expect(roleAdminError(eventOwnerErr, fr)).toBe(fr.admin.ownerRequired);
      expect(adminError(eventOwnerErr, en)).toBe(en.admin.ownerRequired);
      expect(adminError(eventOwnerErr, fr)).toBe(fr.admin.ownerRequired);

      // Org scope
      expect(orgError(orgOwnerErr, en)).toBe(en.orgs.errors.ownerRequired);
      expect(orgError(orgOwnerErr, fr)).toBe(fr.orgs.errors.ownerRequired);

      // Transfer scope
      expect(transferError(platformOwnerErr, en)).toBe(en.platformAdmin.ownerRequired);
      expect(transferError(platformOwnerErr, fr)).toBe(fr.platformAdmin.ownerRequired);
      expect(transferError(orgOwnerErr, en)).toBe(en.orgs.errors.ownerRequired);
      expect(transferError(orgOwnerErr, fr)).toBe(fr.orgs.errors.ownerRequired);
      expect(transferError(eventOwnerErr, en)).toBe(en.admin.ownerRequired);
      expect(transferError(eventOwnerErr, fr)).toBe(fr.admin.ownerRequired);
    });

    it('maps transfer-specific failure preconditions', () => {
      for (const dict of [en, fr]) {
        // Account not ready (not verified / disabled)
        expect(
          transferError(
            { code: 'functions/failed-precondition', details: { reason: 'transfer_account_not_ready' } },
            dict,
          ),
        ).toBe(dict.transfer.accountNotReady);

        // Already owner
        expect(
          transferError(
            { code: 'functions/failed-precondition', details: { reason: 'transfer_already_owner' } },
            dict,
          ),
        ).toBe(dict.transfer.alreadyOwner);

        expect(
          transferError(
            { code: 'functions/failed-precondition', details: { reason: 'transfer_already_pending' } },
            dict,
          ),
        ).toBe(dict.transfer.alreadyPending);

        // Transfer not found or expired/cancelled
        expect(
          transferError(
            { code: 'functions/failed-precondition', details: { reason: 'transfer_not_found' } },
            dict,
          ),
        ).toBe(dict.transfer.notFound);

        // Successor not eligible
        expect(
          transferError(
            { code: 'functions/failed-precondition', details: { reason: 'transfer_not_eligible' } },
            dict,
          ),
        ).toBe(dict.transfer.notEligible);

        // Wrong account attempting acceptance
        expect(
          transferError(
            { code: 'functions/permission-denied', details: { reason: 'transfer_wrong_account' } },
            dict,
          ),
        ).toBe(dict.transfer.wrongAccount);

        // Bad email input
        expect(
          transferError({ code: 'functions/invalid-argument' }, dict),
        ).toBe(dict.transfer.badInput);
      }
    });

    it('maps org initial owner account errors', () => {
      expect(
        orgError(
          { code: 'functions/failed-precondition', details: { reason: 'org_account_not_ready' } },
          en,
        ),
      ).toBe(en.orgs.errors.accountNotReady);
      expect(
        orgError(
          { code: 'functions/failed-precondition', details: { reason: 'org_account_not_ready' } },
          fr,
        ),
      ).toBe(fr.orgs.errors.accountNotReady);
    });
  });

  describe('Single-owner data invariant and legacy compatibility fallback', () => {
    it('reads canonical singular ownerUid on event with fallback to legacy ownerUids', () => {
      // Canonical format
      const modernCfp: Partial<Cfp> = {
        name: 'DevFest 2026',
        visibility: 'public',
        archived: false,
        opensAt: '2026-09-01T00:00:00Z',
        closesAt: '2026-10-01T00:00:00Z',
        ownerUid: 'uid-owner-1',
        ownerUids: ['uid-owner-1'],
        createdBy: 'uid-owner-1',
      };
      const effectiveOwner = modernCfp.ownerUid ?? modernCfp.ownerUids?.[0];
      expect(effectiveOwner).toBe('uid-owner-1');

      // Legacy seeded record without ownerUid field
      const legacyCfp: Partial<Cfp> = {
        name: 'Legacy Conf',
        visibility: 'public',
        archived: false,
        opensAt: '2026-09-01T00:00:00Z',
        closesAt: '2026-10-01T00:00:00Z',
        ownerUids: ['legacy-owner-uid'],
        createdBy: 'legacy-owner-uid',
      };
      const legacyEffectiveOwner = legacyCfp.ownerUid ?? legacyCfp.ownerUids?.[0];
      expect(legacyEffectiveOwner).toBe('legacy-owner-uid');
    });

    it('reads canonical singular ownerUid on organization with fallback to legacy structure', () => {
      const modernOrg: Partial<Org> = {
        id: 'tech-corp',
        name: 'Tech Corp',
        slug: 'tech-corp',
        ownerUid: 'uid-org-owner',
        createdAt: '2026-01-01T00:00:00Z',
      };
      expect(modernOrg.ownerUid).toBe('uid-org-owner');
    });

    it('models ownership transfer lifecycle states atomically', () => {
      const pendingTransfer: OwnershipTransfer = {
        id: 'transfer-1',
        scope: 'event',
        scopeId: 'devfest-2026',
        targetEmail: 'successor@example.com',
        targetUid: 'successor-uid',
        initiatedBy: 'former-owner-uid',
        initiatedAt: '2026-08-10T12:00:00Z',
        status: 'pending',
      };
      expect(pendingTransfer.status).toBe('pending');
      expect(pendingTransfer.targetEmail).toBe('successor@example.com');

      // Atomic transition on accept: successor becomes owner, former becomes admin
      const acceptedTransfer: OwnershipTransfer = {
        ...pendingTransfer,
        status: 'accepted',
        acceptedAt: '2026-08-10T12:05:00Z',
        acceptedBy: 'successor-uid',
      };
      expect(acceptedTransfer.status).toBe('accepted');
      expect(acceptedTransfer.acceptedBy).toBe('successor-uid');

      // Cancelled state
      const cancelledTransfer: OwnershipTransfer = {
        ...pendingTransfer,
        status: 'cancelled',
        cancelledAt: '2026-08-10T12:02:00Z',
        cancelledBy: 'former-owner-uid',
      };
      expect(cancelledTransfer.status).toBe('cancelled');
    });

    it('expires explicit and legacy pending transfers after seven days', () => {
      const now = Date.UTC(2026, 7, 13, 12);
      expect(
        ownershipTransferIsPending(
          transferSnapshot({
            status: 'pending',
            initiatedAt: Timestamp.fromMillis(now),
            expiresAt: Timestamp.fromMillis(now + OWNERSHIP_TRANSFER_TTL_MS),
          }),
          now + OWNERSHIP_TRANSFER_TTL_MS - 1,
        ),
      ).toBe(true);
      expect(
        ownershipTransferIsPending(
          transferSnapshot({
            status: 'pending',
            initiatedAt: Timestamp.fromMillis(now),
            expiresAt: Timestamp.fromMillis(now + OWNERSHIP_TRANSFER_TTL_MS),
          }),
          now + OWNERSHIP_TRANSFER_TTL_MS,
        ),
      ).toBe(false);
      expect(
        ownershipTransferIsPending(
          transferSnapshot({
            status: 'pending',
            initiatedAt: Timestamp.fromMillis(now),
          }),
          now + OWNERSHIP_TRANSFER_TTL_MS - 1,
        ),
      ).toBe(true);
      expect(
        ownershipTransferIsPending(
          transferSnapshot({ status: 'accepted', expiresAt: Timestamp.fromMillis(now + 1) }),
          now,
        ),
      ).toBe(false);
    });
  });

  describe('Platform limits search & filter', () => {
    const users = [
      {
        uid: 'u-1',
        email: 'alice@example.com',
        name: 'Alice Admin',
        ownedOrganizationCount: 2,
        organizationLimit: 3,
        hasOverride: true,
      },
      {
        uid: 'u-2',
        email: 'bob@corp.test',
        name: 'Bob Builder',
        ownedOrganizationCount: 1,
        organizationLimit: 1,
        hasOverride: false,
      },
      {
        uid: 'u-3',
        email: 'charlie@dev.org',
        name: '',
        ownedOrganizationCount: 0,
        organizationLimit: 2,
        hasOverride: true,
      },
    ];

    const orgs = [
      { id: 'org-alpha', name: 'Alpha Conf', activeEventCount: 1, activeEventLimit: 2 },
      { id: 'org-beta', name: 'Beta Summit', activeEventCount: 0, activeEventLimit: 1 },
      { id: 'gamma-org', name: 'Gamma Meetup', activeEventCount: 3, activeEventLimit: 5 },
    ];

    it('filters users by name, email, or uid case-insensitively', () => {
      expect(filterPlatformUserLimits(users, 'alice')).toHaveLength(1);
      expect(filterPlatformUserLimits(users, 'alice')[0]?.uid).toBe('u-1');
      expect(filterPlatformUserLimits(users, 'CORP.TEST')).toHaveLength(1);
      expect(filterPlatformUserLimits(users, 'CORP.TEST')[0]?.uid).toBe('u-2');
      expect(filterPlatformUserLimits(users, 'u-3')).toHaveLength(1);
      expect(filterPlatformUserLimits(users, 'u-3')[0]?.email).toBe('charlie@dev.org');
      expect(filterPlatformUserLimits(users, 'nonexistent')).toHaveLength(0);
      expect(filterPlatformUserLimits(users, '')).toHaveLength(3);
    });

    it('filters organizations by name or id/slug case-insensitively', () => {
      expect(filterPlatformOrgLimits(orgs, 'alpha')).toHaveLength(1);
      expect(filterPlatformOrgLimits(orgs, 'alpha')[0]?.id).toBe('org-alpha');
      expect(filterPlatformOrgLimits(orgs, 'SUMMIT')).toHaveLength(1);
      expect(filterPlatformOrgLimits(orgs, 'SUMMIT')[0]?.id).toBe('org-beta');
      expect(filterPlatformOrgLimits(orgs, 'gamma-org')).toHaveLength(1);
      expect(filterPlatformOrgLimits(orgs, 'gamma-org')[0]?.name).toBe('Gamma Meetup');
      expect(filterPlatformOrgLimits(orgs, 'no-match')).toHaveLength(0);
      expect(filterPlatformOrgLimits(orgs, '')).toHaveLength(3);
    });
  });
});
