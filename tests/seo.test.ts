/**
 * What is left of the SEO layer once the framework owns the tags.
 *
 * The tests for `metaFor`, `inject`, `robotsTxt` and `sitemapXml` went with those
 * functions. Their claims did not: "Open Graph and Twitter carry the same words",
 * "an unlisted call tells a crawler to stay away", "the sitemap lists every
 * public call" are all asserted against the real rendered output now, in
 * `tests/e2e/cfpPage.spec.ts` — which is a better place for them, because it is
 * the served bytes rather than a string builder that has to be right.
 */

import { describe, expect, it } from 'vitest';

import { CRAWL_DISALLOW, summarise } from '../shared/seo';

describe('cutting a description down', () => {
  it('leaves one that already fits alone, ellipsis and all', () => {
    expect(summarise('A short one.')).toBe('A short one.');
    expect(summarise('A short one.')).not.toContain('…');
  });

  it('flattens the paragraph breaks a textarea produces', () => {
    expect(summarise('One line.\n\n  Another   line.')).toBe('One line. Another line.');
  });

  it('cuts at a word, and never leaves the punctuation before it', () => {
    const cut = summarise('alpha beta gamma delta, epsilon zeta', 22);
    expect(cut).toBe('alpha beta gamma delta…');
    expect(cut.length).toBeLessThanOrEqual(24);
  });

  /* A single word longer than the whole budget has no space to cut at, and
     returning the untouched string would defeat the limit. */
  it('cuts mid-word rather than overrun', () => {
    expect(summarise('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('what stays out of the crawl', () => {
  it('names the three role-gated paths and nothing else', () => {
    // Not access control — the rules do that. This is crawl budget, and keeping
    // "sign in" out of a search result page.
    expect([...CRAWL_DISALLOW]).toEqual(['/c/*/admin', '/c/*/review', '/c/*/submit']);
  });

  it('names no origin, because this is a platform', () => {
    for (const path of CRAWL_DISALLOW) {
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toMatch(/^https?:/);
    }
  });
});
