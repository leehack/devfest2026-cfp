/**
 * The headers `next.config.ts` promises.
 *
 * Asserted against the config rather than a response, because `next dev` does not
 * apply `headers()` at all — so the e2e suite, which runs against it, cannot see
 * these. That leaves the config itself as the only thing testable without a
 * deploy, and it is worth testing: every header here was absent from production
 * until someone went and looked, and a deletion would be just as quiet.
 */

import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';

async function headerRules() {
  const config = nextConfig('phase-development-server');
  const rules = await config.headers?.();
  expect(rules, 'next.config.ts declares no headers at all').toBeTruthy();
  return rules!;
}

/** Every header that applies to `path`, flattened, later rules winning. */
function headersFor(
  rules: Awaited<ReturnType<typeof headerRules>>,
  matches: (source: string) => boolean,
): Record<string, string> {
  const found: Record<string, string> = {};
  for (const rule of rules) {
    if (!matches(rule.source)) continue;
    for (const { key, value } of rule.headers) found[key.toLowerCase()] = value;
  }
  return found;
}

describe('the security headers', () => {
  it('are declared for every route, including the root', async () => {
    const rules = await headerRules();
    const catchAll = rules.filter((rule) => /^\/\(\.\*\)$|^\/:\w+\*$/.test(rule.source));
    expect(catchAll, 'no catch-all header rule').not.toHaveLength(0);
  });

  it('include the three App Hosting does not send on its own', async () => {
    const rules = await headerRules();
    const all = headersFor(rules, (source) => source === '/(.*)');

    // Firebase Hosting sent this for free. App Hosting does not, so the migration
    // dropped it without anything failing.
    expect(all['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(all['x-content-type-options']).toBe('nosniff');
    // A sign-in code rides in the query string. This is what keeps it out of a
    // Referer sent to whatever an organiser linked to.
    expect(all['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('refuses third-party framing without ruling out a same-origin embed', async () => {
    const rules = await headerRules();
    const all = headersFor(rules, (source) => source === '/(.*)');

    /*
     * Safe because sign-in is signInWithPopup — a popup, not a frame — and the
     * one iframe in the app is a srcDoc email preview, which is this app
     * embedding itself. Not DENY: an organiser embedding their own submission
     * form is a plausible thing to want from a platform.
     */
    expect(all['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('does not grant browser hardware capabilities the CFP never uses', async () => {
    const rules = await headerRules();
    const policy = headersFor(rules, (source) => source === '/(.*)')['permissions-policy'];

    for (const capability of ['camera', 'geolocation', 'microphone', 'payment', 'usb']) {
      expect(policy).toContain(`${capability}=()`);
    }
  });

  it('does not advertise the framework', () => {
    expect(nextConfig('phase-development-server').poweredByHeader).toBe(false);
  });

  it('do not claim subdomains this host does not speak for', async () => {
    const rules = await headerRules();
    const hsts = headersFor(rules, (source) => source === '/(.*)')['strict-transport-security'];
    expect(hsts).not.toContain('includeSubDomains');
    // preload requires includeSubDomains, and is a one-way door besides.
    expect(hsts).not.toContain('preload');
  });
});

describe("a call's front page", () => {
  /*
   * The reason this is pinned at all: whether a call is private is data, a
   * route's cache config is module-level, and unlisting one is a Firestore write
   * with no invalidation hook. A shared cache would keep serving the page it had.
   */
  it('is never cacheable by anything shared', async () => {
    const rules = await headerRules();
    const page = headersFor(rules, (source) => source === '/c/:cfpId');

    expect(page['cache-control']).toBe('private, no-store');
    expect(page['cache-control']).not.toContain('public');
  });

  it('is pinned on the page itself, not the whole family under it', async () => {
    const rules = await headerRules();
    // `/c/:cfpId` must not swallow `/c/:cfpId/submit` — the admin tabs and the
    // form are a different audience with different needs.
    expect(rules.some((rule) => rule.source === '/c/:cfpId')).toBe(true);
    expect(rules.some((rule) => rule.source.startsWith('/c/:cfpId/'))).toBe(false);
  });
});

describe('production metadata configuration', () => {
  const productionEnv = {
    NEXT_PUBLIC_FIREBASE_API_KEY: 'public-web-key',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'example-project',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'example.appspot.com',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdef',
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'G-ABC123XYZ9',
    NEXT_PUBLIC_COC_URL: 'https://example.org/code-of-conduct',
    NEXT_PUBLIC_USE_EMULATORS: 'false',
    SITE_ORIGIN: 'https://cfp.example.org',
  } as const;

  function withEnv(values: Record<string, string>, run: () => void) {
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(values)) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      run();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it.each(['/nested', '?campaign=test', '#section'])(
    'rejects SITE_ORIGIN suffix %s',
    (suffix) => {
      withEnv(
        { ...productionEnv, SITE_ORIGIN: `https://cfp.example.org${suffix}` },
        () =>
          expect(() => nextConfig('phase-production-build')).toThrow(
            /SITE_ORIGIN must be an origin/,
          ),
      );
    },
  );

  it('rejects a malformed optional GA4 measurement ID', () => {
    withEnv(
      { ...productionEnv, NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'UA-123456-1' },
      () =>
        expect(() => nextConfig('phase-production-build')).toThrow(
          /NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID is not a GA4 measurement ID/,
      ),
    );
  });

  it('accepts Secret Manager transport whitespace around the GA4 measurement ID', () => {
    withEnv(
      { ...productionEnv, NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: ' G-ABC123XYZ9\n' },
      () => expect(() => nextConfig('phase-production-build')).not.toThrow(),
    );
  });
});
