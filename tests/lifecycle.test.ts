import { describe, expect, it } from 'vitest';

import { editScope, lateSpeakerNeedsScheduleRelease } from '../src/lib/lifecycle';
import { PROPOSAL_STATUSES } from '../shared/enums';

describe('editScope', () => {
  it('opens everything on a draft', () => {
    expect(editScope('draft', true)).toBe('all');
  });

  it('keeps a submitted talk editable — the deadline closes it, not submitting', () => {
    expect(editScope('submitted', true)).toBe('all');
  });

  it('freezes the content the moment the committee starts reading', () => {
    expect(editScope('under_review', true)).toBe('logistics');
  });

  it('leaves the travel answers open after the window shuts', () => {
    // Accepted in September, visa refused in October: the answer has to change
    // long after the CFP is over.
    for (const status of ['under_review', 'accepted', 'confirmed', 'waitlisted'] as const) {
      expect(editScope(status, false)).toBe('logistics');
    }
  });

  it('renders archived proposals read-only, matching the rules', () => {
    expect(editScope('accepted', false, true)).toBe('none');
    expect(editScope('confirmed', false, true)).toBe('none');
  });

  it('closes a draft once the window shuts', () => {
    expect(editScope('draft', false)).toBe('none');
    expect(editScope('submitted', false)).toBe('none');
  });

  it('closes everything on a dead proposal', () => {
    for (const status of ['withdrawn', 'rejected', 'declined'] as const) {
      expect(editScope(status, true)).toBe('none');
    }
  });

  it('never returns "all" for a status the committee is acting on', () => {
    // Guards the case a new status is added to the enum and forgotten here.
    for (const status of PROPOSAL_STATUSES) {
      const scope = editScope(status, true);
      if (status === 'draft' || status === 'submitted') expect(scope).toBe('all');
      else expect(scope).not.toBe('all');
    }
  });
});

describe('late-speaker schedule visibility', () => {
  const preserved = {
    lateSpeakerSchedulePreserved: true,
    lateSpeakerScheduleBaselineIds: ['lead', 'original-co-speaker'],
  };

  it('waits for a new release only for a speaker outside the preserved roster', () => {
    expect(lateSpeakerNeedsScheduleRelease(preserved, 'late-speaker')).toBe(true);
    expect(lateSpeakerNeedsScheduleRelease(preserved, 'lead')).toBe(false);
  });

  it('does not hide a current release without a valid preservation marker', () => {
    expect(
      lateSpeakerNeedsScheduleRelease(
        { ...preserved, lateSpeakerSchedulePreserved: false },
        'late-speaker',
      ),
    ).toBe(false);
    expect(
      lateSpeakerNeedsScheduleRelease(
        { lateSpeakerSchedulePreserved: true, lateSpeakerScheduleBaselineIds: [null] },
        'late-speaker',
      ),
    ).toBe(false);
    expect(
      lateSpeakerNeedsScheduleRelease(
        { lateSpeakerSchedulePreserved: true, lateSpeakerScheduleBaselineIds: [] },
        'late-speaker',
      ),
    ).toBe(false);
  });
});
