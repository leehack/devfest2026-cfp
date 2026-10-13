import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

import { lateSubmissionLinkOpenForProposal } from '../functions/src/lateSubmissions';
import { lateInviteError } from '../src/lib/errors';
import { lateSubmissionInviteQuery, proposalSelectionQuery } from '../src/lib/proposalLinks';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

function fakeSnap(
  id: string,
  exists: boolean,
  data: Record<string, unknown> = {},
): any {
  return {
    id,
    exists,
    get: (field: string) => data[field],
    data: () => data,
  };
}

describe('lateSubmissionInviteQuery & proposalSelectionQuery', () => {
  it('parses valid lateInvite query parameter', () => {
    expect(lateSubmissionInviteQuery('?lateInvite=abc-123')).toBe('abc-123');
    expect(lateSubmissionInviteQuery('?lateInvite=')).toBeNull();
    expect(lateSubmissionInviteQuery('?lateInvite=bad/slash')).toBeNull();
  });

  it('ignores proposal query when lateInvite is present', () => {
    expect(proposalSelectionQuery('?proposal=p-1&lateInvite=abc-123')).toBeNull();
    expect(proposalSelectionQuery('?proposal=p-1')).toBe('p-1');
  });
});

describe('lateInviteError', () => {
  it('maps revoked, expired, exhausted, and not-found reasons in EN and FR', () => {
    expect(
      lateInviteError(
        { code: 'functions/failed-precondition', details: { reason: 'invite_link_revoked' } },
        en,
      ),
    ).toBe(en.lateInvite.revokedHelp);
    expect(
      lateInviteError(
        { code: 'functions/failed-precondition', details: { reason: 'invite_link_expired' } },
        fr,
      ),
    ).toBe(fr.lateInvite.expiredHelp);
    expect(
      lateInviteError(
        { code: 'functions/failed-precondition', details: { reason: 'invite_link_exhausted' } },
        en,
      ),
    ).toBe(en.lateInvite.exhaustedHelp);
    expect(lateInviteError({ code: 'functions/not-found' }, en)).toBe(en.lateInvite.invalidHelp);
  });
});

describe('lateSubmissionLinkOpenForProposal', () => {
  const now = Date.now();
  const cfp = fakeSnap('devfest-2026', true, { archived: false, deleting: false });
  const proposal = fakeSnap('p-1', true, {
    lateSubmissionLinkId: 'token-1',
    speakerIds: ['u-1'],
  });
  const activeLink = fakeSnap('token-1', true, {
    claimedUids: { 'u-1': { proposalId: 'p-1' } },
    expiresAt: Timestamp.fromMillis(now + 60_000),
  });

  it('returns true for a matching active claim on a non-archived CFP (solo without primarySpeakerId)', () => {
    expect(lateSubmissionLinkOpenForProposal(cfp, proposal, activeLink, now)).toBe(true);
  });

  it('returns false when the CFP is archived or deleting', () => {
    const archivedCfp = fakeSnap('devfest-2026', true, { archived: true });
    expect(lateSubmissionLinkOpenForProposal(archivedCfp, proposal, activeLink, now)).toBe(false);
  });

  it('returns false when the link is revoked or expired', () => {
    const revokedLink = fakeSnap('token-1', true, {
      claimedUids: { 'u-1': { proposalId: 'p-1' } },
      revokedAt: Timestamp.fromMillis(now - 1000),
    });
    expect(lateSubmissionLinkOpenForProposal(cfp, proposal, revokedLink, now)).toBe(false);

    const expiredLink = fakeSnap('token-1', true, {
      claimedUids: { 'u-1': { proposalId: 'p-1' } },
      expiresAt: Timestamp.fromMillis(now - 1000),
    });
    expect(lateSubmissionLinkOpenForProposal(cfp, proposal, expiredLink, now)).toBe(false);
  });

  it('returns false when the claimed proposalId does not match the proposal', () => {
    const otherProposal = fakeSnap('p-2', true, {
      lateSubmissionLinkId: 'token-1',
      speakerIds: ['u-1'],
    });
    expect(lateSubmissionLinkOpenForProposal(cfp, otherProposal, activeLink, now)).toBe(false);
  });
});
