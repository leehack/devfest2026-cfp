/**
 * The HTML a crawler and a link preview actually read.
 *
 * The app sets `document.title` once it has loaded, which is enough for a
 * browser tab and worth nothing to anybody else: Slack, LinkedIn, iMessage and
 * every search crawler read the HTML as served and never run the script. So one
 * Hosting rewrite sends the front page of each call — and only the front page —
 * through here, where the shell comes back with the CFP's own title,
 * description and Open Graph tags already in it.
 *
 * Deliberately narrow. `/c/*` is a single segment, so `/c/{id}/submit`,
 * `/c/{id}/review` and the admin tabs still come straight off the CDN as static
 * files. Speakers filling in a form should not be paying for a function
 * invocation, and none of those pages is anybody's to index.
 *
 * The tag building itself is in `shared/seo.ts`, where it can be tested.
 */

import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { localised } from '../../shared/confirmForm';
import { inject, metaFor, robotsTxt, sitemapXml, summarise, type SitemapEntry } from '../../shared/seo';
import type { Cfp } from '../../shared/types';
import { loadPlatform } from './email';

const REGION = 'northamerica-northeast1';

/**
 * The shell, fetched once per instance from Hosting rather than bundled.
 *
 * A bundled copy is a copy: it goes stale the first time the app is deployed
 * without the functions, and then this serves an index.html naming asset files
 * that no longer exist — a blank page, delivered with confidence.
 */
let shell: string | null = null;

async function loadShell(origin: string): Promise<string> {
  if (shell) return shell;
  const response = await fetch(`${origin}/index.html`);
  if (!response.ok) throw new Error(`shell ${response.status} from ${origin}`);
  shell = await response.text();
  return shell;
}

async function publicCfps(db: Firestore): Promise<SitemapEntry[]> {
  const snap = await db
    .collection('cfps')
    .where('visibility', '==', 'public')
    .where('archived', '==', false)
    .get();
  return snap.docs.map((doc) => {
    const updatedAt = (doc.get('updatedAt') as { toDate?: () => Date } | undefined)?.toDate?.();
    return {
      id: doc.id,
      ...(updatedAt ? { lastModified: updatedAt.toISOString().slice(0, 10) } : {}),
    };
  });
}

export const cfpPage = onRequest(
  { region: REGION, maxInstances: 10, invoker: 'public' },
  async (req, res) => {
    const db = getFirestore();
    const platform = await loadPlatform(db);
    const origin = platform.publicUrl.replace(/\/+$/, '');
    const path = req.path.split('?')[0];

    if (path === '/robots.txt') {
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('text/plain').send(robotsTxt(origin));
      return;
    }

    if (path === '/sitemap.xml') {
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('application/xml').send(sitemapXml(origin, await publicCfps(db)));
      return;
    }

    let html: string;
    try {
      html = await loadShell(origin);
    } catch (error) {
      // Never cached: a blip the CDN stored would outlive itself by an hour,
      // and reloading is the fix for this one.
      logger.error('could not read the app shell', { origin, error });
      res.status(503).set('Cache-Control', 'no-store').type('text/plain');
      res.send('The page could not be assembled. Please reload.');
      return;
    }

    const cfpId = /^\/c\/([^/]+)\/?$/.exec(path)?.[1];
    const snap = cfpId ? await db.doc(`cfps/${cfpId}`).get() : null;
    if (!snap?.exists) {
      // The shell still goes out: the app renders "no call at this address",
      // which is a better answer than a Hosting error page, and 404 is the
      // truthful status to render it with.
      res.status(404).set('Cache-Control', 'no-store').type('text/html').send(html);
      return;
    }

    const cfp = snap.data() as Cfp;
    const listed = cfp.visibility === 'public' && cfp.archived !== true;
    const description = summarise(localised(cfp.description, 'en'));

    const meta = metaFor({
      title: cfp.name,
      // No description is not a reason to invent one, but a bare title makes a
      // poor preview — so fall back to what is true rather than to nothing.
      description: description || `${cfp.name} is accepting talk proposals.`,
      url: `${origin}/c/${cfpId}`,
      siteName: platform.name,
      indexable: listed,
    });

    // A public call is the same for everyone, so the CDN can hold it and this
    // runs a handful of times an hour. An unlisted one is not cached anywhere
    // shared: it is one link away from being public, and a cached copy is one
    // more place it can be found.
    res.set('Cache-Control', listed ? 'public, max-age=300, s-maxage=3600' : 'private, no-store');
    res.type('text/html').send(inject(html, `${cfp.name} — ${platform.name}`, meta));
  },
);
