/**
 * Firestore document shapes — §6 of the spec.
 *
 * Fields marked "post-acceptance" are never written by the submission form (§3):
 * we do not hold headshots, shirt sizes or dietary needs for the ~70% of
 * applicants who will be rejected.
 */

import type {
  AttendanceStatus,
  DeliveryLanguage,
  ProposalStatus,
  ResolvedLanguage,
  Score,
  SocialPlatform,
} from './enums';
import type { Answers, HeadshotUploads } from './confirmForm';
import type { CfpProfile, CfpRole, GrantableRole, Visibility } from './cfp';

export interface Social {
  platform: SocialPlatform;
  handle: string;
}

export interface Speaker {
  name: string;
  /**
   * Single bio, required. Used for promotion as well as review, which is why it
   * is mandatory rather than optional — a speaker with no bio cannot be
   * announced. Written in whichever language the speaker prefers; there is no
   * longer a separate English and French bio.
   */
  bio: string;
  company?: string;
  jobTitle?: string;
  basedIn: string;
  socials: Social[];
  isGde: boolean;
  pastTalks?: string;
  email: string;
  /** Their Sessionize profile, so the import can be offered without asking again. */
  sessionizeUrl?: string;

  // Post-acceptance only — absent at submission time.
  photoUrl?: string;
  tshirtSize?: string;
  dietaryNeeds?: string;

  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * `cfps/{cfpId}` — one call for proposals, and the tenant everything else
 * hangs under. The document id is the slug; see `shared/cfp.ts`.
 */
export interface Cfp extends CfpProfile {
  name: string;
  /** Denormalised from `members`, so "the CFPs I own" is one query. */
  ownerUids: string[];
  /** `private` means unlisted, not secret — anyone with the link can read it. */
  visibility: Visibility;
  /**
   * Read-only from here on, and off the public listing.
   *
   * A boolean the rules read, and a timestamp beside it for display. Testing
   * whether the timestamp is absent does not work inside a `list` rule — with
   * `keys().hasAny`, with `in` and with `get(k, null)` alike it answers true for
   * every document — so the flag is always present and always written with it.
   */
  archived: boolean;
  archivedAt?: unknown;

  // The submission window, which used to be a singleton `config/cfp`.
  opensAt: unknown;
  closesAt: unknown;
  paused: boolean;
  reviewsVisible: boolean;

  /** Opaque id of the stable public programme version, absent until published. */
  publishedScheduleId?: string;
  publishedScheduleAt?: unknown;
  /** Opaque id of the latest role-filtered working programme, absent until shared. */
  sharedScheduleId?: string;
  sharedScheduleAt?: unknown;

  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * `cfps/{cfpId}/members/{uid}` — who may do what, within one CFP.
 *
 * `cfpId` and `uid` are denormalised onto the document so that "every CFP I am
 * on" is a single collection-group query. Written only by the role callables.
 */
export interface CfpMember {
  cfpId: string;
  uid: string;
  role: CfpRole;
  /** Copied from the auth token at claim time, for display on the admin page. */
  email: string;
  name?: string;
  createdAt: unknown;
  /** uid of the member whose grant this claimed. */
  grantedBy: string;
}

/**
 * The speaker as the committee read them, frozen onto the proposal at
 * submission.
 *
 * Two problems, one answer. A profile belongs to the account rather than to any
 * one talk, so a bio edited in 2028 would otherwise rewrite what the 2026
 * committee actually judged. And `speakers/{uid}` is global while a role is per
 * CFP — without this, letting reviewers read profiles would hand every
 * committee on the platform the whole speaker directory.
 */
export interface SpeakerSnapshot {
  uid: string;
  name: string;
  bio: string;
  company?: string;
  jobTitle?: string;
  basedIn: string;
  socials: Social[];
  isGde: boolean;
  pastTalks?: string;
  sessionizeUrl?: string;
}

/**
 * The consents this call asked for, keyed by the `acks` keys in its
 * `config/submissionForm`. Every one of them is `true` — the schema will not
 * accept a submission otherwise — but the keys belong to the call, not to us.
 */
export type Acks = Record<string, boolean>;

export interface Attendance {
  status: AttendanceStatus;
  /** Present when status is `secured` or `pending`. */
  fundingSource?: string;
  /** ISO yyyy-mm-dd. Present when status is `pending`. */
  decisionBy?: string;
  needsVisa: boolean;
}

export interface ProposalAggregate {
  avgScore: number;
  normalizedScore: number;
  reviewCount: number;
  stdDev: number;
}

export interface Proposal {
  /**
   * Denormalised from the path. Redundant for reading — the document already
   * lives under its CFP — but `collectionGroup` queries cannot be filtered by
   * ancestor, and the aggregate recompute is one.
   */
  cfpId: string;

  /** Array, so co-presenters are supported without reshaping the document. */
  speakerIds: string[];

  /**
   * The account that owns talk content and lifecycle actions. Older proposals
   * infer this from `speakerIds[0]` until a callable first touches the roster.
   */
  primarySpeakerId?: string;

  /** Former participants remain conflicted from reviewing this proposal. */
  formerSpeakerIds?: string[];

  /** Frozen audit copy for people removed after the committee saw the roster. */
  formerSpeakerSnapshot?: SpeakerSnapshot[];

  /**
   * The speakers as the committee reads them, frozen at submission. Parallel to
   * `speakerIds`. Absent until submission; draft access stays within the active
   * speaker roster.
   */
  speakerSnapshot?: SpeakerSnapshot[];

  title: string;
  abstract: string;
  /** Committee-only. Never rendered in the public programme. */
  pitch?: string;

  /**
   * Codes from this call's `config/submissionForm`, not a fixed set. They are
   * validated against that document on submit and rendered through it, so a
   * call that never heard of `ai_ml` cannot store it and one that renamed the
   * label still reads back correctly.
   */
  category: string;
  format: string;
  level: string;

  /**
   * The one taxonomy whose *values* stay ours: `either` and `bilingual` mean
   * something to the scheduling code. A call chooses which of them to offer and
   * what to call them, not what they are.
   */
  deliveryLanguage: DeliveryLanguage;
  /** Only meaningful when deliveryLanguage is `either`. */
  languagePreference?: string;

  /** Legacy single-speaker storage; roster proposals keep this per participant. */
  acks?: Acks;
  /** Answers to this call's own questions, if it asks any. */
  answers?: Answers;
  /** Legacy single-speaker storage; roster proposals keep this per participant. */
  attendance?: Attendance;

  /** Function-writable only — see firestore.rules. */
  status: ProposalStatus;
  confirmDeadline?: unknown;
  confirmedAt?: unknown;
  /** The organiser's own questions, answered on confirmation. */
  confirmAnswers?: Answers;
  /** Function-written pointers to replaceable post-acceptance image uploads. */
  headshotUploads?: HeadshotUploads;
  /** Set at scheduling when deliveryLanguage is `either`. */
  assignedLanguage?: ResolvedLanguage;

  submittedAt?: unknown;
  updatedAt: unknown;

  /** Written by the aggregation Cloud Function only. */
  aggregate?: ProposalAggregate;
}

/**
 * `cfps/{cfpId}/roleGrants/{email}` — an invitation, keyed by lowercased email.
 *
 * Roles are granted before the person has ever signed in, so there is no uid to
 * key on yet. `claimRole` turns the grant into a `members/{uid}` document on
 * their first visit and records who took it.
 */
export interface RoleGrant {
  email: string;
  /** Never `owner`: `normalizeRole` refuses it, so it is written once and only
      by `createCfp`, straight to `members`. */
  role: GrantableRole;
  createdAt: unknown;
  createdBy: string;
  claimedBy?: string;
  claimedAt?: unknown;
}

/**
 * `cfps/{cfpId}/proposals/{id}/reviews/{reviewerUid}` — one per reviewer per
 * proposal.
 *
 * Keyed by reviewer so nobody can overwrite a colleague's score, and so a
 * reviewer's own document is addressable without a query.
 */
export interface Review {
  /**
   * Denormalised from the path, and pinned to it by the rules. The aggregate
   * recompute is a `collectionGroup` query, which cannot be filtered by
   * ancestor — without this it would sweep every CFP's scores into one round.
   */
  cfpId: string;
  score: Score;
  /** Excluded from every calculation, including the reviewer's own calibration. */
  conflictOfInterest: boolean;
  comment?: string;
  updatedAt: unknown;
}
