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
export type Level = (typeof LEVELS)[number];

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
} as const;
