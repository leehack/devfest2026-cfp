import { describe, expect, it } from 'vitest';

import {
  scheduleReleaseNeedsReshare,
  type ScheduleReleaseReadiness,
} from '../functions/src/scheduleReadiness';

const current: ScheduleReleaseReadiness = {
  revision: 7,
  sourceRevision: 7,
  sharedRevision: 7,
  sourceFingerprint: 'programme-current',
  sharedFingerprint: 'programme-current',
  projectionFingerprint: 'programme-current',
  releaseFingerprint: 'programme-current',
  sourceTaxonomyFingerprint: 'taxonomy-current',
  sharedTaxonomyFingerprint: 'taxonomy-current',
  currentTaxonomyFingerprint: 'taxonomy-current',
  sourceSpeakerPhotoFingerprint: 'photos-current',
  sharedSpeakerPhotoFingerprint: 'photos-current',
};

const staleCases = [
  ['source revision', { sourceRevision: 6 }],
  ['shared revision', { sharedRevision: -1 }],
  ['source fingerprint', { sourceFingerprint: '' }],
  ['shared fingerprint', { sharedFingerprint: '' }],
  ['working projection', { projectionFingerprint: 'programme-new' }],
  ['immutable release', { releaseFingerprint: 'programme-old' }],
  ['source taxonomy', { sourceTaxonomyFingerprint: '' }],
  ['shared taxonomy', { sharedTaxonomyFingerprint: '' }],
  ['changed taxonomy', { currentTaxonomyFingerprint: 'taxonomy-new' }],
  ['source speaker photos', { sourceSpeakerPhotoFingerprint: '' }],
  ['shared speaker photos', { sharedSpeakerPhotoFingerprint: '' }],
  ['changed speaker photos', { sharedSpeakerPhotoFingerprint: 'photos-old' }],
] satisfies ReadonlyArray<readonly [string, Partial<ScheduleReleaseReadiness>]>;

describe('schedule release readiness', () => {
  it('accepts a complete release whose immutable and working provenance agree', () => {
    expect(scheduleReleaseNeedsReshare(current)).toBe(false);
  });

  it.each(staleCases)(
    'requires a new share for incomplete or stale %s metadata',
    (_label, patch) => {
      expect(scheduleReleaseNeedsReshare({ ...current, ...patch })).toBe(true);
    },
  );
});
