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
import { ATTENDANCE_STATUSES, DELIVERY_LANGUAGES } from './enums';

/** A custom submission question and its committee visibility policy. */
export interface SubmissionField extends ConfirmField {
  /** Missing on legacy forms means visible. */
  reviewerVisible?: boolean;
}

/** One fixed attendance input with event-owned copy and exposure policy. */
export interface SubmissionAttendanceField {
  enabled: boolean;
  reviewerVisible: boolean;
  label: Localised;
  help?: Localised;
}

/**
 * Travel logistics are useful for some events and meaningless for others.
 * The stored status codes remain platform semantics; organisers decide whether
 * to ask the section, whether reviewers see it, and how the event describes it.
 */
export interface SubmissionAttendanceConfig {
  /** Missing on legacy forms means enabled. */
  enabled: boolean;
  title: Localised;
  question: Localised;
  help?: Localised;
  /** The status must be collected when the section is enabled. */
  statusReviewerVisible: boolean;
  /** Exactly `local`, `secured`, and `pending`, with event-owned labels. */
  statuses: FieldOption[];
  fundingSource: SubmissionAttendanceField;
  decisionBy: SubmissionAttendanceField;
  needsVisa: SubmissionAttendanceField;
  /** Optional event-scoped guidance rendered only for GDE speakers. */
  gdeGuidance?: Localised;
}

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
  fields: SubmissionField[];
  /** Optional event logistics, enabled for legacy and DevFest forms. */
  attendance: SubmissionAttendanceConfig;
}

const both = (en: string, fr: string): Localised => ({ en, fr });
const option = (value: string, en: string, fr: string): FieldOption => ({
  value,
  label: both(en, fr),
});

/**
 * What DevFest Montréal asked, retained as the compatibility fallback for calls
 * created before this document existed.
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
  attendance: {
    enabled: true,
    title: both('Getting to Montréal', 'Venir à Montréal'),
    question: both(
      'If your talk is accepted, how will you get here?',
      'Si votre conférence est retenue, comment viendrez-vous ?',
    ),
    help: both(
      'An honest answer here helps us build a schedule that holds up.',
      'Une réponse honnête nous aide à bâtir un horaire qui tient la route.',
    ),
    statuses: [
      option(
        'local',
        "I'm based in the Montréal area — no travel required",
        'Je suis dans la région de Montréal — aucun déplacement requis',
      ),
      option(
        'secured',
        'My travel and accommodation are already covered (employer, GDE program, or self-funded)',
        "Mes déplacements et mon hébergement sont déjà couverts (employeur, programme GDE, ou à mes frais)",
      ),
      option(
        'pending',
        "I expect to arrange it but it isn't confirmed yet",
        "Je compte m'organiser, mais ce n'est pas encore confirmé",
      ),
    ],
    statusReviewerVisible: true,
    fundingSource: {
      enabled: true,
      reviewerVisible: true,
      label: both('Where is the funding coming from?', 'D’où provient le financement ?'),
      help: both(
        'A sentence is enough — for example, "employer conference budget" or "applying to the GDE program".',
        'Une phrase suffit — par exemple, « budget conférences de mon employeur » ou « demande au programme GDE ».',
      ),
    },
    decisionBy: {
      enabled: true,
      reviewerVisible: true,
      label: both('When do you expect to know?', 'Quand pensez-vous le savoir ?'),
      help: both(
        'If this lands after our programme lock date, you may go on the waitlist.',
        "Si cette date suit le verrouillage du programme, vous pourriez être placé sur la liste d'attente.",
      ),
    },
    needsVisa: {
      enabled: true,
      reviewerVisible: true,
      label: both(
        'I will need a visa or eTA to enter Canada',
        "J'aurai besoin d'un visa ou d'une AVE pour entrer au Canada",
      ),
      help: both(
        "We will issue an invitation letter as soon as you're accepted. Please start your application as early as possible — processing times can run to several months.",
        "Nous émettrons une lettre d'invitation dès votre acceptation. Commencez votre demande le plus tôt possible — les délais de traitement peuvent atteindre plusieurs mois.",
      ),
    },
    gdeGuidance: both(
      'GDEs should contact their GDE program manager regarding travel support. This event does not provide it directly.',
      "Les GDE devraient communiquer avec leur gestionnaire du programme GDE au sujet du soutien aux déplacements. L'événement ne le fournit pas directement.",
    ),
  },
};

/** Generic calls opt into event-specific logistics rather than inheriting Montréal copy. */
export const NEW_CFP_SUBMISSION_FORM: SubmissionForm = {
  ...DEFAULT_SUBMISSION_FORM,
  acks: DEFAULT_SUBMISSION_FORM.acks.filter((ack) => ack.key !== 'noTravelSupport'),
  attendance: {
    enabled: false,
    title: both('Travel and attendance', 'Déplacements et présence'),
    question: both(
      'If your talk is accepted, what are your attendance plans?',
      'Si votre conférence est retenue, quels sont vos plans de présence ?',
    ),
    help: both(
      'This helps the organisers plan the programme and speaker support.',
      "Cela aide l'équipe organisatrice à planifier le programme et le soutien aux conférenciers.",
    ),
    statusReviewerVisible: true,
    statuses: [
      option('local', 'No travel required', 'Aucun déplacement requis'),
      option(
        'secured',
        'My travel and accommodation are arranged',
        'Mes déplacements et mon hébergement sont organisés',
      ),
      option(
        'pending',
        'My travel arrangements are not confirmed yet',
        'Mes déplacements ne sont pas encore confirmés',
      ),
    ],
    fundingSource: {
      enabled: true,
      reviewerVisible: true,
      label: both('How will your travel be funded?', 'Comment vos déplacements seront-ils financés ?'),
      help: both(
        'A short description is enough.',
        'Une brève description suffit.',
      ),
    },
    decisionBy: {
      enabled: true,
      reviewerVisible: true,
      label: both(
        'When do you expect your plans to be confirmed?',
        'Quand pensez-vous que vos plans seront confirmés ?',
      ),
    },
    needsVisa: {
      enabled: true,
      reviewerVisible: true,
      label: both(
        'I will need entry documentation support',
        "J'aurai besoin d'aide pour les documents d'entrée",
      ),
      help: both(
        'The organisers can follow up about available documentation.',
        "L'équipe organisatrice pourra vous informer des documents disponibles.",
      ),
    },
  },
};

/**
 * Keeps only attendance values the event currently asks for. Unknown and
 * disabled properties are ignored rather than newly persisted.
 */
export function attendanceInputFor(
  form: SubmissionForm | SubmissionAttendanceConfig,
  value: unknown,
): Record<string, unknown> | undefined {
  const config = 'attendance' in form ? form.attendance : form;
  if (!config.enabled) return undefined;
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const status = source.status;
  const needsFunding = status === 'secured' || status === 'pending';
  return {
    status,
    ...(config.fundingSource.enabled && needsFunding
      ? { fundingSource: source.fundingSource }
      : {}),
    ...(config.decisionBy.enabled && status === 'pending'
      ? { decisionBy: source.decisionBy }
      : {}),
    ...(config.needsVisa.enabled ? { needsVisa: source.needsVisa } : {}),
  };
}

/**
 * Shapes a Firestore merge. Configured conditional fields use an empty string
 * when inapplicable so `mapEmpty(deleteField())` removes their previous value;
 * disabled fields stay absent so historical data is left untouched.
 */
export function attendanceWriteFor(
  form: SubmissionForm | SubmissionAttendanceConfig,
  value: unknown,
): Record<string, unknown> | undefined {
  const config = 'attendance' in form ? form.attendance : form;
  if (!config.enabled) return undefined;
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const status = source.status;
  const needsFunding = status === 'secured' || status === 'pending';
  return {
    status,
    ...(config.fundingSource.enabled
      ? { fundingSource: needsFunding ? source.fundingSource : '' }
      : {}),
    ...(config.decisionBy.enabled
      ? { decisionBy: status === 'pending' ? source.decisionBy : '' }
      : {}),
    ...(config.needsVisa.enabled ? { needsVisa: source.needsVisa } : {}),
  };
}

/** Whether a reviewer can receive at least one attendance property. */
export function reviewerAttendanceEnabled(
  form: SubmissionForm | SubmissionAttendanceConfig,
): boolean {
  const config = 'attendance' in form ? form.attendance : form;
  return (
    config.enabled &&
    (config.statusReviewerVisible ||
      (config.fundingSource.enabled && config.fundingSource.reviewerVisible) ||
      (config.decisionBy.enabled && config.decisionBy.reviewerVisible) ||
      (config.needsVisa.enabled && config.needsVisa.reviewerVisible))
  );
}

/** Visa-specific email copy follows the event's current collection policy. */
export function attendanceNeedsVisa(
  form: SubmissionForm | SubmissionAttendanceConfig,
  value: unknown,
): boolean {
  return attendanceInputFor(form, value)?.needsVisa === true;
}

/** Rejects malformed switches before normalisation could coerce them to false. */
export function rawSubmissionAttendanceFault(stored: unknown): SubmissionFormFault | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const raw = (stored as Record<string, unknown>).attendance;
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problem: 'badAttendanceConfig', key: 'attendance' };
  }
  const attendance = raw as Record<string, unknown>;
  for (const key of ['enabled', 'statusReviewerVisible'] as const) {
    if (attendance[key] !== undefined && typeof attendance[key] !== 'boolean') {
      return { problem: 'badAttendanceConfig', key: `attendance.${key}` };
    }
  }
  for (const key of ['fundingSource', 'decisionBy', 'needsVisa'] as const) {
    const rawField = attendance[key];
    if (rawField === undefined) continue;
    if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
      return { problem: 'badAttendanceConfig', key: `attendance.${key}` };
    }
    const field = rawField as Record<string, unknown>;
    for (const switchKey of ['enabled', 'reviewerVisible'] as const) {
      if (field[switchKey] !== undefined && typeof field[switchKey] !== 'boolean') {
        return {
          problem: 'badAttendanceConfig',
          key: `attendance.${key}.${switchKey}`,
        };
      }
    }
  }
  return null;
}

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
  const hasAttendanceConfig =
    Boolean(data.attendance) &&
    typeof data.attendance === 'object' &&
    !Array.isArray(data.attendance);
  const attendanceSource =
    hasAttendanceConfig
      ? (data.attendance as Partial<Record<keyof SubmissionAttendanceConfig, unknown>>)
      : {};
  const attendanceField = (
    value: unknown,
    fallback: SubmissionAttendanceField,
  ): SubmissionAttendanceField => {
    const hasField = Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const source = hasField
      ? (value as Partial<SubmissionAttendanceField>)
      : {};
    return {
      enabled: source.enabled === undefined ? fallback.enabled : (source.enabled as boolean),
      reviewerVisible:
        source.reviewerVisible === undefined
          ? fallback.reviewerVisible
          : (source.reviewerVisible as boolean),
      label: source.label ?? fallback.label,
      ...(source.help !== undefined
        ? { help: source.help }
        : !hasField && fallback.help
          ? { help: fallback.help }
          : {}),
    } as SubmissionAttendanceField;
  };
  const attendance: SubmissionAttendanceConfig = {
    enabled:
      attendanceSource.enabled === undefined
        ? DEFAULT_SUBMISSION_FORM.attendance.enabled
        : (attendanceSource.enabled as boolean),
    title: (attendanceSource.title ?? DEFAULT_SUBMISSION_FORM.attendance.title) as Localised,
    question: (attendanceSource.question ?? DEFAULT_SUBMISSION_FORM.attendance.question) as Localised,
    ...(attendanceSource.help !== undefined
      ? { help: attendanceSource.help as Localised }
      : !hasAttendanceConfig && DEFAULT_SUBMISSION_FORM.attendance.help
        ? { help: DEFAULT_SUBMISSION_FORM.attendance.help }
        : {}),
    statuses: list(
      attendanceSource.statuses,
      DEFAULT_SUBMISSION_FORM.attendance.statuses,
    ),
    statusReviewerVisible:
      attendanceSource.statusReviewerVisible === undefined
        ? DEFAULT_SUBMISSION_FORM.attendance.statusReviewerVisible
        : (attendanceSource.statusReviewerVisible as boolean),
    fundingSource: attendanceField(
      attendanceSource.fundingSource,
      DEFAULT_SUBMISSION_FORM.attendance.fundingSource,
    ),
    decisionBy: attendanceField(
      attendanceSource.decisionBy,
      DEFAULT_SUBMISSION_FORM.attendance.decisionBy,
    ),
    needsVisa: attendanceField(
      attendanceSource.needsVisa,
      DEFAULT_SUBMISSION_FORM.attendance.needsVisa,
    ),
    ...(attendanceSource.gdeGuidance !== undefined
      ? { gdeGuidance: attendanceSource.gdeGuidance as Localised }
      : !hasAttendanceConfig && DEFAULT_SUBMISSION_FORM.attendance.gdeGuidance
        ? { gdeGuidance: DEFAULT_SUBMISSION_FORM.attendance.gdeGuidance }
        : {}),
  };

  return {
    category: list(data.category, DEFAULT_SUBMISSION_FORM.category),
    format: list(data.format, DEFAULT_SUBMISSION_FORM.format),
    level: list(data.level, DEFAULT_SUBMISSION_FORM.level),
    deliveryLanguage: list(data.deliveryLanguage, DEFAULT_SUBMISSION_FORM.deliveryLanguage),
    // `acks` and `fields` fall back to the defaults only when absent. An empty
    // array is an answer — "this call asks for no consents" — and replacing it
    // with three would put back the ones an organiser deleted.
    acks: Array.isArray(data.acks) ? (data.acks as ConfirmField[]) : DEFAULT_SUBMISSION_FORM.acks,
    fields: Array.isArray(data.fields) ? (data.fields as SubmissionField[]) : [],
    attendance,
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
  const localisedText = (value: Localised | undefined): Localised => ({
    en: (value?.en ?? '').trim(),
    ...(value?.fr?.trim() ? { fr: value.fr.trim() } : {}),
  });
  const attendanceField = (value: SubmissionAttendanceField): SubmissionAttendanceField => ({
    enabled: value.enabled === true,
    reviewerVisible: value.reviewerVisible === true,
    label: localisedText(value.label),
    ...(value.help?.en?.trim() || value.help?.fr?.trim()
      ? { help: localisedText(value.help) }
      : {}),
  });
  const options = (list: FieldOption[]) =>
    (list ?? []).map((option) => ({
      value: (option.value ?? '').trim(),
      label: {
        en: (option.label?.en ?? '').trim(),
        ...(option.label?.fr?.trim() ? { fr: option.label.fr.trim() } : {}),
      },
    }));

  const normalisedFields = (form.fields ?? []).map((source) => {
    const [field] = normaliseForm({ fields: [source] }).fields;
    return {
      ...field,
      // Legacy questions predate the switch and were all shown to reviewers.
      // Store the resolved value after the next save so the choice is explicit.
      reviewerVisible: source.reviewerVisible !== false,
    };
  });

  return {
    category: options(form.category),
    format: options(form.format),
    level: options(form.level),
    deliveryLanguage: options(form.deliveryLanguage),
    // The acks and the custom fields are `ConfirmField`s, so they go through
    // the confirmation form's own normaliser — one definition of that shape.
    acks: normaliseForm({ fields: form.acks ?? [] }).fields,
    fields: normalisedFields,
    attendance: {
      enabled: form.attendance.enabled === true,
      title: localisedText(form.attendance.title),
      question: localisedText(form.attendance.question),
      ...(form.attendance.help?.en?.trim() || form.attendance.help?.fr?.trim()
        ? { help: localisedText(form.attendance.help) }
        : {}),
      statuses: options(form.attendance.statuses),
      statusReviewerVisible: form.attendance.statusReviewerVisible === true,
      fundingSource: attendanceField(form.attendance.fundingSource),
      decisionBy: attendanceField(form.attendance.decisionBy),
      needsVisa: attendanceField(form.attendance.needsVisa),
      ...(form.attendance.gdeGuidance?.en?.trim() || form.attendance.gdeGuidance?.fr?.trim()
        ? { gdeGuidance: localisedText(form.attendance.gdeGuidance) }
        : {}),
    },
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
  | 'badReviewerVisibility'
  | 'badAttendanceConfig'
  | 'unknownAttendanceStatus'
  | 'tooLong'
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

  const attendance = form.attendance;
  if (
    !attendance ||
    typeof attendance !== 'object' ||
    typeof attendance.enabled !== 'boolean' ||
    typeof attendance.statusReviewerVisible !== 'boolean'
  ) {
    return { problem: 'badAttendanceConfig', key: 'attendance' };
  }
  const attendanceCopy: Array<[string, Localised | undefined, number]> = [
    ['attendance.title', attendance.title, FORM_LIMITS.label],
    ['attendance.question', attendance.question, FORM_LIMITS.label],
    ['attendance.help', attendance.help, FORM_LIMITS.help],
    ['attendance.fundingSource', attendance.fundingSource?.label, FORM_LIMITS.label],
    ['attendance.fundingSourceHelp', attendance.fundingSource?.help, FORM_LIMITS.help],
    ['attendance.decisionBy', attendance.decisionBy?.label, FORM_LIMITS.label],
    ['attendance.decisionByHelp', attendance.decisionBy?.help, FORM_LIMITS.help],
    ['attendance.needsVisa', attendance.needsVisa?.label, FORM_LIMITS.label],
    ['attendance.needsVisaHelp', attendance.needsVisa?.help, FORM_LIMITS.help],
    ['attendance.gdeGuidance', attendance.gdeGuidance, FORM_LIMITS.help],
  ];
  for (const [key, value, max] of attendanceCopy) {
    if (
      !key.endsWith('Help') &&
      key !== 'attendance.help' &&
      key !== 'attendance.gdeGuidance' &&
      !value?.en?.trim()
    ) {
      return { problem: 'emptyLabel', key };
    }
    for (const text of [value?.en, value?.fr]) {
      if (text && text.length > max) return { problem: 'tooLong', key };
    }
  }
  for (const [key, field] of [
    ['attendance.fundingSource', attendance.fundingSource],
    ['attendance.decisionBy', attendance.decisionBy],
    ['attendance.needsVisa', attendance.needsVisa],
  ] as const) {
    if (
      !field ||
      typeof field !== 'object' ||
      typeof field.enabled !== 'boolean' ||
      typeof field.reviewerVisible !== 'boolean'
    ) {
      return { problem: 'badAttendanceConfig', key };
    }
  }
  if (
    !Array.isArray(attendance.statuses) ||
    attendance.statuses.length !== ATTENDANCE_STATUSES.length
  ) {
    return { problem: 'badAttendanceConfig', key: 'attendance.statuses' };
  }
  const attendanceValues = attendance.statuses.map((status) => status.value);
  if (
    new Set(attendanceValues).size !== ATTENDANCE_STATUSES.length ||
    attendanceValues.some(
      (value) => !(ATTENDANCE_STATUSES as readonly string[]).includes(value),
    )
  ) {
    return { problem: 'unknownAttendanceStatus', key: 'attendance.statuses' };
  }
  for (const status of attendance.statuses) {
    if (!status.label?.en?.trim()) {
      return { problem: 'emptyLabel', key: `attendance.${status.value}` };
    }
    for (const text of [status.label.en, status.label.fr]) {
      if (text && text.length > FORM_LIMITS.label) {
        return { problem: 'tooLong', key: `attendance.${status.value}` };
      }
    }
  }

  // §3: nothing is collected at submission time that only matters after
  // acceptance, and a photo is the clearest case — roughly seven in ten
  // applicants will be turned down, and we should not be holding their picture.
  // The confirmation form is where an image question belongs.
  for (const field of form.fields ?? []) {
    if (
      field.reviewerVisible !== undefined &&
      typeof field.reviewerVisible !== 'boolean'
    ) {
      return { problem: 'badReviewerVisibility', key: field.key };
    }
    if (field.type === 'image') return { problem: 'noImages', key: field.key };
  }

  return null;
}
