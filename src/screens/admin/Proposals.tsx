import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Link } from '../../components/Link';
import { CoSpeakerRosterDialog } from '../../components/CoSpeakerRoster';
import { useI18n } from '../../i18n/context';
import { adminError } from '../../lib/errors';
import { href } from '../../lib/router';
import {
  headshotImage,
  loadAllProposals,
  reviewCoverage,
  setProposalStatus,
  type ProposalRow,
  type ReviewCoverageResult,
} from '../../lib/roles';
import { BarChart, ScoreHistogram, StackedBar } from '../../components/charts';
import {
  PROPOSAL_STATUSES,
  STATUS_SETS,
  inStatusSet,
  type ProposalStatus,
} from '@shared/enums';
import {
  SPEAKER_PHOTO_KEY,
  localised,
  type Answers,
  type ConfirmField,
} from '@shared/confirmForm';
import { loadConfirmForm, loadSubmissionForm } from '../../lib/proposals';
import { invalidateCache } from '../../lib/cache';
import {
  DEFAULT_SUBMISSION_FORM,
  labelOf,
  optionValues,
  type SubmissionForm,
} from '@shared/submissionForm';
import { downloadSelectedSpeakersCsv } from './proposalExport';
import { Result } from './Result';
import { DECISION_KINDS } from '@shared/emailTemplates';
import { compareNormalizedScores } from '@shared/aggregate';
import type { SpeakerSnapshot } from '@shared/types';
import { reconcileProposalSpeakerSnapshot } from './proposalSnapshots';
import {
  listSpeakerProfileUpdateRequests,
  type ProfileUpdateRequestSummary,
} from '../../lib/profileUpdateRequests';
import {
  profileUpdateRequestsByProposal,
  proposalHasProfileUpdateAttention,
  type ProfileUpdateRequestAttention,
} from '../../lib/profileUpdateRequestSummary';
import {
  invalidateProposalUndoHistory,
  type UndoDecision,
} from './proposalDecisionUndo';

const HIGH_DISAGREEMENT = 1;
const ADMIN_PROPOSAL_STATUSES = STATUS_SETS.adminSettable;

/**
 * One headshot, fetched only when an organiser asks for it.
 *
 * The bucket is closed, so this goes through an admin-only callable that hands
 * back the bytes. Behind a button rather than eager: the photos arrive inline,
 * and a page of forty accepted speakers would otherwise pull forty of them —
 * most of which nobody looks at — every time it loads.
 */
function Headshot({
  cfpId,
  proposalId,
  fieldKey,
  speakerUid,
}: {
  cfpId: string;
  proposalId: string;
  fieldKey: string;
  speakerUid?: string;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function show() {
    setBusy(true);
    setError('');
    try {
      const { data } = await headshotImage({
        cfpId,
        proposalId,
        key: fieldKey,
        ...(speakerUid ? { speakerUid } : {}),
      });
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

/** What one speaker answered, including questions retired after they answered. */
function Answered({
  cfpId,
  fields,
  answers,
  proposalId,
  speakerUid,
  title,
}: {
  cfpId: string;
  fields: ConfirmField[];
  answers?: Answers;
  proposalId?: string;
  speakerUid?: string;
  title: string;
}) {
  const { t, locale } = useI18n();
  if (!answers) return null;

  // A field added after someone confirmed has no answer from them, and showing
  // an empty row for it reads as "they skipped it" rather than "we never asked".
  // A removed field is different: the answer is still operational data, so keep
  // it under its stable key instead of making it disappear with today's form.
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const given = Object.keys(answers)
    .filter((key) => answers[key] !== undefined)
    .map((key) => ({ key, field: byKey.get(key), value: answers[key] }));
  if (given.length === 0) return null;

  return (
    <>
      <h4 className="card__subtitle">{title}</h4>
      <dl className="answers">
      {given.map(({ key, field, value }) => {
        const storedImage =
          typeof value === 'string' &&
          (value.startsWith(`cfps/${cfpId}/headshots/`) ||
            value.startsWith(`cfps/${cfpId}/confirmedHeadshots/`));
        return (
        <div key={key}>
          <dt>{field ? localised(field.label, locale) : <code className="mono">{key}</code>}</dt>
          <dd>
            {field?.type === 'image' || storedImage ? (
              proposalId ? (
                <Headshot
                  cfpId={cfpId}
                  proposalId={proposalId}
                  fieldKey={key}
                  speakerUid={speakerUid}
                />
              ) : null
            ) : typeof value === 'boolean' ? (
              value ? (
                t.admin.formYes
              ) : (
                t.admin.formNo
              )
            ) : (
              String(value)
            )}
          </dd>
        </div>
        );
      })}
      </dl>
    </>
  );
}

function SpeakerConfirmations({
  cfpId,
  row,
  fields,
}: {
  cfpId: string;
  row: ProposalRow;
  fields: ConfirmField[];
}) {
  const { t } = useI18n();
  const ids = row.speakerIds ?? [];
  const perSpeaker = Boolean(row.primarySpeakerId) || ids.length > 1;
  if (!perSpeaker) {
    return (
      <>
        {row.speakerPhoto && (
          <>
            <h4 className="card__subtitle">{t.profilePhoto.title}</h4>
            <Headshot cfpId={cfpId} proposalId={row.id} fieldKey={SPEAKER_PHOTO_KEY} />
          </>
        )}
        <Answered
          cfpId={cfpId}
          fields={fields}
          answers={row.confirmAnswers}
          proposalId={row.id}
          title={t.admin.form}
        />
      </>
    );
  }

  const snapshots = row.speakerSnapshot ?? [];
  return (
    <div className="speaker-confirmations">
      {ids.map((uid, index) => {
        const confirmation = row.speakerConfirmations?.find((item) => item.uid === uid);
        const name = snapshots[index]?.name || uid;
        const response = confirmation?.response;
        return (
          <section className="speaker-confirmation" key={uid}>
            <header className="speaker-confirmation__header">
              <h4>{t.coSpeakers.confirmationFor(name)}</h4>
              <span
                className={`status-chip${response ? ` status-chip--${response}` : ''}`}
              >
                {response ? t.enums.status[response] : t.coSpeakers.awaitingConfirmation}
              </span>
            </header>
            <Answered
              cfpId={cfpId}
              fields={fields}
              answers={confirmation?.answers as Answers | undefined}
              proposalId={row.id}
              speakerUid={uid}
              title={t.admin.form}
            />
            {confirmation?.speakerPhoto && (
              <div className="speaker-confirmation__photo">
                <h5>{t.profilePhoto.title}</h5>
                <Headshot
                  cfpId={cfpId}
                  proposalId={row.id}
                  fieldKey={SPEAKER_PHOTO_KEY}
                  speakerUid={uid}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The facts an organiser needs after a decision, while building the programme. */
function OperationalDetails({ row, shape }: { row: ProposalRow; shape: SubmissionForm }) {
  const { t, locale } = useI18n();
  const speakers = row.speakerSnapshot ?? [];
  const delivery = labelOf(shape.deliveryLanguage, row.deliveryLanguage, locale);
  const scheduledDelivery = row.assignedLanguage
    ? `${delivery} → ${labelOf(shape.deliveryLanguage, row.assignedLanguage, locale)}`
    : delivery;
  const attendanceTitle = localised(shape.attendance.title, locale) || t.review.travel;
  const fundingLabel =
    localised(shape.attendance.fundingSource.label, locale) || t.review.funding;
  const decisionLabel =
    localised(shape.attendance.decisionBy.label, locale) || t.review.decisionBy;
  const visaLabel = localised(shape.attendance.needsVisa.label, locale) || t.review.visa;
  const socials = speakers
    .flatMap((speaker) =>
      (speaker.socials ?? []).map((social) => `${social.platform}: ${social.handle}`),
    )
    .join(' · ');
  const sessionize = speakers
    .map((speaker) => speaker.sessionizeUrl)
    .filter(Boolean)
    .join('; ');
  const pastTalks = speakers
    .map((speaker) => speaker.pastTalks)
    .filter(Boolean)
    .join('\n\n');
  const values = ([
    [t.proposal.abstract, row.abstract],
    row.pitch ? [t.proposal.pitch, row.pitch] : null,
    [t.proposal.category, labelOf(shape.category, row.category, locale)],
    [t.proposal.format, labelOf(shape.format, row.format, locale)],
    [t.proposal.level, labelOf(shape.level, row.level, locale)],
    [t.language.delivery, scheduledDelivery],
    row.languagePreference ? [t.review.languagePreference, row.languagePreference] : null,
    shape.attendance.enabled && row.attendance?.status
      ? [attendanceTitle, labelOf(shape.attendance.statuses, row.attendance.status, locale)]
      : null,
    shape.attendance.enabled &&
    shape.attendance.fundingSource.enabled &&
    row.attendance?.fundingSource
      ? [fundingLabel, row.attendance.fundingSource]
      : null,
    shape.attendance.enabled &&
    shape.attendance.decisionBy.enabled &&
    row.attendance?.decisionBy
      ? [decisionLabel, row.attendance.decisionBy]
      : null,
    shape.attendance.enabled &&
    shape.attendance.needsVisa.enabled &&
    typeof row.attendance?.needsVisa === 'boolean'
      ? [visaLabel, row.attendance.needsVisa ? t.admin.formYes : t.admin.formNo]
      : null,
    speakers.some((speaker) => speaker.company)
      ? [t.speaker.company, speakers.map((speaker) => speaker.company).filter(Boolean).join('; ')]
      : null,
    speakers.some((speaker) => speaker.jobTitle)
      ? [t.speaker.jobTitle, speakers.map((speaker) => speaker.jobTitle).filter(Boolean).join('; ')]
      : null,
    speakers.some((speaker) => speaker.basedIn)
      ? [t.speaker.basedIn, speakers.map((speaker) => speaker.basedIn).filter(Boolean).join('; ')]
      : null,
    speakers.some((speaker) => speaker.bio)
      ? [t.speaker.bio, speakers.map((speaker) => speaker.bio).filter(Boolean).join('\n\n')]
      : null,
    speakers.some((speaker) => speaker.isGde)
      ? [t.speaker.isGde, t.admin.formYes]
      : null,
    pastTalks ? [t.speaker.pastTalks, pastTalks] : null,
    sessionize ? [t.speaker.sessionizeUrl, sessionize] : null,
    socials ? [t.speaker.socials, socials] : null,
  ] as Array<[string, string] | null>).filter(
    (value): value is [string, string] => value !== null && Boolean(value[1]),
  );

  const personalLogistics = (row.speakerParticipants ?? []).map((participant) => {
    const index = (row.speakerIds ?? []).indexOf(participant.uid);
    return {
      ...participant,
      name: speakers[index]?.name || participant.uid,
    };
  });

  return (
    <>
      <dl className="answers">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {personalLogistics.length > 0 && (
        <div className="speaker-logistics">
          {personalLogistics.map((participant) => {
            const attendance = participant.attendance;
            return (
              <section key={participant.uid} className="speaker-logistics__person">
                <h4>
                  {participant.name}{' '}
                  <span className="muted">
                    · {participant.role === 'primary' ? t.coSpeakers.lead : t.coSpeakers.joined}
                  </span>
                </h4>
                <dl className="answers">
                  {shape.attendance.enabled && attendance?.status && (
                    <div>
                      <dt>{attendanceTitle}</dt>
                      <dd>{labelOf(shape.attendance.statuses, attendance.status, locale)}</dd>
                    </div>
                  )}
                  {shape.attendance.enabled &&
                    shape.attendance.fundingSource.enabled &&
                    attendance?.fundingSource && (
                    <div><dt>{fundingLabel}</dt><dd>{attendance.fundingSource}</dd></div>
                  )}
                  {shape.attendance.enabled &&
                    shape.attendance.decisionBy.enabled &&
                    attendance?.decisionBy && (
                    <div><dt>{decisionLabel}</dt><dd>{attendance.decisionBy}</dd></div>
                  )}
                  {shape.attendance.enabled &&
                    shape.attendance.needsVisa.enabled &&
                    typeof attendance?.needsVisa === 'boolean' && (
                    <div>
                      <dt>{visaLabel}</dt>
                      <dd>{attendance.needsVisa ? t.admin.formYes : t.admin.formNo}</dd>
                    </div>
                  )}
                  {shape.acks.map((ack) => (
                    <div key={ack.key}>
                      <dt>{localised(ack.label, locale)}</dt>
                      <dd>{participant.acks?.[ack.key] ? t.admin.formYes : t.admin.formNo}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The shape of the round at a glance: where the decisions stand, how the scores
 * fell, and which tracks are thin. Drafts are excluded throughout — an
 * unsubmitted talk is not part of the programme yet.
 */
function Dashboard({ rows, shape }: { rows: ProposalRow[]; shape: SubmissionForm }) {
  const { t, locale } = useI18n();
  const live = rows.filter((r) => r.status !== 'draft' && r.status !== 'withdrawn');
  if (live.length === 0) return null;

  /*
   * The buckets come from this call's own form, so a category nobody offered is
   * not charted as a zero. A stored value the form no longer lists still has to
   * appear somewhere — those talks were submitted in good faith — so anything
   * unaccounted for is appended after the configured order.
   */
  const countBy = (keys: readonly string[], of: (row: ProposalRow) => string) => {
    const tally = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const row of live) tally.set(of(row), (tally.get(of(row)) ?? 0) + 1);
    return [...tally].map(([key, value]) => ({ key, value }));
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
  const decided = live.filter((r) => inStatusSet('decided', r.status));
  const disagreement = scored.filter(
    (row) => (row.aggregate?.stdDev ?? 0) >= HIGH_DISAGREEMENT,
  );
  const histogram = [1, 2, 3, 4].map(
    (score) => scored.filter((r) => Math.round(r.aggregate!.avgScore) === score).length,
  );

  return (
    <section className="section proposal-dashboard">
      <div className="proposal-dashboard__heading">
        <div>
          <h2>{t.admin.overview}</h2>
          <p className="section__help">{t.admin.overviewHelp}</p>
        </div>
      </div>

      <div className="selection-metrics" aria-label={t.admin.overview}>
        <div className="selection-metric">
          <span>{t.admin.metricInRound}</span>
          <strong>{live.length}</strong>
        </div>
        <div className="selection-metric">
          <span>{t.admin.metricScored}</span>
          <strong>{scored.length}</strong>
        </div>
        <div className="selection-metric">
          <span>{t.admin.metricUndecided}</span>
          <strong>{live.length - decided.length}</strong>
        </div>
        <div className="selection-metric">
          <span>{t.admin.metricDisagreement}</span>
          <strong>{disagreement.length}</strong>
        </div>
      </div>

      <div className="grid grid--3 cards proposal-dashboard__charts">
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
            data={countBy(optionValues(shape.deliveryLanguage), (r) => r.deliveryLanguage).map(
              (d) => ({
                label: labelOf(shape.deliveryLanguage, d.key, locale),
                value: d.value,
              }),
            )}
          />
        </div>
      </div>

      <div className="card card--stat">
        <h3>{t.admin.chartCategories}</h3>
        <BarChart
          data={countBy(optionValues(shape.category), (r) => r.category).map((d) => ({
            label: labelOf(shape.category, d.key, locale),
            value: d.value,
          }))}
        />
      </div>
    </section>
  );
}

type ScoreFilter = 'all' | 'scored' | 'unscored' | 'disagreement';
type ProposalSort = 'score' | 'spread' | 'reviews' | 'title' | 'status';
type StatusFilter = 'current' | 'all' | 'undecided' | ProposalStatus;
type ProfileAttentionFilter = 'all' | ProfileUpdateRequestAttention;

function profileRequestSpeakerName(row: ProposalRow | undefined, speakerUid: string): string {
  return (
    row?.speakerSnapshot?.find((speaker) => speaker.uid === speakerUid)?.name ||
    speakerUid
  );
}

function ProfileUpdateQueue({
  rows,
  requests,
  failed,
  onOpen,
  onRetry,
}: {
  rows: ProposalRow[];
  requests: ProfileUpdateRequestSummary[];
  failed: boolean;
  onOpen: (proposalId: string, speakerUid: string) => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const waiting = requests.filter((request) => request.state === 'waiting');
  const ready = requests.filter((request) => request.state === 'ready');
  const ordered = [...ready, ...waiting];

  return (
    <section className="section profile-request-queue" aria-labelledby="profile-request-queue-title">
      <div className="profile-request-queue__heading">
        <div>
          <span className="profile-request-queue__eyebrow">
            {t.profileSnapshot.adminQueueEyebrow}
          </span>
          <h2 id="profile-request-queue-title">{t.profileSnapshot.adminQueueTitle}</h2>
          <p className="section__help">{t.profileSnapshot.adminQueueHelp}</p>
        </div>
        <div className="profile-request-queue__counts" aria-label={t.profileSnapshot.adminQueueTitle}>
          <span className="profile-attention profile-attention--waiting">
            {t.profileSnapshot.waitingCount(waiting.length)}
          </span>
          <span className="profile-attention profile-attention--ready">
            {t.profileSnapshot.readyCount(ready.length)}
          </span>
        </div>
      </div>

      {failed ? (
        <div className="profile-request-queue__empty" role="alert">
          <p>{t.profileSnapshot.adminQueueLoadFailed}</p>
          <button type="button" className="btn btn--ghost btn--small" onClick={onRetry}>
            {t.errors.reload}
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <p className="profile-request-queue__empty">{t.profileSnapshot.adminQueueEmpty}</p>
      ) : (
        <ul className="profile-request-queue__list">
          {ordered.map((request) => {
            const row = byId.get(request.proposalId);
            const name = profileRequestSpeakerName(row, request.speakerUid);
            return (
              <li key={`${request.proposalId}:${request.speakerUid}:${request.generation}`}>
                <span
                  className={`profile-request-queue__state profile-request-queue__state--${request.state}`}
                >
                  {request.state === 'waiting'
                    ? t.profileSnapshot.waitingOnSpeaker
                    : t.profileSnapshot.readyToReview}
                </span>
                <span className="profile-request-queue__identity">
                  <strong>{name}</strong>
                  <span>{row?.title || t.admin.untitled}</span>
                </span>
                <span className="profile-request-queue__scopes">
                  {request.scopes.map((scope) => t.profileSnapshot.scope[scope]).join(' · ')}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-label={t.profileSnapshot.reviewSpeakerRequest(name, row?.title || t.admin.untitled)}
                  onClick={() => onOpen(request.proposalId, request.speakerUid)}
                >
                  {request.state === 'waiting'
                    ? t.profileSnapshot.viewRequest
                    : t.profileSnapshot.reviewReady}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ReviewCoverage({
  coverage,
  loading,
  error,
  onRetry,
}: {
  coverage: ReviewCoverageResult | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const titles = new Map(coverage?.proposals.map((proposal) => [proposal.id, proposal.title]));
  const totals = coverage?.reviewers.reduce(
    (sum, reviewer) => ({
      eligible: sum.eligible + reviewer.eligibleCount,
      scored: sum.scored + reviewer.scoredProposalIds.length,
      conflicts: sum.conflicts + reviewer.conflictProposalIds.length,
      missing: sum.missing + reviewer.missingProposalIds.length,
    }),
    { eligible: 0, scored: 0, conflicts: 0, missing: 0 },
  );

  return (
    <section className="section review-coverage">
      <div className="review-coverage__heading">
        <div>
          <h2>{t.admin.reviewerCoverage}</h2>
          <p className="section__help">{t.admin.reviewerCoverageHelp}</p>
        </div>
      </div>

      {loading ? (
        <p className="muted">{t.app.loading}</p>
      ) : error ? (
        <div className="review-coverage__error">
          <p className="field__error" role="alert">{error}</p>
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            {t.errors.reload}
          </button>
        </div>
      ) : !coverage || coverage.reviewers.length === 0 ? (
        <p className="muted">{t.admin.reviewerCoverageEmpty}</p>
      ) : coverage.proposals.length === 0 ? (
        <p className="muted">{t.admin.reviewerCoverageNoTalks}</p>
      ) : (
        <>
          <div className="review-coverage__metrics" aria-label={t.admin.reviewerCoverage}>
            <div><span>{t.admin.coverageResponses}</span><strong>{(totals?.scored ?? 0) + (totals?.conflicts ?? 0)}/{totals?.eligible ?? 0}</strong></div>
            <div><span>{t.admin.coverageScores}</span><strong>{totals?.scored ?? 0}</strong></div>
            <div><span>{t.admin.coverageConflicts}</span><strong>{totals?.conflicts ?? 0}</strong></div>
            <div><span>{t.admin.coverageWaiting}</span><strong>{totals?.missing ?? 0}</strong></div>
          </div>
          <div className="review-coverage__list">
          {[...coverage.reviewers]
            .sort((a, b) => b.missingProposalIds.length - a.missingProposalIds.length)
            .map((reviewer) => {
            const handled =
              reviewer.scoredProposalIds.length + reviewer.conflictProposalIds.length;
            const complete = reviewer.missingProposalIds.length === 0;
            return (
              <article
                key={reviewer.uid}
                className={`reviewer-progress${complete ? ' reviewer-progress--complete' : ''}`}
              >
                <div className="reviewer-progress__identity">
                  <div>
                    <h3>{reviewer.name || reviewer.email}</h3>
                    {reviewer.name && <p>{reviewer.email}</p>}
                  </div>
                  <span className="status-chip">{t.enums.role[reviewer.role]}</span>
                </div>

                <div className="reviewer-progress__summary">
                  <strong>{t.admin.reviewerHandled(handled, reviewer.eligibleCount)}</strong>
                  <span>
                    {t.admin.reviewerBreakdown(
                      reviewer.scoredProposalIds.length,
                      reviewer.conflictProposalIds.length,
                      reviewer.missingProposalIds.length,
                    )}
                  </span>
                </div>

                <div
                  className="reviewer-progress__bar"
                  role="progressbar"
                  aria-label={t.admin.reviewerProgressFor(reviewer.name || reviewer.email)}
                  aria-valuemin={0}
                  aria-valuemax={reviewer.eligibleCount}
                  aria-valuenow={handled}
                >
                  <span
                    style={{
                      width: `${reviewer.eligibleCount === 0 ? 100 : (handled / reviewer.eligibleCount) * 100}%`,
                    }}
                  />
                </div>

                {reviewer.missingProposalIds.length > 0 && (
                  <details className="reviewer-progress__missing">
                    <summary>
                      {t.admin.reviewerMissing(reviewer.missingProposalIds.length)}
                    </summary>
                    <ul>
                      {reviewer.missingProposalIds.map((proposalId) => (
                        <li key={proposalId}>{titles.get(proposalId) || t.admin.untitled}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
          </div>
        </>
      )}

      {coverage && coverage.hiddenOwnProposalCount > 0 && (
        <p className="review-coverage__privacy">
          {t.admin.reviewerCoveragePrivate(coverage.hiddenOwnProposalCount)}
        </p>
      )}
    </section>
  );
}

export function Proposals({
  cfpId,
  readOnly = false,
  pendingEmailCount,
  pendingEmailCheckFailed,
  onEmailQueueChange,
}: {
  cfpId: string;
  readOnly?: boolean;
  pendingEmailCount?: number | null;
  pendingEmailCheckFailed?: boolean;
  onEmailQueueChange?: () => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [questions, setQuestions] = useState<ConfirmField[]>([]);
  const [shape, setShape] = useState<SubmissionForm>(DEFAULT_SUBMISSION_FORM);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  const [coverage, setCoverage] = useState<ReviewCoverageResult | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [undo, setUndo] = useState<UndoDecision | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [profileFilter, setProfileFilter] = useState<ProfileAttentionFilter>('all');
  const [sort, setSort] = useState<ProposalSort>('score');
  const [managedProposalId, setManagedProposalId] = useState<string | null>(null);
  const [managedSpeakerUid, setManagedSpeakerUid] = useState<string | null>(null);
  const [profileRequests, setProfileRequests] = useState<ProfileUpdateRequestSummary[]>([]);
  const [profileRequestsFailed, setProfileRequestsFailed] = useState(false);
  const loadGeneration = useRef(0);
  const loadedScope = useRef<string | null>(null);
  const activeCfp = useRef(cfpId);
  const decisionSequence = useRef(0);
  const committedDecisions = useRef<Map<number, UndoDecision>>(new Map());
  activeCfp.current = cfpId;

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const proposalId = search.get('manageSpeakers');
    const speakerUid = search.get('profileSpeaker');
    setManagedProposalId(proposalId?.trim() || null);
    setManagedSpeakerUid(proposalId?.trim() && speakerUid?.trim() ? speakerUid.trim() : null);
  }, [cfpId]);

  const openSpeakerManagement = useCallback((proposalId: string, speakerUid?: string) => {
    setManagedProposalId(proposalId);
    setManagedSpeakerUid(speakerUid ?? null);
    const url = new URL(window.location.href);
    url.searchParams.set('manageSpeakers', proposalId);
    if (speakerUid) url.searchParams.set('profileSpeaker', speakerUid);
    else url.searchParams.delete('profileSpeaker');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const closeSpeakerManagement = useCallback(() => {
    setManagedProposalId(null);
    setManagedSpeakerUid(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('manageSpeakers');
    url.searchParams.delete('profileSpeaker');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const onSnapshotRefreshed = useCallback(
    (speakerUid: string, snapshot: SpeakerSnapshot) => {
      if (!managedProposalId || activeCfp.current !== cfpId) return;
      setRows((current) =>
        reconcileProposalSpeakerSnapshot(current, managedProposalId, speakerUid, snapshot),
      );
    },
    [cfpId, managedProposalId],
  );

  const refresh = useCallback(async (reset = false, force = false) => {
    const request = ++loadGeneration.current;
    setCoverageLoading(true);
    setCoverageError('');
    if (reset) {
      setLoading(true);
      setLoadFailed(false);
      setLoadedFor('');
      setRows([]);
      setQuestions([]);
      setShape(DEFAULT_SUBMISSION_FORM);
      setCoverage(null);
      setCoverageLoading(true);
      setCoverageError('');
      setPending(new Set());
      setRowErrors(new Map());
      setUndo(null);
      setNote('');
      setError('');
      setSearch('');
      setStatusFilter('current');
      setCategoryFilter('all');
      setScoreFilter('all');
      setProfileFilter('all');
      setSort('score');
      setProfileRequests([]);
      setProfileRequestsFailed(false);
      committedDecisions.current.clear();
      decisionSequence.current = 0;
    }
    let revalidatedRows: ProposalRow[] | null = null;
    try {
      const [all, form, submission, updateRequests] = await Promise.all([
        loadAllProposals(cfpId, {
          speakerDetails: true,
          force,
          onRevalidate: (updated) => {
            if (request === loadGeneration.current && activeCfp.current === cfpId) {
              revalidatedRows = updated;
              setRows(updated);
            }
          },
        }),
        loadConfirmForm(cfpId),
        loadSubmissionForm(cfpId),
        readOnly
          ? Promise.resolve({ requests: [] as ProfileUpdateRequestSummary[], failed: false })
          : listSpeakerProfileUpdateRequests({ cfpId })
              .then(({ data }) => ({ requests: data.admin, failed: false }))
              .catch(() => ({ requests: [] as ProfileUpdateRequestSummary[], failed: true })),
      ]);
      if (request !== loadGeneration.current || activeCfp.current !== cfpId) return;
      setRows(revalidatedRows ?? all);
      setQuestions(form.fields);
      setShape(submission);
      setProfileRequests(updateRequests.requests);
      setProfileRequestsFailed(updateRequests.failed);
      setLoadedFor(cfpId);
      setLoadFailed(false);
      setError('');
      void reviewCoverage({ cfpId })
        .then(({ data }) => {
          if (request !== loadGeneration.current || activeCfp.current !== cfpId) return;
          setCoverage(data);
          setCoverageError('');
        })
        .catch((coverageFailure) => {
          if (request !== loadGeneration.current || activeCfp.current !== cfpId) return;
          setCoverageError(adminError(coverageFailure, t));
        })
        .finally(() => {
          if (request === loadGeneration.current && activeCfp.current === cfpId) {
            setCoverageLoading(false);
          }
        });
    } catch (e) {
      if (request !== loadGeneration.current || activeCfp.current !== cfpId) return;
      setError(adminError(e, t));
      setLoadFailed(true);
      setLoadedFor(cfpId);
    } finally {
      if (request === loadGeneration.current && activeCfp.current === cfpId) {
        setLoading(false);
      }
    }
  }, [cfpId, readOnly, t]);

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    const isDifferentCfp = loadedScope.current !== cfpId;
    if (isDifferentCfp) {
      loadedScope.current = cfpId;
      setRows([]);
      setPending(new Set());
      setUndo(null);
      setRowErrors(new Map());
      committedDecisions.current.clear();
      decisionSequence.current = 0;
    }
    void refresh(isDifferentCfp);
    return () => {
      loadGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId]);

  /*
   * From the snapshot on the proposal, not from `speakers/{uid}`.
   *
   * The profile is global and belongs to the account; a role is per CFP. Reading
   * profiles here would hand every committee on the platform the whole speaker
   * directory, so submission freezes what the committee is entitled to see.
   */
  const names = useCallback(
    (row: ProposalRow) =>
      (row.speakerSnapshot ?? [])
        .map((speaker) => speaker.name)
        .filter(Boolean)
        .join(', '),
    [],
  );

  async function decide(row: ProposalRow, next: ProposalStatus) {
    if (readOnly) return;
    const previous = row.status;
    if (previous === next || pending.has(row.id)) return;
    const clearsSpeakerResponses =
      previous === 'accepted' || inStatusSet('speakerResponse', previous);
    if (
      clearsSpeakerResponses &&
      !window.confirm(
        t.admin.decisionResetConfirm(
          row.title || t.admin.untitled,
          t.enums.status[previous],
          t.enums.status[next],
        ),
      )
    ) {
      return;
    }
    const scope = cfpId;
    const action = ++decisionSequence.current;

    setNote('');
    setPending((current) => new Set(current).add(row.id));
    setRowErrors((current) => {
      const updated = new Map(current);
      updated.delete(row.id);
      return updated;
    });
    setRows((current) =>
      current.map((proposal) =>
        proposal.id === row.id ? { ...proposal, status: next } : proposal,
      ),
    );

    try {
      await setProposalStatus({ cfpId, proposalId: row.id, status: next });
      if (activeCfp.current !== scope) return;
      const undoTarget =
        previous === 'submitted'
          ? ('under_review' as const)
          : !clearsSpeakerResponses && inStatusSet('adminSettable', previous)
            ? previous
            : null;
      const decision: UndoDecision | null = undoTarget ? {
        action,
        proposalId: row.id,
        title: row.title || t.admin.untitled,
        from: previous,
        previous: undoTarget,
        next,
      } : null;
      if (clearsSpeakerResponses) {
        // The undo banner is another proposal's after this, so it cannot double
        // as the confirmation for the one just reset. Say so in its own words.
        setNote(t.admin.decisionReset(row.title || t.admin.untitled, t.enums.status[next]));
        setUndo(invalidateProposalUndoHistory(committedDecisions.current, row.id));
      } else if (decision && !(previous === 'submitted' && next === 'under_review')) {
        committedDecisions.current.set(action, decision);
        const latest = Math.max(...committedDecisions.current.keys());
        setUndo(committedDecisions.current.get(latest) ?? null);
      }
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache('myProposals');
      invalidateCache(`reviewQueue:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      void onEmailQueueChange?.();
    } catch (e) {
      if (activeCfp.current !== scope) return;
      setRows((current) =>
        current.map((proposal) =>
          proposal.id === row.id ? { ...proposal, status: previous } : proposal,
        ),
      );
      setRowErrors((current) =>
        new Map(current).set(row.id, adminError(e, t)),
      );
    } finally {
      if (activeCfp.current === scope) {
        setPending((current) => {
          const updated = new Set(current);
          updated.delete(row.id);
          return updated;
        });
      }
    }
  }

  async function undoDecision() {
    if (readOnly || !undo || pending.has(undo.proposalId)) return;
    const snapshot = undo;
    const scope = cfpId;
    setUndo(null);
    setPending((current) => new Set(current).add(snapshot.proposalId));
    setRows((current) =>
      current.map((proposal) =>
        proposal.id === snapshot.proposalId
          ? { ...proposal, status: snapshot.previous }
          : proposal,
      ),
    );

    try {
      await setProposalStatus({
        cfpId,
        proposalId: snapshot.proposalId,
        status: snapshot.previous,
      });
      if (activeCfp.current !== scope) return;
      committedDecisions.current.delete(snapshot.action);
      const remaining = [...committedDecisions.current.keys()];
      const latest = remaining.length > 0 ? Math.max(...remaining) : null;
      setUndo(latest === null ? null : committedDecisions.current.get(latest) ?? null);
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache('myProposals');
      invalidateCache(`reviewQueue:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      setNote(t.admin.decisionUndone(snapshot.title));
      void onEmailQueueChange?.();
    } catch (e) {
      if (activeCfp.current !== scope) return;
      setRows((current) =>
        current.map((proposal) =>
          proposal.id === snapshot.proposalId ? { ...proposal, status: snapshot.next } : proposal,
        ),
      );
      const latest = Math.max(...committedDecisions.current.keys());
      setUndo(committedDecisions.current.get(latest) ?? snapshot);
      setRowErrors((current) =>
        new Map(current).set(snapshot.proposalId, adminError(e, t)),
      );
    } finally {
      if (activeCfp.current === scope) {
        setPending((current) => {
          const updated = new Set(current);
          updated.delete(snapshot.proposalId);
          return updated;
        });
      }
    }
  }

  const inCurrentScope = loadedFor === cfpId;
  const scopedRows = useMemo(() => (inCurrentScope ? rows : []), [inCurrentScope, rows]);
  const scopedShape = inCurrentScope ? shape : DEFAULT_SUBMISSION_FORM;
  const profileRequestsByProposal = useMemo(
    () => profileUpdateRequestsByProposal(inCurrentScope ? profileRequests : []),
    [inCurrentScope, profileRequests],
  );

  const categories = useMemo(() => {
    const configured = scopedShape.category.map((option) => option.value);
    return [...new Set([...configured, ...scopedRows.map((row) => row.category).filter(Boolean)])];
  }, [scopedRows, scopedShape.category]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(locale);
    const result = scopedRows.filter((row) => {
      if (
        needle &&
        !`${row.title ?? ''} ${names(row)}`.toLocaleLowerCase(locale).includes(needle)
      ) {
        return false;
      }
      if (statusFilter === 'current' && row.status === 'withdrawn') return false;
      if (statusFilter === 'undecided' && inStatusSet('decided', row.status)) return false;
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'current' &&
        statusFilter !== 'undecided' &&
        row.status !== statusFilter
      ) {
        return false;
      }
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (
        !proposalHasProfileUpdateAttention(
          profileRequestsByProposal.get(row.id) ?? [],
          profileFilter,
        )
      ) {
        return false;
      }

      const reviewCount = row.aggregate?.reviewCount ?? 0;
      if (scoreFilter === 'scored' && reviewCount === 0) return false;
      if (scoreFilter === 'unscored' && reviewCount > 0) return false;
      if (
        scoreFilter === 'disagreement' &&
        (row.aggregate?.stdDev ?? 0) < HIGH_DISAGREEMENT
      ) {
        return false;
      }
      return true;
    });

    return result.sort((a, b) => {
      if (sort === 'spread') {
        return (b.aggregate?.stdDev ?? -1) - (a.aggregate?.stdDev ?? -1);
      }
      if (sort === 'reviews') {
        return (b.aggregate?.reviewCount ?? 0) - (a.aggregate?.reviewCount ?? 0);
      }
      if (sort === 'title') return (a.title ?? '').localeCompare(b.title ?? '', locale);
      if (sort === 'status') {
        return t.enums.status[a.status].localeCompare(t.enums.status[b.status], locale);
      }
      return compareNormalizedScores(a.aggregate, b.aggregate);
    });
  }, [
    categoryFilter,
    locale,
    names,
    profileFilter,
    profileRequestsByProposal,
    scopedRows,
    scoreFilter,
    search,
    sort,
    statusFilter,
    t.enums.status,
  ]);

  const filtersActive =
    search !== '' ||
    statusFilter !== 'current' ||
    categoryFilter !== 'all' ||
    scoreFilter !== 'all' ||
    profileFilter !== 'all' ||
    sort !== 'score';

  // Best first for the accepted-speaker summary, regardless of how the table is
  // currently filtered or sorted.
  const ranked = [...scopedRows].sort((a, b) =>
    compareNormalizedScores(a.aggregate, b.aggregate),
  );
  const accepted = ranked.filter((row) => row.status === 'accepted' || row.status === 'confirmed');
  const decidable = ranked.filter((row) => row.status !== 'draft' && row.status !== 'withdrawn');
  const undoHasDecisionEmail =
    undo !== null && (DECISION_KINDS as readonly string[]).includes(undo.next);

  if (!inCurrentScope || loading) {
    return (
      <section className="section decision-panel">
        <h2>{t.admin.proposals}</h2>
        <p className="muted">{t.app.loading}</p>
      </section>
    );
  }

  if (loadFailed) {
    return (
      <section className="section decision-panel">
        <h2>{t.admin.proposals}</h2>
        <Result ok="" error={error || t.errors.unavailable} />
        <button type="button" className="btn" onClick={() => void refresh(true)}>
          {t.errors.reload}
        </button>
      </section>
    );
  }

  return (
    <>
      <Dashboard rows={scopedRows} shape={scopedShape} />
      {!readOnly && (
        <ProfileUpdateQueue
          rows={scopedRows}
          requests={profileRequests}
          failed={profileRequestsFailed}
          onOpen={openSpeakerManagement}
          onRetry={() => void refresh(false, true)}
        />
      )}
      <ReviewCoverage
        coverage={coverage}
        loading={coverageLoading}
        error={coverageError}
        onRetry={() => void refresh(false, true)}
      />

      <section className="section decision-panel">
        <div className="decision-panel__heading">
          <div>
            <h2>{t.admin.proposals}</h2>
            <p className="section__help">{t.admin.proposalsHelp}</p>
            <p className="decision-panel__guardrail">{t.admin.speakerResponseGuardrail}</p>
          </div>
        </div>

        {inCurrentScope && undo && (
          <div className="decision-undo" role="status" aria-live="polite" aria-atomic="true">
            <div className="decision-undo__copy">
              <span>
                {t.admin.decisionChanged(
                  undo.title,
                  t.enums.status[undo.from],
                  t.enums.status[undo.next],
                )}
              </span>
              {undoHasDecisionEmail && (
                <span className="decision-undo__email">{t.admin.decisionEmailHeld}</span>
              )}
              {pendingEmailCheckFailed && undoHasDecisionEmail && (
                <span className="decision-undo__email">{t.admin.pendingEmailUnknownHelp}</span>
              )}
            </div>
            <div className="decision-undo__actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={readOnly || pending.has(undo.proposalId)}
                onClick={undoDecision}
              >
                {t.admin.undo}
              </button>
              {pendingEmailCount !== null &&
                pendingEmailCount !== undefined &&
                pendingEmailCount > 0 && (
                  <Link
                    className="btn btn--primary"
                    to={href({ route: 'admin', cfpId, tab: 'email' })}
                  >
                    {t.admin.pendingEmailReview}
                  </Link>
                )}
            </div>
          </div>
        )}

        <div className="decision-toolbar" aria-label={t.admin.filters}>
          <label className="decision-filter decision-filter--search">
            <span>{t.admin.search}</span>
            <input
              className="field__input"
              type="search"
              value={search}
              placeholder={t.admin.searchPlaceholder}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="decision-filter">
            <span>{t.admin.filterStatus}</span>
            <select
              className="field__input field__input--select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="current">{t.admin.filterCurrentStatuses}</option>
              <option value="all">{t.admin.filterAllStatuses}</option>
              <option value="undecided">{t.admin.undecided}</option>
              {PROPOSAL_STATUSES.filter((status) => status !== 'draft').map((status) => (
                <option key={status} value={status}>
                  {t.enums.status[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="decision-filter">
            <span>{t.admin.filterCategory}</span>
            <select
              className="field__input field__input--select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">{t.admin.filterAllCategories}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {labelOf(scopedShape.category, category, locale)}
                </option>
              ))}
            </select>
          </label>

          <label className="decision-filter">
            <span>{t.admin.filterScoreStatus}</span>
            <select
              className="field__input field__input--select"
              value={scoreFilter}
              onChange={(event) => setScoreFilter(event.target.value as ScoreFilter)}
            >
              <option value="all">{t.admin.filterAllScores}</option>
              <option value="scored">{t.admin.filterScored}</option>
              <option value="unscored">{t.admin.filterUnscored}</option>
              <option value="disagreement">{t.admin.filterDisagreement}</option>
            </select>
          </label>

          {!readOnly && (
            <label className="decision-filter">
              <span>{t.profileSnapshot.filterLabel}</span>
              <select
                className="field__input field__input--select"
                value={profileFilter}
                onChange={(event) =>
                  setProfileFilter(event.target.value as ProfileAttentionFilter)
                }
              >
                <option value="all">{t.profileSnapshot.filterAll}</option>
                <option value="waiting">{t.profileSnapshot.waitingOnSpeaker}</option>
                <option value="ready">{t.profileSnapshot.readyToReview}</option>
              </select>
            </label>
          )}

          <label className="decision-filter">
            <span>{t.admin.sortBy}</span>
            <select
              className="field__input field__input--select"
              value={sort}
              onChange={(event) => setSort(event.target.value as ProposalSort)}
            >
              <option value="score">{t.admin.sortScore}</option>
              <option value="spread">{t.admin.sortSpread}</option>
              <option value="reviews">{t.admin.sortReviews}</option>
              <option value="title">{t.admin.sortTitle}</option>
              <option value="status">{t.admin.sortStatus}</option>
            </select>
          </label>
        </div>

        <div className="decision-panel__count">
          <p className="muted" aria-live="polite">
            {t.admin.showingProposals(filtered.length, scopedRows.length)}
          </p>
          {filtersActive && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setSearch('');
                setStatusFilter('current');
                setCategoryFilter('all');
                setScoreFilter('all');
                setProfileFilter('all');
                setSort('score');
              }}
            >
              {t.admin.clearFilters}
            </button>
          )}
        </div>

        {scopedRows.length === 0 ? (
          <p className="muted">{t.admin.noProposals}</p>
        ) : filtered.length === 0 &&
          statusFilter === 'current' &&
          scopedRows.some((row) => row.status === 'withdrawn') ? (
          <div className="empty-filter">
            <p>{t.admin.noCurrentProposals}</p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setStatusFilter('withdrawn')}
            >
              {t.admin.showWithdrawn}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="empty-filter">{t.admin.noMatchingProposals}</p>
        ) : (
          <div className="table__scroll">
            <table className="table decision-table">
              <thead>
                <tr>
                  <th scope="col">{t.admin.colTitle}</th>
                  <th scope="col">{t.admin.colSpeaker}</th>
                  <th scope="col">{t.admin.colScore}</th>
                  <th scope="col">{t.admin.colReviews}</th>
                  <th scope="col">{t.admin.colSpread}</th>
                  <th scope="col">{t.admin.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const saving = pending.has(row.id);
                  const rowError = rowErrors.get(row.id);
                  const rowProfileRequests = profileRequestsByProposal.get(row.id) ?? [];
                  const waitingProfileRequests = rowProfileRequests.filter(
                    (request) => request.state === 'waiting',
                  ).length;
                  const readyProfileRequests = rowProfileRequests.filter(
                    (request) => request.state === 'ready',
                  ).length;
                  return (
                    <tr key={row.id} className={saving ? 'decision-table__row--saving' : undefined}>
                      <td data-label={t.admin.colTitle}>
                        <strong>{row.title || '—'}</strong>
                        <span className="decision-table__category">
                          {labelOf(scopedShape.category, row.category, locale)}
                        </span>
                      </td>
                      <td data-label={t.admin.colSpeaker}>
                        <div className="decision-speakers">
                          <span>{names(row) || '—'}</span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            aria-label={t.coSpeakers.manageFor(row.title || t.admin.untitled)}
                            onClick={() => openSpeakerManagement(row.id)}
                          >
                            {t.coSpeakers.manage}
                          </button>
                          {waitingProfileRequests > 0 && (
                            <span className="profile-attention profile-attention--waiting">
                              {t.profileSnapshot.waitingCount(waitingProfileRequests)}
                            </span>
                          )}
                          {readyProfileRequests > 0 && (
                            <span className="profile-attention profile-attention--ready">
                              {t.profileSnapshot.readyCount(readyProfileRequests)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label={t.admin.colScore}>
                        {row.aggregate ? row.aggregate.avgScore.toFixed(2) : '—'}
                      </td>
                      <td data-label={t.admin.colReviews}>{row.aggregate?.reviewCount ?? 0}</td>
                      <td data-label={t.admin.colSpread}>
                        {row.aggregate ? row.aggregate.stdDev.toFixed(2) : '—'}
                      </td>
                      <td data-label={t.admin.colStatus}>
                        {row.status === 'draft' || row.status === 'withdrawn' ? (
                          <span className={`status-chip status-chip--${row.status}`}>
                            {t.enums.status[row.status]}
                          </span>
                        ) : (
                          <div className="decision-control">
                            <select
                              className="field__input field__input--select"
                              aria-label={`${t.admin.colStatus}: ${row.title}`}
                              value={row.status}
                              disabled={readOnly || saving}
                              onChange={(event) =>
                                void decide(row, event.target.value as ProposalStatus)
                              }
                            >
                              {(
                                row.status === 'submitted'
                                  ? (['submitted', ...ADMIN_PROPOSAL_STATUSES] as const)
                                  : ADMIN_PROPOSAL_STATUSES
                              ).map((status) => (
                                <option key={status} value={status}>
                                  {t.enums.status[status]}
                                </option>
                              ))}
                              {row.status !== 'submitted' &&
                                !(ADMIN_PROPOSAL_STATUSES as readonly string[]).includes(row.status) && (
                                <option value={row.status} disabled>
                                  {t.enums.status[row.status]}
                                </option>
                              )}
                            </select>
                            {saving && (
                              <span className="decision-control__saving" role="status">
                                {t.admin.savingDecision}
                              </span>
                            )}
                            {rowError && (
                              <span className="field__error decision-control__error" role="alert">
                                {rowError}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Result ok={inCurrentScope ? note : ''} error={inCurrentScope ? error : ''} />
      </section>

      <section className="section">
        <div className="decision-panel__heading">
          <h2>{t.admin.results}</h2>
          {accepted.length > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                downloadSelectedSpeakersCsv(cfpId, accepted, scopedShape, questions, locale)
              }
            >
              CSV · {t.admin.results}
            </button>
          )}
        </div>
        <p className="section__help">
          {t.admin.tally(
            decidable.length,
            accepted.length,
            ranked.filter((row) => row.status === 'waitlisted').length,
            ranked.filter((row) => inStatusSet('decided', row.status)).length,
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
                <OperationalDetails row={row} shape={scopedShape} />
                <Answered
                  cfpId={cfpId}
                  fields={scopedShape.fields}
                  answers={row.answers}
                  title={t.admin.extraTitle}
                />
                <SpeakerConfirmations
                  cfpId={cfpId}
                  row={row}
                  fields={questions}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {managedProposalId && (
        <CoSpeakerRosterDialog
          open
          cfpId={cfpId}
          proposalId={managedProposalId}
          proposalTitle={
            scopedRows.find((row) => row.id === managedProposalId)?.title || t.admin.untitled
          }
          readOnly={readOnly}
          canRequestProfileUpdate={
            !readOnly &&
            ['accepted', 'confirmed'].includes(
              scopedRows.find((row) => row.id === managedProposalId)?.status ?? '',
            )
          }
          autoReviewSpeakerUid={managedSpeakerUid ?? undefined}
          onProfileUpdateRequestChanged={(speakerUid, request) => {
            if (!managedProposalId) return;
            const proposalId = managedProposalId;
            setProfileRequests((current) => {
              const withoutCurrent = current.filter(
                (summary) =>
                  summary.proposalId !== proposalId || summary.speakerUid !== speakerUid,
              );
              if (request.status === 'cancelled') return withoutCurrent;
              return [
                ...withoutCurrent,
                {
                  proposalId,
                  speakerUid,
                  requestId: request.requestId,
                  generation: request.generation,
                  state: request.status === 'resolved' ? 'ready' : 'waiting',
                  scopes: request.scopes,
                  resolvedScopes: request.resolvedScopes,
                  requestedAt: null,
                  resolvedAt: null,
                },
              ];
            });
          }}
          onSnapshotRefreshed={onSnapshotRefreshed}
          onClose={closeSpeakerManagement}
        />
      )}
    </>
  );
}
