import { describe, expect, it } from 'vitest';

import { speakerProfileComplete } from '../src/components/SpeakerFields';
import { emptyForm, type FormState } from '../src/lib/formState';

function completeProfile(overrides: Partial<FormState> = {}): FormState {
  return {
    ...emptyForm,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    basedIn: 'Montréal, QC',
    bio: 'A'.repeat(120),
    ...overrides,
  };
}

describe('speaker profile completion', () => {
  it('accepts a complete profile without optional professional details', () => {
    expect(speakerProfileComplete(completeProfile())).toBe(true);
  });

  it('keeps the editor open when a required profile field is incomplete', () => {
    expect(speakerProfileComplete(completeProfile({ bio: 'Too short' }))).toBe(false);
  });

  it('counts an invalid optional Sessionize link as incomplete', () => {
    expect(speakerProfileComplete(completeProfile({ sessionizeUrl: 'example.com/ada' }))).toBe(
      false,
    );
  });
});
