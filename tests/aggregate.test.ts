/**
 * Property tests for the scoring maths (§7).
 *
 * Run with:  npm test          (no emulator, no Java, no network)
 *
 * These deliberately do not assert "the function returns a number". A fixture
 * where every reviewer is calibrated identically would make normalisation a
 * no-op, and such a suite would pass while proving the feature does nothing.
 * Every test below encodes a claim the spec actually makes.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateReviews,
  byDisagreement,
  byNormalizedScore,
  reviewerCalibration,
  type ReviewRecord,
} from '@shared/aggregate';

const review = (
  proposalId: string,
  reviewerUid: string,
  score: number,
  conflictOfInterest = false,
): ReviewRecord => ({ proposalId, reviewerUid, score, conflictOfInterest });

describe('reviewer calibration', () => {
  it('measures each reviewer independently', () => {
    const cal = reviewerCalibration([
      review('p1', 'harsh', 1),
      review('p2', 'harsh', 2),
      review('p1', 'generous', 3),
      review('p2', 'generous', 4),
    ]);

    expect(cal.get('harsh')!.mean).toBe(1.5);
    expect(cal.get('generous')!.mean).toBe(3.5);
  });

  it('ignores conflicted reviews when calibrating', () => {
    // The 4 is a conflict, so it must not inflate this reviewer's baseline —
    // otherwise flagging a conflict would quietly penalise everything else
    // they scored.
    const cal = reviewerCalibration([
      review('p1', 'r', 2),
      review('p2', 'r', 2),
      review('p3', 'r', 4, true),
    ]);

    expect(cal.get('r')!.mean).toBe(2);
    expect(cal.get('r')!.count).toBe(2);
  });
});

describe('normalisation reorders the ranking', () => {
  /**
   * The central claim of §7: "Do not sort on raw average."
   *
   * `alpha` is the weakest thing a generous reviewer saw. `beta` is the
   * strongest thing a harsh reviewer saw. On raw average alpha wins, because
   * a generous 3 beats a harsh 2. Relative to each reviewer's own distribution
   * that ordering is exactly backwards.
   */
  const reviews: ReviewRecord[] = [
    // Generous reviewer: gives out 4s, and alpha is the one they liked least.
    review('alpha', 'generous', 3),
    review('gamma', 'generous', 4),
    review('delta', 'generous', 4),
    review('epsilon', 'generous', 4),

    // Harsh reviewer: gives out 1s, and beta is the one they liked most.
    review('beta', 'harsh', 2),
    review('zeta', 'harsh', 1),
    review('eta', 'harsh', 1),
    review('theta', 'harsh', 1),
  ];

  const agg = aggregateReviews(reviews);

  it('ranks alpha above beta on the raw average', () => {
    expect(agg.get('alpha')!.avgScore).toBe(3);
    expect(agg.get('beta')!.avgScore).toBe(2);
    expect(agg.get('alpha')!.avgScore).toBeGreaterThan(agg.get('beta')!.avgScore);
  });

  it('ranks beta above alpha once normalised — the orderings genuinely disagree', () => {
    expect(agg.get('beta')!.normalizedScore).toBeGreaterThan(
      agg.get('alpha')!.normalizedScore,
    );
  });

  it('puts beta first when sorting the selection list', () => {
    const ranked = byNormalizedScore([...agg.entries()]).map(([id]) => id);
    expect(ranked.indexOf('beta')).toBeLessThan(ranked.indexOf('alpha'));
  });

  it('marks the generous reviewer’s weakest pick as below their own average', () => {
    expect(agg.get('alpha')!.normalizedScore).toBeLessThan(0);
    expect(agg.get('beta')!.normalizedScore).toBeGreaterThan(0);
  });
});

describe('conflicts of interest are excluded', () => {
  it('does not let a conflicted review move the mean', () => {
    const withConflict = aggregateReviews([
      review('p1', 'a', 2),
      review('p1', 'b', 2),
      review('p1', 'colleague', 4, true),
    ]);
    const without = aggregateReviews([review('p1', 'a', 2), review('p1', 'b', 2)]);

    expect(withConflict.get('p1')!.avgScore).toBe(without.get('p1')!.avgScore);
    expect(withConflict.get('p1')!.reviewCount).toBe(2);
  });

  it('omits a proposal whose only review was conflicted', () => {
    const agg = aggregateReviews([review('p1', 'colleague', 4, true)]);
    // Not returned as a zero — a zero would sort as though the committee judged
    // it poorly, when in fact nobody has assessed it.
    expect(agg.has('p1')).toBe(false);
  });
});

describe('disagreement drives the committee agenda', () => {
  const agg = aggregateReviews([
    // Unanimous.
    review('agreed', 'a', 3),
    review('agreed', 'b', 3),
    review('agreed', 'c', 3),
    // Split down the middle.
    review('contested', 'a', 1),
    review('contested', 'b', 4),
    review('contested', 'c', 1),
  ]);

  it('scores a unanimous proposal at zero spread', () => {
    expect(agg.get('agreed')!.stdDev).toBe(0);
  });

  it('gives a split proposal a higher spread', () => {
    expect(agg.get('contested')!.stdDev).toBeGreaterThan(agg.get('agreed')!.stdDev);
  });

  it('sorts the contested proposal to the top of the agenda', () => {
    const agenda = byDisagreement([...agg.entries()]).map(([id]) => id);
    expect(agenda[0]).toBe('contested');
  });

  /**
   * Pins the choice of estimator.
   *
   * Population and sample sd differ by sqrt(n/(n-1)), a factor that *varies
   * with n* — so with unequal review counts the two disagree about which
   * proposal is more contested, and the committee agenda comes out in a
   * different order. Unequal counts are not hypothetical: they are what you get
   * the moment reviewers are given a partitioned subset rather than everything,
   * which the spec lists as an open question.
   *
   * `few`  : 3 reviews, sum of squares 6    → population 1.414, sample 1.732
   * `many` : 6 reviews, sum of squares 13.5 → population 1.500, sample 1.643
   *
   * Population ranks `many` first. Sample ranks `few` first. This test fails if
   * anyone swaps them.
   */
  it('uses the sample estimator, so unequal review counts stay comparable', () => {
    const mixed = aggregateReviews([
      review('few', 'r1', 1),
      review('few', 'r2', 4),
      review('few', 'r3', 4),

      review('many', 'r1', 1),
      review('many', 'r2', 1),
      review('many', 'r3', 1),
      review('many', 'r4', 4),
      review('many', 'r5', 4),
      review('many', 'r6', 4),
    ]);

    expect(mixed.get('few')!.stdDev).toBeCloseTo(Math.sqrt(3), 3);
    expect(mixed.get('many')!.stdDev).toBeCloseTo(Math.sqrt(2.7), 3);

    const agenda = byDisagreement([...mixed.entries()]).map(([id]) => id);
    expect(agenda).toEqual(['few', 'many']);
  });
});

describe('degenerate inputs do not produce NaN', () => {
  it('handles a reviewer who scored everything identically', () => {
    // Zero spread would be a divide-by-zero. Such a reviewer carries no
    // discriminating signal, so they should neither lift nor sink anything.
    const agg = aggregateReviews([
      review('p1', 'flat', 3),
      review('p2', 'flat', 3),
      review('p3', 'flat', 3),
    ]);

    for (const id of ['p1', 'p2', 'p3']) {
      expect(Number.isNaN(agg.get(id)!.normalizedScore)).toBe(false);
      expect(agg.get(id)!.normalizedScore).toBe(0);
    }
  });

  it('handles a reviewer with exactly one review', () => {
    const agg = aggregateReviews([review('p1', 'only', 4)]);
    expect(Number.isNaN(agg.get('p1')!.normalizedScore)).toBe(false);
    expect(agg.get('p1')!.stdDev).toBe(0);
  });

  it('handles an empty review set', () => {
    expect(aggregateReviews([]).size).toBe(0);
  });

  it('never emits NaN across a mixed realistic set', () => {
    const reviews: ReviewRecord[] = [
      review('p1', 'a', 4),
      review('p1', 'b', 1),
      review('p2', 'a', 4),
      review('p2', 'c', 2, true),
      review('p3', 'b', 1),
      review('p3', 'c', 3),
    ];
    for (const [, a] of aggregateReviews(reviews)) {
      expect(Number.isFinite(a.avgScore)).toBe(true);
      expect(Number.isFinite(a.normalizedScore)).toBe(true);
      expect(Number.isFinite(a.stdDev)).toBe(true);
    }
  });
});
