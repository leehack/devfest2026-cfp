import {
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import type { OwnershipTransfer } from '../../shared/types';

export const OWNERSHIP_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function timestampMillis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === 'function') {
      const millis = toMillis.call(value);
      return Number.isFinite(millis) ? millis : null;
    }
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function ownershipTransferExpiry(now = Date.now()): Timestamp {
  return Timestamp.fromMillis(now + OWNERSHIP_TRANSFER_TTL_MS);
}

export function ownershipTransferIsPending(
  snapshot: DocumentSnapshot,
  now = Date.now(),
): boolean {
  if (!snapshot.exists || snapshot.get('status') !== 'pending') return false;
  const explicitExpiry = timestampMillis(snapshot.get('expiresAt'));
  if (explicitExpiry !== null) return explicitExpiry > now;

  // Bounded compatibility for transfers created before `expiresAt` existed.
  const initiatedAt = timestampMillis(snapshot.get('initiatedAt'));
  return initiatedAt !== null && initiatedAt + OWNERSHIP_TRANSFER_TTL_MS > now;
}

export function ownershipTransferView(
  snapshot: DocumentSnapshot,
  scope: OwnershipTransfer['scope'],
  scopeId?: string,
): OwnershipTransfer {
  const data = snapshot.data() ?? {};
  return {
    id: String(data.id ?? snapshot.id),
    scope,
    ...(scopeId ? { scopeId } : {}),
    targetEmail: String(data.targetEmail ?? ''),
    ...(data.targetUid ? { targetUid: String(data.targetUid) } : {}),
    initiatedBy: String(data.initiatedBy ?? ''),
    initiatedAt: timestampMillis(data.initiatedAt),
    expiresAt: timestampMillis(data.expiresAt),
    status: 'pending',
  };
}

/** Preserve the previous lifecycle before reusing the stable `current` slot. */
export function archiveOwnershipTransfer(
  tx: Transaction,
  current: DocumentSnapshot,
  history: CollectionReference,
  byUid: string,
): void {
  if (!current.exists) return;
  const id = String(current.get('id') ?? '');
  if (!/^[A-Za-z0-9-]{16,80}$/.test(id) || id === 'current') return;
  tx.set(history.doc(id), {
    ...current.data(),
    supersededAt: FieldValue.serverTimestamp(),
    supersededBy: byUid,
  });
}
