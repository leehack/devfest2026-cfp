/**
 * The review comment's cap, in the two places it has to exist.
 *
 * A reviewer's notes are written straight to Firestore by the client, so
 * `firestore.rules` is the boundary and the textarea's `maxLength` is only an
 * affordance. The rules cannot import TypeScript, so the number is a literal
 * there and `LIMITS.reviewCommentMax` here — two copies, free to drift, with
 * nothing noticing if the UI started promising room the rules would refuse.
 *
 * The behaviour is tested where it lives, against the emulator, in
 * `tests/rules.test.ts`. This is only the pin: same number, both files.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '../shared/enums';

const rules = readFileSync('firestore.rules', 'utf8');

describe('the review comment cap', () => {
  it('is the same number in the rules as in LIMITS', () => {
    const caps = [...rules.matchAll(/comment\.size\(\)\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));

    expect(caps, 'no comment cap found in firestore.rules — was it renamed?').not.toHaveLength(0);
    for (const cap of caps) expect(cap).toBe(LIMITS.reviewCommentMax);
  });

  it('is enforced by the rules at all, not just by the textarea', () => {
    // Guards the deletion rather than the value: dropping the clause entirely
    // would leave the UI cap in place and look fine.
    expect(rules).toMatch(/request\.resource\.data\.comment\.size\(\)/);
  });

  it('is meaningful, because a review cannot carry an unlisted key', () => {
    /*
     * Without hasOnly the cap is decorative — the same text goes in under any
     * other name. These five are exactly what saveReview writes.
     */
    const hasOnly = /keys\(\)\s*\.hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    expect(hasOnly, 'the review write no longer restricts its keys').toBeTruthy();
    const keys = hasOnly![1].split(',').map((k) => k.trim().replace(/^'|'$/g, ''));
    expect(new Set(keys)).toEqual(
      new Set(['cfpId', 'score', 'conflictOfInterest', 'comment', 'updatedAt']),
    );
  });
});
