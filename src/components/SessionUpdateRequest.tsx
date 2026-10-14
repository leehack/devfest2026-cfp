import { useEffect, useId, useRef, useState } from 'react';

import { LIMITS, type DeliveryLanguage } from '@shared/enums';
import { sessionUpdateSchema } from '@shared/schema';
import { labelOf, type SubmissionForm } from '@shared/submissionForm';
import type {
  SessionUpdateChange,
  SessionUpdateField,
  SessionUpdateFields,
  SessionUpdateRequestSummary,
} from '@shared/types';

import { useI18n } from '../i18n/context';
import { validationMessage } from '../i18n/validation';
import { invalidateCache } from '../lib/cache';
import {
  cancelSessionUpdateRequest,
  resolveSessionUpdateRequest,
  submitSessionUpdateRequest,
} from '../lib/sessionUpdateRequests';
function Counter({ value, min, max }: { value: string; min?: number; max: number }) {
  const { t } = useI18n();
  const len = value.trim().length;
  const text =
    min && len < min ? t.form.charsNeeded(min - len) : t.form.charsRemaining(max - value.length);
  return <span className="field__meta">{text}</span>;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '');
}

function errorReason(error: unknown): string {
  return String(
    (error as { details?: { reason?: unknown } } | null)?.details?.reason ?? '',
  );
}

function formatFieldLabel(
  field: SessionUpdateField,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const labels: Record<SessionUpdateField, string> = {
    title: t.proposal.title,
    abstract: t.proposal.abstract,
    category: t.proposal.category,
    level: t.proposal.level,
    deliveryLanguage: t.language.delivery,
    languagePreference: t.language.preference,
  };
  return labels[field];
}

function formatFieldValue(
  field: SessionUpdateField,
  value: string | null | undefined,
  form: SubmissionForm,
  locale: 'en' | 'fr',
  t: ReturnType<typeof useI18n>['t'],
): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return t.sessionUpdate.notProvided;
  if (field === 'category') return labelOf(form.category, trimmed, locale);
  if (field === 'level') return labelOf(form.level, trimmed, locale);
  if (field === 'deliveryLanguage') return labelOf(form.deliveryLanguage, trimmed, locale);
  return trimmed;
}

function SessionUpdateChangesList({
  changes,
  form,
}: {
  changes: SessionUpdateChange[];
  form: SubmissionForm;
}) {
  const { t, locale } = useI18n();
  if (changes.length === 0) return null;
  return (
    <dl className="profile-snapshot-refresh__changes">
      {changes.map((change) => (
        <div key={change.field} className="profile-snapshot-refresh__change">
          <dt>{formatFieldLabel(change.field, t)}</dt>
          <dd>
            <div>
              <span>{t.sessionUpdate.currentValue}</span>
              <p>{formatFieldValue(change.field, change.before, form, locale, t)}</p>
            </div>
            <div>
              <span>{t.sessionUpdate.proposedValue}</span>
              <p>{formatFieldValue(change.field, change.after, form, locale, t)}</p>
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SessionUpdateRequestCard({
  cfpId,
  proposalId,
  currentFields,
  submissionForm,
  request,
  disabled = false,
  onRequestUpdated,
}: {
  cfpId: string;
  proposalId: string;
  currentFields: SessionUpdateFields;
  submissionForm: SubmissionForm;
  request: SessionUpdateRequestSummary | null;
  disabled?: boolean;
  onRequestUpdated: (request: SessionUpdateRequestSummary | null) => void;
}) {
  const { t, locale } = useI18n();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SessionUpdateFields>(currentFields);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SessionUpdateField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setEditing(false);
    setFieldErrors({});
    setNotice('');
    setError('');
  }, [cfpId, proposalId]);

  function openEditor() {
    const seed = request?.status === 'pending' ? request.proposed : currentFields;
    setDraft({
      title: seed.title,
      abstract: seed.abstract,
      category: seed.category,
      level: seed.level,
      deliveryLanguage: seed.deliveryLanguage,
      languagePreference: seed.languagePreference ?? '',
    });
    setFieldErrors({});
    setError('');
    setNotice('');
    setEditing(true);
  }

  function closeEditor() {
    setEditing(false);
    setFieldErrors({});
    setError('');
  }

  async function handleSubmit() {
    setError('');
    setNotice('');
    const candidate: SessionUpdateFields = {
      title: draft.title,
      abstract: draft.abstract,
      category: draft.category,
      level: draft.level,
      deliveryLanguage: draft.deliveryLanguage,
      ...(draft.deliveryLanguage === 'either' && draft.languagePreference?.trim()
        ? { languagePreference: draft.languagePreference.trim() }
        : {}),
    };
    const parsed = sessionUpdateSchema(submissionForm).safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: Partial<Record<SessionUpdateField, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as SessionUpdateField | undefined;
        if (key && !nextErrors[key]) {
          nextErrors[key] = validationMessage(issue, t);
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const { data } = await submitSessionUpdateRequest({
        cfpId,
        proposalId,
        proposed: parsed.data as SessionUpdateFields,
      });
      invalidateCache('myProposals');
      onRequestUpdated(data.request);
      setEditing(false);
      setNotice(t.sessionUpdate.requestSubmitted);
    } catch (submitError) {
      if (errorReason(submitError) === 'session-update-unchanged') {
        setError(t.sessionUpdate.unchangedError);
      } else if (errorCode(submitError) === 'unauthenticated') {
        setError(t.errors.signedOut);
      } else if (errorCode(submitError) === 'permission-denied') {
        setError(t.nav.forbidden);
      } else {
        setError(t.sessionUpdate.failedError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!request || request.status !== 'pending') return;
    if (!window.confirm(t.sessionUpdate.cancelConfirm)) return;
    setCancelling(true);
    setError('');
    setNotice('');
    try {
      await cancelSessionUpdateRequest({
        cfpId,
        proposalId,
        requestId: request.requestId,
      });
      invalidateCache('myProposals');
      onRequestUpdated(null);
      setEditing(false);
      setNotice(t.sessionUpdate.requestCancelled);
    } catch {
      setError(t.sessionUpdate.failedError);
    } finally {
      setCancelling(false);
    }
  }

  const busy = submitting || cancelling || disabled;

  return (
    <section
      className="section profile-snapshot-refresh session-update-request"
      aria-labelledby={`${formId}-heading`}
    >
      <div className="profile-snapshot-refresh__bar">
        <div>
          <span className="profile-snapshot-refresh__eyebrow">{t.sessionUpdate.eyebrow}</span>
          <h3 id={`${formId}-heading`}>{t.sessionUpdate.title}</h3>
          <p className="field__help">{t.sessionUpdate.help}</p>
        </div>
        {!editing && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={openEditor}
          >
            {request?.status === 'pending'
              ? t.sessionUpdate.editRequest
              : t.sessionUpdate.openForm}
          </button>
        )}
      </div>

      {request && request.status === 'pending' && !editing && (
        <div className="profile-snapshot-refresh__request-banner" role="status">
          <div className="profile-snapshot-refresh__header">
            <div>
              <strong>{t.sessionUpdate.statusPending}</strong>
              <p className="field__help">{t.sessionUpdate.pendingHelp}</p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={busy}
              onClick={() => void handleCancel()}
            >
              {cancelling ? t.sessionUpdate.cancellingRequest : t.sessionUpdate.cancelRequest}
            </button>
          </div>
          <SessionUpdateChangesList changes={request.changes} form={submissionForm} />
        </div>
      )}

      {request && request.status === 'approved' && !editing && (
        <div
          className="profile-snapshot-refresh__request-banner profile-snapshot-refresh__request-banner--resolved"
          role="status"
        >
          <strong>{t.sessionUpdate.statusApproved}</strong>
          <p className="field__help">{t.sessionUpdate.approvedHelp}</p>
        </div>
      )}

      {request && request.status === 'rejected' && !editing && (
        <div className="profile-snapshot-refresh__request-banner" role="status">
          <strong>{t.sessionUpdate.statusRejected}</strong>
          <p className="field__help">{t.sessionUpdate.rejectedHelp}</p>
          {request.rejectionNote && (
            <p className="field__help">
              <strong>{t.sessionUpdate.rejectionNoteLabel}:</strong> {request.rejectionNote}
            </p>
          )}
        </div>
      )}

      {editing && (
        <div className="profile-snapshot-refresh__review" aria-labelledby={`${formId}-heading`}>
          <div className="field">
            <div className="field__row">
              <label className="field__label" htmlFor={`${formId}-title`}>
                {t.proposal.title}
              </label>
              <Counter value={draft.title} max={LIMITS.title} />
            </div>
            <input
              id={`${formId}-title`}
              className="field__input"
              type="text"
              maxLength={LIMITS.title}
              value={draft.title}
              disabled={busy}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
            {fieldErrors.title && (
              <p className="field__error" role="alert">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div className="field">
            <div className="field__row">
              <label className="field__label" htmlFor={`${formId}-abstract`}>
                {t.proposal.abstract}
              </label>
              <Counter value={draft.abstract} min={LIMITS.abstractMin} max={LIMITS.abstractMax} />
            </div>
            <textarea
              id={`${formId}-abstract`}
              className="field__input field__input--textarea"
              rows={5}
              maxLength={LIMITS.abstractMax}
              value={draft.abstract}
              disabled={busy}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, abstract: event.target.value }))
              }
            />
            {fieldErrors.abstract && (
              <p className="field__error" role="alert">
                {fieldErrors.abstract}
              </p>
            )}
          </div>

          <div className="field-grid">
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-category`}>
                {t.proposal.category}
              </label>
              <select
                id={`${formId}-category`}
                className="field__input field__input--select"
                value={draft.category}
                disabled={busy}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, category: event.target.value }))
                }
              >
                {submissionForm.category.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label[locale]}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <p className="field__error" role="alert">
                  {fieldErrors.category}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${formId}-level`}>
                {t.proposal.level}
              </label>
              <select
                id={`${formId}-level`}
                className="field__input field__input--select"
                value={draft.level}
                disabled={busy}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, level: event.target.value }))
                }
              >
                {submissionForm.level.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label[locale]}
                  </option>
                ))}
              </select>
              {fieldErrors.level && (
                <p className="field__error" role="alert">
                  {fieldErrors.level}
                </p>
              )}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={`${formId}-language`}>
              {t.language.delivery}
            </label>
            <select
              id={`${formId}-language`}
              className="field__input field__input--select"
              value={draft.deliveryLanguage}
              disabled={busy}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  deliveryLanguage: event.target.value as DeliveryLanguage,
                }))
              }
            >
              {submissionForm.deliveryLanguage.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label[locale]}
                </option>
              ))}
            </select>
            {fieldErrors.deliveryLanguage && (
              <p className="field__error" role="alert">
                {fieldErrors.deliveryLanguage}
              </p>
            )}
          </div>

          {draft.deliveryLanguage === 'either' && (
            <div className="field">
              <div className="field__row">
                <label className="field__label" htmlFor={`${formId}-language-pref`}>
                  {t.language.preference}
                </label>
                <Counter
                  value={draft.languagePreference ?? ''}
                  max={LIMITS.languagePreferenceMax}
                />
              </div>
              <p className="field__help">{t.language.preferenceHelp}</p>
              <input
                id={`${formId}-language-pref`}
                className="field__input"
                type="text"
                maxLength={LIMITS.languagePreferenceMax}
                value={draft.languagePreference ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, languagePreference: event.target.value }))
                }
              />
              {fieldErrors.languagePreference && (
                <p className="field__error" role="alert">
                  {fieldErrors.languagePreference}
                </p>
              )}
            </div>
          )}

          <div className="profile-snapshot-refresh__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {submitting ? t.sessionUpdate.submittingRequest : t.sessionUpdate.submitRequest}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={closeEditor}
            >
              {t.sessionUpdate.closeForm}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="profile-snapshot-refresh__notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function SessionUpdateQueue({
  requests,
  onReview,
}: {
  requests: SessionUpdateRequestSummary[];
  onReview: (request: SessionUpdateRequestSummary) => void;
}) {
  const { t } = useI18n();
  if (requests.length === 0) return null;

  return (
    <section
      className="section profile-request-queue session-update-queue"
      aria-labelledby="session-update-queue-title"
    >
      <div className="profile-request-queue__heading">
        <div>
          <span className="profile-request-queue__eyebrow">
            {t.sessionUpdate.adminQueueEyebrow}
          </span>
          <h2 id="session-update-queue-title">{t.sessionUpdate.adminQueueTitle}</h2>
          <p className="section__help">{t.sessionUpdate.adminQueueHelp}</p>
        </div>
        <div
          className="profile-request-queue__counts"
          aria-label={t.sessionUpdate.adminQueueTitle}
        >
          <span className="profile-attention profile-attention--ready">
            {t.sessionUpdate.adminQueueCount(requests.length)}
          </span>
        </div>
      </div>

      <ul className="profile-request-queue__list">
        {requests.map((request) => (
          <li key={`${request.proposalId}:${request.generation}`}>
            <span className="profile-request-queue__state profile-request-queue__state--ready">
              {t.sessionUpdate.statusPending}
            </span>
            <span className="profile-request-queue__identity">
              <strong>{request.speakerName || '—'}</strong>
              <span>{request.before.title || request.proposed.title}</span>
            </span>
            <span className="profile-request-queue__scopes">
              {request.changes.map((change) => formatFieldLabel(change.field, t)).join(' · ')}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onReview(request)}
            >
              {t.sessionUpdate.reviewButton}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionUpdateReviewDialog({
  cfpId,
  request,
  submissionForm,
  onResolved,
  onClose,
}: {
  cfpId: string;
  request: SessionUpdateRequestSummary;
  submissionForm: SubmissionForm;
  onResolved: (
    request: SessionUpdateRequestSummary,
    decision: 'approve' | 'reject',
    scheduleNeedsAttention: boolean,
  ) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [resolving, setResolving] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !resolving) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, resolving]);

  async function decide(decision: 'approve' | 'reject') {
    setResolving(decision);
    setError('');
    try {
      const { data } = await resolveSessionUpdateRequest({
        cfpId,
        proposalId: request.proposalId,
        requestId: request.requestId,
        decision,
        ...(decision === 'reject' && rejectionNote.trim()
          ? { rejectionNote: rejectionNote.trim() }
          : {}),
      });
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache(`reviewQueue:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache('myProposals');
      onResolved(data.request, decision, data.scheduleNeedsAttention);
    } catch {
      setError(t.sessionUpdate.failedError);
    } finally {
      setResolving(null);
    }
  }

  return (
    <div
      className="proposal-detail-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !resolving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="proposal-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="proposal-detail-dialog__header">
          <div>
            <span className="proposal-detail-dialog__eyebrow">
              {t.sessionUpdate.adminQueueEyebrow}
            </span>
            <h2 id={titleId}>
              {t.sessionUpdate.reviewTitle(request.before.title || request.proposed.title)}
            </h2>
            {request.speakerName && (
              <p className="proposal-detail-dialog__speakers">
                {t.sessionUpdate.requestedBy(request.speakerName)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={resolving !== null}
            onClick={onClose}
          >
            {t.admin.detailClose}
          </button>
        </div>

        <SessionUpdateChangesList changes={request.changes} form={submissionForm} />

        <div className="field">
          <label className="field__label" htmlFor={noteId}>
            {t.sessionUpdate.rejectionNoteField}
          </label>
          <textarea
            id={noteId}
            className="field__input field__input--textarea"
            rows={2}
            maxLength={500}
            placeholder={t.sessionUpdate.rejectionNotePlaceholder}
            value={rejectionNote}
            disabled={resolving !== null}
            onChange={(event) => setRejectionNote(event.target.value)}
          />
        </div>

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}

        <div className="profile-snapshot-refresh__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={resolving !== null}
            onClick={() => void decide('approve')}
          >
            {resolving === 'approve' ? t.sessionUpdate.approving : t.sessionUpdate.approve}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={resolving !== null}
            onClick={() => void decide('reject')}
          >
            {resolving === 'reject' ? t.sessionUpdate.rejecting : t.sessionUpdate.reject}
          </button>
        </div>
      </div>
    </div>
  );
}
