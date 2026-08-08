/**
 * A call for proposals, as a tenant.
 *
 * The id *is* the slug. A CFP lives at `/c/devfest-mtl-2026`, and making that
 * the document id means Firestore's own "a document id is unique" is the
 * uniqueness check — there is no second index to keep honest, and no window in
 * which two people both believe they own the name.
 *
 * Compiled into both bundles, so validation is the same sentence on the client
 * and in the callable that actually enforces it.
 */

import type { Localised } from './confirmForm';

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Who someone is to one CFP. Ordered: each can do everything below it. Speaker
 * is not a role — anyone signed in may submit, so it needs no record.
 *
 *   owner      archives, deletes and changes who owns it
 *   admin      grants roles, moves the window, decides and sends
 *   reviewer   scores proposals — but never one they are speaking on
 */
export const CFP_ROLES = ['owner', 'admin', 'reviewer'] as const;
export type CfpRole = (typeof CFP_ROLES)[number];

/**
 * What an admin may hand out. `owner` is deliberately absent: it is written once
 * to whoever created the CFP, because otherwise an admin could promote
 * themselves and then archive the thing out from under its owner.
 */
export const GRANTABLE_ROLES = ['admin', 'reviewer'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const CFP_LIMITS = {
  idMin: 3,
  idMax: 60,
  nameMax: 120,
  descriptionMax: 2000,
  venueMax: 160,
  locationMax: 120,
  websiteMax: 200,
  timeZoneMax: 80,
  /** Per approved creator account. The shared platform still needs a ceiling. */
  perOwner: 10,
} as const;

/**
 * What the call is and where the event is — the half of a CFP that is for the
 * people reading it rather than for the machinery.
 *
 * Every field is optional. A call with nothing filled in is a working call, and
 * an organiser who has not decided on a venue yet should not be blocked from
 * opening submissions.
 */
export interface CfpProfile {
  /** The pitch. Also what a link preview and a search result quote. */
  description?: Localised;
  /** The event itself, not the deadline. `YYYY-MM-DD`: a day, not an instant. */
  eventDate?: string;
  /** Inclusive event range. Old documents use `eventDate` for both ends. */
  eventStartDate?: string;
  eventEndDate?: string;
  /** IANA identifier used by the programme and calendar exports. */
  timeZone?: string;
  venue?: string;
  /** City and region — "Montréal, QC". Speakers plan travel from this. */
  location?: string;
  website?: string;
}

/**
 * Lower case, digits and single hyphens. Deliberately narrow: this string ends
 * up in a URL, in a Storage path and in a Firestore document id, and the three
 * of them do not agree about what is safe. A leading `__` is a reserved
 * Firestore id, and `.`/`..` are reserved everywhere.
 */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type CfpProblem =
  | 'idFormat'
  | 'idLength'
  | 'nameEmpty'
  | 'nameLong'
  | 'visibility'
  | 'descriptionLong'
  | 'venueLong'
  | 'locationLong'
  | 'websiteLong'
  | 'websiteScheme'
  | 'eventDate'
  | 'eventDateRange'
  | 'timeZone';

export function validateCfpId(id: string): CfpProblem | null {
  if (id.length < CFP_LIMITS.idMin || id.length > CFP_LIMITS.idMax) return 'idLength';
  return ID.test(id) ? null : 'idFormat';
}

export function validateCfp(input: { id: string; name: string; visibility: string }): CfpProblem | null {
  const id = validateCfpId(input.id);
  if (id) return id;

  const name = input.name.trim();
  if (!name) return 'nameEmpty';
  if (name.length > CFP_LIMITS.nameMax) return 'nameLong';

  return (VISIBILITIES as readonly string[]).includes(input.visibility) ? null : 'visibility';
}

/**
 * The event details, which are all optional and all free text.
 *
 * The one that is not merely a length check is the website: it is rendered as a
 * link, and `javascript:` in an href is a script the organiser did not write
 * running on a page speakers trust. Only http and https are allowed through.
 */
export function validateProfile(profile: CfpProfile): CfpProblem | null {
  const description = profile.description;
  const longest = Math.max((description?.en ?? '').length, (description?.fr ?? '').length);
  if (longest > CFP_LIMITS.descriptionMax) return 'descriptionLong';

  if ((profile.venue ?? '').length > CFP_LIMITS.venueMax) return 'venueLong';
  if ((profile.location ?? '').length > CFP_LIMITS.locationMax) return 'locationLong';

  const website = (profile.website ?? '').trim();
  if (website) {
    if (website.length > CFP_LIMITS.websiteMax) return 'websiteLong';
    if (!/^https?:\/\/[^\s]+$/i.test(website)) return 'websiteScheme';
  }

  const eventDate = (profile.eventStartDate ?? profile.eventDate ?? '').trim();
  const eventEndDate = (profile.eventEndDate ?? eventDate).trim();
  // The date input already produces this shape; the check is for everything
  // that does not come from the date input.
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return 'eventDate';
  if (eventDate && !calendarDate(eventDate)) return 'eventDate';
  if (eventEndDate && (!calendarDate(eventEndDate) || !eventDate)) return 'eventDate';
  if (eventDate && eventEndDate && eventEndDate < eventDate) return 'eventDateRange';

  const timeZone = (profile.timeZone ?? '').trim();
  if (timeZone.length > CFP_LIMITS.timeZoneMax) return 'timeZone';
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone }).format();
    } catch {
      return 'timeZone';
    }
  }

  return null;
}

/**
 * A `YYYY-MM-DD` event date as an instant, for formatting.
 *
 * It is a *calendar date*, not a moment: "the 14th of November" is the same day
 * whether you read it in Montréal or Munich, and it has no hour to be wrong
 * about. So this pins it to UTC midnight, and it must be rendered with
 * `formatCalendarDay`, which formats in UTC — the pair round-trips the stored
 * date unchanged for every reader.
 *
 * Both halves have been wrong here before, in opposite directions. Parsing with
 * `new Date('2026-11-14')` gives UTC midnight, which printed in `America/Toronto`
 * is the evening of the 13th, so the date showed a day early for everyone. The
 * fix for that built the day in *local* time instead — correct in Montréal and
 * wrong for every reader east of it, which is how it reached production: the
 * timezone that exposes it is not the one it was developed in. A calendar date
 * simply must not be converted between zones.
 *
 * A deadline is the opposite case and stays a real instant — see `formatDate`,
 * which pins Montréal on purpose so a server elsewhere cannot move it.
 */
export function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const at = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(at.getTime())) return null;
  /*
   * Rejects the dates that parse but roll over — 2026-02-30 becomes 2 March,
   * because Date.UTC normalises rather than refusing. A silently shifted date is
   * worse than a rejected one.
   */
  if (at.getUTCMonth() !== Number(m) - 1 || at.getUTCDate() !== Number(d)) return null;
  return at;
}

/**
 * A name turned into a usable id — what the create form offers before anyone
 * types their own. Not authoritative: `validateCfpId` is, and the callable runs
 * it again on whatever actually arrives.
 */
export function idFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CFP_LIMITS.idMax)
    .replace(/-+$/, '');
}
