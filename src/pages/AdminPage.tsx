import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { Checkbox, SelectField, TextField } from '../components/fields';
import { useI18n } from '../i18n';
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
  revokeRole,
  setCfpWindow,
  setEmailSettings,
  setProposalStatus,
  type HeldEmail,
  type Person,
  type ProposalRow,
  type SpeakerBrief,
} from '../lib/roles';
import { BarChart, ScoreHistogram, StackedBar } from '../components/charts';
import { EmailSetup } from '../components/EmailSetup';
import { EmailPreview } from '../components/EmailPreview';
import {
  CATEGORIES,
  DELIVERY_LANGUAGES,
  ROLES,
  STATUS_SETS,
  inStatusSet,
  type Role,
} from '@shared/enums';
import {
  EMPTY_SETTINGS,
  validateSettings,
  type EmailSettings,
} from '@shared/emailSettings';
import type { TemplateOverrides } from '@shared/emailTemplates';
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
      <Email />
    </>
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
  const { t } = useI18n();
  const [tally, setTally] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<HeldEmail[]>([]);
  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS);
  const [keyHint, setKeyHint] = useState('');
  const [domainId, setDomainId] = useState('');
  const [templates, setTemplates] = useState<TemplateOverrides>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [senderNote, setSenderNote] = useState('');
  const [senderError, setSenderError] = useState('');
  const editing = useRef(false);

  const run = useCallback(
    async (action: 'preview' | 'release' | 'retry') => {
      setBusy(true);
      setError('');
      if (action !== 'preview') setNote('');
      try {
        const { data } = await emailQueue({ action });
        setTally(data.tally ?? {});
        // Never over the top of someone mid-sentence: this load is async, and
        // an admin who starts typing before it lands would otherwise watch the
        // field empty itself under the cursor.
        if (data.settings && !editing.current) setSettings(data.settings);
        setKeyHint(data.keyHint ?? '');
        setDomainId(data.domainId ?? '');
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

  const waiting = count('held');
  // A `dry_run` row is a message that was never sent, so it belongs with the
  // failures on the retry button rather than looking like a delivery.
  const unsent = count('failed') + count('dry_run');

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
      <p className="field__help">{t.admin.emailFromHelp}</p>

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
        <table className="table">
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
    </section>
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const all = await loadAllProposals();
      setRows(all);
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
              <li key={row.id} className="people__row">
                <span>
                  <strong>{names(row) || '—'}</strong>
                  <span className="people__meta">
                    {row.title}
                    {row.aggregate && ` · ${row.aggregate.avgScore.toFixed(2)}`}
                  </span>
                </span>
                <span className="muted">{t.enums.status[row.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
