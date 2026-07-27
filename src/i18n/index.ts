import { createContext, useContext } from 'react';
import { en, type Dictionary } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';

export const dictionaries: Record<Locale, Dictionary> = { en, fr };

/**
 * No i18n library. The form is about 120 strings with no pluralisation beyond
 * two counters, and a runtime dependency would cost more than it saves.
 */
export const I18nContext = createContext<{ locale: Locale; t: Dictionary; setLocale: (l: Locale) => void }>({
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

export function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(value);
}

export type { Dictionary };
