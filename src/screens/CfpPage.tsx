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

import { formatCalendarDay, formatDate } from '../i18n';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';
import { Link } from '../components/Link';
import type { CfpWindow } from '../lib/proposals';
import { calendarDate } from '@shared/cfp';
import { localised } from '@shared/confirmForm';

export function CfpPage({ cfp, cfpId }: { cfp: CfpWindow; cfpId: string }) {
  const { t, locale } = useI18n();
  const { description, eventDate, venue, location, website } = cfp.profile;

  const blurb = localised(description, locale);
  const day = eventDate ? calendarDate(eventDate) : null;

  const facts: { label: string; value: React.ReactNode }[] = [];
  // `formatCalendarDay`, not `formatDate`: this is a day, and the deadline below
  // is the only thing here with an hour worth printing. "at 12:00 a.m." beside an
  // event date reads as a bug, because it is one. It also must not be converted
  // between zones — see `calendarDate`.
  if (day) facts.push({ label: t.cfpPage.when, value: formatCalendarDay(day, locale) });
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

  return (
    <>
      <section className="section">
        {blurb ? (
          // Paragraph breaks survive; nothing else is interpreted. This text is
          // typed by an organiser into a textarea, not written in markup.
          blurb
            .split(/\n{2,}/)
            .map((para, i) => <p key={i} className="cfp-page__blurb">{para}</p>)
        ) : (
          <p className="muted">{t.cfpPage.noDescription}</p>
        )}

        {facts.length > 0 && (
          <dl className="facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="section">
        <h2>{t.cfpPage.submitting}</h2>
        <p>{deadlineLine(cfp, t, locale)}</p>
        {open ? (
          <Link className="btn btn--primary" to={href({ route: 'form', cfpId })}>
            {t.cfpPage.submitAction}
          </Link>
        ) : (
          <Link className="btn" to={href({ route: 'form', cfpId })}>
            {t.cfpPage.submitClosedAction}
          </Link>
        )}
      </section>
    </>
  );
}

/** One sentence about the window, whichever state it is in. */
function deadlineLine(
  cfp: CfpWindow,
  t: ReturnType<typeof useI18n>['t'],
  locale: 'en' | 'fr',
): string {
  if (cfp.state === 'archived') return t.window.closed;
  if (cfp.state === 'paused') return t.window.paused;
  if (cfp.state === 'before') {
    return `${t.window.notOpen} ${t.window.opensAt} ${formatDate(cfp.opensAt, locale)}`;
  }
  if (cfp.state === 'closed') {
    return `${t.window.closed} ${t.window.closedAt} ${formatDate(cfp.closesAt, locale)}`;
  }
  return `${t.window.closesAt} ${formatDate(cfp.closesAt, locale)}`;
}
