import { useEffect, useId, useRef, useState } from 'react';

import type {
  Social,
  SpeakerProfileUpdateRequestState,
  SpeakerSnapshot,
} from '@shared/types';

import { useI18n } from '../i18n/context';
import { invalidateCache } from '../lib/cache';
import {
  cancelProposalSpeakerProfileUpdate,
  completeProposalSpeakerProfileUpdate,
  previewProposalSpeakerProfile,
  refreshProposalSpeakerSnapshot,
  requestProposalSpeakerProfileUpdate,
  type ProposalSpeakerProfileField,
  type ProposalSpeakerProfilePreview,
  type ProposalSpeakerProfileScope,
} from '../lib/proposals';

interface RefreshResult {
  changed: boolean;
  speakerUid: string;
  snapshot: SpeakerSnapshot;
  scheduleNeedsAttention: boolean;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '');
}

function profileError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  const code = errorCode(error);
  return code === 'unauthenticated'
    ? t.errors.signedOut
    : code === 'permission-denied'
      ? t.nav.forbidden
      : code === 'failed-precondition'
        ? t.profileSnapshot.notReady
        : code === 'aborted'
          ? t.profileSnapshot.reviewChanged
        : t.profileSnapshot.failed;
}

function fieldLabel(
  field: ProposalSpeakerProfileField,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const labels: Record<ProposalSpeakerProfileField, string> = {
    name: t.speaker.name,
    bio: t.speaker.bio,
    company: t.speaker.company,
    jobTitle: t.speaker.jobTitle,
    basedIn: t.speaker.basedIn,
    socials: t.speaker.socials,
    isGde: t.profileSnapshot.gdeLabel,
    pastTalks: t.speaker.pastTalks,
    sessionizeUrl: t.speaker.sessionizeUrl,
  };
  return labels[field];
}

function socialValue(value: Social[], t: ReturnType<typeof useI18n>['t']): string {
  return value
    .map((social) => `${t.enums.socialPlatform[social.platform]} · ${social.handle}`)
    .join('\n');
}

function displayValue(
  field: ProposalSpeakerProfileField,
  value: unknown,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (field === 'isGde') return value === true ? t.profileSnapshot.yes : t.profileSnapshot.no;
  if (field === 'socials' && Array.isArray(value)) {
    const socials = value.filter(
      (item): item is Social =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.platform === 'string' &&
        typeof item.handle === 'string',
    );
    return socials.length > 0 ? socialValue(socials, t) : t.profileSnapshot.notProvided;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  return text || t.profileSnapshot.notProvided;
}

function previewFingerprint(preview: ProposalSpeakerProfilePreview): string {
  return JSON.stringify({
    current: preview.current,
    latest: preview.latest,
    changes: preview.changes,
    photo: preview.photo,
  });
}

export function ProfileSnapshotRefresh({
  cfpId,
  proposalId,
  speakerUid,
  speakerName,
  compact = false,
  disabled = false,
  canRequestUpdate = false,
  showRequestState = false,
  requestRefreshKey = 0,
  beforeRefresh,
  onEditProfile,
  onEditPhoto,
  autoOpen = false,
  onRequestChanged,
  onRefreshed,
}: {
  cfpId: string;
  proposalId: string;
  speakerUid?: string;
  speakerName?: string;
  compact?: boolean;
  disabled?: boolean;
  canRequestUpdate?: boolean;
  showRequestState?: boolean;
  requestRefreshKey?: number;
  beforeRefresh?: () => Promise<boolean>;
  onEditProfile?: () => void;
  onEditPhoto?: () => void;
  autoOpen?: boolean;
  onRequestChanged?: (request: SpeakerProfileUpdateRequestState) => void;
  onRefreshed?: (result: RefreshResult) => void;
}) {
  const { t } = useI18n();
  const reviewId = useId();
  const tRef = useRef(t);
  const beforeRefreshRef = useRef(beforeRefresh);
  const requestSequence = useRef(0);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const requestButton = useRef<HTMLButtonElement>(null);
  const adminRequestStatus = useRef<HTMLDivElement>(null);
  const speakerRequestStatus = useRef<HTMLElement>(null);
  const autoOpenedTarget = useRef('');
  const [preview, setPreview] = useState<ProposalSpeakerProfilePreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState(false);
  const [error, setError] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestScopes, setRequestScopes] = useState<ProposalSpeakerProfileScope[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [requestNotice, setRequestNotice] = useState('');

  tRef.current = t;
  beforeRefreshRef.current = beforeRefresh;

  async function fetchPreview({ prepare = false, focus = false } = {}) {
    const sequence = ++requestSequence.current;
    setLoadingPreview(true);
    setError('');
    setNotice('');
    try {
      if (prepare && beforeRefreshRef.current && !(await beforeRefreshRef.current())) return null;
      const { data } = await previewProposalSpeakerProfile({
        cfpId,
        proposalId,
        ...(speakerUid ? { speakerUid } : {}),
      });
      if (sequence !== requestSequence.current) return null;
      setPreview(data);
      if (focus) {
        requestAnimationFrame(() => reviewPanel.current?.focus({ preventScroll: true }));
      }
      return data;
    } catch (previewError) {
      if (sequence === requestSequence.current) {
        setError(profileError(previewError, tRef.current));
      }
      return null;
    } finally {
      if (sequence === requestSequence.current) setLoadingPreview(false);
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    setPreview(null);
    setReviewOpen(false);
    setRequestOpen(false);
    setRequestScopes([]);
    setNotice('');
    setRequestNotice('');
    setScheduleNotice(false);
    setError('');
  }, [cfpId, proposalId, speakerUid]);

  useEffect(() => {
    if (!autoOpen) return;
    const target = `${cfpId}:${proposalId}:${speakerUid ?? ''}`;
    if (autoOpenedTarget.current === target) return;
    autoOpenedTarget.current = target;
    requestAnimationFrame(() => reviewButton.current?.click());
  }, [autoOpen, cfpId, proposalId, speakerUid]);

  useEffect(() => {
    if (!showRequestState) return;
    let cancelled = false;
    const sequence = ++requestSequence.current;
    setLoadingPreview(true);
    void previewProposalSpeakerProfile({
      cfpId,
      proposalId,
      ...(speakerUid ? { speakerUid } : {}),
    })
      .then(({ data }) => {
        if (!cancelled && sequence === requestSequence.current) setPreview(data);
      })
      .catch((previewError) => {
        if (!cancelled && sequence === requestSequence.current) {
          setError(profileError(previewError, tRef.current));
        }
      })
      .finally(() => {
        if (!cancelled && sequence === requestSequence.current) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, proposalId, requestRefreshKey, showRequestState, speakerUid]);

  async function review() {
    setReviewOpen(true);
    setRequestOpen(false);
    setRequestNotice('');
    await fetchPreview({ prepare: true, focus: true });
  }

  function closeReview() {
    setReviewOpen(false);
    setRequestOpen(false);
    requestAnimationFrame(() => reviewButton.current?.focus({ preventScroll: true }));
  }

  async function apply() {
    if (!preview || preview.changes.length === 0) return;
    setApplying(true);
    setNotice('');
    setScheduleNotice(false);
    setError('');
    try {
      if (beforeRefreshRef.current && !(await beforeRefreshRef.current())) return;
      const { data: fresh } = await previewProposalSpeakerProfile({
        cfpId,
        proposalId,
        ...(speakerUid ? { speakerUid } : {}),
      });
      if (previewFingerprint(fresh) !== previewFingerprint(preview)) {
        setPreview(fresh);
        setNotice(t.profileSnapshot.reviewChanged);
        requestAnimationFrame(() => reviewPanel.current?.focus({ preventScroll: true }));
        return;
      }
      const { data } = await refreshProposalSpeakerSnapshot({
        cfpId,
        proposalId,
        expectedCurrentFingerprint: fresh.currentFingerprint,
        expectedLatestFingerprint: fresh.latestFingerprint,
        ...(speakerUid ? { speakerUid } : {}),
      });
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache(`reviewQueue:${cfpId}`);
      invalidateCache('myProposals');
      setNotice(data.changed ? t.profileSnapshot.updated : t.profileSnapshot.unchanged);
      setScheduleNotice(data.scheduleNeedsAttention);
      onRefreshed?.(data);
      const next = await previewProposalSpeakerProfile({
        cfpId,
        proposalId,
        ...(speakerUid ? { speakerUid } : {}),
      });
      setPreview(next.data);
      closeReview();
    } catch (refreshError) {
      if (errorCode(refreshError) === 'aborted') {
        await fetchPreview({ focus: true });
        setNotice(t.profileSnapshot.reviewChanged);
      } else {
        setError(profileError(refreshError, t));
      }
    } finally {
      setApplying(false);
    }
  }

  function openRequest() {
    if (!preview) return;
    const suggested: ProposalSpeakerProfileScope =
      preview.changes.length > 0 || !preview.photo.enabled ? 'profile' : 'photo';
    setRequestScopes([suggested]);
    setRequestNotice('');
    setRequestOpen(true);
    requestAnimationFrame(() =>
      reviewPanel.current
        ?.querySelector<HTMLInputElement>('input:not(:disabled)')
        ?.focus({ preventScroll: true }),
    );
  }

  function closeRequestForm() {
    setRequestOpen(false);
    requestAnimationFrame(() => requestButton.current?.focus({ preventScroll: true }));
  }

  function toggleScope(scope: ProposalSpeakerProfileScope, checked: boolean) {
    setRequestScopes((current) =>
      checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope),
    );
  }

  async function sendRequest() {
    if (!speakerUid || requestScopes.length === 0) return;
    setRequesting(true);
    setError('');
    setRequestNotice('');
    try {
      const { data } = await requestProposalSpeakerProfileUpdate({
        cfpId,
        proposalId,
        speakerUid,
        scopes: requestScopes,
      });
      setPreview((current) =>
        current
          ? {
              ...current,
              request: {
                ...data.request,
                resolvedScopes: data.request.resolvedScopes ?? [],
              },
            }
          : current,
      );
      onRequestChanged?.(data.request);
      setRequestNotice(
        data.created
          ? t.profileSnapshot.requestCreated
          : t.profileSnapshot.requestAlreadyPending,
      );
      setRequestOpen(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          adminRequestStatus.current?.focus({ preventScroll: true }),
        ),
      );
    } catch (requestError) {
      setError(profileError(requestError, t));
    } finally {
      setRequesting(false);
    }
  }

  async function cancelRequest() {
    if (!speakerUid || !pendingRequest) return;
    if (!window.confirm(t.profileSnapshot.cancelRequestConfirm)) return;
    setCancelling(true);
    setError('');
    setRequestNotice('');
    try {
      const { data } = await cancelProposalSpeakerProfileUpdate({
        cfpId,
        proposalId,
        speakerUid,
        requestId: pendingRequest.requestId,
      });
      setPreview((current) => (current ? { ...current, request: data.request } : current));
      onRequestChanged?.(data.request);
      setRequestNotice(t.profileSnapshot.requestCancelled);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          requestButton.current?.focus({ preventScroll: true }),
        ),
      );
    } catch (requestError) {
      setError(profileError(requestError, t));
    } finally {
      setCancelling(false);
    }
  }

  async function copySessionLink() {
    const url = new URL(`/c/${encodeURIComponent(cfpId)}/submit`, window.location.origin);
    url.searchParams.set('proposal', proposalId);
    setError('');
    setRequestNotice('');
    try {
      await navigator.clipboard.writeText(url.toString());
      setRequestNotice(t.profileSnapshot.sessionLinkCopied);
    } catch {
      setError(t.profileSnapshot.sessionLinkCopyFailed);
    }
  }

  async function completeRequest() {
    if (!pendingRequest) return;
    setCompleting(true);
    setError('');
    setRequestNotice('');
    try {
      if (beforeRefreshRef.current && !(await beforeRefreshRef.current())) return;
      const { data } = await completeProposalSpeakerProfileUpdate({
        cfpId,
        proposalId,
        requestId: pendingRequest.requestId,
      });
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache('myProposals');
      setPreview((current) => (current ? { ...current, request: data.request } : current));
      onRequestChanged?.(data.request);
      setRequestNotice(
        data.remainingScopes.length > 0
          ? t.profileSnapshot.requestPartlyComplete
          : t.profileSnapshot.requestCompleted,
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          speakerRequestStatus.current?.focus({ preventScroll: true }),
        ),
      );
    } catch (requestError) {
      const details = (requestError as { details?: { reason?: unknown } } | null)?.details;
      if (details?.reason === 'profile-update-not-ready') {
        setError(t.profileSnapshot.requestNotReady);
      } else {
        setError(profileError(requestError, t));
      }
    } finally {
      setCompleting(false);
    }
  }

  const busy = loadingPreview || applying || requesting || cancelling || completing;
  const pendingRequest = preview?.request?.status === 'pending' ? preview.request : null;
  const resolvedRequest = preview?.request?.status === 'resolved' ? preview.request : null;
  const unresolvedScopes = pendingRequest
    ? pendingRequest.scopes.filter((scope) => !pendingRequest.resolvedScopes.includes(scope))
    : [];
  const requestableScopes: ProposalSpeakerProfileScope[] = preview?.photo.enabled
    ? ['profile', 'photo']
    : ['profile'];

  return (
    <div className={`profile-snapshot-refresh${compact ? ' profile-snapshot-refresh--compact' : ''}`}>
      {!compact && (
        <div className="profile-snapshot-refresh__copy">
          <h3>{t.profileSnapshot.title}</h3>
          <p>{t.profileSnapshot.help}</p>
        </div>
      )}

      {showRequestState && pendingRequest && (
        <aside
          ref={speakerRequestStatus}
          className="profile-update-request profile-update-request--pending"
          role="status"
          tabIndex={-1}
        >
          <div className="profile-update-request__heading">
            <span className="profile-update-request__eyebrow">
              {t.profileSnapshot.requestEyebrow}
            </span>
            <strong>{t.profileSnapshot.requestPendingTitle}</strong>
          </div>
          <p>{t.profileSnapshot.requestPendingHelp}</p>
          <ul className="profile-update-request__scopes" aria-label={t.profileSnapshot.requestedItems}>
            {unresolvedScopes.map((scope) => (
              <li key={scope}>{t.profileSnapshot.scope[scope]}</li>
            ))}
          </ul>
          <ol className="profile-update-request__steps">
            <li>{t.profileSnapshot.requestStepEdit}</li>
            <li>{t.profileSnapshot.requestStepAdopt}</li>
            <li>{t.profileSnapshot.requestStepPublish}</li>
          </ol>
          <div className="profile-update-request__actions">
            {unresolvedScopes.includes('profile') && onEditProfile && (
              <button type="button" className="btn btn--primary btn--small" onClick={onEditProfile}>
                {t.profileSnapshot.editProfile}
              </button>
            )}
            {unresolvedScopes.includes('photo') && onEditPhoto && (
              <button type="button" className="btn btn--primary btn--small" onClick={onEditPhoto}>
                {t.profileSnapshot.editPhoto}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={disabled || busy}
              onClick={() => void completeRequest()}
            >
              {completing
                ? t.profileSnapshot.completingRequest
                : t.profileSnapshot.completeRequest}
            </button>
          </div>
          <p className="profile-update-request__complete-help">
            {t.profileSnapshot.completeRequestHelp}
          </p>
        </aside>
      )}

      {showRequestState && resolvedRequest && (
        <aside
          ref={speakerRequestStatus}
          className="profile-update-request profile-update-request--resolved"
          role="status"
          tabIndex={-1}
        >
          <strong>{t.profileSnapshot.requestResolvedTitle}</strong>
          <p>{t.profileSnapshot.requestResolvedHelp}</p>
        </aside>
      )}

      <button
        ref={reviewButton}
        type="button"
        className="btn btn--ghost btn--small"
        disabled={disabled || busy}
        aria-busy={loadingPreview || undefined}
        aria-expanded={reviewOpen}
        aria-controls={reviewOpen ? reviewId : undefined}
        onClick={() => void review()}
      >
        {loadingPreview
          ? t.profileSnapshot.reviewing
          : speakerUid
            ? t.profileSnapshot.reviewAdmin
            : t.profileSnapshot.reviewSelf}
      </button>

      {reviewOpen && (
        <div
          ref={reviewPanel}
          id={reviewId}
          className="profile-review"
          tabIndex={-1}
          aria-busy={busy || undefined}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeReview();
          }}
        >
          <div className="profile-review__header">
            <div>
              <span className="profile-review__eyebrow">{t.profileSnapshot.reviewEyebrow}</span>
              <h4>{t.profileSnapshot.reviewTitle(speakerName || preview?.latest.name || '')}</h4>
              <p>{t.profileSnapshot.reviewHelp}</p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={busy}
              onClick={closeReview}
            >
              {t.profileSnapshot.closeReview}
            </button>
          </div>

          {!loadingPreview && preview && (
            <>
              {preview.changes.length > 0 ? (
                <div className="profile-review__changes">
                  <div className="profile-review__columns" aria-hidden="true">
                    <span>{t.profileSnapshot.sessionCopy}</span>
                    <span>{t.profileSnapshot.latestProfile}</span>
                  </div>
                  <dl>
                    {preview.changes.map((change) => (
                      <div className="profile-review__change" key={change.field}>
                        <dt>{fieldLabel(change.field, t)}</dt>
                        <dd className="profile-review__before">
                          <span>{t.profileSnapshot.sessionCopy}</span>
                          {displayValue(change.field, change.before, t)}
                        </dd>
                        <dd className="profile-review__after">
                          <span>{t.profileSnapshot.latestProfile}</span>
                          {displayValue(change.field, change.after, t)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <div className="profile-review__empty" role="status">
                  <strong>{t.profileSnapshot.noChangesTitle}</strong>
                  <p>{t.profileSnapshot.noChangesHelp}</p>
                </div>
              )}

              {preview.photo.enabled && preview.photo.changed && (
                <aside className="profile-review__photo">
                  <div>
                    <strong>{t.profileSnapshot.photoChangedTitle}</strong>
                    <p>{t.profileSnapshot.photoChangedHelp}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>{t.profileSnapshot.sessionCopy}</dt>
                      <dd>{t.profileSnapshot.photoState[preview.photo.current]}</dd>
                    </div>
                    <div>
                      <dt>{t.profileSnapshot.latestProfile}</dt>
                      <dd>{t.profileSnapshot.photoState[preview.photo.latest]}</dd>
                    </div>
                  </dl>
                </aside>
              )}

              <div className="profile-review__actions">
                {preview.changes.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={disabled || busy}
                    onClick={() => void apply()}
                  >
                    {applying ? t.profileSnapshot.applying : t.profileSnapshot.apply}
                  </button>
                )}
                {canRequestUpdate && speakerUid && !pendingRequest && (
                  <button
                    ref={requestButton}
                    type="button"
                    className="btn btn--ghost"
                    disabled={disabled || busy}
                    aria-expanded={requestOpen}
                    onClick={openRequest}
                  >
                    {preview.request?.status === 'resolved' || preview.request?.status === 'cancelled'
                      ? t.profileSnapshot.requestAgain
                      : t.profileSnapshot.requestUpdate}
                  </button>
                )}
              </div>

              {pendingRequest && (
                <div
                  ref={adminRequestStatus}
                  className="profile-review__request-state"
                  role="status"
                  tabIndex={-1}
                >
                  <div>
                    <strong>{t.profileSnapshot.requestPendingAdmin}</strong>
                    <span>
                      {pendingRequest.scopes.map((scope) => t.profileSnapshot.scope[scope]).join(' · ')}
                    </span>
                    <p>{t.profileSnapshot.requestShareHelp}</p>
                  </div>
                  {canRequestUpdate && speakerUid && (
                    <div className="profile-review__request-state-actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        disabled={disabled || busy}
                        onClick={() => void copySessionLink()}
                      >
                        {t.profileSnapshot.copySessionLink}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled={disabled || busy}
                        onClick={() => void cancelRequest()}
                      >
                        {cancelling
                          ? t.profileSnapshot.cancellingRequest
                          : t.profileSnapshot.cancelPendingRequest}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {requestOpen && canRequestUpdate && speakerUid && (
                <div className="profile-review__request-form">
                  <fieldset>
                    <legend>{t.profileSnapshot.requestItems}</legend>
                    <p>{t.profileSnapshot.requestHelp}</p>
                    {requestableScopes.map((scope) => {
                      return (
                        <label key={scope}>
                          <input
                            type="checkbox"
                            checked={requestScopes.includes(scope)}
                            disabled={requesting}
                            onChange={(event) => toggleScope(scope, event.target.checked)}
                          />
                          <span>
                            <strong>{t.profileSnapshot.scope[scope]}</strong>
                            <small>{t.profileSnapshot.scopeHelp[scope]}</small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                  <p className="profile-review__delivery-note">
                    {t.profileSnapshot.requestInAppOnly}
                  </p>
                  <div className="profile-review__request-actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      disabled={disabled || requesting || requestScopes.length === 0}
                      onClick={() => void sendRequest()}
                    >
                      {requesting ? t.profileSnapshot.requesting : t.profileSnapshot.sendRequest}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={requesting}
                      onClick={closeRequestForm}
                    >
                      {t.profileSnapshot.cancelRequest}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="profile-snapshot-refresh__status" aria-live="polite">
        {notice && <span>{notice}</span>}
        {scheduleNotice && <span>{t.profileSnapshot.scheduleNotice}</span>}
        {requestNotice && <span>{requestNotice}</span>}
        {error && (
          <span className="field__error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
