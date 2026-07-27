import { LIMITS } from '@shared/enums';
import type {
  AttendanceStatus,
  Category,
  DeliveryLanguage,
  Format,
  Level,
} from '@shared/enums';
import type { Social } from '@shared/types';
import type { SubmissionInput } from '@shared/schema';
import type { SessionizeProfile, SessionizeSession } from '@shared/sessionize';

/**
 * The form keeps one flat object. Firestore keeps the talk and the person in
 * two documents (§6), and the validation schema wants a third shape — the
 * mapping between the three lives here rather than being scattered across
 * components.
 */
export interface FormState {
  // Proposal
  title: string;
  abstract: string;
  pitch: string;
  category: Category | '';
  format: Format | '';
  level: Level | '';
  deliveryLanguage: DeliveryLanguage | '';
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

  // Acknowledgements
  ackNoTravelSupport: boolean;
  ackCoc: boolean;
  ackRecording: boolean;

  // Attendance
  attendanceStatus: AttendanceStatus | '';
  fundingSource: string;
  decisionBy: string;
  needsVisa: boolean;
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
  ackNoTravelSupport: false,
  ackCoc: false,
  ackRecording: false,
  attendanceStatus: '',
  fundingSource: '',
  decisionBy: '',
  needsVisa: false,
};

/**
 * Splits the form into the two documents the data model defines.
 *
 * Empty optionals are emitted as `''` rather than dropped. Dropping them here
 * would make a cleared field invisible to a `{merge: true}` write, so deleting
 * your pitch would appear to work and then silently come back. The caller
 * decides what `''` means: omit it on create, `deleteField()` on update, or
 * `undefined` when validating.
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
    acks: {
      noTravelSupport: form.ackNoTravelSupport,
      coc: form.ackCoc,
      recording: form.ackRecording,
    },
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
    socials: form.socials.filter((s) => s.handle.trim() !== ''),
    isGde: form.isGde,
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
 * Records a filled value that the schema will reject.
 *
 * Imported text has no relation to our limits — Sessionize abstracts routinely
 * run past 1,200 characters and bios past 800. Fill it anyway, because trimming
 * prose is far easier than retyping it, but say so. Otherwise the first the
 * speaker hears of it is a validation error at submit time, on text they never
 * wrote and cannot see the rule for.
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
 * Applies one chosen Sessionize talk to the form.
 *
 * Split from the profile merge because picking a talk is a separate, explicit
 * act: a speaker with seven talks on Sessionize is submitting exactly one of
 * them here, and we cannot guess which.
 */
export function applySessionizeSession(
  form: FormState,
  session: SessionizeSession,
  options: {
    /**
     * The talk currently applied, if any. A speaker who picks the wrong one
     * from a list of seven must be able to switch, so replacing text *this
     * import wrote* is allowed — but text they typed themselves is not touched
     * unless they say so.
     */
    replacing?: { title: string; abstract: string };
    /**
     * The speaker was shown what would be overwritten and agreed.
     *
     * Needed because provenance does not survive a reload: come back to a draft
     * tomorrow and the title an import wrote yesterday is indistinguishable
     * from one you typed. Without this, picking a talk on a filled-in draft is
     * a dead end — the click reports success and changes nothing.
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
 * Merges an imported Sessionize profile into the form.
 *
 * Fills only blank fields and reports exactly what it touched. Overwriting
 * something the speaker already typed — because they clicked Import out of
 * curiosity after filling half the form — would be a far worse bug than not
 * importing at all.
 *
 * Deliberately does *not* map Sessionize's `tagline` onto `jobTitle`. A tagline
 * is a free-text headline ("Advocating for open source"), and quietly filing
 * that as a job title puts it on the public programme.
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
      // Sessionize lists events, not talk titles or recordings — so say
      // "spoke at" rather than dressing them up as something they are not.
      // Drop events until it fits: this string is generated, so trimming it
      // costs the speaker nothing, unlike trimming their own bio.
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
    socials: s.socials ?? [],
    isGde: s.isGde ?? false,
    pastTalks: s.pastTalks ?? '',
    email: s.email ?? '',
    ackNoTravelSupport: p.acks?.noTravelSupport ?? false,
    ackCoc: p.acks?.coc ?? false,
    ackRecording: p.acks?.recording ?? false,
    attendanceStatus: p.attendance?.status ?? '',
    fundingSource: p.attendance?.fundingSource ?? '',
    decisionBy: p.attendance?.decisionBy ?? '',
    needsVisa: p.attendance?.needsVisa ?? false,
  };
}

/**
 * The shape `submissionSchema` validates — used for inline errors before submit.
 *
 * Empties become absent keys so the browser validates exactly what the function
 * will see: the server reads these documents back from Firestore, where a
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
      category: p.category as Category,
      format: p.format as Format,
      level: p.level as Level,
      deliveryLanguage: p.deliveryLanguage as DeliveryLanguage,
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
    },
    acks: (p.acks ?? {}) as SubmissionInput['acks'],
    attendance: (p.attendance ?? {}) as SubmissionInput['attendance'],
  };
}
