/**
 * The import merge — between "we parsed a profile" and "the form changed".
 *
 * Defends two rules: importing never destroys what the speaker typed without
 * asking, and never fills a field with a value that will fail validation later
 * without saying so.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/enums';
import type { SessionizeProfile, SessionizeSession } from '@shared/sessionize';
import {
  applySessionizeProfile,
  applySessionizeSession,
  emptyForm,
  fromDocuments,
  toDocuments,
  type FormState,
} from '../src/lib/formState';

const profile = (over: Partial<SessionizeProfile> = {}): SessionizeProfile => ({
  handle: 'someone',
  name: 'Renée Tremblay',
  tagline: 'Advocating for open source',
  location: 'Montréal, Quebec, Canada',
  bio: 'x'.repeat(200),
  links: [
    { platform: 'github', url: 'https://github.com/renee' },
    { platform: 'linkedin', url: 'https://linkedin.com/in/renee' },
  ],
  events: ['DevFest Montréal 2025', 'ConFoo 2025'],
  sessions: [],
  warnings: [],
  ...over,
});

const session = (over: Partial<SessionizeSession> = {}): SessionizeSession => ({
  id: '163127',
  title: 'Flight Mode AI: Building Local LLM Apps',
  abstract: 'y'.repeat(400),
  ...over,
});

const form = (over: Partial<FormState> = {}): FormState => ({ ...emptyForm, ...over });

describe('stored social links', () => {
  it('rehydrates legacy name/value rows without crashing the form', () => {
    expect(
      fromDocuments(undefined, {
        socials: [
          { name: 'GitHub', value: 'https://github.com/legacy-speaker' },
          { name: 'LinkedIn', value: 'https://linkedin.com/in/legacy-speaker' },
        ],
      }).socials,
    ).toEqual([
      { platform: 'github', handle: 'https://github.com/legacy-speaker' },
      { platform: 'linkedin', handle: 'https://linkedin.com/in/legacy-speaker' },
    ]);
  });

  it('ignores malformed rows at the write boundary', () => {
    const malformed = form({
      socials: [{ platform: 'github' } as FormState['socials'][number]],
    });
    expect(toDocuments(malformed).speakerDoc.socials).toEqual([]);
  });
});

describe('filling blank fields', () => {
  it('fills everything on an empty form', () => {
    const { patch, filled } = applySessionizeProfile(form(), profile());
    expect(patch.name).toBe('Renée Tremblay');
    expect(patch.basedIn).toBe('Montréal, Quebec, Canada');
    expect(patch.bio).toHaveLength(200);
    expect(filled).toContain('bio');
    expect(filled).toContain('location');
  });

  it('never overwrites what the speaker already typed', () => {
    const existing = form({ name: 'My Own Name', bio: 'My own bio, written by me.' });
    const { patch, skipped } = applySessionizeProfile(existing, profile());

    expect(patch.name).toBeUndefined();
    expect(patch.bio).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining(['name', 'bio']));
    // ...but still fills the fields that were empty.
    expect(patch.basedIn).toBe('Montréal, Quebec, Canada');
  });

  it('does not file the Sessionize tagline as a job title', () => {
    // A tagline is a headline, not a role. Filing "Advocating for open source"
    // as a job title would put it on the public programme.
    const { patch } = applySessionizeProfile(form(), profile());
    expect(patch.jobTitle).toBeUndefined();
    expect(patch.company).toBeUndefined();
  });
});

describe('values that would fail validation are flagged, not hidden', () => {
  it('flags a bio longer than the limit but still fills it', () => {
    const long = 'x'.repeat(LIMITS.bioMax + 250);
    const { patch, overLimit } = applySessionizeProfile(form(), profile({ bio: long }));

    // Filled, because trimming prose is easier than retyping it...
    expect(patch.bio).toHaveLength(LIMITS.bioMax + 250);
    // ...but the speaker is told, rather than meeting it as a submit-time error
    // on text they never wrote.
    expect(overLimit).toEqual([
      { field: 'bio', length: LIMITS.bioMax + 250, min: LIMITS.bioMin, max: LIMITS.bioMax },
    ]);
  });

  it('flags a bio shorter than the minimum', () => {
    const { overLimit } = applySessionizeProfile(form(), profile({ bio: 'Too short.' }));
    expect(overLimit[0]).toMatchObject({ field: 'bio', length: 10 });
  });

  it('stays quiet when the bio fits', () => {
    const { overLimit } = applySessionizeProfile(form(), profile());
    expect(overLimit).toEqual([]);
  });

  it('does not flag a bio it did not fill', () => {
    const existing = form({ bio: 'Mine, and comfortably within the limit for these purposes.' });
    const { overLimit } = applySessionizeProfile(existing, profile({ bio: 'x'.repeat(5000) }));
    expect(overLimit).toEqual([]);
  });
});

describe('past talks', () => {
  it('describes events as events, not as recordings', () => {
    const { patch } = applySessionizeProfile(form(), profile());
    expect(patch.pastTalks).toBe('Spoke at: DevFest Montréal 2025, ConFoo 2025');
  });

  it('drops events until the generated text fits', () => {
    // Generated text, so trimming costs the speaker nothing — unlike their bio.
    const many = Array.from({ length: 12 }, (_, i) => `A Very Long Conference Name ${i} `.repeat(4));
    const { patch } = applySessionizeProfile(form(), profile({ events: many }));
    expect(patch.pastTalks!.length).toBeLessThanOrEqual(LIMITS.pastTalksMax);
  });

  it('adds nothing when the profile lists no events', () => {
    const { patch, filled } = applySessionizeProfile(form(), profile({ events: [] }));
    expect(patch.pastTalks).toBeUndefined();
    expect(filled).not.toContain('past talks');
  });
});

describe('applying a chosen talk', () => {
  it('fills title and abstract on an empty form', () => {
    const { patch, filled } = applySessionizeSession(form(), session());
    expect(patch.title).toBe('Flight Mode AI: Building Local LLM Apps');
    expect(patch.abstract).toHaveLength(400);
    expect(filled).toEqual(['title', 'abstract']);
  });

  it('never overwrites a talk the speaker already wrote', () => {
    const existing = form({ title: 'My own title', abstract: 'My own abstract.' });
    const { patch, skipped } = applySessionizeSession(existing, session());
    expect(patch.title).toBeUndefined();
    expect(patch.abstract).toBeUndefined();
    expect(skipped).toEqual(['title', 'abstract']);
  });

  it('flags an abstract over the limit but still fills it', () => {
    // Real case: session 163127 on a live profile is 1301 characters against
    // a 1200 limit, so this is the common path rather than an edge case.
    const long = 'y'.repeat(1301);
    const { patch, overLimit } = applySessionizeSession(form(), session({ abstract: long }));
    expect(patch.abstract).toHaveLength(1301);
    expect(overLimit).toEqual([
      { field: 'abstract', length: 1301, min: LIMITS.abstractMin, max: LIMITS.abstractMax },
    ]);
  });

  it('flags an abstract under the minimum', () => {
    const { overLimit } = applySessionizeSession(form(), session({ abstract: 'Too short.' }));
    expect(overLimit).toEqual([
      { field: 'abstract', length: 10, min: LIMITS.abstractMin, max: LIMITS.abstractMax },
    ]);
  });

  it('handles a talk with no abstract on Sessionize', () => {
    // Also a real case — not every listed talk carries a summary.
    const { patch, filled, overLimit } = applySessionizeSession(form(), session({ abstract: '' }));
    expect(patch.abstract).toBeUndefined();
    expect(filled).toEqual(['title']);
    expect(overLimit).toEqual([]);
  });

  it('flags a title longer than the limit', () => {
    const { overLimit } = applySessionizeSession(form(), session({ title: 'z'.repeat(140) }));
    expect(overLimit).toEqual([
      { field: 'title', length: 140, min: 1, max: LIMITS.title },
    ]);
  });

  describe('switching to a different talk', () => {
    const first = session({ id: '1', title: 'First talk', abstract: 'a'.repeat(300) });
    const second = session({ id: '2', title: 'Second talk', abstract: 'b'.repeat(300) });

    it('replaces text a previous import wrote', () => {
      // A speaker picking from a list of seven will pick wrong sometimes. If
      // the buttons silently no-op, the picker lies about what it did.
      const afterFirst = form({ title: first.title, abstract: first.abstract });
      const { patch, filled } = applySessionizeSession(afterFirst, second, {
        replacing: { title: first.title, abstract: first.abstract },
      });

      expect(patch.title).toBe('Second talk');
      expect(patch.abstract).toBe('b'.repeat(300));
      expect(filled).toEqual(['title', 'abstract']);
    });

    it('still refuses to replace text the speaker edited', () => {
      const edited = form({ title: 'My own title', abstract: first.abstract });
      const { patch, filled, skipped } = applySessionizeSession(edited, second, {
        replacing: { title: first.title, abstract: first.abstract },
      });

      // The hand-written title survives; only the untouched abstract switches.
      expect(patch.title).toBeUndefined();
      expect(skipped).toContain('title');
      expect(patch.abstract).toBe('b'.repeat(300));
      expect(filled).toContain('abstract');
    });

    it('does not claim the right to overwrite without a prior import', () => {
      const typed = form({ title: 'My own title', abstract: 'My own abstract.' });
      const { patch, skipped } = applySessionizeSession(typed, second);
      expect(patch.title).toBeUndefined();
      expect(patch.abstract).toBeUndefined();
      expect(skipped).toEqual(['title', 'abstract']);
    });
  });

  describe('replacing on request', () => {
    // Provenance does not survive a reload. Reopen a draft the next day and the
    // title an import wrote is indistinguishable from one you typed — so on its
    // own, `replacing` makes picking a talk a dead end for anyone returning to
    // a filled-in draft. The UI asks; this is what it asks for.

    it('overwrites the speaker’s own text once they agree', () => {
      const typed = form({ title: 'My own title', abstract: 'My own abstract.' });
      const { patch, filled, skipped } = applySessionizeSession(typed, session(), {
        replaceExisting: true,
      });

      expect(patch.title).toBe('Flight Mode AI: Building Local LLM Apps');
      expect(patch.abstract).toHaveLength(400);
      expect(filled).toEqual(['title', 'abstract']);
      expect(skipped).toEqual([]);
    });

    it('reports exactly what a refusal would cost, so the question can name it', () => {
      // The confirm text is built from `skipped`. A talk with no abstract must
      // not make us ask about an abstract we were never going to write.
      const typed = form({ title: 'My own title', abstract: 'My own abstract.' });
      const { skipped } = applySessionizeSession(typed, session({ abstract: '' }));
      expect(skipped).toEqual(['title']);
    });

    it('still leaves a field alone when the talk has nothing to put in it', () => {
      const typed = form({ title: 'My own title', abstract: 'My own abstract.' });
      const { patch } = applySessionizeSession(typed, session({ abstract: '' }), {
        replaceExisting: true,
      });
      expect(patch.title).toBe('Flight Mode AI: Building Local LLM Apps');
      expect(patch.abstract).toBeUndefined();
    });

    it('flags limits on text it replaced, not only on text it filled', () => {
      const typed = form({ title: 'My own title', abstract: 'My own abstract.' });
      const { overLimit } = applySessionizeSession(typed, session({ abstract: 'y'.repeat(1301) }), {
        replaceExisting: true,
      });
      expect(overLimit).toEqual([
        { field: 'abstract', length: 1301, min: LIMITS.abstractMin, max: LIMITS.abstractMax },
      ]);
    });
  });
});

describe('links', () => {
  it('appends to existing socials rather than replacing them', () => {
    const existing = form({ socials: [{ platform: 'mastodon', handle: 'https://mas.to/@renee' }] });
    const { patch } = applySessionizeProfile(existing, profile());
    expect(patch.socials).toHaveLength(3);
    expect(patch.socials![0]).toEqual({ platform: 'mastodon', handle: 'https://mas.to/@renee' });
  });

  it('does not re-add a link the speaker already listed', () => {
    const existing = form({ socials: [{ platform: 'github', handle: 'https://github.com/renee' }] });
    const { patch } = applySessionizeProfile(existing, profile());
    expect(patch.socials).toHaveLength(2);
  });

  it('respects the maximum number of socials', () => {
    const full = form({
      socials: Array.from({ length: LIMITS.maxSocials }, (_, i) => ({
        platform: 'website' as const,
        handle: `https://example.test/${i}`,
      })),
    });
    const { patch } = applySessionizeProfile(full, profile());
    expect(patch.socials).toBeUndefined();
  });
});
