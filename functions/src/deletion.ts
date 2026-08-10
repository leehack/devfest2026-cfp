import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

/** Minimal surface used by CFP deletion, kept injectable for failure coverage. */
export interface PrefixDeleter {
  deleteFiles(options: { prefix: string }): Promise<unknown>;
}

/**
 * Storage is cleared before Firestore. A failed bucket operation must escape so
 * the deletion reservation and owner membership remain available for a retry.
 */
export async function clearCfpStorage(bucket: PrefixDeleter, cfpId: string): Promise<void> {
  await bucket.deleteFiles({ prefix: `cfps/${cfpId}/` });
}

/**
 * Clears a CFP's Firestore descendants without deleting its root or the caller's
 * owner membership. Firestore's `recursiveDelete(document)` removes that
 * document even when a descendant delete fails, so those two retry anchors must
 * be left for the final transaction.
 */
export async function clearCfpFirestoreChildren(
  firestore: Pick<Firestore, 'recursiveDelete'>,
  cfpRef: DocumentReference,
  ownerUid: string,
): Promise<void> {
  const collections = await cfpRef.listCollections();
  for (const collection of collections) {
    if (collection.id !== 'members') {
      await firestore.recursiveDelete(collection);
      continue;
    }

    // listDocuments includes missing documents that still have subcollections,
    // so a retry can finish a member subtree after an earlier partial failure.
    const members = await collection.listDocuments();
    for (const member of members) {
      if (member.id !== ownerUid) {
        await firestore.recursiveDelete(member);
        continue;
      }

      for (const child of await member.listCollections()) {
        await firestore.recursiveDelete(child);
      }
    }
  }
}
