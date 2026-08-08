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

import type { ReactNode } from 'react';

import { formatCalendarDay, formatDate } from '../i18n';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from '../components/Link';
import type { CfpWindow } from '../lib/proposals';
import { calendarDate } from '@shared/cfp';
import { localised } from '@shared/confirmForm';

export function CfpPage({ cfp, cfpId }: { cfp: CfpWindow; cfpId: string }) {
  const { t, locale } = useI18n();
  const { description, eventDate, eventStartDate, eventEndDate, venue, location, website } =
    cfp.profile;

  const blurb = localised(description, locale);
  const starts = eventStartDate ?? eventDate;
  const ends = eventEndDate ?? starts;
  const day = starts ? calendarDate(starts) : null;
  const endDay = ends && ends !== starts ? calendarDate(ends) : null;

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
      <div className="cfp-hero">
        <div className="cfp-hero__accent" aria-hidden="true">
          <span className="cfp-hero__accent-blue" />
          <span className="cfp-hero__accent-red" />
          <span className="cfp-hero__accent-yellow" />
          <span className="cfp-hero__accent-green" />
        </div>

        <div className="cfp-hero__topline">
          <p className="cfp-hero__eyebrow">{t.cfpPage.eyebrow}</p>
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
        <time dateTime={cfp.opensAt.toISOString()}>{formatDate(cfp.opensAt, locale)}</time>
      </>
    );
  }
  if (cfp.state === 'closed') {
    return (
      <>
        {t.window.closed} {t.window.closedAt}{' '}
        <time dateTime={cfp.closesAt.toISOString()}>{formatDate(cfp.closesAt, locale)}</time>
      </>
    );
  }
  return (
    <>
      {t.window.closesAt}{' '}
      <time dateTime={cfp.closesAt.toISOString()}>{formatDate(cfp.closesAt, locale)}</time>
    </>
  );
}
