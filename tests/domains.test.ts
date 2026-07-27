import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResendError, cleanDomain, listDomains } from '../functions/src/domains';

describe('a refused key', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answers = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'no' }), { status })),
    );

  // 401 is a wrong key, 403 a valid one without full access. Neither is
  // `unauthenticated`: that code means the *caller* is not signed in, and
  // sharing it made `#/admin` tell an admin their session had expired the
  // moment they pasted a bad key.
  it.each([401, 403])('is failed-precondition, not unauthenticated (%i)', async (status) => {
    answers(status);
    const error = await listDomains('re_nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResendError);
    expect((error as ResendError).code).toBe('failed-precondition');
  });

  it('is not confused with a missing domain', async () => {
    answers(404);
    const error = await listDomains('re_ok').catch((e: unknown) => e);
    expect((error as ResendError).code).toBe('not-found');
  });
});

describe('cleanDomain', () => {
  it.each([
    ['gdgmontreal.com', 'gdgmontreal.com'],
    ['  GDGMontreal.COM ', 'gdgmontreal.com'],
    ['https://gdgmontreal.com', 'gdgmontreal.com'],
    ['https://gdgmontreal.com/cfp', 'gdgmontreal.com'],
    ['send.gdgmontreal.com', 'send.gdgmontreal.com'],
    // Pasting the sender address instead of the domain is the obvious slip.
    ['cfp@gdgmontreal.com', 'gdgmontreal.com'],
  ])('reads %s as %s', (input, expected) => {
    expect(cleanDomain(input)).toBe(expected);
  });

  it.each(['', '   ', 'localhost', 'not a domain', 'gdgmontreal', '.com', 'a..b'])(
    'rejects %s',
    (input) => {
      expect(cleanDomain(input)).toBeNull();
    },
  );
});
