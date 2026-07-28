/**
 * Signing in with a one-time link, for people without a Google account.
 *
 * The link arrives by email and lands back on this site carrying an oob code.
 * Firebase wants the address that asked for it as well — partly to finish the
 * sign-in, partly as a check that the person opening the link is the person who
 * requested it, since a link forwarded to someone else is otherwise a working
 * key. We keep it in localStorage at request time and ask for it again when the
 * link is opened somewhere that has none, which is the ordinary case of asking
 * on a laptop and tapping the link on a phone.
 */

import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { auth, functions } from '../firebase';

const PENDING = 'cfp.signInEmail';

export const requestSignInLink = httpsCallable<
  { email: string; locale: string },
  { ok: boolean }
>(functions, 'requestSignInLink');

export function rememberPendingEmail(email: string) {
  try {
    localStorage.setItem(PENDING, email);
  } catch {
    // Safari in private mode throws on setItem. Losing this only means the
    // link asks for the address again, so there is nothing to report.
  }
}

export function pendingEmail(): string {
  try {
    return localStorage.getItem(PENDING) ?? '';
  } catch {
    return '';
  }
}

function forgetPendingEmail() {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    /* see above */
  }
}

/** True when this page load is a link being opened, rather than an ordinary visit. */
export function arrivingFromLink(): boolean {
  return isSignInWithEmailLink(auth, window.location.href);
}

export type LinkOutcome = 'signedIn' | 'needsEmail' | 'failed';

/**
 * Finishes the sign-in. `needsEmail` means the link is good but this browser
 * does not know whose it is — the caller asks, then calls again.
 */
export async function completeSignInFromLink(email?: string): Promise<LinkOutcome> {
  const address = (email ?? pendingEmail()).trim();
  if (!address) return 'needsEmail';

  try {
    await signInWithEmailLink(auth, address, window.location.href);
    forgetPendingEmail();
    // The code is spent and the URL is now a confusing thing to bookmark or
    // share, so it does not stay in the address bar.
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    return 'signedIn';
  } catch (error: any) {
    // A mismatched address is not a broken link — asking again is the fix.
    if (error?.code === 'auth/invalid-email') return 'needsEmail';
    return 'failed';
  }
}
