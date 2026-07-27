import { describe, expect, it } from 'vitest';

import { parseSender, senderDomain, validateSettings } from '@shared/emailSettings';

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

describe('validateSettings', () => {
  it('accepts a sender with no reply-to', () => {
    expect(validateSettings({ from: 'cfp@example.org', replyTo: '' })).toBeNull();
  });

  it('requires a sender', () => {
    expect(validateSettings({ from: '', replyTo: 'x@example.org' })).toEqual({
      field: 'from',
      problem: 'empty',
    });
  });

  it('checks the reply-to when there is one', () => {
    expect(validateSettings({ from: 'cfp@example.org', replyTo: 'nope' })).toEqual({
      field: 'replyTo',
      problem: 'format',
    });
  });

  it('reports the sender first when both are wrong', () => {
    expect(validateSettings({ from: 'nope', replyTo: 'also-nope' })?.field).toBe('from');
  });
});
