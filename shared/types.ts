/**
 * Firestore document shapes — §6 of the spec.
 *
 * Fields marked "post-acceptance" are never written by the submission form (§3):
 * we do not hold headshots, shirt sizes or dietary needs for the ~70% of
 * applicants who will be rejected.
 */

import type {
  AttendanceStatus,
  Category,
  DeliveryLanguage,
  Format,
  Level,
  ProposalStatus,
  ResolvedLanguage,
  SocialPlatform,
} from './enums';

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

  // Post-acceptance only — absent at submission time.
  photoUrl?: string;
  tshirtSize?: string;
  dietaryNeeds?: string;

  createdAt: unknown;
  updatedAt: unknown;
}

export interface Acks {
  noTravelSupport: boolean;
  coc: boolean;
  recording: boolean;
}

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
  /** Array, so co-presenters are supported without reshaping the document. */
  speakerIds: string[];

  title: string;
  abstract: string;
  /** Committee-only. Never rendered in the public programme. */
  pitch?: string;

  category: Category;
  format: Format;
  level: Level;

  deliveryLanguage: DeliveryLanguage;
  /** Only meaningful when deliveryLanguage is `either`. */
  languagePreference?: string;

  acks: Acks;
  attendance: Attendance;

  /** Function-writable only — see firestore.rules. */
  status: ProposalStatus;
  confirmDeadline?: unknown;
  confirmedAt?: unknown;
  /** Set at scheduling when deliveryLanguage is `either`. */
  assignedLanguage?: ResolvedLanguage;

  submittedAt?: unknown;
  updatedAt: unknown;

  /** Written by the aggregation Cloud Function only. */
  aggregate?: ProposalAggregate;
}

/**
 * The single config document that drives server-side deadline enforcement.
 * Read by firestore.rules and by submitProposal; never client-writable.
 */
export interface CfpConfig {
  opensAt: unknown;
  closesAt: unknown;
  /** Flips the form into read-only mode ahead of the deadline if needed. */
  paused: boolean;
  /**
   * Gates cross-reviewer visibility of scores (§7 — reviewers must not see each
   * other's scores until the round closes, to avoid anchoring). Enforced in
   * firestore.rules, not just in the review UI.
   */
  reviewsVisible: boolean;
}
