import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase';
import { usingEmulators } from './emulators';

/**
 * Emulator-only sign-in. `signInWithPopup` needs a real popup to post back to,
 * so it is unusable in headless browsers, embedded webviews and CI; the Auth
 * emulator accepts an unsigned ID token, so mint one and skip the IdP.
 *
 * Guarded by `usingEmulators`. A real backend would reject the token anyway,
 * but the button should not be reachable in the first place.
 */
export async function signInAsTestSpeaker(profile?: {
  sub?: string;
  email?: string;
  name?: string;
}) {
  if (!usingEmulators) {
    throw new Error('Test sign-in is only available against the emulator suite.');
  }

  const claims = {
    sub: profile?.sub ?? 'test-speaker',
    email: profile?.email ?? 'test.speaker@example.org',
    email_verified: true,
    name: profile?.name ?? 'Test Speaker',
  };

  return signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(claims)));
}

/**
 * Hands the end-to-end tests a way to mint admins and reviewers, not just the
 * default speaker the sign-in button makes.
 *
 * Called explicitly rather than run on import. It used to be a module-scope
 * `if (usingEmulators)`, which was safe only because Vite replaced that constant
 * at build time and dropped the branch. Nothing guarantees the next bundler
 * does, and `signInWithCredential` against real Auth is not a thing to leave to
 * a minifier — so the whole module is now behind a dynamic import that
 * production never asks for.
 */
export function installTestSignIn(): void {
  if (!usingEmulators) return;
  (window as unknown as Record<string, unknown>).signInAsTestSpeaker = signInAsTestSpeaker;
}
