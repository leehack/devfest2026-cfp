// Montréal, so the local/UTC distinction is a real offset rather than a no-op.
// Must be set before the first Date is constructed.
process.env.TZ = 'America/Toronto';

import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import {
  addZonedCalendarDays,
  toDate,
  toDateTimeInput,
  toZonedDateTimeInput,
  zonedDateTimeToIso,
} from '../src/lib/dates';
import {
  adminError,
  friendlyError,
  platformAdminError,
  resendError,
  scheduleError,
} from '../src/lib/errors';
import {
  isLateIntakeWindow,
  publishedProgrammeLifecycleStep,
} from '../src/lib/adminLifecycle';
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

describe('event-zone datetime inputs', () => {
  const zone = 'America/Toronto';

  it('round-trips through the named IANA zone', () => {
    const instant = new Date('2026-08-09T18:30:00.000Z');
    const input = toZonedDateTimeInput(instant, zone);

    expect(input).toBe('2026-08-09T14:30');
    expect(zonedDateTimeToIso(input, zone)).toBe(instant.toISOString());
  });

  it('rejects a wall-clock time skipped by the daylight-saving jump', () => {
    expect(zonedDateTimeToIso('2026-03-08T02:30', zone)).toBeNull();
  });

  it('keeps a seven-day preset on the same wall clock across DST', () => {
    const opens = '2026-10-31T12:00';
    const closes = addZonedCalendarDays(opens, zone, 7);

    expect(closes).toBe('2026-11-07T12:00');
    const elapsedHours =
      (Date.parse(zonedDateTimeToIso(closes!, zone)!) -
        Date.parse(zonedDateTimeToIso(opens, zone)!)) /
      3_600_000;
    expect(elapsedHours).toBe(169);
  });
});

describe('the published-programme lifecycle', () => {
  const published = {
    publishedScheduleId: 'release-1',
    publishedScheduleAt: '2026-08-01T16:00:00.000Z',
  };

  it('does not call an original still-open window late intake', () => {
    const lateIntake = isLateIntakeWindow(
      { ...published, opensAt: '2026-07-01T16:00:00.000Z' },
      'open',
    );

    expect(lateIntake).toBe(false);
    expect(
      publishedProgrammeLifecycleStep({
        status: 'open',
        lateIntake,
        awaitingConfirmation: 0,
        undecided: 0,
        needsFirstReview: 0,
        publicNeedsUpdate: false,
        waitingEmails: 0,
      }),
    ).toBe(9);
  });

  it('keeps a window reopened after publication at the late-intake collection step', () => {
    const lateIntake = isLateIntakeWindow(
      { ...published, opensAt: '2026-08-02T16:00:00.000Z' },
      'open',
    );

    expect(lateIntake).toBe(true);
    expect(
      publishedProgrammeLifecycleStep({
        status: 'open',
        lateIntake,
        awaitingConfirmation: 0,
        undecided: 0,
        needsFirstReview: 0,
        publicNeedsUpdate: false,
        waitingEmails: 0,
      }),
    ).toBe(12);
  });

  it('does not infer late intake from legacy publication data with no timestamp', () => {
    expect(
      isLateIntakeWindow(
        {
          publishedScheduleId: 'legacy-release',
          opensAt: '2026-08-02T16:00:00.000Z',
        },
        'open',
      ),
    ).toBe(false);
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
    expect(friendlyError(failed('unknown'), en)).toBe(en.errors.unavailable);
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

describe('resendError', () => {
  const failed = (code: string) => ({ code });

  // The bug this exists for: a key Resend refused was reported as an expired
  // session, so the admin signed in again — repeatedly — and the key stayed bad.
  it('blames the key, never the session', () => {
    for (const dict of [en, fr]) {
      const shown = resendError(failed('functions/failed-precondition'), dict);
      expect(shown).toBe(dict.admin.emailErrors.badKey);
      expect(shown).not.toBe(dict.errors.signedOut);
      expect(shown).not.toBe(dict.admin.lastAdmin);
    }
  });

  it('still reports a real signed-out caller as signed out', () => {
    expect(resendError(failed('unauthenticated'), en)).toBe(en.errors.signedOut);
  });

  it('maps the rest of what Resend can return', () => {
    expect(resendError(failed('not-found'), en)).toBe(en.admin.emailErrors.noDomain);
    expect(resendError(failed('invalid-argument'), en)).toBe(en.admin.emailErrors.rejected);
    expect(resendError(failed('unavailable'), en)).toBe(en.admin.emailErrors.unreachable);
    expect(resendError(failed('permission-denied'), en)).toBe(en.nav.forbidden);
  });
});

describe('scheduleError', () => {
  it('explains each schedule delivery fence without exposing callable copy', () => {
    for (const dict of [en, fr]) {
      expect(
        scheduleError(
          {
            code: 'functions/failed-precondition',
            details: { reason: 'schedule-email-in-flight' },
          },
          dict,
        ),
      ).toBe(dict.schedule.emailDeliveryInProgress);
      expect(
        scheduleError(
          {
            code: 'functions/failed-precondition',
            details: { reason: 'schedule-email-retry-required' },
          },
          dict,
        ),
      ).toBe(dict.schedule.emailDeliveryRetryRequired);
      expect(
        scheduleError(
          {
            code: 'functions/failed-precondition',
            details: { reason: 'schedule-cancellation-pending' },
          },
          dict,
        ),
      ).toBe(dict.schedule.cancellationDeliveryPending);
      expect(
        scheduleError(
          {
            code: 'functions/failed-precondition',
            details: { reason: 'schedule-cancellation-processing' },
          },
          dict,
        ),
      ).toBe(dict.schedule.cancellationProcessing);
      expect(
        scheduleError(
          {
            code: 'functions/failed-precondition',
            details: { speakerPhoto: 'required', speakers: ['Private name'] },
          },
          dict,
        ),
      ).toBe(dict.schedule.speakerPhotoRequired);
    }
  });
});

describe('platformAdminError', () => {
  const failed = (code: string) => ({ code });

  it('maps creator-management failures without borrowing event-admin copy', () => {
    expect(platformAdminError(failed('functions/invalid-argument'), en)).toBe(
      en.platformAdmin.badEmail,
    );
    expect(platformAdminError(failed('functions/failed-precondition'), en)).toBe(
      en.platformAdmin.adminManaged,
    );
    expect(platformAdminError(failed('functions/permission-denied'), en)).toBe(
      en.nav.forbidden,
    );
  });

  it('speaks the reader’s language and never leaks a callable message', () => {
    expect(platformAdminError(failed('functions/invalid-argument'), fr)).toBe(
      fr.platformAdmin.badEmail,
    );
    expect(
      platformAdminError(
        { code: 'functions/failed-precondition', message: 'bootstrap internals' },
        fr,
      ),
    ).toBe(fr.platformAdmin.adminManaged);
  });
});
