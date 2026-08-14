import { LIMITS, SOCIAL_PLATFORMS } from '@shared/enums';
import type { AttendanceStatus, SocialPlatform } from '@shared/enums';
import type { Answers } from '@shared/confirmForm';
import type { Social } from '@shared/types';
import type { SubmissionInput } from '@shared/schema';
import type { SessionizeProfile, SessionizeSession } from '@shared/sessionize';

/**
 * The form is one flat object; Firestore stores the talk and the person
 * separately (§6); the schema wants a third shape. All three mappings live here
 * rather than scattered across components.
 */
export interface FormState {
  // Proposal
  title: string;
  abstract: string;
  pitch: string;
  /* Plain strings, not the old literal unions: which values a call offers is
     its own config now (`shared/submissionForm.ts`), so the type cannot know
     them. What is offered is checked against that config, in both passes. */
  category: string;
  format: string;
  level: string;
  deliveryLanguage: string;
  languagePreference: string;

  // Speaker
  name: string;
  bio: string;
  company: string;
  jobTitle: string;
  basedIn: string;
  socials: Social[];
  isGde: boolean;
  pastTalks: string;
  email: string;
  sessionizeUrl: string;

  /** The consents this call asks for, by key. Configurable, hence a map. */
  acks: Record<string, boolean>;
  /** Answers to this call's own questions about the talk. */
  answers: Answers;

  // Attendance
  attendanceStatus: AttendanceStatus | '';
  fundingSource: string;
  decisionBy: string;
  needsVisa: boolean;
}

/**
 * Everything that belongs to one talk rather than to the speaker.
 *
 * The acks are here because they are per-submission by design — "I consent to
 * my talk being recorded" is a statement about a talk, not a standing setting.
 * Attendance is not: it describes the trip, which is the same whichever talk
 * gets in.
 */
const TALK_KEYS = [
  'title',
  'abstract',
  'pitch',
  'category',
  'format',
  'level',
  'deliveryLanguage',
  'languagePreference',
  'acks',
  'answers',
] as const;

/** A blank talk that keeps the speaker's profile — retyping a bio to submit a
 * second talk is where people give up. */
export function clearTalk(form: FormState): FormState {
  const next = { ...form };
  for (const key of TALK_KEYS) {
    (next as Record<string, unknown>)[key] = emptyForm[key];
  }
  return next;
}

export const emptyForm: FormState = {
  title: '',
  abstract: '',
  pitch: '',
  category: '',
  format: '',
  level: '',
  deliveryLanguage: '',
  languagePreference: '',
  name: '',
  bio: '',
  company: '',
  jobTitle: '',
  basedIn: '',
  socials: [],
  isGde: false,
  pastTalks: '',
  email: '',
  sessionizeUrl: '',
  acks: {},
  answers: {},
  attendanceStatus: '',
  fundingSource: '',
  decisionBy: '',
  needsVisa: false,
};

const legacySocialPlatform = (value: unknown): SocialPlatform => {
  const key = String(value ?? '').trim().toLowerCase();
  if (SOCIAL_PLATFORMS.includes(key as SocialPlatform)) return key as SocialPlatform;
  if (key === 'twitter') return 'x';
  return 'other';
};

/** Keeps old profile rows usable after the social-link schema changed. */
function readSocials(value: unknown): Social[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const handle = String(row.handle ?? row.value ?? '').trim();
      if (!handle) return [];
      return [{
        platform: legacySocialPlatform(row.platform ?? row.name),
        handle,
      }];
    })
    .slice(0, LIMITS.maxSocials);
}

/**
 * Splits the form into its two documents.
 *
 * Empty optionals stay as `''` rather than being dropped: a `{merge: true}`
 * write ignores absent keys, so a cleared pitch would appear to save and then
 * come back. The caller decides what `''` means — see `mapEmpty`.
 */
export function toDocuments(form: FormState) {
  const funded = form.attendanceStatus === 'secured' || form.attendanceStatus === 'pending';

  const proposalDoc = {
    title: form.title.trim(),
    abstract: form.abstract.trim(),
    pitch: form.pitch.trim(),
    category: form.category,
    format: form.format,
    level: form.level,
    deliveryLanguage: form.deliveryLanguage,
    // Only stored for `either` — the schema rejects it on anything else, so a
    // value left behind by a changed dropdown has to be cleared, not hidden.
    languagePreference:
      form.deliveryLanguage === 'either' ? form.languagePreference.trim() : '',
    acks: form.acks,
    answers: form.answers,
    attendance: {
      status: form.attendanceStatus,
      fundingSource: funded ? form.fundingSource.trim() : '',
      decisionBy: form.attendanceStatus === 'pending' ? form.decisionBy : '',
      needsVisa: form.needsVisa,
    },
  };

  const speakerDoc = {
    name: form.name.trim(),
    bio: form.bio.trim(),
    company: form.company.trim(),
    jobTitle: form.jobTitle.trim(),
    basedIn: form.basedIn.trim(),
    pastTalks: form.pastTalks.trim(),
    email: form.email.trim(),
    socials: form.socials.filter(
      (social) => typeof social?.handle === 'string' && social.handle.trim() !== '',
    ),
    isGde: form.isGde,
    sessionizeUrl: form.sessionizeUrl.trim(),
  };

  return { proposalDoc, speakerDoc };
}

/**
 * Replaces every `''` with `replacement`, one level into nested maps.
 * `undefined` drops the key (Firestore rejects undefined, and zod reads a
 * missing key as "not provided"); anything else is written through, which is
 * how the `deleteField()` sentinel reaches Firestore.
 */
export function mapEmpty<T>(obj: Record<string, any>, replacement: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === '' || value === undefined || value === null) {
      if (replacement !== undefined) out[key] = replacement;
      continue;
    }
    if (Array.isArray(value) || typeof value !== 'object') {
      out[key] = value;
      continue;
    }
    out[key] = mapEmpty(value, replacement);
  }
  return out;
}

export interface OverLimit {
  field: 'bio' | 'title' | 'abstract';
  length: number;
  min: number;
  max: number;
}

/**
 * Records a filled value the schema will reject. Sessionize has no reason to
 * respect our limits, so fill it anyway — trimming prose beats retyping it —
 * but say so, rather than letting it surface as a submit-time error on text the
 * speaker never wrote.
 */
function checkLimits(
  patch: Partial<FormState>,
  field: OverLimit['field'],
  min: number,
  max: number,
  out: OverLimit[],
): void {
  const value = patch[field];
  if (typeof value !== 'string') return;
  if (value.length > max || value.length < min) {
    out.push({ field, length: value.length, min, max });
  }
}

/**
 * Applies one chosen talk. Separate from the profile merge because a speaker
 * with seven talks on Sessionize is proposing exactly one of them here, and we
 * cannot guess which.
 */
export function applySessionizeSession(
  form: FormState,
  session: SessionizeSession,
  options: {
    /** The talk currently applied. Text this import wrote may be replaced silently. */
    replacing?: { title: string; abstract: string };
    /**
     * The speaker was shown what would be overwritten and agreed. Needed
     * because `replacing` does not survive a reload — a title an import wrote
     * yesterday is indistinguishable from one you typed, which made every pick
     * on a saved draft a no-op that reported success.
     */
    replaceExisting?: boolean;
  } = {},
): { patch: Partial<FormState>; filled: string[]; skipped: string[]; overLimit: OverLimit[] } {
  const { replacing, replaceExisting } = options;
  const patch: Partial<FormState> = {};
  const filled: string[] = [];
  const skipped: string[] = [];
  const overLimit: OverLimit[] = [];

  const claimable = (field: 'title' | 'abstract') => {
    const current = form[field].trim();
    if (!current) return true;
    if (replaceExisting) return true;
    return replacing !== undefined && current === replacing[field].trim();
  };

  if (session.title) {
    if (claimable('title')) {
      patch.title = session.title;
      filled.push('title');
    } else skipped.push('title');
  }

  if (session.abstract) {
    if (claimable('abstract')) {
      patch.abstract = session.abstract;
      filled.push('abstract');
    } else skipped.push('abstract');
  }

  checkLimits(patch, 'title', 1, LIMITS.title, overLimit);
  checkLimits(patch, 'abstract', LIMITS.abstractMin, LIMITS.abstractMax, overLimit);

  return { patch, filled, skipped, overLimit };
}

/**
 * Merges a profile into the form: blank fields only, and reports what it
 * touched. Someone who clicks Import out of curiosity half way through the form
 * must not lose what they wrote.
 *
 * Deliberately does *not* map `tagline` onto `jobTitle` — a tagline is a
 * headline ("Advocating for open source"), and filing that as a job title puts
 * it on the public programme.
 */
export function applySessionizeProfile(
  form: FormState,
  profile: SessionizeProfile,
): {
  patch: Partial<FormState>;
  filled: string[];
  skipped: string[];
  /** Filled, but outside the limits the schema enforces — needs a human edit. */
  overLimit: OverLimit[];
} {
  const patch: Partial<FormState> = {};
  const filled: string[] = [];
  const skipped: string[] = [];
  const overLimit: OverLimit[] = [];

  const fill = <K extends keyof FormState>(key: K, value: string | undefined, label: string) => {
    if (!value) return;
    if (String(form[key] ?? '').trim()) {
      skipped.push(label);
      return;
    }
    patch[key] = value as FormState[K];
    filled.push(label);
  };

  fill('name', profile.name, 'name');
  fill('bio', profile.bio, 'bio');
  fill('basedIn', profile.location, 'location');

  checkLimits(patch, 'bio', LIMITS.bioMin, LIMITS.bioMax, overLimit);

  // Socials merge rather than replace — the speaker may have added one by hand.
  const existing = new Set(form.socials.map((s) => s.handle.trim().toLowerCase()));
  const incoming = profile.links
    .filter((l) => !existing.has(l.url.trim().toLowerCase()))
    .slice(0, LIMITS.maxSocials - form.socials.length)
    .map((l) => ({ platform: l.platform, handle: l.url }));
  if (incoming.length > 0) {
    patch.socials = [...form.socials, ...incoming];
    filled.push(`${incoming.length} link${incoming.length === 1 ? '' : 's'}`);
  }

  if (profile.events.length > 0) {
    if (form.pastTalks.trim()) {
      skipped.push('past talks');
    } else {
      // Sessionize lists events, not talks or recordings, so say "spoke at".
      // Drop events until it fits — generated text, so trimming costs nothing.
      let events = profile.events.slice(0, 12);
      let text = `Spoke at: ${events.join(', ')}`;
      while (events.length > 1 && text.length > LIMITS.pastTalksMax) {
        events = events.slice(0, -1);
        text = `Spoke at: ${events.join(', ')}`;
      }
      if (text.length <= LIMITS.pastTalksMax) {
        patch.pastTalks = text;
        filled.push('past talks');
      }
    }
  }

  return { patch, filled, skipped, overLimit };
}

/** Rehydrates the form when an applicant returns to an existing draft. */
export function fromDocuments(
  proposal: Record<string, any> | undefined,
  speaker: Record<string, any> | undefined,
): FormState {
  const p = proposal ?? {};
  const s = speaker ?? {};
  return {
    ...emptyForm,
    title: p.title ?? '',
    abstract: p.abstract ?? '',
    pitch: p.pitch ?? '',
    category: p.category ?? '',
    format: p.format ?? '',
    level: p.level ?? '',
    deliveryLanguage: p.deliveryLanguage ?? '',
    languagePreference: p.languagePreference ?? '',
    name: s.name ?? '',
    bio: s.bio ?? '',
    company: s.company ?? '',
    jobTitle: s.jobTitle ?? '',
    basedIn: s.basedIn ?? '',
    socials: readSocials(s.socials),
    isGde: s.isGde ?? false,
    pastTalks: s.pastTalks ?? '',
    email: s.email ?? '',
    sessionizeUrl: s.sessionizeUrl ?? '',
    acks: (p.acks ?? {}) as Record<string, boolean>,
    answers: (p.answers ?? {}) as Answers,
    attendanceStatus: p.attendance?.status ?? '',
    fundingSource: p.attendance?.fundingSource ?? '',
    decisionBy: p.attendance?.decisionBy ?? '',
    needsVisa: p.attendance?.needsVisa ?? false,
  };
}

/**
 * The shape `submissionSchema` validates. Empties become absent keys so the
 * browser checks exactly what the server will read back from Firestore, where a
 * cleared field does not exist at all.
 */
export function toSubmission(form: FormState): SubmissionInput {
  const { proposalDoc, speakerDoc } = toDocuments(form);
  const p = mapEmpty(proposalDoc, undefined);
  const s = mapEmpty(speakerDoc, undefined);

  return {
    proposal: {
      title: p.title ?? '',
      abstract: p.abstract ?? '',
      pitch: p.pitch,
      category: p.category ?? '',
      format: p.format ?? '',
      level: p.level ?? '',
      deliveryLanguage: p.deliveryLanguage ?? '',
      languagePreference: p.languagePreference,
    },
    speaker: {
      name: s.name ?? '',
      bio: s.bio ?? '',
      company: s.company,
      jobTitle: s.jobTitle,
      basedIn: s.basedIn ?? '',
      socials: s.socials ?? [],
      isGde: s.isGde ?? false,
      pastTalks: s.pastTalks,
      email: s.email ?? '',
      sessionizeUrl: s.sessionizeUrl,
    },
    acks: (p.acks ?? {}) as SubmissionInput['acks'],
    attendance: (p.attendance ?? {}) as SubmissionInput['attendance'],
  };
}
