/**
 * The consent gate.
 *
 * One property carries the whole feature: anything other than an explicit yes
 * has to read as no. Law 25 and the GDPR both put the burden that way round,
 * and the failure mode — measuring somebody who never agreed — is silent, so it
 * is exactly the kind that needs a test rather than a careful reading.
 */

import { beforeEach, describe, expect, it } from 'vitest';

/*
 * The unit suite runs on bare node — no jsdom, by the workspace's own rule —
 * so `window.localStorage` is stubbed here rather than pulled in as a
 * dependency. It is a Map with the four methods the module touches, which is
 * the whole of the contract being tested against.
 */
let store = new Map<string, string>();
let failOn: 'get' | 'set' | null = null;

const storage = {
  getItem: (k: string) => {
    if (failOn === 'get') throw new Error('storage is blocked');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (failOn === 'set') throw new Error('storage is blocked');
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as { window?: unknown }).window = { localStorage: storage };

const { consent, forgetConsent, granted, setConsent } = await import('../src/lib/consent');
const { pageShape } = await import('../src/lib/router');

const KEY = 'cfp.analyticsConsent';

beforeEach(() => {
  store = new Map();
  failOn = null;
});

describe('consent', () => {
  it('is not granted until somebody says so', () => {
    expect(consent()).toBe('unasked');
    expect(granted()).toBe(false);
  });

  it('remembers a yes and a no', () => {
    setConsent('granted');
    expect(granted()).toBe(true);
    setConsent('denied');
    expect(consent()).toBe('denied');
    expect(granted()).toBe(false);
  });

  it('reads an unanswered banner exactly like a declined one', () => {
    // To somebody who scrolled past it these are the same thing, so the code
    // must not treat "no answer" as permission.
    expect(granted()).toBe(false);
    setConsent('denied');
    expect(granted()).toBe(false);
  });

  it('asks again when what is measured changes', () => {
    storage.setItem(KEY, JSON.stringify({ version: 0, answer: 'granted' }));
    expect(consent()).toBe('unasked');
    expect(granted()).toBe(false);
  });

  it('treats unreadable storage as no', () => {
    // Safari in private mode throws on localStorage. "I cannot tell" is not
    // consent.
    failOn = 'get';
    expect(consent()).toBe('unasked');
    expect(granted()).toBe(false);
  });

  it('does not blow up when the answer cannot be written', () => {
    failOn = 'set';
    expect(() => setConsent('granted')).not.toThrow();
  });

  it('treats corrupt storage as no rather than crashing', () => {
    storage.setItem(KEY, 'not json');
    expect(consent()).toBe('unasked');
  });

  it('forgets, so the banner can be asked again', () => {
    setConsent('granted');
    forgetConsent();
    expect(consent()).toBe('unasked');
  });
});

describe('pageShape', () => {
  it('names the variable parts instead of filling them in', () => {
    // One row per screen in the report, not one per call for proposals.
    expect(pageShape('/c/devfest-mtl-2026')).toBe('/c/{cfpId}');
    expect(pageShape('/c/devfest-mtl-2026/submit')).toBe('/c/{cfpId}/submit');
    expect(pageShape('/c/devfest-mtl-2026/review')).toBe('/c/{cfpId}/review');
    expect(pageShape('/c/devfest-mtl-2026/admin/email')).toBe('/c/{cfpId}/admin/{tab}');
    expect(pageShape('/c/devfest-mtl-2026/admin')).toBe('/c/{cfpId}/admin/{tab}');
  });

  it('leaves the platform’s own pages alone — they have no id in them', () => {
    expect(pageShape('/')).toBe('/');
    expect(pageShape('/new')).toBe('/new');
    expect(pageShape('/platform')).toBe('/platform');
    expect(pageShape('/me')).toBe('/me');
  });

  it('never lets a slug reach the path', () => {
    // The slug is public and travels as its own parameter; the point is that
    // the path reports stay readable, and that nothing unexpected rides along.
    const slug = 'devfest-mtl-2026';
    for (const path of [`/c/${slug}`, `/c/${slug}/submit`, `/c/${slug}/admin/proposals`]) {
      expect(pageShape(path)).not.toContain(slug);
    }
  });
});
