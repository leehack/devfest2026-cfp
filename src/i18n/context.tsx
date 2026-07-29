'use client';

import { createContext, useContext } from 'react';

import { en, type Dictionary } from './en';
import type { Locale } from './index';

/**
 * The parts of the i18n layer that only exist in a browser.
 *
 * `createContext` cannot be called in a server component and `detectLocale`
 * reads `localStorage` and `navigator`, so these are behind a client boundary
 * while `./index` — the dictionaries and the date formatters — stays importable
 * from either side.
 */
export const I18nContext = createContext<{
  locale: Locale;
  t: Dictionary;
  setLocale: (l: Locale) => void;
}>({
  locale: 'en',
  t: en,
  setLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

/** Montréal defaults to French unless the browser says otherwise. */
export function detectLocale(): Locale {
  const stored = localStorage.getItem('cfp.locale');
  if (stored === 'en' || stored === 'fr') return stored;
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}
