import { useCallback, useEffect, useRef, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { formatDate } from '../../i18n';
import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
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
export function Email({ cfpId, cfpName }: { cfpId: string; cfpName: string }) {
  const { t, locale } = useI18n();
  const [tally, setTally] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<HeldEmail[]>([]);
  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
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
  const editing = useRef(false);

  const run = useCallback(
    async (action: 'preview' | 'release' | 'retry', logId?: string) => {
      setBusy(true);
      setError('');
      if (action !== 'preview') setNote('');
      try {
        const { data } = await emailQueue({ cfpId, action, ...(logId ? { logId } : {}) });
        setTally(data.tally ?? {});
        // Never over the top of someone mid-sentence: this load is async, and
        // an admin who starts typing before it lands would otherwise watch the
        // field empty itself under the cursor.
        if (data.settings && !editing.current) setSettings(data.settings);
        setKeyHint(data.keyHint ?? '');
        setDomainId(data.domainId ?? '');
        setDomain(data.domain ?? '');
        setRows(data.rows ?? []);
        setTruncated(data.truncated ?? 0);
        setTemplates(data.templates ?? {});
        // Grouped by outcome: an admin checking a batch is looking for a
        // rejection sitting in the acceptances, not for a particular address.
        if (action === 'preview') {
          setHeld(
            [...(data.held ?? [])].sort(
              (a, b) => a.kind.localeCompare(b.kind) || (a.title ?? '').localeCompare(b.title ?? ''),
            ),
          );
        } else {
          setNote(t.admin.emailSent.replace('{count}', String(data.released ?? 0)));
          const { data: after } = await emailQueue({ cfpId, action: 'preview' });
          setTally(after.tally ?? {});
          setHeld(after.held ?? []);
        }
      } catch (e) {
        setError(adminError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [cfpId, t],
  );

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

  const waiting = count('held');
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
    setBusy(true);
    setNote('');
    setError('');
    try {
      await emailQueue({ cfpId, action: 'resend', logId: row.logId });
      setNote(t.admin.emailResent.replace('{to}', row.to));
      await run('preview');
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function saveSender() {
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
      // Stored now, so the server's copy is the one to trust again.
      editing.current = false;
      setSenderNote(t.admin.windowSaved);
      await run('preview');
    } catch (e) {
      setSenderError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>{t.admin.email}</h2>

      <EmailSetup cfpId={cfpId} keyHint={keyHint} domainId={domainId} onKeySet={setKeyHint} />

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
      />

      <h3 className="card__subtitle">{t.admin.emailQueue}</h3>
      <p className="field__help">{t.admin.emailHelp}</p>

      <dl className="stats">
        {(['held', 'queued', 'sent', 'dry_run', 'failed'] as const).map((status) => (
          <div key={status} className="stats__item">
            <dt>{t.admin.emailStatus[status]}</dt>
            <dd>{count(status)}</dd>
          </div>
        ))}
      </dl>

      {held.length > 0 && (
        <table className="table table--held">
          <thead>
            <tr>
              <th>{t.admin.emailKind}</th>
              <th>{t.admin.emailTo}</th>
              <th>{t.proposal.title}</th>
            </tr>
          </thead>
          <tbody>
            {held.map((row, i) => (
              <tr key={`${row.kind}-${row.to}-${i}`}>
                <td>{t.admin.emailKinds[row.kind] ?? row.kind}</td>
                <td>{row.to}</td>
                <td>{row.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            if (confirm(t.admin.emailConfirm.replace('{count}', String(waiting)))) void run('release');
          }}
        >
          {waiting === 0
            ? t.admin.emailNothing
            : t.admin.emailRelease.replace('{count}', String(waiting))}
        </button>
        {unsent > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={() => run('retry')}>
            {t.admin.emailRetry.replace('{count}', String(unsent))}
          </button>
        )}
      </div>

      <Result ok={note} error={error} />

      <h3 className="card__subtitle">{t.admin.messageTitle}</h3>
      <WriteToSpeaker cfpId={cfpId} replyTo={settings.replyTo} onSent={() => run('preview')} />

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
            <table className="table">
              <thead>
                <tr>
                  <th>{t.admin.emailTo}</th>
                  <th>{t.admin.emailKind}</th>
                  <th>{t.admin.emailStatusColumn}</th>
                  <th>{t.admin.emailSentAt}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => !filter || r.status === filter)
                  .map((row) => (
                    <tr key={row.logId}>
                      <td>{row.to}</td>
                      <td>
                        {t.admin.emailKinds[row.kind] ?? row.kind}
                        {/* Two messages to the same speaker are otherwise the
                            same row twice. */}
                        {row.subject && <span className="muted"> — {row.subject}</span>}
                      </td>
                      <td>
                        {(t.admin.emailStatus as Record<string, string>)[row.status] ?? row.status}
                        {/* The provider's reason: the only thing on screen that
                            says what to fix. */}
                        {row.error && <span className="muted"> — {row.error}</span>}
                      </td>
                      <td>{row.sentAt ? formatDate(new Date(row.sentAt), locale) : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy || row.status === 'queued' || row.status === 'sending'}
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
}: {
  cfpId: string;
  replyTo: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [proposalId, setProposalId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        // Drafts are excluded: writing to someone about a talk they have not
        // submitted tells them it was read.
        const sendable = (await loadAllProposals(cfpId)).filter((row) => row.status !== 'draft');
        setRows(sendable);
      } catch (e) {
        setError(adminError(e, t));
      }
    })();
  }, [cfpId, t]);

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

    setBusy(true);
    setNote('');
    setError('');
    try {
      await sendSpeakerMessage({ cfpId, proposalId, subject, body });
      setSubject('');
      setBody('');
      setNote(t.admin.messageSent.replace('{name}', to));
      onSent();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) return <p className="muted">{t.admin.messageNoTalks}</p>;

  return (
    <>
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
    </>
  );
}
