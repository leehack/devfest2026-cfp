import { en, type Dictionary } from './en';
import { fr } from './fr';

/**
 * The half of the i18n layer with no React and no browser in it.
 *
 * Split from `./context` so a server-rendered page can import a dictionary and
 * format a date. `createContext` is not available in a server component, and
 * `detectLocale` reads `localStorage` — both live next door now.
 *
 * No i18n library. The form is about 120 strings with no pluralisation beyond
 * two counters, and a runtime dependency would cost more than it saves.
 */
export type Locale = 'en' | 'fr';

export const dictionaries: Record<Locale, Dictionary> = { en, fr };

export function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(value);
}

/**
 * The day alone, for a listing. A deadline needs its hour — "closes at 11:59
 * p.m." is the difference between submitting and not — but a directory of a
 * dozen calls does not, and the times were most of what each row was made of.
 *
 * The timezone is named rather than left to the host, so a server in another
 * region does not shift a Montréal deadline by its own offset.
 */
export function formatDay(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'long',
    timeZone: 'America/Toronto',
  }).format(value);
}

export type { Dictionary };
