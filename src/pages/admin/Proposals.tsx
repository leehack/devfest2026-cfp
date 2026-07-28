import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../../i18n';
import { adminError } from '../../lib/errors';
import {
  headshotImage,
  loadAllProposals,
  loadSpeakers,
  recomputeAggregates,
  setProposalStatus,
  type ProposalRow,
  type SpeakerBrief,
} from '../../lib/roles';
import { BarChart, ScoreHistogram, StackedBar } from '../../components/charts';
import { CATEGORIES, DELIVERY_LANGUAGES, STATUS_SETS, inStatusSet } from '@shared/enums';
import { localised, type Answers, type ConfirmField } from '@shared/confirmForm';
import { loadConfirmForm } from '../../lib/proposals';
import { Result } from './Result';

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

export function Proposals() {
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
