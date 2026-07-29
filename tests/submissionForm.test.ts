/**
 * The submission form as data.
 *
 * Two properties matter more than the rest. A call that has no stored config
 * must behave exactly as it did before there was one — every CFP created before
 * this feature is in that state, with live proposals under it. And a stored
 * taxonomy has to be the *only* thing the schema will accept, or configuring it
 * would be decoration.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBMISSION_FORM,
  labelOf,
  mergeSubmissionForm,
  normaliseSubmissionForm,
  optionValues,
  validateSubmissionForm,
  type SubmissionForm,
} from '@shared/submissionForm';
import { submissionSchema } from '@shared/schema';
import { LIMITS } from '@shared/enums';

const clone = (): SubmissionForm => JSON.parse(JSON.stringify(DEFAULT_SUBMISSION_FORM));

describe('mergeSubmissionForm', () => {
  it('reads an absent document as the defaults', () => {
    expect(mergeSubmissionForm(undefined)).toEqual(DEFAULT_SUBMISSION_FORM);
    expect(mergeSubmissionForm(null)).toEqual(DEFAULT_SUBMISSION_FORM);
    expect(mergeSubmissionForm({})).toEqual(DEFAULT_SUBMISSION_FORM);
  });

  it('merges key by key, so a partial config keeps the standard taxonomy', () => {
    const merged = mergeSubmissionForm({ category: [{ value: 'ops', label: { en: 'Ops' } }] });
    expect(optionValues(merged.category)).toEqual(['ops']);
    expect(merged.format).toEqual(DEFAULT_SUBMISSION_FORM.format);
    expect(merged.level).toEqual(DEFAULT_SUBMISSION_FORM.level);
  });

  it('treats an empty acks list as an answer, not as an absence', () => {
    // An organiser who deleted all three consents meant it. Falling back to the
    // defaults here would silently put them back on every submission.
    expect(mergeSubmissionForm({ acks: [] }).acks).toEqual([]);
    expect(mergeSubmissionForm({}).acks).toEqual(DEFAULT_SUBMISSION_FORM.acks);
  });

  it('defaults `fields` to empty rather than to anything', () => {
    expect(mergeSubmissionForm({}).fields).toEqual([]);
  });
});

describe('labels', () => {
  it('renders in the reader’s language', () => {
    expect(labelOf(DEFAULT_SUBMISSION_FORM.level, 'all', 'en')).toBe('All levels');
    expect(labelOf(DEFAULT_SUBMISSION_FORM.level, 'all', 'fr')).toBe('Tous les niveaux');
  });

  it('falls back to the stored code, so a retired choice still renders', () => {
    // Removing an option is how a choice is retired, and the talks filed under
    // it are still in front of the committee.
    expect(labelOf(DEFAULT_SUBMISSION_FORM.category, 'gone', 'en')).toBe('gone');
  });

  it('falls back to English when a French label was never written', () => {
    const options = [{ value: 'ops', label: { en: 'Ops' } }];
    expect(labelOf(options, 'ops', 'fr')).toBe('Ops');
  });
});

describe('normaliseSubmissionForm', () => {
  it('drops anything the shape does not define', () => {
    const form = clone() as SubmissionForm & { sneaky?: string };
    form.sneaky = 'rides along into every applicant’s browser';
    (form.category[0] as unknown as Record<string, unknown>).extra = true;

    const clean = normaliseSubmissionForm(form) as SubmissionForm & { sneaky?: string };
    expect(clean.sneaky).toBeUndefined();
    expect(Object.keys(clean.category[0])).toEqual(['value', 'label']);
  });

  it('trims, and drops a French label that is only whitespace', () => {
    const form = clone();
    form.category = [{ value: ' web ', label: { en: ' Web ', fr: '   ' } }];
    const [option] = normaliseSubmissionForm(form).category;
    expect(option).toEqual({ value: 'web', label: { en: 'Web' } });
  });
});

describe('validateSubmissionForm', () => {
  it('accepts what DevFest already asked', () => {
    expect(validateSubmissionForm(DEFAULT_SUBMISSION_FORM)).toBeNull();
  });

  it('refuses an empty list — nobody could submit', () => {
    const form = clone();
    form.format = [];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'noOptions', key: 'format' });
  });

  it('refuses two choices that would be stored the same way', () => {
    const form = clone();
    form.level = [
      { value: 'all', label: { en: 'All' } },
      { value: 'all', label: { en: 'Everyone' } },
    ];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'duplicateValue', key: 'level' });
  });

  it('refuses a value Firestore or a URL would have to escape', () => {
    const form = clone();
    form.category = [{ value: 'Web Dev!', label: { en: 'Web' } }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'badValue', key: 'category' });
  });

  it('refuses a choice with no English label', () => {
    const form = clone();
    form.category = [{ value: 'web', label: { en: '', fr: 'Web' } }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'emptyLabel', key: 'category' });
  });

  it('refuses a delivery language the scheduling code has never heard of', () => {
    // The one list whose values are ours: `either` is what the dashboard counts
    // and what `languagePreference` exists for.
    const form = clone();
    form.deliveryLanguage = [{ value: 'klingon', label: { en: 'Klingon' } }];
    expect(validateSubmissionForm(form)).toEqual({
      problem: 'unknownLanguage',
      key: 'deliveryLanguage',
    });
  });

  it('lets a call offer only some of the four languages', () => {
    const form = clone();
    form.deliveryLanguage = [{ value: 'en', label: { en: 'English' } }];
    expect(validateSubmissionForm(form)).toBeNull();
  });

  it('refuses an optional consent — that is a question, not an agreement', () => {
    const form = clone();
    form.acks = [{ key: 'coc', type: 'checkbox', label: { en: 'Agree?' }, required: false }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'ackNotRequired', key: 'coc' });
  });

  it('refuses a photo on the submission form', () => {
    // §3: ~70% of these people will be turned down and we should not be holding
    // their picture. The confirmation form is where that question belongs.
    const form = clone();
    form.fields = [{ key: 'headshot', type: 'image', label: { en: 'Photo' }, required: false }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'noImages', key: 'headshot' });
  });
});

describe('submissionSchema against a configured form', () => {
  const proposal = {
    title: 'A talk',
    abstract: 'a'.repeat(LIMITS.abstractMin),
    category: 'web',
    format: 'session_40',
    level: 'all',
    deliveryLanguage: 'en',
  };
  const speaker = {
    name: 'Someone',
    bio: 'b'.repeat(LIMITS.bioMin),
    basedIn: 'Montréal, QC',
    socials: [],
    isGde: false,
    email: 'someone@example.test',
  };
  const attendance = { status: 'local', needsVisa: false };
  const acks = { noTravelSupport: true, coc: true, recording: true };

  it('accepts the default taxonomy', () => {
    expect(submissionSchema().safeParse({ proposal, speaker, acks, attendance }).success).toBe(true);
  });

  it('rejects a value from another call’s list', () => {
    const form = clone();
    form.category = [{ value: 'ops', label: { en: 'Ops' } }];
    const result = submissionSchema(form).safeParse({ proposal, speaker, acks, attendance });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'proposal.category');
    expect((issue as { params?: { key?: string } } | undefined)?.params?.key).toBe('notAnOption');
  });

  it('requires exactly the consents this call asks for', () => {
    const form = clone();
    form.acks = [
      { key: 'coc', type: 'checkbox', label: { en: 'Code of conduct' }, required: true },
    ];
    const schema = submissionSchema(form);
    expect(schema.safeParse({ proposal, speaker, acks: { coc: true }, attendance }).success).toBe(
      true,
    );
    // The three DevFest ones are not this call's, so their absence is fine and
    // `coc` alone is the whole requirement.
    expect(schema.safeParse({ proposal, speaker, acks: {}, attendance }).success).toBe(false);
  });

  it('accepts a call that asks for no consents at all', () => {
    const form = clone();
    form.acks = [];
    expect(
      submissionSchema(form).safeParse({ proposal, speaker, acks: {}, attendance }).success,
    ).toBe(true);
  });
});
