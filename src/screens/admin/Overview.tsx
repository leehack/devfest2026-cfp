import { useCallback, useEffect, useRef, useState } from 'react';

import { formatDate } from '../../i18n';
import { useI18n } from '../../i18n/context';
import { toDate } from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { loadConfirmForm, loadSubmissionForm } from '../../lib/proposals';
import {
  emailDomain,
  emailQueue,
  loadAllProposals,
  loadCfp,
  loadCommittee,
  type ProposalRow,
} from '../../lib/roles';
import { navigate } from '../../lib/router';
import { paths } from '../../lib/paths';
import { cfpState, type CfpState } from '@shared/cfpWindow';
import type { ConfirmForm } from '@shared/confirmForm';
import type { SubmissionForm } from '@shared/submissionForm';
import type { Cfp } from '@shared/types';

interface EmailReadiness {
  key: boolean;
  domain: boolean;
  sender: boolean;
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

export function Overview({ cfpId }: { cfpId: string }) {
  const { t, locale } = useI18n();
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
    try {
      const [cfp, proposals, committee, submission, confirmation, email] = await Promise.all([
        loadCfp(cfpId),
        loadAllProposals(cfpId),
        loadCommittee(cfpId),
        loadSubmissionForm(cfpId),
        loadConfirmForm(cfpId),
        emailQueue({ cfpId, action: 'readiness' })
          .then(async ({ data: snapshot }) => {
            const domains =
              snapshot.keyHint && snapshot.domainId
                ? (await emailDomain({ cfpId, action: 'list' })).data.domains ?? []
                : [];
            return {
              key: Boolean(snapshot.keyHint),
              domain: domains.some(
                (domain) => domain.id === snapshot.domainId && domain.status === 'verified',
              ),
              sender: Boolean(snapshot.settings?.from),
              checkFailed: false,
            };
          })
          .catch(() => ({ key: false, domain: false, sender: false, checkFailed: true })),
      ]);
      if (request !== requestGeneration.current) return;
      if (!cfp) {
        setError(t.errors.notFound);
        setLoadedFor(cfpId);
        return;
      }
      setData({ cfpId, cfp, proposals, committee, submission, confirmation, email });
      setLoadedFor(cfpId);
    } catch (e) {
      if (request !== requestGeneration.current) return;
      setError(adminError(e, t));
      setLoadedFor(cfpId);
    }
  }, [cfpId, t]);

  useEffect(() => {
    void load(true);
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

  const { cfp, proposals, committee, submission, confirmation, email } = current;
  const opens = toDate(cfp.opensAt);
  const closes = toDate(cfp.closesAt);
  const windowValid = Boolean(opens && closes && closes.getTime() > opens.getTime() && !cfp.archived);
  const detailsReady = Boolean(
    cfp.description?.en?.trim() &&
      cfp.eventDate &&
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
  const emailReady = email.key && email.domain && email.sender;
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
            opens ? formatDate(opens, locale) : '—',
            closes ? formatDate(closes, locale) : '—',
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
      id: 'email',
      done: emailReady,
      unknown: email.checkFailed,
      title: t.admin.setupEmail,
      detail: email.checkFailed
        ? t.admin.setupEmailUnavailable
        : emailReady
          ? t.admin.setupEmailDone
          : t.admin.setupEmailTodo,
      action: t.admin.setupEmailAction,
      tab: 'email',
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
  const live = proposals.filter((proposal) => proposal.status !== 'withdrawn');
  const scored = live.filter((proposal) => (proposal.aggregate?.reviewCount ?? 0) > 0);
  const decided = live.filter((proposal) =>
    ['accepted', 'confirmed', 'declined', 'waitlisted', 'rejected'].includes(proposal.status),
  );

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

      <section className="admin-metrics" aria-label={t.admin.roundActivity}>
        <div className="admin-metric">
          <span>{t.admin.metricProposals}</span>
          <strong>{live.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricScored}</span>
          <strong>{scored.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricDecided}</span>
          <strong>{decided.length}</strong>
        </div>
        <div className="admin-metric">
          <span>{t.admin.metricDeadline}</span>
          <strong className="admin-metric__date">
            {closes ? formatDate(closes, locale) : t.admin.notSet}
          </strong>
        </div>
      </section>

      <section className="section setup-panel">
        <div className="setup-panel__heading">
          <div>
            <h2>{t.admin.setupChecklist}</h2>
            <p className="section__help">{t.admin.setupChecklistHelp}</p>
          </div>
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
      </section>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
