/**
 * The platform's front door: the calls anyone can find, plus the ones you run.
 *
 * Two separate queries rather than one. `list` on `cfps` allows exactly the
 * public-and-not-archived query and exactly the owner's own — rules are not
 * filters, so a single wider listing would be denied outright rather than
 * trimmed to what the caller may see.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';

import { formatCalendarDay, formatDay } from '../i18n';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from '../components/Link';
import {
  loadMyCfps,
  loadMyMemberships,
  loadMyProposalCfps,
  loadPublicCfps,
  type CfpMembershipSummary,
  type CfpProposalActivity,
  type CfpSummary,
} from '../lib/roles';
import { calendarDate } from '@shared/cfp';
import type { ProposalStatus } from '@shared/enums';
import type { PlatformAccessStatus } from '@shared/platform';

interface AccountActivity {
  uid: string;
  mine: CfpSummary[];
  helping: CfpMembershipSummary[];
  proposals: CfpProposalActivity[];
}

export function HomePage({
  user,
  platformStatus,
  platformReady,
  platformError,
  retryPlatform,
}: {
  user: User | null;
  platformStatus: PlatformAccessStatus | null;
  platformReady: boolean;
  platformError: boolean;
  retryPlatform: () => void;
}) {
  const { t } = useI18n();
  const uid = user?.uid ?? null;
  const [open, setOpen] = useState<CfpSummary[] | null>(null);
  const [accountActivity, setAccountActivity] = useState<AccountActivity | null>(null);
  const [publicFailed, setPublicFailed] = useState(false);
  const [accountLoadingUid, setAccountLoadingUid] = useState<string | null>(null);
  const [accountFailedUid, setAccountFailedUid] = useState<string | null>(null);
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
    setAccountLoadingUid(uid);
    setAccountFailedUid(null);
    const [owned, memberships, submitted] = await Promise.allSettled([
      loadMyCfps(uid),
      loadMyMemberships(uid),
      loadMyProposalCfps(uid),
    ]);
    if (request !== accountRequest.current) return;
    const failed =
      owned.status === 'rejected' ||
        memberships.status === 'rejected' ||
        submitted.status === 'rejected';
    setAccountActivity({
      uid,
      mine: owned.status === 'fulfilled' ? owned.value : [],
      helping: memberships.status === 'fulfilled' ? memberships.value : [],
      proposals: submitted.status === 'fulfilled' ? submitted.value : [],
    });
    setAccountFailedUid(failed ? uid : null);
    setAccountLoadingUid(null);
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    accountRequest.current += 1;
    if (!uid) {
      setAccountActivity(null);
      setAccountLoadingUid(null);
      setAccountFailedUid(null);
      return;
    }
    void loadAccount(uid);
  }, [loadAccount, uid]);

  const currentActivity = uid && accountActivity?.uid === uid ? accountActivity : null;
  const mine = currentActivity?.mine ?? [];
  const helping = currentActivity?.helping ?? [];
  const proposals = currentActivity?.proposals ?? [];
  const accountLoading =
    uid !== null &&
    (accountLoadingUid === uid ||
      (accountActivity?.uid !== uid && accountFailedUid !== uid));
  const accountFailed = uid !== null && accountFailedUid === uid;

  // Owning one already lists it above; this section is for the calls somebody
  // else runs and invited you onto.
  const owned = new Set(mine.map((cfp) => cfp.id));
  const elsewhere = helping.filter((cfp) => !owned.has(cfp.id));
  const hasActivity = proposals.length > 0 || mine.length > 0 || elsewhere.length > 0;

  return (
    <div className="home-discovery">
      {user && (accountLoading || accountFailed || hasActivity) && (
        <section className="home-activity" aria-labelledby="your-activity-title">
          <header className="home-activity__header">
            <p className="home-activity__eyebrow">{t.app.account}</p>
            <h2 id="your-activity-title">{t.platform.activity}</h2>
            <p>{t.platform.activityHelp}</p>
          </header>

          {accountLoading && (
            <p className="home-collection__state" role="status">
              {t.app.loading}
            </p>
          )}
          {!accountLoading && accountFailed && (
            <LoadFailure onRetry={() => loadAccount(user.uid)} />
          )}

          {proposals.length > 0 && (
            <ActivityCollection
              title={t.platform.submissions}
              help={t.platform.submissionsHelp}
              id="your-proposals-title"
            >
              <CfpList
                cfps={proposals}
                sortBy="activity"
                linkFor={(cfp) => {
                  const activity = proposals.find((item) => item.id === cfp.id)!;
                  return {
                    to: href({ route: 'form', cfpId: cfp.id }),
                    action: proposalAction(activity.proposalStatuses, t),
                    context: proposalSummary(activity.proposalStatuses, t),
                  };
                }}
              />
            </ActivityCollection>
          )}

          {mine.length > 0 && (
            <ActivityCollection
              title={t.platform.yours}
              help={t.platform.yoursHelp}
              id="your-calls-title"
            >
              <CfpList
                cfps={mine}
                linkFor={(cfp) => ({
                  to: href({ route: 'admin', cfpId: cfp.id }),
                  action: t.platform.manageEvent,
                })}
              />
            </ActivityCollection>
          )}

          {elsewhere.length > 0 && (
            <ActivityCollection
              title={t.platform.helping}
              help={t.platform.helpingHelp}
              id="helping-calls-title"
            >
              <CfpList
                cfps={elsewhere}
                linkFor={(cfp) => {
                  const membership = elsewhere.find((item) => item.id === cfp.id)!;
                  const manages = membership.role === 'admin' || membership.role === 'owner';
                  return {
                    to: href({
                      route: manages ? 'admin' : 'review',
                      cfpId: cfp.id,
                    }),
                    action: manages ? t.platform.manageEvent : t.platform.reviewTalks,
                    context: t.enums.role[membership.role],
                  };
                }}
              />
            </ActivityCollection>
          )}
        </section>
      )}

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
          {(!user || platformStatus?.canCreateCfp) && (
            <Link className="btn" to={href({ route: 'new' })}>
              {t.platform.create}
            </Link>
          )}
          {platformStatus?.isPlatformAdmin && (
            <Link className="btn btn--ghost" to={href({ route: 'platform' })}>
              {t.platformAdmin.accountLink}
            </Link>
          )}
          {!user ? (
            <p className="organiser-callout__note">{t.platform.signInFirst}</p>
          ) : !platformReady ? (
            <p className="organiser-callout__note" role="status">
              {t.app.loading}
            </p>
          ) : platformError ? (
            <>
              <p className="organiser-callout__note" role="alert">
                {t.platformAdmin.loadError}
              </p>
              <button type="button" className="btn btn--ghost" onClick={retryPlatform}>
                {t.platformAdmin.retry}
              </button>
            </>
          ) : !platformStatus?.canCreateCfp ? (
            <>
              <p className="organiser-callout__note">
                {t.platformAdmin.accessRequiredHelp}
              </p>
              <button type="button" className="btn btn--ghost" onClick={retryPlatform}>
                {t.platformAdmin.checkAgain}
              </button>
            </>
          ) : null}
        </div>
      </aside>

    </div>
  );
}

function ActivityCollection({
  title,
  help,
  id,
  children,
}: {
  title: string;
  help: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <section className="home-collection" aria-labelledby={id}>
      <header className="home-collection__header">
        <h3 id={id} className="home-collection__title">
          {title}
        </h3>
        <p className="home-collection__help">{help}</p>
      </header>
      {children}
    </section>
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

interface CardLink {
  to: string;
  action: string;
  context?: string;
}

function CfpList({
  cfps,
  sortBy = 'window',
  linkFor,
}: {
  cfps: CfpSummary[];
  sortBy?: 'window' | 'activity';
  linkFor?: (cfp: CfpSummary) => CardLink;
}) {
  const now = Date.now();
  const state = (cfp: CfpSummary) => cardState(cfp, now);
  const ordered = [...cfps].sort((a, b) => {
    if (sortBy === 'activity') {
      const aActivity = toDate((a as CfpProposalActivity).activityUpdatedAt)?.getTime() ?? 0;
      const bActivity = toDate((b as CfpProposalActivity).activityUpdatedAt)?.getTime() ?? 0;
      if (aActivity !== bActivity) return bActivity - aActivity;
    }
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
        <CfpCard key={cfp.id} cfp={cfp} link={linkFor?.(cfp)} />
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

function CfpCard({ cfp, link }: { cfp: CfpSummary; link?: CardLink }) {
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
    .replace('{details}', `${details}${link?.context ? ` ${link.context}.` : ''}`);
  const destination = link?.to ?? href({ route: 'cfp', cfpId: cfp.id });
  const action = link?.action ?? t.platform.view;

  return (
    <li className={`cfp-card cfp-card--${state}`}>
      <Link
        className="cfp-card__link"
        to={destination}
        aria-label={`${accessibleName} ${action}.`}
      >
        <span className="cfp-card__topline">
          <span className={`cfp-card__status cfp-card__status--${state}`}>{stateLabel}</span>
          {cfp.visibility === 'private' && (
            <span className="cfp-card__tag">{t.platform.private}</span>
          )}
        </span>
        <span className="cfp-card__name">{cfp.name}</span>
        <span className="cfp-card__slug">/c/{cfp.id}</span>
        {link?.context && <span className="cfp-card__context">{link.context}</span>}
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
            {action}
            <span className="cfp-card__arrow" aria-hidden="true">
              →
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

const STATUS_PRIORITY: ProposalStatus[] = [
  'accepted',
  'draft',
  'waitlisted',
  'under_review',
  'submitted',
  'confirmed',
  'rejected',
  'declined',
  'withdrawn',
];

function proposalAction(
  statuses: ProposalStatus[],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (statuses.includes('accepted')) return t.platform.respondToDecision;
  if (statuses.includes('draft')) return t.platform.continueDraft;
  if (statuses.some((status) => ['waitlisted', 'rejected', 'declined'].includes(status))) {
    return t.platform.viewDecision;
  }
  return t.platform.viewProposals;
}

function proposalSummary(
  statuses: ProposalStatus[],
  t: ReturnType<typeof useI18n>['t'],
): string {
  const counts = new Map<ProposalStatus, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return STATUS_PRIORITY.filter((status) => counts.has(status))
    .map((status) => {
      const count = counts.get(status)!;
      return `${count > 1 ? `${count} × ` : ''}${t.enums.status[status]}`;
    })
    .join(' · ');
}
