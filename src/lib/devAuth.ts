import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase';

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

/**
 * Emulator-only sign-in.
 *
 * `signInWithPopup` needs a real popup window to post its result back to, which
 * makes it unusable in headless browsers, embedded webviews and CI. The Auth
 * emulator accepts an *unsigned* ID token, so we can mint one directly and skip
 * the IdP round trip entirely.
 *
 * Guarded by `usingEmulators` and never rendered against a real project — a
 * genuine Firebase backend rejects an unsigned token outright, but the button
 * should not be reachable in the first place.
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
