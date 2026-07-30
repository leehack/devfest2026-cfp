/**
 * The platform's front door: the calls anyone can find, plus the ones you run.
 *
 * Two separate queries rather than one. `list` on `cfps` allows exactly the
 * public-and-not-archived query and exactly the owner's own — rules are not
 * filters, so a single wider listing would be denied outright rather than
 * trimmed to what the caller may see.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';

import { formatCalendarDay, formatDay } from '../i18n';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from '../components/Link';
import {
  loadMyCfps,
  loadMyMemberships,
  loadPublicCfps,
  type CfpSummary,
} from '../lib/roles';
import { calendarDate } from '@shared/cfp';

export function HomePage({ user }: { user: User | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<CfpSummary[] | null>(null);
  const [mine, setMine] = useState<CfpSummary[]>([]);
  const [helping, setHelping] = useState<CfpSummary[]>([]);
  const [publicFailed, setPublicFailed] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountFailed, setAccountFailed] = useState(false);
  const accountRequest = useRef(0);

  const loadPublic = useCallback(async () => {
    setOpen(null);
    setPublicFailed(false);
    try {
      setOpen(await loadPublicCfps());
    } catch {
      setPublicFailed(true);
      setOpen([]);
    }
  }, []);

  const loadAccount = useCallback(async (uid: string) => {
    const request = ++accountRequest.current;
    setAccountLoading(true);
    setAccountFailed(false);
    const [owned, memberships] = await Promise.allSettled([
      loadMyCfps(uid),
      loadMyMemberships(uid),
    ]);
    if (request !== accountRequest.current) return;
    if (owned.status === 'fulfilled') setMine(owned.value);
    if (memberships.status === 'fulfilled') setHelping(memberships.value);
    setAccountFailed(owned.status === 'rejected' || memberships.status === 'rejected');
    setAccountLoading(false);
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    accountRequest.current += 1;
    if (!user) {
      setMine([]);
      setHelping([]);
      setAccountLoading(false);
      setAccountFailed(false);
      return;
    }
    void loadAccount(user.uid);
  }, [loadAccount, user]);

  // Owning one already lists it above; this section is for the calls somebody
  // else runs and invited you onto.
  const owned = new Set(mine.map((cfp) => cfp.id));
  const elsewhere = helping.filter((cfp) => !owned.has(cfp.id));

  return (
    <div className="home-discovery">
      <section className="home-discovery__primary" aria-labelledby="open-calls-title">
        <header className="home-discovery__intro">
          <p className="home-discovery__eyebrow">{t.platform.eyebrow}</p>
          <h2 id="open-calls-title" className="home-discovery__title">
            {t.platform.title}
          </h2>
          <p className="home-discovery__help">{t.platform.help}</p>
        </header>

        <div className="home-discovery__listing" aria-busy={open === null}>
          {open === null ? (
            <p className="home-discovery__empty" role="status">
              {t.app.loading}
            </p>
          ) : publicFailed ? (
            <LoadFailure onRetry={loadPublic} />
          ) : open.length === 0 ? (
            <p className="home-discovery__empty">{t.platform.none}</p>
          ) : (
            <CfpList cfps={open} />
          )}
        </div>
      </section>

      <aside className="organiser-callout" aria-labelledby="organiser-callout-title">
        <div className="organiser-callout__copy">
          <p className="organiser-callout__eyebrow">{t.platform.organiserEyebrow}</p>
          <h2 id="organiser-callout-title" className="organiser-callout__title">
            {t.platform.organiserTitle}
          </h2>
          <p className="organiser-callout__help">{t.platform.organiserHelp}</p>
        </div>
        <div className="organiser-callout__action">
          <Link className="btn" to={href({ route: 'new' })}>
            {t.platform.create}
          </Link>
          {!user && <p className="organiser-callout__note">{t.platform.signInFirst}</p>}
        </div>
      </aside>

      {user && accountLoading && (
        <p className="home-collection__state" role="status">
          {t.app.loading}
        </p>
      )}
      {user && !accountLoading && accountFailed && (
        <LoadFailure onRetry={() => loadAccount(user.uid)} />
      )}

      {mine.length > 0 && (
        <section className="home-collection" aria-labelledby="your-calls-title">
          <header className="home-collection__header">
            <h2 id="your-calls-title" className="home-collection__title">
              {t.platform.yours}
            </h2>
            <p className="home-collection__help">{t.platform.yoursHelp}</p>
          </header>
          <CfpList cfps={mine} />
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="home-collection" aria-labelledby="helping-calls-title">
          <header className="home-collection__header">
            <h2 id="helping-calls-title" className="home-collection__title">
              {t.platform.helping}
            </h2>
            <p className="home-collection__help">{t.platform.helpingHelp}</p>
          </header>
          <CfpList cfps={elsewhere} />
        </section>
      )}
    </div>
  );
}

function LoadFailure({ onRetry }: { onRetry: () => void | Promise<void> }) {
  const { t } = useI18n();
  return (
    <div className="home-discovery__empty load-failure" role="alert">
      <p>{t.errors.unavailable}</p>
      <button type="button" className="btn" onClick={() => void onRetry()}>
        {t.errors.reload}
      </button>
    </div>
  );
}

/** Timestamps arrive from Firestore, not from the callable's JSON. */
const toDate = (value: unknown): Date | null => {
  const at = (value as { toDate?: () => Date } | undefined)?.toDate?.();
  return at instanceof Date ? at : null;
};

function CfpList({ cfps }: { cfps: CfpSummary[] }) {
  const now = Date.now();
  const state = (cfp: CfpSummary) => cardState(cfp, now);
  const ordered = [...cfps].sort((a, b) => {
    const rank = { open: 0, upcoming: 1, paused: 2, closed: 3, archived: 4 } as const;
    const byState = rank[state(a)] - rank[state(b)];
    if (byState !== 0) return byState;

    const aDate = toDate(state(a) === 'upcoming' ? a.opensAt : a.closesAt)?.getTime() ?? Infinity;
    const bDate = toDate(state(b) === 'upcoming' ? b.opensAt : b.closesAt)?.getTime() ?? Infinity;
    return aDate - bDate || a.name.localeCompare(b.name);
  });

  return (
    <ul className="cfp-card-list">
      {ordered.map((cfp) => (
        <CfpCard key={cfp.id} cfp={cfp} />
      ))}
    </ul>
  );
}

type CardState = 'open' | 'upcoming' | 'paused' | 'closed' | 'archived';

function cardState(cfp: CfpSummary, now: number): CardState {
  if (cfp.archived) return 'archived';
  if (cfp.paused) return 'paused';

  const opensAt = toDate(cfp.opensAt);
  const closesAt = toDate(cfp.closesAt);
  if (opensAt && now < opensAt.getTime()) return 'upcoming';
  if (closesAt && now >= closesAt.getTime()) return 'closed';
  return 'open';
}

function CfpCard({ cfp }: { cfp: CfpSummary }) {
  const { t, locale } = useI18n();
  const opensAt = toDate(cfp.opensAt);
  const closesAt = toDate(cfp.closesAt);
  const state = cardState(cfp, Date.now());
  const stateLabel = t.platform.status[state];
  const relevantDate = state === 'upcoming' ? opensAt : closesAt;
  const eventDay = cfp.eventDate ? calendarDate(cfp.eventDate) : null;

  const when =
    state === 'upcoming' && opensAt
      ? t.platform.opensOn.replace('{date}', formatDay(opensAt, locale))
      : state === 'open' && closesAt
        ? t.platform.closesOn.replace('{date}', formatDay(closesAt, locale))
        : state === 'closed' && closesAt
          ? t.platform.closedOn.replace('{date}', formatDay(closesAt, locale))
          : state === 'paused'
            ? t.platform.paused
            : state === 'archived'
              ? t.platform.archived
              : '';
  const details = [when, cfp.visibility === 'private' ? t.platform.private : '']
    .filter(Boolean)
    .map((detail) => ` ${detail}.`)
    .join('');
  const accessibleName = t.platform.cardLabel
    .replace('{name}', cfp.name)
    .replace('{status}', stateLabel)
    .replace('{path}', `/c/${cfp.id}`)
    .replace('{details}', details);

  return (
    <li className={`cfp-card cfp-card--${state}`}>
      <Link
        className="cfp-card__link"
        to={href({ route: 'cfp', cfpId: cfp.id })}
        aria-label={accessibleName}
      >
        <span className="cfp-card__topline">
          <span className={`cfp-card__status cfp-card__status--${state}`}>{stateLabel}</span>
          {cfp.visibility === 'private' && (
            <span className="cfp-card__tag">{t.platform.private}</span>
          )}
        </span>
        <span className="cfp-card__name">{cfp.name}</span>
        <span className="cfp-card__slug">/c/{cfp.id}</span>
        {(eventDay || cfp.location) && (
          <span className="cfp-card__event">
            {eventDay && (
              <time className="cfp-card__event-date" dateTime={cfp.eventDate}>
                {formatCalendarDay(eventDay, locale)}
              </time>
            )}
            {eventDay && cfp.location && (
              <span className="cfp-card__event-separator" aria-hidden="true">
                ·
              </span>
            )}
            {cfp.location && <span className="cfp-card__location">{cfp.location}</span>}
          </span>
        )}
        <span className="cfp-card__footer">
          {when && (
            <time className="cfp-card__deadline" dateTime={relevantDate?.toISOString()}>
              {when}
            </time>
          )}
          <span className="cfp-card__view">
            {t.platform.view}
            <span className="cfp-card__arrow" aria-hidden="true">
              →
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}
