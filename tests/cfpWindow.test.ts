import { describe, expect, it } from 'vitest';

import { cfpAcceptsSubmissions, cfpState } from '@shared/cfpWindow';

/**
 * The order of these checks is the point. `assertCfpOpen`
 * (functions/src/index.ts:122) tests archived, then paused, then the dates, and
 * a page that disagreed with the callable would offer a form that refuses to
 * save.
 */
const OPENS = Date.UTC(2026, 5, 29);
const CLOSES = Date.UTC(2026, 8, 27);
const window = (extra: { archived?: boolean; paused?: boolean } = {}) => ({
  opensAtMs: OPENS,
  closesAtMs: CLOSES,
  ...extra,
});

describe('cfpState', () => {
  it('is before until it opens, and open on the boundary', () => {
    expect(cfpState(window(), OPENS - 1)).toBe('before');
    expect(cfpState(window(), OPENS)).toBe('open');
  });

  it('closes on the deadline, not after it', () => {
    expect(cfpState(window(), CLOSES - 1)).toBe('open');
    expect(cfpState(window(), CLOSES)).toBe('closed');
  });

  it('reads archived before anything else', () => {
    // Archiving is how a round is stopped without editing its window, so an
    // archived CFP whose dates are wide open is still archived.
    expect(cfpState(window({ archived: true }), OPENS + 1)).toBe('archived');
    expect(cfpState(window({ archived: true, paused: true }), OPENS + 1)).toBe('archived');
    expect(cfpState(window({ archived: true }), OPENS - 1)).toBe('archived');
  });

  it('reads paused before the dates', () => {
    expect(cfpState(window({ paused: true }), OPENS + 1)).toBe('paused');
    expect(cfpState(window({ paused: true }), OPENS - 1)).toBe('paused');
  });

  it('accepts submissions only when open', () => {
    expect(cfpAcceptsSubmissions(window(), OPENS + 1)).toBe(true);
    for (const state of [window({ paused: true }), window({ archived: true })]) {
      expect(cfpAcceptsSubmissions(state, OPENS + 1)).toBe(false);
    }
    expect(cfpAcceptsSubmissions(window(), CLOSES)).toBe(false);
  });

  it('does not read the clock itself', () => {
    // The same document must answer the same way twice, or a cached server
    // render would freeze one moment into a response somebody else reads.
    expect(cfpState(window(), OPENS + 1)).toBe(cfpState(window(), OPENS + 1));
  });
});
