import { randomUUID } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { validateCfpId } from '../../shared/cfp';
import { MESSAGE_KIND, type EmailLocale } from '../../shared/emailTemplates';
import type { DeliveryLanguage } from '../../shared/enums';
import { sessionUpdateSchema } from '../../shared/schema';
import { mergeSubmissionForm } from '../../shared/submissionForm';
import type {
  SessionUpdateChange,
  SessionUpdateField,
  SessionUpdateFields,
  SessionUpdateRequestStatus,
  SessionUpdateRequestSummary,
} from '../../shared/types';
import {
  loadPlatform,
  staffEmailLanguage,
  staffMemberIsActive,
  verifiedStaffUser,
  type EmailStatus,
} from './email';
import {
  primarySpeakerId,
  speakerConfirmationRef,
  usesPerSpeakerLifecycle,
} from './speakerLifecycle';

const CALLABLE = { region: 'northamerica-northeast1', maxInstances: 10 } as const;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SESSION_UPDATE_FIELDS = [
  'title',
  'abstract',
  'category',
  'level',
  'deliveryLanguage',
  'languagePreference',
] as const satisfies readonly SessionUpdateField[];
const REJECTION_NOTE_MAX = 500;

interface Identity {
  uid: string;
}

function requireIdentity(request: {
  auth?: { uid: string; token?: { email_verified?: unknown } };
}): Identity {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage session update requests.');
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address first.');
  }
  return { uid };
}

function requireCfpInput(data: unknown): string {
  const cfpId =
    typeof (data as Record<string, unknown> | null)?.cfpId === 'string'
      ? String((data as Record<string, unknown>).cfpId)
      : '';
  if (validateCfpId(cfpId) !== null) {
    throw new HttpsError('invalid-argument', 'A valid CFP is required.');
  }
  return cfpId;
}

function requireProposalInput(data: unknown): { cfpId: string; proposalId: string } {
  const input = (data ?? {}) as Record<string, unknown>;
  const cfpId = requireCfpInput(input);
  const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
  if (!DOCUMENT_ID.test(proposalId)) {
    throw new HttpsError('invalid-argument', 'A valid proposal is required.');
  }
  return { cfpId, proposalId };
}

function requireRequestId(data: unknown): string {
  const requestId = (data as Record<string, unknown> | null)?.requestId;
  if (typeof requestId !== 'string' || !DOCUMENT_ID.test(requestId)) {
    throw new HttpsError('invalid-argument', 'A valid session update request is required.');
  }
  return requestId;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestampMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function isEventAdmin(member: DocumentSnapshot): boolean {
  return member.exists && (member.get('role') === 'admin' || member.get('role') === 'owner');
}

function speakerHasConfirmed(
  proposal: DocumentSnapshot,
  confirmation: DocumentSnapshot,
): boolean {
  return usesPerSpeakerLifecycle(proposal.data()!)
    ? confirmation.get('response') === 'confirmed'
    : proposal.get('status') === 'confirmed';
}

export function sessionUpdateRequestRef(db: Firestore, cfpId: string, proposalId: string) {
  return db.doc(`cfps/${cfpId}/sessionUpdateRequests/${proposalId}`);
}

export function sessionUpdateFieldsFrom(value: unknown): SessionUpdateFields {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const deliveryLanguage = safeString(data.deliveryLanguage) as DeliveryLanguage;
  const languagePreference = safeString(data.languagePreference).trim();
  return {
    title: safeString(data.title).trim(),
    abstract: safeString(data.abstract).trim(),
    category: safeString(data.category).trim(),
    level: safeString(data.level).trim(),
    deliveryLanguage,
    ...(deliveryLanguage === 'either' && languagePreference ? { languagePreference } : {}),
  };
}

function fieldValue(fields: SessionUpdateFields, field: SessionUpdateField): string | null {
  const raw = fields[field];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function sessionUpdateChanges(
  before: SessionUpdateFields,
  after: SessionUpdateFields,
): SessionUpdateChange[] {
  return SESSION_UPDATE_FIELDS.flatMap((field) => {
    const prev = fieldValue(before, field);
    const next = fieldValue(after, field);
    return prev === next ? [] : [{ field, before: prev, after: next }];
  });
}

export function sessionUpdateSummaryFrom(
  snapshot: DocumentSnapshot,
): SessionUpdateRequestSummary | null {
  if (!snapshot.exists) return null;
  const proposalId = safeString(snapshot.get('proposalId') ?? snapshot.id);
  const speakerUid = safeString(snapshot.get('speakerUid'));
  const requestId = safeString(snapshot.get('requestId'));
  const generation = Number(snapshot.get('generation') ?? 0);
  const status = safeString(snapshot.get('status')) as SessionUpdateRequestStatus;
  if (
    !DOCUMENT_ID.test(proposalId) ||
    !speakerUid ||
    !DOCUMENT_ID.test(requestId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !['pending', 'approved', 'rejected', 'cancelled'].includes(status)
  ) {
    return null;
  }
  const before = sessionUpdateFieldsFrom(snapshot.get('before'));
  const proposed = sessionUpdateFieldsFrom(snapshot.get('proposed'));
  const changes = sessionUpdateChanges(before, proposed);
  const speakerName = safeString(snapshot.get('speakerName')).trim();
  const resolvedBy = safeString(snapshot.get('resolvedBy')).trim();
  const rejectionNote = safeString(snapshot.get('rejectionNote')).trim();
  return {
    proposalId,
    speakerUid,
    ...(speakerName ? { speakerName } : {}),
    requestId,
    generation,
    status,
    before,
    proposed,
    changes,
    requestedAt: timestampMillis(snapshot.get('requestedAt')),
    resolvedAt: timestampMillis(snapshot.get('resolvedAt')),
    ...(resolvedBy ? { resolvedBy } : {}),
    ...(rejectionNote ? { rejectionNote } : {}),
  };
}

/** Terminates a pending session update request when the proposal lifecycle invalidates it. */
export function cancelPendingSessionUpdateRequest(
  tx: Transaction,
  request: DocumentSnapshot,
  cancelledBy: string,
  cancellationReason:
    | 'speaker-cancelled'
    | 'admin-cancelled'
    | 'decision-reset'
    | 'speaker-declined'
    | 'speaker-withdrawn',
): boolean {
  if (!request.exists || request.get('status') !== 'pending') return false;
  tx.update(request.ref, {
    status: 'cancelled',
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy,
    cancellationReason,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

function renderAdminSpeakerUpdateCopy(
  updateType: 'session' | 'profile',
  proposalTitle: string,
  adminProposalsUrl: string,
  locale: EmailLocale,
  bilingual: boolean,
): { subject: string; body: string } {
  const en =
    updateType === 'session'
      ? {
          subject: `Session update request for “${proposalTitle}”`,
          body: [
            'Hi {reviewerName},',
            '{speakerName} submitted a session update request for “{title}” in {event}.',
            'Review and approve or decline the proposed changes in the proposals dashboard:',
            adminProposalsUrl,
          ].join('\n\n'),
        }
      : {
          subject: `Speaker profile update completed for “${proposalTitle}”`,
          body: [
            'Hi {reviewerName},',
            '{speakerName} completed their requested speaker profile update for “{title}” in {event}.',
            'Review the updated session profile in the proposals dashboard:',
            adminProposalsUrl,
          ].join('\n\n'),
        };

  const fr =
    updateType === 'session'
      ? {
          subject: `Demande de modification de session pour « ${proposalTitle} »`,
          body: [
            'Bonjour {reviewerName},',
            '{speakerName} a soumis une demande de modification pour la session « {title} » ({event}).',
            'Consultez et approuvez ou refusez les changements proposés dans le tableau des propositions :',
            adminProposalsUrl,
          ].join('\n\n'),
        }
      : {
          subject: `Mise à jour du profil conférencier terminée pour « ${proposalTitle} »`,
          body: [
            'Bonjour {reviewerName},',
            '{speakerName} a terminé la mise à jour demandée de son profil pour « {title} » ({event}).',
            'Consultez le profil mis à jour dans le tableau des propositions :',
            adminProposalsUrl,
          ].join('\n\n'),
        };

  if (bilingual) {
    return {
      subject: `${en.subject} / ${fr.subject}`,
      body: `${en.body}\n\n---\n\n${fr.body}`,
    };
  }
  return locale === 'fr' ? fr : en;
}

/**
 * Queues immediate notification emails to active verified event admins and owners
 * when a speaker submits a session update request or completes a profile update request.
 */
export async function notifyEventAdminsOfSpeakerUpdate(
  db: Firestore,
  cfpId: string,
  options: {
    proposalId: string;
    proposalTitle: string;
    speakerName: string;
    updateType: 'session' | 'profile';
    dedupeKey: string;
    excludeUids?: readonly string[];
  },
): Promise<number> {
  const excluded = new Set(options.excludeUids ?? []);
  const [membersSnap, platform] = await Promise.all([
    db.collection(`cfps/${cfpId}/members`).get(),
    loadPlatform(db),
  ]);
  const adminCandidates = membersSnap.docs.filter(
    (member) =>
      !excluded.has(member.id) &&
      staffMemberIsActive(member.data(), cfpId, member.id) &&
      isEventAdmin(member),
  );
  if (adminCandidates.length === 0) return 0;

  const users = new Map<string, Awaited<ReturnType<typeof verifiedStaffUser>>>();
  for (let index = 0; index < adminCandidates.length; index += 100) {
    const chunk = adminCandidates.slice(index, index + 100);
    const result = await getAuth().getUsers(chunk.map((member) => ({ uid: member.id })));
    for (const user of result.users) {
      users.set(user.uid, !user.disabled && user.emailVerified && user.email ? user : null);
    }
  }

  const recipients = adminCandidates.flatMap((member) => {
    const user = users.get(member.id);
    if (!user?.email) return [];
    const language = staffEmailLanguage(member.data());
    return [
      {
        uid: member.id,
        email: user.email,
        name: String(member.get('name') ?? user.displayName ?? user.email),
        ...language,
      },
    ];
  });
  if (recipients.length === 0) return 0;

  const adminProposalsUrl = `${platform.publicUrl}/c/${encodeURIComponent(cfpId)}/admin/proposals`;
  let queuedCount = 0;

  for (let index = 0; index < recipients.length; index += 10) {
    const batch = recipients.slice(index, index + 10);
    const results = await Promise.all(
      batch.map((recipient) =>
        db.runTransaction(async (tx) => {
          const cfpRef = db.doc(`cfps/${cfpId}`);
          const memberRef = db.doc(`cfps/${cfpId}/members/${recipient.uid}`);
          const logRef = db.doc(
            `cfps/${cfpId}/emailLog/message__${options.proposalId}__${options.dedupeKey}__${recipient.uid}`,
          );
          const [cfp, member, existingLog] = await tx.getAll(cfpRef, memberRef, logRef);
          if (
            !cfp.exists ||
            cfp.get('archived') === true ||
            cfp.get('deleting') === true ||
            !staffMemberIsActive(member.data(), cfpId, recipient.uid) ||
            !isEventAdmin(member) ||
            existingLog.exists
          ) {
            return false;
          }
          const copy = renderAdminSpeakerUpdateCopy(
            options.updateType,
            options.proposalTitle,
            adminProposalsUrl,
            recipient.locale,
            recipient.bilingual,
          );
          tx.create(logRef, {
            kind: MESSAGE_KIND,
            proposalId: options.proposalId,
            dedupeKey: options.dedupeKey,
            subject: copy.subject,
            body: copy.body,
            to: recipient.email,
            locale: recipient.locale,
            bilingual: recipient.bilingual,
            data: {
              speakerName: options.speakerName || 'A speaker',
              reviewerName: recipient.name,
              title: options.proposalTitle,
              needsVisa: false,
            },
            status: 'queued' satisfies EmailStatus,
            attempts: 0,
            createdAt: FieldValue.serverTimestamp(),
          });
          return true;
        }),
      ),
    );
    queuedCount += results.filter(Boolean).length;
  }

  return queuedCount;
}

function renderSpeakerResolutionCopy(
  decision: 'approve' | 'reject',
  proposalTitle: string,
  locale: EmailLocale,
  rejectionNote?: string,
): { subject: string; body: string } {
  if (decision === 'approve') {
    return locale === 'fr'
      ? {
          subject: `Modifications approuvées pour « ${proposalTitle} »`,
          body: [
            'Bonjour {speakerName},',
            'L’équipe organisatrice a approuvé votre demande de modification pour la session « {title} » ({event}).',
            'Votre session mise à jour est visible ici :',
            '{proposalUrl}',
          ].join('\n\n'),
        }
      : {
          subject: `Session update approved for “${proposalTitle}”`,
          body: [
            'Hi {speakerName},',
            'The organisers approved your session update request for “{title}” in {event}.',
            'Your updated session details are available here:',
            '{proposalUrl}',
          ].join('\n\n'),
        };
  }
  const noteParagraphEn = rejectionNote ? `Organiser note: ${rejectionNote}` : '';
  const noteParagraphFr = rejectionNote ? `Note de l’organisation : ${rejectionNote}` : '';
  return locale === 'fr'
    ? {
        subject: `Mise à jour concernant votre demande pour « ${proposalTitle} »`,
        body: [
          'Bonjour {speakerName},',
          'L’équipe organisatrice n’a pas retenu votre demande de modification pour la session « {title} » ({event}). Les détails actuels de votre session restent inchangés.',
          ...(noteParagraphFr ? [noteParagraphFr] : []),
          'Vous pouvez consulter votre session ici :',
          '{proposalUrl}',
        ].join('\n\n'),
      }
    : {
        subject: `Update on your session change request for “${proposalTitle}”`,
        body: [
          'Hi {speakerName},',
          'The organisers did not approve your session update request for “{title}” in {event}. Your existing session details remain in place.',
          ...(noteParagraphEn ? [noteParagraphEn] : []),
          'You can view your session here:',
          '{proposalUrl}',
        ].join('\n\n'),
      };
}

/**
 * Allows the confirmed primary speaker of a proposal to submit a session update
 * request (`title`, `abstract`, `category`, `level`, `deliveryLanguage`,
 * `languagePreference`) for organiser approval.
 */
export const submitSessionUpdateRequest = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireProposalInput(request.data);
  const rawFields = (request.data as Record<string, unknown> | null)?.proposed;
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    throw new HttpsError('invalid-argument', 'Proposed session fields are required.');
  }

  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const submissionFormRef = db.doc(`cfps/${cfpId}/config/submissionForm`);
  const confirmationRef = speakerConfirmationRef(db, cfpId, proposalId, identity.uid);
  const speakerRef = db.doc(`speakers/${identity.uid}`);
  const requestRef = sessionUpdateRequestRef(db, cfpId, proposalId);

  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, submissionFormSnap, confirmation, speakerSnap, existingRequest] =
      await tx.getAll(
        cfpRef,
        proposalRef,
        submissionFormRef,
        confirmationRef,
        speakerRef,
        requestRef,
      );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');

    const proposalData = proposal.data()!;
    const primaryUid = primarySpeakerId(proposalData);
    if (primaryUid !== identity.uid) {
      throw new HttpsError(
        'permission-denied',
        'Only the primary speaker can request session updates.',
      );
    }
    const proposalStatus = safeString(proposal.get('status'));
    if (
      (proposalStatus !== 'confirmed' && proposalStatus !== 'accepted') ||
      !speakerHasConfirmed(proposal, confirmation)
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Confirm your session before requesting a session update.',
      );
    }

    const form = mergeSubmissionForm(submissionFormSnap.data());
    const parsed = sessionUpdateSchema(form).safeParse(rawFields);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Please check the proposed session details.');
    }

    const before = sessionUpdateFieldsFrom(proposalData);
    const proposed = sessionUpdateFieldsFrom(parsed.data);
    const changes = sessionUpdateChanges(before, proposed);
    if (changes.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Change at least one session field before submitting a request.',
        { reason: 'session-update-unchanged' },
      );
    }

    const previousGeneration = existingRequest.get('generation');
    const generation =
      Number.isSafeInteger(previousGeneration) && Number(previousGeneration) >= 1
        ? Number(previousGeneration) + 1
        : 1;
    const requestId = randomUUID();
    const now = TimestampNow();
    const snapshotSpeakers = Array.isArray(proposalData.speakerSnapshot)
      ? (proposalData.speakerSnapshot as Array<Record<string, unknown>>)
      : [];
    const snapshotEntry = snapshotSpeakers.find((entry) => entry?.uid === identity.uid);
    const speakerName =
      safeString(speakerSnap.get('name')).trim() ||
      safeString(snapshotEntry?.name).trim() ||
      safeString(speakerSnap.get('email')).trim() ||
      'Speaker';

    tx.set(requestRef, {
      cfpId,
      proposalId,
      speakerUid: identity.uid,
      speakerName,
      requestId,
      generation,
      status: 'pending' satisfies SessionUpdateRequestStatus,
      before,
      proposed,
      changes,
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: identity.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const summary: SessionUpdateRequestSummary = {
      proposalId,
      speakerUid: identity.uid,
      speakerName,
      requestId,
      generation,
      status: 'pending',
      before,
      proposed,
      changes,
      requestedAt: now,
      resolvedAt: null,
    };

    return {
      summary,
      speakerName,
      proposalTitle: before.title || proposed.title,
    };
  });

  try {
    await notifyEventAdminsOfSpeakerUpdate(db, cfpId, {
      proposalId,
      proposalTitle: result.proposalTitle,
      speakerName: result.speakerName,
      updateType: 'session',
      dedupeKey: `session_${result.summary.requestId}`,
      excludeUids: [identity.uid],
    });
  } catch (notifyError) {
    logger.warn('failed to queue admin notification for session update request', {
      cfpId,
      proposalId,
      requestId: result.summary.requestId,
      error: String(notifyError),
    });
  }

  logger.info('session update request submitted', {
    cfpId,
    proposalId,
    speakerUid: identity.uid,
    requestId: result.summary.requestId,
    generation: result.summary.generation,
  });

  return { ok: true, request: result.summary };
});

function TimestampNow(): number {
  return Date.now();
}

/**
 * Cancels a pending session update request (by the primary speaker or an event admin).
 */
export const cancelSessionUpdateRequest = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireProposalInput(request.data);
  const requestId = requireRequestId(request.data);

  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const requestRef = sessionUpdateRequestRef(db, cfpId, proposalId);

  const summary = await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, existing] = await tx.getAll(
      cfpRef,
      proposalRef,
      memberRef,
      requestRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');

    const isPrimary = primarySpeakerId(proposal.data()!) === identity.uid;
    const admin = isEventAdmin(member);
    if (!isPrimary && !admin) {
      throw new HttpsError(
        'permission-denied',
        'Only the primary speaker or an event admin can cancel this request.',
      );
    }

    const current = sessionUpdateSummaryFrom(existing);
    if (!current || current.status !== 'pending' || current.requestId !== requestId) {
      throw new HttpsError(
        'failed-precondition',
        'That session update request is no longer pending.',
      );
    }

    cancelPendingSessionUpdateRequest(
      tx,
      existing,
      identity.uid,
      isPrimary ? 'speaker-cancelled' : 'admin-cancelled',
    );

    return {
      ...current,
      status: 'cancelled' as const,
    };
  });

  logger.info('session update request cancelled', {
    cfpId,
    proposalId,
    requestId,
    byUid: identity.uid,
  });

  return { ok: true, request: summary };
});

/**
 * Approves or rejects a pending session update request (event admin/owner only).
 */
export const resolveSessionUpdateRequest = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const { cfpId, proposalId } = requireProposalInput(request.data);
  const requestId = requireRequestId(request.data);
  const input = (request.data ?? {}) as Record<string, unknown>;
  const decision = input.decision === 'approve' ? 'approve' : input.decision === 'reject' ? 'reject' : null;
  if (!decision) {
    throw new HttpsError('invalid-argument', 'Decision must be approve or reject.');
  }
  const rawRejectionNote = safeString(input.rejectionNote).trim();
  if (rawRejectionNote.length > REJECTION_NOTE_MAX) {
    throw new HttpsError('invalid-argument', 'Rejection note is too long.');
  }

  const db = getFirestore();
  const cfpRef = db.doc(`cfps/${cfpId}`);
  const proposalRef = db.doc(`cfps/${cfpId}/proposals/${proposalId}`);
  const memberRef = db.doc(`cfps/${cfpId}/members/${identity.uid}`);
  const requestRef = sessionUpdateRequestRef(db, cfpId, proposalId);
  const scheduleRef = db.doc(`cfps/${cfpId}/config/schedule`);

  const result = await db.runTransaction(async (tx) => {
    const [cfp, proposal, member, existing, schedule] = await tx.getAll(
      cfpRef,
      proposalRef,
      memberRef,
      requestRef,
      scheduleRef,
    );
    if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
    if (cfp.get('deleting') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
    }
    if (cfp.get('archived') === true) {
      throw new HttpsError('failed-precondition', 'This call for proposals is archived.');
    }
    if (!isEventAdmin(member)) {
      throw new HttpsError(
        'permission-denied',
        'Only an event admin can approve or reject session updates.',
      );
    }
    if (!proposal.exists) throw new HttpsError('not-found', 'Proposal not found.');

    const proposalStatus = safeString(proposal.get('status'));
    if (proposalStatus !== 'confirmed' && proposalStatus !== 'accepted') {
      throw new HttpsError(
        'failed-precondition',
        'Only an accepted or confirmed session can apply a session update.',
      );
    }

    const current = sessionUpdateSummaryFrom(existing);
    if (!current || current.status !== 'pending' || current.requestId !== requestId) {
      throw new HttpsError(
        'failed-precondition',
        'That session update request is no longer pending.',
      );
    }

    const speakerRef = db.doc(`speakers/${current.speakerUid}`);
    const logRef = db.doc(
      `cfps/${cfpId}/emailLog/message__${proposalId}__session_${decision}_${requestId}`,
    );
    const [speakerSnap, existingLog] = await tx.getAll(speakerRef, logRef);

    const nowMillis = TimestampNow();
    const nextStatus: SessionUpdateRequestStatus =
      decision === 'approve' ? 'approved' : 'rejected';
    const proposed = current.proposed;

    if (decision === 'approve') {
      tx.update(proposalRef, {
        title: proposed.title,
        abstract: proposed.abstract,
        category: proposed.category,
        level: proposed.level,
        deliveryLanguage: proposed.deliveryLanguage,
        languagePreference:
          proposed.deliveryLanguage === 'either' && proposed.languagePreference
            ? proposed.languagePreference
            : FieldValue.delete(),
        ...(proposed.deliveryLanguage !== 'either'
          ? { assignedLanguage: FieldValue.delete() }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (schedule.exists) {
        tx.set(
          scheduleRef,
          { needsAttention: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    }

    tx.update(requestRef, {
      status: nextStatus,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: identity.uid,
      rejectionNote:
        decision === 'reject' && rawRejectionNote ? rawRejectionNote : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const speakerEmail = safeString(speakerSnap.get('email')).trim();
    if (speakerSnap.exists && speakerEmail && !existingLog.exists) {
      const speakerLocale: EmailLocale = speakerSnap.get('locale') === 'fr' ? 'fr' : 'en';
      const speakerName =
        safeString(speakerSnap.get('name')).trim() || current.speakerName || speakerEmail;
      const effectiveTitle = decision === 'approve' ? proposed.title : current.before.title;
      const copy = renderSpeakerResolutionCopy(
        decision,
        effectiveTitle,
        speakerLocale,
        decision === 'reject' ? rawRejectionNote : undefined,
      );
      tx.create(logRef, {
        kind: MESSAGE_KIND,
        proposalId,
        dedupeKey: `session_${decision}_${requestId}`,
        recipientUid: current.speakerUid,
        subject: copy.subject,
        body: copy.body,
        to: speakerEmail,
        locale: speakerLocale,
        data: {
          speakerName,
          title: effectiveTitle,
          needsVisa: false,
        },
        status: 'queued' satisfies EmailStatus,
        attempts: 0,
        byUid: identity.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const updatedSummary: SessionUpdateRequestSummary = {
      ...current,
      status: nextStatus,
      resolvedAt: nowMillis,
      resolvedBy: identity.uid,
      ...(decision === 'reject' && rawRejectionNote ? { rejectionNote: rawRejectionNote } : {}),
    };

    return {
      request: updatedSummary,
      scheduleNeedsAttention: decision === 'approve' && schedule.exists,
    };
  });

  logger.info('session update request resolved', {
    cfpId,
    proposalId,
    requestId,
    decision,
    byUid: identity.uid,
    scheduleNeedsAttention: result.scheduleNeedsAttention,
  });

  return { ok: true, ...result };
});

/**
 * Lists session update requests for the speaker's own sessions and (when the
 * caller is an event admin/owner) all pending session update requests for the CFP.
 */
export const listSessionUpdateRequests = onCall(CALLABLE, async (request) => {
  const identity = requireIdentity(request);
  const cfpId = requireCfpInput(request.data);
  const db = getFirestore();
  const [cfp, member] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/members/${identity.uid}`),
  );
  if (!cfp.exists) throw new HttpsError('not-found', 'No such call for proposals.');
  if (cfp.get('deleting') === true) {
    throw new HttpsError('failed-precondition', 'This call for proposals is being deleted.');
  }
  if (cfp.get('archived') === true) return { ok: true, own: [], admin: [] };

  const eventAdmin = isEventAdmin(member);
  const collectionRef = db.collection(`cfps/${cfpId}/sessionUpdateRequests`);
  const requestSnap = eventAdmin
    ? await collectionRef.get()
    : await collectionRef.where('speakerUid', '==', identity.uid).get();

  const summaries = requestSnap.docs.flatMap((doc) => {
    const summary = sessionUpdateSummaryFrom(doc);
    return summary && summary.status !== 'cancelled' ? [summary] : [];
  });
  if (summaries.length === 0) return { ok: true, own: [], admin: [] };

  const proposalRefs = summaries.map((item) =>
    db.doc(`cfps/${cfpId}/proposals/${item.proposalId}`),
  );
  const proposals = await db.getAll(...proposalRefs);
  const proposalMap = new Map(proposals.map((snap) => [snap.id, snap]));

  const valid = summaries.filter((item) => {
    const proposal = proposalMap.get(item.proposalId);
    if (!proposal?.exists) return false;
    const status = safeString(proposal.get('status'));
    if (status !== 'confirmed' && status !== 'accepted') return false;
    return primarySpeakerId(proposal.data()!) === item.speakerUid;
  });

  return {
    ok: true,
    own: valid.filter((item) => item.speakerUid === identity.uid),
    admin: eventAdmin ? valid.filter((item) => item.status === 'pending') : [],
  };
});
