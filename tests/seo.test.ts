import { describe, expect, it } from 'vitest';

import { inject, metaFor, robotsTxt, sitemapXml, summarise } from '../shared/seo';

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Call for proposals</title>
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

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

describe('the tags', () => {
  const base = {
    title: 'DevFest Montréal 2026',
    description: 'Talks about building things.',
    url: 'https://cfp.example/c/devfest-mtl-2026',
    siteName: 'Calls for proposals',
    indexable: true,
  };

  it('carries the same words to Open Graph and to Twitter', () => {
    const meta = metaFor(base);
    expect(meta).toContain('<meta property="og:title" content="DevFest Montréal 2026">');
    expect(meta).toContain('<meta name="twitter:title" content="DevFest Montréal 2026">');
    expect(meta).toContain(`<link rel="canonical" href="${base.url}">`);
    expect(meta).not.toContain('noindex');
  });

  /*
   * The one that matters: private means unlisted, and the audience it has to be
   * unlisted *from* is a crawler. Everything else about a private call is a
   * courtesy; this is the mechanism.
   */
  it('tells a crawler to stay away from an unlisted call', () => {
    expect(metaFor({ ...base, indexable: false })).toContain(
      '<meta name="robots" content="noindex">',
    );
  });

  /*
   * A CFP name is typed by an organiser and lands inside an HTML attribute. A
   * quote in it would close the attribute and everything after it would be
   * markup somebody else wrote.
   */
  it('escapes a name that would otherwise break out of the attribute', () => {
    const meta = metaFor({ ...base, title: 'Ship "it" & <script>alert(1)</script>' });
    expect(meta).not.toContain('<script>');
    expect(meta).toContain('&quot;it&quot; &amp; &lt;script&gt;');
  });
});

describe('putting them into the shell', () => {
  it('replaces the title and keeps the script tag', () => {
    const html = inject(SHELL, 'DevFest Montréal 2026 — Calls', metaFor({
      title: 'DevFest Montréal 2026',
      description: 'Talks.',
      url: 'https://cfp.example/c/devfest-mtl-2026',
      siteName: 'Calls',
      indexable: true,
    }));

    expect(html).toContain('<title>DevFest Montréal 2026 — Calls</title>');
    expect(html).not.toContain('<title>Call for proposals</title>');
    expect(html).toContain('src="/assets/index-abc.js"');
    // Inside the head, or a crawler that stops at </head> never sees it.
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
  });
});

describe('robots and the sitemap', () => {
  it('points a crawler at the sitemap and away from the committee', () => {
    const txt = robotsTxt('https://cfp.example');
    expect(txt).toContain('Sitemap: https://cfp.example/sitemap.xml');
    expect(txt).toContain('Disallow: /c/*/admin');
  });

  it('lists the front door and every call given to it', () => {
    const xml = sitemapXml('https://cfp.example', [
      { id: 'devfest-mtl-2026', lastModified: '2026-07-01' },
      { id: 'other-conf' },
    ]);
    expect(xml).toContain('<loc>https://cfp.example/</loc>');
    expect(xml).toContain(
      '<loc>https://cfp.example/c/devfest-mtl-2026</loc><lastmod>2026-07-01</lastmod>',
    );
    // No `lastmod` at all rather than an empty one, which is not valid.
    expect(xml).toContain('<loc>https://cfp.example/c/other-conf</loc></url>');
  });
});
