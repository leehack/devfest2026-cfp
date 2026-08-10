import { describe, expect, it, vi } from 'vitest';
import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';

import { clearCfpFirestoreChildren, clearCfpStorage } from '../functions/src/deletion';

function document(id: string, collections: CollectionReference[] = []): DocumentReference {
  return {
    id,
    listCollections: vi.fn().mockResolvedValue(collections),
  } as unknown as DocumentReference;
}

function collection(id: string, documents: DocumentReference[] = []): CollectionReference {
  return {
    id,
    listDocuments: vi.fn().mockResolvedValue(documents),
  } as unknown as CollectionReference;
}

function firestore(recursiveDelete: ReturnType<typeof vi.fn>) {
  return { recursiveDelete } as unknown as Pick<Firestore, 'recursiveDelete'>;
}

describe('CFP storage deletion', () => {
  it('propagates a bucket failure so Firestore remains retryable', async () => {
    const failure = new Error('bucket unavailable');
    const deleteFiles = vi.fn().mockRejectedValue(failure);

    await expect(clearCfpStorage({ deleteFiles }, 'event-id')).rejects.toBe(failure);
    expect(deleteFiles).toHaveBeenCalledWith({ prefix: 'cfps/event-id/' });
  });
});

describe('CFP Firestore deletion', () => {
  it('propagates a late child failure without deleting the root or caller membership', async () => {
    const ownerChild = collection('privateNotes');
    const owner = document('owner-uid', [ownerChild]);
    const reviewer = document('reviewer-uid');
    const members = collection('members', [reviewer, owner]);
    const proposals = collection('proposals');
    const root = document('event-id', [members, proposals]);
    const failure = new Error('proposal delete failed');
    const recursiveDelete = vi.fn(async (reference: CollectionReference | DocumentReference) => {
      if (reference === proposals) throw failure;
    });

    await expect(
      clearCfpFirestoreChildren(firestore(recursiveDelete), root, owner.id),
    ).rejects.toBe(failure);

    expect(recursiveDelete.mock.calls.map(([reference]) => reference)).toEqual([
      reviewer,
      ownerChild,
      proposals,
    ]);
    expect(recursiveDelete).not.toHaveBeenCalledWith(root);
    expect(recursiveDelete).not.toHaveBeenCalledWith(owner);
  });

  it('revisits missing member documents so a partial deletion can converge on retry', async () => {
    const orphanedMember = document('former-reviewer');
    const owner = document('owner-uid');
    const members = collection('members', [orphanedMember, owner]);
    const releases = collection('scheduleReleases');
    const root = document('event-id', [releases, members]);
    const recursiveDelete = vi.fn().mockResolvedValue(undefined);

    await clearCfpFirestoreChildren(firestore(recursiveDelete), root, owner.id);

    expect(recursiveDelete.mock.calls.map(([reference]) => reference)).toEqual([
      releases,
      orphanedMember,
    ]);
    expect(recursiveDelete).not.toHaveBeenCalledWith(root);
    expect(recursiveDelete).not.toHaveBeenCalledWith(owner);
  });
});
