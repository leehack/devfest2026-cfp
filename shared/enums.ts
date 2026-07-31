/**
 * Enumerations from the CFP spec (§3 form design, §4 language, §5 attendance, §6 data model).
 *
 * Values are stored codes, never display text — display text lives in the i18n
 * dictionaries so a label can be reworded without migrating Firestore.
 */

export const CATEGORIES = [
  'app_dev',
  'ai_ml',
  'cloud',
  'web',
  'ui_ux',
  'soft_skills_career',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const FORMATS = ['session_40', 'lightning_15', 'workshop_90'] as const;
export type Format = (typeof FORMATS)[number];

export const LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;

/**
 * How the session is delivered. One field — slide language was dropped from the
 * model entirely (decision of 2026-07-26, amending §4).
 *
 *   en | fr      delivered in that language
 *   either       speaker is comfortable in both; organisers assign one. A
 *                scheduling asset — these fill gaps when a track is thin, so
 *                the count is surfaced on the selection dashboard (§4).
 *   bilingual    speaker alternates between languages during the talk.
 *
 * `bilingual` is §4's case 4, which the spec originally argued against and
 * structured the form to prevent. Added by explicit decision. The consequence
 * §4 predicted still stands and is now a programme problem rather than a form
 * problem: an attendee comfortable in only one language loses part of the
 * session, so these must be labelled as such on the public schedule.
 */
export const DELIVERY_LANGUAGES = ['en', 'fr', 'either', 'bilingual'] as const;
export type DeliveryLanguage = (typeof DELIVERY_LANGUAGES)[number];

/**
 * What a session resolves to once scheduled. `either` proposals get one of
 * these assigned, because §4 requires the public programme to show a settled
 * language — "flexible" on a schedule means nobody can plan their day.
 */
export const RESOLVED_LANGUAGES = ['en', 'fr'] as const;
export type ResolvedLanguage = (typeof RESOLVED_LANGUAGES)[number];

/** §5 — the funding path is forced into the open rather than asked as "can you attend?". */
export const ATTENDANCE_STATUSES = ['local', 'secured', 'pending'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** §6 — full proposal lifecycle. Only `draft` is ever client-written (see firestore.rules). */
export const PROPOSAL_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'accepted',
  'confirmed',
  'declined',
  'waitlisted',
  'rejected',
  'withdrawn',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * Groupings of the lifecycle, in one place because they were drifting apart
 * across the form, the callables and the admin screen.
 *
 * `firestore.rules` necessarily restates them — the rules language cannot
 * import. Any change here has to be mirrored there, and `tests/rules.test.ts`
 * is what catches it if it is not.
 */
export const STATUS_SETS = {
  /** In front of the committee, or past it. Counts against the per-speaker cap. */
  live: ['submitted', 'under_review', 'accepted', 'confirmed', 'waitlisted'],
  /** Being judged or already judged: content frozen, travel answers still open. */
  underConsideration: ['under_review', 'accepted', 'confirmed', 'waitlisted'],
  /**
   * Outcomes an admin may set. Excludes the applicant's own draft/submit/withdraw.
   * `confirmed` and `declined` are the speaker's answer, but an organiser needs
   * to be able to record one that arrived by email instead of through the link.
   */
  decidable: ['under_review', 'accepted', 'confirmed', 'declined', 'waitlisted', 'rejected'],
  /** Settled either way — the rest is what the committee still owes an answer on. */
  decided: ['accepted', 'confirmed', 'declined', 'waitlisted', 'rejected'],
  /** A submitted talk may be taken back. An unsubmitted draft is deleted instead. */
  withdrawable: ['submitted', 'under_review', 'accepted', 'confirmed', 'waitlisted'],
  /** The speaker's own answer to an acceptance, and the only statuses they set. */
  speakerResponse: ['confirmed', 'declined'],
} as const satisfies Record<string, readonly ProposalStatus[]>;

export const inStatusSet = (set: keyof typeof STATUS_SETS, status: string): boolean =>
  (STATUS_SETS[set] as readonly string[]).includes(status);

/** §7 — 1 Pass · 2 Maybe · 3 Yes · 4 Strong yes. */
export const SCORES = [1, 2, 3, 4] as const;
export type Score = (typeof SCORES)[number];

/** Free-form, but a known list keeps the common ones tidy on the review card. */
export const SOCIAL_PLATFORMS = [
  'bluesky',
  'linkedin',
  'github',
  'mastodon',
  'x',
  'website',
  'other',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Field limits from §3. Referenced by both the zod schema and the form's character counters. */
export const LIMITS = {
  title: 100,
  abstractMin: 200,
  abstractMax: 1200,
  pitchMax: 2000,
  bioMin: 50,
  bioMax: 800,
  nameMax: 120,
  companyMax: 120,
  jobTitleMax: 120,
  basedInMax: 120,
  fundingSourceMax: 300,
  languagePreferenceMax: 300,
  pastTalksMax: 1000,
  handleMax: 200,
  maxSocials: 6,
  reviewCommentMax: 2000,
  messageSubjectMax: 200,
  messageBodyMax: 4000,
  /**
   * Submitted talks per speaker. Drafts above this are harmless — reviewers
   * never see them — so the cap is enforced in `submitProposal`, which is the
   * only place that can count them reliably.
   */
  maxTalksPerSpeaker: 3,
} as const;
