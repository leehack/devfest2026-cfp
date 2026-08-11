export interface ScheduleReleaseReadiness {
  revision: number;
  sourceRevision: number;
  sharedRevision: number;
  sourceFingerprint: string;
  sharedFingerprint: string;
  projectionFingerprint: string;
  releaseFingerprint: string;
  sourceTaxonomyFingerprint: string;
  sharedTaxonomyFingerprint: string;
  currentTaxonomyFingerprint: string;
  sourceSpeakerPhotoFingerprint: string;
  sharedSpeakerPhotoFingerprint: string;
}

/** A legacy or incomplete snapshot must be shared again before it is published. */
export function scheduleReleaseNeedsReshare(value: ScheduleReleaseReadiness): boolean {
  return (
    value.sourceRevision !== value.revision ||
    value.sharedRevision !== value.revision ||
    !value.sourceFingerprint ||
    value.sharedFingerprint !== value.sourceFingerprint ||
    value.projectionFingerprint !== value.sourceFingerprint ||
    value.releaseFingerprint !== value.sourceFingerprint ||
    !value.sourceTaxonomyFingerprint ||
    !value.sharedTaxonomyFingerprint ||
    value.sourceTaxonomyFingerprint !== value.currentTaxonomyFingerprint ||
    value.sharedTaxonomyFingerprint !== value.currentTaxonomyFingerprint ||
    !value.sourceSpeakerPhotoFingerprint ||
    !value.sharedSpeakerPhotoFingerprint ||
    value.sourceSpeakerPhotoFingerprint !== value.sharedSpeakerPhotoFingerprint
  );
}
