import { useEffect, useRef, useState } from 'react';

import {
  MAX_ACTIVE_SPEAKERS,
  normaliseSpeakerEmail,
  type ProposalSpeakerRoster,
  type SpeakerRosterItem,
} from '@shared/coSpeakers';
import type { SpeakerProfileUpdateRequestState, SpeakerSnapshot } from '@shared/types';

import { useI18n } from '../i18n/context';
import { ProfileSnapshotRefresh } from './ProfileSnapshotRefresh';
import { friendlyError } from '../lib/errors';
import {
  inviteProposalSpeaker,
  loadProposalRoster,
  removeProposalSpeaker,
  retryProposalSpeakerInvitation,
  revokeProposalSpeakerInvitation,
} from '../lib/coSpeakers';

type RosterContext = 'speaker' | 'admin';

export interface CoSpeakerRosterProps {
  cfpId: string;
  proposalId: string;
  context?: RosterContext;
  readOnly?: boolean;
  refreshKey?: number;
  canRequestProfileUpdate?: boolean;
  autoReviewSpeakerUid?: string;
  onChange?: (roster: ProposalSpeakerRoster | null) => void;
  onProfileUpdateRequestChanged?: (
    speakerUid: string,
    request: SpeakerProfileUpdateRequestState,
  ) => void;
  onSnapshotRefreshed?: (speakerUid: string, snapshot: SpeakerSnapshot) => void;
  onLeft?: () => void;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
}

function itemLabel(item: SpeakerRosterItem): string {
  if (item.name.trim()) return item.name;
  if (item.email) return item.email;
  return '—';
}

function inviteError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
    .replace(/^functions\//, '')
    .toLowerCase();
  if (code === 'already-exists') return t.coSpeakers.alreadyInvited;
  if (code === 'resource-exhausted') return t.coSpeakers.inviteLimit;
  return friendlyError(error, t);
}

export function CoSpeakerRoster({
  cfpId,
  proposalId,
  context = 'speaker',
  readOnly = false,
  refreshKey = 0,
  canRequestProfileUpdate = false,
  autoReviewSpeakerUid,
  onChange,
  onProfileUpdateRequestChanged,
  onSnapshotRefreshed,
  onLeft,
}: CoSpeakerRosterProps) {
  const { t } = useI18n();
  const tRef = useRef(t);
  const onChangeRef = useRef(onChange);
  const loadedTarget = useRef('');
  const manualRefresh = useRef(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const inviteInput = useRef<HTMLInputElement>(null);
  const focusWhenIdle = useRef<'invite' | 'refresh' | null>(null);
  const [roster, setRoster] = useState<ProposalSpeakerRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviting, setInviting] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  tRef.current = t;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (
      inviting ||
      refreshing ||
      retrying !== null ||
      revoking !== null ||
      removing !== null ||
      focusWhenIdle.current === null
    ) {
      return;
    }
    const target = focusWhenIdle.current;
    focusWhenIdle.current = null;
    const element =
      target === 'invite'
        ? inviteInput.current ?? refreshButton.current
        : refreshButton.current;
    element?.focus({ preventScroll: true });
  }, [inviting, refreshing, retrying, revoking, removing]);

  useEffect(() => {
    let cancelled = false;
    const target = `${cfpId}:${proposalId}`;
    const initial = loadedTarget.current !== target;
    const announceRefresh = manualRefresh.current;
    manualRefresh.current = false;
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadFailed(false);
    setActionError('');
    void loadProposalRoster(cfpId, proposalId)
      .then((next) => {
        if (cancelled) return;
        loadedTarget.current = target;
        setRoster(next);
        onChangeRef.current?.(next);
        if (announceRefresh) {
          setNotice(tRef.current.coSpeakers.refreshed);
          focusWhenIdle.current = 'refresh';
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (initial) {
          setLoadFailed(true);
          setRoster(null);
          onChangeRef.current?.(null);
        } else {
          setActionError(tRef.current.coSpeakers.loadFailed);
          focusWhenIdle.current = 'refresh';
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (initial) setLoading(false);
          else setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cfpId, proposalId, refreshKey, reload]);

  function replaceRoster(next: ProposalSpeakerRoster) {
    setRoster(next);
    onChangeRef.current?.(next);
  }

  async function onInvite() {
    const address = normaliseSpeakerEmail(email);
    if (!address) {
      setEmailError(t.errors.email);
      return;
    }
    setEmailError('');
    setActionError('');
    setNotice('');
    setInviting(true);
    try {
      const next = await inviteProposalSpeaker(cfpId, proposalId, address);
      replaceRoster(next);
      setEmail('');
      setNotice(t.coSpeakers.invited(address));
      focusWhenIdle.current = 'invite';
    } catch (error) {
      setActionError(inviteError(error, t));
    } finally {
      setInviting(false);
    }
  }

  async function onRevoke(item: Extract<SpeakerRosterItem, { kind: 'invitation' }>) {
    const label = item.email ?? item.name;
    if (!window.confirm(t.coSpeakers.revokeConfirm(label))) return;
    setActionError('');
    setNotice('');
    setRevoking(item.invitationId);
    try {
      replaceRoster(
        await revokeProposalSpeakerInvitation(cfpId, proposalId, item.invitationId),
      );
      setNotice(t.coSpeakers.revokedNotice(label));
      focusWhenIdle.current = 'refresh';
    } catch (error) {
      setActionError(friendlyError(error, t));
    } finally {
      setRevoking(null);
    }
  }

  async function onRetryDelivery(
    item: Extract<SpeakerRosterItem, { kind: 'invitation' }>,
  ) {
    const label = item.email ?? item.name;
    setActionError('');
    setNotice('');
    setRetrying(item.invitationId);
    try {
      replaceRoster(
        await retryProposalSpeakerInvitation(cfpId, proposalId, item.invitationId),
      );
      setNotice(t.coSpeakers.deliveryRetried(label));
      focusWhenIdle.current = 'refresh';
    } catch (error) {
      setActionError(friendlyError(error, t));
    } finally {
      setRetrying(null);
    }
  }

  async function onRemove(item: Extract<SpeakerRosterItem, { kind: 'active' }>) {
    const label = itemLabel(item);
    const leaving = item.isCurrentUser && item.role === 'coSpeaker';
    if (!window.confirm(leaving ? t.coSpeakers.leaveConfirm : t.coSpeakers.removeConfirm(label))) {
      return;
    }
    setActionError('');
    setNotice('');
    setRemoving(item.uid);
    try {
      const next = await removeProposalSpeaker(cfpId, proposalId, item.uid);
      if (!next) {
        onChangeRef.current?.(null);
        onLeft?.();
        return;
      }
      replaceRoster(next);
      setNotice(leaving ? t.coSpeakers.leftNotice : t.coSpeakers.removedNotice(label));
      focusWhenIdle.current = 'refresh';
    } catch (error) {
      setActionError(friendlyError(error, t));
    } finally {
      setRemoving(null);
    }
  }

  if (loading) {
    return (
      <div className="co-speaker-roster co-speaker-roster--loading" aria-busy="true">
        <p className="muted">{t.coSpeakers.loading}</p>
      </div>
    );
  }

  if (loadFailed || !roster) {
    return (
      <div className="co-speaker-roster">
        <p className="field__error" role="alert">
          {t.coSpeakers.loadFailed}
        </p>
        <button type="button" className="btn btn--ghost" onClick={() => setReload((n) => n + 1)}>
          {t.coSpeakers.retry}
        </button>
      </div>
    );
  }

  const occupied = roster.items.filter(
    (item) => item.kind === 'active' || item.state === 'pending',
  ).length;
  const atCapacity = occupied >= MAX_ACTIVE_SPEAKERS;
  const actionBusy =
    inviting || retrying !== null || revoking !== null || removing !== null;
  const currentSpeaker = roster.items.find(
    (item): item is Extract<SpeakerRosterItem, { kind: 'active' }> =>
      item.kind === 'active' && item.isCurrentUser,
  );
  const currentSpeakerReady = Boolean(
    currentSpeaker?.profileComplete && currentSpeaker.detailsComplete,
  );
  const canManageInvitations = roster.canManage || roster.canInvite;
  const hasPendingLateInvitation = roster.items.some(
    (item) =>
      item.kind === 'invitation' &&
      item.phase === 'postAcceptance' &&
      item.state === 'pending',
  );

  return (
    <div className="co-speaker-roster">
      <p className="section__help">
        {context === 'admin'
          ? t.coSpeakers.adminHelp
          : roster.canEditTalk
            ? t.coSpeakers.help
            : t.coSpeakers.readOnlyHelp}
      </p>

      <div className="co-speaker-roster__toolbar">
        <button
          ref={refreshButton}
          type="button"
          className="btn btn--ghost btn--small"
          disabled={actionBusy || refreshing}
          aria-busy={refreshing || undefined}
          onClick={() => {
            manualRefresh.current = true;
            setNotice('');
            setReload((value) => value + 1);
          }}
        >
          {refreshing ? t.coSpeakers.refreshing : t.coSpeakers.refresh}
        </button>
      </div>

      {context === 'admin' && !readOnly && (
        <p className="section__help co-speaker-roster__profile-help">
          {t.profileSnapshot.adminHelp}
        </p>
      )}

      <ul className="co-speaker-list" aria-label={t.coSpeakers.title}>
        {roster.items.map((item) => {
          const label = itemLabel(item);
          const state =
            item.kind === 'active'
              ? item.role === 'primary'
                ? 'lead'
                : 'joined'
              : item.state;
          const stateLabel =
            state === 'lead'
              ? t.coSpeakers.lead
              : state === 'joined' || state === 'accepted'
                ? t.coSpeakers.joined
                : state === 'pending'
                  ? t.coSpeakers.pending
                  : state === 'declined'
                    ? t.coSpeakers.declined
                    : t.coSpeakers.revoked;
          return (
            <li key={item.kind === 'active' ? item.uid : item.invitationId} className="co-speaker-person">
              <span className="co-speaker-person__avatar" aria-hidden="true">
                {initials(label)}
              </span>
              <span className="co-speaker-person__identity">
                <strong>{label}</strong>
                {item.email && item.email !== label && (
                  <span className="co-speaker-person__email">{item.email}</span>
                )}
                {item.kind === 'invitation' && item.state === 'pending' && (
                  <span
                    className={`co-speaker-delivery co-speaker-delivery--${item.deliveryState}`}
                  >
                    {t.coSpeakers.deliveryState[item.deliveryState]}
                  </span>
                )}
              </span>
              <span className={`co-speaker-state co-speaker-state--${state}`}>
                {stateLabel}
              </span>
              {item.isCurrentUser && (
                <span className="co-speaker-person__you">{t.coSpeakers.currentAccount}</span>
              )}
              {context === 'admin' && item.kind === 'active' && !readOnly && (
                <ProfileSnapshotRefresh
                  compact
                  cfpId={cfpId}
                  proposalId={proposalId}
                  speakerUid={item.uid}
                  speakerName={label}
                  disabled={actionBusy}
                  canRequestUpdate={
                    canRequestProfileUpdate && item.confirmationState === 'confirmed'
                  }
                  autoOpen={autoReviewSpeakerUid === item.uid}
                  onRequestChanged={(request) =>
                    onProfileUpdateRequestChanged?.(item.uid, request)
                  }
                  onRefreshed={(result) => {
                    onSnapshotRefreshed?.(item.uid, result.snapshot);
                    setReload((value) => value + 1);
                  }}
                />
              )}
              {item.kind === 'active' && (roster.setupOpen || roster.confirmationOpen) && (
                <span className="co-speaker-readiness">
                  {roster.setupOpen && (
                    <>
                      <span className={item.profileComplete ? 'co-speaker-ready' : 'co-speaker-needed'}>
                        {item.profileComplete
                          ? t.coSpeakers.profileReadyLabel
                          : t.coSpeakers.profileNeeded}
                      </span>
                      <span className={item.detailsComplete ? 'co-speaker-ready' : 'co-speaker-needed'}>
                        {item.detailsComplete
                          ? t.coSpeakers.detailsReady
                          : t.coSpeakers.detailsNeeded}
                      </span>
                    </>
                  )}
                  {roster.confirmationOpen && (
                    <span>
                      {item.confirmationState === 'none'
                        ? t.coSpeakers.awaitingConfirmation
                        : t.enums.status[item.confirmationState]}
                    </span>
                  )}
                </span>
              )}
              {item.kind === 'active' && item.canRemove && !readOnly && (
                <button
                  type="button"
                  className="btn btn--ghost co-speaker-person__revoke"
                  disabled={actionBusy}
                  aria-label={
                    item.isCurrentUser && item.role === 'coSpeaker'
                      ? removing === item.uid
                        ? t.coSpeakers.leavingProposal
                        : t.coSpeakers.leaveProposal
                      : removing === item.uid
                        ? t.coSpeakers.removingSpeaker(label)
                        : t.coSpeakers.removeSpeaker(label)
                  }
                  onClick={() => void onRemove(item)}
                >
                  {item.isCurrentUser && item.role === 'coSpeaker'
                    ? removing === item.uid
                      ? t.coSpeakers.leaving
                      : t.coSpeakers.leave
                    : removing === item.uid
                      ? t.coSpeakers.removing
                      : t.coSpeakers.remove}
                </button>
              )}
              {item.kind === 'invitation' && item.state === 'pending' && canManageInvitations && !readOnly && (
                <span className="co-speaker-person__actions">
                  {item.canRetryDelivery && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={actionBusy}
                      aria-label={
                        retrying === item.invitationId
                          ? t.coSpeakers.retryingDeliveryFor(label)
                          : t.coSpeakers.retryDeliveryFor(label)
                      }
                      onClick={() => void onRetryDelivery(item)}
                    >
                      {retrying === item.invitationId
                        ? t.coSpeakers.retryingDelivery
                        : t.coSpeakers.retryDelivery}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={actionBusy}
                    aria-label={
                      revoking === item.invitationId
                        ? t.coSpeakers.revokingInvitation(label)
                        : t.coSpeakers.revokeInvitation(label)
                    }
                    onClick={() => void onRevoke(item)}
                  >
                    {revoking === item.invitationId ? t.coSpeakers.revoking : t.coSpeakers.revoke}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {roster.items.length === 1 && <p className="muted">{t.coSpeakers.empty}</p>}

      {roster.canInvite && !readOnly && !atCapacity && (
        <div className="co-speaker-invite">
          <label className="field co-speaker-invite__field">
            <span className="field__label">{t.coSpeakers.inviteLabel}</span>
            <input
              ref={inviteInput}
              className="field__input"
              type="email"
              value={email}
              maxLength={254}
              placeholder={t.coSpeakers.invitePlaceholder}
              autoComplete="email"
              aria-invalid={emailError ? 'true' : undefined}
              aria-describedby={emailError ? 'co-speaker-email-error' : 'co-speaker-email-help'}
              disabled={actionBusy}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!actionBusy && email.trim()) void onInvite();
                }
              }}
            />
            <span className="field__help" id="co-speaker-email-help">
              {roster.invitePhase === 'postAcceptance'
                ? t.coSpeakers.lateInviteHelp
                : t.coSpeakers.inviteHelp}
            </span>
            {emailError && (
              <span className="field__error" id="co-speaker-email-error">
                {emailError}
              </span>
            )}
          </label>
          <button type="button" className="btn btn--primary" disabled={actionBusy || !email.trim()} onClick={() => void onInvite()}>
            {inviting ? t.coSpeakers.inviting : t.coSpeakers.invite}
          </button>
        </div>
      )}

      {roster.canInvite && !readOnly && atCapacity && <p className="muted">{t.coSpeakers.atCapacity}</p>}

      {hasPendingLateInvitation && (
        <aside className="co-speaker-pending" role="status">
          <strong>{t.coSpeakers.lateInvitePendingTitle}</strong>
          <p>{t.coSpeakers.lateInvitePendingHelp}</p>
        </aside>
      )}

      {roster.pendingBlocksSubmit && (
        <aside className="co-speaker-pending" role="status">
          <strong>
            {context === 'admin' || roster.canEditTalk
              ? t.coSpeakers.pendingBlockTitle
              : currentSpeakerReady
                ? t.coSpeakers.waitingOnTeamTitle
                : t.coSpeakers.yourSetupTitle}
          </strong>
          <p>
            {context === 'admin' || roster.canEditTalk
              ? t.coSpeakers.pendingBlockHelp
              : currentSpeakerReady
                ? t.coSpeakers.waitingOnTeamHelp
                : t.coSpeakers.yourSetupHelp}
          </p>
        </aside>
      )}

      {notice && (
        <p className="co-speaker-roster__notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="field__error" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}

export function CoSpeakerRosterDialog({
  open,
  cfpId,
  proposalId,
  proposalTitle,
  readOnly = false,
  canRequestProfileUpdate = false,
  autoReviewSpeakerUid,
  onSnapshotRefreshed,
  onProfileUpdateRequestChanged,
  onClose,
}: {
  open: boolean;
  cfpId: string;
  proposalId: string;
  proposalTitle: string;
  readOnly?: boolean;
  canRequestProfileUpdate?: boolean;
  autoReviewSpeakerUid?: string;
  onSnapshotRefreshed?: (speakerUid: string, snapshot: SpeakerSnapshot) => void;
  onProfileUpdateRequestChanged?: (
    speakerUid: string,
    request: SpeakerProfileUpdateRequestState,
  ) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="co-speaker-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="co-speaker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="co-speaker-dialog-title"
        tabIndex={-1}
      >
        <div className="co-speaker-dialog__header">
          <div>
            <p className="co-speaker-dialog__eyebrow">{proposalTitle}</p>
            <h2 id="co-speaker-dialog-title">{t.coSpeakers.title}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t.coSpeakers.close}
          </button>
        </div>
        <CoSpeakerRoster
          cfpId={cfpId}
          proposalId={proposalId}
          context="admin"
          readOnly={readOnly}
          canRequestProfileUpdate={canRequestProfileUpdate}
          autoReviewSpeakerUid={autoReviewSpeakerUid}
          onSnapshotRefreshed={onSnapshotRefreshed}
          onProfileUpdateRequestChanged={onProfileUpdateRequestChanged}
        />
      </div>
    </div>
  );
}
