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

const config: NextConfig = {
  async headers() {
    return [
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
