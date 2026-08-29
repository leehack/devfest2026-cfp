import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '../../components/Link';
import { formatDate } from '../../i18n';
import { useI18n } from '../../i18n/context';
import { useLatest } from '../../lib/useLatest';
import {
  isLateIntakeWindow,
  overviewEmailReady,
  publishedProgrammeLifecycleStep,
} from '../../lib/adminLifecycle';
import { toDate } from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { loadConfirmForm, loadSubmissionForm } from '../../lib/proposals';
import {
  loadScheduleDraft,
  loadSharedSchedule,
  type SharedScheduleBundle,
} from '../../lib/schedule';
import {
  emailQueue,
  loadAllProposals,
  loadCfp,
  loadCommittee,
  type ProposalRow,
} from '../../lib/roles';
import { href, navigate, type AdminTab } from '../../lib/router';
import { paths } from '../../lib/paths';
import { cfpState, type CfpState } from '@shared/cfpWindow';
import type { ConfirmForm } from '@shared/confirmForm';
import type { EmailDeliveryProblem, EmailDeliveryReadiness } from '@shared/emailSettings';
import type { ScheduleConfig, ScheduleEntry } from '@shared/schedule';
import type { SubmissionForm } from '@shared/submissionForm';
import type { Cfp } from '@shared/types';
import { inStatusSet } from '@shared/enums';

interface EmailReadiness {
  delivery: EmailDeliveryReadiness | null;
  problems: EmailDeliveryProblem[];
  waiting: number;
  needsAttention: number;
  checkFailed: boolean;
}

interface ScheduleReadiness {
  configured: boolean;
  draftProposalIds: string[];
  sharedReleaseId: string;
  stale: boolean;
  checkFailed: boolean;
}

interface OverviewData {
  cfpId: string;
  cfp: Cfp;
  proposals: ProposalRow[];
  committee: Awaited<ReturnType<typeof loadCommittee>>;
  submission: SubmissionForm;
  confirmation: ConfirmForm;
  email: EmailReadiness;
  schedule: ScheduleReadiness;
}

type SetupTab = 'settings' | 'submission' | 'committee' | 'confirmation' | 'email';

interface SetupStep {
  id: string;
  done: boolean;
  unknown?: boolean;
  optional?: boolean;
  title: string;
  detail: string;
  action: string;
  tab: SetupTab;
}

function stateOf(cfp: Cfp): CfpState {
  const opens = toDate(cfp.opensAt);
  const closes = toDate(cfp.closesAt);
  if (!opens || !closes) return 'closed';
  return cfpState(
    {
      archived: cfp.archived,
      paused: cfp.paused,
      opensAtMs: opens.getTime(),
      closesAtMs: closes.getTime(),
    },
    Date.now(),
  );
}

function todayIn(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function lifecycleHref(cfpId: string, step: number, firstSetupTab: SetupTab): string {
  if (step === 2 || step === 12) return href({ route: 'cfp', cfpId });
  if (step === 3 || step === 13) return href({ route: 'review', cfpId });

  const tabs: Partial<Record<number, AdminTab>> = {
    1: firstSetupTab,
    4: 'proposals',
    5: 'email',
    6: 'schedule',
    7: 'schedule',
    8: 'settings',
    9: 'settings',
    10: 'schedule',
    11: 'settings',
    14: 'proposals',
    15: 'email',
    16: 'schedule',
    17: 'settings',
  };
  return href({ route: 'admin', cfpId, tab: tabs[step] ?? 'overview' });
}

export function Overview({ cfpId }: { cfpId: string }) {
  const { t, locale } = useI18n();
  const tRef = useLatest(t);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);

  const load = useCallback(async (reset = false) => {
    const request = ++requestGeneration.current;
    if (reset) {
      setLoadedFor('');
      setData(null);
    }
    setError('');
    const revalidated = {
      cfp: null as { value: Cfp | null } | null,
      proposals: null as ProposalRow[] | null,
      committee: null as Awaited<ReturnType<typeof loadCommittee>> | null,
      submission: null as SubmissionForm | null,
      confirmation: null as ConfirmForm | null,
    };
    let latestDraft: { config: ScheduleConfig | null; entries: ScheduleEntry[] } | null = null;
    let latestShared: SharedScheduleBundle | null = null;

    const computeScheduleOverview = (
      draft: { config: ScheduleConfig | null; entries: ScheduleEntry[] },
      shared: SharedScheduleBundle,
    ) => ({
      configured: draft.config !== null,
      draftProposalIds: draft.entries.flatMap((entry: ScheduleEntry) =>
        entry.kind === 'proposal' ? [entry.proposalId] : [],
      ),
      sharedReleaseId: shared.schedule?.id ?? '',
      stale: Boolean(draft.config?.needsAttention || shared.stale),
      checkFailed: false,
    });

    const applyScheduleRevalidation = () => {
      if (requestGeneration.current === request && latestDraft && latestShared) {
        const nextSchedule = computeScheduleOverview(latestDraft, latestShared);
        setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, schedule: nextSchedule } : prev));
      }
    };

    try {
      let hasFailed = false;
      const [cfp, proposals, committee, submission, confirmation, email, schedule] = await Promise.all([
        loadCfp(cfpId, {
          onRevalidate: (updatedCfp) => {
            revalidated.cfp = { value: updatedCfp };
            if (requestGeneration.current === request && !hasFailed) {
              if (!updatedCfp) {
                setError(tRef.current.errors.notFound);
                setData(null);
                setLoadedFor(cfpId);
              } else {
                setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, cfp: updatedCfp } : prev));
              }
            }
          },
        }),
        loadAllProposals(cfpId, {
          onRevalidate: (updated) => {
            if (requestGeneration.current === request && !hasFailed) {
              revalidated.proposals = updated;
              setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, proposals: updated } : prev));
            }
          },
          onError: (err) => {
            hasFailed = true;
            if (requestGeneration.current === request) {
              setError(adminError(err, tRef.current));
              setData(null);
            }
          },
        }),
        loadCommittee(cfpId, {
          onRevalidate: (updatedCommittee) => {
            revalidated.committee = updatedCommittee;
            if (requestGeneration.current === request && !hasFailed) {
              setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, committee: updatedCommittee } : prev));
            }
          },
          onError: (err) => {
            hasFailed = true;
            if (requestGeneration.current === request) {
              setError(adminError(err, tRef.current));
              setData(null);
            }
          },
        }),
        loadSubmissionForm(cfpId, {
          onRevalidate: (updatedForm) => {
            revalidated.submission = updatedForm;
            if (requestGeneration.current === request && !hasFailed) {
              setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, submission: updatedForm } : prev));
            }
          },
        }),
        loadConfirmForm(cfpId, {
          onRevalidate: (updatedForm) => {
            revalidated.confirmation = updatedForm;
            if (requestGeneration.current === request && !hasFailed) {
              setData((prev) => (prev && prev.cfpId === cfpId ? { ...prev, confirmation: updatedForm } : prev));
            }
          },
        }),
        Promise.all([
          emailQueue({ cfpId, action: 'readiness' }),
          emailQueue({ cfpId, action: 'summary' }),
        ])
          .then(([{ data: snapshot }, { data: summary }]) => ({
            delivery: snapshot.delivery ?? null,
            problems: snapshot.delivery?.problems ?? [],
            waiting: summary.waiting ?? 0,
            needsAttention: summary.needsAttention ?? 0,
            checkFailed: false,
          }))
          .catch(() => ({
            delivery: null,
            problems: [],
            waiting: 0,
            needsAttention: 0,
            checkFailed: true,
          })),
        Promise.all([
          loadScheduleDraft(cfpId, {
            onRevalidate: (draft) => {
              latestDraft = draft;
              if (!hasFailed) applyScheduleRevalidation();
            },
            onError: (err) => {
              hasFailed = true;
              if (requestGeneration.current === request) {
                setError(adminError(err, tRef.current));
                setData(null);
              }
            },
          }),
          loadSharedSchedule(cfpId, {
            audience: 'committee',
            onRevalidate: (shared) => {
              latestShared = shared;
              if (!hasFailed) applyScheduleRevalidation();
            },
          }),
        ])
          .then(([draft, shared]) => {
            latestDraft = latestDraft ?? draft;
            latestShared = latestShared ?? shared;
            return computeScheduleOverview(latestDraft, latestShared);
          })
          .catch(() => ({
            configured: false,
            draftProposalIds: [],
            sharedReleaseId: '',
            stale: false,
            checkFailed: true,
          })),
      ]);
      if (request !== requestGeneration.current || hasFailed) return;
      const effectiveCfp = revalidated.cfp ? revalidated.cfp.value : cfp;
      if (!effectiveCfp) {
        setError(tRef.current.errors.notFound);
        setLoadedFor(cfpId);
        return;
      }
      setData({
        cfpId,
        cfp: effectiveCfp,
        proposals: revalidated.proposals ?? proposals,
        committee: revalidated.committee ?? committee,
        submission: revalidated.submission ?? submission,
        confirmation: revalidated.confirmation ?? confirmation,
        email,
        schedule,
      });
      setLoadedFor(cfpId);
    } catch (e) {
      if (request !== requestGeneration.current) return;
      setError(adminError(e, tRef.current));
      setLoadedFor(cfpId);
    }
  }, [cfpId, tRef]);

  useEffect(() => {
    void load(data?.cfpId !== cfpId);
    // The locale settles after mount. Refetching operational data in response
    // would add reads without changing any of it.
    return () => {
      requestGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId]);

  const current = data?.cfpId === cfpId ? data : null;
  if (loadedFor !== cfpId) return <p className="muted">{t.app.loading}</p>;
  if (!current) {
    return (
      <section className="section">
        <p className="field__error" role="alert">
          {error || t.errors.unavailable}
        </p>
        <button type="button" className="btn" onClick={() => void load(true)}>
          {t.errors.reload}
        </button>
      </section>
    );
  }

  const { cfp, proposals, committee, submission, confirmation, email, schedule } = current;
  const opens = toDate(cfp.opensAt);
  const closes = toDate(cfp.closesAt);
  const windowValid = Boolean(opens && closes && closes.getTime() > opens.getTime());
  const detailsReady = Boolean(
    cfp.description?.en?.trim() &&
      (cfp.eventStartDate ?? cfp.eventDate) &&
      cfp.location?.trim() &&
      cfp.website?.trim(),
  );
  const formReady = [
    submission.category,
    submission.format,
    submission.level,
    submission.deliveryLanguage,
  ].every((options) => options.length > 0);
  const committeeCount = committee.people.length + committee.pending.length;
  const committeeReady = committeeCount > 1;
  const emailReady = overviewEmailReady(email.delivery);
  const emailProblemLabels = email.problems.map(
    (problem) => t.admin.emailDeliveryProblems[problem] ?? problem,
  );
  const status = stateOf(cfp);

  const steps: SetupStep[] = [
    {
      id: 'details',
      done: detailsReady,
      title: t.admin.setupDetails,
      detail: detailsReady ? t.admin.setupDetailsDone : t.admin.setupDetailsTodo,
      action: t.admin.setupDetailsAction,
      tab: 'settings',
    },
    {
      id: 'window',
      done: windowValid,
      title: t.admin.setupWindow,
      detail: windowValid
        ? t.admin.setupWindowDone(
            opens ? formatDate(opens, locale, cfp.timeZone ?? 'America/Toronto') : '—',
            closes ? formatDate(closes, locale, cfp.timeZone ?? 'America/Toronto') : '—',
          )
        : t.admin.setupWindowTodo,
      action: t.admin.setupWindowAction,
      tab: 'settings',
    },
    {
      id: 'submission',
      done: formReady,
      title: t.admin.setupSubmission,
      detail: formReady ? t.admin.setupSubmissionDone : t.admin.setupSubmissionTodo,
      action: t.admin.setupSubmissionAction,
      tab: 'submission',
    },
    {
      id: 'email',
      done: emailReady,
      unknown: email.checkFailed,
      title: t.admin.setupEmail,
      detail: email.checkFailed
        ? t.admin.setupEmailUnavailable
        : emailReady
          ? t.admin.setupEmailDone
          : emailProblemLabels.length > 0
            ? t.admin.setupEmailProblems(emailProblemLabels)
            : t.admin.setupEmailTodo,
      action: t.admin.setupEmailAction,
      tab: 'email',
    },
    {
      id: 'committee',
      done: committeeReady,
      title: t.admin.setupCommittee,
      detail: committeeReady
        ? t.admin.setupCommitteeDone(committeeCount)
        : t.admin.setupCommitteeTodo,
      action: t.admin.setupCommitteeAction,
      tab: 'committee',
    },
    {
      id: 'confirmation',
      done: confirmation.fields.length > 0,
      optional: true,
      title: t.admin.setupConfirmation,
      detail:
        confirmation.fields.length > 0
          ? t.admin.setupConfirmationDone(confirmation.fields.length)
          : t.admin.setupConfirmationEmpty,
      action: t.admin.setupConfirmationAction,
      tab: 'confirmation',
    },
  ];

  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.done).length;
  const readiness = Math.round((done / required.length) * 100);
  const live = proposals.filter(
    (proposal) => proposal.status !== 'draft' && proposal.status !== 'withdrawn',
  );
  const undecided = live.filter((proposal) =>
    inStatusSet('reviewQueue', proposal.status),
  );
  const needsFirstReview = undecided.filter(
    (proposal) => (proposal.aggregate?.reviewCount ?? 0) === 0,
  );
  const awaitingConfirmation = live.filter((proposal) => proposal.status === 'accepted');
  const confirmed = live.filter((proposal) => proposal.status === 'confirmed');
  const draftProposalIds = new Set(schedule.draftProposalIds);
  const confirmedUnscheduled = confirmed.filter((proposal) => !draftProposalIds.has(proposal.id));
  const lateIntake = isLateIntakeWindow(cfp, status);
  const eventEnd = cfp.eventEndDate ?? cfp.eventStartDate ?? cfp.eventDate ?? '';
  const eventDone = Boolean(
    eventEnd && eventEnd < todayIn(cfp.timeZone ?? 'America/Toronto'),
  );
  const publicNeedsUpdate = Boolean(
    cfp.publishedScheduleId &&
      (schedule.stale ||
        confirmedUnscheduled.length > 0 ||
        (schedule.sharedReleaseId && schedule.sharedReleaseId !== cfp.publishedScheduleId)),
  );

  let lifecycleStep = 1;
  if (cfp.archived || eventDone) {
    lifecycleStep = 17;
  } else if (cfp.publishedScheduleId) {
    lifecycleStep = publishedProgrammeLifecycleStep({
      status,
      lateIntake,
      awaitingConfirmation: awaitingConfirmation.length,
      undecided: undecided.length,
      needsFirstReview: needsFirstReview.length,
      publicNeedsUpdate,
      waitingEmails: email.waiting,
      emailNeedsAttention: email.needsAttention,
    });
  } else if (readiness < 100) {
    lifecycleStep = 1;
  } else if (live.length === 0) {
    lifecycleStep = 2;
  } else if (email.waiting + email.needsAttention > 0) {
    lifecycleStep = schedule.sharedReleaseId && confirmed.length > 0 ? 7 : 5;
  } else if (undecided.length > 0) {
    lifecycleStep = needsFirstReview.length > 0 ? 3 : 4;
  } else if (awaitingConfirmation.length > 0) {
    lifecycleStep = 5;
  } else if (confirmed.length > 0) {
    if (!schedule.configured || schedule.draftProposalIds.length === 0) lifecycleStep = 6;
    else if (!schedule.sharedReleaseId) lifecycleStep = 7;
    else if (status === 'open') lifecycleStep = 8;
    else if (status === 'closed') lifecycleStep = 10;
    else lifecycleStep = 9;
  } else {
    lifecycleStep = 4;
  }

  const firstSetupTab = required.find((step) => !step.done)?.tab ?? 'settings';
  const currentLifecycle =
    t.admin.lifecycle.steps[lifecycleStep - 1] ?? t.admin.lifecycle.steps[0];
  const deadline = closes
    ? formatDate(closes, locale, cfp.timeZone ?? 'America/Toronto')
    : t.admin.notSet;

  return (
    <div className="admin-overview">
      <section className="admin-overview__hero">
        <div className="admin-overview__hero-copy">
          <p className={`admin-state admin-state--${status}`}>{t.admin.cfpStates[status]}</p>
          <h2>{readiness === 100 ? t.admin.readyTitle : t.admin.setupTitle}</h2>
          <p className="section__help">
            {readiness === 100 ? t.admin.readyHelp : t.admin.setupHelp}
          </p>
        </div>
        <div
          className="readiness"
          role="progressbar"
          aria-label={t.admin.readiness}
          aria-valuemin={0}
          aria-valuemax={required.length}
          aria-valuenow={done}
        >
          <strong className="readiness__value">{done}/{required.length}</strong>
          <span className="readiness__label">{t.admin.readiness}</span>
          <span className="readiness__track" aria-hidden="true">
            <span className="readiness__fill" style={{ width: `${readiness}%` }} />
          </span>
        </div>
      </section>

      <section className="admin-quick-links" aria-label={t.admin.previewLinks}>
        <a className="btn btn--primary" href={paths.cfp(cfpId)} target="_blank" rel="noreferrer">
          {t.admin.previewPublic}
        </a>
        <a className="btn btn--ghost" href={paths.submit(cfpId)} target="_blank" rel="noreferrer">
          {t.admin.previewSubmission}
        </a>
        <a className="btn btn--ghost" href={paths.review(cfpId)} target="_blank" rel="noreferrer">
          {t.admin.openReview}
        </a>
      </section>

      <section className="round-guide" aria-labelledby="round-guide-title">
        <div className="round-guide__current">
          <div className="round-guide__copy">
            <p className="round-guide__eyebrow">
              {t.admin.lifecycle.step(lifecycleStep, t.admin.lifecycle.steps.length)}
            </p>
            <h2 id="round-guide-title">{currentLifecycle.title}</h2>
            <p>{currentLifecycle.help}</p>
          </div>
          <Link
            className="btn btn--primary round-guide__action"
            to={lifecycleHref(cfpId, lifecycleStep, firstSetupTab)}
          >
            {currentLifecycle.action}
          </Link>
          {lifecycleStep === 11 && (
            <a
              className="round-guide__secondary"
              href={`${href({ route: 'admin', cfpId, tab: 'settings' })}#event-closeout`}
            >
              {t.admin.lifecycle.skipLateIntake}
            </a>
          )}
        </div>

        <dl className="round-guide__facts">
          <div><dt>{t.admin.metricProposals}</dt><dd>{live.length}</dd></div>
          <div><dt>{t.admin.metricDeadline}</dt><dd>{deadline}</dd></div>
          <div>
            <dt>{t.admin.lifecycle.programmeLabel}</dt>
            <dd>
              {cfp.publishedScheduleId
                ? publicNeedsUpdate
                  ? t.admin.lifecycle.programmeUpdate
                  : t.admin.lifecycle.programmeLive
                : schedule.sharedReleaseId
                  ? t.admin.lifecycle.programmeShared
                  : t.admin.lifecycle.programmePrivate}
            </dd>
          </div>
        </dl>

        {lateIntake && (
          <aside className="round-guide__notice round-guide__notice--late" role="status">
            <strong>{t.admin.lifecycle.lateIntakeTitle}</strong>
            <p>{t.admin.lifecycle.lateIntakeHelp}</p>
          </aside>
        )}
        {publicNeedsUpdate && (
          <aside className="round-guide__notice round-guide__notice--update" role="status">
            <strong>{t.admin.lifecycle.publicUpdateTitle}</strong>
            <p>{t.admin.lifecycle.publicUpdateHelp}</p>
          </aside>
        )}
        {schedule.checkFailed && (
          <p className="round-guide__unknown">{t.admin.lifecycle.scheduleUnknown}</p>
        )}

        <details className="lifecycle-map">
          <summary>{t.admin.lifecycle.allSteps}</summary>
          <div className="lifecycle-track" role="region" aria-label={t.admin.lifecycle.allSteps}>
            <ol>
              {t.admin.lifecycle.steps.map((step, index) => {
                const number = index + 1;
                const phase =
                  number <= 5
                    ? 'intake'
                    : number <= 10
                      ? 'programme'
                      : number <= 16
                        ? 'late'
                        : 'finish';
                return (
                  <li
                    key={number}
                    className={`lifecycle-track__step lifecycle-track__step--${phase}${
                      number === lifecycleStep
                        ? ' lifecycle-track__step--current'
                        : number < lifecycleStep
                          ? ' lifecycle-track__step--past'
                          : ''
                    }`}
                    aria-current={number === lifecycleStep ? 'step' : undefined}
                  >
                    <span className="lifecycle-track__number" aria-hidden="true">{number}</span>
                    <span>{step.title}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </details>
      </section>

      <section className="admin-metrics" aria-label={t.admin.roundActivity}>
        <div className="admin-metric">
          <span>{t.admin.metricNeedsReview}</span>
          <strong>{needsFirstReview.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricNeedsDecision}</span>
          <strong>{undecided.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricAwaitingConfirmation}</span>
          <strong>{awaitingConfirmation.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricConfirmed}</span>
          <strong>
            {confirmed.length}
            <small>{t.admin.metricUnscheduled(confirmedUnscheduled.length)}</small>
          </strong>
        </div>
      </section>

      <details className="section setup-panel" open={readiness < 100}>
        <summary>
          {t.admin.setupChecklistSummary(done, required.length)}
        </summary>
        <div className="setup-panel__heading">
          <p className="section__help">{t.admin.setupChecklistHelp}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void load()}>
            {t.admin.refreshOverview}
          </button>
        </div>

        <ol className="setup-list">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`setup-step${step.done ? ' setup-step--done' : ''}${
                step.optional ? ' setup-step--optional' : ''
              }${step.unknown ? ' setup-step--unknown' : ''}`}
            >
              <span className="setup-step__mark" aria-hidden="true">
                {step.done ? '✓' : step.unknown ? '?' : '·'}
              </span>
              <div className="setup-step__body">
                <div className="setup-step__title">
                  <strong>{step.title}</strong>
                  {step.optional && (
                    <span className="setup-step__optional">{t.admin.optional}</span>
                  )}
                </div>
                <p>{step.detail}</p>
              </div>
              <button
                type="button"
                className="btn btn--ghost setup-step__action"
                onClick={() => navigate('admin', { cfpId, tab: step.tab })}
              >
                {step.action}
              </button>
            </li>
          ))}
        </ol>
      </details>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
