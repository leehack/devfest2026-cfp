/**
 * Who the CFP writes as (§8).
 *
 * Kept out of the deploy so the address can be fixed from `#/admin` the moment
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
}

export const EMPTY_SETTINGS: EmailSettings = { from: '', replyTo: '' };

/**
 * Deliberately loose. This exists to catch a typo and a pasted display name
 * with the angle brackets lost, not to adjudicate RFC 5322 — the address has to
 * clear Resend's own check on a verified domain regardless, which is a far
 * stricter gate than anything worth reimplementing here.
 */
const ADDRESS = /^[^\s@<>",]+@[^\s@<>",.]+(\.[^\s@<>",.]+)+$/;

export type SenderProblem = 'empty' | 'format' | 'brackets';

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

export type SettingsProblem = { field: 'from' | 'replyTo'; problem: SenderProblem };

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
  return null;
}
