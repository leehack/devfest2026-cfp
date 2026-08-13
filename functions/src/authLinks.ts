import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const SIGN_IN_LINK_WINDOW_MS = 60 * 60 * 1000;
export const SIGN_IN_LINKS_PER_ADDRESS = 5;
export const SIGN_IN_LINKS_PER_NETWORK = 50;
export const SIGN_IN_LINKS_PER_PLATFORM = 500;

interface SignInLinkCounter {
  windowStart: number;
  count: number;
}

/** Fixed windows make all three counters one atomic, bounded Firestore transaction. */
export function nextSignInLinkCounter(
  stored: { windowStart?: unknown; count?: unknown },
  limit: number,
  now: number,
): SignInLinkCounter | null {
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(now) || now < 0) {
    return null;
  }
  if (stored.windowStart === undefined && stored.count === undefined) {
    return { windowStart: now, count: 1 };
  }
  const { windowStart, count } = stored;
  if (
    !Number.isSafeInteger(windowStart) ||
    (windowStart as number) < 0 ||
    (windowStart as number) > now ||
    !Number.isSafeInteger(count) ||
    (count as number) < 0
  ) {
    return null;
  }
  const validWindowStart = windowStart as number;
  const validCount = count as number;
  if (now - validWindowStart >= SIGN_IN_LINK_WINDOW_MS) {
    return { windowStart: now, count: 1 };
  }
  if (validCount >= limit) return null;
  return { windowStart: validWindowStart, count: validCount + 1 };
}

/** Canonicalises Express's best-effort request peer; the platform counter is the hard ceiling. */
export function normaliseSignInNetwork(rawIp: string | undefined): string {
  let value = String(rawIp ?? '').trim().toLowerCase();
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) value = value.slice(7);
  if (isIP(value) === 4) return value.split('.').map(Number).join('.');
  if (isIP(value) !== 6) return '';

  try {
    const host = new URL(`http://[${value}]/`).hostname;
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  } catch {
    return '';
  }
}

/** Opaque document ids keep caller network and account identifiers out of Firestore. */
export function signInLinkLimitId(scope: string, value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

/**
 * Moves a generated Firebase action link onto the project's equivalent Hosting
 * origin. The Admin SDK rejects a default web.app domain in `linkDomain`, but
 * the two default domains serve the same reserved auth handler and action code.
 */
export function useFreshHostingOrigin(
  link: string,
  projectId: string | undefined,
  emulator: boolean,
): string {
  if (!projectId || emulator) return link;

  const url = new URL(link);
  if (url.hostname !== `${projectId}.firebaseapp.com`) return link;
  url.hostname = `${projectId}.web.app`;
  return url.toString();
}

/** The Auth emulator exposes its out-of-band links; production needs a real sender. */
export function signInEmailDeliveryReady(
  apiKey: string,
  sender: string | undefined,
  emulator: boolean,
): boolean {
  return emulator || Boolean(apiKey.trim() && sender?.trim());
}
