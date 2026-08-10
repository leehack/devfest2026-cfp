import { toDate } from './dates';
import type { CfpState } from '@shared/cfpWindow';
import type { Cfp } from '@shared/types';

type LateIntakeCfp = Pick<Cfp, 'opensAt' | 'publishedScheduleAt' | 'publishedScheduleId'>;

/**
 * A published programme may coexist with the original intake window. It becomes
 * late intake only when the current window was opened after publication.
 */
export function isLateIntakeWindow(cfp: LateIntakeCfp, status: CfpState): boolean {
  if (status !== 'open' || !cfp.publishedScheduleId) return false;
  const opens = toDate(cfp.opensAt);
  const published = toDate(cfp.publishedScheduleAt);
  return Boolean(opens && published && opens.getTime() > published.getTime());
}

interface PublishedProgrammeSignals {
  status: CfpState;
  lateIntake: boolean;
  awaitingConfirmation: number;
  undecided: number;
  needsFirstReview: number;
  publicNeedsUpdate: boolean;
  waitingEmails: number;
}

/** The published-programme half of the 17-step organiser lifecycle. */
export function publishedProgrammeLifecycleStep({
  status,
  lateIntake,
  awaitingConfirmation,
  undecided,
  needsFirstReview,
  publicNeedsUpdate,
  waitingEmails,
}: PublishedProgrammeSignals): number {
  if (awaitingConfirmation > 0) return 15;
  if (undecided > 0) return needsFirstReview > 0 ? 13 : 14;
  if (publicNeedsUpdate) return 16;
  if (waitingEmails > 0) return 15;
  if (status === 'open') return lateIntake ? 12 : 9;
  return 11;
}
