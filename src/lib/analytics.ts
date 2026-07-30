/**
 * Google Analytics, behind consent and behind a dynamic import.
 *
 * Two things are deliberate and neither is incidental.
 *
 * **Nothing loads until somebody agrees.** `firebase/analytics` is imported
 * inside `start()`, so a visitor who declines or ignores the banner never
 * downloads it — that is roughly 50 KB they do not pay for, and, more to the
 * point, no identifier is set. A top-level import would defeat the consent gate
 * no matter what the banner said, because the SDK writes its cookie on init.
 *
 * **Nothing personal is ever an event parameter.** Everything below sends codes
 * — a CFP slug, a category value, a route name. Never a name, an address, a
 * proposal title or an abstract. The people using this form are handing over a
 * bio and an email because they want to give a talk; that is not licence to
 * send it to a third party. `track()` takes `Record<string, string | number>`
 * rather than `unknown` so a whole object cannot be passed in by accident.
 *
 * With no `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` this is inert — every call returns
 * without doing anything. That is the state of the emulator, of anyone else
 * deploying the platform, and of production until GA4 is linked in the console.
 */

import type { Analytics } from 'firebase/analytics';

import { app } from '../firebase';
import { pageShape } from './pageShape';
import { granted } from './consent';
import { MEASUREMENT_ID } from './env';

/**
 * Configured at all? Everything else is a no-op when this is false, and the
 * banner does not render — asking a question whose answer changes nothing is
 * worse than not asking.
 *
 * The emulators are covered by the tracked `.env` simply not naming an id,
 * rather than by a second check here. Somebody who exports one for a local run
 * has said what they want, and having one switch instead of two is what makes
 * the banner something you can put in front of your own eyes.
 */
export const analyticsAvailable = (): boolean => Boolean(MEASUREMENT_ID);

let instance: Analytics | null = null;
let starting: Promise<Analytics | null> | null = null;

/**
 * Loads and initialises the SDK, once. Safe to call repeatedly — the second
 * caller gets the first one's promise rather than a second GA instance.
 */
async function start(): Promise<Analytics | null> {
  // Consent is checked before the cached instance is handed back, not after.
  // The other order looks equivalent and is not: once somebody has agreed and
  // then withdrawn, `instance` is still set, so `track()` would go on pushing
  // events into `dataLayer`. `setAnalyticsCollectionEnabled` does stop those
  // reaching Google — it sets gtag's own `ga-disable-*` flag — but relying on
  // that alone puts the whole withdrawal on one third-party switch.
  if (!analyticsAvailable() || !granted()) return null;
  if (instance) return instance;
  if (starting) return starting;

  const pending = (async () => {
    // `isSupported` is not ceremony: it is false in a ServiceWorker, in some
    // WebViews, and wherever cookies are blocked outright — and initialising
    // Analytics throws rather than degrading in those.
    const { initializeAnalytics, isSupported } = await import('firebase/analytics');
    if (!(await isSupported()) || !granted()) return null;
    instance = initializeAnalytics(app, { config: { send_page_view: false } });
    return instance;
  })();
  starting = pending;

  try {
    return await pending;
  } finally {
    // Unsupported browsers, a withdrawn grant and transient failures must not
    // poison every later attempt with a permanently settled promise.
    if (starting === pending) starting = null;
  }
}

/**
 * Called when the banner is answered, either way.
 *
 * Granting starts the SDK immediately. Withdrawing has to do real work: by then
 * the SDK may be loaded and `gtag` exists, so it is told to stop collecting
 * rather than merely being left out of the next page load. Re-granting likewise
 * turns that same instance back on. A choice that only takes effect after a
 * reload is not a choice.
 */
export function applyConsent(): void {
  void (async () => {
    try {
      const analytics = granted() ? await start() : instance;
      if (!analytics) return;
      const { setAnalyticsCollectionEnabled } = await import('firebase/analytics');
      // Read the answer after every await. The visitor can change it while the
      // SDK or an ad blocker is taking its time.
      setAnalyticsCollectionEnabled(analytics, granted());
    } catch {
      // Measurement stays off; `start()` clears failed attempts so a later
      // explicit grant or event can retry.
    }
  })();
}

/**
 * One event. Silent when analytics is unconfigured, unconsented or unsupported,
 * which is most of the time — a caller should never have to check first.
 *
 * Failures are swallowed on purpose. An ad blocker eating the request is the
 * normal case, not an error worth a console line on every navigation, and
 * nothing a speaker is doing should break because a measurement did.
 */
export function track(event: string, params: Record<string, string | number> = {}): void {
  void (async () => {
    try {
      const analytics = await start();
      if (!analytics) return;
      // Already resolved — `start()` imported this module — so this is a cache
      // hit rather than a second fetch.
      const { logEvent } = await import('firebase/analytics');
      if (!granted()) return;
      logEvent(analytics, event, params);
    } catch {
      // Measurement is never worth an interruption.
    }
  })();
}

/**
 * A route change, as a GA4 `page_view`.
 *
 * The path is reduced to its shape first — `/c/{cfpId}` rather than the slug —
 * by `pageShape` in the router. GA4's automatic collection would send the real
 * URL, which is why automatic collection is not what this uses.
 */
export function trackPageView(path: string, cfpId: string | null): void {
  const pathname = path.split(/[?#]/, 1)[0];
  const pageLocation = `${window.location.origin}${pageShape(pathname)}`;
  track('page_view', {
    page_location: pageLocation,
    ...(cfpId ? { cfp_id: cfpId } : {}),
  });
}
