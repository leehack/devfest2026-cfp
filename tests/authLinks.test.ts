import { describe, expect, it } from 'vitest';

import {
  nextSignInLinkCounter,
  normaliseSignInNetwork,
  signInLinkLimitId,
  SIGN_IN_LINKS_PER_ADDRESS,
  SIGN_IN_LINKS_PER_PLATFORM,
  SIGN_IN_LINK_WINDOW_MS,
  signInEmailDeliveryReady,
  useFreshHostingOrigin,
} from '../functions/src/authLinks';

describe('email action link origin', () => {
  const firebaseLink =
    'https://sample-project.firebaseapp.com/__/auth/action?mode=signIn&oobCode=secret&continueUrl=https%3A%2F%2Fcfp.example.org%2Fme';

  it('moves the default Firebase handler to the equivalent fresh Hosting origin', () => {
    const result = new URL(useFreshHostingOrigin(firebaseLink, 'sample-project', false));

    expect(result.hostname).toBe('sample-project.web.app');
    expect(result.pathname).toBe('/__/auth/action');
    expect(result.searchParams.get('oobCode')).toBe('secret');
    expect(result.searchParams.get('continueUrl')).toBe('https://cfp.example.org/me');
  });

  it('does not rewrite emulator or unrelated action handlers', () => {
    expect(useFreshHostingOrigin(firebaseLink, 'sample-project', true)).toBe(firebaseLink);
    expect(useFreshHostingOrigin(firebaseLink, undefined, false)).toBe(firebaseLink);
    expect(
      useFreshHostingOrigin(
        firebaseLink.replace('sample-project.firebaseapp.com', 'auth.example.org'),
        'sample-project',
        false,
      ),
    ).toContain('auth.example.org');
  });

  it('requires both production delivery credentials before promising a sign-in email', () => {
    expect(signInEmailDeliveryReady('resend-key', 'CFP <mail@example.org>', false)).toBe(true);
    expect(signInEmailDeliveryReady('', 'CFP <mail@example.org>', false)).toBe(false);
    expect(signInEmailDeliveryReady('resend-key', '', false)).toBe(false);
    expect(signInEmailDeliveryReady('', '', true)).toBe(true);
  });
});

describe('sign-in link abuse counters', () => {
  it('increments a fixed window and refuses its exact limit', () => {
    const now = 1_000_000;
    expect(nextSignInLinkCounter({}, SIGN_IN_LINKS_PER_ADDRESS, now)).toEqual({
      windowStart: now,
      count: 1,
    });
    expect(
      nextSignInLinkCounter(
        { windowStart: now, count: SIGN_IN_LINKS_PER_ADDRESS - 1 },
        SIGN_IN_LINKS_PER_ADDRESS,
        now + 1,
      ),
    ).toEqual({ windowStart: now, count: SIGN_IN_LINKS_PER_ADDRESS });
    expect(
      nextSignInLinkCounter(
        { windowStart: now, count: SIGN_IN_LINKS_PER_ADDRESS },
        SIGN_IN_LINKS_PER_ADDRESS,
        now + 2,
      ),
    ).toBeNull();
  });

  it('starts a fresh allowance only after the window expires', () => {
    const now = 1_000_000;
    expect(
      nextSignInLinkCounter(
        { windowStart: now, count: SIGN_IN_LINKS_PER_ADDRESS },
        SIGN_IN_LINKS_PER_ADDRESS,
        now + SIGN_IN_LINK_WINDOW_MS,
      ),
    ).toEqual({ windowStart: now + SIGN_IN_LINK_WINDOW_MS, count: 1 });
  });

  it('enforces the platform circuit breaker as the hard ceiling', () => {
    const now = 1_000_000;
    expect(
      nextSignInLinkCounter(
        { windowStart: now, count: SIGN_IN_LINKS_PER_PLATFORM },
        SIGN_IN_LINKS_PER_PLATFORM,
        now + 1,
      ),
    ).toBeNull();
  });

  it('fails closed on malformed or future counters', () => {
    expect(nextSignInLinkCounter({ windowStart: 'broken' }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({ windowStart: '', count: 0 }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({ windowStart: Number.NaN, count: 0 }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({ windowStart: 1_001, count: 0 }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({ windowStart: 999, count: '1' }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({ windowStart: 999, count: -1 }, 5, 1_000)).toBeNull();
    expect(nextSignInLinkCounter({}, 5, Number.NaN)).toBeNull();
  });

  it('canonicalises a caller network and stores only an opaque bucket id', () => {
    expect(normaliseSignInNetwork('::ffff:192.0.2.42')).toBe('192.0.2.42');
    expect(normaliseSignInNetwork('2001:0DB8:0:0::1')).toBe('2001:db8::1');
    expect(normaliseSignInNetwork('not-an-ip')).toBe('');

    const id = signInLinkLimitId('caller', 'network:192.0.2.42');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain('192.0.2.42');
  });
});
