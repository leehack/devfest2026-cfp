import type { MetadataRoute } from 'next';

import { CRAWL_DISALLOW } from '@shared/seo';

/**
 * No origin and no `Sitemap:` line, unchanged from the `robotsTxt()` this
 * replaces: the directive takes an absolute URL, and this is a platform —
 * whoever deploys it picks the origin. The sitemap is at `/sitemap.xml`, which
 * is where a crawler looks anyway.
 *
 * The three disallowed paths are about crawl budget and keeping a sign-in prompt
 * out of search results. They are not access control; the rules do that.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: [...CRAWL_DISALLOW] } };
}
