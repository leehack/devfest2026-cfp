import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { LIMITS, inStatusSet, type AttendanceStatus } from '@shared/enums';
import { submissionSchema } from '@shared/schema';
import {
  DEFAULT_SUBMISSION_FORM,
  asOptions,
  type SubmissionForm,
} from '@shared/submissionForm';

import { useToast } from '../components/Toast';
import { Link } from '../components/Link';
import { Checkbox, RadioGroup, SelectField, TextAreaField, TextField } from '../components/fields';
import { FormProgress, type FormProgressItem } from '../components/FormProgress';
import { Reveal } from '../components/Reveal';
import { SessionizeImport } from '../components/SessionizeImport';
import {
  SpeakerFields,
  SpeakerProfileSummary,
  speakerProfileComplete,
} from '../components/SpeakerFields';
import { CoSpeakerInvitation } from '../components/CoSpeakerInvitation';
import { CoSpeakerRoster } from '../components/CoSpeakerRoster';
import { formatCalendarDay, formatDate, type Dictionary } from '../i18n';
import { useI18n } from '../i18n/context';
import { COC_URL } from '../lib/env';
import { validationMessage } from '../i18n/validation';
import { friendlyError } from '../lib/errors';
import { track } from '../lib/analytics';
import {
  editScope,
  lateSpeakerNeedsScheduleRelease,
  type EditScope,
} from '../lib/lifecycle';
import { goTo, href } from '../lib/router';
import { coSpeakerInviteQuery } from '../lib/coSpeakers';
import { proposalSelectionQuery } from '../lib/proposalLinks';
import {
  listSpeakerProfileUpdateRequests,
  type ProfileUpdateRequestSummary,
} from '../lib/profileUpdateRequests';
import { profileUpdateRequestsByProposal } from '../lib/profileUpdateRequestSummary';
import {
  loadPublishedSchedule,
  loadSharedSchedule,
  type PublishedScheduleBundle,
  type SharedScheduleBundle,
} from '../lib/schedule';
import {
  clearTalk,
  emptyForm,
  fromDocuments,
  toDocuments,
  toSubmission,
  type FormState,
} from '../lib/formState';
import { invalidateCache } from '../lib/cache';
import {
  loadConfirmForm,
  loadSubmissionForm,
  loadMyProposals,
  deleteDraftProposal,
  saveDraft,
  submitProposal,
  respondToDecision,
  withdrawProposal,
  type CfpWindow,
  type LoadedProposal,
} from '../lib/proposals';
import type { ProposalStatus } from '@shared/enums';
import { primarySpeakerIdOf, type ProposalSpeakerRoster } from '@shared/coSpeakers';
import { calendarDate } from '@shared/cfp';
import { scheduleEndTime, type PublishedScheduleEntry } from '@shared/schedule';
import { HeadshotField } from '../components/HeadshotField';
import { SpeakerProfilePhoto } from '../components/SpeakerProfilePhoto';
import { ProfileSnapshotRefresh } from '../components/ProfileSnapshotRefresh';
import {
  EMPTY_FORM,
  FORM_LIMITS,
  SPEAKER_PHOTO_KEY,
  localised,
  validateAnswers,
  type AnswerFaults,
  type AnswerValue,
  type Answers,
  type ConfirmField,
  type ConfirmForm,
  type SpeakerPhotoQuestion,
} from '@shared/confirmForm';

type Errors = Record<string, string>;
type SaveSource = 'background' | 'manual' | 'transition';

function confirmationAnswersFrom(talk: LoadedProposal): Answers {
  const loaded = { ...(talk.ownConfirmation?.answers ?? {}) };
  const uploads = talk.ownConfirmation?.headshotUploads;
  if (!uploads || typeof uploads !== 'object' || Array.isArray(uploads)) return loaded;
  for (const [key, pointer] of Object.entries(uploads)) {
    if (
      loaded[key] === undefined &&
      pointer &&
      typeof pointer === 'object' &&
      !Array.isArray(pointer) &&
      typeof (pointer as { path?: unknown }).path === 'string'
    ) {
      loaded[key] = (pointer as { path: string }).path;
    }
  }
  return loaded;
}

function proposalForCurrentSpeaker(talk: LoadedProposal): Record<string, any> {
  const ids = Array.isArray(talk.proposal.speakerIds) ? talk.proposal.speakerIds : [];
  const perSpeaker = Boolean(talk.proposal.primarySpeakerId) || ids.length > 1;
  if (!perSpeaker) return talk.proposal;
  return {
    ...talk.proposal,
    acks: talk.ownParticipation?.acks ?? {},
    attendance: talk.ownParticipation?.attendance ?? {},
  };
}
const PAST_STATUSES = new Set<ProposalStatus>(['withdrawn', 'rejected', 'declined']);

function isPastTalk(talk: LoadedProposal): boolean {
  return PAST_STATUSES.has(talk.status);
}

interface TalkPickerProps {
  talks: LoadedProposal[];
  currentId: string | null;
  /** Live from the form, so the tab renames itself as the title is typed. */
  currentTitle: string;
  busy: boolean;
  canAdd: boolean;
  atCap: boolean;
  profileRequests: ReadonlyMap<string, ProfileUpdateRequestSummary[]>;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

/** Hidden until there is a second talk to switch to — one talk needs no chooser. */
function TalkPicker({
  talks,
  currentId,
  currentTitle,
  busy,
  canAdd,
  atCap,
  profileRequests,
  onOpen,
  onAdd,
}: TalkPickerProps) {
  const { t } = useI18n();
  const isNew = currentId === null;
  const currentTalks = talks.filter((talk) => !isPastTalk(talk));
  const pastTalks = talks.filter(isPastTalk);
  const currentIsPast = pastTalks.some((talk) => talk.id === currentId);
  const [pastOpen, setPastOpen] = useState(currentIsPast);

  useEffect(() => {
    if (currentIsPast) setPastOpen(true);
  }, [currentIsPast]);

  if (
    talks.length === 0 ||
    (currentId !== null && talks.length === 1 && !canAdd && pastTalks.length === 0)
  ) {
    return null;
  }

  const renderTab = (talk: LoadedProposal) => {
    const current = talk.id === currentId;
    const title = (current ? currentTitle : talk.proposal.title) || t.form.untitled;
    return (
      <button
        key={talk.id}
        type="button"
        className={`talks__tab${current ? ' talks__tab--on' : ''}`}
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={() => onOpen(talk.id)}
      >
        <span className="talks__title">{title}</span>
        {talk.status !== 'draft' && (
          <span className="talks__status">{t.enums.status[talk.status]}</span>
        )}
        {(profileRequests.get(talk.id) ?? []).some((request) => request.state === 'waiting') && (
          <span className="talks__attention">{t.profileSnapshot.pickerBadge}</span>
        )}
      </button>
    );
  };

  return (
    <nav className="talks" aria-label={t.form.yourTalks}>
      <span className="talks__label">{t.form.yourTalks}</span>
      {currentTalks.map(renderTab)}
      {isNew && (
        <span className="talks__tab talks__tab--on">
          <span className="talks__title">{currentTitle || t.form.newTalk}</span>
        </span>
      )}
      {canAdd && !isNew && (
        <button type="button" className="talks__add" disabled={busy} onClick={onAdd}>
          {t.form.addTalk}
        </button>
      )}
      {pastTalks.length > 0 && (
        <details
          className="talks__past"
          open={pastOpen}
          onToggle={(event) => setPastOpen(event.currentTarget.open)}
        >
          <summary>{t.form.pastTalksCount(pastTalks.length)}</summary>
          <div className="talks__past-list">{pastTalks.map(renderTab)}</div>
        </details>
      )}
      {atCap && (
        <span className="talks__limit" id="talk-cap-message">
          {t.form.talkCap(LIMITS.maxTalksPerSpeaker)}
        </span>
      )}
    </nav>
  );
}

/**
 * An acknowledgement's text, plus the Code of Conduct link when there is one.
 *
 * The URL is a deployment setting (`NEXT_PUBLIC_COC_URL`) rather than part of the
 * form, so it attaches to the seeded `coc` acknowledgement by key. An organiser
 * writing their own puts the address in the label; that is one unclickable URL
 * against a build-time variable every tenant would otherwise share.
 */
function AckLabel({ ack }: { ack: ConfirmField }) {
  const { t, locale } = useI18n();
  const text = localised(ack.label, locale);
  const url = COC_URL;
  if (ack.key !== 'coc' || !url) return <>{text}</>;
  return (
    <>
      {text}{' '}
      <a href={url} target="_blank" rel="noreferrer">
        {t.acks.cocLink}
      </a>
    </>
  );
}

interface QuestionsProps {
  cfpId: string;
  proposalId: string | null;
  speakerPhoto?: SpeakerPhotoQuestion;
  fields: ConfirmField[];
  answers: Answers;
  faults: AnswerFaults;
  busy: boolean;
  onAnswer: (key: string, value: AnswerValue) => void;
  onUploadBusyChange?: (key: string, busy: boolean) => void;
  sessionPhotoGeneration?: string | null;
  onCurrentPhotoGenerationChange?: (generation: string | null) => void;
  onUsePhotoForSession?: (generation: string | null) => Promise<boolean>;
}

/**
 * The organiser's own questions, rendered from `cfps/{cfpId}/config/confirmForm`.
 *
 * Nothing here is hard-coded — a t-shirt size and a dietary note are one
 * event's questions, not the platform's, and an organiser who cannot add
 * "do you need a power outlet" without a deploy ends up chasing forty people
 * by email instead.
 */
function Questions({
  cfpId,
  proposalId,
  speakerPhoto,
  fields,
  answers,
  faults,
  busy,
  onAnswer,
  onUploadBusyChange,
  sessionPhotoGeneration,
  onCurrentPhotoGenerationChange,
  onUsePhotoForSession,
}: QuestionsProps) {
  const { t, locale } = useI18n();
  const message = (key: string) => {
    const fault = faults[key];
    return fault ? t.form.answerErrors[fault] : undefined;
  };

  return (
    <>
      {speakerPhoto && (
        <SpeakerProfilePhoto
          required={speakerPhoto.required}
          disabled={busy}
          error={message(SPEAKER_PHOTO_KEY)}
          onChanged={(generation) => onAnswer(SPEAKER_PHOTO_KEY, generation ?? '')}
          onCurrentGenerationChange={onCurrentPhotoGenerationChange}
          onBusyChange={(next) => onUploadBusyChange?.(SPEAKER_PHOTO_KEY, next)}
          sessionGeneration={sessionPhotoGeneration}
          onUseForSession={onUsePhotoForSession}
        />
      )}
      {fields.map((field) => {
        const label = localised(field.label, locale);
        const help = localised(field.help, locale) || undefined;
        const value = answers[field.key];

        if (field.type === 'image') {
          // Submission forms refuse image fields. Confirmation questions only
          // render after a proposal exists, and the callable requires its id
          // to prove the current user owns an eligible proposal.
          if (!proposalId) return null;
          return (
            <HeadshotField
              key={field.key}
              cfpId={cfpId}
              proposalId={proposalId}
              fieldKey={field.key}
              label={label}
              help={help}
              required={field.required}
              error={message(field.key)}
              disabled={busy}
              // The stored answer is the path, so its presence is what says a
              // file exists. Set locally on upload too, purely so the control
              // updates — the callable re-derives it from the bucket regardless.
              uploaded={typeof value === 'string' && value !== ''}
              onUploaded={(path) => onAnswer(field.key, path)}
              onBusyChange={(next) => onUploadBusyChange?.(field.key, next)}
            />
          );
        }

        if (field.type === 'checkbox') {
          // `field` for the spacing every other question already gets — a
          // checkbox carries none of its own and ends up against the buttons.
          return (
            <div key={field.key} className="field">
              <Checkbox
                label={label}
                help={help}
                required={field.required}
                checked={value === true}
                onChange={(next) => onAnswer(field.key, next)}
                disabled={busy}
                error={message(field.key)}
              />
            </div>
          );
        }

        const text = typeof value === 'string' ? value : '';
        const common = {
          label,
          help,
          required: field.required,
          disabled: busy,
          error: message(field.key),
          value: text,
          onChange: (next: string) => onAnswer(field.key, next),
        };

        if (field.type === 'select') {
          return (
            <SelectField
              key={field.key}
              {...common}
              options={[
                { value: '', label: t.form.answerPick },
                ...(field.options ?? []).map((option) => ({
                  value: option.value,
                  label: localised(option.label, locale),
                })),
              ]}
            />
          );
        }
        if (field.type === 'textarea') {
          return (
            <TextAreaField
              key={field.key}
              {...common}
              maxLength={FORM_LIMITS.answerTextarea}
              rows={3}
            />
          );
        }
        return <TextField key={field.key} {...common} maxLength={FORM_LIMITS.answerText} />;
      })}
    </>
  );
}

interface StatusBannerProps {
  status: ProposalStatus;
  scope: EditScope;
  personalScope: EditScope;
  isCoSpeaker: boolean;
  attendanceEnabled: boolean;
  busy: boolean;
  /** Absent once withdrawing is no longer something they can do. */
  onWithdraw?: () => void;
  /** Present while the speaker can set or change their acceptance response. */
  onRespond?: (response: 'confirm' | 'decline') => void;
  questions: QuestionsProps;
  /** Open once they have said yes and there is something left to ask. */
  asking: boolean;
  onAsk: () => void;
  onCancelAsk: () => void;
  /** Present once confirmed, so an answer can still be corrected afterwards. */
  onSaveAnswers?: () => void;
  answerSaveState: 'idle' | 'saving' | 'saved' | 'failed';
  answerSaveError?: string;
  waitingOnOtherSpeaker?: boolean;
  otherSpeakerDeclined?: boolean;
  schedule?: {
    date: string;
    time: string;
    room: string;
    language: string;
    timeZone: string;
    public: boolean;
    href?: string;
  };
  /** This speaker is not in the current release, or its preview has no placement. */
  schedulePending?: boolean;
  /** The current shared preview could not be loaded, so no older placement is shown. */
  scheduleUnavailable?: boolean;
}

function proposalJourneyStage(status: ProposalStatus): number {
  if (status === 'draft' || status === 'withdrawn') return 0;
  if (status === 'submitted' || status === 'under_review') return 1;
  if (status === 'confirmed') return 3;
  return 2;
}

function ProposalJourney({
  status,
  next,
}: {
  status: ProposalStatus;
  next: { title: string; help: string };
}) {
  const { t } = useI18n();
  const current = proposalJourneyStage(status);
  const ended = ['withdrawn', 'rejected', 'declined'].includes(status);
  return (
    <section className="proposal-journey" aria-labelledby="proposal-next-step-title">
      <ol className="proposal-journey__steps" aria-label={t.form.journeyLabel}>
        {t.form.journeySteps.map((label, index) => (
          <li
            key={label}
            className={`proposal-journey__step${
              index === current
                ? ' proposal-journey__step--current'
                : index < current
                  ? ' proposal-journey__step--complete'
                  : ''
            }`}
            aria-current={index === current ? 'step' : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="proposal-journey__next">
        <p>{ended ? t.form.journeyOutcome : t.form.nextStep}</p>
        <h2 id="proposal-next-step-title">{next.title}</h2>
        <p>{next.help}</p>
      </div>
    </section>
  );
}

/** Where the talk stands, and what is still theirs to change about it. */
function StatusBanner({
  status,
  scope,
  personalScope,
  isCoSpeaker,
  attendanceEnabled,
  busy,
  onWithdraw,
  onRespond,
  questions,
  asking,
  onAsk,
  onCancelAsk,
  onSaveAnswers,
  answerSaveState,
  answerSaveError,
  waitingOnOtherSpeaker,
  otherSpeakerDeclined,
  schedule,
  schedulePending,
  scheduleUnavailable,
}: StatusBannerProps) {
  const { t } = useI18n();
  const good = status === 'accepted' || status === 'confirmed';
  const hasQuestions = questions.fields.length > 0 || questions.speakerPhoto !== undefined;
  const canConfirm = status !== 'confirmed';
  const canDecline = status !== 'declined';

  return (
    <div className={`panel submission-status${good ? ' panel--good' : ''}`}>
      <h2>{t.enums.status[status]}</h2>
      <p>
        {waitingOnOtherSpeaker
          ? t.form.nextSteps.confirmedWaitingOnSpeaker.help
          : otherSpeakerDeclined
            ? t.form.nextSteps.confirmedSpeakerDeclined.help
          : status === 'confirmed' && schedule
          ? schedule.public
            ? t.form.scheduledHelp
            : t.form.sharedScheduledHelp
          : status === 'confirmed' && scheduleUnavailable
            ? t.form.nextSteps.confirmedUnavailable.help
          : status === 'confirmed' && schedulePending
            ? t.form.sharedUnscheduledHelp
            : (t.form.statusHelp[status] ?? t.form.submittedHelp)}
      </p>

      {status === 'confirmed' && schedule && (
        <aside className="submission-schedule" aria-labelledby="submission-schedule-title">
          <div className="submission-schedule__heading">
            <div>
              <h3 id="submission-schedule-title">
                {schedule.public ? t.form.scheduleDetails : t.form.sharedScheduleDetails}
              </h3>
              {!schedule.public && (
                <span className="submission-schedule__privacy">{t.schedule.notPublic}</span>
              )}
            </div>
            {schedule.href && (
              <Link className="btn btn--primary" to={schedule.href}>
                {t.form.viewScheduledSession}
              </Link>
            )}
          </div>
          {!schedule.public && <p>{t.form.sharedScheduleHelp}</p>}
          <dl>
            <div><dt>{t.schedule.date}</dt><dd>{schedule.date}</dd></div>
            <div><dt>{t.schedule.time}</dt><dd>{schedule.time}</dd></div>
            <div><dt>{t.schedule.room}</dt><dd>{schedule.room}</dd></div>
            <div><dt>{t.schedule.language}</dt><dd>{schedule.language}</dd></div>
            <div><dt>{t.schedule.timeZone}</dt><dd>{schedule.timeZone}</dd></div>
          </dl>
        </aside>
      )}

      {/*
        The whole point of the acceptance email's link. Both answers are here
        because an accepted speaker who cannot come needs a way to say so that
        is not "ignore it until someone chases me" — an unanswered slot is the
        expensive one for the programme.

        Declining never asks the questions. Someone who cannot come should not
        have to pick a t-shirt size to say so.
      */}
      {onRespond && !asking && (
        <div className="card__actions">
          {canConfirm && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => (hasQuestions ? onAsk() : onRespond('confirm'))}
            >
              {t.form.confirmAccept}
            </button>
          )}
          {canDecline && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => onRespond('decline')}
            >
              {t.form.confirmDecline}
            </button>
          )}
        </div>
      )}

      {onRespond && asking && (
        <>
          <p className="field__help">{t.form.answersHelp}</p>
          <Questions {...questions} />
          <div className="card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => onRespond('confirm')}
            >
              {t.form.answersSubmit}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancelAsk}>
              {t.form.answersCancel}
            </button>
          </div>
        </>
      )}

      {/* Answered already, but a size guessed in a hurry should not be final.
          An archived round keeps the answers readable while omitting the save
          action; `questions.busy` freezes every control in that case. */}
      {status === 'confirmed' && hasQuestions && (
        <>
          <h3 className="card__subtitle">{t.form.answersTitle}</h3>
          <Questions {...questions} />
          {onSaveAnswers && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onSaveAnswers}
              >
                {t.form.answersSave}
              </button>
              <div className="actions__status" aria-live="polite">
                {answerSaveState === 'saving' && t.form.saving}
                {answerSaveState === 'saved' && t.form.confirmationAnswersSaved}
                {answerSaveState === 'failed' && (
                  <span className="field__error" role="alert">
                    {answerSaveError || t.form.confirmationAnswersSaveFailed}
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}

      <p className="muted">
        {attendanceEnabled
          ? isCoSpeaker
            ? t.coSpeakers.personalEditHelp[personalScope]
            : t.form.editHelp[scope]
          : isCoSpeaker
            ? t.coSpeakers.personalEditHelpNoAttendance[personalScope]
            : t.form.editHelpNoAttendance[scope]}
      </p>
      {onWithdraw && (
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onWithdraw}>
          {t.form.withdraw}
        </button>
      )}
    </div>
  );
}

/** Flattens zod issue paths into the dotted keys the fields look themselves up by. */
function validate(form: FormState, shape: SubmissionForm, t: Dictionary): Errors {
  const result = submissionSchema(shape).safeParse(toSubmission(form));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = validationMessage(issue, t);
  }
  return errors;
}

function focusFirstInvalidField() {
  const control = document.querySelector<HTMLElement>(
    'input[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled)',
  );
  const field =
    control?.closest<HTMLElement>('.field--error') ??
    document.querySelector<HTMLElement>('.field--error');
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  control?.focus({ preventScroll: true });
}

interface SubmitPageProps {
  user: User;
  cfp: CfpWindow;
  cfpId: string;
}

export function SubmitPage(props: SubmitPageProps) {
  const { t } = useI18n();
  const [invite, setInvite] = useState<ReturnType<typeof coSpeakerInviteQuery> | undefined>(
    undefined,
  );
  const [preferredProposalId, setPreferredProposalId] = useState<string | null>(null);

  useEffect(() => {
    setInvite(coSpeakerInviteQuery(window.location.search));
  }, []);

  if (invite === undefined) return <p className="muted">{t.app.loading}</p>;
  if (invite) {
    return (
      <CoSpeakerInvitation
        user={props.user}
        cfpId={props.cfpId}
        proposalId={invite.proposalId}
        invitationId={invite.invitationId}
        onJoined={() => {
          setPreferredProposalId(invite.proposalId);
          const url = new URL(window.location.href);
          url.searchParams.delete('proposal');
          url.searchParams.delete('speakerInvite');
          history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
          setInvite(null);
        }}
      />
    );
  }
  return <ProposalFormPage {...props} preferredProposalId={preferredProposalId} />;
}

function ProposalFormPage({
  user,
  cfp,
  cfpId,
  preferredProposalId,
}: SubmitPageProps & { preferredProposalId: string | null }) {
  const { t, locale } = useI18n();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [talks, setTalks] = useState<LoadedProposal[]>([]);
  const [speaker, setSpeaker] = useState<Record<string, any> | undefined>();
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProposalStatus>('draft');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState<ConfirmForm>(EMPTY_FORM);
  /** What this call asks for. Defaults until the config comes back, so the
      dropdowns are never momentarily empty. */
  const [shape, setShape] = useState<SubmissionForm>(DEFAULT_SUBMISSION_FORM);
  const [publishedSchedule, setPublishedSchedule] =
    useState<PublishedScheduleBundle | null>(null);
  const [publishedScheduleFailed, setPublishedScheduleFailed] = useState(false);
  const [sharedSchedule, setSharedSchedule] = useState<SharedScheduleBundle | null>(null);
  const [sharedScheduleFailed, setSharedScheduleFailed] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [answerFaults, setAnswerFaults] = useState<AnswerFaults>({});
  const [answerSaveState, setAnswerSaveState] =
    useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [answerSaveError, setAnswerSaveError] = useState('');
  const [sessionPhotoGeneration, setSessionPhotoGeneration] = useState<string | null>(null);
  const [uploadingAnswer, setUploadingAnswer] = useState(false);
  /**
   * Faults on *this call's own* questions, kept apart from `answerFaults`.
   * Those belong to the acceptance form and are filled in by the callable at
   * confirmation time; sharing one map would let a stale confirmation fault
   * mark a submission field red, and vice versa.
   */
  const [extraFaults, setExtraFaults] = useState<AnswerFaults>({});
  const [asking, setAsking] = useState(false);
  const [speakerEditing, setSpeakerEditing] = useState(true);
  const [speakerRoster, setSpeakerRoster] = useState<
    ProposalSpeakerRoster | null | undefined
  >(undefined);
  const [speakerRosterRefresh, setSpeakerRosterRefresh] = useState(0);
  const [profileRequestRefresh, setProfileRequestRefresh] = useState(0);
  const [profileRequests, setProfileRequests] = useState<ProfileUpdateRequestSummary[]>([]);
  const [profileRequestsFailed, setProfileRequestsFailed] = useState(false);

  const transitionFocus = useRef<
    'join-waiting' | 'join-loading' | 'leave-waiting' | 'leave-loading' | null
  >(
    preferredProposalId ? 'join-waiting' : null,
  );
  const dirty = useRef(false);
  const revision = useRef(0);
  const activeSave = useRef<Promise<string> | null>(null);
  const answerDirty = useRef(false);
  const answerRevision = useRef(0);
  const activeAnswerSave = useRef<Promise<boolean> | null>(null);
  const currentProfilePhotoGeneration = useRef<string | null>(null);
  const sessionPhotoGenerations = useRef(new Map<string, string | null>());
  const confirmFormRef = useRef(confirmForm);
  const uploadingFields = useRef(new Set<string>());
  const historyGuard = useRef(false);
  const historyTransition = useRef(false);
  const archived = cfp.state === 'archived';
  const selectedTalk = talks.find((talk) => talk.id === proposalId);
  const selectedPrimaryId = selectedTalk ? primarySpeakerIdOf(selectedTalk.proposal) : user.uid;
  const isCoSpeaker =
    proposalId !== null && selectedPrimaryId !== null && selectedPrimaryId !== user.uid;
  const isPrimarySpeaker = !isCoSpeaker;
  const usesPersonalConfirmation = Boolean(
    selectedTalk?.proposal.primarySpeakerId ||
      (Array.isArray(selectedTalk?.proposal.speakerIds) &&
        selectedTalk.proposal.speakerIds.length > 1),
  );
  const ownResponse = selectedTalk?.ownConfirmation?.response;
  const speakerStatus: ProposalStatus =
    usesPersonalConfirmation && (status === 'accepted' || status === 'confirmed')
      ? (ownResponse ?? (status === 'confirmed' ? 'confirmed' : 'accepted'))
      : status;
  const personalScope = editScope(status, cfp.state === 'open', archived);
  const scope = isCoSpeaker ? 'none' : personalScope;
  const formRef = useRef(form);
  const proposalIdRef = useRef(proposalId);
  const scopeRef = useRef(scope);
  const talksRef = useRef(talks);
  const speakerRef = useRef(speaker);
  const statusRef = useRef(status);
  const speakerStatusRef = useRef(speakerStatus);
  const personalLifecycleRef = useRef(usesPersonalConfirmation);
  const personalScopeRef = useRef(personalScope);
  const answersRef = useRef(answers);
  const savedAnswersRef = useRef<Answers>({});
  const tRef = useRef(t);
  const localeRef = useRef(locale);
  formRef.current = form;
  proposalIdRef.current = proposalId;
  scopeRef.current = scope;
  talksRef.current = talks;
  speakerRef.current = speaker;
  statusRef.current = status;
  speakerStatusRef.current = speakerStatus;
  personalLifecycleRef.current = usesPersonalConfirmation;
  personalScopeRef.current = personalScope;
  answersRef.current = answers;
  confirmFormRef.current = confirmForm;
  tRef.current = t;
  localeRef.current = locale;
  /** The talk itself: what the committee scores. */
  const readOnly = scope !== 'all';
  /** Travel answers: no bearing on the score, so they outlive the freeze. */
  const travelReadOnly = personalScope === 'none';
  const talkDisabled = readOnly || submitting;
  const travelDisabled = travelReadOnly || submitting;
  const acknowledgementDisabled = personalScope !== 'all' || submitting;

  /*
   * Next owns browser Back before this client screen sees `popstate`. A guard
   * entry on the same URL makes the first Back stay on this mounted form, so we
   * can finish its write and only then continue to the entry underneath.
   */
  const armHistoryGuard = useCallback(() => {
    if (historyGuard.current) return;
    const state =
      history.state && typeof history.state === 'object'
        ? history.state
        : {};
    history.pushState(
      { ...state, __cfpFormGuard: `${cfpId}:${user.uid}` },
      '',
      `${location.pathname}${location.search}${location.hash}`,
    );
    historyGuard.current = true;
  }, [cfpId, user.uid]);

  const collapseHistoryGuard = useCallback(() => {
    if (!historyGuard.current || historyTransition.current) return;
    historyGuard.current = false;
    history.back();
  }, []);

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        // Both at once: the questions are organiser config, and waiting for the
        // proposals first would put a second round trip in front of a page that
        let revalidatedFound: LoadedProposal[] | null = null;
        const revalidatedProfile = {
          current: null as { value: Record<string, any> | undefined } | null,
        };
        let revalidatedConfirmForm: ConfirmForm | null = null;
        let revalidatedSubmissionForm: SubmissionForm | null = null;
        let revalidatedPublished: { value: PublishedScheduleBundle | null; failed: boolean } | null = null;
        let revalidatedShared: { value: SharedScheduleBundle | null; failed: boolean } | null = null;
        const [
          { talks: found, speaker: profile },
          questions,
          asked,
          publishedResult,
          sharedResult,
          requestResult,
        ] = await Promise.all([
          loadMyProposals(cfpId, user, {
            force: loadAttempt > 0,
            onRevalidate: ({ talks: updatedTalks, speaker: updatedProfile }) => {
              if (cancelled) return;
              revalidatedFound = updatedTalks;
              revalidatedProfile.current = { value: updatedProfile };
              setTalks(updatedTalks);
              talksRef.current = updatedTalks;
              setSpeaker(updatedProfile);
              speakerRef.current = updatedProfile;
              const activeId = proposalIdRef.current;
              const matching = activeId ? updatedTalks.find((t) => t.id === activeId) : undefined;
              if (matching) {
                setStatus(matching.status);
                statusRef.current = matching.status;
                if (!sessionPhotoGenerations.current.has(matching.id)) {
                  sessionPhotoGenerations.current.set(
                    matching.id,
                    matching.ownConfirmation?.speakerPhoto?.sourceGeneration ?? null,
                  );
                }
                setSessionPhotoGeneration(sessionPhotoGenerations.current.get(matching.id) ?? null);
              }
              if (!dirty.current && !answerDirty.current) {
                if (activeId) {
                  if (matching) {
                    showTalk(matching, true);
                  } else {
                    showTalk(updatedTalks[0]);
                  }
                } else {
                  setForm((previous) => ({
                    ...previous,
                    ...fromDocuments(undefined, updatedProfile),
                    email: user.email ?? previous.email,
                  }));
                }
              }
            },
          }),
          loadConfirmForm(cfpId, {
            force: loadAttempt > 0,
            onRevalidate: (q) => {
              revalidatedConfirmForm = q;
              if (!cancelled) setConfirmForm(q);
            },
          }),
          loadSubmissionForm(cfpId, {
            force: loadAttempt > 0,
            onRevalidate: (s) => {
              revalidatedSubmissionForm = s;
              if (!cancelled) setShape(s);
            },
          }),
          cfp.publishedScheduleId
            ? loadPublishedSchedule(cfpId, cfp.publishedScheduleId, {
                force: loadAttempt > 0,
                onRevalidate: (s) => {
                  revalidatedPublished = { value: s, failed: false };
                  if (!cancelled) {
                    setPublishedSchedule(s);
                    setPublishedScheduleFailed(false);
                  }
                },
              })
                .then((value) => ({ value, failed: false }))
                .catch(() => ({ value: null, failed: true }))
            : Promise.resolve({ value: null, failed: false }),
          cfp.sharedScheduleId && cfp.sharedScheduleId !== cfp.publishedScheduleId
            ? loadSharedSchedule(cfpId, {
                force: loadAttempt > 0,
                releaseId: cfp.sharedScheduleId,
                audience: 'speaker',
                onRevalidate: (s) => {
                  revalidatedShared = { value: s, failed: false };
                  if (!cancelled) {
                    setSharedSchedule(s);
                    setSharedScheduleFailed(false);
                  }
                },
                onError: () => {
                  revalidatedShared = { value: null, failed: true };
                  if (!cancelled) {
                    setSharedSchedule(null);
                    setSharedScheduleFailed(true);
                  }
                },
              })
                .then((value) => ({ value, failed: false }))
                .catch(() => ({ value: null, failed: true }))
            : Promise.resolve({ value: null, failed: false }),
          listSpeakerProfileUpdateRequests({ cfpId })
            .then(({ data }) => ({ requests: data.own, failed: false }))
            .catch(() => ({ requests: [] as ProfileUpdateRequestSummary[], failed: true })),
        ]);
        if (cancelled) return;
        const effectiveFound = revalidatedFound ?? found;
        const effectiveProfile = revalidatedProfile.current
          ? revalidatedProfile.current.value
          : profile;
        const effectiveConfirmForm = revalidatedConfirmForm ?? questions;
        const effectiveSubmissionForm = revalidatedSubmissionForm ?? asked;
        const effectivePublished = revalidatedPublished ?? publishedResult;
        const effectiveShared = revalidatedShared ?? sharedResult;
        setTalks(effectiveFound);
        talksRef.current = effectiveFound;
        setSpeaker(effectiveProfile);
        speakerRef.current = effectiveProfile;
        currentProfilePhotoGeneration.current =
          typeof effectiveProfile?.profilePhoto?.generation === 'string'
            ? effectiveProfile.profilePhoto.generation
            : null;
        sessionPhotoGenerations.current = new Map(
          effectiveFound.map((talk) => [
            talk.id,
            talk.ownConfirmation?.speakerPhoto?.sourceGeneration ?? null,
          ]),
        );
        setConfirmForm(effectiveConfirmForm);
        setShape(effectiveSubmissionForm);
        setPublishedSchedule(effectivePublished.value);
        setPublishedScheduleFailed(effectivePublished.failed);
        setSharedSchedule(effectiveShared.value);
        setSharedScheduleFailed(effectiveShared.failed);
        setProfileRequests(requestResult.requests);
        setProfileRequestsFailed(requestResult.failed);

        // Open the one they can still work on rather than whichever came back
        // first — landing on a submitted talk looks like the form is broken.
        const currentTalks = effectiveFound.filter((talk) => !isPastTalk(talk));
        const requestedProposalId = preferredProposalId ?? proposalSelectionQuery(window.location.search);
        const preferred = requestedProposalId
          ? currentTalks.find((talk) => talk.id === requestedProposalId)
          : undefined;
        const open =
          preferred ??
          (cfp.state === 'open'
            ? (currentTalks.find((talk) => talk.status === 'draft') ?? currentTalks[0] ?? effectiveFound[0])
            : (currentTalks.find((talk) => talk.status === 'accepted') ??
              currentTalks.find((talk) => inStatusSet('speakerResponse', talk.status)) ??
              currentTalks[0] ??
              effectiveFound[0]));
        if (!dirty.current && !answerDirty.current) {
          if (open) {
            const next = fromDocuments(proposalForCurrentSpeaker(open), effectiveProfile);
            setForm(next);
            setSpeakerEditing(!speakerProfileComplete(next));
            setProposalId(open.id);
            proposalIdRef.current = open.id;
            setStatus(open.status);
            setSessionPhotoGeneration(sessionPhotoGenerations.current.get(open.id) ?? null);
            const loadedAnswers = confirmationAnswersFrom(open);
            setAnswers(loadedAnswers);
            savedAnswersRef.current = loadedAnswers;
            answerDirty.current = false;
          } else {
            // No talk here yet — but `speakers/{uid}` is global, so anyone who has
            // submitted to another call or filled in `/me` has already written all
            // of this. Starting them from blank was asking for it twice.
            const next = {
              ...fromDocuments(undefined, effectiveProfile),
              name: effectiveProfile?.name || user.displayName || '',
              email: user.email ?? '',
            };
            setForm(next);
            setSpeakerEditing(!speakerProfileComplete(next));
            setSessionPhotoGeneration(null);
            setAnswers({});
            savedAnswersRef.current = {};
            answerDirty.current = false;
          }
        }
      } catch (error) {
        if (!cancelled) setLoadError(friendlyError(error, tRef.current));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cfp.publishedScheduleId,
    cfp.sharedScheduleId,
    cfp.state,
    cfpId,
    loadAttempt,
    preferredProposalId,
    user,
  ]);

  useEffect(() => {
    const transition = transitionFocus.current;
    if (!transition) return;
    if (transition.endsWith('waiting')) {
      if (loading) {
        transitionFocus.current = transition.startsWith('join')
          ? 'join-loading'
          : 'leave-loading';
      }
      return;
    }
    if (loading) return;
    const joining = transition === 'join-loading';
    if (joining && preferredProposalId && proposalId !== preferredProposalId) return;
    transitionFocus.current = null;
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const talkHeading = document.querySelector<HTMLElement>('#submission-talk h2');
        const target = joining || talks.length > 0
          ? talkHeading
          : document.getElementById('main-content');
        target?.focus({ preventScroll: true });
      });
    });
  }, [loadAttempt, loading, preferredProposalId, proposalId, talks.length]);

  // ----------------------------------------------------------------- autosave

  const { showToast } = useToast();

  const setConfirmationAnswer = useCallback((key: string, value: AnswerValue) => {
    armHistoryGuard();
    answerDirty.current = true;
    answerRevision.current += 1;
    setAnswerSaveState('idle');
    setAnswerSaveError('');
    setAnswers((previous) => ({ ...previous, [key]: value }));
    const id = proposalIdRef.current;
    if (
      id &&
      typeof value === 'string' &&
      value.startsWith(`cfps/${cfpId}/workingHeadshots/${id}/`) &&
      value.includes(`/${key}/`)
    ) {
      const updated = talksRef.current.map((talk) =>
        talk.id === id
          ? {
              ...talk,
              ownConfirmation: {
                ...(talk.ownConfirmation ?? { answers: {} }),
                answers: {
                  ...(talk.ownConfirmation?.answers ?? {}),
                  [key]: value,
                },
              },
            }
          : talk,
      );
      talksRef.current = updated;
      setTalks(updated);
    }
  }, [armHistoryGuard, cfpId]);

  const setAnswerUploadBusy = useCallback((key: string, busy: boolean) => {
    if (busy) uploadingFields.current.add(key);
    else uploadingFields.current.delete(key);
    setUploadingAnswer(uploadingFields.current.size > 0);
  }, []);

  /**
   * Once a speaker has confirmed, changing a logistical answer is idempotent:
   * the same callable writes the new answers while leaving the status confirmed.
   * An unanswered acceptance is never autosaved, because that would accept a
   * slot before the speaker presses the explicit confirmation button.
   */
  const saveConfirmationAnswers = useCallback(
    async (source: SaveSource = 'background', force = false): Promise<boolean> => {
      if (activeAnswerSave.current) {
        const saved = await activeAnswerSave.current;
        if (!saved) return false;
      }
      if (!answerDirty.current && !force) return true;
      if (
        archived ||
        speakerStatusRef.current !== 'confirmed' ||
        uploadingFields.current.size > 0 ||
        proposalIdRef.current === null
      ) {
        return false;
      }

      const savedRevision = answerRevision.current;
      const snapshot = answersRef.current;
      const id = proposalIdRef.current;
      setAnswerSaveState('saving');

      const request = (async () => {
        try {
          await respondToDecision({
            cfpId,
            proposalId: id,
            response: 'confirm',
            answers: snapshot,
          });
          invalidateCache('myProposals');
          invalidateCache(`allProposals:${cfpId}`);
          invalidateCache(`scheduleDraft:${cfpId}`);
          invalidateCache(`sharedSchedule:${cfpId}`);
          if (answerRevision.current === savedRevision) {
            answerDirty.current = false;
            savedAnswersRef.current = snapshot;
            if (confirmFormRef.current.speakerPhoto) {
              const generation = currentProfilePhotoGeneration.current;
              sessionPhotoGenerations.current.set(id, generation);
              if (proposalIdRef.current === id) setSessionPhotoGeneration(generation);
            }
            setProfileRequestRefresh((value) => value + 1);
            setAnswerSaveState('saved');
            setAnswerSaveError('');
            if (source === 'manual') {
              showToast(tRef.current.form.confirmationAnswersSaved, 'success');
            }
            if (source !== 'transition' && !dirty.current) collapseHistoryGuard();
          } else {
            setAnswerSaveState('idle');
          }
          setBanner(null);
          return true;
        } catch (error) {
          setAnswerSaveState('failed');
          setAnswerSaveError(friendlyError(error, tRef.current));
          return false;
        } finally {
          activeAnswerSave.current = null;
        }
      })();
      activeAnswerSave.current = request;
      const saved = await request;
      if (!saved) return false;
      return source !== 'background' && answerDirty.current
        ? saveConfirmationAnswers(source)
        : true;
    },
    [archived, cfpId, collapseHistoryGuard, showToast],
  );

  useEffect(() => {
    if (
      archived ||
      speakerStatus !== 'confirmed' ||
      uploadingAnswer ||
      !answerDirty.current
    ) {
      return;
    }
    const handle = window.setTimeout(() => void saveConfirmationAnswers('background'), 1500);
    return () => clearTimeout(handle);
  }, [answers, archived, saveConfirmationAnswers, speakerStatus, uploadingAnswer]);

  const persist = useCallback(async (source: SaveSource = 'background'): Promise<boolean> => {
    if (scopeRef.current === 'none' && proposalIdRef.current === null) return false;

    // A visibility flush and the debounce can meet. Let the first write finish,
    // then decide whether a newer revision still needs its own write.
    if (activeSave.current) {
      try {
        await activeSave.current;
      } catch {
        return false;
      }
    }

    if (!dirty.current) {
      return true;
    }

    const savedRevision = revision.current;
    const snapshot = formRef.current;
    const currentId = proposalIdRef.current;
    const currentScope = scopeRef.current;
    const personalLifecycle = personalLifecycleRef.current;
    setSaveState('saving');
    setSaveError('');

    const request = saveDraft(
      cfpId,
      user,
      snapshot,
      shape,
      currentId,
      currentScope,
      localeRef.current,
      personalLifecycle,
      personalScopeRef.current,
    );
    activeSave.current = request;
    let shouldFlushAgain = false;

    try {
      const id = await request;
      const { proposalDoc, speakerDoc } = toDocuments(snapshot);
      const { acks, attendance, ...talkDoc } = proposalDoc;
      const cachedSpeaker = {
        ...speakerRef.current,
        ...speakerDoc,
        email: user.email ?? '',
      };
      speakerRef.current = cachedSpeaker;
      setSpeaker(cachedSpeaker);

      if (!currentId) {
        proposalIdRef.current = id;
        setProposalId(id);
      }
      // Switching is entirely local after the save. Cache every field that was
      // written, not only the picker title, or returning to this talk restores
      // the page-load copy and the next save overwrites the fresh one.
      const previousTalks = talksRef.current;
      const cachedTalks: LoadedProposal[] = previousTalks.some((talk) => talk.id === id)
        ? previousTalks.map((talk) =>
            talk.id === id
              ? {
                  ...talk,
                  proposal: {
                    ...talk.proposal,
                    ...(personalLifecycle ? talkDoc : proposalDoc),
                  },
                  ownParticipation: personalLifecycle
                    ? { ...talk.ownParticipation, acks, attendance }
                    : talk.ownParticipation,
                  speaker: cachedSpeaker,
                }
              : talk,
          )
        : [
            ...previousTalks,
            {
              id,
              status: 'draft',
              proposal: proposalDoc,
              speaker: cachedSpeaker,
            },
          ];
      talksRef.current = cachedTalks;
      setTalks(cachedTalks);

      if (revision.current === savedRevision) {
        dirty.current = false;
        setSaveState('saved');
        if (personalLifecycle) {
          setSpeakerRoster(undefined);
          setSpeakerRosterRefresh((value) => value + 1);
        }
        if (source === 'manual') {
          showToast(
            currentScope === 'none'
              ? tRef.current.profile.saved
              : tRef.current.form.saved,
            'success',
          );
        }
        if (source !== 'transition' && !answerDirty.current) collapseHistoryGuard();
      } else {
        shouldFlushAgain = source !== 'background';
        setSaveState('idle');
      }
    } catch (error) {
      setSaveState('failed');
      setSaveError(friendlyError(error, tRef.current));
      return false;
    } finally {
      if (activeSave.current === request) activeSave.current = null;
    }

    return shouldFlushAgain ? persist(source) : true;
  }, [cfpId, collapseHistoryGuard, shape, showToast, user]);

  useEffect(() => {
    if (loading || (scope === 'none' && proposalId === null) || !dirty.current) return;
    const handle = window.setTimeout(() => void persist('background'), 1500);
    return () => clearTimeout(handle);
  }, [form, loading, persist, proposalId, scope]);

  const saveForTransition = useCallback(async (): Promise<boolean> => {
    if (dirty.current && !(await persist('transition'))) return false;
    if (!answerDirty.current) return true;

    if (speakerStatusRef.current !== 'confirmed') {
      if (!window.confirm(tRef.current.form.discardUnsubmittedAnswersConfirm)) return false;
      setAnswers(savedAnswersRef.current);
      answersRef.current = savedAnswersRef.current;
      answerDirty.current = false;
      setAnswerFaults({});
      setAnswerSaveState('idle');
      setAnswerSaveError('');
      setAsking(false);
      return true;
    }

    if (await saveConfirmationAnswers('transition')) return true;
    showToast(tRef.current.form.unsaved, 'warning');
    return false;
  }, [persist, saveConfirmationAnswers, showToast]);

  useLayoutEffect(() => {
    const hasPendingChanges = () => dirty.current || answerDirty.current;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden' && dirty.current) void persist('background');
      if (document.visibilityState === 'hidden' && answerDirty.current) {
        void saveConfirmationAnswers('background');
      }
    };
    const formPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const saveBeforeHistoryMove = () => {
      if (!historyGuard.current || !hasPendingChanges()) return;

      const arrivedAt =
        `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (arrivedAt !== formPath) {
        /*
         * `goTo` pushes its destination before emitting popstate. That is not
         * the Back button consuming our same-URL guard entry, even though both
         * arrive through this handler. Keep the current history slot, restore
         * the form in it while its write finishes, then replace it with the
         * intended destination and let the router observe that settled path.
         */
        const destinationState = history.state;
        history.replaceState(destinationState, '', formPath);
        if (historyTransition.current) return;

        historyTransition.current = true;
        void saveForTransition()
          .then((saved) => {
            if (!saved) return;
            historyGuard.current = false;
            history.replaceState(destinationState, '', arrivedAt);
            window.dispatchEvent(new PopStateEvent('popstate'));
          })
          .finally(() => {
            historyTransition.current = false;
          });
        return;
      }

      // We are now on the same-URL base entry. Re-arm while the write is in
      // flight so repeated Back presses cannot outrun the one save.
      const state =
        history.state && typeof history.state === 'object'
          ? history.state
          : {};
      history.pushState(
        { ...state, __cfpFormGuard: `${cfpId}:${user.uid}` },
        '',
        formPath,
      );

      // A second Back while the first save is pending is restored above, but it
      // must not launch another write or replace the original destination.
      if (historyTransition.current) return;
      historyTransition.current = true;
      void saveForTransition()
        .then((saved) => {
          if (saved) {
            historyGuard.current = false;
            // Skip both the re-armed guard and this form's base entry. That is
            // the Back the person originally asked for.
            history.go(-2);
          }
        })
        .finally(() => {
          historyTransition.current = false;
        });
    };
    const leaveAfterCollapsingGuard = (leave: () => void) => {
      if (!historyGuard.current) {
        leave();
        return;
      }
      historyGuard.current = false;
      window.addEventListener('popstate', leave, { once: true });
      history.back();
    };
    const saveThenLeave = (leave: () => void) => {
      if (historyTransition.current) return;
      historyTransition.current = true;
      void saveForTransition()
        .then((saved) => {
          if (!saved) {
            historyTransition.current = false;
            return;
          }
          leaveAfterCollapsingGuard(() => {
            historyTransition.current = false;
            leave();
          });
        })
        .catch(() => {
          historyTransition.current = false;
        });
    };
    const saveBeforeInternalLink = (event: MouseEvent) => {
      if (
        !hasPendingChanges() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const signOut =
        target instanceof Element
          ? target.closest<HTMLButtonElement>('.account-menu__action--button')
          : null;
      if (signOut) {
        event.preventDefault();
        event.stopPropagation();
        saveThenLeave(() => signOut.click());
        return;
      }

      const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      saveThenLeave(() =>
        goTo(`${destination.pathname}${destination.search}${destination.hash}`),
      );
    };

    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('popstate', saveBeforeHistoryMove);
    document.addEventListener('visibilitychange', saveWhenHidden);
    document.addEventListener('click', saveBeforeInternalLink, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('popstate', saveBeforeHistoryMove);
      document.removeEventListener('visibilitychange', saveWhenHidden);
      document.removeEventListener('click', saveBeforeInternalLink, true);
      if (dirty.current) void persist('background');
      if (answerDirty.current) void saveConfirmationAnswers('background');
    };
  }, [cfpId, persist, saveConfirmationAnswers, saveForTransition, user.uid]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    armHistoryGuard();
    dirty.current = true;
    revision.current += 1;
    setSaveState((current) => (current === 'failed' ? current : 'idle'));
    setForm((prev) => ({ ...prev, [key]: value }));
  }, [armHistoryGuard]);

  const liveErrors = useMemo(() => validate(form, shape, t), [form, shape, t]);
  const liveExtraFaults = useMemo(
    () => validateAnswers({ fields: shape.fields }, form.answers).faults,
    [form.answers, shape.fields],
  );

  // Re-validate live once the applicant has seen errors, so fixes clear as they
  // type — and so switching language re-renders the messages in it.
  useEffect(() => {
    if (!showErrors) return;
    setErrors(liveErrors);
    setExtraFaults(liveExtraFaults);
  }, [liveErrors, liveExtraFaults, showErrors]);

  function markTalk(id: string, next: ProposalStatus, title?: string) {
    const previousTalks = talksRef.current;
    const known = previousTalks.some((talk) => talk.id === id);
    const patch = (talk: LoadedProposal) => ({
      ...talk,
      status: next,
      proposal: title === undefined ? talk.proposal : { ...talk.proposal, title },
    });
    const updated = known
      ? previousTalks.map((talk) => (talk.id === id ? patch(talk) : talk))
      : [...previousTalks, patch({ id, status: next, proposal: { title }, speaker: undefined })];
    talksRef.current = updated;
    setTalks(updated);
  }

  function markOwnResponse(
    id: string,
    response: 'confirmed' | 'declined',
    responseAnswers: Answers,
  ) {
    const updated = talksRef.current.map((talk) =>
      talk.id === id
        ? {
            ...talk,
            ownConfirmation: {
              ...talk.ownConfirmation,
              response,
              answers: responseAnswers,
            },
          }
        : talk,
    );
    talksRef.current = updated;
    setTalks(updated);
  }

  function applyRoster(next: ProposalSpeakerRoster | null) {
    setSpeakerRoster(next);
    const id = proposalIdRef.current;
    if (!next || !id) return;
    const activeIds = next.items
      .filter((item) => item.kind === 'active')
      .map((item) => item.uid);
    const { proposalDoc } = toDocuments(formRef.current);
    const updated = talksRef.current.map((talk) =>
      talk.id === id
        ? {
            ...talk,
            proposal: {
              ...talk.proposal,
              ...(next.usesPersonalLifecycle
                ? { primarySpeakerId: next.primarySpeakerId }
                : {}),
              speakerIds: activeIds,
            },
            ownParticipation:
              next.usesPersonalLifecycle && activeIds.includes(user.uid)
              ? {
                  ...talk.ownParticipation,
                  role:
                    next.primarySpeakerId === user.uid
                      ? ('primary' as const)
                      : ('coSpeaker' as const),
                  acks: proposalDoc.acks,
                  attendance: proposalDoc.attendance,
                }
              : talk.ownParticipation,
          }
        : talk,
    );
    talksRef.current = updated;
    setTalks(updated);
  }

  // -------------------------------------------------------------- switching

  function showTalk(talk?: LoadedProposal, preserveRoster = false) {
    revision.current += 1;
    if (!preserveRoster || talk?.id !== proposalIdRef.current) {
      setSpeakerRoster(undefined);
    }
    if (talk) {
      setForm(fromDocuments(proposalForCurrentSpeaker(talk), speakerRef.current));
      setProposalId(talk.id);
      proposalIdRef.current = talk.id;
      setStatus(talk.status);
      if (!sessionPhotoGenerations.current.has(talk.id)) {
        sessionPhotoGenerations.current.set(
          talk.id,
          talk.ownConfirmation?.speakerPhoto?.sourceGeneration ?? null,
        );
      }
      setSessionPhotoGeneration(sessionPhotoGenerations.current.get(talk.id) ?? null);
      const loadedAnswers = confirmationAnswersFrom(talk);
      setAnswers(loadedAnswers);
      savedAnswersRef.current = loadedAnswers;
    } else {
      setForm((previous) => clearTalk(previous));
      setProposalId(null);
      proposalIdRef.current = null;
      setStatus('draft');
      setSessionPhotoGeneration(null);
      setAnswers({});
      savedAnswersRef.current = {};
    }
    answerDirty.current = false;
    setAnswerSaveState('idle');
    setAnswerSaveError('');
    setAnswerFaults({});
    setAsking(false);
    setShowErrors(false);
    setBanner(null);
    setSaveState('idle');
    dirty.current = false;
  }

  /**
   * Flushes first. The autosave is on a 1.5s debounce, so switching mid-edit
   * would otherwise write the talk you just left into the one you opened.
   */
  async function openTalk(id: string) {
    if (id === proposalId) return;
    if (!(await saveForTransition())) return;

    const talk = talksRef.current.find((candidate) => candidate.id === id);
    if (!talk) return;
    showTalk(talk);
  }

  async function startNewTalk() {
    if (!(await saveForTransition())) return;

    // From the form rather than the loaded profile: right after a first save
    // the loaded copy is a page-load old and would blank the bio just typed.
    showTalk();
  }

  // ------------------------------------------------------------------- submit

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPrimarySpeaker) return;
    if (proposalId && !speakerRoster) {
      setBanner(t.coSpeakers.loadFailed);
      document.getElementById('submission-co-speakers')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }
    if (speakerRoster?.pendingBlocksSubmit) {
      setBanner(t.coSpeakers.pendingBlockHelp);
      document.getElementById('submission-co-speakers')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }
    const found = liveErrors;
    const faults = liveExtraFaults;
    setErrors(found);
    setExtraFaults(faults);
    setShowErrors(true);
    if (Object.keys(found).length > 0 || Object.keys(faults).length > 0) {
      if (Object.keys(found).some((key) => key.startsWith('speaker.'))) {
        setSpeakerEditing(true);
      }
      requestAnimationFrame(focusFirstInvalidField);
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      // Join any debounce already in flight before submitting. Without this, a
      // first autosave and the submit click can both create a draft while the
      // proposal id is still null.
      if (dirty.current && !(await persist('transition'))) return;

      // The flush may have waited for an autosave that was already in flight.
      // Validate the revision that actually won that race, not the render that
      // supplied the original click handler.
      const latest = formRef.current;
      const latestErrors = validate(latest, shape, t);
      const latestFaults = validateAnswers({ fields: shape.fields }, latest.answers).faults;
      if (Object.keys(latestErrors).length > 0 || Object.keys(latestFaults).length > 0) {
        setErrors(latestErrors);
        setExtraFaults(latestFaults);
        if (Object.keys(latestErrors).some((key) => key.startsWith('speaker.'))) {
          setSpeakerEditing(true);
        }
        requestAnimationFrame(focusFirstInvalidField);
        return;
      }

      let id = proposalIdRef.current;
      if (!id) {
        id = await saveDraft(cfpId, user, latest, shape, null, 'all', locale);
        setProposalId(id);
        proposalIdRef.current = id;
        dirty.current = false;
        setSaveState('saved');
      }
      await submitProposal({ cfpId, proposalId: id });
      invalidateCache('myProposals');
      invalidateCache(`allProposals:${cfpId}`);
      // Codes only — never the title, the abstract or anything about the
      // person. This answers "which tracks are people proposing to", which is
      // the one thing page views cannot tell an organiser.
      track('proposal_submitted', {
        cfp_id: cfpId,
        category: latest.category,
        format: latest.format,
        delivery_language: latest.deliveryLanguage,
      });
      setStatus('submitted');
      markTalk(id, 'submitted', latest.title);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    if (archived || !proposalId || !window.confirm(t.form.withdrawConfirm)) return;
    setSubmitting(true);
    try {
      await withdrawProposal({ cfpId, proposalId });
      invalidateCache('myProposals');
      invalidateCache(`allProposals:${cfpId}`);
      setStatus('withdrawn');
      markTalk(proposalId, 'withdrawn');
    } catch (error: any) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeleteDraft() {
    const target = proposalIdRef.current;
    if (
      archived ||
      submitting ||
      statusRef.current !== 'draft' ||
      !target ||
      !window.confirm(t.form.deleteDraftConfirm)
    ) {
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      // The same form owns the account-wide profile. Flush it before removing
      // the talk so a quick profile edit is kept as promised by the dialog.
      // This also joins any autosave already in flight.
      if (!(await persist('transition'))) return;

      // Stop any queued debounce after the flush. Nothing may recreate the row
      // once the callable removes it.
      dirty.current = false;
      revision.current += 1;
      await activeSave.current?.catch(() => undefined);
      await deleteDraftProposal({ cfpId, proposalId: target });
      invalidateCache('myProposals');
      invalidateCache(`allProposals:${cfpId}`);

      const remaining = talksRef.current.filter((talk) => talk.id !== target);
      talksRef.current = remaining;
      setTalks(remaining);
      const currentTalks = remaining.filter((talk) => !isPastTalk(talk));
      const next =
        cfp.state === 'open'
          ? (currentTalks.find((talk) => talk.status === 'draft') ?? currentTalks[0])
          : (currentTalks[0] ?? remaining[0]);
      showTalk(next);
      showToast(t.form.draftDeleted, 'success');
    } catch (error) {
      setBanner(friendlyError(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRespond(response: 'confirm' | 'decline') {
    if (archived || !proposalId || uploadingFields.current.size > 0) return;
    // Only the decline is confirmed: saying yes is reversible by declining
    // afterwards, but a decline given by accident gives the slot away.
    if (response === 'decline' && !window.confirm(t.form.confirmDeclineConfirm)) return;
    setSubmitting(true);
    setAnswerFaults({});
    try {
      // Preserve any corrected details before changing a confirmed response to
      // declined. Otherwise a quick edit followed by decline races the debounce
      // and the old answers win if the speaker later confirms again.
      if (
        response === 'decline' &&
        speakerStatusRef.current === 'confirmed' &&
        answerDirty.current &&
        !(await saveConfirmationAnswers('transition'))
      ) {
        return;
      }
      if (activeAnswerSave.current && !(await activeAnswerSave.current)) return;

      const responseAnswers = answersRef.current;
      const { data } = await respondToDecision({
        cfpId,
        proposalId,
        response,
        ...(response === 'confirm' ? { answers: responseAnswers } : {}),
      });
      invalidateCache('myProposals');
      invalidateCache(`allProposals:${cfpId}`);
      invalidateCache(`scheduleDraft:${cfpId}`);
      invalidateCache(`sharedSchedule:${cfpId}`);
      setStatus(data.status);
      statusRef.current = data.status;
      markTalk(proposalId, data.status);
      markOwnResponse(
        proposalId,
        data.response,
        response === 'confirm' ? responseAnswers : savedAnswersRef.current,
      );
      const nextPhotoGeneration =
        response === 'confirm' && confirmFormRef.current.speakerPhoto
          ? currentProfilePhotoGeneration.current
          : null;
      sessionPhotoGenerations.current.set(proposalId, nextPhotoGeneration);
      setSessionPhotoGeneration(nextPhotoGeneration);
      if (response === 'confirm') savedAnswersRef.current = responseAnswers;
      answerDirty.current = false;
      setAnswerSaveState(response === 'confirm' ? 'saved' : 'idle');
      setAnswerSaveError('');
      setSpeakerRosterRefresh((value) => value + 1);
      setProfileRequestRefresh((value) => value + 1);
      setAsking(false);
      setBanner(null);
    } catch (error: any) {
      /*
       * The callable answers a bad form with the faults keyed by field, so the
       * questions can mark themselves rather than showing one banner that does
       * not say which of eight answers is the problem.
       */
      const faults = error?.details as AnswerFaults | undefined;
      if (error?.code === 'functions/invalid-argument' && faults && typeof faults === 'object') {
        setAnswerFaults(faults);
        setBanner(t.form.answersIncomplete);
      } else {
        setBanner(friendlyError(error, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function cancelConfirmationAnswers() {
    setAnswers(savedAnswersRef.current);
    answersRef.current = savedAnswersRef.current;
    answerDirty.current = false;
    setAnswerFaults({});
    setAnswerSaveState('idle');
    setAnswerSaveError('');
    setAsking(false);
  }

  // -------------------------------------------------------------- option sets

  // The stored codes retain their platform meaning; this event owns the labels.
  const options = useMemo(
    () => ({
      category: asOptions(shape.category, locale),
      format: asOptions(shape.format, locale),
      level: asOptions(shape.level, locale),
      delivery: asOptions(shape.deliveryLanguage, locale),
      attendance: asOptions(shape.attendance.statuses, locale).map((option) => ({
        ...option,
        value: option.value as AttendanceStatus,
      })),
    }),
    [shape, locale],
  );

  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length + Object.keys(extraFaults).length;

  if (loading) return <p className="muted">{t.app.loading}</p>;
  if (loadError) {
    return (
      <div className="panel">
        <p className="field__error" role="alert">
          {loadError}
        </p>
        <button type="button" className="btn" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          {t.errors.reload}
        </button>
      </div>
    );
  }
  if (cfp.state !== 'open' && talks.length === 0) {
    return (
      <div className="panel">
        <p>{cfp.state === 'paused' ? t.window.paused : t.window.closed}</p>
        {cfp.state === 'closed' && (
          <p>
            {t.window.closedAt}{' '}
            <strong>
              {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
            </strong>
          </p>
        )}
      </div>
    );
  }

  const submittedCount = talks.filter((talk) => inStatusSet('live', talk.status)).length;
  const profileRequestsByProposal = profileUpdateRequestsByProposal(profileRequests);

  const picker = (
    <TalkPicker
      talks={talks}
      currentId={proposalId}
      currentTitle={form.title}
      busy={
        submitting ||
        saveState === 'saving' ||
        answerSaveState === 'saving' ||
        uploadingAnswer
      }
      // A draft in progress is already the "new" one, so offer another only
      // once this one exists and there is room under the cap.
      canAdd={
        cfp.state === 'open' &&
        proposalId !== null &&
        submittedCount < LIMITS.maxTalksPerSpeaker
      }
      atCap={submittedCount >= LIMITS.maxTalksPerSpeaker}
      profileRequests={profileRequestsByProposal}
      onOpen={openTalk}
      onAdd={startNewTalk}
    />
  );

  const withdrawable = status !== 'draft' && inStatusSet('withdrawable', status);
  const lateSpeakerSchedulePending = lateSpeakerNeedsScheduleRelease(
    selectedTalk?.proposal,
    user.uid,
  );
  const sharedEntry: PublishedScheduleEntry | undefined =
    proposalId && sharedSchedule?.schedule
      ? sharedSchedule.entries.find(
          (entry) =>
            entry.kind === 'proposal' &&
            entry.proposalId === proposalId &&
            !entry.cancelled,
        )
      : undefined;
  const publishedEntry: PublishedScheduleEntry | undefined =
    proposalId && publishedSchedule
      ? publishedSchedule.entries.find(
          (entry) =>
            entry.kind === 'proposal' &&
            entry.proposalId === proposalId &&
            !entry.cancelled,
        )
      : undefined;
  // The newer pointer is authoritative even when its speaker projection is
  // empty. Falling back would resurrect a placement organisers already removed.
  const hasNewerSharedPreview = Boolean(
    cfp.sharedScheduleId && cfp.sharedScheduleId !== cfp.publishedScheduleId,
  );
  const currentScheduleFailed = hasNewerSharedPreview
    ? sharedScheduleFailed
    : publishedScheduleFailed;
  const otherSpeakerDeclined = Boolean(
    usesPersonalConfirmation &&
      ownResponse === 'confirmed' &&
      status !== 'confirmed' &&
      speakerRoster?.items.some(
        (item) =>
          item.kind === 'active' &&
          !item.isCurrentUser &&
          item.confirmationState === 'declined',
      ),
  );
  const waitingOnOtherSpeaker = Boolean(
    usesPersonalConfirmation &&
      ownResponse === 'confirmed' &&
      status !== 'confirmed' &&
      !otherSpeakerDeclined,
  );
  const displayedEntry = lateSpeakerSchedulePending
    ? undefined
    : hasNewerSharedPreview
      ? sharedEntry
      : publishedEntry;
  const displayedSchedule = hasNewerSharedPreview
    ? sharedSchedule?.schedule
    : publishedSchedule?.schedule;
  const displayedRoom =
    displayedEntry?.kind === 'proposal'
      ? displayedSchedule?.rooms.find((room) => room.id === displayedEntry.roomId)
      : undefined;
  const displayedDate =
    displayedEntry?.kind === 'proposal' ? calendarDate(displayedEntry.date) : null;
  const isSharedPlacement = hasNewerSharedPreview && sharedEntry?.kind === 'proposal';
  const speakerSchedule =
    displayedEntry?.kind === 'proposal' && displayedDate
      ? {
          date: formatCalendarDay(displayedDate, locale),
          time: `${displayedEntry.startsAt}–${scheduleEndTime(displayedEntry)}`,
          room: displayedRoom
            ? localised(displayedRoom.name, locale)
            : displayedEntry.roomId,
          language: t.schedule.languageNames[displayedEntry.session.language],
          timeZone: displayedSchedule?.timeZone ?? cfp.profile.timeZone ?? 'America/Toronto',
          public: !isSharedPlacement,
          ...(!isSharedPlacement
            ? { href: href({ route: 'session', cfpId, entryId: displayedEntry.id }) }
            : {}),
        }
      : undefined;
  const profileOnly = scope === 'none';
  const liveErrorKeys = Object.keys(liveErrors);
  const hasAny = (keys: string[]) => keys.some((key) => liveErrorKeys.includes(key));
  const hasPrefix = (prefix: string) => liveErrorKeys.some((key) => key.startsWith(prefix));
  const progressItems: FormProgressItem[] = [
    {
      id: 'submission-talk',
      label: t.sections.proposal,
      complete: !liveErrorKeys.some(
        (key) =>
          key.startsWith('proposal.') &&
          key !== 'proposal.deliveryLanguage' &&
          key !== 'proposal.languagePreference',
      ),
      attention:
        showErrors &&
        liveErrorKeys.some(
          (key) =>
            key.startsWith('proposal.') &&
            key !== 'proposal.deliveryLanguage' &&
            key !== 'proposal.languagePreference',
        ),
    },
    {
      id: 'submission-language',
      label: t.sections.language,
      complete: !hasAny(['proposal.deliveryLanguage', 'proposal.languagePreference']),
      attention:
        showErrors && hasAny(['proposal.deliveryLanguage', 'proposal.languagePreference']),
    },
    ...(proposalId
      ? [
          {
            id: 'submission-co-speakers',
            label: t.coSpeakers.title,
            complete: speakerRoster != null && !speakerRoster.pendingBlocksSubmit,
            attention: speakerRoster === null || Boolean(speakerRoster?.pendingBlocksSubmit),
          },
        ]
      : []),
    {
      id: 'submission-speaker',
      label: t.sections.speaker,
      complete: !hasPrefix('speaker.'),
      attention: showErrors && hasPrefix('speaker.'),
    },
    ...(shape.fields.length > 0
      ? [
          {
            id: 'submission-extra',
            label: t.sections.extra,
            complete: Object.keys(liveExtraFaults).length === 0,
            attention: showErrors && Object.keys(liveExtraFaults).length > 0,
          },
        ]
      : []),
    ...(shape.acks.length > 0
      ? [
          {
            id: 'submission-acknowledgements',
            label: t.sections.acks,
            complete: !hasPrefix('acks.'),
            attention: showErrors && hasPrefix('acks.'),
          },
        ]
      : []),
    ...(shape.attendance.enabled
      ? [
          {
            id: 'submission-attendance',
            label: localised(shape.attendance.title, locale),
            complete: !hasPrefix('attendance.'),
            attention: showErrors && hasPrefix('attendance.'),
          },
        ]
      : []),
  ];

  const lifecycleNext = archived
    ? t.form.nextSteps.archived
    : speakerStatus === 'draft'
      ? cfp.state === 'paused'
        ? t.form.nextSteps.draftPaused
        : cfp.state === 'open'
          ? isCoSpeaker
            ? t.form.nextSteps.coSpeakerDraft
            : t.form.nextSteps.draft
          : t.form.nextSteps.draftClosed
      : speakerStatus === 'submitted'
        ? scope === 'all'
          ? t.form.nextSteps.submittedEditable
          : t.form.nextSteps.submitted
        : speakerStatus === 'under_review'
          ? shape.attendance.enabled
            ? t.form.nextSteps.underReview
            : t.form.nextSteps.underReviewNoAttendance
          : speakerStatus === 'accepted'
            ? t.form.nextSteps.accepted
            : speakerStatus === 'confirmed'
              ? otherSpeakerDeclined
                ? t.form.nextSteps.confirmedSpeakerDeclined
                : waitingOnOtherSpeaker
                ? t.form.nextSteps.confirmedWaitingOnSpeaker
                : lateSpeakerSchedulePending
                ? t.form.nextSteps.confirmedPending
                : speakerSchedule?.public
                  ? t.form.nextSteps.confirmedPublic
                  : speakerSchedule
                    ? t.form.nextSteps.confirmedShared
                    : currentScheduleFailed
                      ? t.form.nextSteps.confirmedUnavailable
                      : hasNewerSharedPreview
                        ? t.form.nextSteps.confirmedPending
                        : t.form.nextSteps.confirmedWaiting
              : speakerStatus === 'waitlisted'
                ? t.form.nextSteps.waitlisted
                : speakerStatus === 'rejected'
                  ? t.form.nextSteps.rejected
                  : speakerStatus === 'declined'
                    ? t.form.nextSteps.declined
                    : t.form.nextSteps.withdrawn;
  return (
    <form className="form submission-form" onSubmit={onSubmit} noValidate>
      {picker}

      <section className="submission-context" aria-label={t.form.submissionContext}>
        <div className="submission-context__identity">
          <span className="submission-context__event">{cfp.name}</span>
          <span
            className={`submission-context__status submission-context__status--${speakerStatus === 'draft' && cfp.state === 'open' ? 'open' : 'set'}`}
          >
            {speakerStatus === 'draft' && cfp.state === 'open'
              ? t.form.acceptingNow
              : t.enums.status[speakerStatus]}
          </span>
        </div>
        <div className="submission-context__deadline">
          <span>{t.form.deadline}</span>
          <strong>
            <time dateTime={cfp.closesAt.toISOString()}>
              {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
            </time>
          </strong>
          <span className="submission-context__timezone">
            {t.form.deadlineTimeZone.replace(
              '{zone}',
              cfp.profile.timeZone ?? 'America/Toronto',
            )}
          </span>
        </div>
      </section>

      <ProposalJourney status={speakerStatus} next={lifecycleNext} />

      {profileRequestsFailed && (
        <aside className="profile-request-load-error" role="alert">
          <div>
            <h2>{t.profileSnapshot.taskLoadFailed}</h2>
            <p>{t.profileSnapshot.taskLoadFailedHelp}</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            {t.errors.reload}
          </button>
        </aside>
      )}

      {/*
        The talk stays on screen after submitting. A speaker who cannot re-read
        what they sent has no way to check it went in, and the withdraw button
        on its own made the page look like a dead end.
      */}
      {speakerStatus !== 'draft' && (
        <StatusBanner
          status={speakerStatus}
          scope={scope}
          personalScope={personalScope}
          isCoSpeaker={isCoSpeaker}
          attendanceEnabled={shape.attendance.enabled}
          busy={archived || submitting || answerSaveState === 'saving' || uploadingAnswer}
          onWithdraw={
            !archived && isPrimarySpeaker && withdrawable ? onWithdraw : undefined
          }
          onRespond={
            !archived &&
            (speakerStatus === 'accepted' || inStatusSet('speakerResponse', speakerStatus))
              ? onRespond
              : undefined
          }
          questions={{
            cfpId,
            proposalId,
            speakerPhoto: confirmForm.speakerPhoto,
            fields: confirmForm.fields,
            answers,
            faults: answerFaults,
            busy: archived || submitting || answerSaveState === 'saving' || uploadingAnswer,
            onAnswer: setConfirmationAnswer,
            onUploadBusyChange: setAnswerUploadBusy,
            sessionPhotoGeneration:
              speakerStatus === 'confirmed' ? sessionPhotoGeneration : undefined,
            onCurrentPhotoGenerationChange: (generation) => {
              currentProfilePhotoGeneration.current = generation;
            },
            onUsePhotoForSession:
              !archived && speakerStatus === 'confirmed'
                ? async (generation) => {
                    if (currentProfilePhotoGeneration.current !== generation) return false;
                    return saveConfirmationAnswers('manual', true);
                  }
                : undefined,
          }}
          asking={asking}
          onAsk={() => setAsking(true)}
          onCancelAsk={cancelConfirmationAnswers}
          onSaveAnswers={
            !archived && speakerStatus === 'confirmed'
              ? () => void saveConfirmationAnswers('manual')
              : undefined
          }
          answerSaveState={answerSaveState}
          answerSaveError={answerSaveError}
          waitingOnOtherSpeaker={waitingOnOtherSpeaker}
          otherSpeakerDeclined={otherSpeakerDeclined}
          schedule={speakerSchedule}
          schedulePending={
            speakerStatus === 'confirmed' &&
            (lateSpeakerSchedulePending ||
              (hasNewerSharedPreview && !sharedEntry && !sharedScheduleFailed))
          }
          scheduleUnavailable={
            speakerStatus === 'confirmed' &&
            !lateSpeakerSchedulePending &&
            currentScheduleFailed
          }
        />
      )}

      <div className="submission-workspace">
        <FormProgress items={progressItems} />
        <div className="submission-workspace__content">
      {/*
        First, because it fills fields in every section below it — the talk as
        well as the speaker. Buried under "About you" it arrives after the work
        it would have saved.
      */}
      <SessionizeImport
        form={form}
        disabled={talkDisabled}
        onApply={(patch) => {
          armHistoryGuard();
          dirty.current = true;
          revision.current += 1;
          setSaveState((current) => (current === 'failed' ? current : 'idle'));
          setForm((prev) => ({ ...prev, ...patch }));
        }}
      />

      {/* ------------------------------------------------------- the talk */}
      <section className="section submission-section" id="submission-talk" tabIndex={-1}>
        <h2 tabIndex={-1}>{t.sections.proposal}</h2>
        <p className="section__help">{t.sections.proposalHelp}</p>

        <TextField
          label={t.proposal.title}
          help={t.proposal.titleHelp}
          value={form.title}
          onChange={(v) => set('title', v)}
          maxLength={LIMITS.title}
          error={err('proposal.title')}
          disabled={talkDisabled}
          required
        />

        <TextAreaField
          label={t.proposal.abstract}
          help={t.proposal.abstractHelp}
          value={form.abstract}
          onChange={(v) => set('abstract', v)}
          minLength={LIMITS.abstractMin}
          maxLength={LIMITS.abstractMax}
          error={err('proposal.abstract')}
          disabled={talkDisabled}
          required
        />

        <TextAreaField
          label={t.proposal.pitch}
          help={t.proposal.pitchHelp}
          value={form.pitch}
          onChange={(v) => set('pitch', v)}
          maxLength={LIMITS.pitchMax}
          rows={4}
          error={err('proposal.pitch')}
          disabled={talkDisabled}
        />

        <div className="grid grid--3">
          <SelectField
            label={t.proposal.category}
            value={form.category}
            options={options.category}
            onChange={(v) => set('category', v)}
            error={err('proposal.category')}
            disabled={talkDisabled}
            required
          />
          <SelectField
            label={t.proposal.format}
            value={form.format}
            options={options.format}
            onChange={(v) => set('format', v)}
            error={err('proposal.format')}
            disabled={talkDisabled}
            required
          />
          <SelectField
            label={t.proposal.level}
            value={form.level}
            options={options.level}
            onChange={(v) => set('level', v)}
            error={err('proposal.level')}
            disabled={talkDisabled}
            required
          />
        </div>
      </section>

      {/* ----------------------------------------------------- co-speakers */}
      <section
        className="section submission-section"
        id="submission-co-speakers"
        tabIndex={-1}
      >
        <h2>{t.coSpeakers.title}</h2>
        {proposalId ? (
          <CoSpeakerRoster
            key={proposalId}
            cfpId={cfpId}
            proposalId={proposalId}
            refreshKey={speakerRosterRefresh}
            onChange={applyRoster}
            onLeft={() => {
              transitionFocus.current = 'leave-waiting';
              setSpeakerRoster(undefined);
              setProposalId(null);
              proposalIdRef.current = null;
              setStatus('draft');
              showToast(t.coSpeakers.leftNotice, 'success');
              setLoadAttempt((attempt) => attempt + 1);
            }}
          />
        ) : (
          <p className="section__help">{t.coSpeakers.startDraftFirst}</p>
        )}
      </section>

      {/* ------------------------------------------------------- language */}
      <section className="section submission-section" id="submission-language" tabIndex={-1}>
        <h2>{t.sections.language}</h2>

        <SelectField
          label={t.language.delivery}
          value={form.deliveryLanguage}
          options={options.delivery}
          onChange={(v) => set('deliveryLanguage', v)}
          error={err('proposal.deliveryLanguage')}
          disabled={talkDisabled}
          required
        />

        {/*
          §4 warned that a mid-talk switch costs half the session for anyone
          comfortable in only one language. The option exists by decision, so
          the mitigation moves to the programme: tell the applicant up front
          how the session will be labelled.
        */}
        <Reveal when={form.deliveryLanguage === 'bilingual'} variant="note">
          {t.language.bilingualNote}
        </Reveal>

        {/* Conditional 3 of 3 */}
        <Reveal
          when={form.deliveryLanguage === 'either'}
          onHide={() => set('languagePreference', '')}
        >
          <TextField
            label={t.language.preference}
            help={t.language.preferenceHelp}
            value={form.languagePreference}
            onChange={(v) => set('languagePreference', v)}
            maxLength={LIMITS.languagePreferenceMax}
            error={err('proposal.languagePreference')}
            disabled={talkDisabled}
          />
        </Reveal>
      </section>

      {/*
        The speaker profile lives on the account (`speakers/{uid}`), not on any
        one talk, and is the same document whichever talk is open. Saying so
        matters: otherwise editing it here reads as editing it "for this talk".
      */}
      <section
        className="section section--account submission-section submission-section--speaker"
        id="submission-speaker"
        tabIndex={-1}
      >
        <h2>{t.sections.speaker}</h2>
        <p className="section__help">{t.sections.speakerHelp}</p>

        {/* Confirmation renders this same account-owned control while it is
            open, including the event-version action. Keep only one live copy. */}
        {!(confirmForm.speakerPhoto && (asking || speakerStatus === 'confirmed')) && (
          <SpeakerProfilePhoto
            disabled={submitting}
            onBusyChange={(next) => setAnswerUploadBusy(SPEAKER_PHOTO_KEY, next)}
            onCurrentGenerationChange={(generation) => {
              currentProfilePhotoGeneration.current = generation;
            }}
          />
        )}

        {speakerEditing || !speakerProfileComplete(form) ? (
          <div className="speaker-editor">
            <SpeakerFields form={form} set={set} err={err} disabled={submitting} />
          </div>
        ) : (
          <SpeakerProfileSummary
            form={form}
            onEdit={() => {
              setSpeakerEditing(true);
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(
                    '#submission-speaker input:not([disabled]), #submission-speaker textarea:not([disabled])',
                  )
                  ?.focus();
              });
            }}
          />
        )}

        {proposalId && status !== 'draft' && status !== 'withdrawn' && (
          <ProfileSnapshotRefresh
            cfpId={cfpId}
            proposalId={proposalId}
            disabled={archived || submitting || saveState === 'saving'}
            showRequestState={speakerStatus === 'accepted' || speakerStatus === 'confirmed'}
            requestRefreshKey={profileRequestRefresh}
            beforeRefresh={async () => !dirty.current || persist('transition')}
            onEditProfile={() => {
              setSpeakerEditing(true);
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(
                    '#submission-speaker input:not([disabled]), #submission-speaker textarea:not([disabled])',
                  )
                  ?.focus({ preventScroll: true });
              });
            }}
            onEditPhoto={() => {
              const photo = document.querySelector<HTMLElement>('.speaker-photo');
              photo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              requestAnimationFrame(() =>
                photo
                  ?.querySelector<HTMLButtonElement>('button:not([disabled])')
                  ?.focus({ preventScroll: true }),
              );
            }}
            onRefreshed={() => setSpeakerRosterRefresh((value) => value + 1)}
            onRequestChanged={(request) => {
              setProfileRequests((current) =>
                request.status === 'pending'
                  ? current.map((summary) =>
                      summary.proposalId === proposalId &&
                      summary.requestId === request.requestId
                        ? { ...summary, resolvedScopes: request.resolvedScopes }
                        : summary,
                    )
                  : current.filter(
                      (summary) =>
                        summary.proposalId !== proposalId ||
                        summary.requestId !== request.requestId,
                    ),
              );
            }}
          />
        )}
      </section>

      {/* --------------------------------------------- this call's own questions */}
      {shape.fields.length > 0 && (
        <section className="section submission-section" id="submission-extra" tabIndex={-1}>
          <h2>{t.sections.extra}</h2>
          <Questions
            cfpId={cfpId}
            proposalId={proposalId}
            fields={shape.fields}
            answers={form.answers}
            faults={extraFaults}
            busy={talkDisabled}
            onAnswer={(key, value) => set('answers', { ...form.answers, [key]: value })}
          />
        </section>
      )}

      {/* ---------------------------------------------------------- acks */}
      {shape.acks.length > 0 && (
        <section
          className="section submission-section"
          id="submission-acknowledgements"
          tabIndex={-1}
        >
          <h2>{t.sections.acks}</h2>
          {shape.acks.map((ack) => (
            <Checkbox
              key={ack.key}
              label={<AckLabel ack={ack} />}
              checked={form.acks[ack.key] === true}
              onChange={(v) => set('acks', { ...form.acks, [ack.key]: v })}
              error={err(`acks.${ack.key}`)}
              disabled={acknowledgementDisabled}
            />
          ))}
        </section>
      )}

      {shape.attendance.enabled && (
      <section className="section submission-section" id="submission-attendance" tabIndex={-1}>
        <h2>{localised(shape.attendance.title, locale)}</h2>

        <RadioGroup
          label={localised(shape.attendance.question, locale)}
          help={localised(shape.attendance.help, locale)}
          value={form.attendanceStatus}
          options={options.attendance}
          onChange={(v) => set('attendanceStatus', v)}
          error={err('attendance.status')}
          disabled={travelDisabled}
          required
        />

        <Reveal
          when={
            shape.attendance.fundingSource.enabled &&
            (form.attendanceStatus === 'secured' || form.attendanceStatus === 'pending')
          }
          onHide={() => set('fundingSource', '')}
        >
          <TextField
            label={localised(shape.attendance.fundingSource.label, locale)}
            help={localised(shape.attendance.fundingSource.help, locale)}
            value={form.fundingSource}
            onChange={(v) => set('fundingSource', v)}
            maxLength={LIMITS.fundingSourceMax}
            error={err('attendance.fundingSource')}
            disabled={travelDisabled}
            required
          />
        </Reveal>

        <Reveal
          when={shape.attendance.decisionBy.enabled && form.attendanceStatus === 'pending'}
          onHide={() => set('decisionBy', '')}
        >
          <TextField
            label={localised(shape.attendance.decisionBy.label, locale)}
            help={localised(shape.attendance.decisionBy.help, locale)}
            value={form.decisionBy}
            onChange={(v) => set('decisionBy', v)}
            type="date"
            error={err('attendance.decisionBy')}
            disabled={travelDisabled}
            required
          />
        </Reveal>

        {shape.attendance.needsVisa.enabled && (
          <Checkbox
            label={localised(shape.attendance.needsVisa.label, locale)}
            checked={form.needsVisa}
            onChange={(v) => set('needsVisa', v)}
            disabled={travelDisabled}
          />
        )}

        <Reveal
          when={
            shape.attendance.needsVisa.enabled &&
            form.needsVisa &&
            Boolean(shape.attendance.needsVisa.help)
          }
          variant="note"
        >
          {localised(shape.attendance.needsVisa.help, locale)}
        </Reveal>

        <Reveal when={form.isGde && Boolean(shape.attendance.gdeGuidance)} variant="note">
          {localised(shape.attendance.gdeGuidance, locale)}
        </Reveal>
      </section>
      )}

      {/* -------------------------------------------------------- actions */}
      <div className="actions">
        <div className="actions__status" aria-live="polite">
          {saveState === 'saving' && (profileOnly ? t.profile.saving : t.form.saving)}
          {saveState === 'saved' && (profileOnly ? t.profile.saved : t.form.saved)}
          {saveState === 'idle' &&
            dirty.current &&
            (profileOnly ? t.profile.unsaved : t.form.unsaved)}
          {saveState === 'failed' && (
            <div className="actions__save-failure" role="alert">
              <span className="field__error">
                {saveError || (profileOnly ? t.profile.saveFailed : t.form.saveFailed)}
              </span>
              <button
                type="button"
                className="btn btn--ghost actions__retry"
                onClick={() => void persist('manual')}
              >
                {profileOnly ? t.profile.retrySave : t.form.retrySave}
              </button>
            </div>
          )}
        </div>

        {showErrors && errorCount > 0 && (
          <p className="field__error" role="alert">
            {t.form.fixErrors} {t.form.errorCount(errorCount)}
          </p>
        )}
        {banner && (
          <p className="field__error" role="alert">
            {banner}
          </p>
        )}
        {isPrimarySpeaker && status === 'draft' && proposalId && speakerRoster === null && (
          <p className="field__error" role="status" id="co-speaker-submit-blocked">
            {t.coSpeakers.loadFailed}
          </p>
        )}

        <div className="actions__buttons">
          {(!profileOnly || dirty.current) && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!dirty.current || saveState === 'saving' || submitting}
              onClick={() => void persist('manual')}
            >
              {profileOnly
                ? isCoSpeaker
                  ? t.coSpeakers.saveDetails
                  : t.profile.save
                : status === 'draft'
                  ? t.form.save
                  : t.form.saveChanges}
            </button>
          )}
          {!archived && isPrimarySpeaker && status === 'draft' && proposalId !== null && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={submitting || saveState === 'saving'}
              onClick={() => void onDeleteDraft()}
            >
              {t.form.deleteDraft}
            </button>
          )}
          {isPrimarySpeaker && status === 'draft' && (
            <button
              type="submit"
              className="btn btn--primary"
              disabled={
                talkDisabled ||
                submittedCount >= LIMITS.maxTalksPerSpeaker ||
                (proposalId !== null && !speakerRoster) ||
                Boolean(speakerRoster?.pendingBlocksSubmit)
              }
              aria-describedby={
                [
                  submittedCount >= LIMITS.maxTalksPerSpeaker ? 'talk-cap-message' : undefined,
                  proposalId !== null && speakerRoster === null
                    ? 'co-speaker-submit-blocked'
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            >
              {submitting ? t.form.submitting : t.form.submit}
            </button>
          )}
        </div>
      </div>
        </div>
      </div>
    </form>
  );
}
