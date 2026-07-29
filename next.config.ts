import type { NextConfig } from 'next';

const REQUIRED = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

/**
 * Runs here rather than in a prebuild script because App Hosting invokes
 * `next build` directly — a check wired into an npm script would be skipped —
 * and because Next has already loaded the `.env` files by the time this is
 * evaluated.
 *
 * The `demo-` guard is the one that matters. The tracked `.env` holds emulator
 * placeholders so the repo can be cloned and run, and Next loads `.env` in every
 * mode. A build that picked those up would deploy a site that looks fine and
 * cannot sign anybody in, which is indistinguishable from a broken Auth config.
 */
function assertPublicEnv(): void {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`next build: no public Firebase config — missing ${missing.join(', ')}`);
  }
  const id = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
  if (id.startsWith('demo-')) {
    throw new Error(
      `next build: NEXT_PUBLIC_FIREBASE_PROJECT_ID is "${id}" — the emulator placeholder, not a project.`,
    );
  }
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    throw new Error('next build: NEXT_PUBLIC_USE_EMULATORS=true would ship the emulator sign-in.');
  }
}

/**
 * What Firebase Hosting used to add on its own and App Hosting does not.
 *
 * Verified against the deployed backend rather than assumed: the responses came
 * back with no `Strict-Transport-Security`, no `X-Content-Type-Options` and no
 * `Referrer-Policy`. Hosting sent HSTS for free, so the migration lost it
 * silently — nothing failed, the header just stopped being there.
 *
 * `Referrer-Policy` is the one with a concrete leak behind it. A sign-in link is
 * a bearer credential carried in the query string, and this app renders outbound
 * links — an event website, a Sessionize profile, a code of conduct — on pages
 * that can be reached with one still in the URL. Under the older
 * `no-referrer-when-downgrade` default, following one of those hands the whole
 * URL, code included, to a third party. Current browsers already default to the
 * value set here; this is for the ones that do not.
 *
 * Deliberately not set: `X-Frame-Options`. Nothing in the app frames itself and
 * Firebase's auth iframe lives on the authDomain rather than here, so it looks
 * safe — but "looks safe" is not the standard for a header that can break
 * sign-in, and sign-in is the one flow that cannot be verified from a terminal.
 * It wants a human at a browser first.
 */
const SECURITY_HEADERS = [
  // A year, no includeSubDomains: this host has no subdomains to speak for, and
  // claiming them would commit names nobody here controls.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const config: NextConfig = {
  async headers() {
    return [
      // `/(.*)` rather than `/:path*`: both are path-to-regexp here, but the
      // explicit catch-all is the one Next documents for "every route", and the
      // sibling Firebase config in hosting-redirect/ is a standing reminder that
      // a named-splat pattern can quietly fail to match `/`.
      { source: '/(.*)', headers: SECURITY_HEADERS },
      {
        /*
         * One segment, exactly as the Hosting rewrite was: `/c/:cfpId` does not
         * match `/c/:cfpId/submit` or the admin tabs.
         *
         * Never relax this to `public`. Whether a call is private is *data*, and
         * a route's cache config is module-level, so the only header that is safe
         * for the whole family is the private one. It also survives a visibility
         * flip: making a CFP private is a Firestore write with no
         * cache-invalidation hook, so a formerly-public page would otherwise sit
         * in a shared cache for the rest of its lifetime.
         *
         * Pinned rather than inherited, because Next's own default for a
         * dynamically rendered page has changed more than once between releases.
         */
        source: '/c/:cfpId',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default (phase: string): NextConfig => {
  if (phase === 'phase-production-build') assertPublicEnv();
  return config;
};
