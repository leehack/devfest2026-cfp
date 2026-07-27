/**
 * Scoring aggregation — §7.
 *
 * Deliberately free of any Firestore dependency. The caller loads reviews and
 * writes the results; everything here is a pure function over plain objects, so
 * the maths can be tested without an emulator, a UI, or network access.
 *
 * The whole point of this file is that its bugs are invisible. A miscomputed
 * ranking still looks like a perfectly plausible ranking, and nobody eyeballs a
 * z-score and notices it is wrong — so the tests assert *properties* (raw and
 * normalised orderings disagree in a specific way) rather than checking that
 * numbers come out.
 */

export interface ReviewRecord {
  proposalId: string;
  reviewerUid: string;
  /** 1 Pass · 2 Maybe · 3 Yes · 4 Strong yes */
  score: number;
  /** true → excluded from every calculation, including the reviewer's own calibration. */
  conflictOfInterest?: boolean;
}

export interface Aggregate {
  /** Mean of the raw 1–4 scores. Shown for context; do not rank on it (§7). */
  avgScore: number;
  /** Mean of the per-reviewer z-scores. This is the ranking key. */
  normalizedScore: number;
  /** Reviews actually counted — conflicts excluded. */
  reviewCount: number;
  /** Spread of the raw scores. The committee screen sorts by this, descending. */
  stdDev: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Population standard deviation — used for reviewer calibration, where we
 * genuinely hold every score that reviewer gave. There is no wider population
 * to estimate.
 */
function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Sample standard deviation — used for the disagreement metric, where the
 * reviews are a sample of the opinions the proposal could have drawn.
 *
 * The distinction matters when review counts differ between proposals, which
 * they will if reviewers are partitioned rather than all seeing everything (an
 * open question in the spec). Population and sample sd differ by a factor of
 * sqrt(n/(n-1)) that *varies with n*, so mixing them would make proposals with
 * different review counts incomparable — precisely the sort you are doing when
 * you sort the committee screen by disagreement.
 */
function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Per-reviewer mean and spread across everything they scored.
 *
 * Reviewers differ in how generously they score, and §7 is explicit that at
 * 5–10 reviewers correcting for it genuinely reorders the ranking.
 */
export function reviewerCalibration(
  reviews: ReviewRecord[],
): Map<string, { mean: number; stdDev: number; count: number }> {
  const byReviewer = new Map<string, number[]>();
  for (const r of reviews) {
    if (r.conflictOfInterest) continue;
    const list = byReviewer.get(r.reviewerUid) ?? [];
    list.push(r.score);
    byReviewer.set(r.reviewerUid, list);
  }

  const out = new Map<string, { mean: number; stdDev: number; count: number }>();
  for (const [uid, scores] of byReviewer) {
    out.set(uid, {
      mean: mean(scores),
      stdDev: populationStdDev(scores),
      count: scores.length,
    });
  }
  return out;
}

/**
 * Computes an aggregate for every proposal appearing in `reviews`.
 *
 * Proposals with no countable reviews are omitted entirely rather than returned
 * as zeroes — a zero would sort as though the committee had judged it poorly,
 * when in fact nobody has looked at it. The caller decides how to surface that.
 */
export function aggregateReviews(reviews: ReviewRecord[]): Map<string, Aggregate> {
  const counted = reviews.filter((r) => !r.conflictOfInterest);
  const calibration = reviewerCalibration(counted);

  const byProposal = new Map<string, ReviewRecord[]>();
  for (const r of counted) {
    const list = byProposal.get(r.proposalId) ?? [];
    list.push(r);
    byProposal.set(r.proposalId, list);
  }

  const out = new Map<string, Aggregate>();
  for (const [proposalId, rs] of byProposal) {
    const raw = rs.map((r) => r.score);

    const zScores = rs.map((r) => {
      const cal = calibration.get(r.reviewerUid);
      // A reviewer who gave everything the same score carries no discriminating
      // signal, and dividing by their zero spread would be a NaN. Treat them as
      // exactly average — they neither lift nor sink the proposal.
      if (!cal || cal.stdDev === 0) return 0;
      return (r.score - cal.mean) / cal.stdDev;
    });

    out.set(proposalId, {
      avgScore: round(mean(raw)),
      normalizedScore: round(mean(zScores)),
      reviewCount: rs.length,
      stdDev: round(sampleStdDev(raw)),
    });
  }
  return out;
}

/** Four decimals is far beyond committee-relevant precision; it just keeps float noise out of Firestore. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Committee meeting order (§7): most disagreement first, because a proposal
 * everyone scored 3 needs less discussion than one that drew a 1 and a 4.
 * Ties fall back to normalised score so the ordering is stable.
 */
export function byDisagreement(
  entries: Array<[string, Aggregate]>,
): Array<[string, Aggregate]> {
  return [...entries].sort(
    (a, b) => b[1].stdDev - a[1].stdDev || b[1].normalizedScore - a[1].normalizedScore,
  );
}

/** Ranking order for selection: normalised score descending, never the raw average. */
export function byNormalizedScore(
  entries: Array<[string, Aggregate]>,
): Array<[string, Aggregate]> {
  return [...entries].sort(
    (a, b) => b[1].normalizedScore - a[1].normalizedScore || b[1].avgScore - a[1].avgScore,
  );
}
