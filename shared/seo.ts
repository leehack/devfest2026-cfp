/**
 * The two decisions about what a crawler sees that are ours rather than the
 * framework's.
 *
 * There used to be a lot more here — `metaFor`, `inject`, `robotsTxt`,
 * `sitemapXml`, `escapeAttr` — because the tags had to be assembled as strings
 * and spliced into a built HTML shell by hand. `generateMetadata`,
 * `src/app/robots.ts` and `src/app/sitemap.ts` do that now, from objects, and
 * hand-escaped strings fed into that layer would only be escaped twice.
 *
 * What is left is pure and testable without a Firestore or a network, which is
 * why it is still in `shared/`.
 */

/** Roughly what a search result and a link preview show before cutting. */
export const DESCRIPTION_MAX = 200;

/**
 * A description written for a page, cut to something a preview shows whole.
 *
 * Cut at a word rather than mid-syllable, and only when there is more to say —
 * an ellipsis on a description that already fit reads as a truncation that did
 * not happen.
 */
export function summarise(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const letter = /[\p{L}\p{N}]/u;
  // Whether the cut landed inside a word or between two. Punctuation counts as
  // between: "delta," loses only its comma, and dropping the whole word for
  // that would throw away one that fit.
  const splitsAWord = letter.test(flat[max]) && letter.test(flat[max - 1]);

  const lastSpace = cut.lastIndexOf(' ');
  // Back up to the previous word — unless that would cost most of the budget,
  // which happens when one word is longer than the whole allowance.
  const kept = splitsAWord && lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * Kept out of the crawl. Not access control — the rules do that — but crawl
 * budget, and keeping a sign-in prompt out of search results.
 *
 * A list rather than a rendered file, because `src/app/robots.ts` takes an
 * object. It still names no origin: this is a platform, whoever deploys it picks
 * the origin, and the sitemap is at `/sitemap.xml` where a crawler looks anyway.
 */
export const CRAWL_DISALLOW = ['/c/*/admin', '/c/*/review', '/c/*/submit'] as const;
