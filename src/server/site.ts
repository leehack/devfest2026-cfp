import 'server-only';

/**
 * The origin this deployment answers on, for the tags a crawler reads.
 *
 * Not read from `config/platform`: that document is `allow read, write: if false`,
 * and the one rule for `src/server/` is that it only touches what the rules
 * already publish.
 *
 * So the origin lives in two places, and that is worth stating plainly.
 * `config/platform.publicUrl` is what the functions build mailed links from —
 * a sign-in link is a bearer credential, and aiming one at a dead host is worse
 * than a wrong canonical tag. This is what the sitemap and the canonical tags
 * use. They must agree; `scripts/set-platform.mjs` is where that is enforced.
 */
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:5173';

export const SITE_NAME = process.env.SITE_NAME ?? 'Call for proposals';
