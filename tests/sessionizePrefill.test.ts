import { describe, expect, it } from 'vitest';

import { knownSessionizeUrl } from '../src/components/SessionizeImport';
import { emptyForm } from '../src/lib/formState';
import type { SocialPlatform } from '../shared/enums';

const withSocials = (...handles: string[]) => ({
  ...emptyForm,
  socials: handles.map((handle) => ({ platform: 'other' as SocialPlatform, handle })),
});

describe('knownSessionizeUrl', () => {
  it('finds a Sessionize link the speaker already gave us', () => {
    expect(knownSessionizeUrl(withSocials('https://sessionize.com/marie-t'))).toBe(
      'https://sessionize.com/marie-t',
    );
  });

  it('finds it among other links, whatever the platform is labelled', () => {
    const form = withSocials(
      'https://github.com/marie',
      '  https://sessionize.com/marie-t  ',
      'https://bsky.app/profile/marie',
    );
    expect(knownSessionizeUrl(form)).toBe('https://sessionize.com/marie-t');
  });

  it('accepts a bare host and a talk link', () => {
    expect(knownSessionizeUrl(withSocials('sessionize.com/marie-t'))).toBe('sessionize.com/marie-t');
    expect(knownSessionizeUrl(withSocials('https://sessionize.com/marie-t/session/12345'))).toBe(
      'https://sessionize.com/marie-t/session/12345',
    );
  });

  it('is empty when there is nothing to prefill', () => {
    expect(knownSessionizeUrl(emptyForm)).toBe('');
    expect(knownSessionizeUrl(withSocials('https://github.com/marie'))).toBe('');
  });

  it('does not match a lookalike host', () => {
    // The import is a server-side fetch; a prefilled `notsessionize.com` would
    // be a link the speaker never chose to paste.
    expect(knownSessionizeUrl(withSocials('https://notsessionize.com/marie'))).toBe('');
    expect(knownSessionizeUrl(withSocials('https://sessionize.com.evil.test/marie'))).toBe('');
  });
});
