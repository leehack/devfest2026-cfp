/**
 * The parser reads markup Sessionize can change at any time. These tests exist
 * so that change breaks the build instead of quietly producing an empty prefill.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeSessionizeHandle,
  parseSessionizeProfile,
  parseSessionizeUrl,
} from '@shared/sessionize';

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'sessionize-profile.html'),
  'utf8',
);

describe('handle normalisation is the SSRF guard', () => {
  it('accepts a full profile URL, a bare host path, and a bare handle', () => {
    expect(normalizeSessionizeHandle('https://sessionize.com/rene-tremblay/')).toBe('rene-tremblay');
    expect(normalizeSessionizeHandle('sessionize.com/rene-tremblay')).toBe('rene-tremblay');
    expect(normalizeSessionizeHandle('rene-tremblay')).toBe('rene-tremblay');
    expect(normalizeSessionizeHandle('  RENE-TREMBLAY  ')).toBe('rene-tremblay');
  });

  it('rejects any other host', () => {
    expect(normalizeSessionizeHandle('https://evil.example/x')).toBeNull();
    // The classic suffix trick — sessionize.com is a *prefix* of this hostname.
    expect(normalizeSessionizeHandle('https://sessionize.com.evil.example/a')).toBeNull();
    expect(normalizeSessionizeHandle('http://localhost/admin')).toBeNull();
    expect(normalizeSessionizeHandle('http://169.254.169.254/latest/meta-data')).toBeNull();
  });

  it('rejects anything that is not a single path segment', () => {
    expect(normalizeSessionizeHandle('https://sessionize.com/a/b')).toBeNull();
    expect(normalizeSessionizeHandle('https://sessionize.com/')).toBeNull();
    expect(normalizeSessionizeHandle('../../etc/passwd')).toBeNull();
    expect(normalizeSessionizeHandle('')).toBeNull();
    expect(normalizeSessionizeHandle('a b')).toBeNull();
  });

  it('rejects reserved Sessionize paths that are not speaker profiles', () => {
    expect(normalizeSessionizeHandle('https://sessionize.com/developers')).toBeNull();
    expect(normalizeSessionizeHandle('app')).toBeNull();
  });
});

describe('parsing a profile page', () => {
  const profile = parseSessionizeProfile(fixture, 'rene-tremblay');

  it('reports no warnings on a complete profile', () => {
    expect(profile.warnings).toEqual([]);
  });

  it('decodes HTML entities in every text field', () => {
    expect(profile.name).toBe('Renée Tremblay');
    expect(profile.tagline).toBe('Developer tooling & build systems');
    expect(profile.location).toBe('Montréal, Quebec, Canada');
  });

  it('takes the full bio rather than the truncated og:description', () => {
    // og:description ends in "..." — saving that as someone's bio would be worse
    // than not prefilling at all.
    expect(profile.bio).not.toContain('...');
    expect(profile.bio).toContain('smaller build');
    expect(profile.bio).toContain('monthly meetup');
  });

  it('preserves paragraph breaks and strips inline markup', () => {
    expect(profile.bio!.split('\n\n')).toHaveLength(2);
    expect(profile.bio).toContain('linters');
    expect(profile.bio).not.toContain('<em>');
  });

  it('takes only the first language block, not both concatenated', () => {
    expect(profile.bio).not.toContain('conçoit des outils');
  });

  it('classifies links by their icon and ignores award links', () => {
    expect(profile.links).toEqual([
      { platform: 'github', url: 'https://github.com/renee-example' },
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/renee-example/' },
      { platform: 'bluesky', url: 'https://bsky.app/profile/renee.example' },
      { platform: 'website', url: 'https://renee.example.dev/' },
    ]);
  });

  it('collects events and de-duplicates them', () => {
    expect(profile.events).toEqual(['DevFest Montréal 2025', 'ConFoo 2025']);
  });

  it('collects talks with their full abstracts', () => {
    // The profile page carries the whole abstract, which is why importing a
    // talk needs no second request to the session page.
    expect(profile.sessions).toHaveLength(3);
    expect(profile.sessions[0]).toMatchObject({
      id: '163127',
      title: 'Making builds smaller & faster',
    });
    expect(profile.sessions[0].abstract).toContain('three real regressions');
  });

  it('keeps the paragraph breaks Sessionize encodes as <br><br>', () => {
    expect(profile.sessions[0].abstract.split('\n\n')).toHaveLength(2);
  });

  it('keeps talks that have no abstract rather than dropping them', () => {
    // Not every listed talk carries a summary, and a talk with only a title is
    // still the one the speaker wants to propose.
    expect(profile.sessions[1]).toMatchObject({ title: 'Linting for humans', abstract: '' });
    expect(profile.sessions[2]).toMatchObject({ abstract: '' });
  });
});

describe('session links resolve to a profile handle', () => {
  it('extracts the handle and session id from a talk link', () => {
    expect(
      parseSessionizeUrl('https://sessionize.com/s/leehack/flight-mode-ai-building/163127'),
    ).toEqual({ handle: 'leehack', sessionId: '163127' });
  });

  it('returns no session id for a plain profile link', () => {
    expect(parseSessionizeUrl('https://sessionize.com/leehack')).toEqual({ handle: 'leehack' });
  });

  it('rejects a non-numeric session id', () => {
    expect(parseSessionizeUrl('https://sessionize.com/s/leehack/slug/notanumber')).toBeNull();
  });

  it('rejects traversal inside the decorative slug', () => {
    expect(parseSessionizeUrl('https://sessionize.com/s/leehack/../../etc/163127')).toBeNull();
  });

  it('rejects a session path on another host', () => {
    expect(parseSessionizeUrl('https://evil.example/s/leehack/x/1')).toBeNull();
  });

  it('normalizeSessionizeHandle still refuses session links', () => {
    // The profile-only helper must not quietly accept a talk link.
    expect(
      normalizeSessionizeHandle('https://sessionize.com/s/leehack/flight-mode/163127'),
    ).toBeNull();
  });
});

describe('degraded pages warn instead of failing silently', () => {
  it('warns when the bio block is gone', () => {
    const stripped = fixture.replace(/c-s-speaker-info__bio/g, 'c-s-speaker-info__renamed');
    const profile = parseSessionizeProfile(stripped, 'x');
    expect(profile.bio).toBeUndefined();
    expect(profile.warnings).toContain('bio');
    // Everything else must still come through — one broken selector should not
    // take the whole import down.
    expect(profile.name).toBe('Renée Tremblay');
  });

  it('warns when the links group is gone', () => {
    const stripped = fixture.replace(/c-s-speaker-info__group--links/g, 'c-s-renamed');
    const profile = parseSessionizeProfile(stripped, 'x');
    expect(profile.links).toEqual([]);
    expect(profile.warnings).toContain('links');
  });

  it('warns on an empty bio rather than returning an empty string', () => {
    const emptied = fixture.replace(
      /(<div v-if="activeLanguage\.speaker == 'en'" class="c-s-speaker-info__bio">)[\s\S]*?(<\/div>)/,
      '$1$2',
    );
    const profile = parseSessionizeProfile(emptied, 'x');
    expect(profile.bio).toBeUndefined();
    expect(profile.warnings).toContain('bio');
  });

  it('survives a page that is not a profile at all', () => {
    const profile = parseSessionizeProfile('<html><body><h1>404</h1></body></html>', 'x');
    expect(profile.name).toBeUndefined();
    expect(profile.warnings).toEqual(expect.arrayContaining(['name', 'bio', 'links']));
  });
});
