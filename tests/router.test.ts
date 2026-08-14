import { describe, expect, it } from 'vitest';

import { href, placeOf } from '../src/lib/router';

/**
 * `placeOf` and `href` are the pair the whole router rests on, and they have to
 * round-trip: anything `href` writes, `placeOf` has to read back the same way,
 * or a link points somewhere its own code does not recognise. Boot-time hash
 * adoption is left to the e2e suite, where there is a real browser to have a
 * history in.
 */
describe('reading a path', () => {
  it('takes the root and its variations as home', () => {
    for (const path of ['/', '', '//', '/nonsense', '/c', '/c/']) {
      expect(placeOf(path), path).toMatchObject({ route: 'home', cfpId: null });
    }
  });

  it('reads a CFP and its section', () => {
    expect(placeOf('/c/devfest-mtl-2026')).toMatchObject({
      route: 'cfp',
      cfpId: 'devfest-mtl-2026',
    });
    expect(placeOf('/c/devfest-mtl-2026/submit')).toMatchObject({ route: 'form' });
    expect(placeOf('/c/devfest-mtl-2026/review')).toMatchObject({ route: 'review' });
    expect(placeOf('/c/devfest-mtl-2026/admin')).toMatchObject({
      route: 'admin',
      tab: 'overview',
    });
    expect(placeOf('/c/devfest-mtl-2026/admin/overview')).toMatchObject({
      route: 'admin',
      tab: 'overview',
    });
    expect(placeOf('/c/devfest-mtl-2026/admin/email')).toMatchObject({
      route: 'admin',
      tab: 'email',
    });
  });

  it('ignores a trailing slash', () => {
    expect(placeOf('/c/devfest-mtl-2026/')).toEqual(placeOf('/c/devfest-mtl-2026'));
  });

  it('reads an unknown section under a CFP as its front page', () => {
    expect(placeOf('/c/devfest-mtl-2026/whatever')).toMatchObject({ route: 'cfp' });
  });

  it('falls back to the first tab rather than an empty admin screen', () => {
    expect(placeOf('/c/devfest-mtl-2026/admin/nope')).toMatchObject({ tab: 'overview' });
  });

  /*
   * An id that would not be allowed to exist cannot be looked up, and a page
   * that says "no such call" for `/c/../../etc` is worse than the front door.
   */
  it('refuses an id the platform would never have issued', () => {
    for (const bad of ['/c/Not Valid', '/c/x', '/c/-leading', '/c/UPPER']) {
      expect(placeOf(bad), bad).toMatchObject({ route: 'home' });
    }
  });

  it('reads /new as itself and not as a CFP', () => {
    expect(placeOf('/new')).toMatchObject({ route: 'new', cfpId: null });
  });

  it('reads /platform as the global administration workspace', () => {
    expect(placeOf('/platform')).toMatchObject({ route: 'platform', cfpId: null });
  });

  it('reads organization routes without treating them as CFPs', () => {
    expect(placeOf('/orgs')).toMatchObject({ route: 'orgs', orgId: null });
    expect(placeOf('/orgs/community')).toMatchObject({ route: 'org', orgId: 'community' });
  });

  it('reads dedicated platform administration pages', () => {
    expect(placeOf('/platform/access')).toMatchObject({ route: 'platformAccess' });
    expect(placeOf('/platform/limits')).toMatchObject({ route: 'platformLimits' });
    expect(placeOf('/platform/email')).toMatchObject({ route: 'platformEmail' });
  });
});

describe('writing a path', () => {
  it('round-trips every route', () => {
    const places = [
      { route: 'home' as const, cfpId: null },
      { route: 'new' as const, cfpId: null },
      { route: 'platform' as const, cfpId: null },
      { route: 'platformAccess' as const, cfpId: null },
      { route: 'platformLimits' as const, cfpId: null },
      { route: 'platformEmail' as const, cfpId: null },
      { route: 'orgs' as const, cfpId: null },
      { route: 'org' as const, cfpId: null, orgId: 'community' },
      { route: 'cfp' as const, cfpId: 'devfest-mtl-2026' },
      { route: 'form' as const, cfpId: 'devfest-mtl-2026' },
      { route: 'review' as const, cfpId: 'devfest-mtl-2026' },
      { route: 'admin' as const, cfpId: 'devfest-mtl-2026', tab: 'settings' as const },
    ];
    for (const place of places) {
      expect(placeOf(href(place)), href(place)).toMatchObject(place);
    }
  });

  it('writes paths, not fragments', () => {
    expect(href({ route: 'cfp', cfpId: 'devfest-mtl-2026' })).toBe('/c/devfest-mtl-2026');
    expect(href({ route: 'form', cfpId: 'devfest-mtl-2026' })).toBe('/c/devfest-mtl-2026/submit');
    expect(href({ route: 'home' })).toBe('/');
  });
});
