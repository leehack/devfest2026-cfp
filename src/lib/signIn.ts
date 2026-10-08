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
import type { AdminTab } from './adminTabs';
import { proposalSelectionQuery } from './proposalLinks';

const PENDING = 'cfp.signInEmail';
export const SIGN_IN_RETURN_PATH = 'cfp.signInReturnPath';

export type SignInDestination = 'submit' | 'join' | 'review' | 'schedule' | `admin/${AdminTab}`;

/**
 * `cfpId` is optional and decides only who the message comes from and where the
 * link lands. An account is an account; it is not a membership of anything.
 */
export const requestSignInLink = httpsCallable<
  {
    email: string;
    locale: string;
    cfpId?: string;
    destination?: SignInDestination;
    proposalId?: string;
    speakerInvitationId?: string;
    roleInviteToken?: string;
  },
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

const RETURN_PATH_TTL_MS = 30 * 60 * 1000;

export function getRoleInviteTokenFromLocation(
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
  search = typeof window !== 'undefined' ? window.location.search : '',
): string {
  const params = new URLSearchParams(search);
  const fromQuery = params.get('invite') ?? params.get('token') ?? '';
  if (fromQuery) return fromQuery;
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if ((parts[2] === 'invite' || parts[2] === 'join') && parts[3]) {
    return decodeURIComponent(parts[3]);
  }
  return '';
}

export function rememberSignInReturnPath(path: string, now = Date.now()) {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  try {
    sessionStorage.setItem(SIGN_IN_RETURN_PATH, path);
    localStorage.setItem(
      SIGN_IN_RETURN_PATH,
      JSON.stringify({ path, expiresAt: now + RETURN_PATH_TTL_MS }),
    );
  } catch {
    /* storage may be unavailable in private browsing */
  }
}

export function clearSignInReturnPath() {
  try {
    localStorage.removeItem(SIGN_IN_RETURN_PATH);
    sessionStorage.removeItem(SIGN_IN_RETURN_PATH);
  } catch {
    /* see above */
  }
}

export function consumeSignInReturnPath(now = Date.now()): string {
  try {
    const sessionPath = sessionStorage.getItem(SIGN_IN_RETURN_PATH);
    const rawLocal = localStorage.getItem(SIGN_IN_RETURN_PATH);
    sessionStorage.removeItem(SIGN_IN_RETURN_PATH);
    localStorage.removeItem(SIGN_IN_RETURN_PATH);
    if (sessionPath && sessionPath.startsWith('/') && !sessionPath.startsWith('//')) {
      return sessionPath;
    }
    if (!rawLocal) return '';
    if (rawLocal.startsWith('/') && !rawLocal.startsWith('//')) {
      return rawLocal;
    }
    const parsed = JSON.parse(rawLocal) as { path?: unknown; expiresAt?: unknown };
    if (
      typeof parsed?.path === 'string' &&
      parsed.path.startsWith('/') &&
      !parsed.path.startsWith('//') &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt >= now
    ) {
      return parsed.path;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * True when this page load is a link being opened, rather than an ordinary visit.
 *
 * Answers false on a server rather than reading `window`, because the routes
 * that ask are reachable from a render that has none — and there the honest
 * answer is "not yet", not a crash.
 */
export function arrivingFromLink(): boolean {
  if (typeof window === 'undefined') return false;
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
    const source = new URL(window.location.href);
    const proposalId = source.searchParams.get('proposal');
    const invitationId = source.searchParams.get('speakerInvite');
    const selectedProposalId = proposalSelectionQuery(source.search);
    const invite = source.searchParams.get('invite');
    await signInWithEmailLink(auth, address, window.location.href);
    forgetPendingEmail();
    // The code is spent and the URL is now a confusing thing to bookmark or
    // share, so it does not stay in the address bar.
    const retained = new URLSearchParams();
    if (proposalId && invitationId) {
      retained.set('proposal', proposalId);
      retained.set('speakerInvite', invitationId);
    } else if (selectedProposalId) {
      retained.set('proposal', selectedProposalId);
    } else if (invite) {
      retained.set('invite', invite);
    }
    history.replaceState(
      null,
      '',
      `${window.location.pathname}${retained.size > 0 ? `?${retained}` : ''}`,
    );
    return 'signedIn';
  } catch (error: any) {
    // A mismatched address is not a broken link — asking again is the fix.
    if (error?.code === 'auth/invalid-email') return 'needsEmail';
    return 'failed';
  }
}
