/**
 * The questions an organiser asks a speaker who has just said yes (§3).
 *
 * Every event asks something different — a t-shirt size, dietary needs, a bio
 * for the programme, consent to be photographed — and none of it belongs in the
 * codebase. A field that only exists after a redeploy is a field the organiser
 * cannot add on the Tuesday they realise they need it, which in practice means
 * chasing forty people by hand instead. So the form is data: written from
 * `/admin` into `config/confirmForm`, rendered by the speaker's page.
 *
 * Pure, and shared. The browser renders from this and `respondToDecision`
 * validates against it, so a rule cannot be enforced in one and forgotten in the
 * other — the client's copy is a convenience, and the callable's is the one that
 * counts.
 */

export const FIELD_TYPES = ['text', 'textarea', 'select', 'checkbox', 'image'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_LIMITS = {
  fields: 20,
  key: 40,
  label: 120,
  help: 300,
  options: 30,
  optionLabel: 80,
  /** What a speaker may write back, by field type. */
  answerText: 200,
  answerTextarea: 2000,
  /** Bytes. Re-checked by `uploadHeadshot`, which is what actually enforces it. */
  image: 5 * 1024 * 1024,
} as const;

/** Image types accepted by the upload and preview callables. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface HeadshotUploadPointer {
  path: string;
  generation: string;
  contentType: (typeof IMAGE_TYPES)[number];
  size: number;
}

export type HeadshotUploads = Record<string, HeadshotUploadPointer>;

/**
 * Legacy canonical location used before proposal-backed upload pointers.
 *
 * Confirmation and preview retain this fallback for existing CFPs. New uploads
 * use a unique `workingHeadshotPath`; the CFP still comes first so deletion is
 * one bounded prefix.
 */
export function headshotPath(cfpId: string, uid: string, key: string): string {
  return `cfps/${cfpId}/headshots/${uid}/${key}`;
}

/** A unique working upload. Only its server-written proposal pointer is live. */
export function workingHeadshotPath(
  cfpId: string,
  proposalId: string,
  key: string,
  uploadId: string,
): string {
  return `${workingHeadshotPrefix(cfpId, proposalId, key)}${encodeURIComponent(uploadId)}`;
}

export function workingHeadshotPrefix(
  cfpId: string,
  proposalId: string,
  key: string,
): string {
  return `cfps/${cfpId}/workingHeadshots/${proposalId}/${key}/`;
}

export function isWorkingHeadshotPath(
  path: string,
  cfpId: string,
  proposalId: string,
  key: string,
): boolean {
  const prefix = workingHeadshotPrefix(cfpId, proposalId, key);
  const uploadId = path.slice(prefix.length);
  return path.startsWith(prefix) && uploadId.length > 0 && !uploadId.includes('/');
}

/**
 * A confirmed image answer is a snapshot, not the speaker's replaceable upload.
 * The generation makes a later confirmation a different object while keeping
 * retries for the same upload idempotent. Browser rules never open this prefix.
 */
export function confirmedHeadshotPath(
  cfpId: string,
  proposalId: string,
  key: string,
  generation: string,
): string {
  return `${confirmedHeadshotPrefix(cfpId, proposalId, key)}${encodeURIComponent(generation)}`;
}

export function confirmedHeadshotPrefix(
  cfpId: string,
  proposalId: string,
  key: string,
): string {
  return `cfps/${cfpId}/confirmedHeadshots/${proposalId}/${key}/`;
}

export function isConfirmedHeadshotPath(
  path: string,
  cfpId: string,
  proposalId: string,
  key: string,
): boolean {
  const prefix = confirmedHeadshotPrefix(cfpId, proposalId, key);
  const generation = path.slice(prefix.length);
  return path.startsWith(prefix) && generation.length > 0 && !generation.includes('/');
}


/**
 * Both languages, because the whole app is bilingual. French is allowed to be
 * blank and falls back to English at render time: an organiser who has not
 * translated a question yet should be able to ask it anyway, rather than be
 * blocked or — worse — ship an empty label.
 */
export interface Localised {
  en: string;
  fr?: string;
}

export interface FieldOption {
  value: string;
  label: Localised;
}

export interface ConfirmField {
  /** Stable across edits: it is the key the answer is stored under. */
  key: string;
  type: FieldType;
  label: Localised;
  help?: Localised;
  /** For a checkbox this means "must be ticked" — a consent, not a preference. */
  required: boolean;
  options?: FieldOption[];
}

export interface ConfirmForm {
  fields: ConfirmField[];
}

export const EMPTY_FORM: ConfirmForm = { fields: [] };

export type AnswerValue = string | boolean;
export type Answers = Record<string, AnswerValue>;

/** English is the base; an untranslated question is better than a blank one. */
export function localised(value: Localised | undefined, locale: 'en' | 'fr'): string {
  if (!value) return '';
  return (locale === 'fr' ? value.fr?.trim() : '') || value.en;
}

/**
 * A key is used as a Firestore map key and as a form input name, so it is kept
 * to the conservative set rather than whatever an organiser types. Generated
 * from the label on the admin side; validated here for the ones typed by hand.
 */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

export type FormProblem =
  | 'tooManyFields'
  | 'badKey'
  | 'duplicateKey'
  | 'emptyLabel'
  | 'tooLong'
  | 'needsOptions'
  | 'duplicateOption';

export interface FormFault {
  problem: FormProblem;
  /** Which field it is, so the editor can say so rather than just refusing. */
  key?: string;
}

/** Checks a form definition — what an admin may save. */
export function validateForm(form: ConfirmForm): FormFault | null {
  const fields = form.fields ?? [];
  if (fields.length > FORM_LIMITS.fields) return { problem: 'tooManyFields' };

  const seen = new Set<string>();
  for (const field of fields) {
    const key = (field.key ?? '').trim();
    if (!KEY_PATTERN.test(key) || key.length > FORM_LIMITS.key) {
      return { problem: 'badKey', key };
    }
    if (seen.has(key)) return { problem: 'duplicateKey', key };
    seen.add(key);

    if (!FIELD_TYPES.includes(field.type)) return { problem: 'badKey', key };

    if (!field.label?.en?.trim()) return { problem: 'emptyLabel', key };
    for (const text of [field.label.en, field.label.fr, field.help?.en, field.help?.fr]) {
      if (text && text.length > FORM_LIMITS.help) return { problem: 'tooLong', key };
    }
    if (field.label.en.length > FORM_LIMITS.label) return { problem: 'tooLong', key };

    if (field.type === 'select') {
      const options = field.options ?? [];
      if (options.length === 0) return { problem: 'needsOptions', key };
      if (options.length > FORM_LIMITS.options) return { problem: 'tooLong', key };

      const values = new Set<string>();
      for (const option of options) {
        const value = (option.value ?? '').trim();
        if (!value || value.length > FORM_LIMITS.optionLabel) return { problem: 'needsOptions', key };
        if (values.has(value)) return { problem: 'duplicateOption', key };
        values.add(value);
        if (!option.label?.en?.trim()) return { problem: 'emptyLabel', key };
      }
    }
  }
  return null;
}

const trimmed = (value: Localised | undefined): Localised => ({
  en: (value?.en ?? '').trim(),
  ...(value?.fr?.trim() ? { fr: value.fr.trim() } : {}),
});

/**
 * Rebuilds a form from the keys the shape defines, dropping anything else.
 *
 * An admin's payload is not stored as sent: without this, a stray property
 * rides along into `config/confirmForm` and from there into every speaker's
 * browser, and the document slowly stops matching the type that reads it.
 */
export function normaliseForm(form: ConfirmForm): ConfirmForm {
  return {
    fields: (form.fields ?? []).map((field) => ({
      key: (field.key ?? '').trim(),
      type: field.type,
      label: trimmed(field.label),
      ...(field.help?.en?.trim() || field.help?.fr?.trim()
        ? { help: trimmed(field.help) }
        : {}),
      required: field.required === true,
      // Options are meaningless on the other types, and a leftover set from a
      // field that used to be a select would reappear if it ever changed back.
      ...(field.type === 'select'
        ? {
            options: (field.options ?? []).map((option) => ({
              value: (option.value ?? '').trim(),
              label: trimmed(option.label),
            })),
          }
        : {}),
    })),
  };
}

export type AnswerProblem = 'required' | 'tooLong' | 'notAnOption' | 'wrongType';

/** Keyed by field, so the speaker's page can mark the field that is wrong. */
export type AnswerFaults = Record<string, AnswerProblem>;

/**
 * Checks a speaker's answers against the form as it stands now.
 *
 * Unknown keys are dropped rather than rejected: a form is edited while people
 * are answering it, and a speaker who loaded the page before a field was removed
 * should not have their confirmation refused for it. The returned `clean` is
 * what gets stored — only what the form still asks for.
 */
export function validateAnswers(
  form: ConfirmForm,
  answers: Answers,
  /**
   * Which image questions actually have an object in the bucket, by field key,
   * and where. Supplied by the callable, which is the only party that can look
   * — an uploaded file is a fact about storage, and asking the browser to
   * assert it would be asking it to mark its own work.
   */
  uploads: Record<string, string> = {},
): { faults: AnswerFaults; clean: Answers } {
  const faults: AnswerFaults = {};
  const clean: Answers = {};

  for (const field of form.fields ?? []) {
    const raw = answers?.[field.key];

    if (field.type === 'image') {
      const path = uploads[field.key];
      // Whatever the browser sent for this key is ignored outright.
      if (!path) {
        if (field.required) faults[field.key] = 'required';
        continue;
      }
      clean[field.key] = path;
      continue;
    }

    if (field.type === 'checkbox') {
      const value = raw === true;
      // A required checkbox is a consent: unticked is not an answer, it is a no.
      if (field.required && !value) faults[field.key] = 'required';
      clean[field.key] = value;
      continue;
    }

    if (raw !== undefined && typeof raw !== 'string') {
      faults[field.key] = 'wrongType';
      continue;
    }

    const value = (raw ?? '').trim();
    if (!value) {
      if (field.required) faults[field.key] = 'required';
      // Absent rather than empty-string: a blank optional answer is not an
      // answer, and storing "" makes every export need the same check again.
      continue;
    }

    if (field.type === 'select') {
      if (!(field.options ?? []).some((option) => option.value === value)) {
        faults[field.key] = 'notAnOption';
        continue;
      }
    } else {
      const max =
        field.type === 'textarea' ? FORM_LIMITS.answerTextarea : FORM_LIMITS.answerText;
      if (value.length > max) {
        faults[field.key] = 'tooLong';
        continue;
      }
    }

    clean[field.key] = value;
  }

  return { faults, clean };
}

/** A label an organiser typed, turned into a key. Collisions get a suffix. */
export function keyFromLabel(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^[^a-zA-Z]+/, '')
      .replace(/_+$/, '')
      .slice(0, FORM_LIMITS.key)
      .toLowerCase() || 'field';

  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`.slice(0, FORM_LIMITS.key);
    if (!taken.includes(candidate)) return candidate;
  }
}
