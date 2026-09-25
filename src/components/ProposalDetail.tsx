/**
 * A proposal as the committee reads it — shared by the review deck and the
 * organiser's decision drawer so the two cannot drift apart.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Dictionary } from '../i18n';
import { useI18n } from '../i18n/context';
import { adminReviewsError, reviewError } from '../lib/errors';
import { loadReviewsFor, type ReviewRow } from '../lib/reviews';
import type { ProposalRow } from '../lib/roles';
import { useModalFocus } from '../lib/useModalFocus';
import { localised, type Answers } from '@shared/confirmForm';
import { labelOf, type SubmissionField, type SubmissionForm } from '@shared/submissionForm';
import type { Proposal, SpeakerSnapshot } from '@shared/types';

export type ProposalContentRow = Pick<
  Proposal,
  | 'speakerSnapshot'
  | 'abstract'
  | 'pitch'
  | 'category'
  | 'format'
  | 'level'
  | 'deliveryLanguage'
  | 'answers'
>;

/**
 * Everything under the title: byline, taxonomy, abstract, pitch, answers and
 * speakers. `organiser` includes answers the form hides from reviewers.
 */
export function ProposalContent({
  shape,
  proposal,
  organiser = false,
}: {
  shape: SubmissionForm;
  proposal: ProposalContentRow;
  organiser?: boolean;
}) {
  const { t, locale } = useI18n();

  /*
   * The snapshot frozen onto the proposal at submission, not `speakers/{uid}`.
   *
   * A profile belongs to the account and is global; a role is per CFP. Reading
   * profiles here would hand every committee on the platform the whole speaker
   * directory — and would show a bio edited in 2028 to a 2026 committee.
   */
  const people = proposal.speakerSnapshot ?? [];

  const names = people.map((s) => s.name).filter(Boolean).join(', ');

  /*
   * A chip each, rather than the one dot-separated grey line this used to be.
   *
   * That line ran the speaker's name into four taxonomy values at caption
   * weight, and "Either — you choose" wrapped mid-phrase, so its em dash and
   * the separators read as the same punctuation. A reviewer looked straight at
   * it and reported the category and format as missing from the card.
   */
  const facets = [
    labelOf(shape.category, proposal.category, locale),
    labelOf(shape.format, proposal.format, locale),
    labelOf(shape.level, proposal.level, locale),
    labelOf(shape.deliveryLanguage, proposal.deliveryLanguage, locale),
  ].filter(Boolean);

  return (
    <>
      {names && <p className="card__byline">{names}</p>}
      {facets.length > 0 && (
        <ul className="facets">
          {facets.map((facet) => (
            <li key={facet} className="facet">
              {facet}
            </li>
          ))}
        </ul>
      )}

      <p className="card__text">{proposal.abstract}</p>
      {proposal.pitch && (
        <>
          <h3 className="card__subtitle">{t.proposal.pitch}</h3>
          <p className="card__text">{proposal.pitch}</p>
        </>
      )}

      <SubmissionAnswers
        fields={shape.fields}
        answers={proposal.answers}
        organiser={organiser}
      />

      {people.map((s, i) => (
        <Speaker key={s.uid || i} speaker={s} />
      ))}
    </>
  );
}

/** Current organiser-defined questions about the talk, never speaker logistics. */
function SubmissionAnswers({
  fields,
  answers,
  organiser,
}: {
  fields: SubmissionField[];
  answers?: Answers;
  organiser: boolean;
}) {
  const { t, locale } = useI18n();
  if (!answers) return null;

  const rows = fields.flatMap((field) => {
    if (
      field.type === 'image' ||
      (!organiser && field.reviewerVisible === false) ||
      !Object.prototype.hasOwnProperty.call(answers, field.key)
    ) {
      return [];
    }
    const answer = answers[field.key];
    const value =
      typeof answer === 'boolean'
        ? answer
          ? t.review.answerYes
          : t.review.answerNo
        : field.type === 'select'
          ? localised(
              field.options?.find((option) => option.value === answer)?.label,
              locale,
            ) || answer
          : answer;
    return [{ key: field.key, label: localised(field.label, locale), value }];
  });
  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="card__subtitle">{t.review.submissionAnswers}</h3>
      <dl className="answers">
        {rows.map(({ key, label, value }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Everything the speaker told us, because the committee is judging whether this
 * person can deliver this talk and a name is not enough to do that on. The
 * schema says the bio "feeds promotion as well as review" — review never saw it.
 *
 * The known cost is bias: an employer and a GDE badge import reputation that
 * the abstract did not earn. Deliberate, and the alternative was worse — a
 * reviewer guessing at delivery risk with nothing to go on at all.
 */
function Speaker({ speaker }: { speaker: SpeakerSnapshot }) {
  const { t } = useI18n();
  const line = [[speaker.jobTitle, speaker.company].filter(Boolean).join(', '), speaker.basedIn]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="speaker">
      <h3 className="card__subtitle">
        {speaker.name || '—'}
        {speaker.isGde && <span className="tag">{t.review.gde}</span>}
      </h3>
      {line && <p className="speaker__line">{line}</p>}
      {speaker.bio && <p className="card__text">{speaker.bio}</p>}

      {speaker.pastTalks && (
        <>
          <p className="speaker__label">{t.speaker.pastTalks}</p>
          <p className="card__text">{speaker.pastTalks}</p>
        </>
      )}

      {speaker.socials && speaker.socials.length > 0 && (
        <p className="speaker__line">
          {speaker.socials.map((s, i) => (
            <span key={`${s.platform}-${s.handle}-${i}`}>
              {i > 0 && ' · '}
              {(t.enums.socialPlatform as Record<string, string>)[s.platform] ?? s.platform}:{' '}
              {s.handle}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Every review on one proposal, read once on mount. `emptyNote` makes an
 * unreviewed proposal say so instead of rendering nothing.
 */
export function Committee({
  cfpId,
  proposalId,
  emptyNote,
  describeError = reviewError,
}: {
  cfpId: string;
  proposalId: string;
  emptyNote?: string;
  describeError?: (error: unknown, t: Dictionary) => string;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(t);
  tRef.current = t;
  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  const load = useCallback(async () => {
    setRows(null);
    setError('');
    try {
      setRows(await loadReviewsFor(cfpId, proposalId));
    } catch (e) {
      setError(describeRef.current(e, tRef.current));
      setRows([]);
    }
  }, [cfpId, proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return (
      <p className="muted" role="status">
        {t.app.loading}
      </p>
    );
  }
  if (error) {
    return (
      <div className="load-failure" role="alert">
        <p className="field__error">{error}</p>
        <button type="button" className="btn btn--ghost" onClick={() => void load()}>
          {t.errors.reload}
        </button>
      </div>
    );
  }
  if (rows.length === 0 && !emptyNote) return null;

  return (
    <>
      <h3 className="card__subtitle">{t.review.others}</h3>
      {rows.length === 0 ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <ul className="reviews">
          {rows.map((row) => (
            <li key={row.reviewerUid}>
              <strong>
                {row.conflictOfInterest
                  ? t.review.conflictDeclared
                  : t.review.scores[row.score]}
              </strong>
              {row.comment && <p className="card__text">{row.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Rules deny a role-holder the reviews of any proposal they speak or spoke on,
 * so the drawer does not ask. Mirrors `speaksOnThis()` in `firestore.rules`.
 */
export function speaksOn(row: ProposalRow, uid: string): boolean {
  return (
    (row.speakerIds ?? []).includes(uid) ||
    (row.formerSpeakerIds ?? []).includes(uid) ||
    (row.speakerParticipants ?? []).some((participant) => participant.uid === uid)
  );
}

/** The organiser's full read of one proposal, beside the table it came from. */
export function ProposalDetailDialog({
  cfpId,
  shape,
  proposal,
  viewerUid,
  decision,
  onClose,
}: {
  cfpId: string;
  shape: SubmissionForm;
  proposal: ProposalRow;
  viewerUid: string;
  decision?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);
  const aggregate = proposal.aggregate;

  return (
    <div
      className="proposal-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="proposal-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-detail-title"
        tabIndex={-1}
      >
        <div className="proposal-detail__header">
          <div>
            <p className="proposal-detail__eyebrow">{t.admin.detailEyebrow}</p>
            <h2 id="proposal-detail-title">{proposal.title || t.admin.untitled}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t.admin.detailClose}
          </button>
        </div>

        <div className="proposal-detail__body">
          {decision && (
            <div className="proposal-detail__decision">
              <span>{t.admin.colStatus}</span>
              {decision}
            </div>
          )}

          {aggregate && aggregate.reviewCount > 0 && (
            <div className="selection-metrics" aria-label={t.admin.detailAggregate}>
              <div className="selection-metric">
                <span>{t.admin.colScore}</span>
                <strong>{aggregate.avgScore.toFixed(2)}</strong>
              </div>
              <div className="selection-metric">
                <span>{t.admin.detailNormalized}</span>
                <strong>{aggregate.normalizedScore.toFixed(2)}</strong>
              </div>
              <div className="selection-metric">
                <span>{t.admin.colReviews}</span>
                <strong>{aggregate.reviewCount}</strong>
              </div>
              <div className="selection-metric">
                <span>{t.admin.colSpread}</span>
                <strong>{aggregate.stdDev.toFixed(2)}</strong>
              </div>
            </div>
          )}

          <ProposalContent shape={shape} proposal={proposal} organiser />

          {speaksOn(proposal, viewerUid) ? (
            <>
              <h3 className="card__subtitle">{t.review.others}</h3>
              <p className="muted">{t.admin.detailOwnProposal}</p>
            </>
          ) : (
            <Committee
              cfpId={cfpId}
              proposalId={proposal.id}
              emptyNote={t.admin.detailNoReviews}
              describeError={adminReviewsError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
