// Montréal, so the local/UTC distinction is a real offset rather than a no-op.
// Must be set before the first Date is constructed.
process.env.TZ = 'America/Toronto';

import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import { toDate, toDateTimeInput } from '../src/lib/dates';
import { adminError, friendlyError } from '../src/lib/errors';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

describe('toDate', () => {
  it('unwraps a Firestore Timestamp', () => {
    const at = new Date('2026-09-15T21:30:00Z');
    expect(toDate(Timestamp.fromDate(at))?.toISOString()).toBe(at.toISOString());
  });

  it('parses an ISO string', () => {
    expect(toDate('2026-09-15T21:30:00Z')?.toISOString()).toBe('2026-09-15T21:30:00.000Z');
  });

  it('returns null rather than an Invalid Date', () => {
    for (const bad of [undefined, null, '', 'not a date', {}]) {
      expect(toDate(bad)).toBeNull();
    }
  });
});

describe('toDateTimeInput', () => {
  const instant = new Date('2026-09-15T21:30:00Z');

  it('round-trips back to the same instant', () => {
    // What the browser does with the value on the way back out.
    expect(new Date(toDateTimeInput(instant)).toISOString()).toBe(instant.toISOString());
  });

  it('shows local wall-clock, not UTC', () => {
    // 21:30Z is 17:30 in Montréal. Slicing toISOString() would show 21:30 and
    // move the published deadline by four hours.
    expect(toDateTimeInput(instant)).toBe('2026-09-15T17:30');
    expect(toDateTimeInput(instant)).not.toBe(instant.toISOString().slice(0, 16));
  });

  it('renders nothing for a missing date', () => {
    expect(toDateTimeInput(null)).toBe('');
  });
});

describe('adminError', () => {
  const failed = (code: string) => ({ code });

  it('reads failed-precondition as the last-admin guard, not a closed window', () => {
    expect(adminError(failed('functions/failed-precondition'), en)).toBe(en.admin.lastAdmin);
    // The applicant-facing mapper says the opposite thing for the same code.
    expect(friendlyError(failed('functions/failed-precondition'), en)).toBe(en.errors.notOpen);
  });

  it('maps the codes an admin action can produce', () => {
    expect(adminError(failed('functions/invalid-argument'), en)).toBe(en.admin.badInput);
    expect(adminError(failed('permission-denied'), en)).toBe(en.nav.forbidden);
    expect(adminError(failed('unavailable'), en)).toBe(en.errors.unavailable);
    expect(adminError(new Error('boom'), en)).toBe(en.errors.generic);
  });

  it('speaks the reader’s language', () => {
    expect(adminError(failed('functions/failed-precondition'), fr)).toBe(fr.admin.lastAdmin);
  });

  it('never leaks the raw message', () => {
    const raw = 'PERMISSION_DENIED: evaluation error at L157:24';
    expect(adminError({ code: 'permission-denied', message: raw }, en)).not.toContain('L157');
  });
});
