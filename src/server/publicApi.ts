import 'server-only';

import { publicApiLanguage, type PublicApiInput } from '@shared/publicApi';

import { readCfp, readPublishedSchedule } from './publicCfps';
import { SITE_ORIGIN } from './site';

/*
 * Short and shared rather than immutable: unpublishing is a Firestore write with
 * no cache-invalidation hook, so this is how long a withdrawn programme may
 * outlive its pointer in somebody else's cache.
 */
const CACHE = 'public, max-age=60, s-maxage=60';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

export function publicApiHeaders(contentType: string, cacheControl = CACHE): HeadersInit {
  return { ...CORS, 'Content-Type': contentType, 'Cache-Control': cacheControl };
}

export function publicApiNotFound(): Response {
  return Response.json(
    { error: 'not_found', message: 'No published programme.' },
    { status: 404, headers: publicApiHeaders('application/json; charset=utf-8', 'no-store') },
  );
}

export function publicApiPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** The published release only; an unpublished or missing programme is indistinguishable. */
export async function publicApiInput(
  request: Request,
  cfpId: string,
): Promise<PublicApiInput | null> {
  const [cfp, published] = await Promise.all([readCfp(cfpId), readPublishedSchedule(cfpId)]);
  if (!cfp || !published) return null;
  return {
    cfpId,
    eventName: cfp.name,
    schedule: published.schedule,
    entries: published.entries,
    language: publicApiLanguage(new URL(request.url).searchParams.get('lang')),
    origin: SITE_ORIGIN.replace(/\/+$/, ''),
  };
}

export async function publicApiJson<T>(
  request: Request,
  cfpId: string,
  build: (input: PublicApiInput) => T,
): Promise<Response> {
  const input = await publicApiInput(request, cfpId);
  if (!input) return publicApiNotFound();
  return Response.json(build(input), {
    headers: publicApiHeaders('application/json; charset=utf-8'),
  });
}
