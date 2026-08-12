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
    case 'resource-exhausted':
      switch (reasonOf(error)) {
        case 'speaker_talk_cap_reached':
          return t.errors.talkCapReached;
        case 'co_speaker_talk_cap_reached':
          return t.errors.coSpeakerTalkCapReached;
        default:
          return t.errors.generic;
      }
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
 * Admin actions reuse codes that mean something else to an applicant. A
 * failed precondition is normally a stale workspace rather than a closed CFP.
 */
export function adminError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'failed-precondition':
      return t.admin.actionInvalid;
    case 'invalid-argument':
      return t.admin.badInput;
    case 'permission-denied':
      return t.nav.forbidden;
    default:
      return friendlyError(error, t);
  }
}

/** Role mutations are the one admin path where the last-admin guard applies. */
export function roleAdminError(error: unknown, t: Dictionary): string {
  return codeOf(error) === 'failed-precondition' && reasonOf(error) === 'event_last_admin'
    ? t.admin.lastAdmin
    : adminError(error, t);
}

export function reviewError(error: unknown, t: Dictionary): string {
  switch (codeOf(error)) {
    case 'failed-precondition':
      return t.review.proposalNoLongerReviewable;
    case 'permission-denied':
      return reasonOf(error) === 'review_own_proposal'
        ? t.review.ownProposal
        : t.review.accessRemoved;
    default:
      return friendlyError(error, t);
  }
}

export function isCoSpeakerInvitationUnavailable(error: unknown): boolean {
  return (
    codeOf(error) === 'deadline-exceeded' ||
    reasonOf(error) === 'co_speaker_invitation_unavailable'
  );
}

export function coSpeakerInvitationError(error: unknown, t: Dictionary): string {
  if (isCoSpeakerInvitationUnavailable(error)) {
    return t.coSpeakers.invitationNoLongerAvailable;
  }
  if (codeOf(error) === 'failed-precondition') {
    return reasonOf(error) === 'co_speaker_invitation_reviewer_conflict'
      ? t.coSpeakers.invitationReviewerConflict
      : t.coSpeakers.invitationNoLongerAvailable;
  }
  if (codeOf(error) === 'permission-denied') return t.nav.forbidden;
  return friendlyError(error, t);
}

export function isSpeakerMessageRecipientsChanged(error: unknown): boolean {
  return (
    codeOf(error) === 'failed-precondition' &&
    reasonOf(error) === 'speaker_message_recipients_changed'
  );
}

/** Email actions have lifecycle failures of their own, never the last-admin guard. */
export function emailError(error: unknown, t: Dictionary): string {
  if (codeOf(error) === 'failed-precondition') {
    switch (reasonOf(error)) {
      case 'email_delivery_not_ready':
        return t.admin.emailDeliveryNotReady;
      case 'speaker_message_recipients_changed':
      case 'email_recipients_changed':
        return t.admin.messageRecipientChanged;
      default:
        return t.admin.emailActionInvalid;
    }
  }
  switch (codeOf(error)) {
    case 'invalid-argument':
      return t.admin.emailBadInput;
    case 'not-found':
      return t.admin.emailMissing;
    case 'permission-denied':
      return t.nav.forbidden;
    default:
      return friendlyError(error, t);
  }
}

export function emailHistoryError(
  error: string,
  errorReason: string,
  t: Dictionary,
): string {
  return errorReason ? t.admin.emailErrorReasons[errorReason] ?? error : error;
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
      case 'schedule-preview-stale':
        return t.schedule.publishNeedsReshare;
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
  if (codeOf(error) === 'failed-precondition') {
    switch (reasonOf(error)) {
      case 'email_domain_unavailable':
        return t.admin.emailErrors.domainUnavailable;
      case 'email_domain_mismatch':
        return t.admin.emailErrors.domainMismatch;
      default:
        return t.admin.emailErrors.badKey;
    }
  }
  switch (codeOf(error)) {
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
