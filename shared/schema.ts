/**
 * One validation schema, used in two places:
 *   - the browser, for inline form errors
 *   - submitProposal (Cloud Function), which revalidates on the server
 *
 * The client copy is a convenience. The server copy is the one that counts:
 * a hand-rolled POST can skip the form entirely.
 */

import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  CATEGORIES,
  DELIVERY_LANGUAGES,
  FORMATS,
  LEVELS,
  LIMITS,
  SOCIAL_PLATFORMS,
} from './enums';

const trimmed = (max: number) => z.string().trim().max(max);

export const socialSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  handle: trimmed(LIMITS.handleMax).min(1),
});

export const speakerSchema = z.object({
  name: trimmed(LIMITS.nameMax).min(1),
  // One bio, required. It feeds promotion as well as review, so a speaker with
  // no bio cannot be announced — hence mandatory rather than optional, and
  // hence a floor long enough to be usable in a programme entry.
  bio: trimmed(LIMITS.bioMax).min(LIMITS.bioMin),
  // Not required: independents and between-jobs applicants exist (§3).
  company: trimmed(LIMITS.companyMax).optional(),
  jobTitle: trimmed(LIMITS.jobTitleMax).optional(),
  basedIn: trimmed(LIMITS.basedInMax).min(1),
  socials: z.array(socialSchema).max(LIMITS.maxSocials).default([]),
  isGde: z.boolean(),
  pastTalks: trimmed(LIMITS.pastTalksMax).optional(),
  email: z.string().trim().email(),
});

/** All three are required — they are acknowledgements, not preferences (§3). */
export const acksSchema = z.object({
  noTravelSupport: z.literal(true),
  coc: z.literal(true),
  recording: z.literal(true),
});

export const attendanceSchema = z
  .object({
    status: z.enum(ATTENDANCE_STATUSES),
    fundingSource: trimmed(LIMITS.fundingSourceMax).optional(),
    decisionBy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
      .optional(),
    needsVisa: z.boolean(),
  })
  .superRefine((val, ctx) => {
    // §5: requiring something concrete in writing is itself the filter —
    // vaguely optimistic applicants drift down to `pending` on their own.
    const needsFunding = val.status === 'secured' || val.status === 'pending';
    if (needsFunding && !val.fundingSource?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fundingSource'],
        params: { key: 'fundingSourceRequired' },
        message: 'Tell us where the funding is coming from.',
      });
    }
    if (!needsFunding && val.fundingSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fundingSource'],
        params: { key: 'fundingSourceNotApplicable' },
        message: 'Funding source does not apply to local speakers.',
      });
    }
    if (val.status === 'pending' && !val.decisionBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisionBy'],
        params: { key: 'decisionByRequired' },
        message: 'When do you expect to know?',
      });
    }
    if (val.status !== 'pending' && val.decisionBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisionBy'],
        params: { key: 'decisionByNotApplicable' },
        message: 'Decision date only applies when funding is pending.',
      });
    }
  });

export const proposalCoreSchema = z
  .object({
    title: trimmed(LIMITS.title).min(1),
    // Published verbatim in the public programme, hence the floor as well as the cap.
    abstract: trimmed(LIMITS.abstractMax).min(LIMITS.abstractMin),
    // Optional, committee-only. Without it, borderline proposals are hard to judge.
    pitch: trimmed(LIMITS.pitchMax).optional(),
    category: z.enum(CATEGORIES),
    format: z.enum(FORMATS),
    level: z.enum(LEVELS),
    deliveryLanguage: z.enum(DELIVERY_LANGUAGES),
    languagePreference: trimmed(LIMITS.languagePreferenceMax).optional(),
  })
  .superRefine((val, ctx) => {
    // §4: the preference line only exists for `either`. Rejecting it elsewhere
    // keeps stray values out of the scheduling dashboard.
    if (val.deliveryLanguage !== 'either' && val.languagePreference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['languagePreference'],
        params: { key: 'languagePreferenceNotApplicable' },
        message: 'Language preference only applies when you can present in either language.',
      });
    }
  });

/** The full payload the submission form sends to `submitProposal`. */
export const submissionSchema = z.object({
  proposal: proposalCoreSchema,
  speaker: speakerSchema,
  acks: acksSchema,
  attendance: attendanceSchema,
});

export type SubmissionInput = z.input<typeof submissionSchema>;
export type SubmissionOutput = z.output<typeof submissionSchema>;

/**
 * Drafts are saved continuously and must tolerate half-filled forms, so every
 * field is optional here. The strict schema above runs at submit time only.
 */
export const draftSchema = submissionSchema.deepPartial();
export type DraftInput = z.input<typeof draftSchema>;
