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
    case 'unavailable':
    case 'internal':
      return t.errors.unavailable;
    default:
      return t.errors.generic;
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
