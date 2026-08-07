import { describe, expect, it } from 'vitest';

import { useFreshHostingOrigin } from '../functions/src/authLinks';

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
});
