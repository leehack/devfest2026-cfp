import { useCallback, useEffect, useRef, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { formatDate } from '../../i18n';
import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { useLatest } from '../../lib/useLatest';
import {
  emailQueue,
  loadAllProposals,
  sendSpeakerMessage,
  setEmailSettings,
  type EmailRow,
  type HeldEmail,
  type ProposalRow,
} from '../../lib/roles';
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
  onDirtyChange,
  onPendingChange,
}: {
  cfpId: string;
  cfpName: string;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (count: number) => void;
}) {
  const { t, locale } = useI18n();
  const tRef = useLatest(t);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<HeldEmail[]>([]);
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
  const editing = useRef(false);
  const activeCfp = useRef(cfpId);
  activeCfp.current = cfpId;
  const senderDirty =
    settings.from !== storedSettings.from || settings.replyTo !== storedSettings.replyTo;
  const dirty = senderDirty || setupDirty || wordingDirty || messageDirty;

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
      logId?: string,
      reviewedLogIds?: string[],
    ) => {
      const scope = cfpId;
      setBusy(true);
      setError('');
      if (action !== 'preview') setNote('');
      try {
        const { data } = await emailQueue({
          cfpId,
          action,
          ...(logId ? { logId } : {}),
          ...(reviewedLogIds ? { logIds: reviewedLogIds } : {}),
        });
        if (activeCfp.current !== scope) return;
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
          onPendingChange?.(nextHeld.length);
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
          if (activeCfp.current !== scope) return;
          const nextHeld = [...(after.held ?? [])].sort(
            (a, b) =>
              a.kind.localeCompare(b.kind) || (a.title ?? '').localeCompare(b.title ?? ''),
          );
          setTally(after.tally ?? {});
          setStaleHeld(after.staleHeld ?? 0);
          setHeld(nextHeld);
          onPendingChange?.(nextHeld.length);
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
      } catch (e) {
        if (activeCfp.current === scope) setError(adminError(e, tRef.current));
      } finally {
        if (activeCfp.current === scope) setBusy(false);
      }
    },
    [cfpId, onPendingChange, tRef],
  );

  useEffect(() => {
    editing.current = false;
    setBusy(false);
    setReady(false);
    setTally({});
    setHeld([]);
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

  const waiting = held.length;
  // A `dry_run` row is a message that was never sent, so it belongs with the
  // failures on the retry button rather than looking like a delivery.
  const unsent = count('failed') + count('dry_run');

  /*
   * Its own function rather than another `run` action: resend answers with an
   * acknowledgement, not a queue snapshot, so folding it into `run` would blank
   * the tally and the rows the moment it returned.
   */
  async function resend(row: EmailRow) {
    if (!window.confirm(t.admin.emailResendConfirm.replace('{to}', row.to))) return;
    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await emailQueue({ cfpId, action: 'resend', logId: row.logId });
      if (activeCfp.current !== scope) return;
      setNote(t.admin.emailResent.replace('{to}', row.to));
      await run('preview');
    } catch (e) {
      if (activeCfp.current === scope) setError(adminError(e, t));
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  async function saveSender() {
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
      if (activeCfp.current === scope) setSenderError(adminError(e, t));
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
        className={`email-queue-card${waiting > 0 ? ' email-queue-card--pending' : ''}`}
        aria-labelledby="decision-email-queue-title"
      >
        <div className="email-queue-card__heading">
          <div>
            <p className="email-queue-card__eyebrow">{t.admin.pendingEmailEyebrow}</p>
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

        <dl className="stats">
          {(['held', 'queued', 'sent', 'dry_run', 'failed'] as const).map((status) => (
            <div key={status} className="stats__item">
              <dt>{t.admin.emailStatus[status]}</dt>
              <dd>{count(status)}</dd>
            </div>
          ))}
        </dl>

        {waiting === 0 && <p className="muted">{t.admin.emailQueueEmpty}</p>}
        {waiting > 0 && (!keyHint || !settings.from) && (
          <p className="note note--inline">{t.admin.emailQueueSetupNeeded}</p>
        )}
        {staleHeld > 0 && (
          <p className="muted">
            {t.admin.emailStaleHeld.replace('{count}', String(staleHeld))}
          </p>
        )}

        {held.length > 0 && (
          <div className="table__scroll">
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

        <div className="row row--wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => run('preview')}>
            {t.admin.emailRefresh}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || waiting === 0}
            onClick={() => {
              if (confirm(t.admin.emailConfirm.replace('{count}', String(waiting)))) {
                void run(
                  'release',
                  undefined,
                  held.map((row) => row.logId),
                );
              }
            }}
          >
            {waiting === 0
              ? t.admin.emailNothing
              : t.admin.emailRelease(waiting)}
          </button>
          {unsent > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => run('retry')}>
              {t.admin.emailRetry.replace('{count}', String(unsent))}
            </button>
          )}
        </div>

        <Result ok={note} error={error} />
      </section>

      <h3 className="card__subtitle">{t.admin.setupEmail}</h3>
      <EmailSetup
        cfpId={cfpId}
        keyHint={keyHint}
        domainId={domainId}
        onKeySet={setKeyHint}
        onDomainChanged={() => run('preview')}
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
          disabled={busy}
        />
        <TextField
          label={t.admin.emailReplyTo}
          value={settings.replyTo}
          onChange={(replyTo) => {
            editing.current = true;
            setSettings((s) => ({ ...s, replyTo }));
          }}
          disabled={busy}
        />
      </div>
      <p className="field__help">{t.admin.emailFromHelp}</p>
      {mismatch && (
        <p className="note note--inline" role="status">
          {t.admin.emailDomainMismatch.replace('{sender}', mismatch).replace('{verified}', domain)}
        </p>
      )}

      <button type="button" className="btn" disabled={busy} onClick={saveSender}>
        {t.admin.emailSaveSender}
      </button>
      <Result ok={senderNote} error={senderError} />

      <h3 className="card__subtitle">{t.admin.emailPreview}</h3>
      <EmailPreview
        cfpId={cfpId}
        cfpName={cfpName}
        configured={Boolean(keyHint && settings.from)}
        templates={templates}
        onSaved={() => run('preview')}
        onDirtyChange={setWordingDirty}
      />

      <section className="email-message" aria-labelledby="email-message-title">
        <h3 className="card__subtitle" id="email-message-title">
          {t.admin.messageTitle}
        </h3>
        <WriteToSpeaker
          cfpId={cfpId}
          replyTo={settings.replyTo}
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
                ...(['held', 'queued', 'sent', 'dry_run', 'failed'] as const).map((s) => ({
                  value: s,
                  label: t.admin.emailStatus[s],
                })),
              ]}
              onChange={setFilter}
              disabled={busy}
            />
          </div>

          <div className="table__scroll">
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
                          : (t.admin.emailStatus as Record<string, string>)[row.status] ?? row.status}
                        {/* The provider's reason: the only thing on screen that
                            says what to fix. */}
                        {row.error && <span className="muted"> — {row.error}</span>}
                      </td>
                      <td data-label={t.admin.emailSentAt}>
                        {row.sentAt ? formatDate(new Date(row.sentAt), locale) : '—'}
                      </td>
                      <td data-label={t.admin.emailActions}>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={
                            busy ||
                            row.stale ||
                            row.status === 'held' ||
                            row.status === 'queued' ||
                            row.status === 'sending'
                          }
                          onClick={() => resend(row)}
                        >
                          {t.admin.emailResend}
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
    </section>
  );
}

/**
 * A message to one speaker, written here rather than in a personal mail client.
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
  onSent,
  onDirtyChange,
}: {
  cfpId: string;
  replyTo: string;
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
  const activeCfp = useRef(cfpId);
  activeCfp.current = cfpId;
  const dirty = subject !== '' || body !== '';

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
    void (async () => {
      try {
        // Drafts are excluded: writing to someone about a talk they have not
        // submitted tells them it was read.
        const sendable = (await loadAllProposals(cfpId)).filter((row) => row.status !== 'draft');
        if (!cancelled) setRows(sendable);
      } catch (e) {
        if (!cancelled) setLoadError(adminError(e, tRef.current));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, cfpId, tRef]);

  // From the snapshot frozen onto the proposal — the global speaker profile is
  // not the committee's to read. See `ReviewPage`.
  const nameOf = (row?: ProposalRow) =>
    (row?.speakerSnapshot ?? [])
      .map((s) => s.name)
      .filter(Boolean)
      .join(', ');

  const target = rows.find((row) => row.id === proposalId);
  const to = nameOf(target) || t.admin.emailTo;

  async function send() {
    if (!target) return;
    if (!confirm(t.admin.messageConfirm.replace('{name}', to))) return;

    const scope = cfpId;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await sendSpeakerMessage({ cfpId, proposalId, subject, body });
      if (activeCfp.current !== scope) return;
      setSubject('');
      setBody('');
      setNote(t.admin.messageSent.replace('{name}', to));
      onSent();
    } catch (e) {
      if (activeCfp.current === scope) setError(adminError(e, t));
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
        disabled={busy}
      />
      <TextField
        label={t.admin.messageSubject}
        required
        value={subject}
        onChange={setSubject}
        maxLength={LIMITS.messageSubjectMax}
        disabled={busy}
      />
      <TextAreaField
        label={t.admin.messageBody}
        required
        help={t.admin.messageBodyHelp}
        value={body}
        onChange={setBody}
        maxLength={LIMITS.messageBodyMax}
        rows={6}
        disabled={busy}
      />

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !proposalId || !subject.trim() || !body.trim()}
        onClick={send}
      >
        {busy ? t.admin.messageSending : t.admin.messageSend}
      </button>
      <Result ok={note} error={error} />
    </div>
  );
}
