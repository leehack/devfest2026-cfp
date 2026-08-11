import { describe, expect, it } from 'vitest';

import {
  EMPTY_SETTINGS,
  emailDeliveryReadiness,
  parseSender,
  senderDomain,
  senderMismatch,
  validPublicUrl,
  validateSettings,
  type EmailSettings,
} from '@shared/emailSettings';

describe('emailDeliveryReadiness', () => {
  it('is ready only with a live key, verified exact domain, and valid sender', () => {
    expect(
      emailDeliveryReadiness({
        key: 'present',
        domain: 'devfest.example',
        domainStatus: 'verified',
        from: 'DevFest <cfp@devfest.example>',
      }),
    ).toEqual({ ready: true, problems: [], domainStatus: 'verified' });
  });

  it('returns stable, composable problem codes', () => {
    expect(
      emailDeliveryReadiness({
        key: 'missing',
        domain: '',
        domainStatus: 'unknown',
        from: '',
      }),
    ).toEqual({
      ready: false,
      problems: ['missing_key', 'missing_domain', 'invalid_sender'],
      domainStatus: 'unknown',
    });
  });

  it('rejects an unverified domain and an otherwise valid sender on another domain', () => {
    expect(
      emailDeliveryReadiness({
        key: 'present',
        domain: 'devfest.example',
        domainStatus: 'pending',
        from: 'cfp@mail.devfest.example',
      }),
    ).toEqual({
      ready: false,
      problems: ['domain_unverified', 'sender_domain_mismatch'],
      domainStatus: 'pending',
    });
  });

  it.each([
    ['invalid', 'invalid_key'],
    ['unavailable', 'setup_unavailable'],
  ] as const)('distinguishes a %s key check', (key, problem) => {
    expect(
      emailDeliveryReadiness({
        key,
        domain: 'devfest.example',
        domainStatus: 'verified',
        from: 'cfp@devfest.example',
      }).problems,
    ).toEqual([problem]);
  });
});

describe('parseSender', () => {
  it.each([
    ['cfp@example.org', 'cfp@example.org'],
    ['  cfp@example.org  ', 'cfp@example.org'],
    ['DevFest Montréal <cfp@example.org>', 'cfp@example.org'],
    ['<cfp@example.org>', 'cfp@example.org'],
    ['cfp@mail.example.co.uk', 'cfp@mail.example.co.uk'],
  ])('accepts %s', (input, address) => {
    expect(parseSender(input)).toEqual({ address });
  });

  it.each(['', '   '])('reports an empty value', (input) => {
    expect(parseSender(input)).toEqual({ problem: 'empty' });
  });

  it.each([
    'not-an-address',
    'cfp@',
    '@example.org',
    'cfp@example',
    'cfp@@example.org',
    'DevFest <not-an-address>',
  ])('rejects %s', (input) => {
    expect(parseSender(input)).toEqual({ problem: 'format' });
  });

  it('tells a lost display name apart from a malformed address', () => {
    // Pasting a sender out of an email client loses the brackets, and "invalid
    // address" would send someone hunting for a typo that is not there.
    expect(parseSender('DevFest Montréal cfp@example.org')).toEqual({ problem: 'brackets' });
  });
});

describe('senderDomain', () => {
  it('reads the domain through a display name', () => {
    expect(senderDomain('DevFest Montréal <cfp@gdgmontreal.com>')).toBe('gdgmontreal.com');
  });

  it('lowercases it, since DNS is case-insensitive and comparisons are not', () => {
    expect(senderDomain('CFP@GDGMontreal.COM')).toBe('gdgmontreal.com');
  });

  it('is null when there is nothing to read', () => {
    expect(senderDomain('nonsense')).toBeNull();
  });
});

describe('senderMismatch', () => {
  it('passes an address on the verified domain', () => {
    expect(senderMismatch('DevFest <cfp@leehack.com>', 'leehack.com')).toBeNull();
    expect(senderMismatch('CFP@LeeHack.com', 'leehack.com')).toBeNull();
  });

  // The trap: Resend verifies an exact domain, so a subdomain inherits nothing
  // and the near-miss is exactly what someone types without thinking.
  it('catches a subdomain of the verified domain', () => {
    expect(senderMismatch('cfp@mail.leehack.com', 'leehack.com')).toBe('mail.leehack.com');
    expect(senderMismatch('cfp@leehack.com', 'mail.leehack.com')).toBe('leehack.com');
  });

  it('catches an unrelated domain', () => {
    expect(senderMismatch('cfp@gmail.com', 'leehack.com')).toBe('gmail.com');
  });

  // A domain added in Resend's own dashboard never reaches config/email, and a
  // warning that fires whenever we simply do not know would train people to
  // ignore it.
  it('stays quiet when either side is unknown', () => {
    expect(senderMismatch('cfp@leehack.com', '')).toBeNull();
    expect(senderMismatch('', 'leehack.com')).toBeNull();
    expect(senderMismatch('not an address', 'leehack.com')).toBeNull();
  });
});

describe('validateSettings', () => {
  const settings = (over: Partial<EmailSettings>): EmailSettings => ({
    ...EMPTY_SETTINGS,
    from: 'cfp@example.org',
    ...over,
  });

  it('accepts a sender with no reply-to', () => {
    expect(validateSettings(settings({}))).toBeNull();
  });

  it('requires a sender', () => {
    expect(validateSettings(settings({ from: '', replyTo: 'x@example.org' }))).toEqual({
      field: 'from',
      problem: 'empty',
    });
  });

  it('checks the reply-to when there is one', () => {
    expect(validateSettings(settings({ replyTo: 'nope' }))).toEqual({
      field: 'replyTo',
      problem: 'format',
    });
  });

  it('reports the sender first when both are wrong', () => {
    expect(validateSettings(settings({ from: 'nope', replyTo: 'also-nope' }))?.field).toBe('from');
  });

  it('checks the public URL', () => {
    expect(validateSettings(settings({ publicUrl: 'cfp.example.org' }))).toEqual({
      field: 'publicUrl',
      problem: 'url',
    });
    expect(validateSettings(settings({ publicUrl: 'https://cfp.example.org' }))).toBeNull();
  });
});

describe('validPublicUrl', () => {
  it.each([
    'https://cfp.example.org',
    'http://cfp.example.org',
    'https://devfest-mtl-2026-cfp.web.app',
    'https://cfp.example.org/submit',
    '',
    '   ',
  ])('accepts %s', (value) => {
    expect(validPublicUrl(value)).toBe(true);
  });

  // localhost is the one that actually went out, in a real acceptance email,
  // as the address a speaker was asked to confirm at.
  it.each(['http://localhost:5173', 'localhost', 'cfp.example.org', 'not a url'])(
    'rejects %s',
    (value) => {
      expect(validPublicUrl(value)).toBe(false);
    },
  );

  // A link a speaker is asked to click, so the scheme is allow-listed rather
  // than deny-listed — there is always one more scheme than a blocklist knows.
  it.each(['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd'])(
    'rejects the scheme in %s',
    (value) => {
      expect(validPublicUrl(value)).toBe(false);
    },
  );
});
