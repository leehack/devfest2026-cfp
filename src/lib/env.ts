/**
 * Every public value the bundle needs, read once and by literal name.
 *
 * The literal spelling is the point. Next substitutes `process.env.NEXT_PUBLIC_X`
 * only where it is written out in full — a destructure, a spread of
 * `process.env`, or `process.env[name]` is left as a runtime lookup, which in a
 * browser is `undefined` and says nothing about why. For `USE_EMULATORS` that
 * failure would ship the emulator sign-in to production; for `MEASUREMENT_ID` it
 * would turn analytics off and look like a consent bug. So each read below is
 * spelled out, and this file is the only place in `src/` that touches
 * `process.env`. Do not tidy it into a loop.
 */

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  /*
   * Absent until GA4 is linked, and absent for the emulators. `analytics.ts`
   * reads that as "nothing is measured here" rather than as a misconfiguration,
   * which is also what keeps the consent banner off a deployment that has no
   * analytics to consent to.
   */
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim(),
};

export const MEASUREMENT_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim();

/**
 * Whether this bundle is talking to the emulator suite. One literal read, so the
 * bundler can fold it to `false` and drop `devAuth` — and
 * `signInWithCredential` with it — out of a real build.
 */
export const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

/** A deployment setting, not part of any call's form. Absent is fine. */
export const COC_URL = process.env.NEXT_PUBLIC_COC_URL;
