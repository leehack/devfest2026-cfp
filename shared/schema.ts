/**
 * One schema, run in the browser for inline errors and again in
 * `submitProposal`. The server pass is the one that counts — a hand-rolled POST
 * skips the form entirely.
 */

import { z } from 'zod';
import { ATTENDANCE_STATUSES, LIMITS, SOCIAL_PLATFORMS } from './enums';
import { parseSessionizeUrl } from './sessionize';
import type { FieldOption } from './confirmForm';
import { DEFAULT_SUBMISSION_FORM, type SubmissionForm } from './submissionForm';

const trimmed = (max: number) => z.string().trim().max(max);

export const socialSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  handle: trimmed(LIMITS.handleMax).min(1),
});

export const speakerSchema = z.object({
  name: trimmed(LIMITS.nameMax).min(1),
  // Required, with a floor: it feeds promotion as well as review, and a speaker
  // with no usable bio cannot be announced.
  bio: trimmed(LIMITS.bioMax).min(LIMITS.bioMin),
  // Not required: independents and between-jobs applicants exist (§3).
  company: trimmed(LIMITS.companyMax).optional(),
  jobTitle: trimmed(LIMITS.jobTitleMax).optional(),
  basedIn: trimmed(LIMITS.basedInMax).min(1),
  socials: z.array(socialSchema).max(LIMITS.maxSocials).default([]),
  isGde: z.boolean(),
  pastTalks: trimmed(LIMITS.pastTalksMax).optional(),
  email: z.string().trim().email(),
  /**
   * Where the import reads from, kept on the profile so it is asked for once.
   *
   * Validated by the same parser the import uses, so a link this accepts is a
   * link that will actually fetch — storing one that cannot is storing a button
   * that does nothing.
   */
  sessionizeUrl: trimmed(LIMITS.handleMax)
    .optional()
    .refine((value) => !value || parseSessionizeUrl(value) !== null, {
      params: { key: 'sessionizeUrl' },
      message: 'not a Sessionize profile link',
    }),
});

export const attendanceSchema = z
  .object({
    status: z.enum(ATTENDANCE_STATUSES),
    fundingSource: trimmed(LIMITS.fundingSourceMax).optional(),
    decisionBy: z.string().optional(),
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
    // A custom issue rather than `.regex()`, so it carries a key the i18n layer
    // can translate like every other message.
    if (val.decisionBy && !/^\d{4}-\d{2}-\d{2}$/.test(val.decisionBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisionBy'],
        params: { key: 'dateFormat' },
        message: 'Use the date picker.',
      });
    }
  });

/**
 * One of the four choice fields, checked against whatever this call offers.
 *
 * `z.enum` would need the values at module load, and they now arrive from
 * Firestore — so this is a string with the membership test written out. The
 * issue carries the same `key` shape as every other rule, so the message is
 * translated rather than zod's English reaching an applicant.
 */
const oneOf = (options: FieldOption[], key: string) =>
  z.string().superRefine((value, ctx) => {
    if (!options.some((option) => option.value === value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { key },
        message: `not one of the options this call offers`,
      });
    }
  });

/**
 * The talk, as this call defines it.
 *
 * A factory rather than a constant because the four dropdowns are per-CFP now
 * (`shared/submissionForm.ts`). `submitProposal` builds one from the stored
 * config; the browser builds one from its own copy for inline errors. As
 * everywhere else here, the server's pass is the one that counts.
 */
export function proposalCoreSchema(form: SubmissionForm = DEFAULT_SUBMISSION_FORM) {
  return z
    .object({
      title: trimmed(LIMITS.title).min(1),
      // Published verbatim in the public programme, hence the floor as well as the cap.
      abstract: trimmed(LIMITS.abstractMax).min(LIMITS.abstractMin),
      // Optional, committee-only. Without it, borderline proposals are hard to judge.
      pitch: trimmed(LIMITS.pitchMax).optional(),
      category: oneOf(form.category, 'notAnOption'),
      format: oneOf(form.format, 'notAnOption'),
      level: oneOf(form.level, 'notAnOption'),
      deliveryLanguage: oneOf(form.deliveryLanguage, 'notAnOption'),
      languagePreference: trimmed(LIMITS.languagePreferenceMax).optional(),
    })
    .superRefine((val, ctx) => {
      // §4: the preference line only exists for `either`. Rejecting it elsewhere
      // keeps stray values out of the scheduling dashboard. `either` is a fixed
      // value for exactly this reason — see `shared/submissionForm.ts`.
      if (val.deliveryLanguage !== 'either' && val.languagePreference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['languagePreference'],
          params: { key: 'languagePreferenceNotApplicable' },
          message: 'Language preference only applies when you can present in either language.',
        });
      }
    });
}

/**
 * The acknowledgements, which are also per-CFP now.
 *
 * Every one of them must be `true`: they are consents, and an unticked consent
 * is a no rather than a blank. A call that asks none of them validates an empty
 * object, which is the correct answer to "no consents required".
 */
export function acksSchemaFor(form: SubmissionForm = DEFAULT_SUBMISSION_FORM) {
  return z.object(
    Object.fromEntries(form.acks.map((ack) => [ack.key, z.literal(true)])) as Record<
      string,
      z.ZodLiteral<true>
    >,
  );
}

/** The full payload the submission form sends to `submitProposal`. */
export function submissionSchema(form: SubmissionForm = DEFAULT_SUBMISSION_FORM) {
  return z.object({
    proposal: proposalCoreSchema(form),
    speaker: speakerSchema,
    acks: acksSchemaFor(form),
    attendance: attendanceSchema,
  });
}

export interface SubmissionInput {
  proposal: {
    title: string;
    abstract: string;
    pitch?: string;
    category: string;
    format: string;
    level: string;
    deliveryLanguage: string;
    languagePreference?: string;
  };
  speaker: z.input<typeof speakerSchema>;
  acks: Record<string, boolean>;
  attendance: z.input<typeof attendanceSchema>;
}
