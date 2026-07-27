import { describe, expect, it } from 'vitest';

import { cleanDomain } from '../functions/src/domains';

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
