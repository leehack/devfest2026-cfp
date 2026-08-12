import { describe, expect, it } from 'vitest';

import { reviewerTravelFields } from '../src/lib/reviewerTravel';
import { DEFAULT_SUBMISSION_FORM } from '@shared/submissionForm';

const attendance = () => structuredClone(DEFAULT_SUBMISSION_FORM.attendance);

describe('reviewer travel fields', () => {
  it('renders no travel fields when the event disables attendance', () => {
    const shape = attendance();
    shape.enabled = false;

    expect(
      reviewerTravelFields(shape, {
        uid: 'speaker',
        name: 'Speaker',
        status: 'pending',
        fundingSource: 'Community grant',
        decisionBy: '2026-10-01',
        needsVisa: true,
      }),
    ).toEqual([]);
  });

  it('returns exactly the enabled, reviewer-visible fields with values', () => {
    const shape = attendance();
    shape.fundingSource.reviewerVisible = false;
    shape.decisionBy.enabled = false;

    expect(
      reviewerTravelFields(shape, {
        uid: 'speaker',
        name: 'Speaker',
        status: 'secured',
        fundingSource: 'Employer',
        decisionBy: '2026-10-01',
        needsVisa: false,
      }),
    ).toEqual(['status', 'needsVisa']);
  });

  it('renders no travel fields when every collected answer is reviewer-hidden', () => {
    const shape = attendance();
    shape.statusReviewerVisible = false;
    shape.fundingSource.reviewerVisible = false;
    shape.decisionBy.reviewerVisible = false;
    shape.needsVisa.reviewerVisible = false;

    expect(
      reviewerTravelFields(shape, {
        uid: 'speaker',
        name: 'Speaker',
        status: 'pending',
        fundingSource: 'Community grant',
        decisionBy: '2026-10-01',
        needsVisa: true,
      }),
    ).toEqual([]);
  });
});
