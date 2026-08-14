import 'server-only';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { cache } from 'react';

import type { Localised } from '@shared/confirmForm';
import type { PublishedSchedule, PublishedScheduleEntry } from '@shared/schedule';

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
  /** A calendar day, not an instant — the CFP document stores `YYYY-MM-DD`. */
  eventDate: string | null;
  eventStartDate: string | null;
  eventEndDate: string | null;
  timeZone: string | null;
  sharedScheduleId: string | null;
  publishedScheduleId: string | null;
  updatedAtMs: number | null;
  paused: boolean;
  archived: boolean;
  visibility: 'public' | 'private';
  orgId?: string;
  theme?: {
    primaryColor?: string;
    accentColor?: string;
    mastheadBg?: string;
  };
  features?: {
    blindReview?: boolean;
  };
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
    eventDate: typeof data.eventDate === 'string' ? data.eventDate : null,
    eventStartDate:
      typeof data.eventStartDate === 'string'
        ? data.eventStartDate
        : typeof data.eventDate === 'string'
          ? data.eventDate
          : null,
    eventEndDate:
      typeof data.eventEndDate === 'string'
        ? data.eventEndDate
        : typeof data.eventStartDate === 'string'
          ? data.eventStartDate
          : typeof data.eventDate === 'string'
            ? data.eventDate
            : null,
    timeZone: typeof data.timeZone === 'string' ? data.timeZone : null,
    sharedScheduleId:
      typeof data.sharedScheduleId === 'string' ? data.sharedScheduleId : null,
    publishedScheduleId:
      typeof data.publishedScheduleId === 'string' ? data.publishedScheduleId : null,
    updatedAtMs: ms(data.updatedAt),
    paused: data.paused === true,
    archived: data.archived === true,
    visibility: data.visibility === 'private' ? 'private' : 'public',
    orgId: typeof data.orgId === 'string' ? data.orgId : undefined,
    theme: data.theme as PublicCfp['theme'],
    features: data.features as PublicCfp['features'],
  };
}

/**
 * One CFP, or null. Readable by anyone, listed or not — `private` means unlisted,
 * not secret, which is the rules' own position. Whether it may be *indexed* is a
 * separate question, answered by the caller.
 */
export const readCfp = cache(async (cfpId: string): Promise<PublicCfp | null> => {
  const snap = await db().doc(`cfps/${cfpId}`).get();
  return snap.exists ? shape(snap.id, snap.data() as Record<string, unknown>) : null;
});

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

export interface ServerPublishedSchedule {
  schedule: PublishedSchedule;
  entries: PublishedScheduleEntry[];
}

/** Reads only the release named by the public CFP document. */
export const readPublishedSchedule = cache(
  async (cfpId: string): Promise<ServerPublishedSchedule | null> => {
    const cfp = await readCfp(cfpId);
    if (!cfp?.publishedScheduleId) return null;
    const ref = db().doc(`cfps/${cfpId}/scheduleReleases/${cfp.publishedScheduleId}`);
    const [release, entries] = await Promise.all([ref.get(), ref.collection('entries').get()]);
    if (!release.exists) return null;
    const data = release.data() as Pick<
      PublishedSchedule,
      'version' | 'timeZone' | 'days' | 'rooms'
    >;
    return {
      schedule: {
        id: release.id,
        version: data.version,
        timeZone: data.timeZone,
        days: data.days,
        rooms: data.rooms,
        publishedAt: ms(release.get('publishedAt')) ?? 0,
      },
      entries: entries.docs.map((entry) => {
        // Trigger audit timestamps are intentionally not part of the public
        // model. Firestore Timestamps are class instances and cannot cross the
        // Server Component boundary; the boolean is the attendee-facing fact.
        const data = Object.fromEntries(
          Object.entries(entry.data()).filter(([key]) => key !== 'cancelledAt' && key !== 'updatedAt'),
        );
        return { id: entry.id, ...data } as PublishedScheduleEntry;
      }),
    };
  },
);
