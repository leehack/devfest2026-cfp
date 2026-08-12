import { describe, expect, it } from 'vitest';

import { normaliseOptionLines, optionsFromLines } from '../src/components/FieldRows';

describe('select question option editing', () => {
  it('preserves the unfinished line while an organiser is typing', () => {
    expect(optionsFromLines('Vegetarian \nGluten free\n').map((option) => option.value)).toEqual([
      'Vegetarian ',
      'Gluten free',
      '',
    ]);
  });

  it('normalises option lines only when the form is prepared for saving', () => {
    expect(normaliseOptionLines(optionsFromLines('Vegetarian \nGluten free\n'))).toEqual([
      { value: 'Vegetarian', label: { en: 'Vegetarian' } },
      { value: 'Gluten free', label: { en: 'Gluten free' } },
    ]);
  });
});
