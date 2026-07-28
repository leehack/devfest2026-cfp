import { describe, expect, it } from 'vitest';

import {
  DECISION_KINDS,
  EMAIL_KINDS,
  builtInTemplate,
  renderEmail,
  renderTemplate,
  validateTemplate,
  type EmailData,
} from '@shared/emailTemplates';

const data: EmailData = {
  speakerName: 'Ada Lovelace',
  title: 'Notes on the Analytical Engine',
  proposalUrl: 'https://cfp.example/#/c/devfest-mtl-2026',
  // The CFP's own name, not a constant: every message on the platform is signed
  // with whichever event it is about.
  event: 'DevFest Montréal 2026',
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

describe('overrides', () => {
  const override = {
    accepted: {
      en: { subject: 'You are in: {title}', body: 'Hi {speakerName},\n\nSee you at {event}.' },
    },
  };

  it('replaces our wording when there is one', () => {
    const email = renderEmail('accepted', 'en', data, override);
    expect(email.subject).toBe('You are in: Notes on the Analytical Engine');
    expect(email.text).toContain('See you at DevFest Montréal 2026.');
    expect(email.text).not.toContain('is on the programme');
  });

  it('leaves the languages and messages it does not name alone', () => {
    expect(renderEmail('accepted', 'fr', data, override).text).toContain('est au programme');
    expect(renderEmail('rejected', 'en', data, override).text).toContain('not able to fit');
  });

  it('ignores a half-written override rather than sending a blank', () => {
    // Firestore holding `{subject: ''}` must not produce an email with no
    // subject — falling back is the only safe reading.
    for (const half of [{ subject: '', body: 'x' }, { subject: 'x', body: '' }]) {
      const email = renderEmail('accepted', 'en', data, { accepted: { en: half } });
      expect(email.subject).toBe(renderEmail('accepted', 'en', data).subject);
    }
  });

  it('drops a visa-only paragraph when no visa is needed', () => {
    const withVisa = {
      accepted: { en: { subject: 's', body: 'One.\n\n{visa}\n\nTwo.' } },
    };
    expect(renderEmail('accepted', 'en', data, withVisa).text).toBe('One.\n\nTwo.\n\n\n\n— DevFest Montréal 2026');
    expect(renderEmail('accepted', 'en', { ...data, needsVisa: true }, withVisa).text).toContain('visa or eTA');
  });

  it('still escapes speaker-supplied values in a custom template', () => {
    // Custom copy is written by an organiser but interpolates values written by
    // an applicant, so escaping cannot be skipped just because the template is
    // trusted.
    const withTitle = { accepted: { en: { subject: 's', body: 'Talk: {title}' } } };
    const html = renderEmail('accepted', 'en', { ...data, title: '<img onerror=x>' }, withTitle).html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

/**
 * The free-form path. An organiser's one-off message has no stored copy behind
 * it, so this is the only place its rendering is checked — and it reaches the
 * same inbox as everything else, escaping and all.
 */
describe('renderTemplate', () => {
  it('fills the same placeholders a template would', () => {
    const email = renderTemplate(
      { subject: 'About “{title}”', body: 'Hi {speakerName}, see {proposalUrl}.' },
      'en',
      data,
    );
    expect(email.subject).toBe('About “Notes on the Analytical Engine”');
    expect(email.text).toContain('Hi Ada Lovelace, see https://cfp.example/#/c/devfest-mtl-2026.');
  });

  it('escapes what an organiser typed', () => {
    // The compose box is a plain textarea; anything in it lands inside an HTML
    // document, whether or not it was meant to.
    const html = renderTemplate({ subject: 's', body: '<img onerror=x>' }, 'en', data).html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('linkifies a paragraph that is only a URL, as the templates do', () => {
    const html = renderTemplate({ subject: 's', body: 'Hi\n\n{proposalUrl}' }, 'en', data).html;
    expect(html).toContain(`<a href="${data.proposalUrl}">`);
  });

  it('signs off, so a message is not mistaken for a personal mail', () => {
    const email = renderTemplate({ subject: 's', body: 'Quick question.' }, 'en', data);
    expect(email.text).toContain('DevFest Montréal 2026');
  });
});

describe('validateTemplate', () => {
  it('accepts the built-in copy — ours must pass our own check', () => {
    for (const kind of EMAIL_KINDS) {
      for (const locale of ['en', 'fr'] as const) {
        expect(validateTemplate(builtInTemplate(kind, locale)), `${kind}/${locale}`).toBeNull();
      }
    }
  });

  it.each([
    [{ subject: '  ', body: 'x' }, 'emptySubject'],
    [{ subject: 'x', body: '   ' }, 'emptyBody'],
  ])('rejects %j', (template, problem) => {
    expect(validateTemplate(template)?.problem).toBe(problem);
  });

  it('rejects a placeholder that does not exist, and names it', () => {
    // Left unsubstituted it would reach an applicant as literal braces.
    const result = validateTemplate({ subject: 'Hi {speaker}', body: 'x' });
    expect(result?.problem).toBe('unknownPlaceholder');
    expect(result?.detail).toBe('speaker');
  });
});
