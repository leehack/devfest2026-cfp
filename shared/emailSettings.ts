/**
 * Who the CFP writes as (§8).
 *
 * Kept out of the deploy so the address can be fixed from `/admin` the moment
 * a domain finishes verifying, rather than waiting on a redeploy — and so a
 * wrong address is a thirty-second correction rather than an incident.
 *
 * Pure, and shared: the browser uses it for the inline error and the callable
 * re-checks it, because the callable is the enforcement point.
 */

export interface EmailSettings {
  /** `cfp@example.org` or `DevFest Montréal <cfp@example.org>`. */
  from: string;
  replyTo: string;
  /**
   * Where `{proposalUrl}` points. Empty falls back to the project's own
   * `web.app` domain, which is right until the CFP gets a custom hostname —
   * and that is a DNS change, not a reason to redeploy the functions.
   */
  publicUrl: string;
}

export const EMPTY_SETTINGS: EmailSettings = { from: '', replyTo: '', publicUrl: '' };

/**
 * Deliberately loose. This exists to catch a typo and a pasted display name
 * with the angle brackets lost, not to adjudicate RFC 5322 — the address has to
 * clear Resend's own check on a verified domain regardless, which is a far
 * stricter gate than anything worth reimplementing here.
 */
const ADDRESS = /^[^\s@<>",]+@[^\s@<>",.]+(\.[^\s@<>",.]+)+$/;

export type SenderProblem = 'empty' | 'format' | 'brackets';

/** Safe to place before a platform-owned address in `Name <address>` form. */
export function validSenderDisplayName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name.length <= 100 && !/[<>\p{Cc}]/u.test(name);
}

/** The bare address inside a sender string, or a reason it is unusable. */
export function parseSender(value: string): { address: string } | { problem: SenderProblem } {
  const trimmed = value.trim();
  if (!trimmed) return { problem: 'empty' };

  const angled = trimmed.match(/^(.*)<([^<>]*)>$/);
  if (angled) {
    const address = angled[2].trim();
    return ADDRESS.test(address) ? { address } : { problem: 'format' };
  }

  // A display name with no brackets — "DevFest Montréal cfp@x.org" — is the
  // mistake this catches, and it is worth its own message because the fix is
  // not obvious from "invalid address".
  if (/\s/.test(trimmed)) return { problem: 'brackets' };

  return ADDRESS.test(trimmed) ? { address: trimmed } : { problem: 'format' };
}

/** The domain a sender would send from, for showing next to a DNS warning. */
export function senderDomain(value: string): string | null {
  const parsed = parseSender(value);
  return 'address' in parsed ? parsed.address.split('@')[1].toLowerCase() : null;
}

/**
 * The sender's domain when it is not the one verified with Resend, else null.
 *
 * Resend verifies an exact domain, so `cfp@mail.example.org` does not inherit
 * `example.org` — a near-miss like that queues, looks configured, and fails at
 * send. Silent when either side is unknown: a domain added in Resend's own
 * dashboard never reaches `config/email`, and warning on that would cry wolf.
 */
export function senderMismatch(from: string, verified: string): string | null {
  const sender = senderDomain(from);
  const target = verified.trim().toLowerCase();
  if (!sender || !target) return null;
  return sender === target ? null : sender;
}

/** Stable setup failures the admin UI can translate without parsing prose. */
export type EmailDeliveryProblem =
  | 'missing_key'
  | 'invalid_key'
  | 'missing_domain'
  | 'domain_unverified'
  | 'invalid_sender'
  | 'sender_domain_mismatch'
  | 'setup_unavailable';

export interface EmailDeliveryReadiness {
  ready: boolean;
  problems: EmailDeliveryProblem[];
  /** Resend's current status, or `unknown` when it could not be read. */
  domainStatus: string;
}

/**
 * Pure half of the delivery gate. The server supplies the live key/domain facts;
 * keeping the classification shared lets the UI render exactly the same state.
 */
export function emailDeliveryReadiness(input: {
  key: 'present' | 'missing' | 'invalid' | 'unavailable';
  domain: string;
  domainStatus: string;
  from: string;
}): EmailDeliveryReadiness {
  const problems: EmailDeliveryProblem[] = [];
  if (input.key === 'missing') problems.push('missing_key');
  if (input.key === 'invalid') problems.push('invalid_key');
  if (input.key === 'unavailable') problems.push('setup_unavailable');

  const domain = input.domain.trim().toLowerCase();
  if (!domain) problems.push('missing_domain');
  else if (input.domainStatus !== 'verified') problems.push('domain_unverified');

  if (!('address' in parseSender(input.from))) problems.push('invalid_sender');
  else if (domain && senderMismatch(input.from, domain)) {
    problems.push('sender_domain_mismatch');
  }

  return { ready: problems.length === 0, problems, domainStatus: input.domainStatus };
}

export type SettingsProblem =
  | { field: 'from' | 'replyTo'; problem: SenderProblem }
  | { field: 'publicUrl'; problem: 'url' };

/**
 * A link a speaker is asked to act on, so it is checked rather than trusted:
 * `http`/`https` only — `javascript:` and `data:` are the reason to allow-list
 * the scheme rather than deny-list it — and a host with a dot in it, which
 * rejects the `localhost` that once shipped in a real acceptance email.
 */
export function validPublicUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true; // Empty is legal; the server derives a default.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
}

/**
 * `from` is required to send at all; `replyTo` is optional but must be a plain
 * address, since a reply-to nobody reads is worse than none.
 */
export function validateSettings(settings: EmailSettings): SettingsProblem | null {
  const from = parseSender(settings.from);
  if ('problem' in from) return { field: 'from', problem: from.problem };

  if (settings.replyTo.trim()) {
    const replyTo = parseSender(settings.replyTo);
    if ('problem' in replyTo) return { field: 'replyTo', problem: replyTo.problem };
  }
  if (!validPublicUrl(settings.publicUrl)) return { field: 'publicUrl', problem: 'url' };
  return null;
}
