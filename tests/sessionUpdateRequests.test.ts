import { describe, expect, it } from 'vitest';

import { DEFAULT_SUBMISSION_FORM } from '../shared/submissionForm';
import { sessionUpdateSchema } from '../shared/schema';
import {
  sessionUpdateChanges,
  sessionUpdateFieldsFrom,
} from '../functions/src/sessionUpdateRequests';

describe('sessionUpdateRequests', () => {
  it('validates session update fields against the CFP submission form', () => {
    const schema = sessionUpdateSchema(DEFAULT_SUBMISSION_FORM);

    const longAbstract =
      'An updated abstract that meets the 200-character minimum length requirement for the submission form by explaining what attendees will learn, why the topic matters in production systems, and how the talk walks through concrete architectural trade-offs.';

    const valid = schema.safeParse({
      title: 'Updated Talk Title',
      abstract: longAbstract,
      category: DEFAULT_SUBMISSION_FORM.category[0].value,
      level: DEFAULT_SUBMISSION_FORM.level[0].value,
      deliveryLanguage: 'en',
      languagePreference: '',
    });
    expect(valid.success).toBe(true);

    const invalidPreferenceWhenNotEither = schema.safeParse({
      title: 'Updated Talk Title',
      abstract: longAbstract,
      category: DEFAULT_SUBMISSION_FORM.category[0].value,
      level: DEFAULT_SUBMISSION_FORM.level[0].value,
      deliveryLanguage: 'en',
      languagePreference: 'Prefer English',
    });
    expect(invalidPreferenceWhenNotEither.success).toBe(false);
    if (!invalidPreferenceWhenNotEither.success) {
      expect(invalidPreferenceWhenNotEither.error.issues[0]?.path).toEqual(['languagePreference']);
    }
  });

  it('normalizes session update fields and drops languagePreference when deliveryLanguage is not either', () => {
    const normalizedEn = sessionUpdateFieldsFrom({
      title: '  My Talk  ',
      abstract: '  Some abstract  ',
      category: 'AI',
      level: 'Intermediate',
      deliveryLanguage: 'en',
      languagePreference: 'Should be ignored',
    });
    expect(normalizedEn).toEqual({
      title: 'My Talk',
      abstract: 'Some abstract',
      category: 'AI',
      level: 'Intermediate',
      deliveryLanguage: 'en',
    });

    const normalizedEither = sessionUpdateFieldsFrom({
      title: 'My Talk',
      abstract: 'Some abstract',
      category: 'AI',
      level: 'Intermediate',
      deliveryLanguage: 'either',
      languagePreference: '  Prefer English if possible  ',
    });
    expect(normalizedEither).toEqual({
      title: 'My Talk',
      abstract: 'Some abstract',
      category: 'AI',
      level: 'Intermediate',
      deliveryLanguage: 'either',
      languagePreference: 'Prefer English if possible',
    });
  });

  it('computes field-level diffs across session update fields', () => {
    const before = sessionUpdateFieldsFrom({
      title: 'Original Title',
      abstract: 'Original abstract text.',
      category: 'Web',
      level: 'Beginner',
      deliveryLanguage: 'en',
    });
    const after = sessionUpdateFieldsFrom({
      title: 'Revised Title',
      abstract: 'Original abstract text.',
      category: 'AI & ML',
      level: 'Beginner',
      deliveryLanguage: 'either',
      languagePreference: 'English preferred',
    });

    expect(sessionUpdateChanges(before, after)).toEqual([
      { field: 'title', before: 'Original Title', after: 'Revised Title' },
      { field: 'category', before: 'Web', after: 'AI & ML' },
      { field: 'deliveryLanguage', before: 'en', after: 'either' },
      { field: 'languagePreference', before: null, after: 'English preferred' },
    ]);
  });
});
