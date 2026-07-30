import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  THEME_KEY,
  resolveTheme,
  setThemePreference,
  storedTheme,
  themeBootstrapScript,
  type Theme,
} from '../src/lib/theme';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageWith(value: string | null): StorageLike {
  return {
    getItem: (key) => (key === THEME_KEY ? value : null),
    setItem: () => {},
  };
}

function runBootstrap({
  stored = null,
  systemDark = false,
  storageFails = false,
}: {
  stored?: string | null;
  systemDark?: boolean;
  storageFails?: boolean;
} = {}) {
  const attributes = new Map<string, string>();
  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
      if (name === 'data-theme') documentElement.dataset.theme = value;
    },
  };
  const themeColor = {
    setAttribute: (name: string, value: string) => attributes.set(`meta:${name}`, value),
  };
  const sandbox = {
    document: {
      documentElement,
      getElementById: (id: string) => (id === 'cfp-theme-color' ? themeColor : null),
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]' ? themeColor : null,
    },
    localStorage: {
      getItem: (key: string) => {
        if (storageFails) throw new Error('storage blocked');
        return key === THEME_KEY ? stored : null;
      },
    },
    matchMedia: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && systemDark,
    }),
  } as Record<string, unknown>;
  sandbox.window = sandbox;

  expect(() => runInNewContext(themeBootstrapScript(), sandbox)).not.toThrow();

  return documentElement.dataset.theme ?? attributes.get('data-theme');
}

describe('theme preference', () => {
  it('uses the stable browser-storage key', () => {
    expect(THEME_KEY).toBe('cfp.theme');
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['sepia', null],
    ['', null],
    [null, null],
  ] as const)('accepts only a real stored theme (%s)', (raw, expected) => {
    expect(storedTheme(storageWith(raw))).toBe(expected);
  });

  it('treats unreadable storage as no preference', () => {
    expect(storedTheme(null)).toBeNull();
    expect(
      storedTheme({
        getItem: () => {
          throw new Error('storage blocked');
        },
      }),
    ).toBeNull();
  });

  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    [null, true, 'dark'],
    [null, false, 'light'],
  ] satisfies [Theme | null, boolean, Theme][])(
    'resolves preference %s with system-dark %s to %s',
    (preference, systemDark, expected) => {
      expect(resolveTheme(preference, systemDark)).toBe(expected);
    },
  );

  it('stores an explicit choice and does not fail when storage is blocked', () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };

    setThemePreference('dark', storage);
    expect(values.get(THEME_KEY)).toBe('dark');

    expect(() => setThemePreference('light', null)).not.toThrow();
    expect(() =>
      setThemePreference('light', {
        setItem: () => {
          throw new Error('storage blocked');
        },
      }),
    ).not.toThrow();
  });
});

describe('the pre-paint theme bootstrap', () => {
  it('lets a stored choice override the system preference', () => {
    expect(runBootstrap({ stored: 'light', systemDark: true })).toBe('light');
    expect(runBootstrap({ stored: 'dark', systemDark: false })).toBe('dark');
  });

  it('falls back to the system without a stored choice', () => {
    expect(runBootstrap({ systemDark: true })).toBe('dark');
    expect(runBootstrap({ systemDark: false })).toBe('light');
  });

  it('still reaches a safe system fallback when storage cannot be read', () => {
    expect(runBootstrap({ storageFails: true, systemDark: true })).toBe('dark');
    expect(runBootstrap({ storageFails: true, systemDark: false })).toBe('light');
  });
});
