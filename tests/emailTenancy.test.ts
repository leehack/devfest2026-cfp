import { describe, expect, it } from 'vitest';

import {
  emailDomainBindingId,
  emailDomainBindingMatches,
  legacyEmailDomainOwnerIsExact,
  platformEmailDomainBindingMatches,
  supersededStagedEmailDomainId,
} from '../functions/src/emailTenancy';

describe('email domain tenancy', () => {
  it('uses a stable safe document id for an opaque provider id', () => {
    const id = emailDomainBindingId('dom/provider id');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(emailDomainBindingId('dom/provider id')).toBe(id);
    expect(emailDomainBindingId('another')).not.toBe(id);
  });

  it('requires the exact CFP, provider id and normalized domain', () => {
    const binding = {
      cfpId: 'event-a',
      domainId: 'dom-a',
      domain: 'mail.example.org',
    };
    expect(
      emailDomainBindingMatches(binding, 'event-a', 'dom-a', 'MAIL.EXAMPLE.ORG'),
    ).toBe(true);
    expect(emailDomainBindingMatches(binding, 'event-b', 'dom-a', 'mail.example.org')).toBe(false);
    expect(emailDomainBindingMatches(binding, 'event-a', 'dom-b', 'mail.example.org')).toBe(false);
    expect(emailDomainBindingMatches(binding, 'event-a', 'dom-a', 'other.example.org')).toBe(false);
  });

  it('keeps platform and event domain bindings in separate scopes', () => {
    const platform = { scope: 'platform', domainId: 'dom-a', domain: 'mail.example.org' };
    const event = {
      scope: 'event',
      cfpId: 'event-a',
      domainId: 'dom-a',
      domain: 'mail.example.org',
    };
    expect(platformEmailDomainBindingMatches(platform, 'dom-a', 'MAIL.EXAMPLE.ORG')).toBe(true);
    expect(emailDomainBindingMatches(platform, 'event-a', 'dom-a', 'mail.example.org')).toBe(false);
    expect(platformEmailDomainBindingMatches(event, 'dom-a', 'mail.example.org')).toBe(false);
  });

  it('never releases the active binding when replacing a staged event domain', () => {
    expect(supersededStagedEmailDomainId('dom-active', 'dom-active', 'dom-next')).toBeNull();
    expect(supersededStagedEmailDomainId('dom-next', 'dom-active', 'dom-next')).toBeNull();
    expect(supersededStagedEmailDomainId('dom-staged', 'dom-active', 'dom-next')).toBe(
      'dom-staged',
    );
  });

  it('migrates only one exact legacy CFP reference and fails closed on duplicates', () => {
    expect(
      legacyEmailDomainOwnerIsExact('event-a', 'mail.example.org', [
        { cfpId: 'event-a', domain: 'MAIL.EXAMPLE.ORG' },
      ]),
    ).toBe(true);
    expect(
      legacyEmailDomainOwnerIsExact('event-a', 'mail.example.org', [
        { cfpId: 'event-b', domain: 'mail.example.org' },
      ]),
    ).toBe(false);
    expect(
      legacyEmailDomainOwnerIsExact('event-a', 'mail.example.org', [
        { cfpId: 'event-a', domain: 'mail.example.org' },
        { cfpId: 'event-b', domain: 'mail.example.org' },
      ]),
    ).toBe(false);
    expect(legacyEmailDomainOwnerIsExact('event-a', 'mail.example.org', [])).toBe(false);
  });
});
