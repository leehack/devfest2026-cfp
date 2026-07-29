import 'server-only';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import type { Localised } from '@shared/confirmForm';

/**
 * The only server-side reads in this application, and deliberately the only
 * ones.
 *
 * Every one of them is a document the rules already publish to anybody
 * (`firestore.rules`: `allow get: if true` on `cfps/{id}`, and a `list` gated on
 * the two clauses mirrored below). The admin SDK bypasses rules entirely, so the
 * discipline is a boundary rather than a convenience: nothing exported from this
 * directory takes a uid, and nothing that needs to know *who is asking* belongs
 * here. Everything authenticated stays on the client SDK, where
 * `firestore.rules` is still the thing deciding.
 *
 * `server-only` makes the mistake a build error rather than a leak.
 */

function db() {
  if (!getApps().length) {
    /*
     * App Hosting and the Cloud Functions runtime both supply credentials; a
     * developer running `next dev` against the emulators supplies none and does
     * not need any, because FIRESTORE_EMULATOR_HOST short-circuits the auth.
     */
    initializeApp(
      process.env.FIRESTORE_EMULATOR_HOST
        ? { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID }
        : { credential: applicationDefault() },
    );
  }
  return getFirestore();
}

/** What a public page needs, with nothing in it that cannot be serialised. */
export interface PublicCfp {
  id: string;
  name: string;
  description: Localised | null;
  website: string | null;
  venue: string | null;
  location: string | null;
  /** Epoch millis, because a Timestamp does not survive the trip to a browser. */
  opensAtMs: number;
  closesAtMs: number;
  eventDateMs: number | null;
  updatedAtMs: number | null;
  archived: boolean;
  visibility: 'public' | 'private';
}

const ms = (value: unknown): number | null => {
  const at = (value as { toMillis?: () => number } | undefined)?.toMillis?.();
  return typeof at === 'number' ? at : null;
};

function shape(id: string, data: Record<string, unknown>): PublicCfp {
  return {
    id,
    name: (data.name as string) ?? id,
    description: (data.description as Localised) ?? null,
    website: (data.website as string) ?? null,
    venue: (data.venue as string) ?? null,
    location: (data.location as string) ?? null,
    opensAtMs: ms(data.opensAt) ?? 0,
    closesAtMs: ms(data.closesAt) ?? 0,
    eventDateMs: ms(data.eventDate),
    updatedAtMs: ms(data.updatedAt),
    archived: data.archived === true,
    visibility: data.visibility === 'private' ? 'private' : 'public',
  };
}

/**
 * One CFP, or null. Readable by anyone, listed or not — `private` means unlisted,
 * not secret, which is the rules' own position. Whether it may be *indexed* is a
 * separate question, answered by the caller.
 */
export async function readCfp(cfpId: string): Promise<PublicCfp | null> {
  const snap = await db().doc(`cfps/${cfpId}`).get();
  if (!snap.exists) return null;
  return shape(snap.id, snap.data() as Record<string, unknown>);
}

/**
 * The directory. One function for both the listing and the sitemap, because two
 * copies of this query is exactly how `publicCfps` in `cfpPage.ts` came to sit
 * beside `loadPublicCfps` in `src/lib/roles.ts`, free to drift apart.
 *
 * The two clauses are not a filter to tidy up — they mirror `firestore.rules`
 * exactly, and widening them here would publish through the admin SDK what the
 * rules refuse to list.
 */
export async function listPublicCfps(): Promise<PublicCfp[]> {
  const snap = await db()
    .collection('cfps')
    .where('visibility', '==', 'public')
    .where('archived', '==', false)
    .get();
  return snap.docs.map((doc) => shape(doc.id, doc.data() as Record<string, unknown>));
}


