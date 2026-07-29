/**
 * Which state a call for proposals is in, from its own document.
 *
 * Shared because three places decide this and they must agree: the page a
 * speaker sees, `assertCfpOpen` in the callables, and — once the public page is
 * rendered on a server — a render that may be cached. Advisory in the browser;
 * the rules and `submitProposal` re-check against the server clock.
 */
export type CfpState = 'before' | 'open' | 'closed' | 'paused' | 'archived';

export interface CfpTimes {
  archived?: boolean;
  paused?: boolean;
  opensAtMs: number;
  closesAtMs: number;
}

/**
 * `now` is a parameter rather than a call to the clock so a server render cannot
 * bake one moment into a response somebody else reads later, and so the tests
 * do not have to travel in time.
 *
 * Archived is checked before paused, and both before the dates: archiving is how
 * a round is stopped without editing its window. `assertCfpOpen`
 * (functions/src/index.ts:122) tests them in this order and the two must not
 * disagree about a CFP that is both archived and open.
 */
export function cfpState(cfp: CfpTimes, now: number): CfpState {
  if (cfp.archived) return 'archived';
  if (cfp.paused) return 'paused';
  if (now < cfp.opensAtMs) return 'before';
  if (now >= cfp.closesAtMs) return 'closed';
  return 'open';
}

/** Whether a speaker may write. The one question every caller actually has. */
export const cfpAcceptsSubmissions = (cfp: CfpTimes, now: number): boolean =>
  cfpState(cfp, now) === 'open';
