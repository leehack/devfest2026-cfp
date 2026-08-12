import type { SubmissionAttendanceConfig } from '@shared/submissionForm';

import type { ReviewerSpeakerTravel } from './roles';

export type ReviewerTravelField =
  | 'status'
  | 'fundingSource'
  | 'decisionBy'
  | 'needsVisa';

/** The configured fields this review card can actually render for one speaker. */
export function reviewerTravelFields(
  attendance: SubmissionAttendanceConfig,
  speaker: ReviewerSpeakerTravel,
): ReviewerTravelField[] {
  if (!attendance.enabled) return [];

  return [
    attendance.statusReviewerVisible && speaker.status ? 'status' : null,
    attendance.fundingSource.enabled &&
    attendance.fundingSource.reviewerVisible &&
    speaker.fundingSource
      ? 'fundingSource'
      : null,
    attendance.decisionBy.enabled &&
    attendance.decisionBy.reviewerVisible &&
    speaker.decisionBy
      ? 'decisionBy'
      : null,
    attendance.needsVisa.enabled &&
    attendance.needsVisa.reviewerVisible &&
    typeof speaker.needsVisa === 'boolean'
      ? 'needsVisa'
      : null,
  ].filter((field): field is ReviewerTravelField => field !== null);
}
