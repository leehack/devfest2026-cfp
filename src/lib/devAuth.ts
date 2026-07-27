import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase';

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

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
