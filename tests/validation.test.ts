/**
 * Guards one property: every message an applicant can see comes from a
 * dictionary, in their language. zod's own strings are English, so a code that
 * falls through the mapping means a French applicant reading English.
 */

import { describe, expect, it } from 'vitest';
import { submissionSchema } from '@shared/schema';
import { LIMITS } from '@shared/enums';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { validationMessage } from '../src/i18n/validation';

function issuesFrom(input: unknown) {
  const result = submissionSchema.safeParse(input);
  if (result.success) throw new Error('expected this input to fail validation');
  return result.error.issues;
}

const valid = {
  proposal: {
    title: 'A talk',
    abstract: 'a'.repeat(LIMITS.abstractMin),
    category: 'web',
    format: 'session_40',
    level: 'all',
    deliveryLanguage: 'en',
  },
  speaker: {
    name: 'Someone',
    bio: 'b'.repeat(LIMITS.bioMin),
    basedIn: 'Montréal, QC',
    socials: [],
    isGde: false,
    email: 'someone@example.test',
  },
  acks: { noTravelSupport: true, coc: true, recording: true },
  attendance: { status: 'local', needsVisa: false },
};

/** Every kind of issue the form can produce, from deliberately bad input. */
const cases: Record<string, unknown> = {
  nothingFilledIn: { proposal: {}, speaker: {}, acks: {}, attendance: {} },
  blankStrings: {
    ...valid,
    proposal: { ...valid.proposal, title: '', abstract: '' },
    speaker: { ...valid.speaker, name: '', bio: '', email: 'not-an-email' },
  },
  tooLong: {
    ...valid,
    proposal: { ...valid.proposal, title: 'x'.repeat(LIMITS.title + 1) },
    speaker: { ...valid.speaker, bio: 'x'.repeat(LIMITS.bioMax + 1) },
  },
  badEnums: {
    ...valid,
    proposal: { ...valid.proposal, category: 'nope', format: 'nope', level: 'nope' },
  },
  refusedAcks: { ...valid, acks: { noTravelSupport: false, coc: false, recording: false } },
  strayConditionals: {
    ...valid,
    proposal: { ...valid.proposal, deliveryLanguage: 'en', languagePreference: 'French please' },
    attendance: { status: 'pending', needsVisa: false, decisionBy: '15 September' },
  },
  fundingOnLocal: {
    ...valid,
    attendance: { status: 'local', needsVisa: false, fundingSource: 'employer' },
  },
};

describe.each(Object.entries(cases))('%s', (_label, input) => {
  const issues = issuesFrom(input);

  it('produces issues at all', () => {
    expect(issues.length).toBeGreaterThan(0);
  });

  it('maps every issue to a specific message', () => {
    for (const issue of issues) {
      const where = `${issue.code} at ${issue.path.join('.')}`;
      // `invalid` is the last-resort fallback. Reaching it means this code is
      // not handled, and the applicant is told only "please check this".
      expect(validationMessage(issue, en), where).not.toBe(en.errors.invalid);
    }
  });

  it('says something different in French', () => {
    for (const issue of issues) {
      const where = `${issue.code} at ${issue.path.join('.')}`;
      expect(validationMessage(issue, fr), where).not.toBe(validationMessage(issue, en));
    }
  });
});

describe('mapping choices', () => {
  const messageFor = (input: unknown, path: string) => {
    const issue = issuesFrom(input).find((i) => i.path.join('.') === path);
    if (!issue) throw new Error(`no issue at ${path}`);
    return validationMessage(issue, en);
  };

  it('reads a missing field as required, not as a length problem', () => {
    expect(messageFor({ proposal: {}, speaker: {}, acks: {}, attendance: {} }, 'proposal.title'))
      .toBe(en.errors.required);
  });

  it('reads an empty required string as required too', () => {
    // min(1) after trim is "you left this blank", not "at least 1 character".
    const input = { ...valid, proposal: { ...valid.proposal, title: '' } };
    expect(messageFor(input, 'proposal.title')).toBe(en.errors.required);
  });

  it('reports a real length floor as a length', () => {
    const input = { ...valid, speaker: { ...valid.speaker, bio: 'too short' } };
    expect(messageFor(input, 'speaker.bio')).toBe(en.errors.tooShort(LIMITS.bioMin));
  });

  it('names the acknowledgement rather than calling it invalid', () => {
    const input = { ...valid, acks: { ...valid.acks, coc: false } };
    expect(messageFor(input, 'acks.coc')).toBe(en.errors.mustAgree);
  });

  it('uses the keyed rule for a custom issue', () => {
    const input = {
      ...valid,
      attendance: { status: 'pending', needsVisa: false, fundingSource: 'employer' },
    };
    expect(messageFor(input, 'attendance.decisionBy')).toBe(en.errors.rules.decisionByRequired);
  });

  it('translates the date-format rule, which used to be a bare regex', () => {
    const input = {
      ...valid,
      attendance: {
        status: 'pending',
        needsVisa: false,
        fundingSource: 'employer',
        decisionBy: '15 September',
      },
    };
    expect(messageFor(input, 'attendance.decisionBy')).toBe(en.errors.rules.dateFormat);
  });
});
