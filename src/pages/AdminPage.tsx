import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { Checkbox, SelectField, TextAreaField, TextField } from '../components/fields';
import { formatDate, useI18n } from '../i18n';
import { toDate, toDateTimeInput } from '../lib/dates';
import { adminError } from '../lib/errors';
import {
  emailQueue,
  grantRole,
  loadAllProposals,
  loadCfpConfig,
  loadCommittee,
  loadSpeakers,
  recomputeAggregates,
  headshotImage,
  revokeRole,
  sendSpeakerMessage,
  setCfpWindow,
  setEmailSettings,
  setProposalStatus,
  type EmailRow,
  type HeldEmail,
  type Person,
  type ProposalRow,
  type SpeakerBrief,
} from '../lib/roles';
import { BarChart, ScoreHistogram, StackedBar } from '../components/charts';
import { EmailSetup } from '../components/EmailSetup';
import { EmailPreview } from '../components/EmailPreview';
import { ConfirmFormEditor } from '../components/ConfirmFormEditor';
import {
  CATEGORIES,
  DELIVERY_LANGUAGES,
  LIMITS,
  ROLES,
  STATUS_SETS,
  inStatusSet,
  type Role,
} from '@shared/enums';
import {
  EMPTY_SETTINGS,
  senderMismatch,
  validateSettings,
  type EmailSettings,
} from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
import { localised, type Answers, type ConfirmField } from '@shared/confirmForm';
import { loadConfirmForm } from '../lib/proposals';
import type { RoleGrant } from '@shared/types';

function Result({ ok, error }: { ok: string; error: string }) {
  return (
    <>
      {ok && <p className="note note--inline">{ok}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function AdminPage({ user }: { user: User }) {
  return (
    <>
      <People user={user} />
      <Window />
      <Proposals />
      <ConfirmQuestions />
      <Email />
    </>
  );
}

/**
 * What a speaker is asked once they accept. Its own section rather than part of
 * Proposals: it is set up once at the start of a round and then left alone,
 * while the table above it is worked through every day.
 */
function ConfirmQuestions() {
  const { t } = useI18n();
  const [fields, setFields] = useState<ConfirmField[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setFields((await loadConfirmForm()).fields);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="section">
      <h2>{t.admin.form}</h2>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {/* Mounted only once the stored form has arrived, so the editor seeds
          itself from it. Not re-keyed afterwards: it owns the list from then
          on, and remounting would throw away what is being typed. */}
      {fields === null ? <p className="muted">{t.app.loading}</p> : <ConfirmFormEditor fields={fields} />}
    </section>
  );
}

// ----------------------------------------------------------------- committee

function People({ user }: { user: User }) {
  const { t } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<RoleGrant[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reviewer');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const committee = await loadCommittee();
      setPeople(committee.people);
      setPending(committee.pending);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await grantRole({ email, role });
      setNote(data.applied ? t.admin.granted(data.email) : t.admin.invited(data.email));
      setEmail('');
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (!window.confirm(t.admin.revokeConfirm(target))) return;
    setNote('');
    setError('');
    try {
      await revokeRole({ email: target });
      setNote(t.admin.revoked(target));
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    }
  }

  return (
    <section className="section">
      <h2>{t.admin.people}</h2>
      <p className="section__help">{t.admin.peopleHelp}</p>

      {people.length === 0 && pending.length === 0 ? (
        <p className="muted">{t.admin.noPeople}</p>
      ) : (
        <ul className="people">
          {people.map((person) => (
            <li key={person.uid} className="people__row">
              <span>
                <strong>{person.name ?? person.email}</strong>
                <span className="people__meta">
                  {t.enums.role[person.role]}
                  {person.uid === user.uid && ` · ${t.admin.isYou}`}
                </span>
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => remove(person.email)}>
                {t.admin.revoke}
              </button>
            </li>
          ))}
          {pending.map((grant) => (
            <li key={grant.email} className="people__row">
              <span>
                <strong>{grant.email}</strong>
                <span className="people__meta">
                  {t.enums.role[grant.role]} · {t.admin.awaitingSignIn}
                </span>
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => remove(grant.email)}>
                {t.admin.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid--2">
        <TextField
          label={t.admin.emailLabel}
          type="email"
          value={email}
          onChange={setEmail}
          required
          disabled={busy}
        />
        <SelectField
          label={t.admin.roleLabel}
          value={role}
          options={ROLES.map((r) => ({ value: r, label: t.enums.role[r] }))}
          onChange={setRole}
          required
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !email.trim()}
        onClick={invite}
      >
        {busy ? t.admin.inviting : t.admin.invite}
      </button>

      <Result ok={note} error={error} />
    </section>
  );
}

// -------------------------------------------------------------------- window

function Window() {
  const { t } = useI18n();
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [paused, setPaused] = useState(false);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const config = await loadCfpConfig();
      if (!config) return;
      setOpensAt(toDateTimeInput(toDate(config.opensAt)));
      setClosesAt(toDateTimeInput(toDate(config.closesAt)));
      setPaused(config.paused === true);
      setReviewsVisible(config.reviewsVisible === true);
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      // ISO, so the server stores an instant rather than a wall-clock time in
      // whichever zone the admin happens to be sitting in.
      await setCfpWindow({
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        paused,
        reviewsVisible,
      });
      setNote(t.admin.windowSaved);
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>{t.admin.window}</h2>

      <div className="grid grid--2">
        <TextField
          label={t.admin.opensAtLabel}
          type="datetime-local"
          value={opensAt}
          onChange={setOpensAt}
          required
          disabled={busy}
        />
        <TextField
          label={t.admin.closesAtLabel}
          type="datetime-local"
          value={closesAt}
          onChange={setClosesAt}
          required
          disabled={busy}
        />
      </div>

      <Checkbox label={t.admin.pausedLabel} checked={paused} onChange={setPaused} disabled={busy} />
      <p className="field__help">{t.admin.pausedHelp}</p>

      <Checkbox
        label={t.admin.reviewsVisibleLabel}
        checked={reviewsVisible}
        onChange={setReviewsVisible}
        disabled={busy}
      />
      <p className="field__help">{t.admin.reviewsVisibleHelp}</p>

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !opensAt || !closesAt}
        onClick={save}
      >
        {t.admin.saveWindow}
      </button>

      <Result ok={note} error={error} />
    </section>
  );
}

// --------------------------------------------------------------------- email

/**
 * §8: preview before the first real batch. Decision mail is queued `held` as
 * each decision is made and sits there until someone releases the lot — so the
 * dangerous button is the one that says how many people it is about to write to.
 */
function Email() {
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
        const { data } = await emailQueue({ action, ...(logId ? { logId } : {}) });
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
          const { data: after } = await emailQueue({ action: 'preview' });
          setTally(after.tally ?? {});
          setHeld(after.held ?? []);
        }
      } catch (e) {
        setError(adminError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [t],
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
      await emailQueue({ action: 'resend', logId: row.logId });
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

    setBusy(true);
    try {
      await setEmailSettings(settings);
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

      <EmailSetup keyHint={keyHint} domainId={domainId} onKeySet={setKeyHint} />

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
      <TextField
        label={t.admin.emailPublicUrl}
        help={t.admin.emailPublicUrlHelp}
        placeholder={t.admin.emailPublicUrlPlaceholder}
        value={settings.publicUrl}
        onChange={(publicUrl) => {
          editing.current = true;
          setSettings((s) => ({ ...s, publicUrl }));
        }}
        disabled={busy}
      />
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
      <WriteToSpeaker replyTo={settings.replyTo} onSent={() => run('preview')} />

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
function WriteToSpeaker({ replyTo, onSent }: { replyTo: string; onSent: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [speakers, setSpeakers] = useState<Map<string, SpeakerBrief>>(new Map());
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
        const sendable = (await loadAllProposals()).filter((row) => row.status !== 'draft');
        setRows(sendable);
        setSpeakers(await loadSpeakers(sendable.flatMap((row) => row.speakerIds ?? [])));
      } catch (e) {
        setError(adminError(e, t));
      }
    })();
  }, [t]);

  const nameOf = (row?: ProposalRow) =>
    (row?.speakerIds ?? [])
      .map((id) => speakers.get(id)?.name)
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
      await sendSpeakerMessage({ proposalId, subject, body });
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

/**
 * One headshot, fetched only when an organiser asks for it.
 *
 * The bucket is closed, so this goes through an admin-only callable that hands
 * back the bytes. Behind a button rather than eager: the photos arrive inline,
 * and a page of forty accepted speakers would otherwise pull forty of them —
 * most of which nobody looks at — every time it loads.
 */
function Headshot({ speakerUid, fieldKey }: { speakerUid: string; fieldKey: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function show() {
    setBusy(true);
    setError('');
    try {
      const { data } = await headshotImage({ speakerUid, key: fieldKey });
      setUrl(data.dataUrl);
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (url) return <img className="headshot__preview" src={url} alt="" />;
  return (
    <>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={show}>
        {busy ? t.app.loading : t.admin.formViewPhoto}
      </button>
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** What one speaker answered, labelled by the questions as they stand now. */
function Answered({
  fields,
  answers,
  speakerUid,
}: {
  fields: ConfirmField[];
  answers?: Answers;
  speakerUid?: string;
}) {
  const { t, locale } = useI18n();
  if (!answers || fields.length === 0) return null;

  // A field added after someone confirmed has no answer from them, and showing
  // an empty row for it reads as "they skipped it" rather than "we never asked".
  const given = fields.filter((field) => answers[field.key] !== undefined);
  if (given.length === 0) return null;

  return (
    <dl className="answers">
      {given.map((field) => (
        <div key={field.key}>
          <dt>{localised(field.label, locale)}</dt>
          <dd>
            {field.type === 'image' ? (
              speakerUid ? (
                <Headshot speakerUid={speakerUid} fieldKey={field.key} />
              ) : null
            ) : typeof answers[field.key] === 'boolean' ? (
              answers[field.key] ? (
                t.admin.formYes
              ) : (
                t.admin.formNo
              )
            ) : (
              String(answers[field.key])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------- proposals



/**
 * The shape of the round at a glance: where the decisions stand, how the scores
 * fell, and which tracks are thin. Drafts are excluded throughout — an
 * unsubmitted talk is not part of the programme yet.
 */
function Dashboard({ rows }: { rows: ProposalRow[] }) {
  const { t } = useI18n();
  const live = rows.filter((r) => r.status !== 'draft' && r.status !== 'withdrawn');
  if (live.length === 0) return null;

  const countBy = <T extends string>(keys: readonly T[], of: (row: ProposalRow) => T) => {
    const tally = new Map<T, number>(keys.map((k) => [k, 0]));
    for (const row of live) tally.set(of(row), (tally.get(of(row)) ?? 0) + 1);
    return keys.map((k) => ({ key: k, value: tally.get(k) ?? 0 }));
  };

  const decisions = [
    { label: t.enums.status.accepted, value: live.filter((r) => r.status === 'accepted' || r.status === 'confirmed').length },
    { label: t.enums.status.waitlisted, value: live.filter((r) => r.status === 'waitlisted').length },
    { label: t.enums.status.rejected, value: live.filter((r) => r.status === 'rejected').length },
    { label: t.admin.undecided, value: live.filter((r) => !inStatusSet('decided', r.status)).length },
  ];

  // Rounded to the nearest whole score: the histogram answers "what did the
  // committee think", and 2.5 buckets would answer nothing.
  const scored = live.filter((r) => r.aggregate && r.aggregate.reviewCount > 0);
  const histogram = [1, 2, 3, 4].map(
    (score) => scored.filter((r) => Math.round(r.aggregate!.avgScore) === score).length,
  );

  return (
    <section className="section">
      <h2>{t.admin.overview}</h2>

      <div className="grid grid--3 cards">
        <div className="card card--stat">
          <h3>{t.admin.chartDecisions}</h3>
          <StackedBar data={decisions} />
        </div>

        <div className="card card--stat">
          <h3>{t.admin.chartScores}</h3>
          <ScoreHistogram counts={histogram} />
          <p className="muted">
            {scored.length === live.length
              ? t.admin.allScored
              : t.admin.someUnscored(live.length - scored.length)}
          </p>
        </div>

        <div className="card card--stat">
          <h3>{t.admin.chartLanguages}</h3>
          <BarChart
            data={countBy(DELIVERY_LANGUAGES, (r) => r.deliveryLanguage).map((d) => ({
              label: t.enums.deliveryLanguage[d.key],
              value: d.value,
            }))}
          />
        </div>
      </div>

      <div className="card card--stat">
        <h3>{t.admin.chartCategories}</h3>
        <BarChart
          data={countBy(CATEGORIES, (r) => r.category).map((d) => ({
            label: t.enums.category[d.key],
            value: d.value,
          }))}
        />
      </div>
    </section>
  );
}

function Proposals() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [speakers, setSpeakers] = useState<Map<string, SpeakerBrief>>(new Map());
  const [questions, setQuestions] = useState<ConfirmField[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [all, form] = await Promise.all([loadAllProposals(), loadConfirmForm()]);
      setRows(all);
      setQuestions(form.fields);
      setSpeakers(await loadSpeakers(all.flatMap((p) => p.speakerIds ?? [])));
    } catch (e) {
      setError(adminError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function recompute() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const { data } = await recomputeAggregates();
      setNote(t.admin.recomputed(data.proposalCount, data.reviewCount));
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function decide(proposalId: string, status: string) {
    setNote('');
    setError('');
    try {
      await setProposalStatus({ proposalId, status });
      await refresh();
    } catch (e) {
      setError(adminError(e, t));
    }
  }

  const names = (row: ProposalRow) =>
    (row.speakerIds ?? [])
      .map((id) => speakers.get(id)?.name)
      .filter(Boolean)
      .join(', ');

  // Best first — the decision is made top-down, and an unscored proposal has
  // no claim on the top of the list.
  const ranked = [...rows].sort(
    (a, b) => (b.aggregate?.avgScore ?? -1) - (a.aggregate?.avgScore ?? -1),
  );
  const accepted = ranked.filter((row) => row.status === 'accepted' || row.status === 'confirmed');
  const decidable = ranked.filter((row) => row.status !== 'draft' && row.status !== 'withdrawn');

  return (
    <>
      <section className="section">
        <h2>{t.admin.proposals}</h2>
        <p className="section__help">{t.admin.proposalsHelp}</p>

        {rows.length === 0 ? (
          <p className="muted">{t.admin.noProposals}</p>
        ) : (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.admin.colTitle}</th>
                  <th>{t.admin.colSpeaker}</th>
                  <th>{t.admin.colScore}</th>
                  <th>{t.admin.colReviews}</th>
                  <th>{t.admin.colSpread}</th>
                  <th>{t.admin.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title || '—'}</td>
                    <td>{names(row) || '—'}</td>
                    <td>{row.aggregate ? row.aggregate.avgScore.toFixed(2) : '—'}</td>
                    <td>{row.aggregate?.reviewCount ?? 0}</td>
                    <td>{row.aggregate ? row.aggregate.stdDev.toFixed(2) : '—'}</td>
                    <td>
                      {row.status === 'draft' || row.status === 'withdrawn' ? (
                        <span className="muted">{t.enums.status[row.status]}</span>
                      ) : (
                        <select
                          className="field__input field__input--select"
                          aria-label={`${t.admin.colStatus}: ${row.title}`}
                          value={row.status}
                          onChange={(e) => decide(row.id, e.target.value)}
                        >
                          {STATUS_SETS.decidable.map((s) => (
                            <option key={s} value={s}>
                              {t.enums.status[s]}
                            </option>
                          ))}
                          {!inStatusSet('decidable', row.status) && (
                            <option value={row.status} disabled>
                              {t.enums.status[row.status]}
                            </option>
                          )}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button type="button" className="btn btn--ghost" disabled={busy} onClick={recompute}>
          {busy ? t.admin.recomputing : t.admin.recompute}
        </button>

        <Result ok={note} error={error} />
      </section>

      <Dashboard rows={rows} />

      <section className="section">
        <h2>{t.admin.results}</h2>
        <p className="section__help">
          {t.admin.tally(
            decidable.length,
            accepted.length,
            ranked.filter((r) => r.status === 'waitlisted').length,
            ranked.filter((r) => inStatusSet('decided', r.status)).length,
          )}
        </p>

        {accepted.length === 0 ? (
          <p className="muted">{t.admin.noneAccepted}</p>
        ) : (
          <ul className="people">
            {accepted.map((row) => (
              <li key={row.id} className="people__row people__row--stack">
                <span className="people__who">
                  <span>
                    <strong>{names(row) || '—'}</strong>
                    <span className="people__meta">
                      {row.title}
                      {row.aggregate && ` · ${row.aggregate.avgScore.toFixed(2)}`}
                    </span>
                  </span>
                  <span className="muted">{t.enums.status[row.status]}</span>
                </span>
                {/* The whole reason for asking. Without it an organiser reads
                    shirt sizes out of the Firestore console. */}
                <Answered
                  fields={questions}
                  answers={row.confirmAnswers}
                  speakerUid={(row.speakerIds ?? [])[0]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
