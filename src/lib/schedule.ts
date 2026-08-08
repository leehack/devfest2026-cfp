import { collection, doc, getDoc, getDocs } from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../firebase';
import type {
  PublishedSchedule,
  PublishedScheduleEntry,
  ScheduleConfig,
  ScheduleEntry,
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

export interface ScheduleDraft {
  config: ScheduleConfig | null;
  entries: ScheduleEntry[];
}

export async function loadScheduleDraft(cfpId: string): Promise<ScheduleDraft> {
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
}

export interface PublishedScheduleBundle {
  schedule: PublishedSchedule;
  entries: PublishedScheduleEntry[];
}

export async function loadPublishedSchedule(
  cfpId: string,
  releaseId: string,
): Promise<PublishedScheduleBundle | null> {
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
}
