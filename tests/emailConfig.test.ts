import { describe, expect, it } from 'vitest';

import {
  boundEmailSender,
  emailConfigurationHasInvalidActiveIdentity,
  emailConfigurationFingerprint,
  emailTemplatesFingerprintInput,
  inferredEventEmailMode,
  resolvedPlatformSender,
  resolveReplyTo,
} from '../functions/src/emailConfig';
import { validSenderDisplayName } from '../shared/emailSettings';
import {
  builtInTemplate,
  EMAIL_KINDS,
  EMAIL_LOCALES,
} from '../shared/emailTemplates';

describe('platform email inheritance', () => {
  const contentContext = {
    cfpName: 'DevFest Montréal 2026',
    publicUrl: 'https://cfp.example.test',
  };

  it('keeps templates-only event configuration on the platform sender', () => {
    expect(inferredEventEmailMode({ templates: { accepted: {} } })).toBe('platform');
  });

  it('keeps an explicitly selected platform sender while an event identity is staged', () => {
    expect(
      inferredEventEmailMode({
        senderMode: 'platform',
        from: 'Event <cfp@event.example>',
        stagedDomainId: 'dom-event',
        stagedDomain: 'event.example',
      }),
    ).toBe('platform');
  });

  it('treats explicit event mode as event even without a usable binding', () => {
    expect(inferredEventEmailMode({ senderMode: 'event' })).toBe('event');
  });

  it('uses a bound sender only when its address belongs to the active domain', () => {
    expect(boundEmailSender('CFP <mail@platform.example>', 'platform.example')).toBe(
      'CFP <mail@platform.example>',
    );
    expect(boundEmailSender('CFP <mail@old.example>', 'platform.example')).toBe('');
    expect(boundEmailSender('not an address', 'platform.example')).toBe('');
  });

  it('allows an event sender name while keeping the bound platform address', () => {
    expect(
      resolvedPlatformSender(
        'Platform <mail@platform.example>',
        '',
        'platform.example',
        true,
      ),
    ).toBe('Platform <mail@platform.example>');
    expect(
      resolvedPlatformSender(
        'Platform <mail@other.example>',
        'DevFest Montréal',
        'platform.example',
        true,
      ),
    ).toBe('');
    expect(
      resolvedPlatformSender(
        'Platform <mail@platform.example>',
        'DevFest Montréal',
        'platform.example',
        true,
      ),
    ).toBe('DevFest Montréal <mail@platform.example>');
    expect(
      resolvedPlatformSender(
        'Platform <mail@platform.example>',
        'DevFest Montréal',
        'platform.example',
        false,
      ),
    ).toBe('');

    expect(validSenderDisplayName('DevFest Montréal')).toBe(true);
    expect(validSenderDisplayName('')).toBe(true);
    expect(validSenderDisplayName('<DevFest>')).toBe(false);
    expect(validSenderDisplayName('DevFest\tMontréal')).toBe(false);
    expect(validSenderDisplayName('x'.repeat(101))).toBe(false);
  });

  it('inherits an absent reply-to and preserves an explicit empty override', () => {
    expect(resolveReplyTo({}, 'platform@example.org')).toBe('platform@example.org');
    expect(resolveReplyTo({ replyTo: null }, 'platform@example.org')).toBe('platform@example.org');
    expect(resolveReplyTo({ replyTo: '' }, 'platform@example.org')).toBe('');
  });

  it('returns an opaque stable fingerprint that changes with effective delivery', () => {
    const configuration = {
      source: 'platform' as const,
      senderMode: 'platform' as const,
      settings: { from: 'mail@example.org', replyTo: '', publicUrl: '' },
      domainId: 'provider-secret-id',
      domain: 'example.org',
      templates: {},
      templateOverrides: {},
      eventSettings: { from: '', platformSenderName: '', replyTo: null, domainId: '', domain: '' },
      platformData: {},
      eventData: {},
      platformBound: true,
      eventBound: false,
    };
    const fingerprint = emailConfigurationFingerprint(configuration, contentContext);
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fingerprint).not.toContain('provider-secret-id');
    expect(emailConfigurationFingerprint(configuration, contentContext)).toBe(fingerprint);
    expect(
      emailConfigurationFingerprint({
        ...configuration,
        settings: { ...configuration.settings, replyTo: 'reply@example.org' },
      }, contentContext),
    ).not.toBe(fingerprint);
    expect(
      emailConfigurationFingerprint(configuration, {
        ...contentContext,
        cfpName: 'Renamed event',
      }),
    ).not.toBe(fingerprint);
    expect(
      emailConfigurationFingerprint(configuration, {
        ...contentContext,
        publicUrl: 'https://new.example.test',
      }),
    ).not.toBe(fingerprint);
  });

  it('fingerprints every effective built-in template leaf in a deterministic order', () => {
    const input = emailTemplatesFingerprintInput();
    expect(input).toHaveLength(EMAIL_KINDS.length * EMAIL_LOCALES.length);
    expect(input.map(([kind, locale]) => `${kind}:${locale}`)).toEqual(
      EMAIL_KINDS.flatMap((kind) => EMAIL_LOCALES.map((locale) => `${kind}:${locale}`)),
    );

    const accepted = builtInTemplate('accepted', 'en');
    expect(input).toContainEqual(['accepted', 'en', accepted.subject, accepted.body]);
  });

  it('keeps the effective built-in and override fingerprints stable', () => {
    const configuration = {
      source: 'platform' as const,
      senderMode: 'platform' as const,
      settings: { from: 'mail@example.org', replyTo: '', publicUrl: '' },
      domainId: 'provider-secret-id',
      domain: 'example.org',
      templates: {},
      templateOverrides: {},
      eventSettings: { from: '', platformSenderName: '', replyTo: null, domainId: '', domain: '' },
      platformData: {},
      eventData: {},
      platformBound: true,
      eventBound: false,
    };
    const builtInFingerprint = emailConfigurationFingerprint(configuration, contentContext);
    const overrideFingerprint = emailConfigurationFingerprint({
      ...configuration,
      templates: {
        accepted: {
          en: { subject: 'Custom acceptance', body: 'Custom body for {speakerName}.' },
        },
      },
    }, contentContext);

    // These pins change when any built-in leaf changes, including leaves without overrides.
    expect(builtInFingerprint).toBe('YZrbJ6YbgCocqACYOGMWuYTtWkwf5L0-qfV2KdnhQ9g');
    expect(overrideFingerprint).toBe('FjzVYlf4hAUKdCANPrVi1LGy8boLb5z2VgE52hWgU9o');
    expect(overrideFingerprint).not.toBe(builtInFingerprint);
    expect(emailConfigurationFingerprint(configuration, contentContext)).toBe(builtInFingerprint);
  });

  it('distinguishes an unconfigured emulator from a declared invalid identity', () => {
    const unconfigured = {
      source: 'platform' as const,
      senderMode: 'platform' as const,
      settings: { from: '', replyTo: '', publicUrl: '' },
      domainId: '',
      domain: '',
      templates: {},
      templateOverrides: {},
      eventSettings: { from: '', platformSenderName: '', replyTo: null, domainId: '', domain: '' },
      platformData: {},
      eventData: {},
      platformBound: false,
      eventBound: false,
    };
    expect(emailConfigurationHasInvalidActiveIdentity(unconfigured)).toBe(false);

    expect(
      emailConfigurationHasInvalidActiveIdentity({
        ...unconfigured,
        platformData: {
          from: 'Platform <mail@platform.example.test>',
          domainId: 'dom-platform.example.test',
          domain: 'platform.example.test',
        },
      }),
    ).toBe(true);

    expect(
      emailConfigurationHasInvalidActiveIdentity({
        ...unconfigured,
        source: 'event',
        senderMode: 'event',
        eventData: {
          senderMode: 'event',
          from: 'Event <mail@platform.example.test>',
          domainId: 'dom-platform.example.test',
          domain: 'platform.example.test',
        },
      }),
    ).toBe(true);
  });
});
