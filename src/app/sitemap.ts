import type { MetadataRoute } from 'next';

import { listPublicCfps, readPublishedSchedule } from '../server/publicCfps';
import { paths } from '../lib/paths';
import { SITE_ORIGIN } from '../server/site';

/**
 * The function this replaces sent `public, max-age=3600`. Without a positive
 * `revalidate` the route would be built once and never refreshed, so a call
 * published after the last deploy would not appear until the next one.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = SITE_ORIGIN.replace(/\/+$/, '');
  /*
   * This route is prerendered, so an unreachable Firestore would otherwise fail
   * the build — a deployment blocked by a sitemap is a bad trade. Degrade to the
   * listing alone and let `revalidate` fill it in within the hour.
   */
  let cfps: Awaited<ReturnType<typeof listPublicCfps>> = [];
  try {
    cfps = await listPublicCfps();
  } catch {
    cfps = [];
  }
  const schedules = await Promise.all(
    cfps.map(async (cfp) => ({ cfp, bundle: await readPublishedSchedule(cfp.id).catch(() => null) })),
  );
  return [
    { url: `${origin}${paths.home()}`, changeFrequency: 'daily' as const },
    ...cfps.map((cfp) => ({
      url: `${origin}${paths.cfp(cfp.id)}`,
      // Date only, as the old sitemap emitted. Both are valid <lastmod>.
      ...(cfp.updatedAtMs
        ? { lastModified: new Date(cfp.updatedAtMs).toISOString().slice(0, 10) }
        : {}),
    })),
    ...schedules.flatMap(({ cfp, bundle }) =>
      bundle
        ? [
            { url: `${origin}${paths.schedule(cfp.id)}` },
            ...bundle.entries.map((entry) => ({
              url: `${origin}${paths.session(cfp.id, entry.id)}`,
            })),
          ]
        : [],
    ),
  ];
}
