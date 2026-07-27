import { describe, expect, it } from 'vitest';

import {
  DECISION_KINDS,
  EMAIL_KINDS,
  renderEmail,
  type EmailData,
} from '@shared/emailTemplates';

const data: EmailData = {
  speakerName: 'Ada Lovelace',
  title: 'Notes on the Analytical Engine',
  proposalUrl: 'https://cfp.example/#/',
};

describe('renderEmail', () => {
  it.each(EMAIL_KINDS)('%s is complete in both languages', (kind) => {
    for (const locale of ['en', 'fr'] as const) {
      const email = renderEmail(kind, locale, data);
      expect(email.subject).toBeTruthy();
      expect(email.subject).not.toContain('{');
      expect(email.text).toContain('Ada Lovelace');
      expect(email.html).toMatch(/^<div/);
      expect(email.html).toContain('</div>');
    }
  });

  it.each(EMAIL_KINDS)('%s differs between languages', (kind) => {
    expect(renderEmail(kind, 'en', data).text).not.toEqual(
      renderEmail(kind, 'fr', data).text,
    );
  });

  it.each(EMAIL_KINDS)('%s names the talk it is about', (kind) => {
    // The rejection is the one message people reread. Sending it without the
    // title reads as a form letter that never saw the proposal.
    for (const locale of ['en', 'fr'] as const) {
      expect(renderEmail(kind, locale, data).text).toContain(data.title);
    }
  });

  it('mentions the visa only when one is needed', () => {
    for (const locale of ['en', 'fr'] as const) {
      const without = renderEmail('accepted', locale, data).text;
      const with_ = renderEmail('accepted', locale, { ...data, needsVisa: true }).text;

      expect(without.toLowerCase()).not.toContain('visa');
      expect(with_.toLowerCase()).toContain('visa');
    }
  });

  it('only an acceptance asks anyone to confirm', () => {
    // A rejection carrying a link to "confirm your talk" is the kind of mistake
    // that gets screenshotted.
    for (const kind of ['rejected', 'waitlisted'] as const) {
      expect(renderEmail(kind, 'en', data).text).not.toMatch(/confirm/i);
    }
    expect(renderEmail('accepted', 'en', data).text).toMatch(/confirm/i);
  });

  it('a rejection carries no link back to the form', () => {
    expect(renderEmail('rejected', 'en', data).text).not.toContain(data.proposalUrl);
  });

  it('links are anchored in the HTML, not left bare', () => {
    const html = renderEmail('submission_received', 'en', data).html;
    expect(html).toContain(`<a href="${data.proposalUrl}">`);
  });

  it('escapes markup in speaker-supplied values', () => {
    const html = renderEmail('accepted', 'en', {
      ...data,
      speakerName: '<script>alert(1)</script>',
      title: 'Tags & "quotes" <b>',
    }).html;

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('holds every decision and nothing else', () => {
    expect([...DECISION_KINDS].sort()).toEqual(['accepted', 'rejected', 'waitlisted']);
    // A receipt that waited for the batch would arrive weeks after the talk it
    // acknowledges.
    expect(DECISION_KINDS).not.toContain('submission_received');
  });
});
