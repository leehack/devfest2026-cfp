import { useCallback, useEffect, useRef, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { formatDate } from '../../i18n';
import { useI18n } from '../../i18n/context';
import { emailError, isSpeakerMessageRecipientsChanged } from '../../lib/errors';
import { useLatest } from '../../lib/useLatest';
import {
  emailQueue,
  loadAllProposals,
  sendSpeakerMessage,
  setEmailSettings,
  type EmailDeliveryReadiness,
  type EmailRow,
  type HeldEmail,
  type ProposalRow,
  type RetryableEmail,
  type SpeakerMessageRecipient,
} from '../../lib/roles';
import {
  EmailActionDialog,
  type EmailReviewAction,
  type EmailReviewRow,
} from '../../components/EmailActionDialog';
import { EmailSetup } from '../../components/EmailSetup';
import { EmailPreview } from '../../components/EmailPreview';
import { LIMITS } from '@shared/enums';
import {
  EMPTY_SETTINGS,
  senderMismatch,
  validateSettings,
  type EmailSettings,
} from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
import { Result } from './Result';

/**
 * §8: preview before the first real batch. Decision mail is queued `held` as
 * each decision is made and sits there until someone releases the lot — so the
 * dangerous button is the one that says how many people it is about to write to.
 */
export function Email({
  cfpId,
  cfpName,
  canManageProvider = false,
  readOnly = false,
  onDirtyChange,
  onPendingChange,
}: {
  cfpId: string;
  cfpName: string;
  canManageProvider?: boolean;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (state: { waiting: number; needsAttention: number }) => void;
}) {
  const { t, locale } = useI18n();
  const tRef = useLatest(t);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<HeldEmail[]>([]);
  const [heldRemaining, setHeldRemaining] = useState(0);
  const [retryable, setRetryable] = useState<RetryableEmail[]>([]);
  const [retryableRemaining, setRetryableRemaining] = useState(0);
  const [delivery, setDelivery] = useState<EmailDeliveryReadiness | null>(null);
  const [staleHeld, setStaleHeld] = useState(0);
  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [storedSettings, setStoredSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [keyHint, setKeyHint] = useState('');
  const [domainId, setDomainId] = useState('');
  const [domain, setDomain] = useState('');
  const [templates, setTemplates] = useState<TemplateOverrides>({});
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [truncated, setTruncated] = useState(0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [senderNote, setSenderNote] = useState('');
  const [senderError, setSenderError] = useState('');
  const [ready, setReady] = useState(false);
  const [setupDirty, setSetupDirty] = useState(false);
  const [wordingDirty, setWordingDirty] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [review, setReview] = useState<{
    action: Exclude<EmailReviewAction, 'compose'>;
    rows: EmailReviewRow[];
  } | null>(null);
  const editing = useRef(false);
  const activeCfp = useRef(cfpId);
  activeCfp.current = cfpId;
  const senderDirty =
    settings.from !== storedSettings.from || settings.replyTo !== storedSettings.replyTo;
  const dirty = !readOnly && (senderDirty || setupDirty || wordingDirty || messageDirty);
  const keyConfigured = Boolean(
    delivery &&
      !delivery.problems.some((problem) =>
        ['missing_key', 'invalid_key', 'setup_unavailable'].includes(problem),
      ),
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const run = useCallback(
    async (
      action: 'preview' | 'release' | 'retry',
      reviewedRows?: EmailReviewRow[],
    ): Promise<boolean> => {
      if (readOnly && action !== 'preview') return false;
      const scope = cfpId;
      setBusy(true);
      setError('');
      if (action !== 'preview') setNote('');
      try {
        const { data } = await emailQueue({
          cfpId,
          action,
          ...(reviewedRows
            ? {
                logIds: reviewedRows.map((row) => row.logId),
                reviewedRecipients: reviewedRows.map(({ logId, to }) => ({ logId, to })),
              }
            : {}),
        });
        if (activeCfp.current !== scope) return false;
        // Grouped by outcome: an admin checking a batch is looking for a
        // rejection sitting in the acceptances, not for a particular address.
        if (action === 'preview') {
          const nextHeld = [...(data.held ?? [])].sort(
            (a, b) =>
              a.kind.localeCompare(b.kind) || (a.title ?? '').localeCompare(b.title ?? ''),
          );
          setReady(true);
          setTally(data.tally ?? {});
          setStaleHeld(data.staleHeld ?? 0);
          setHeld(nextHeld);
          setHeldRemaining(data.heldRemaining ?? 0);
          setRetryable(data.retryable ?? []);
          setRetryableRemaining(data.retryableRemaining ?? 0);
          setDelivery(data.delivery ?? null);
          onPendingChange?.({
            waiting: data.waiting ?? nextHeld.length,
            needsAttention: data.needsAttention ?? data.retryable?.length ?? 0,
          });
          // Never over the top of someone mid-sentence: this load is async, and
          // an admin who starts typing before it lands would otherwise watch the
          // field empty itself under the cursor.
          if (data.settings && !editing.current) {
            setSettings(data.settings);
            setStoredSettings(data.settings);
          }
          setKeyHint(data.keyHint ?? '');
          setDomainId(data.domainId ?? '');
          setDomain(data.domain ?? '');
          setRows(data.rows ?? []);
          setTruncated(data.truncated ?? 0);
          setTemplates(data.templates ?? {});
        } else {
          setNote(tRef.current.admin.emailSent(data.released ?? 0));
          const { data: after } = await emailQueue({ cfpId, action: 'preview' });
          if (activeCfp.current !== scope) return false;
          const nextHeld = [...(after.held ?? [])].sort(
            (a, b) =>
              a.kind.localeCompare(b.kind) || (a.title ?? '').localeCompare(b.title ?? ''),
          );
          setTally(after.tally ?? {});
          setStaleHeld(after.staleHeld ?? 0);
          setHeld(nextHeld);
          setHeldRemaining(after.heldRemaining ?? 0);
          setRetryable(after.retryable ?? []);
          setRetryableRemaining(after.retryableRemaining ?? 0);
          setDelivery(after.delivery ?? null);
          onPendingChange?.({
            waiting: after.waiting ?? nextHeld.length,
            needsAttention: after.needsAttention ?? after.retryable?.length ?? 0,
          });
          if (after.settings && !editing.current) {
            setSettings(after.settings);
            setStoredSettings(after.settings);
          }
          setKeyHint(after.keyHint ?? '');
          setDomainId(after.domainId ?? '');
          setDomain(after.domain ?? '');
          setRows(after.rows ?? []);
          setTruncated(after.truncated ?? 0);
          setTemplates(after.templates ?? {});
        }
        return true;
      } catch (e) {
        if (activeCfp.current === scope) setError(emailError(e, tRef.current));
        return false;
      } finally {
        if (activeCfp.current === scope) setBusy(false);
      }
    },
    [cfpId, onPendingChange, readOnly, tRef],
  );

  useEffect(() => {
    editing.current = false;
    setBusy(false);
    setReady(false);
    setTally({});
    setHeld([]);
    setHeldRemaining(0);
    setRetryable([]);
    setRetryableRemaining(0);
    setDelivery(null);
    setStaleHeld(0);
    setSettings(EMPTY_SETTINGS);
    setStoredSettings(EMPTY_SETTINGS);
    setKeyHint('');
    setDomainId('');
    setDomain('');
    setTemplates({});
    setRows([]);
    setTruncated(0);
    setFilter('');
    setNote('');
    setError('');
    setSenderNote('');
    setSenderError('');
    setSetupDirty(false);
    setWordingDirty(false);
    setMessageDirty(false);
    setReview(null);
  }, [cfpId]);

  useEffect(() => {
    void run('preview');
  }, [run]);

  const count = (prefix: string) =>
    Object.entries(tally)
      .filter(([key]) => key.startsWith(`${prefix}:`))
      .reduce((sum, [, n]) => sum + n, 0);

  // Warned about as you type, not on save: this one only shows up at send time
  // otherwise, by which point the message is a `failed` row.
  const mismatch = senderMismatch(settings.from, domain);

  const waiting = held.length + heldRemaining;
  const unsent = retryable.length + retryableRemaining;
  const inProgress = count('queued') + count('sending');
  const delivered = count('sent');
  const deliveryReady = delivery?.ready === true;

  /*
   * Its own function rather than another `run` action: resend answers with an
   * acknowledgement, not a queue snapshot, so folding it into `run` would blank
   * the tally and the rows the moment it returned.
   */
  async function resend(row: EmailRow): Promise<boolean> {
    if (readOnly) return false;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await emailQueue({
        cfpId,
        action: 'resend',
        logId: row.logId,
        reviewedTo: row.currentTo,
      });
      if (activeCfp.current !== scope) return false;
      setNote(t.admin.emailResent.replace('{to}', row.currentTo));
      await run('preview');
      return true;
    } catch (e) {
      if (activeCfp.current === scope) setError(emailError(e, t));
      return false;
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  async function confirmReview() {
    if (!review) return;
    const done =
      review.action === 'release'
        ? await run('release', review.rows)
        : review.action === 'retry'
          ? await run('retry', review.rows)
          : (() => {
              const row = rows.find((candidate) => candidate.logId === review.rows[0]?.logId);
              return row ? resend(row) : Promise.resolve(false);
            })();
    if (done) setReview(null);
  }

  async function saveSender() {
    if (readOnly) return;
    const scope = cfpId;
    setSenderNote('');
    setSenderError('');

    const problem = validateSettings(settings);
    if (problem) {
      setSenderError(t.admin.emailSender[problem.problem]);
      return;
    }

    // The server refuses both of these, and says so in English. Catching them
    // here is what turns "invalid argument" into a sentence naming the domain.
    if (!domain) {
      setSenderError(t.admin.emailDomainFirst);
      return;
    }
    if (mismatch) {
      setSenderError(
        t.admin.emailDomainMismatch.replace('{sender}', mismatch).replace('{verified}', domain),
      );
      return;
    }

    setBusy(true);
    try {
      await setEmailSettings({ cfpId, ...settings });
      if (activeCfp.current !== scope) return;
      // Stored now, so the server's copy is the one to trust again.
      editing.current = false;
      setStoredSettings(settings);
      setSenderNote(t.admin.windowSaved);
      await run('preview');
    } catch (e) {
      if (activeCfp.current === scope) setSenderError(emailError(e, t));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  if (!ready) {
    return (
      <section className="section">
        <h2>{t.admin.email}</h2>
        {!error ? (
          <p className="muted">{t.app.loading}</p>
        ) : (
          <>
            <Result ok="" error={error} />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run('preview')}
            >
              {t.errors.reload}
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="section email-admin">
      <h2>{t.admin.email}</h2>

      <section
        className={`email-delivery-status${deliveryReady ? ' email-delivery-status--ready' : ''}`}
        aria-labelledby="email-delivery-status-title"
      >
        <div className="email-delivery-status__mark" aria-hidden="true">
          {deliveryReady ? '✓' : '!'}
        </div>
        <div className="email-delivery-status__copy">
          <p className="email-delivery-status__eyebrow">{t.admin.emailDeliveryStatus}</p>
          <h3 id="email-delivery-status-title">
            {!delivery
              ? t.admin.emailDeliveryChecking
              : deliveryReady
                ? t.admin.emailDeliveryReady
                : t.admin.emailDeliveryBlocked}
          </h3>
          <p>
            {deliveryReady
              ? t.admin.emailDeliveryReadyHelp
              : t.admin.emailDeliveryBlockedHelp}
          </p>
          {delivery && !deliveryReady && (
            <ul className="email-delivery-status__problems">
              {delivery.problems.map((problem) => (
                <li key={problem}>
                  {t.admin.emailDeliveryProblems[problem] ?? problem}
                </li>
              ))}
            </ul>
          )}
        </div>
        {!deliveryReady && (
          <a className="btn email-delivery-status__action" href="#email-delivery-setup">
            {t.admin.emailCompleteSetup}
          </a>
        )}
      </section>

      <section className="email-operations" aria-labelledby="email-operations-title">
        <div className="email-operations__heading">
          <h3 id="email-operations-title">{t.admin.emailOperations}</h3>
          <p>{t.admin.emailOperationsHelp}</p>
        </div>
        <div className="email-operations__grid">
          <article className="email-operation email-operation--waiting">
            <span className="email-operation__count">{waiting}</span>
            <h4>{t.admin.emailAwaiting}</h4>
            <p>{t.admin.emailAwaitingHelp}</p>
          </article>
          <article className={`email-operation${unsent ? ' email-operation--attention' : ''}`}>
            <span className="email-operation__count">{unsent}</span>
            <h4>{t.admin.emailNeedsAttention}</h4>
            <p>{t.admin.emailNeedsAttentionHelp}</p>
          </article>
          <article className="email-operation">
            <span className="email-operation__count">{inProgress}</span>
            <h4>{t.admin.emailInProgress}</h4>
            <p>{t.admin.emailInProgressHelp}</p>
          </article>
          <article className="email-operation email-operation--delivered">
            <span className="email-operation__count">{delivered}</span>
            <h4>{t.admin.emailDelivered}</h4>
            <p>{t.admin.emailDeliveredHelp}</p>
          </article>
        </div>
      </section>

      <section
        className={`email-queue-card${waiting > 0 ? ' email-queue-card--pending' : ''}`}
        aria-labelledby="decision-email-queue-title"
      >
        <div className="email-queue-card__heading">
          <div>
            <p className="email-queue-card__eyebrow">{t.admin.emailAwaiting}</p>
            <h3 id="decision-email-queue-title">{t.admin.emailDecisionQueue}</h3>
            <p>{t.admin.emailHelp}</p>
          </div>
          {waiting > 0 && (
            <div
              className="email-queue-card__count"
              aria-label={t.admin.pendingEmailTitle(waiting)}
            >
              <strong>{waiting}</strong>
              <span>{t.admin.pendingEmailShort}</span>
            </div>
          )}
        </div>

        {waiting === 0 && <p className="muted">{t.admin.emailQueueEmpty}</p>}
        {waiting > 0 && !deliveryReady && (
          <p className="note note--inline">{t.admin.emailQueueSetupNeeded}</p>
        )}
        {staleHeld > 0 && (
          <p className="muted">
            {t.admin.emailStaleHeld.replace('{count}', String(staleHeld))}
          </p>
        )}

        {held.length > 0 && (
          <div
            className="table__scroll table__scroll--focusable"
            role="region"
            aria-label={t.admin.emailHeldTableLabel}
            tabIndex={0}
          >
            <table className="table table--held">
              <thead>
                <tr>
                  <th scope="col">{t.admin.emailKind}</th>
                  <th scope="col">{t.admin.emailTo}</th>
                  <th scope="col">{t.proposal.title}</th>
                </tr>
              </thead>
              <tbody>
                {held.map((row) => (
                  <tr key={row.logId}>
                    <td data-label={t.admin.emailKind}>
                      {t.admin.emailKinds[row.kind] ?? row.kind}
                    </td>
                    <td className="table__wrap" data-label={t.admin.emailTo}>
                      {row.to}
                    </td>
                    <td className="table__wrap" data-label={t.proposal.title}>
                      {row.title}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {heldRemaining > 0 && (
          <p className="field__help">
            {t.admin.emailBatchRemaining.replace('{count}', String(heldRemaining))}
          </p>
        )}

        <div className="row row--wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => run('preview')}>
            {t.admin.emailRefresh}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || readOnly || held.length === 0 || !deliveryReady}
            aria-describedby={!deliveryReady ? 'email-action-setup-reason' : undefined}
            onClick={() => setReview({ action: 'release', rows: held })}
          >
            {held.length === 0
              ? t.admin.emailNothing
              : t.admin.emailRelease(held.length)}
          </button>
        </div>

        {!deliveryReady && (
          <p className="field__help" id="email-action-setup-reason">
            {t.admin.emailActionSetupReason}
          </p>
        )}

        <Result ok={note} error={error} />
      </section>

      <section
        className={`email-attention-card${unsent ? ' email-attention-card--active' : ''}`}
        aria-labelledby="email-attention-title"
      >
        <div className="email-attention-card__heading">
          <div>
            <p className="email-attention-card__eyebrow">{t.admin.emailNeedsAttention}</p>
            <h3 id="email-attention-title">{t.admin.emailNeedsAttention}</h3>
            <p>{t.admin.emailNeedsAttentionHelp}</p>
          </div>
          <strong className="email-attention-card__count" aria-label={String(unsent)}>
            {unsent}
          </strong>
        </div>

        {retryable.length === 0 ? (
          <p className="muted">{t.admin.emailNoAttention}</p>
        ) : (
          <div
            className="table__scroll table__scroll--focusable"
            role="region"
            aria-label={t.admin.emailAttentionTableLabel}
            tabIndex={0}
          >
            <table className="table table--attention">
              <thead>
                <tr>
                  <th scope="col">{t.admin.emailKind}</th>
                  <th scope="col">{t.admin.emailTo}</th>
                  <th scope="col">{t.proposal.title}</th>
                  <th scope="col">{t.admin.emailStatusColumn}</th>
                </tr>
              </thead>
              <tbody>
                {retryable.map((row) => (
                  <tr key={row.logId}>
                    <td data-label={t.admin.emailKind}>
                      {t.admin.emailKinds[row.kind] ?? row.kind}
                    </td>
                    <td className="table__wrap" data-label={t.admin.emailTo}>
                      {row.to}
                    </td>
                    <td className="table__wrap" data-label={t.proposal.title}>
                      {row.title || '—'}
                    </td>
                    <td data-label={t.admin.emailStatusColumn}>
                      {row.recoverable
                        ? t.admin.emailRecoverableStatus
                        : (t.admin.emailStatus as Record<string, string>)[row.status] ?? row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {retryableRemaining > 0 && (
          <p className="field__help">
            {t.admin.emailBatchRemaining.replace('{count}', String(retryableRemaining))}
          </p>
        )}

        {unsent > 0 && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || readOnly || !deliveryReady}
            aria-describedby={!deliveryReady ? 'email-attention-setup-reason' : undefined}
            onClick={() => setReview({ action: 'retry', rows: retryable })}
          >
            {t.admin.emailRetry.replace('{count}', String(retryable.length))}
          </button>
        )}
        {!deliveryReady && unsent > 0 && (
          <p className="field__help" id="email-attention-setup-reason">
            {t.admin.emailActionSetupReason}
          </p>
        )}
      </section>

      <h3 className="card__subtitle" id="email-delivery-setup">
        {t.admin.setupEmail}
      </h3>
      <EmailSetup
        cfpId={cfpId}
        keyHint={keyHint}
        keyConfigured={keyConfigured}
        canManageProvider={canManageProvider}
        domainId={domainId}
        readOnly={readOnly}
        onKeySet={(hint) => {
          setKeyHint(hint);
          void run('preview');
        }}
        onDomainChanged={async () => {
          await run('preview');
        }}
        onDirtyChange={setSetupDirty}
      />

      <h3 className="card__subtitle">{t.admin.emailStepSender}</h3>
      {!settings.from && <p className="note note--inline">{t.admin.emailNoSender}</p>}

      <div className="grid grid--2">
        <TextField
          label={t.admin.emailFrom}
          required
          value={settings.from}
          onChange={(from) => {
            editing.current = true;
            setSettings((s) => ({ ...s, from }));
          }}
          disabled={busy || readOnly}
        />
        <TextField
          label={t.admin.emailReplyTo}
          value={settings.replyTo}
          onChange={(replyTo) => {
            editing.current = true;
            setSettings((s) => ({ ...s, replyTo }));
          }}
          disabled={busy || readOnly}
        />
      </div>
      <p className="field__help">{t.admin.emailFromHelp}</p>
      {mismatch && (
        <p className="note note--inline" role="status">
          {t.admin.emailDomainMismatch.replace('{sender}', mismatch).replace('{verified}', domain)}
        </p>
      )}

      <button type="button" className="btn" disabled={busy || readOnly} onClick={saveSender}>
        {t.admin.emailSaveSender}
      </button>
      <Result ok={senderNote} error={senderError} />

      <h3 className="card__subtitle">{t.admin.emailPreview}</h3>
      <EmailPreview
        cfpId={cfpId}
        cfpName={cfpName}
        configured={deliveryReady}
        templates={templates}
        readOnly={readOnly}
        onSaved={async () => {
          await run('preview');
        }}
        onDirtyChange={setWordingDirty}
      />

      <section className="email-message" aria-labelledby="email-message-title">
        <h3 className="card__subtitle" id="email-message-title">
          {t.admin.messageTitle}
        </h3>
        <WriteToSpeaker
          cfpId={cfpId}
          replyTo={settings.replyTo}
          deliveryReady={deliveryReady}
          readOnly={readOnly}
          onSent={() => run('preview')}
          onDirtyChange={setMessageDirty}
        />
      </section>

      {/*
        The record of what was actually sent to whom. Counts alone could not
        answer "did this speaker get their acceptance", which is the question an
        organiser actually has.
      */}
      <h3 className="card__subtitle">{t.admin.emailLog}</h3>
      <p className="section__help">{t.admin.emailLogHelp}</p>
      {rows.length === 0 ? (
        <p className="muted">{t.admin.emailLogEmpty}</p>
      ) : (
        <>
          <div className="grid grid--3">
            <SelectField
              label={t.admin.emailLogFilter}
              value={filter}
              options={[
                { value: '', label: t.admin.emailLogAll },
                ...(['held', 'queued', 'sending', 'sent', 'dry_run', 'failed'] as const).map((s) => ({
                  value: s,
                  label: t.admin.emailStatus[s],
                })),
              ]}
              onChange={setFilter}
              disabled={busy}
            />
          </div>

          <div
            className="table__scroll table__scroll--focusable"
            role="region"
            aria-label={t.admin.emailHistoryTableLabel}
            tabIndex={0}
          >
            <table className="table email-log-table">
              <thead>
                <tr>
                  <th scope="col">{t.admin.emailTo}</th>
                  <th scope="col">{t.admin.emailKind}</th>
                  <th scope="col">{t.admin.emailStatusColumn}</th>
                  <th scope="col">{t.admin.emailSentAt}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.admin.emailActions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => !filter || r.status === filter)
                  .map((row) => (
                    <tr key={row.logId}>
                      <td className="table__wrap" data-label={t.admin.emailTo}>
                        {row.to}
                      </td>
                      <td className="table__wrap" data-label={t.admin.emailKind}>
                        {t.admin.emailKinds[row.kind] ?? row.kind}
                        {/* Two messages to the same speaker are otherwise the
                            same row twice. */}
                        {row.subject && <span className="muted"> — {row.subject}</span>}
                      </td>
                      <td className="table__wrap" data-label={t.admin.emailStatusColumn}>
                        {row.stale
                          ? t.admin.emailStaleStatus
                          : row.recoverable
                            ? t.admin.emailRecoverableStatus
                          : (t.admin.emailStatus as Record<string, string>)[row.status] ?? row.status}
                        {/* The provider's reason: the only thing on screen that
                            says what to fix. */}
                        {row.error && <span className="muted"> — {row.error}</span>}
                      </td>
                      <td data-label={t.admin.emailSentAt}>
                        {row.attemptedAt ? formatDate(new Date(row.attemptedAt), locale) : '—'}
                      </td>
                      <td data-label={t.admin.emailActions}>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          aria-describedby={!deliveryReady ? 'email-action-setup-reason' : undefined}
                          disabled={
                            busy ||
                            readOnly ||
                            !deliveryReady ||
                            row.stale ||
                            row.status === 'held' ||
                            row.status === 'queued' ||
                            row.status === 'sending'
                          }
                          onClick={() =>
                            setReview({
                              action: 'resend',
                              rows: [{ ...row, to: row.currentTo }],
                            })
                          }
                        >
                          {row.status === 'sent' ? t.admin.emailResend : t.admin.emailRetryOne}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {truncated > 0 && (
            <p className="muted">
              {t.admin.emailLogTruncated.replace('{count}', String(truncated))}
            </p>
          )}
        </>
      )}
      {review && (
        <EmailActionDialog
          action={review.action}
          rows={review.rows}
          busy={busy}
          error={error}
          onCancel={() => setReview(null)}
          onConfirm={() => void confirmReview()}
        />
      )}
    </section>
  );
}

/**
 * One message fanned out to every active speaker on a talk.
 *
 * The templates cover the lifecycle and nothing else, so a clash in the
 * schedule or a missing detail had no route that the speaker could recognise as
 * coming from us, and none the rest of the committee could see afterwards.
 *
 * Cleared on success. There is no deterministic id behind this one, so sending
 * twice sends twice — an empty form is the difference between a second thought
 * and a second copy.
 */
function WriteToSpeaker({
  cfpId,
  replyTo,
  deliveryReady,
  readOnly = false,
  onSent,
  onDirtyChange,
}: {
  cfpId: string;
  replyTo: string;
  deliveryReady: boolean;
  readOnly?: boolean;
  onSent: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [proposalId, setProposalId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [recipientPreview, setRecipientPreview] = useState<SpeakerMessageRecipient[]>([]);
  const [recipientsFingerprint, setRecipientsFingerprint] = useState('');
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const activeCfp = useRef(cfpId);
  activeCfp.current = cfpId;
  const dirty = !readOnly && (subject !== '' || body !== '');

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setProposalId('');
    setSubject('');
    setBody('');
    setBusy(false);
    setLoading(true);
    setLoadError('');
    setNote('');
    setError('');
    setRecipientPreview([]);
    setRecipientsFingerprint('');
    setRecipientLoading(false);
    setRecipientError('');
    setReviewing(false);
    void (async () => {
      try {
        // Drafts are excluded: writing to someone about a talk they have not
        // submitted tells them it was read.
        const sendable = (await loadAllProposals(cfpId)).filter((row) => row.status !== 'draft');
        if (!cancelled) setRows(sendable);
      } catch (e) {
        if (!cancelled) setLoadError(emailError(e, tRef.current));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, cfpId, tRef]);

  useEffect(() => {
    let cancelled = false;
    setRecipientPreview([]);
    setRecipientsFingerprint('');
    setRecipientError('');
    setReviewing(false);
    if (!proposalId) {
      setRecipientLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setRecipientLoading(true);
    void (async () => {
      try {
        const { data } = await sendSpeakerMessage({
          cfpId,
          action: 'preview',
          proposalId,
        });
        if (cancelled) return;
        setRecipientPreview(data.recipients ?? []);
        setRecipientsFingerprint(data.recipientsFingerprint ?? '');
      } catch (e) {
        if (!cancelled) setRecipientError(emailError(e, tRef.current));
      } finally {
        if (!cancelled) setRecipientLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfpId, proposalId, tRef]);

  // From the snapshot frozen onto the proposal — the global speaker profile is
  // not the committee's to read. See `ReviewPage`.
  const nameOf = (row?: ProposalRow) =>
    (row?.speakerSnapshot ?? [])
      .map((s) => s.name)
      .filter(Boolean)
      .join(', ');

  const target = rows.find((row) => row.id === proposalId);
  async function send() {
    if (readOnly) return;
    if (!target || !recipientsFingerprint) return;

    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await sendSpeakerMessage({
        cfpId,
        action: 'send',
        proposalId,
        subject,
        body,
        expectedRecipientsFingerprint: recipientsFingerprint,
      });
      if (activeCfp.current !== scope) return;
      setSubject('');
      setBody('');
      setReviewing(false);
      setNote(t.admin.messageQueued(data.logIds?.length ?? recipientPreview.length));
      onSent();
    } catch (e) {
      if (activeCfp.current !== scope) return;
      if (!isSpeakerMessageRecipientsChanged(e)) {
        setError(emailError(e, t));
        return;
      }
      try {
        const { data } = await sendSpeakerMessage({
          cfpId,
          action: 'preview',
          proposalId,
        });
        if (activeCfp.current !== scope) return;
        setRecipientPreview(data.recipients ?? []);
        setRecipientsFingerprint(data.recipientsFingerprint ?? '');
        setRecipientError('');
        setError(t.admin.messageRecipientChanged);
      } catch (refreshError) {
        if (activeCfp.current === scope) setError(emailError(refreshError, t));
      }
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  if (loading) return <p className="muted">{t.app.loading}</p>;

  if (loadError) {
    return (
      <div className="load-failure">
        <p className="field__error" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setAttempt((current) => current + 1)}
        >
          {t.errors.reload}
        </button>
      </div>
    );
  }

  if (rows.length === 0) return <p className="muted">{t.admin.messageNoTalks}</p>;

  return (
    <div className="email-compose">
      <p className="field__help">{t.admin.messageHelp}</p>
      {/* A message inviting a reply, from an address that accepts none, is the
          one failure the speaker cannot work around. */}
      {!replyTo && <p className="note note--inline">{t.admin.messageNoReplyTo}</p>}

      <SelectField
        label={t.admin.messageTalk}
        required
        value={proposalId}
        options={[
          { value: '', label: t.admin.messagePick },
          ...rows.map((row) => ({
            value: row.id,
            label: [row.title || '—', nameOf(row)].filter(Boolean).join(' — '),
          })),
        ]}
        onChange={setProposalId}
        disabled={busy || readOnly}
      />
      {target && (
        <aside className="email-compose__recipients" aria-live="polite">
          <strong>{t.admin.messageRecipientPreview}</strong>
          <p>{t.admin.messageRecipientPreviewHelp}</p>
          {recipientLoading && <p className="muted">{t.app.loading}</p>}
          {recipientError && <p className="field__error">{recipientError}</p>}
          {recipientPreview.length > 0 && (
            <ul>
              {recipientPreview.map((recipient) => (
                <li key={recipient.uid}>
                  <strong>{recipient.name}</strong>
                  <span>{recipient.to}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
      <TextField
        label={t.admin.messageSubject}
        required
        value={subject}
        onChange={setSubject}
        maxLength={LIMITS.messageSubjectMax}
        disabled={busy || readOnly}
      />
      <TextAreaField
        label={t.admin.messageBody}
        required
        help={t.admin.messageBodyHelp}
        value={body}
        onChange={setBody}
        maxLength={LIMITS.messageBodyMax}
        rows={6}
        disabled={busy || readOnly}
      />

      <button
        type="button"
        className="btn btn--primary"
        disabled={
          busy ||
          readOnly ||
          !deliveryReady ||
          !proposalId ||
          !subject.trim() ||
          !body.trim() ||
          recipientLoading ||
          Boolean(recipientError) ||
          !recipientsFingerprint ||
          recipientPreview.length === 0
        }
        aria-describedby={!deliveryReady ? 'email-message-setup-reason' : undefined}
        onClick={() => setReviewing(true)}
      >
        {busy ? t.admin.messageSending : t.admin.messageSend}
      </button>
      {!deliveryReady && (
        <p className="field__help" id="email-message-setup-reason">
          {t.admin.messageSetupNeeded}
        </p>
      )}
      <Result ok={note} error={error} />
      {reviewing && target && (
        <EmailActionDialog
          action="compose"
          rows={recipientPreview.map((recipient) => ({
            logId: recipient.uid,
            kind: 'message',
            to: recipient.to,
            title: `${recipient.name} · ${target.title}`,
          }))}
          message={{ subject, body }}
          busy={busy}
          error={error}
          onCancel={() => setReviewing(false)}
          onConfirm={() => void send()}
        />
      )}
    </div>
  );
}
