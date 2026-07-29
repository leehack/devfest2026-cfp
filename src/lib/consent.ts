/**
 * Whether this visitor has agreed to being measured.
 *
 * Quebec's Law 25 and the GDPR both put the same two constraints on analytics
 * that identify a device: nothing may be collected before consent, and refusing
 * has to be as easy as agreeing. That is not a banner styling note — it is why
 * `granted()` is false until somebody says otherwise, and why the SDK is behind
 * a dynamic import rather than a top-level one. An unanswered banner and a
 * declined banner have to behave identically, because to a visitor who ignored
 * it they are the same thing.
 *
 * The answer lives in `localStorage`, not a cookie: a cookie would be sent to
 * the server on every request, which is the sort of thing this is meant to
 * avoid, and nothing on the server needs to know.
 */

const KEY = 'cfp.analyticsConsent';

/**
 * Bumping this asks everybody again. It belongs to *what* is measured, not to
 * how the banner looks — asking again for a wording change trains people to
 * click the nearest button.
 */
const VERSION = 1;

export type Consent = 'granted' | 'denied' | 'unasked';

interface Stored {
  version: number;
  answer: 'granted' | 'denied';
}

/**
 * `unasked` covers three cases on purpose: never asked, answered under an older
 * version, and storage that cannot be read at all. Safari in private mode
 * throws on `localStorage`, and the safe reading of "I cannot tell" is "no".
 */
export function consent(): Consent {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return 'unasked';
    const stored = JSON.parse(raw) as Stored;
    if (stored.version !== VERSION) return 'unasked';
    return stored.answer === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unasked';
  }
}

export const granted = (): boolean => consent() === 'granted';

export function setConsent(answer: 'granted' | 'denied'): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, answer } satisfies Stored));
  } catch {
    // A visitor who blocks storage gets asked again next time, which is
    // annoying but honest — the alternative is measuring them anyway.
  }
}

/** For the "change your mind" control, and for tests. */
export function forgetConsent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if it could not be written in the first place.
  }
}
