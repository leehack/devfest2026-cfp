/**
 * Sessionize public speaker-profile parser.
 *
 * Their API is event-scoped, so there is no "fetch speaker X" call — the only
 * route is the public profile page, which robots.txt permits and the speaker
 * supplies themselves.
 *
 * It reads markup Sessionize can change without notice, hence two rules: the
 * parser is pure, so a change breaks a test rather than production; and nothing
 * fails silently — anything expected but missing lands in `warnings`, which the
 * form shows. A prefill that quietly does nothing is worse than none.
 */

import type { SocialPlatform } from './enums';

export interface SessionizeLink {
  platform: SocialPlatform;
  url: string;
}

export interface SessionizeSession {
  /** Sessionize's numeric session id, from the /s/<handle>/<slug>/<id> link. */
  id: string;
  title: string;
  /** Full abstract. Can be empty — Sessionize does not require one. */
  abstract: string;
}

export interface SessionizeProfile {
  handle: string;
  name?: string;
  /** Sessionize's free-text headline. Not reliably a job title. */
  tagline?: string;
  location?: string;
  bio?: string;
  links: SessionizeLink[];
  /** Events the speaker has appeared at. Some profile layouts list these. */
  events: string[];
  /**
   * The speaker's talks, each with its **full** abstract.
   *
   * A profile page carries these in full, so importing a talk needs no second
   * request — which is why a pasted session URL is still resolved back to the
   * profile page rather than fetched directly. Session pages carry the talk but
   * no bio, so fetching one would cost an extra round trip and return less.
   */
  sessions: SessionizeSession[];
  /** Expected-but-missing fields. Always surfaced to the user. */
  warnings: string[];
}

/** What a pasted Sessionize link resolves to. Both shapes yield a profile handle. */
export interface SessionizeTarget {
  handle: string;
  /** Set when a session link was pasted, so that talk can be preselected. */
  sessionId?: string;
}

/** Sessionize handles are lowercase alphanumeric plus dashes. */
const HANDLE = /^[a-z0-9][a-z0-9-]{1,60}$/;

/** Paths that are not speaker profiles, so a paste of one is a mistake worth catching. */
const RESERVED = new Set([
  'developers', 'features', 'contact', 'brand', 'playbook', 'app', 'api',
  'add-event', 'add-usergroup', 'create-demo', 'favicon', 'privacy', 'terms',
]);

/**
 * Accepts a full profile URL or a bare handle and returns the handle.
 *
 * This is the SSRF guard as well as a convenience: the Cloud Function builds
 * its fetch URL from the return value, so only sessionize.com can ever be
 * requested. Keeping it pure means the guard itself is unit-testable.
 */
export function parseSessionizeUrl(input: string): SessionizeTarget | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  let candidate = raw;
  let sessionId: string | undefined;

  if (/^https?:\/\//i.test(raw) || raw.startsWith('sessionize.com')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'sessionize.com' && host !== 'www.sessionize.com') return null;

    const segments = url.pathname.split('/').filter(Boolean);

    if (segments.length === 1) {
      // https://sessionize.com/<handle>
      candidate = segments[0];
    } else if (segments.length === 4 && segments[0].toLowerCase() === 's') {
      // https://sessionize.com/s/<handle>/<slug>/<id>
      // The slug is decorative — only the handle is used to build the fetch
      // URL, so a hostile slug has nowhere to go.
      if (!/^\d{1,12}$/.test(segments[3])) return null;
      candidate = segments[1];
      sessionId = segments[3];
    } else {
      return null;
    }
  }

  candidate = candidate.toLowerCase();
  if (!HANDLE.test(candidate) || RESERVED.has(candidate)) return null;
  return sessionId ? { handle: candidate, sessionId } : { handle: candidate };
}

/** Profile-only convenience kept for callers that cannot accept a session link. */
export function normalizeSessionizeHandle(input: string): string | null {
  const target = parseSessionizeUrl(input);
  return target && !target.sessionId ? target.handle : null;
}

// ---------------------------------------------------------------- html utils

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    const key = code.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return whole;
  });
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      // Keep paragraph and line breaks as real breaks — a bio pasted as one
      // run-on blob is worse than no prefill.
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** Every element carrying `className`, in document order. */
function extractAllByClass(html: string, className: string): string[] {
  const out: string[] = [];
  let rest = html;
  // Bounded so a pathological page cannot spin here.
  for (let i = 0; i < 200; i += 1) {
    const found = extractByClass(rest, className);
    if (found === null) break;
    out.push(found);
    const at = rest.indexOf(found);
    if (at === -1) break;
    rest = rest.slice(at + found.length);
  }
  return out;
}

/** Grabs the inner HTML of the first element carrying `className`, brace-matching nested tags. */
function extractByClass(html: string, className: string): string | null {
  const open = new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i');
  const match = open.exec(html);
  if (!match) return null;

  const tag = match[1];
  let depth = 1;
  let index = match.index + match[0].length;
  const start = index;
  const scanner = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  scanner.lastIndex = index;

  let hit: RegExpExecArray | null;
  while ((hit = scanner.exec(html)) !== null) {
    depth += hit[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, hit.index);
    index = scanner.lastIndex;
  }
  return null;
}

function iconToPlatform(icon: string): SocialPlatform {
  const name = icon.toLowerCase();
  if (name.includes('twitter') || name.includes('-x')) return 'x';
  if (name.includes('linkedin')) return 'linkedin';
  if (name.includes('github')) return 'github';
  if (name.includes('mastodon')) return 'mastodon';
  if (name.includes('bluesky')) return 'bluesky';
  return 'website';
}

// -------------------------------------------------------------------- parser

export function parseSessionizeProfile(html: string, handle = ''): SessionizeProfile {
  const warnings: string[] = [];

  const text = (className: string, label: string): string | undefined => {
    const raw = extractByClass(html, className);
    if (raw === null) {
      warnings.push(label);
      return undefined;
    }
    const value = stripTags(raw);
    if (!value) {
      warnings.push(label);
      return undefined;
    }
    return value;
  };

  const name = text('c-s-speaker-info__name', 'name');
  const tagline = extractByClass(html, 'c-s-speaker-info__tagline');
  const location = extractByClass(html, 'c-s-speaker-info__location');

  // Profiles can carry a bio per language; the first block is the primary one.
  // og:description holds the same text but truncated with an ellipsis, so it is
  // not a usable fallback — better to warn than to save a cut-off bio.
  const bio = text('c-s-speaker-info__bio', 'bio');

  const links: SessionizeLink[] = [];
  const linkGroup = extractByClass(html, 'c-s-speaker-info__group--links');
  if (linkGroup) {
    // Each anchor is followed by an icon reference that names the platform.
    const anchors = [...linkGroup.matchAll(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const anchor of anchors) {
      const icon = /#o-icon-([a-z0-9-]+)/i.exec(anchor[2]);
      links.push({ platform: iconToPlatform(icon?.[1] ?? ''), url: decodeEntities(anchor[1]) });
    }
  } else {
    warnings.push('links');
  }

  const events = [...html.matchAll(/class="[^"]*c-s-event__name[^"]*"[^>]*>([\s\S]*?)</gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);

  // Profile layouts vary: some list the events a speaker appeared at, others
  // list their talks. Both shapes exist in the wild, so parse both rather than
  // assuming an empty result means the speaker has nothing.
  const sessions: SessionizeSession[] = [];
  for (const card of extractAllByClass(html, 'c-s-session')) {
    const link = /<a[^>]*href="\/s\/[^/]+\/[^/]*\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(card);
    if (!link) continue;
    const title = stripTags(link[2]);
    if (!title) continue;

    const summary = extractByClass(card, 'c-s-session__summary');
    sessions.push({
      id: link[1],
      title,
      // Sessionize separates paragraphs with <br><br> inside a single <p>,
      // which stripTags already turns into real line breaks.
      abstract: summary ? stripTags(summary) : '',
    });
  }

  return {
    handle,
    name,
    tagline: tagline ? stripTags(tagline) : undefined,
    location: location ? stripTags(location) : undefined,
    bio,
    links,
    events: [...new Set(events)],
    sessions,
    warnings,
  };
}
