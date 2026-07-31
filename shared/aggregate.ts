/**
 * Scoring aggregation (§7). Pure functions over plain objects — no Firestore, so
 * the maths is testable without an emulator.
 *
 * Bugs here are invisible: a miscomputed ranking still looks like a ranking.
 * Hence property tests rather than expected-value tests.
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

/** Reviewer calibration: we hold every score they gave, so there is no wider population to estimate. */
function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Disagreement: these reviews are a sample of the opinions the proposal could
 * have drawn. Not interchangeable with the population form above — they differ
 * by √(n/(n−1)), which varies with n, so mixing them makes proposals with
 * unequal review counts incomparable. That is exactly the comparison the
 * committee screen makes when it sorts by disagreement.
 */
function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Per-reviewer mean and spread across everything they scored. Reviewers differ
 * in how generously they score; at 5–10 of them, correcting for it reorders the
 * ranking (§7).
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
 * Proposals with no countable reviews are omitted, not zeroed: a zero sorts as
 * though the committee judged it poorly, when nobody has looked at it.
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
      // A reviewer who scored everything the same carries no signal, and their
      // zero spread would divide to NaN. Treat them as exactly average.
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

/** Keeps float noise out of Firestore; four decimals is far beyond what the committee reads. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Committee meeting order (§7): most disagreement first — a proposal everyone
 * scored 3 needs less discussion than one that drew a 1 and a 4.
 */
export function byDisagreement(
  entries: Array<[string, Aggregate]>,
): Array<[string, Aggregate]> {
  return [...entries].sort(
    (a, b) => b[1].stdDev - a[1].stdDev || b[1].normalizedScore - a[1].normalizedScore,
  );
}

/** Ranking order for selection: normalised score descending, never the raw average. */
export function compareNormalizedScores(
  a: Aggregate | undefined,
  b: Aggregate | undefined,
): number {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return b.normalizedScore - a.normalizedScore || b.avgScore - a.avgScore;
}

export function byNormalizedScore(
  entries: Array<[string, Aggregate]>,
): Array<[string, Aggregate]> {
  return [...entries].sort((a, b) => compareNormalizedScores(a[1], b[1]));
}
