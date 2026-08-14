/**
 * The public face of one call for proposals.
 *
 * Everything else on this site assumes you already decided to submit. This is
 * the page that has to earn that: what the event is, when and where it is, and
 * how long there is left. It renders the same signed out as signed in, because
 * the audience it exists for has not signed in and may never.
 *
 * `generateMetadata` in `src/app/c/[cfpId]/page.tsx` puts the same facts into the
 * HTML as meta tags, so a link to this page previews as itself in a message
 * rather than as the app's generic title.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';

import { formatCalendarDay, formatDate } from '../i18n';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from '../components/Link';
import { transferError } from '../lib/errors';
import {
  acceptEventOwnershipTransfer,
  getEventOwnershipTransfer,
} from '../lib/roles';
import type { CfpWindow } from '../lib/proposals';
import { calendarDate } from '@shared/cfp';
import { localised } from '@shared/confirmForm';
import type { OwnershipTransfer } from '@shared/types';

export function CfpPage({
  cfp,
  cfpId,
  user,
  onRoleChanged,
}: {
  cfp: CfpWindow;
  cfpId: string;
  user: User | null;
  onRoleChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [transfer, setTransfer] = useState<OwnershipTransfer | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferFailure, setTransferFailure] = useState('');
  const [transferAccepted, setTransferAccepted] = useState(false);
  const { description, eventDate, eventStartDate, eventEndDate, venue, location, website } =
    cfp.profile;

  const blurb = localised(description, locale);
  const starts = eventStartDate ?? eventDate;
  const ends = eventEndDate ?? starts;
  const day = starts ? calendarDate(starts) : null;
  const endDay = ends && ends !== starts ? calendarDate(ends) : null;

  useEffect(() => {
    let cancelled = false;
    setTransfer(null);
    setTransferFailure('');
    setTransferAccepted(false);
    if (!user) return () => { cancelled = true; };
    void getEventOwnershipTransfer({ cfpId })
      .then(({ data }) => {
        if (!cancelled) setTransfer(data.transfer ?? null);
      })
      .catch(() => {
        if (!cancelled) setTransfer(null);
      });
    return () => { cancelled = true; };
  }, [cfpId, user]);

  async function acceptTransfer() {
    if (!transfer || transferBusy) return;
    setTransferBusy(true);
    setTransferFailure('');
    try {
      await acceptEventOwnershipTransfer({ cfpId });
      setTransfer(null);
      setTransferAccepted(true);
      onRoleChanged();
    } catch (error) {
      setTransferFailure(transferError(error, t));
    } finally {
      setTransferBusy(false);
    }
  }

  const facts: { label: string; value: ReactNode }[] = [];
  // `formatCalendarDay`, not `formatDate`: this is a day, and the deadline below
  // is the only thing here with an hour worth printing. "at 12:00 a.m." beside an
  // event date reads as a bug, because it is one. It also must not be converted
  // between zones — see `calendarDate`.
  if (day) {
    facts.push({
      label: t.cfpPage.when,
      value: endDay ? (
        <>
          <time dateTime={starts}>{formatCalendarDay(day, locale)}</time>
          {' – '}
          <time dateTime={ends}>{formatCalendarDay(endDay, locale)}</time>
        </>
      ) : (
        <time dateTime={starts}>{formatCalendarDay(day, locale)}</time>
      ),
    });
  }
  if (venue || location) {
    facts.push({ label: t.cfpPage.where, value: [venue, location].filter(Boolean).join(', ') });
  }
  if (website) {
    facts.push({
      label: t.cfpPage.website,
      // `noreferrer` as well as `noopener`: this URL is typed by an organiser
      // and the page it opens has no business knowing where it was linked from.
      value: (
        <a href={website} target="_blank" rel="noopener noreferrer">
          {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      ),
    });
  }

  const open = cfp.state === 'open';
  const stateLabel = t.cfpPage.status[cfp.state];

  return (
    <div className="cfp-landing">
      {(transfer || transferAccepted) && (
        <section className="ownership-transfer-card" aria-labelledby="event-transfer-title">
          <div>
            <p className="home-activity__eyebrow">{t.transfer.acceptTitle}</p>
            <h2 id="event-transfer-title">{cfp.name}</h2>
            <p>
              {transferAccepted
                ? t.transfer.transferred
                : t.transfer.acceptBanner(cfp.name)}
            </p>
            {transferFailure && <p className="field__error" role="alert">{transferFailure}</p>}
          </div>
          {transfer && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={transferBusy}
              onClick={() => void acceptTransfer()}
            >
              {transferBusy ? t.transfer.accepting : t.transfer.acceptButton}
            </button>
          )}
        </section>
      )}
      <div className="cfp-hero">
        <div className="cfp-hero__accent" aria-hidden="true" style={{ background: 'var(--masthead-bg, var(--primary))' }} />

        <div className="cfp-hero__topline">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <p className="cfp-hero__eyebrow" style={{ margin: 0 }}>{t.cfpPage.eyebrow}</p>
            {cfp.orgId && (
              <Link
                to={`/orgs/${cfp.orgId}`}
                className="org-badge"
                style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
              >
                🏢 {cfp.orgId}
              </Link>
            )}
            {cfp.features?.blindReview && (
              <span className="blind-review-badge" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
                🛡️ Blind Review
              </span>
            )}
          </div>
          <div className="cfp-hero__actions">
            <span className={`cfp-hero__status cfp-hero__status--${cfp.state}`}>
              {stateLabel}
            </span>
            {open && (
              <Link className="btn btn--primary btn--compact" to={href({ route: 'form', cfpId })}>
                {t.cfpPage.submitAction}
              </Link>
            )}
            {!open && cfp.state !== 'before' && (
              <Link className="btn btn--compact" to={href({ route: 'form', cfpId })}>
                {t.cfpPage.manageAction}
              </Link>
            )}
          </div>
        </div>

        <div className="cfp-hero__body">
          {blurb ? (
            // Paragraph breaks survive; nothing else is interpreted. This text is
            // typed by an organiser into a textarea, not written in markup.
            blurb
              .split(/\n{2,}/)
              .map((para, i) => <p key={i} className="cfp-hero__blurb">{para}</p>)
          ) : (
            <div className="cfp-hero__pending">
              <p className="cfp-hero__pending-title">{t.cfpPage.noDescription}</p>
              <p className="cfp-hero__pending-help">{t.cfpPage.noDescriptionHelp}</p>
            </div>
          )}
        </div>

        {facts.length > 0 && (
          <dl className="cfp-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="cfp-facts__item">
                <dt className="cfp-facts__label">{fact.label}</dt>
                <dd className="cfp-facts__value">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <section className="cfp-cta" aria-labelledby="cfp-submit-title">
        <div className="cfp-cta__copy">
          <p className="cfp-cta__eyebrow">{t.cfpPage.nextStep}</p>
          <h2 id="cfp-submit-title" className="cfp-cta__title">
            {open || cfp.state === 'before'
              ? t.cfpPage.submitting
              : t.cfpPage.managing}
          </h2>
          <p className="cfp-cta__deadline">{deadlineLine(cfp, t, locale)}</p>
        </div>
        <div className="cfp-cta__action">
          {open && (
            <Link className="btn btn--primary" to={href({ route: 'form', cfpId })}>
              {t.cfpPage.submitAction}
            </Link>
          )}
          {!open && cfp.state !== 'before' && (
            <Link className="btn" to={href({ route: 'form', cfpId })}>
              {t.cfpPage.manageAction}
            </Link>
          )}
          <p className="cfp-cta__note">{submissionNote(cfp.state, t)}</p>
        </div>
      </section>
    </div>
  );
}

function submissionNote(
  state: CfpWindow['state'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (state === 'before') return t.cfpPage.submitBeforeNote;
  if (state === 'paused') return t.cfpPage.submitPausedNote;
  if (state === 'closed') return t.cfpPage.submitClosedNote;
  if (state === 'archived') return t.cfpPage.submitArchivedNote;
  return t.cfpPage.submitNote;
}

/** One sentence about the window, whichever state it is in. */
function deadlineLine(
  cfp: CfpWindow,
  t: ReturnType<typeof useI18n>['t'],
  locale: 'en' | 'fr',
): ReactNode {
  if (cfp.state === 'archived') return t.window.closed;
  if (cfp.state === 'paused') return t.window.paused;
  if (cfp.state === 'before') {
    return (
      <>
        {t.window.notOpen} {t.window.opensAt}{' '}
        <time dateTime={cfp.opensAt.toISOString()}>
          {formatDate(cfp.opensAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
        </time>
      </>
    );
  }
  if (cfp.state === 'closed') {
    return (
      <>
        {t.window.closed} {t.window.closedAt}{' '}
        <time dateTime={cfp.closesAt.toISOString()}>
          {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
        </time>
      </>
    );
  }
  return (
    <>
      {t.window.closesAt}{' '}
      <time dateTime={cfp.closesAt.toISOString()}>
        {formatDate(cfp.closesAt, locale, cfp.profile.timeZone ?? 'America/Toronto')}
      </time>
    </>
  );
}
