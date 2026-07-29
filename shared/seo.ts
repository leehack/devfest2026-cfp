/**
 * The tags a crawler and a link preview read, as string building and nothing
 * else.
 *
 * Separate from `functions/src/cfpPage.ts` for the usual reason things end up
 * in `shared/`: this half is pure, so it can be tested without a Firestore, a
 * network or a function runtime, and the half that has all three is left with
 * nothing to get wrong but plumbing.
 */

/** Roughly what a search result and a link preview show before cutting. */
export const DESCRIPTION_MAX = 200;

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

export interface PageMeta {
  title: string;
  description: string;
  url: string;
  siteName: string;
  /** False for a private or archived call — see the `noindex` below. */
  indexable: boolean;
}

export function metaFor(page: PageMeta): string {
  const tags = [
    `<meta name="description" content="${escapeAttr(page.description)}">`,
    `<link rel="canonical" href="${escapeAttr(page.url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeAttr(page.title)}">`,
    `<meta property="og:description" content="${escapeAttr(page.description)}">`,
    `<meta property="og:url" content="${escapeAttr(page.url)}">`,
    `<meta property="og:site_name" content="${escapeAttr(page.siteName)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeAttr(page.title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(page.description)}">`,
  ];
  // A private call is unlisted, and a crawler is exactly the audience that must
  // not be handed one. `noindex` is the only way to say so to a crawler.
  if (!page.indexable) tags.unshift(`<meta name="robots" content="noindex">`);
  return tags.join('\n    ');
}

/** Swaps the shell's title and drops the tags in before `</head>`. */
export function inject(html: string, title: string, meta: string): string {
  const withTitle = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeAttr(title)}</title>`,
  );
  return withTitle.replace(/<\/head>/i, `    ${meta}\n  </head>`);
}

/**
 * The two admin-facing routes are role-gated anyway; keeping them out of here is
 * about crawl budget and about not filling a search result page with rows of
 * "sign in", not about access.
 */
/**
 * No `Sitemap:` line, and no origin, for two reasons that point the same way.
 *
 * The directive takes an absolute URL, and this is a platform — whoever deploys
 * it picks the origin, so baking one in at build time would be baking in
 * somebody else's. And the sitemap is at `/sitemap.xml`, which is where every
 * crawler looks without being told. The line would buy nothing and could be
 * wrong.
 *
 * That leaves this a constant, which is what lets Hosting serve it as a file.
 * It cannot come from a function: the Cloud Functions runtime answers
 * `/robots.txt` and `/favicon.ico` itself, before any handler runs.
 */
/**
 * Kept out of the crawl. Not access control — the rules do that — but crawl
 * budget, and keeping a sign-in prompt out of search results.
 *
 * Named separately from `robotsTxt` because the framework emits robots.txt from
 * an object now, and the list is the part worth having one copy of.
 */
export const CRAWL_DISALLOW = ['/c/*/admin', '/c/*/review', '/c/*/submit'] as const;

export function robotsTxt(): string {
  return ['User-agent: *', 'Allow: /', ...CRAWL_DISALLOW.map((p) => `Disallow: ${p}`), ''].join(
    '\n',
  );
}

export interface SitemapEntry {
  id: string;
  /** `YYYY-MM-DD`, or absent when the CFP has never been edited. */
  lastModified?: string;
}

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = [
    `  <url><loc>${escapeAttr(origin)}/</loc></url>`,
    ...entries.map((entry) => {
      const modified = entry.lastModified ? `<lastmod>${entry.lastModified}</lastmod>` : '';
      return `  <url><loc>${escapeAttr(`${origin}/c/${entry.id}`)}</loc>${modified}</url>`;
    }),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
