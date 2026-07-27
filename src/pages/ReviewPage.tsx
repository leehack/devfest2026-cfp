import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { Checkbox, RadioGroup, TextAreaField } from '../components/fields';
import { useI18n } from '../i18n';
import { friendlyError } from '../lib/errors';
import {
  loadCfpConfig,
  loadReviewQueue,
  loadSpeakers,
  type ProposalRow,
  type ReviewQueue,
  type SpeakerBrief,
} from '../lib/roles';
import { loadMyReviews, loadReviewsFor, saveReview, type ReviewRow } from '../lib/reviews';
import { LIMITS, SCORES, type Score } from '@shared/enums';
import type { Review } from '@shared/types';

export function ReviewPage({ user }: { user: User }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<ReviewQueue>({ proposals: [], own: 0 });
  const [mine, setMine] = useState<Map<string, Review>>(new Map());
  const [speakers, setSpeakers] = useState<Map<string, SpeakerBrief>>(new Map());
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loaded, config] = await Promise.all([loadReviewQueue(user.uid), loadCfpConfig()]);
      const [reviews, people] = await Promise.all([
        loadMyReviews(
          user.uid,
          loaded.proposals.map((p) => p.id),
        ),
        loadSpeakers(loaded.proposals.flatMap((p) => p.speakerIds ?? [])),
      ]);
      setQueue(loaded);
      setMine(reviews);
      setSpeakers(people);
      setReviewsVisible(config?.reviewsVisible === true);
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setLoading(false);
    }
  }, [user.uid, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="muted">{t.app.loading}</p>;
  if (error) {
    return (
      <p className="field__error" role="alert">
        {error}
      </p>
    );
  }
  if (queue.proposals.length === 0) {
    // "Nothing to review" reads as a bug when the one submission on the system
    // is your own. Say which of the two it is.
    return <p className="muted">{queue.own > 0 ? t.review.onlyYours : t.review.empty}</p>;
  }

  // Once the round is open, disagreement is the point of the meeting, so the
  // widest spreads come first. Until then, work through what is unscored.
  const ordered = [...queue.proposals].sort((a, b) =>
    reviewsVisible
      ? (b.aggregate?.stdDev ?? 0) - (a.aggregate?.stdDev ?? 0)
      : Number(mine.has(a.id)) - Number(mine.has(b.id)),
  );

  return (
    <>
      <p className="section__help">
        {reviewsVisible ? t.review.sortedByDisagreement : t.review.help}
      </p>
      <p className="deadline">
        {t.review.progress(mine.size, queue.proposals.length)}
        {!reviewsVisible && ` · ${t.review.othersHidden}`}
      </p>

      {ordered.map((proposal) => (
        <ReviewCard
          key={proposal.id}
          uid={user.uid}
          proposal={proposal}
          existing={mine.get(proposal.id)}
          speakers={speakers}
          reviewsVisible={reviewsVisible}
          onSaved={(review) => setMine((prev) => new Map(prev).set(proposal.id, review))}
        />
      ))}
    </>
  );
}

interface CardProps {
  uid: string;
  proposal: ProposalRow;
  existing?: Review;
  speakers: Map<string, SpeakerBrief>;
  reviewsVisible: boolean;
  onSaved: (review: Review) => void;
}

function ReviewCard({ uid, proposal, existing, speakers, reviewsVisible, onSaved }: CardProps) {
  const { t } = useI18n();
  const [score, setScore] = useState<Score | null>(existing?.score ?? null);
  const [conflict, setConflict] = useState(existing?.conflictOfInterest ?? false);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (score === null) return;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const draft = { score, conflictOfInterest: conflict, comment };
      await saveReview(proposal.id, uid, draft);
      setSaved(true);
      onSaved({ ...draft, comment: comment.trim() || undefined, updatedAt: null });
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setBusy(false);
    }
  }

  const people = (proposal.speakerIds ?? [])
    .map((id) => speakers.get(id))
    .filter((s): s is SpeakerBrief => Boolean(s));

  const meta = [
    people.map((s) => s.name).filter(Boolean).join(', '),
    t.enums.category[proposal.category],
    t.enums.format[proposal.format],
    t.enums.level[proposal.level],
    t.enums.deliveryLanguage[proposal.deliveryLanguage],
  ].filter(Boolean);

  return (
    <section className="section card">
      <h2>{proposal.title || '—'}</h2>
      <p className="section__help">{meta.join(' · ')}</p>

      <p className="card__text">{proposal.abstract}</p>
      {proposal.pitch && (
        <>
          <h3 className="card__subtitle">{t.proposal.pitch}</h3>
          <p className="card__text">{proposal.pitch}</p>
        </>
      )}

      {people.map((s, i) => (
        <Speaker key={proposal.speakerIds?.[i] ?? i} speaker={s} />
      ))}

      <RadioGroup
        label={t.review.scoreLabel}
        value={score === null ? '' : String(score)}
        options={SCORES.map((s) => ({ value: String(s), label: t.review.scores[s] }))}
        onChange={(v) => setScore(Number(v) as Score)}
        required
        disabled={busy}
      />

      <Checkbox
        label={t.review.conflict}
        checked={conflict}
        onChange={setConflict}
        disabled={busy}
      />
      <p className="field__help">{t.review.conflictHelp}</p>

      <TextAreaField
        label={t.review.comment}
        value={comment}
        onChange={setComment}
        maxLength={LIMITS.reviewCommentMax}
        rows={3}
        disabled={busy}
      />

      <div className="card__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || score === null}
          onClick={save}
        >
          {busy ? t.review.saving : t.review.save}
        </button>
        <span className="muted" aria-live="polite">
          {saved ? t.review.saved : existing ? '' : t.review.notScored}
        </span>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      {reviewsVisible && <Committee proposalId={proposal.id} />}
    </section>
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
function Speaker({ speaker }: { speaker: SpeakerBrief }) {
  const { t } = useI18n();
  const line = [
    [speaker.jobTitle, speaker.company].filter(Boolean).join(', '),
    speaker.basedIn,
  ]
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

/** Only mounted once an admin opens the round, so nothing anchors before then. */
function Committee({ proposalId }: { proposalId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReviewRow[]>([]);

  useEffect(() => {
    loadReviewsFor(proposalId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [proposalId]);

  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="card__subtitle">{t.review.others}</h3>
      <ul className="reviews">
        {rows.map((row) => (
          <li key={row.reviewerUid}>
            <strong>{t.review.scores[row.score]}</strong>
            {row.conflictOfInterest && (
              <span className="muted"> · {t.review.conflictDeclared}</span>
            )}
            {row.comment && <p className="card__text">{row.comment}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
