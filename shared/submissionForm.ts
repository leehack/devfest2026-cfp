/**
 * The parts of the submission form each organiser gets to decide.
 *
 * The taxonomy was DevFest's: seven categories, three formats, four levels, and
 * three acknowledgements about travel, the code of conduct and recording. All
 * of it reasonable, none of it universal — a conference with two tracks and no
 * recording budget should not be asking speakers to consent to a recording that
 * will never happen, and should not have to fork the app to stop.
 *
 * So it is data, in `cfps/{cfpId}/config/submissionForm`, seeded with what
 * DevFest already used. The same machinery as the confirmation form:
 * `FieldOption`, `ConfirmField`, `localised`, `validateAnswers`. There is no
 * reason for a second form engine, and every reason for the two to behave the
 * same.
 *
 * One deliberate asymmetry. The *values* of `deliveryLanguage` are fixed and
 * only the labels and which of them are offered can change, because `either`
 * means something to the code: `languagePreference` exists only for it, and the
 * scheduling dashboard counts it. An organiser who renamed the value would
 * silently break the bilingual handling and nothing would say so.
 */

import type { ConfirmField, FieldOption, Localised } from './confirmForm';
import { FORM_LIMITS, localised, normaliseForm } from './confirmForm';
import { DELIVERY_LANGUAGES } from './enums';

/** The four choice fields the form has always had. */
export const TAXONOMY_KEYS = ['category', 'format', 'level', 'deliveryLanguage'] as const;
export type TaxonomyKey = (typeof TAXONOMY_KEYS)[number];

export interface SubmissionForm {
  category: FieldOption[];
  format: FieldOption[];
  level: FieldOption[];
  /** A subset of `DELIVERY_LANGUAGES`, relabelled. See the note above. */
  deliveryLanguage: FieldOption[];
  /**
   * The consents. Checkboxes with `required: true` — "I agree" is not a
   * preference, and an organiser who makes one optional has asked a question
   * rather than taken a consent.
   */
  acks: ConfirmField[];
  /** Anything else this organiser asks about the talk. */
  fields: ConfirmField[];
}

const both = (en: string, fr: string): Localised => ({ en, fr });
const option = (value: string, en: string, fr: string): FieldOption => ({
  value,
  label: both(en, fr),
});

/**
 * What DevFest Montréal asked, which is what a call created today starts with.
 *
 * These labels used to live in `src/i18n/`. They moved here rather than being
 * copied: once the form is configurable, a label belongs to the call that asks
 * it, and a dictionary shipped in the bundle cannot hold a label somebody else
 * typed last Tuesday.
 */
export const DEFAULT_SUBMISSION_FORM: SubmissionForm = {
  category: [
    option('app_dev', 'App Dev', 'Développement d’applications'),
    option('ai_ml', 'AI & ML', 'IA et apprentissage automatique'),
    option('cloud', 'Cloud', 'Infonuagique'),
    option('web', 'Web', 'Web'),
    option('ui_ux', 'UI & UX', 'Interface et expérience utilisateur'),
    option('soft_skills_career', 'Soft Skills & Career', 'Compétences humaines et carrière'),
    option('other', 'Other', 'Autre'),
  ],
  format: [
    option('session_40', 'Session — 40 minutes', 'Session — 40 minutes'),
    option('lightning_15', 'Lightning talk — 15 minutes', 'Conférence éclair — 15 minutes'),
    option('workshop_90', 'Workshop — 90 minutes', 'Atelier — 90 minutes'),
  ],
  level: [
    option('beginner', 'Beginner', 'Débutant'),
    option('intermediate', 'Intermediate', 'Intermédiaire'),
    option('advanced', 'Advanced', 'Avancé'),
    option('all', 'All levels', 'Tous les niveaux'),
  ],
  deliveryLanguage: [
    option('en', 'English', 'Anglais'),
    option('fr', 'French', 'Français'),
    option('either', 'Either — you choose', 'L’une ou l’autre — à vous de choisir'),
    option(
      'bilingual',
      'Bilingual — I switch between both during the talk',
      'Bilingue — j’alterne entre les deux pendant la conférence',
    ),
  ],
  acks: [
    {
      key: 'noTravelSupport',
      type: 'checkbox',
      required: true,
      label: both(
        'I understand that travel and accommodation are not covered by the event.',
        "Je comprends que les déplacements et l'hébergement ne sont pas couverts par l'événement.",
      ),
    },
    {
      key: 'coc',
      type: 'checkbox',
      required: true,
      label: both(
        'I have read and agree to the Code of Conduct.',
        'J’ai lu et j’accepte le code de conduite.',
      ),
    },
    {
      key: 'recording',
      type: 'checkbox',
      required: true,
      label: both(
        'I consent to my talk being recorded and published.',
        'Je consens à ce que ma conférence soit enregistrée et publiée.',
      ),
    },
  ],
  fields: [],
};

/**
 * A stored document turned into a usable form, key by key.
 *
 * Every call that existed before the form became configurable has no document
 * at all, and the defaults are exactly what those calls were already asking —
 * so an absent config is a working config, not an error. Merging per key rather
 * than wholesale means a config that only overrides `fields` still gets the
 * standard taxonomy instead of four empty dropdowns.
 */
export function mergeSubmissionForm(stored: unknown): SubmissionForm {
  const data = (stored ?? {}) as Partial<Record<keyof SubmissionForm, unknown>>;
  const list = <T>(value: unknown, fallback: T[]): T[] =>
    Array.isArray(value) ? (value as T[]) : fallback;

  return {
    category: list(data.category, DEFAULT_SUBMISSION_FORM.category),
    format: list(data.format, DEFAULT_SUBMISSION_FORM.format),
    level: list(data.level, DEFAULT_SUBMISSION_FORM.level),
    deliveryLanguage: list(data.deliveryLanguage, DEFAULT_SUBMISSION_FORM.deliveryLanguage),
    // `acks` and `fields` fall back to the defaults only when absent. An empty
    // array is an answer — "this call asks for no consents" — and replacing it
    // with three would put back the ones an organiser deleted.
    acks: Array.isArray(data.acks) ? (data.acks as ConfirmField[]) : DEFAULT_SUBMISSION_FORM.acks,
    fields: Array.isArray(data.fields) ? (data.fields as ConfirmField[]) : [],
  };
}

/** The stored codes, in the order the form offers them. */
export const optionValues = (options: FieldOption[]): string[] =>
  options.map((o) => o.value);

/** A `FieldOption[]` as the select components want it: value and rendered label. */
export const asOptions = (options: FieldOption[], locale: 'en' | 'fr') =>
  options.map((o) => ({ value: o.value, label: localised(o.label, locale) }));

/** A label for a stored code, falling back to the code so nothing renders blank. */
export function labelOf(
  options: FieldOption[] | undefined,
  value: string,
  locale: 'en' | 'fr',
): string {
  const found = (options ?? []).find((o) => o.value === value);
  return found ? localised(found.label, locale) : value;
}

/**
 * Rebuilds a stored form from the keys the shape defines, dropping anything
 * else — same reason as `normaliseForm`: an admin's payload is not stored as
 * sent, or a stray property rides along into every applicant's browser.
 */
export function normaliseSubmissionForm(form: SubmissionForm): SubmissionForm {
  const options = (list: FieldOption[]) =>
    (list ?? []).map((option) => ({
      value: (option.value ?? '').trim(),
      label: {
        en: (option.label?.en ?? '').trim(),
        ...(option.label?.fr?.trim() ? { fr: option.label.fr.trim() } : {}),
      },
    }));

  return {
    category: options(form.category),
    format: options(form.format),
    level: options(form.level),
    deliveryLanguage: options(form.deliveryLanguage),
    // The acks and the custom fields are `ConfirmField`s, so they go through
    // the confirmation form's own normaliser — one definition of that shape.
    acks: normaliseForm({ fields: form.acks ?? [] }).fields,
    fields: normaliseForm({ fields: form.fields ?? [] }).fields,
  };
}

export type SubmissionFormProblem =
  | 'noOptions'
  | 'tooManyOptions'
  | 'badValue'
  | 'duplicateValue'
  | 'emptyLabel'
  | 'unknownLanguage'
  | 'ackNotRequired'
  | 'noImages';

export interface SubmissionFormFault {
  problem: SubmissionFormProblem;
  /** Which list or field, so the editor can point at it. */
  key?: string;
}

const VALUE_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

/**
 * Checks the taxonomy, the consents, and that nothing here asks for a photo.
 * The custom `fields` are checked for shape by `validateForm` as well — they
 * are `ConfirmField`s and get the confirmation form's own rules.
 */
export function validateSubmissionForm(form: SubmissionForm): SubmissionFormFault | null {
  for (const key of TAXONOMY_KEYS) {
    const options = form[key] ?? [];
    if (options.length === 0) return { problem: 'noOptions', key };
    if (options.length > FORM_LIMITS.options) return { problem: 'tooManyOptions', key };

    const seen = new Set<string>();
    for (const opt of options) {
      const value = (opt.value ?? '').trim();
      if (!VALUE_PATTERN.test(value) || value.length > FORM_LIMITS.optionLabel) {
        return { problem: 'badValue', key };
      }
      if (seen.has(value)) return { problem: 'duplicateValue', key };
      seen.add(value);
      if (!opt.label?.en?.trim()) return { problem: 'emptyLabel', key };

      // The one list whose values are the code's business as well as the
      // organiser's — see the note at the top of this file.
      if (key === 'deliveryLanguage' && !(DELIVERY_LANGUAGES as readonly string[]).includes(value)) {
        return { problem: 'unknownLanguage', key };
      }
    }
  }

  for (const ack of form.acks ?? []) {
    if (ack.type !== 'checkbox' || ack.required !== true) {
      return { problem: 'ackNotRequired', key: ack.key };
    }
  }

  // §3: nothing is collected at submission time that only matters after
  // acceptance, and a photo is the clearest case — roughly seven in ten
  // applicants will be turned down, and we should not be holding their picture.
  // The confirmation form is where an image question belongs.
  for (const field of form.fields ?? []) {
    if (field.type === 'image') return { problem: 'noImages', key: field.key };
  }

  return null;
}
