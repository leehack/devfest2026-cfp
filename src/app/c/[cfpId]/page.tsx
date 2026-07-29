import type { Metadata } from 'next';

import { ClientApp } from '../../[[...slug]]/ClientApp';
import { readCfp } from '../../../server/publicCfps';
import { paths } from '../../../lib/paths';
import { localised } from '@shared/confirmForm';
import { summarise } from '@shared/seo';

/**
 * A call's front page, rendered on a server.
 *
 * This is the segment the whole migration was for. `cfpPage.ts` existed because
 * a Slack or LinkedIn unfurl reads `<head>` and never runs the JavaScript that
 * used to set the title — so it fetched the built shell and injected tags into
 * it by hand. Next writes the same tags from `generateMetadata`, and the body
 * arrives with them.
 *
 * Dynamic rather than cached, and that is deliberate. Whether a call is private
 * is *data*, a route's cache config is module-level, and making a CFP private is
 * a Firestore write with no cache-invalidation hook — so a shared cache would
 * hold a page that has since been unlisted. `next.config.ts` pins
 * `private, no-store` on this path for the same reason.
 */
export const dynamic = 'force-dynamic';

/** English, as `cfpPage.ts` also did: a crawler sends no locale to read. */
const CRAWLER_LOCALE = 'en';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ cfpId: string }>;
}): Promise<Metadata> {
  const { cfpId } = await params;
  const cfp = await readCfp(cfpId);
  if (!cfp) return { title: 'Call for Proposals', robots: { index: false, follow: false } };

  const listed = cfp.visibility === 'public' && !cfp.archived;
  const described = summarise(localised(cfp.description ?? { en: '' }, CRAWLER_LOCALE));
  // No description is not a reason to invent one, but a bare title makes a poor
  // preview — so fall back to what is true rather than to nothing.
  const description = described || `${cfp.name} is accepting talk proposals.`;

  return {
    title: cfp.name,
    description,
    /*
     * An unlisted call must not be indexed. It is one link away from being
     * public, and a search result is one more place it can be found.
     */
    robots: listed ? undefined : { index: false, follow: false },
    alternates: { canonical: paths.cfp(cfpId) },
    openGraph: { title: cfp.name, description, url: paths.cfp(cfpId), type: 'website' },
    twitter: { card: 'summary', title: cfp.name, description },
  };
}

export default async function CfpFrontPage({ params }: { params: Promise<{ cfpId: string }> }) {
  const { cfpId } = await params;
  return <ClientApp initialPath={paths.cfp(cfpId)} />;
}
