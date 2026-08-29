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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { TextAreaField } from '../components/fields';
import { formatDate } from '../i18n';
import { useI18n } from '../i18n/context';
import { toDate } from '../lib/dates';
import { reviewError } from '../lib/errors';
import { loadSubmissionForm } from '../lib/proposals';
import { reviewerTravelFields } from '../lib/reviewerTravel';
import { loadCfp, loadReviewQueue, type ReviewerProposalRow } from '../lib/roles';
import { loadMyReviews, loadReviewsFor, saveReview, type ReviewRow } from '../lib/reviews';
import {
  clearReviewDraft,
  keepReviewDraft,
  loadReviewDrafts,
  type ReviewDraft as Draft,
} from '../lib/reviewDrafts';
import { LIMITS, SCORES, type Score } from '@shared/enums';
import {
  DEFAULT_SUBMISSION_FORM,
  labelOf,
  type SubmissionField,
  type SubmissionForm,
} from '@shared/submissionForm';
import { localised, type Answers } from '@shared/confirmForm';
import type { Cfp, Review, SpeakerSnapshot } from '@shared/types';

interface SaveFailure {
  id: string;
  title: string;
  draft: Draft;
  message: string;
}

const draftOf = (review?: Review): Draft => ({
  // The rules keep a score-shaped value on every review document, but a
  // declared conflict is not a score. Keep the placeholder out of the UI.
  score: review?.conflictOfInterest ? null : review?.score ?? null,
  conflictOfInterest: review?.conflictOfInterest ?? false,
  comment: review?.comment ?? '',
});

export function ReviewPage({ user, cfpId }: { user: User; cfpId: string }) {
  const { t, locale } = useI18n();
  const [shape, setShape] = useState<SubmissionForm>(DEFAULT_SUBMISSION_FORM);
  const [order, setOrder] = useState<ReviewerProposalRow[]>([]);
  const [own, setOwn] = useState(0);
  const [mine, setMine] = useState<Map<string, Review>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [blindReview, setBlindReview] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedId, setSavedId] = useState('');
  const [failures, setFailures] = useState<Map<string, SaveFailure>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'unreviewed' | 'all'>('unreviewed');
  const [filterEpoch, setFilterEpoch] = useState(0);
  const loadGeneration = useRef(0);
  const draftsRef = useRef(drafts);
  const selectedCategoryRef = useRef(selectedCategory);
  selectedCategoryRef.current = selectedCategory;
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const currentProposalIdRef = useRef<string | null>(null);
  const queueApplyGeneration = useRef(0);
  const activeSavesByScope = useRef<Map<string, number>>(new Map());
  const deferredQueueApply = useRef<Map<string, () => void>>(new Map());
  const scopeKey = `${cfpId}:${user.uid}`;
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;

  const load = useCallback(
    async (force = false) => {
      const request = ++loadGeneration.current;
      deferredQueueApply.current.delete(scopeKey);
      setLoading(true);
      setLoadedFor('');
      setError('');
      setSelectedCategory(null);
      setQueueOpen(false);
      setSavingIds(new Set());
      setSavedId('');
      setFailures(new Map());

      let currentQueueResult: { proposals: ReviewerProposalRow[]; own: number } | null = null;
      let currentCfpResult: Cfp | null = null;
      let currentFormResult: SubmissionForm | null = null;

      const applyQueue = async (
        loadedQueue: { proposals: ReviewerProposalRow[]; own: number },
        cfpDoc: Cfp | null,
        formDoc: SubmissionForm,
        isBackgroundRevalidate = false,
      ) => {
        const applyGen = ++queueApplyGeneration.current;
        const reviews = await loadMyReviews(
          cfpId,
          user.uid,
          loadedQueue.proposals.map((p) => p.id),
        );
        const savesInFlight = activeSavesByScope.current.get(scopeKey) ?? 0;
        if (
          applyGen !== queueApplyGeneration.current ||
          request !== loadGeneration.current ||
          activeScope.current !== scopeKey
        ) {
          return;
        }
        if (isBackgroundRevalidate && savesInFlight > 0) {
          deferredQueueApply.current.set(scopeKey, () => {
            void applyQueue(loadedQueue, cfpDoc, formDoc, true);
          });
          return;
        }
        const visible = cfpDoc?.reviewsVisible === true;
        const opens = toDate(cfpDoc?.opensAt);
        const closes = toDate(cfpDoc?.closesAt);
        const now = Date.now();
        const open = Boolean(
          cfpDoc &&
            cfpDoc.archived !== true &&
            cfpDoc.paused !== true &&
            opens &&
            closes &&
            opens.getTime() <= now &&
            now < closes.getTime(),
        );

        // Decided once, here. Once the round is open, disagreement is the point of
        // the meeting, so the widest spreads come first; until then, work through
        // what is unscored. Either way the deck holds still while you use it.
        const sorted = [...loadedQueue.proposals].sort((a, b) =>
          visible
            ? (b.aggregate?.stdDev ?? 0) - (a.aggregate?.stdDev ?? 0)
            : Number(reviews.has(a.id)) - Number(reviews.has(b.id)),
        );

        const recovered = loadReviewDrafts(cfpId, user.uid);
        const loadedDrafts = new Map(
          sorted.map((proposal) => [
            proposal.id,
            { ...draftOf(reviews.get(proposal.id)), ...recovered.get(proposal.id) },
          ]),
        );
        draftsRef.current = loadedDrafts;

        const effectiveCategory = isBackgroundRevalidate ? selectedCategoryRef.current : null;
        const effectiveStatusFilter = isBackgroundRevalidate
          ? statusFilterRef.current
          : sorted.some((p) => !reviews.has(p.id))
            ? 'unreviewed'
            : 'all';

        const nextCategoryOrder = effectiveCategory
          ? sorted.filter((p) => p.category === effectiveCategory)
          : sorted;
        const nextDeckOrder =
          effectiveStatusFilter === 'unreviewed'
            ? nextCategoryOrder.filter((p) => !reviews.has(p.id))
            : nextCategoryOrder;

        if (!isBackgroundRevalidate) {
          setIndex(0);
          setStatusFilter(effectiveStatusFilter);
          setFilterEpoch((e) => e + 1);
        } else {
          const activeProposalId = currentProposalIdRef.current;
          const matchingIndex = activeProposalId
            ? nextDeckOrder.findIndex((p) => p.id === activeProposalId)
            : -1;
          if (matchingIndex >= 0) {
            setIndex(matchingIndex);
          } else if (nextDeckOrder.length > 0) {
            setIndex((currentIdx) => Math.min(Math.max(0, currentIdx), nextDeckOrder.length - 1));
          } else {
            setIndex(0);
          }
        }

        setOrder(sorted);
        setOwn(loadedQueue.own);
        setMine(reviews);
        setDrafts(loadedDrafts);
        setReviewsVisible(visible);
        setBlindReview(Boolean(cfpDoc?.features?.blindReview));
        setIntakeOpen(open);
        setShape(formDoc);
        setLoadedFor(scopeKey);
      };

      let initialLoaded = false;
      let coalesceHandle: ReturnType<typeof setTimeout> | null = null;
      const revalidated = { cfp: null as { value: Cfp | null } | null };
      const getEffectiveCfp = () => (revalidated.cfp ? revalidated.cfp.value : currentCfpResult);

      const triggerRevalidationApply = () => {
        if (!initialLoaded) return;
        if (coalesceHandle) clearTimeout(coalesceHandle);
        coalesceHandle = setTimeout(() => {
          if (
            request === loadGeneration.current &&
            activeScope.current === scopeKey &&
            currentQueueResult &&
            currentFormResult
          ) {
            void applyQueue(currentQueueResult, getEffectiveCfp(), currentFormResult, true);
          }
        }, 50);
      };

      try {
        const [loaded, cfp, form] = await Promise.all([
          loadReviewQueue(cfpId, {
            force,
            onRevalidate: (updated) => {
              if (request === loadGeneration.current && activeScope.current === scopeKey) {
                currentQueueResult = updated;
                triggerRevalidationApply();
              }
            },
          }),
          loadCfp(cfpId, {
            force,
            onRevalidate: (updatedCfp) => {
              if (request === loadGeneration.current && activeScope.current === scopeKey) {
                revalidated.cfp = { value: updatedCfp };
                triggerRevalidationApply();
              }
            },
          }),
          // The card's chips read their labels off this call's own form — a
          // category this committee invented has no entry in any dictionary.
          loadSubmissionForm(cfpId, {
            force,
            onRevalidate: (updatedForm) => {
              if (request === loadGeneration.current && activeScope.current === scopeKey) {
                currentFormResult = updatedForm;
                triggerRevalidationApply();
              }
            },
          }),
        ]);
        if (request !== loadGeneration.current || activeScope.current !== scopeKey) return;
        currentQueueResult = currentQueueResult ?? loaded;
        currentCfpResult = revalidated.cfp ? revalidated.cfp.value : cfp;
        currentFormResult = currentFormResult ?? form;
        initialLoaded = true;
        await applyQueue(currentQueueResult, currentCfpResult, currentFormResult, false);
      } catch (e) {
        if (request !== loadGeneration.current || activeScope.current !== scopeKey) return;
        setOrder([]);
        setError(reviewError(e, t));
        setLoadedFor(scopeKey);
      } finally {
        if (request === loadGeneration.current && activeScope.current === scopeKey) {
          setLoading(false);
        }
      }
    },
    [cfpId, scopeKey, t, user.uid],
  );

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfpId, user.uid]);

  const scopedOrder = useMemo(
    () => (loadedFor === scopeKey ? order : []),
    [loadedFor, order, scopeKey],
  );
  const categories = Array.from(new Set(scopedOrder.map((p) => p.category).filter(Boolean)));

  const categoryOrder = useMemo(
    () =>
      selectedCategory
        ? scopedOrder.filter((p) => p.category === selectedCategory)
        : scopedOrder,
    [scopedOrder, selectedCategory],
  );

  const deckOrder = useMemo(() => {
    return statusFilter === 'unreviewed'
      ? categoryOrder.filter((p) => !mine.has(p.id))
      : categoryOrder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryOrder, statusFilter, filterEpoch]);

  const isComplete = deckOrder.length === 0 || index >= deckOrder.length;
  const current = !isComplete ? deckOrder[index] : null;
  currentProposalIdRef.current = current?.id ?? null;
  const displayIndex = current ? index : deckOrder.length;

  const handled = categoryOrder.filter((proposal) => mine.has(proposal.id)).length;
  const conflicts = categoryOrder.filter(
    (proposal) => mine.get(proposal.id)?.conflictOfInterest,
  ).length;
  const remaining = Math.max(categoryOrder.length - handled, 0);

  const unscored = deckOrder
    .map((proposal, proposalIndex) => ({ proposal, proposalIndex }))
    .filter(({ proposal }) => !mine.has(proposal.id));
  const nextUnscored =
    unscored.find(({ proposalIndex }) => proposalIndex > displayIndex) ?? unscored[0];

  // Manual arrow navigation is clamped to [0, deckOrder.length - 1] so arrowing does not trigger false completion.
  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(deckOrder.length - 1, 0)));
      setSavedId('');
    },
    [deckOrder.length],
  );

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, deckOrder.length));
    setSavedId('');
  }, [deckOrder.length]);

  const patch = useCallback((id: string, part: Partial<Draft>) => {
    const draft = { ...draftOf(), ...draftsRef.current.get(id), ...part };
    const nextDrafts = new Map(draftsRef.current).set(id, draft);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    keepReviewDraft(cfpId, user.uid, id, draft);
    // If this proposal already has a failed write, Retry must use the edits the
    // reviewer makes while recovering it rather than the older failed snapshot.
    setFailures((prev) => {
      const failed = prev.get(id);
      if (!failed) return prev;
      const next = new Map(prev);
      next.set(id, { ...failed, draft: { ...failed.draft, ...part } });
      return next;
    });
  }, [cfpId, user.uid]);

  /**
   * `id` and `draft` are arguments rather than reads of current state: by the
   * time this resolves the reviewer may be two proposals further on, and a save
   * that looked at the screen would write their score onto the wrong talk.
   */
  const persist = useCallback(
    async (id: string, draft: Draft, title: string) => {
      if (draft.score === null && !draft.conflictOfInterest) return;
      const scope = scopeKey;
      // Review documents intentionally have one fixed shape. A conflicted
      // review is excluded from every aggregate, so this required value is only
      // a storage placeholder and is hidden again by `draftOf`.
      const storedScore = draft.score ?? 1;
      setSavingIds((current) => new Set(current).add(id));
      activeSavesByScope.current.set(
        scope,
        (activeSavesByScope.current.get(scope) ?? 0) + 1,
      );
      queueApplyGeneration.current += 1;
      try {
        await saveReview(cfpId, id, user.uid, {
          score: storedScore,
          conflictOfInterest: draft.conflictOfInterest,
          comment: draft.comment,
        });
        if (activeScope.current !== scope) return;
        setMine((prev) =>
          new Map(prev).set(id, {
            cfpId,
            score: storedScore,
            conflictOfInterest: draft.conflictOfInterest,
            comment: draft.comment.trim() || undefined,
            updatedAt: null,
          }),
        );
        setSavedId(id);
        clearReviewDraft(cfpId, user.uid, id, draft);
        setFailures((current) => {
          const updated = new Map(current);
          updated.delete(id);
          return updated;
        });
      } catch (e) {
        if (activeScope.current !== scope) return;
        setFailures((current) =>
          new Map(current).set(id, {
            id,
            title,
            draft,
            message: reviewError(e, t),
          }),
        );
      } finally {
        const remaining = (activeSavesByScope.current.get(scope) ?? 1) - 1;
        if (remaining <= 0) {
          activeSavesByScope.current.delete(scope);
          queueApplyGeneration.current += 1;
          const deferred = deferredQueueApply.current.get(scope);
          if (deferred) {
            deferredQueueApply.current.delete(scope);
            deferred();
          }
        } else {
          activeSavesByScope.current.set(scope, remaining);
          queueApplyGeneration.current += 1;
        }
        if (activeScope.current === scope) {
          setSavingIds((current) => {
            const updated = new Set(current);
            updated.delete(id);
            return updated;
          });
        }
      }
    },
    [cfpId, scopeKey, t, user.uid],
  );

  /** One key scores and moves on. */
  const scoreAndAdvance = useCallback(
    (score: Score) => {
      if (!current || savingIds.has(current.id)) return;
      const currentDraft = {
        ...draftOf(mine.get(current.id)),
        ...drafts.get(current.id),
      };
      const draft: Draft = {
        ...currentDraft,
        score,
        conflictOfInterest: false,
      };
      patch(current.id, { score, conflictOfInterest: false });
      void persist(current.id, draft, current.title || t.review.untitled);
      advance();
    },
    [current, drafts, mine, patch, persist, advance, savingIds, t.review.untitled],
  );

  /** 0 records conflict of interest and moves on. */
  const conflictAndAdvance = useCallback(() => {
    if (!current || savingIds.has(current.id)) return;
    const currentDraft = {
      ...draftOf(mine.get(current.id)),
      ...drafts.get(current.id),
    };
    const draft: Draft = {
      ...currentDraft,
      score: null,
      conflictOfInterest: true,
    };
    patch(current.id, { score: null, conflictOfInterest: true });
    void persist(current.id, draft, current.title || t.review.untitled);
    advance();
  }, [current, drafts, mine, patch, persist, advance, savingIds, t.review.untitled]);

  /** Save and advance on button click. */
  const saveAndAdvance = useCallback(() => {
    if (!current || savingIds.has(current.id)) return;
    const currentDraft = drafts.get(current.id) ?? draftOf(mine.get(current.id));
    if (currentDraft.score === null && !currentDraft.conflictOfInterest) return;
    void persist(current.id, currentDraft, current.title || t.review.untitled);
    advance();
  }, [current, drafts, mine, persist, advance, savingIds, t.review.untitled]);

  const showFailure = useCallback(
    (id: string) => {
      setStatusFilter('all');
      setFilterEpoch((e) => e + 1);
      const failedIndex = scopedOrder.findIndex((proposal) => proposal.id === id);
      if (failedIndex < 0) return;
      setSelectedCategory(null);
      setIndex(failedIndex);
      setSavedId('');
    },
    [scopedOrder],
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

      const key = event.key.toLowerCase();
      setActiveKey(key);
      setTimeout(() => setActiveKey(null), 250);

      if (event.key === '0') {
        event.preventDefault();
        conflictAndAdvance();
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
  }, [scoreAndAdvance, conflictAndAdvance, go]);

  if (loadedFor !== scopeKey || loading) return <p className="muted">{t.app.loading}</p>;
  if (error && order.length === 0) {
    return (
      <div className="load-failure" role="alert">
        <p className="field__error">{error}</p>
        <button type="button" className="btn" onClick={() => void load(true)}>
          {t.errors.reload}
        </button>
      </div>
    );
  }
  if (scopedOrder.length === 0) {
    return (
      <section className="review-empty" aria-labelledby="review-empty-title">
        <p className="review-workload__eyebrow">{t.review.workload}</p>
        <h2 id="review-empty-title">{t.review.caughtUp}</h2>
        <p>{own > 0 ? t.review.onlyYours : t.review.empty}</p>
        <p className="muted">
          {intakeOpen ? t.review.intakeOpenHelp : t.review.intakeClosedHelp}
        </p>
        <button type="button" className="btn" onClick={() => void load(true)}>
          {t.review.refresh}
        </button>
      </section>
    );
  }

  const draft = current ? (drafts.get(current.id) ?? draftOf(mine.get(current.id))) : draftOf();

  return (
    <div className="deck">
      <section className="review-workload" aria-labelledby="review-workload-title">
        <div className="review-workload__copy">
          <p className="review-workload__eyebrow">{t.review.workload}</p>
          <h2 id="review-workload-title">
            {remaining === 0 ? t.review.caughtUp : t.review.remainingTitle(remaining)}
          </h2>
          <p>{intakeOpen ? t.review.intakeOpenHelp : t.review.intakeClosedHelp}</p>
        </div>
        <dl className="review-workload__stats">
          <div><dt>{t.review.responses}</dt><dd>{handled}</dd></div>
          <div><dt>{t.review.conflicts}</dt><dd>{conflicts}</dd></div>
          <div><dt>{t.review.remaining}</dt><dd>{remaining}</dd></div>
        </dl>
        <button
          type="button"
          className="btn btn--ghost review-workload__refresh"
          disabled={savingIds.size > 0}
          onClick={() => void load(true)}
        >
          {t.review.refresh}
        </button>
      </section>

      {intakeOpen && reviewsVisible && (
        <p className="review-round-warning" role="alert">
          {t.review.scoresVisibleDuringIntake}
        </p>
      )}

      <div className="review-filters">
        <div className="filter-bar" role="group" aria-label={t.review.queue}>
          <button
            type="button"
            className={`filter-pill${statusFilter === 'unreviewed' ? ' filter-pill--active' : ''}`}
            aria-pressed={statusFilter === 'unreviewed'}
            onClick={() => {
              setStatusFilter('unreviewed');
              setFilterEpoch((e) => e + 1);
              setIndex(0);
              setQueueOpen(false);
              setSavedId('');
            }}
          >
            {t.review.filterNeedsResponse} ({remaining})
          </button>
          <button
            type="button"
            className={`filter-pill${statusFilter === 'all' ? ' filter-pill--active' : ''}`}
            aria-pressed={statusFilter === 'all'}
            onClick={() => {
              setStatusFilter('all');
              setFilterEpoch((e) => e + 1);
              setIndex(0);
              setQueueOpen(false);
              setSavedId('');
            }}
          >
            {t.review.filterAll} ({categoryOrder.length})
          </button>
        </div>

        {categories.length > 1 && (
          <div className="filter-bar" role="group" aria-label={t.proposal.category}>
            <button
              type="button"
              className={`filter-pill${selectedCategory === null ? ' filter-pill--active' : ''}`}
              aria-pressed={selectedCategory === null}
              onClick={() => {
                setSelectedCategory(null);
                setFilterEpoch((e) => e + 1);
                setIndex(0);
                setQueueOpen(false);
                setSavedId('');
              }}
            >
              {t.review.allCategories} ({scopedOrder.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`filter-pill${selectedCategory === cat ? ' filter-pill--active' : ''}`}
                aria-pressed={selectedCategory === cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setFilterEpoch((e) => e + 1);
                  setIndex(0);
                  setQueueOpen(false);
                  setSavedId('');
                }}
              >
                {labelOf(shape.category, cat, locale)} (
                {scopedOrder.filter((proposal) => proposal.category === cat).length})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="deck__bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <p className="deck__progress" style={{ margin: 0 }}>
            <strong>
              {deckOrder.length === 0
                ? t.review.position(0, 0)
                : current
                  ? t.review.position(displayIndex + 1, deckOrder.length)
                  : t.review.position(deckOrder.length, deckOrder.length)}
            </strong>
            <span className="muted">
              {' '}
              · {t.review.progress(handled, categoryOrder.length)}
            </span>
          </p>
          {blindReview && (
            <span className="blind-review-badge">
              🛡️ {t.review.blindReviewActive}
            </span>
          )}
        </div>
        <div className="deck__nav">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={displayIndex === 0 && current !== null}
            onClick={() => go(-1)}
            aria-label={t.review.previous}
          >
            ←
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!current || displayIndex >= deckOrder.length - 1}
            onClick={() => go(1)}
            aria-label={t.review.next}
          >
            →
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={queueOpen}
            aria-controls="review-queue"
            onClick={() => setQueueOpen((open) => !open)}
          >
            {queueOpen ? t.review.queueClose : t.review.queue}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={help}
            aria-controls="review-shortcuts"
            onClick={() => setHelp((open) => !open)}
          >
            {t.review.shortcuts}
          </button>
        </div>
      </div>

      {/* Dots rather than a bar: at forty proposals the shape of what is left
          is more useful than a percentage. */}
      <ol className="deck__dots" aria-hidden="true">
        {deckOrder.map((p, i) => (
          <li
            key={p.id}
            className={`deck__dot${mine.has(p.id) ? ' deck__dot--done' : ''}${
              current && i === displayIndex ? ' deck__dot--here' : ''
            }`}
          />
        ))}
      </ol>

      {queueOpen && (
        <section
          className="deck-queue"
          id="review-queue"
          aria-labelledby="review-queue-title"
        >
          <header className="deck-queue__header">
            <div>
              <h2 id="review-queue-title">{t.review.queue}</h2>
              <p>{t.review.queueHelp}</p>
            </div>
            {nextUnscored && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setIndex(nextUnscored.proposalIndex);
                  setQueueOpen(false);
                  setSavedId('');
                }}
              >
                {t.review.nextUnscored}
              </button>
            )}
          </header>
          <ol className="deck-queue__list">
            {deckOrder.map((proposal, proposalIndex) => {
              const currentProposal = current && proposalIndex === displayIndex;
              const review = mine.get(proposal.id);
              const scored = Boolean(review);
              const reviewState = review?.conflictOfInterest
                ? t.review.queueConflict
                : scored
                  ? t.review.queueScored
                  : t.review.queueWaiting;
              const content = (
                <>
                  <span className="deck-queue__number">{proposalIndex + 1}</span>
                  <span className="deck-queue__title">
                    {proposal.title || t.review.untitled}
                  </span>
                  <span
                    className={`deck-queue__status${scored ? ' deck-queue__status--done' : ''}`}
                  >
                    {currentProposal
                      ? `${t.review.queueCurrent} · ${reviewState}`
                      : reviewState}
                  </span>
                </>
              );
              return (
                <li key={proposal.id}>
                  {currentProposal ? (
                    <div
                      className="deck-queue__item deck-queue__item--current"
                      aria-current="true"
                    >
                      {content}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="deck-queue__item"
                      onClick={() => {
                        setIndex(proposalIndex);
                        setQueueOpen(false);
                        setSavedId('');
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {current && remaining === 0 && (
        <p className="note deck__complete" role="status">
          {t.review.complete}
        </p>
      )}

      {help && (
        <dl className="shortcuts" id="review-shortcuts">
          <div>
            <dt><span className={`kbd-badge${['0', '1', '2', '3', '4'].includes(activeKey ?? '') ? ' kbd-badge--active' : ''}`}>0 – 4</span></dt>
            <dd>{t.review.shortcutScore}</dd>
          </div>
          <div>
            <dt><span className={`kbd-badge${['arrowleft', 'arrowright', 'j', 'k'].includes(activeKey ?? '') ? ' kbd-badge--active' : ''}`}>← / → (J/K)</span></dt>
            <dd>{t.review.shortcutMove}</dd>
          </div>
          <div>
            <dt><span className={`kbd-badge${activeKey === '?' ? ' kbd-badge--active' : ''}`}>?</span></dt>
            <dd>{t.review.shortcutHelp}</dd>
          </div>
        </dl>
      )}

      <p className="section__help">
        {reviewsVisible ? t.review.sortedByDisagreement : t.review.help}
        {!reviewsVisible && ` · ${t.review.othersHidden}`}
      </p>

      {failures.size > 0 && (
        <section className="save-recovery" role="alert" aria-labelledby="save-recovery-title">
          <div className="save-recovery__heading">
            <div>
              <h2 id="save-recovery-title">{t.review.saveFailedTitle}</h2>
              <p>{t.review.saveFailedHelp}</p>
            </div>
            <span className="save-recovery__count">{failures.size}</span>
          </div>
          <ul className="save-recovery__list">
            {[...failures.values()].map((failure) => (
              <li key={failure.id}>
                <div>
                  <strong>{failure.title}</strong>
                  <span>{failure.message}</span>
                </div>
                <span className="save-recovery__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={savingIds.has(failure.id)}
                    onClick={() =>
                      void persist(failure.id, failure.draft, failure.title)
                    }
                  >
                    {savingIds.has(failure.id) ? t.review.saving : t.review.retrySave}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => showFailure(failure.id)}
                  >
                    {t.review.returnToProposal}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {current ? (
        <ReviewCard
          shape={shape}
          key={current.id}
          cfpId={cfpId}
          proposal={current}
          draft={draft}
          existing={mine.get(current.id)}
          reviewsVisible={reviewsVisible}
          saving={savingIds.has(current.id)}
          saved={savedId === current.id}
          onPatch={(part) => patch(current.id, part)}
          onScore={scoreAndAdvance}
          onConflict={conflictAndAdvance}
          onSave={saveAndAdvance}
        />
      ) : (
        <DeckCompleted
          handled={handled}
          conflicts={conflicts}
          remaining={remaining}
          statusFilter={statusFilter}
          hasProposals={scopedOrder.length > 0}
          nextUnscoredIndex={nextUnscored?.proposalIndex}
          onJumpToUnscored={(idx) => {
            setIndex(idx);
            setSavedId('');
          }}
          onBrowseAll={() => {
            setStatusFilter('all');
            setFilterEpoch((e) => e + 1);
            setIndex(0);
            setQueueOpen(false);
            setSavedId('');
          }}
          onOpenQueue={() => setQueueOpen(true)}
          onRefresh={() => void load(true)}
          refreshDisabled={savingIds.size > 0}
        />
      )}
    </div>
  );
}

function DeckCompleted({
  handled,
  conflicts,
  remaining,
  statusFilter,
  hasProposals,
  nextUnscoredIndex,
  onJumpToUnscored,
  onBrowseAll,
  onOpenQueue,
  onRefresh,
  refreshDisabled,
}: {
  handled: number;
  conflicts: number;
  remaining: number;
  statusFilter: 'unreviewed' | 'all';
  hasProposals: boolean;
  nextUnscoredIndex?: number;
  onJumpToUnscored: (index: number) => void;
  onBrowseAll: () => void;
  onOpenQueue: () => void;
  onRefresh: () => void;
  refreshDisabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <section className="section card deck-complete-card" aria-labelledby="deck-complete-title">
      <div className="deck-complete-card__header">
        <span className="deck-complete-card__icon" aria-hidden="true">
          {remaining === 0 ? '🎉' : '📋'}
        </span>
        <h2 id="deck-complete-title">
          {remaining === 0 ? t.review.deckCompletedTitle : t.review.remainingTitle(remaining)}
        </h2>
        <p className="card__text">
          {remaining === 0 ? t.review.deckCompletedHelp : t.review.queueHelp}
        </p>
      </div>

      <dl className="review-workload__stats deck-complete-card__stats">
        <div>
          <dt>{t.review.responses}</dt>
          <dd>{handled}</dd>
        </div>
        <div>
          <dt>{t.review.conflicts}</dt>
          <dd>{conflicts}</dd>
        </div>
        <div>
          <dt>{t.review.remaining}</dt>
          <dd>{remaining}</dd>
        </div>
      </dl>

      <div className="deck-complete-card__actions">
        {remaining > 0 && nextUnscoredIndex !== undefined ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onJumpToUnscored(nextUnscoredIndex)}
          >
            {t.review.nextUnscored}
          </button>
        ) : (
          statusFilter === 'unreviewed' &&
          hasProposals && (
            <button type="button" className="btn btn--primary" onClick={onBrowseAll}>
              {t.review.browseAllProposals}
            </button>
          )
        )}
        <button type="button" className="btn btn--ghost" onClick={onOpenQueue}>
          {t.review.queue}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={refreshDisabled}
          onClick={onRefresh}
        >
          {t.review.refresh}
        </button>
      </div>
    </section>
  );
}

interface CardProps {
  cfpId: string;
  shape: SubmissionForm;
  proposal: ReviewerProposalRow;
  draft: Draft;
  existing?: Review;
  reviewsVisible: boolean;
  saving: boolean;
  saved: boolean;
  onPatch: (part: Partial<Draft>) => void;
  onScore: (score: Score) => void;
  onConflict: () => void;
  onSave: () => void;
}

function ReviewCard({
  cfpId,
  shape,
  proposal,
  draft,
  existing,
  reviewsVisible,
  saving,
  saved,
  onPatch,
  onScore,
  onConflict,
  onSave,
}: CardProps) {
  const { t, locale } = useI18n();
  const top = useRef<HTMLElement>(null);
  const titleId = `proposal-${proposal.id}-title`;

  // A new proposal starts at its title, not wherever the last one was scrolled
  // to — otherwise pressing 2 lands you halfway down an abstract you cannot see.
  // Focus follows it as well, so auto-advance announces the new proposal rather
  // than silently replacing the control a keyboard reviewer just activated.
  useEffect(() => {
    top.current?.focus({ preventScroll: true });
    top.current?.scrollIntoView({ block: 'start' });
  }, [proposal.id]);

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
    <section
      className="section card"
      ref={top}
      tabIndex={-1}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{proposal.title || '—'}</h2>
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

      <SubmissionAnswers fields={shape.fields} answers={proposal.answers} />

      {people.map((s, i) => (
        <Speaker key={s.uid || i} speaker={s} />
      ))}

      <Logistics proposal={proposal} shape={shape} />

      {/* Buttons, not radios. These both record a choice and move the deck on,
          and a control that navigates away the moment you touch it is not a
          radio — assistive tech and test tooling alike expect a radio to stay
          put and stay selected. `aria-pressed` carries the state instead. Only
          this proposal locks while its write is in flight; the next card stays
          fast, while going back cannot race two writes onto the same review. */}
      <aside className="review-rubric" aria-labelledby={`rubric-${proposal.id}`}>
        <div className="review-rubric__heading">
          <h3 id={`rubric-${proposal.id}`}>{t.review.rubricTitle}</h3>
          <p>{t.review.rubricHelp}</p>
        </div>
        <ol className="review-rubric__scale">
          <li>
            <strong>{t.review.scores[0]}</strong>
            <span>{t.review.rubric[0]}</span>
          </li>
          {SCORES.map((score) => (
            <li key={score}>
              <strong>{t.review.scores[score]}</strong>
              <span>{t.review.rubric[score]}</span>
            </li>
          ))}
        </ol>
      </aside>

      <TextAreaField
        label={t.review.comment}
        value={draft.comment}
        onChange={(comment) => onPatch({ comment })}
        maxLength={LIMITS.reviewCommentMax}
        rows={3}
        disabled={saving}
      />

      <p className="scores__label" id={`score-${proposal.id}`}>
        {t.review.scoreLabel}
      </p>
      <p className="muted">{t.review.scoreHelp}</p>
      <div className="scores" role="group" aria-labelledby={`score-${proposal.id}`}>
        <button
          type="button"
          className={`btn score score--conflict${draft.conflictOfInterest ? ' score--on' : ''}`}
          aria-pressed={draft.conflictOfInterest}
          disabled={saving}
          onClick={onConflict}
        >
          {t.review.scores[0]}
        </button>
        {SCORES.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn score${!draft.conflictOfInterest && draft.score === s ? ' score--on' : ''}`}
            aria-pressed={!draft.conflictOfInterest && draft.score === s}
            disabled={saving}
            onClick={() => onScore(s)}
          >
            {t.review.scores[s]}
          </button>
        ))}
      </div>

      <div className="card__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || (draft.score === null && !draft.conflictOfInterest)}
          onClick={onSave}
        >
          {saving ? t.review.saving : t.review.saveAndNext}
        </button>
        <span className="muted" aria-live="polite">
          {saved ? t.review.saved : existing ? '' : t.review.notScored}
        </span>
      </div>

      {reviewsVisible && <Committee cfpId={cfpId} proposalId={proposal.id} />}
    </section>
  );
}

/** Current organiser-defined questions about the talk, never speaker logistics. */
function SubmissionAnswers({
  fields,
  answers,
}: {
  fields: SubmissionField[];
  answers?: Answers;
}) {
  const { t, locale } = useI18n();
  if (!answers) return null;

  const rows = fields.flatMap((field) => {
    if (
      field.type === 'image' ||
      field.reviewerVisible === false ||
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

/** Review context and the callable's narrow travel projection for active speakers. */
function Logistics({
  proposal,
  shape,
}: {
  proposal: ReviewerProposalRow;
  shape: SubmissionForm;
}) {
  const { t, locale } = useI18n();
  const submitted = toDate(proposal.submittedAt);

  // `languagePreference` only exists when the delivery language is `either` —
  // the schema rejects it otherwise — so it needs no guard of its own.
  const rows: [string, string][] = [
    proposal.languagePreference
      ? [t.review.languagePreference, proposal.languagePreference]
      : null,
    submitted ? [t.review.submitted, formatDate(submitted, locale)] : null,
  ].filter((row): row is [string, string] => row !== null);

  const travel = (proposal.speakerTravel ?? []).flatMap((speaker) => {
    const fields = reviewerTravelFields(shape.attendance, speaker);
    return fields.length > 0 ? [{ speaker, fields }] : [];
  });
  if (rows.length === 0 && travel.length === 0) return null;

  return (
    <>
      <h3 className="card__subtitle">
        {travel.length > 0 ? t.review.logistics : t.review.submissionDetails}
      </h3>
      {rows.length > 0 && (
        <dl className="answers">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {travel.length > 0 && (
        <div className="review-travel">
          {travel.map(({ speaker, fields }, index) => {
            const name = speaker.name.trim() || t.review.speakerFallback(index + 1);
            const titleId = `travel-${proposal.id}-${index}`;
            const attendanceTitle = localised(shape.attendance.title, locale);
            const speakerRows: [string, string][] = fields.map((field) => {
              if (field === 'status') {
                return [
                  attendanceTitle,
                  labelOf(shape.attendance.statuses, speaker.status ?? '', locale),
                ];
              }
              if (field === 'fundingSource') {
                return [
                  localised(shape.attendance.fundingSource.label, locale),
                  speaker.fundingSource ?? '',
                ];
              }
              if (field === 'decisionBy') {
                return [
                  localised(shape.attendance.decisionBy.label, locale),
                  speaker.decisionBy ?? '',
                ];
              }
              return [
                localised(shape.attendance.needsVisa.label, locale),
                speaker.needsVisa ? t.review.answerYes : t.review.answerNo,
              ];
            });

            return (
              <section
                className="review-travel__person"
                aria-labelledby={titleId}
                key={speaker.uid}
              >
                <h4 id={titleId}>{`${attendanceTitle} — ${name}`}</h4>
                <dl className="answers">
                  {speakerRows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
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

/** Only mounted once an admin opens the round, so nothing anchors before then. */
function Committee({ cfpId, proposalId }: { cfpId: string; proposalId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    setRows(null);
    setError('');
    try {
      setRows(await loadReviewsFor(cfpId, proposalId));
    } catch (e) {
      setError(reviewError(e, tRef.current));
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
  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="card__subtitle">{t.review.others}</h3>
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
    </>
  );
}
