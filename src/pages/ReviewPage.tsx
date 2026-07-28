/**
 * One proposal at a time, scored from the keyboard.
 *
 * The list this replaces made a reviewer scroll past everything they had
 * already done to reach what they had not, and scoring meant finding the right
 * radio in the right card. Reviewing forty proposals is the committee's least
 * pleasant evening; the shape that survives it is a deck — read, press a
 * number, land on the next one.
 *
 * Two things had to be true for that to be safe. The order is frozen when the
 * queue loads: it used to be recomputed from `mine` on every render, which is
 * invisible in a list and fatal in a deck, where scoring would reshuffle the
 * thing you are about to navigate to. And the save is bound to the proposal it
 * came from, not to whatever is on screen when it lands, so a slow write can
 * never attach a score to the wrong talk.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { Checkbox, TextAreaField } from '../components/fields';
import { formatDate, useI18n } from '../i18n';
import { toDate } from '../lib/dates';
import { friendlyError } from '../lib/errors';
import {
  loadCfpConfig,
  loadReviewQueue,
  loadSpeakers,
  type ProposalRow,
  type SpeakerBrief,
} from '../lib/roles';
import { loadMyReviews, loadReviewsFor, saveReview, type ReviewRow } from '../lib/reviews';
import { LIMITS, SCORES, type Score } from '@shared/enums';
import type { Review } from '@shared/types';

interface Draft {
  score: Score | null;
  conflictOfInterest: boolean;
  comment: string;
}

const draftOf = (review?: Review): Draft => ({
  score: review?.score ?? null,
  conflictOfInterest: review?.conflictOfInterest ?? false,
  comment: review?.comment ?? '',
});

export function ReviewPage({ user }: { user: User }) {
  const { t } = useI18n();
  const [order, setOrder] = useState<ProposalRow[]>([]);
  const [own, setOwn] = useState(0);
  const [mine, setMine] = useState<Map<string, Review>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [speakers, setSpeakers] = useState<Map<string, SpeakerBrief>>(new Map());
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);

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
      const visible = config?.reviewsVisible === true;

      // Decided once, here. Once the round is open, disagreement is the point of
      // the meeting, so the widest spreads come first; until then, work through
      // what is unscored. Either way the deck holds still while you use it.
      const sorted = [...loaded.proposals].sort((a, b) =>
        visible
          ? (b.aggregate?.stdDev ?? 0) - (a.aggregate?.stdDev ?? 0)
          : Number(reviews.has(a.id)) - Number(reviews.has(b.id)),
      );

      setOrder(sorted);
      setOwn(loaded.own);
      setMine(reviews);
      setDrafts(new Map(sorted.map((p) => [p.id, draftOf(reviews.get(p.id))])));
      setSpeakers(people);
      setReviewsVisible(visible);
      setIndex(0);
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setLoading(false);
    }
  }, [user.uid, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = order[index];

  // Clamped rather than wrapping: the ends are ends, so a held-down arrow does
  // not quietly loop back to the start.
  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(order.length - 1, 0)));
      setSavedId('');
    },
    [order.length],
  );

  const patch = useCallback((id: string, part: Partial<Draft>) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(id, { ...draftOf(), ...prev.get(id), ...part });
      return next;
    });
  }, []);

  /**
   * `id` and `draft` are arguments rather than reads of current state: by the
   * time this resolves the reviewer may be two proposals further on, and a save
   * that looked at the screen would write their score onto the wrong talk.
   */
  const persist = useCallback(
    async (id: string, draft: Draft) => {
      if (draft.score === null) return;
      setSaving(true);
      setError('');
      try {
        await saveReview(id, user.uid, {
          score: draft.score,
          conflictOfInterest: draft.conflictOfInterest,
          comment: draft.comment,
        });
        setMine((prev) =>
          new Map(prev).set(id, {
            score: draft.score as Score,
            conflictOfInterest: draft.conflictOfInterest,
            comment: draft.comment.trim() || undefined,
            updatedAt: null,
          }),
        );
        setSavedId(id);
      } catch (e) {
        setError(friendlyError(e, t));
      } finally {
        setSaving(false);
      }
    },
    [user.uid, t],
  );

  /** The whole point of the redesign: one key scores and moves on. */
  const scoreAndAdvance = useCallback(
    (score: Score) => {
      if (!current) return;
      const draft = { ...draftOf(mine.get(current.id)), ...drafts.get(current.id), score };
      patch(current.id, { score });
      void persist(current.id, draft);
      // Navigation does not wait for the write. The save carries its own id, so
      // landing on the next card cannot misattribute it.
      go(1);
    },
    [current, drafts, mine, patch, persist, go],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal a keystroke from someone writing a comment.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key >= '1' && event.key <= '4') {
        event.preventDefault();
        scoreAndAdvance(Number(event.key) as Score);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'j') {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'k') {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setHelp((open) => !open);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scoreAndAdvance, go]);

  if (loading) return <p className="muted">{t.app.loading}</p>;
  if (error && order.length === 0) {
    return (
      <p className="field__error" role="alert">
        {error}
      </p>
    );
  }
  if (order.length === 0) {
    // "Nothing to review" reads as a bug when the one submission on the system
    // is your own. Say which of the two it is.
    return <p className="muted">{own > 0 ? t.review.onlyYours : t.review.empty}</p>;
  }
  if (!current) return null;

  const draft = drafts.get(current.id) ?? draftOf(mine.get(current.id));

  return (
    <div className="deck">
      <div className="deck__bar">
        <p className="deck__progress">
          <strong>{t.review.position(index + 1, order.length)}</strong>
          <span className="muted"> · {t.review.progress(mine.size, order.length)}</span>
        </p>
        <div className="deck__nav">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={index === 0}
            onClick={() => go(-1)}
            aria-label={t.review.previous}
          >
            ←
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={index >= order.length - 1}
            onClick={() => go(1)}
            aria-label={t.review.next}
          >
            →
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={help}
            onClick={() => setHelp((open) => !open)}
          >
            {t.review.shortcuts}
          </button>
        </div>
      </div>

      {/* Dots rather than a bar: at forty proposals the shape of what is left
          is more useful than a percentage. */}
      <ol className="deck__dots" aria-hidden="true">
        {order.map((p, i) => (
          <li
            key={p.id}
            className={`deck__dot${mine.has(p.id) ? ' deck__dot--done' : ''}${
              i === index ? ' deck__dot--here' : ''
            }`}
          />
        ))}
      </ol>

      {help && (
        <dl className="shortcuts">
          <div>
            <dt>1 – 4</dt>
            <dd>{t.review.shortcutScore}</dd>
          </div>
          <div>
            <dt>← / →</dt>
            <dd>{t.review.shortcutMove}</dd>
          </div>
          <div>
            <dt>?</dt>
            <dd>{t.review.shortcutHelp}</dd>
          </div>
        </dl>
      )}

      <p className="section__help">
        {reviewsVisible ? t.review.sortedByDisagreement : t.review.help}
        {!reviewsVisible && ` · ${t.review.othersHidden}`}
      </p>

      <ReviewCard
        key={current.id}
        proposal={current}
        draft={draft}
        existing={mine.get(current.id)}
        speakers={speakers}
        reviewsVisible={reviewsVisible}
        saving={saving}
        saved={savedId === current.id}
        onPatch={(part) => patch(current.id, part)}
        onScore={scoreAndAdvance}
        onSave={() => persist(current.id, draft)}
      />

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CardProps {
  proposal: ProposalRow;
  draft: Draft;
  existing?: Review;
  speakers: Map<string, SpeakerBrief>;
  reviewsVisible: boolean;
  saving: boolean;
  saved: boolean;
  onPatch: (part: Partial<Draft>) => void;
  onScore: (score: Score) => void;
  onSave: () => void;
}

function ReviewCard({
  proposal,
  draft,
  existing,
  speakers,
  reviewsVisible,
  saving,
  saved,
  onPatch,
  onScore,
  onSave,
}: CardProps) {
  const { t } = useI18n();
  const top = useRef<HTMLElement>(null);

  // A new proposal starts at its title, not wherever the last one was scrolled
  // to — otherwise pressing 2 lands you halfway down an abstract you cannot see.
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [proposal.id]);

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
    <section className="section card" ref={top}>
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

      <Logistics proposal={proposal} />

      {/* Buttons, not radios. These both record a choice and move the deck on,
          and a control that navigates away the moment you touch it is not a
          radio — assistive tech and test tooling alike expect a radio to stay
          put and stay selected. `aria-pressed` carries the state instead.
          Never disabled while saving: scoring fast is the entire point, and
          each save already carries its own id. */}
      <p className="scores__label" id={`score-${proposal.id}`}>
        {t.review.scoreLabel}
      </p>
      <div className="scores" role="group" aria-labelledby={`score-${proposal.id}`}>
        {SCORES.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn score${draft.score === s ? ' score--on' : ''}`}
            aria-pressed={draft.score === s}
            onClick={() => onScore(s)}
          >
            {t.review.scores[s]}
          </button>
        ))}
      </div>

      <Checkbox
        label={t.review.conflict}
        checked={draft.conflictOfInterest}
        onChange={(conflictOfInterest) => onPatch({ conflictOfInterest })}
        disabled={saving}
      />
      <p className="field__help">{t.review.conflictHelp}</p>

      <TextAreaField
        label={t.review.comment}
        value={draft.comment}
        onChange={(comment) => onPatch({ comment })}
        maxLength={LIMITS.reviewCommentMax}
        rows={3}
        disabled={saving}
      />

      <div className="card__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || draft.score === null}
          onClick={onSave}
        >
          {saving ? t.review.saving : t.review.save}
        </button>
        <span className="muted" aria-live="polite">
          {saved ? t.review.saved : existing ? '' : t.review.notScored}
        </span>
      </div>

      {reviewsVisible && <Committee proposalId={proposal.id} />}
    </section>
  );
}

/**
 * What it takes to actually put this talk on the schedule.
 *
 * The applicant answers all of this and none of it reached the committee, so a
 * reviewer scored a talk without knowing the speaker needs a visa and expects
 * to hear about funding after the programme locks. That is not a tie-breaker
 * between two good talks — it is the difference between a session that happens
 * and a hole in the grid.
 *
 * Two things the applicant sent are deliberately still not here. `acks` are
 * three `z.literal(true)` fields, so every proposal carries the same three
 * values and rendering them says nothing about this one. The speaker's email
 * address is contact detail, not evidence about the talk; the admin screen has
 * it for the people who need to write to them.
 */
function Logistics({ proposal }: { proposal: ProposalRow }) {
  const { t, locale } = useI18n();
  const { attendance } = proposal;
  const submitted = toDate(proposal.submittedAt);

  // `languagePreference` only exists when the delivery language is `either` —
  // the schema rejects it otherwise — so it needs no guard of its own.
  const rows: [string, string][] = [
    proposal.languagePreference
      ? [t.review.languagePreference, proposal.languagePreference]
      : null,
    attendance?.status ? [t.review.travel, t.review.attendance[attendance.status]] : null,
    attendance?.fundingSource ? [t.review.funding, attendance.fundingSource] : null,
    attendance?.decisionBy ? [t.review.decisionBy, attendance.decisionBy] : null,
    attendance?.needsVisa ? [t.review.visa, t.review.visaYes] : null,
    submitted ? [t.review.submitted, formatDate(submitted, locale)] : null,
  ].filter((row): row is [string, string] => row !== null);

  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="card__subtitle">{t.review.logistics}</h3>
      <dl className="answers">
        {rows.map(([label, value]) => (
          <div key={label}>
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
function Speaker({ speaker }: { speaker: SpeakerBrief }) {
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
            {row.conflictOfInterest && <span className="muted"> · {t.review.conflictDeclared}</span>}
            {row.comment && <p className="card__text">{row.comment}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
