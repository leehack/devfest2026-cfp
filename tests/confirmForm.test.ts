/**
 * The confirmation form's rules.
 *
 * This module is the only thing standing between an organiser's typing and a
 * document every accepted speaker's browser reads, and between a speaker's
 * answers and what an organiser reads back — so both directions are checked
 * here rather than only at the callable.
 */

import { describe, expect, it } from 'vitest';

import {
  FORM_LIMITS,
  EMPTY_FORM,
  confirmFormFromData,
  keyFromLabel,
  localised,
  normaliseForm,
  validateAnswers,
  validateForm,
  type ConfirmField,
  type ConfirmForm,
} from '@shared/confirmForm';

const field = (over: Partial<ConfirmField> = {}): ConfirmField => ({
  key: 'shirt',
  type: 'text',
  label: { en: 'Shirt size' },
  required: false,
  ...over,
});

const form = (...fields: ConfirmField[]): ConfirmForm => ({ fields });

describe('validateForm', () => {
  it('accepts an empty form — asking nothing is a valid choice', () => {
    expect(validateForm({ fields: [] })).toBeNull();
  });

  it('validates the dedicated reusable speaker-photo requirement', () => {
    expect(validateForm({ fields: [], speakerPhoto: { required: false } })).toBeNull();
    expect(validateForm({ fields: [], speakerPhoto: { required: true } })).toBeNull();
    expect(
      validateForm({ fields: [], speakerPhoto: { required: 'yes' } } as unknown as ConfirmForm),
    ).toEqual({ problem: 'badKey', key: 'speakerPhoto' });
  });

  it('keeps the dedicated photo setting distinct from a legacy question key', () => {
    expect(validateForm(form(field({ key: 'speakerPhoto', type: 'image' })))).toBeNull();
    expect(
      validateForm({
        fields: [field({ key: 'speakerPhoto', type: 'image' })],
        speakerPhoto: { required: false },
      }),
    ).toEqual({ problem: 'duplicateKey', key: 'speakerPhoto' });
  });

  it('accepts one of each type', () => {
    expect(
      validateForm(
        form(
          field({ key: 'a', type: 'text' }),
          field({ key: 'b', type: 'textarea' }),
          field({ key: 'c', type: 'checkbox' }),
          field({
            key: 'd',
            type: 'select',
            options: [{ value: 'M', label: { en: 'M' } }],
          }),
        ),
      ),
    ).toBeNull();
  });

  it.each([
    ['a key with a space', field({ key: 'shirt size' })],
    ['a key starting with a digit', field({ key: '1shirt' })],
    ['an empty key', field({ key: '' })],
  ])('rejects %s', (_, bad) => {
    expect(validateForm(form(bad))?.problem).toBe('badKey');
  });

  it('rejects two fields sharing a key, and names it', () => {
    // They would be one entry in the answers map: the second question's answer
    // would silently overwrite the first's.
    const fault = validateForm(form(field({ key: 'shirt' }), field({ key: 'shirt' })));
    expect(fault).toEqual({ problem: 'duplicateKey', key: 'shirt' });
  });

  it('requires an English label — French may be left for later', () => {
    expect(validateForm(form(field({ label: { en: '  ' } })))?.problem).toBe('emptyLabel');
    expect(validateForm(form(field({ label: { en: 'Shirt size' } })))).toBeNull();
  });

  it('rejects a "pick one" with nothing to pick', () => {
    expect(validateForm(form(field({ type: 'select', options: [] })))?.problem).toBe(
      'needsOptions',
    );
  });

  it('rejects repeated option values', () => {
    const fault = validateForm(
      form(
        field({
          type: 'select',
          options: [
            { value: 'M', label: { en: 'M' } },
            { value: 'M', label: { en: 'Medium' } },
          ],
        }),
      ),
    );
    expect(fault?.problem).toBe('duplicateOption');
  });

  it('caps the number of questions', () => {
    const many = Array.from({ length: FORM_LIMITS.fields + 1 }, (_, i) =>
      field({ key: `q${i}` }),
    );
    expect(validateForm(form(...many))?.problem).toBe('tooManyFields');
  });
});

describe('normaliseForm', () => {
  it('treats an omitted speaker-photo setting as optional', () => {
    expect(EMPTY_FORM.speakerPhoto).toEqual({ required: false });
    expect(confirmFormFromData({ fields: [] })).toEqual({
      fields: [],
      speakerPhoto: { required: false },
    });
    expect(normaliseForm({ fields: [] })).toEqual({
      fields: [],
      speakerPhoto: { required: false },
    });
  });

  it('preserves an explicit required speaker-photo setting', () => {
    expect(confirmFormFromData({ fields: [], speakerPhoto: { required: true } })).toEqual({
      fields: [],
      speakerPhoto: { required: true },
    });
  });

  it('drops anything the shape does not define', () => {
    const dirty = { fields: [{ ...field(), colour: 'red', label: { en: 'Shirt', xx: 'no' } }] };
    const clean = normaliseForm(dirty as unknown as ConfirmForm);
    expect(clean.fields[0]).toEqual({
      key: 'shirt',
      type: 'text',
      label: { en: 'Shirt' },
      required: false,
    });
  });

  it('drops options from a field that is no longer a select', () => {
    // Otherwise they lie dormant and reappear if the type is ever changed back.
    const clean = normaliseForm(
      form(field({ type: 'text', options: [{ value: 'M', label: { en: 'M' } }] })),
    );
    expect(clean.fields[0].options).toBeUndefined();
  });

  it('keeps a blank French label out of the document rather than storing ""', () => {
    const clean = normaliseForm(form(field({ label: { en: 'Shirt', fr: '   ' } })));
    expect(clean.fields[0].label).toEqual({ en: 'Shirt' });
  });

  it('normalises the speaker-photo setting independently from legacy image questions', () => {
    expect(
      normaliseForm({
        fields: [field({ key: 'sponsor_headshot', type: 'image' })],
        speakerPhoto: { required: true, label: 'ignored' } as never,
      }),
    ).toEqual({
      fields: [field({ key: 'sponsor_headshot', type: 'image' })],
      speakerPhoto: { required: true },
    });
  });
});

describe('validateAnswers', () => {
  it('refuses a blank answer to a required question', () => {
    const { faults } = validateAnswers(form(field({ required: true })), { shirt: '  ' });
    expect(faults).toEqual({ shirt: 'required' });
  });

  it('lets an optional question go unanswered, and stores nothing for it', () => {
    const { faults, clean } = validateAnswers(form(field()), {});
    expect(faults).toEqual({});
    // Absent, not '': every export would otherwise need the same check again.
    expect(clean).toEqual({});
  });

  it('refuses a select answer that is not one of the options', () => {
    const select = field({
      type: 'select',
      options: [{ value: 'M', label: { en: 'M' } }],
    });
    expect(validateAnswers(form(select), { shirt: 'XXL' }).faults).toEqual({ shirt: 'notAnOption' });
    expect(validateAnswers(form(select), { shirt: 'M' }).clean).toEqual({ shirt: 'M' });
  });

  it('treats a required checkbox as a consent — unticked is a no, not a blank', () => {
    const consent = field({ key: 'photos', type: 'checkbox', required: true });
    expect(validateAnswers(form(consent), { photos: false }).faults).toEqual({
      photos: 'required',
    });
    expect(validateAnswers(form(consent), { photos: true }).faults).toEqual({});
  });

  it('records an optional checkbox either way', () => {
    // Unlike a text answer, "not ticked" is itself the answer, and an organiser
    // reading the list needs to see it rather than an absence.
    const box = field({ key: 'photos', type: 'checkbox' });
    expect(validateAnswers(form(box), {}).clean).toEqual({ photos: false });
  });

  it('refuses an answer longer than we store', () => {
    const long = 'x'.repeat(FORM_LIMITS.answerText + 1);
    expect(validateAnswers(form(field()), { shirt: long }).faults).toEqual({ shirt: 'tooLong' });
  });

  it('refuses an answer of the wrong type outright', () => {
    // The callable is reachable directly, so this is not merely a UI slip.
    expect(validateAnswers(form(field()), { shirt: 42 as never }).faults).toEqual({
      shirt: 'wrongType',
    });
  });

  it('drops answers to questions the form no longer asks', () => {
    // A form is edited while people are answering it. Refusing a confirmation
    // over a question that has since been deleted would be the speaker paying
    // for the organiser's edit.
    const { faults, clean } = validateAnswers(form(field()), { shirt: 'M', gone: 'x' });
    expect(faults).toEqual({});
    expect(clean).toEqual({ shirt: 'M' });
  });
});

describe('localised', () => {
  it('falls back to English rather than showing an empty label', () => {
    expect(localised({ en: 'Shirt size' }, 'fr')).toBe('Shirt size');
    expect(localised({ en: 'Shirt size', fr: '  ' }, 'fr')).toBe('Shirt size');
    expect(localised({ en: 'Shirt size', fr: 'Taille' }, 'fr')).toBe('Taille');
  });
});

describe('keyFromLabel', () => {
  it.each([
    ['Shirt size', 'shirt_size'],
    ['Taille de t-shirt', 'taille_de_t_shirt'],
    ['Régime alimentaire', 'regime_alimentaire'],
    ['2026 plans', 'plans'],
    ['???', 'field'],
  ])('%s becomes %s', (label, key) => {
    expect(keyFromLabel(label, [])).toBe(key);
  });

  it('suffixes rather than colliding', () => {
    expect(keyFromLabel('Shirt size', ['shirt_size'])).toBe('shirt_size_2');
    expect(keyFromLabel('Shirt size', ['shirt_size', 'shirt_size_2'])).toBe('shirt_size_3');
  });

  it('produces keys the validator accepts', () => {
    for (const label of ['Shirt size', 'Régime', '???', 'a'.repeat(80)]) {
      const key = keyFromLabel(label, []);
      expect(validateForm(form(field({ key }))), label).toBeNull();
    }
  });
});
