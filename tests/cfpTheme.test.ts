import { describe, expect, it } from 'vitest';

import { normaliseThemeColor, themeForeground } from '../shared/cfpTheme';

describe('CFP theme colors', () => {
  it('accepts only complete six-digit hex colors', () => {
    expect(normaliseThemeColor(' #1A73E8 ')).toBe('#1a73e8');
    expect(normaliseThemeColor('')).toBe('');
    expect(normaliseThemeColor('#fff')).toBeNull();
    expect(normaliseThemeColor('red')).toBeNull();
  });

  it('chooses the higher-contrast foreground', () => {
    expect(themeForeground('#111827')).toBe('#ffffff');
    expect(themeForeground('#fef08a')).toBe('#111827');
  });
});
