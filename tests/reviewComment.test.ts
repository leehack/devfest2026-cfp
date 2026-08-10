/**
 * The review comment's callable boundary.
 *
 * Review saves go through one callable so the score write and the proposal's
 * submitted -> under_review transition commit atomically. The callable imports
 * the shared limit directly; browser writes are denied outright by the rules.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '../shared/enums';

const rules = readFileSync('firestore.rules', 'utf8');
const backend = readFileSync('functions/src/index.ts', 'utf8');
const reviewRules = rules.slice(
  rules.indexOf('match /reviews/{reviewerUid}'),
  rules.indexOf('// -------------------------------------------------------- email log'),
);

describe('the review comment cap', () => {
  it('uses the shared limit in the callable', () => {
    expect(LIMITS.reviewCommentMax).toBeGreaterThan(0);
    expect(backend).toMatch(/comment\.length\s*>\s*LIMITS\.reviewCommentMax/);
  });

  it('keeps direct review writes closed', () => {
    expect(reviewRules).toMatch(/allow create, update, delete:\s*if false;/);
  });

  it('writes an explicit review shape instead of spreading caller data', () => {
    const start = backend.indexOf("tx.set(proposalRef.collection('reviews').doc(reviewerUid)");
    const end = backend.indexOf("if (current === 'submitted')", start);
    const write = backend.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    for (const field of ['cfpId', 'score', 'conflictOfInterest', 'comment', 'updatedAt']) {
      expect(write).toContain(field);
    }
    expect(write).not.toContain('...data');
  });
});
