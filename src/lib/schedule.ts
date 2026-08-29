import { collection, doc, getDoc, getDocs } from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import { swrFetch } from './cache';
import type {
  PublishedSchedule,
  PublishedScheduleEntry,
  ScheduleConfig,
  ScheduleEntry,
  SharedSchedule,
} from '@shared/schedule';

type WithCfp<T> = T & { cfpId: string };

export const setScheduleConfig = httpsCallable<
  WithCfp<{ config: ScheduleConfig; expectedRevision: number }>,
  { ok: boolean; revision: number }
>(functions, 'setScheduleConfig');

export const upsertScheduleEntry = httpsCallable<
  WithCfp<{ entry: ScheduleEntry; expectedRevision: number }>,
  { ok: boolean; revision: number; entryId: string }
>(functions, 'upsertScheduleEntry');

export const removeScheduleEntry = httpsCallable<
  WithCfp<{ entryId: string; expectedRevision: number }>,
  { ok: boolean; revision: number; entryId: string }
>(functions, 'removeScheduleEntry');

export const publishSchedule = httpsCallable<
  WithCfp<{ expectedRevision: number }>,
  { ok: boolean; revision: number; releaseId: string; version: number }
>(functions, 'publishSchedule');

export const shareSchedulePreview = httpsCallable<
  WithCfp<{ expectedRevision: number }>,
  {
    ok: boolean;
    releaseId: string;
    version: number;
    revision: number;
    sharedCount: number;
    omittedCount: number;
    committeeNotificationCount: number;
    speakerNotificationCount: number;
  }
>(functions, 'shareSchedulePreview');

export const unpublishSchedule = httpsCallable<
  { cfpId: string },
  { ok: boolean; releaseId: string | null; version: number | null }
>(functions, 'unpublishSchedule');

export const publicSchedulePhoto = httpsCallable<
  WithCfp<{ releaseId: string; entryId: string; speakerIndex: number }>,
  { ok: true; contentType: 'image/webp'; base64: string }
>(functions, 'publicSchedulePhoto');

export const uploadCustomScheduleSpeakerPhoto = httpsCallable<
  WithCfp<{ contentType: string; base64: string }>,
  { ok: true; assetRef: string }
>(functions, 'uploadCustomScheduleSpeakerPhoto');

export const customScheduleSpeakerPhotoImage = httpsCallable<
  WithCfp<{ assetRef: string }>,
  { ok: true; contentType: string; base64: string }
>(functions, 'customScheduleSpeakerPhotoImage');

export interface ScheduleDraft {
  config: ScheduleConfig | null;
  entries: ScheduleEntry[];
}

export async function loadScheduleDraft(
  cfpId: string,
  options: { force?: boolean; onRevalidate?: (draft: ScheduleDraft) => void } = {},
): Promise<ScheduleDraft> {
  return swrFetch(
    `scheduleDraft:${cfpId}`,
    async () => {
      const [configSnap, entriesSnap] = await Promise.all([
        getDoc(doc(db, 'cfps', cfpId, 'config', 'schedule')),
        getDocs(collection(db, 'cfps', cfpId, 'scheduleDraft')),
      ]);
      return {
        config: configSnap.exists() ? (configSnap.data() as ScheduleConfig) : null,
        entries: entriesSnap.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data() as Omit<ScheduleEntry, 'id'>),
        })) as ScheduleEntry[],
      };
    },
    { force: options.force, backgroundRevalidate: true, onRevalidate: options.onRevalidate },
  );
}

export interface PublishedScheduleBundle {
  schedule: PublishedSchedule;
  entries: PublishedScheduleEntry[];
}

export type SharedScheduleMetadata = SharedSchedule;

export interface SharedScheduleBundle {
  audience: 'committee' | 'speaker';
  schedule: SharedScheduleMetadata | null;
  entries: PublishedScheduleEntry[];
  stale: boolean;
}

const getSharedSchedule = httpsCallable<
  { cfpId: string },
  { ok: true } & SharedScheduleBundle
>(functions, 'getSharedSchedule');

export async function loadSharedSchedule(
  cfpId: string,
  options: {
    force?: boolean;
    releaseId?: string | null;
    audience?: 'committee' | 'speaker';
    onRevalidate?: (bundle: SharedScheduleBundle) => void;
  } = {},
): Promise<SharedScheduleBundle> {
  const releaseKey = options.releaseId ?? 'current';
  const audienceKey = options.audience ?? 'any';
  return swrFetch(
    `sharedSchedule:${cfpId}:${releaseKey}:${audienceKey}`,
    async () => {
      const { data } = await getSharedSchedule({ cfpId });
      return {
        audience: data.audience,
        schedule: data.schedule,
        entries: data.entries,
        stale: data.stale,
      };
    },
    { force: options.force, backgroundRevalidate: true, onRevalidate: options.onRevalidate },
  );
}

export async function loadPublishedSchedule(
  cfpId: string,
  releaseId: string,
  options: { force?: boolean } = {},
): Promise<PublishedScheduleBundle | null> {
  return swrFetch(
    `publishedSchedule:${cfpId}:${releaseId}`,
    async () => {
      const release = doc(db, 'cfps', cfpId, 'scheduleReleases', releaseId);
      const [scheduleSnap, entriesSnap] = await Promise.all([
        getDoc(release),
        getDocs(collection(release, 'entries')),
      ]);
      if (!scheduleSnap.exists()) return null;
      return {
        schedule: { id: scheduleSnap.id, ...(scheduleSnap.data() as Omit<PublishedSchedule, 'id'>) },
        entries: entriesSnap.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data() as Omit<PublishedScheduleEntry, 'id'>),
        })) as PublishedScheduleEntry[],
      };
    },
    { force: options.force, backgroundRevalidate: true },
  );
}
