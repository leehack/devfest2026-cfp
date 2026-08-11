import type { Dictionary } from '../i18n';

/**
 * Turns a Firebase error into something an applicant can read.
 *
 * Two problems it solves. Firestore rule denials arrive as raw rule text
 * ("PERMISSION_DENIED: evaluation error at L103:24 …"), which is both meaningless
 * and an unnecessary disclosure of the rules; and our own callables throw
 * English, which would put an English sentence in front of a French applicant.
 * So map the code, never the message.
 */
function codeOf(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '').replace(/^functions\//, '');
}

function reasonOf(error: unknown): string {
  const details = (error as { details?: unknown } | null)?.details;
  return details && typeof details === 'object'
    ? String((details as { reason?: unknown }).reason ?? '')
    : '';
}

function detailsOf(error: unknown): Record<string, unknown> {
  const details = (error as { details?: unknown } | null)?.details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
}

export function friendlyError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'permission-denied':
      // For an applicant this is almost always the window closing under them,
      // or a proposal that is no longer a draft.
      return t.errors.readOnlyNow;
    case 'deadline-exceeded':
      return t.window.closed;
    case 'failed-precondition':
      return t.errors.notOpen;
    case 'unauthenticated':
      return t.errors.signedOut;
    case 'not-found':
      return t.errors.notFound;
    case 'invalid-argument':
      return t.errors.incomplete;
    // Firestore Lite reports a fetch failure with no HTTP status as `unknown`.
    case 'unknown':
    case 'unavailable':
    case 'internal':
      return t.errors.unavailable;
    default:
      return t.errors.generic;
  }
}

/**
 * Admin actions reuse codes that mean something else to an applicant:
 * `failed-precondition` here is the last-admin guard, not a closed window.
 */
export function adminError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'failed-precondition':
      return t.admin.lastAdmin;
    case 'invalid-argument':
      return t.admin.badInput;
    case 'permission-denied':
      return t.nav.forbidden;
    default:
      return friendlyError(error, t);
  }
}

export function scheduleError(error: unknown, t: Dictionary): string {
  if (codeOf(error) === 'failed-precondition') {
    if (detailsOf(error).speakerPhoto === 'required') {
      return t.schedule.speakerPhotoRequired;
    }
    switch (reasonOf(error)) {
      case 'schedule-email-in-flight':
        return t.schedule.emailDeliveryInProgress;
      case 'schedule-email-retry-required':
        return t.schedule.emailDeliveryRetryRequired;
      case 'schedule-cancellation-pending':
        return t.schedule.cancellationDeliveryPending;
      case 'schedule-cancellation-processing':
        return t.schedule.cancellationProcessing;
    }
  }
  switch (codeOf(error)) {
    case 'aborted':
      return t.schedule.stale;
    case 'already-exists':
      return t.schedule.conflict;
    case 'failed-precondition':
      return t.schedule.invalidState;
    case 'invalid-argument':
      return t.schedule.badInput;
    case 'permission-denied':
      return t.nav.forbidden;
    default:
      return friendlyError(error, t);
  }
}

/** Global access controls have their own input and protected-role guard. */
export function platformAdminError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'invalid-argument':
      return t.platformAdmin.badEmail;
    case 'failed-precondition':
      return t.platformAdmin.adminManaged;
    case 'permission-denied':
      return t.nav.forbidden;
    default:
      return friendlyError(error, t);
  }
}

/**
 * Resend's failures, which are about a third party and not about the caller.
 *
 * Worth its own map because the obvious code is a trap: a key Resend refuses is
 * *not* `unauthenticated`. That code already means "you are not signed in", and
 * sharing it told an admin their session had expired the moment they pasted a
 * bad key — sending them to re-authenticate over and over while the key sat
 * there wrong. `functions/src/domains.ts` throws `failed-precondition` instead.
 */
export function resendError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'failed-precondition':
      return t.admin.emailErrors.badKey;
    case 'not-found':
      return t.admin.emailErrors.noDomain;
    case 'invalid-argument':
      return t.admin.emailErrors.rejected;
    case 'unavailable':
    case 'internal':
      return t.admin.emailErrors.unreachable;
    default:
      return adminError(error, t);
  }
}

/** The import has its own failures, all of which the speaker can act on. */
export function importError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'invalid-argument':
      return t.import.errors.badLink;
    case 'not-found':
      return t.import.errors.noProfile;
    case 'permission-denied':
      return t.import.errors.offHost;
    case 'internal':
      return t.import.errors.unreadable;
    case 'unauthenticated':
      return t.errors.signedOut;
    default:
      return t.import.errors.unavailable;
  }
}
