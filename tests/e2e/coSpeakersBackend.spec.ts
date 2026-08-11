import { expect, test } from '@playwright/test';

import {
  callAs,
  callJson,
  createAccount,
  readProposalById,
  reset,
  seedProposal,
  seedSpeaker,
  setProposalStatusDirect,
} from './backend';

const LEAD = { sub: 'co-lead', email: 'lead@example.org', name: 'Lead Speaker' };
const GUEST = { sub: 'co-guest', email: 'guest@example.org', name: 'Guest Speaker' };
const WRONG = { sub: 'co-wrong', email: 'wrong@example.org', name: 'Wrong Account' };

async function seededDraft() {
  const lead = await createAccount(LEAD);
  await seedSpeaker(lead.uid, { name: LEAD.name, email: LEAD.email });
  await seedProposal('co-talk', {
    speakerUid: lead.uid,
    title: 'A session with company',
    status: 'draft',
    includeSpeakerSnapshot: false,
  });
  return lead;
}

test.describe('co-speaker invitation callables', () => {
  test.beforeEach(async () => reset());

  test('keeps a pending invite private, requires the exact verified account and activates only a complete profile', async () => {
    const lead = await seededDraft();
    const invited = await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'co-talk',
      email: GUEST.email,
    });
    expect(invited).toMatchObject({
      ok: true,
      invitationId: expect.any(String),
      roster: {
        primarySpeakerId: lead.uid,
        canManage: true,
        pendingBlocksSubmit: true,
      },
    });

    // Starting the invitation lifecycle moves lead-only logistics out of the
    // proposal before any second account can gain read access.
    expect(await readProposalById('co-talk')).toMatchObject({
      primarySpeakerId: lead.uid,
      speakerIds: [lead.uid],
    });
    expect((await readProposalById('co-talk'))?.attendance).toBeUndefined();
    expect((await readProposalById('co-talk'))?.acks).toBeUndefined();

    const wrong = await createAccount(WRONG);
    const wrongSummary = await callJson(wrong.idToken, 'getCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: invited.invitationId,
    });
    expect(wrongSummary.invitation).toMatchObject({
      invitedEmail: 'g****@example.org',
      matchesSignedInEmail: false,
      canRespond: false,
    });
    await expect(
      callAs(wrong.idToken, 'respondToCoSpeakerInvitation', {
        proposalId: 'co-talk',
        invitationId: invited.invitationId,
        response: 'accept',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });

    const guest = await createAccount(GUEST);
    await expect(
      callAs(guest.idToken, 'respondToCoSpeakerInvitation', {
        proposalId: 'co-talk',
        invitationId: invited.invitationId,
        response: 'accept',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    await seedSpeaker(guest.uid, { name: GUEST.name, email: GUEST.email });
    const accepted = await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: invited.invitationId,
      response: 'accept',
    });
    expect(accepted).toMatchObject({ ok: true, state: 'accepted' });
    expect((await readProposalById('co-talk'))?.speakerIds).toEqual([lead.uid, guest.uid]);

    // Co-speakers see team readiness, never another speaker's address or a
    // pending-address directory.
    const guestRoster = (
      await callJson(guest.idToken, 'getProposalRoster', { proposalId: 'co-talk' })
    ).roster;
    expect(guestRoster.items).toHaveLength(2);
    expect(guestRoster.items.every((item: Record<string, unknown>) => item.email === undefined)).toBe(true);
    await expect(
      callAs(guest.idToken, 'inviteCoSpeaker', {
        proposalId: 'co-talk',
        email: 'third@example.org',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('revokes pending invitations and permanently conflicts removed participants', async () => {
    const lead = await seededDraft();
    const guest = await createAccount(GUEST);
    await seedSpeaker(guest.uid, { name: GUEST.name, email: GUEST.email });
    const invited = await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'co-talk',
      email: GUEST.email,
    });
    await callJson(lead.idToken, 'revokeCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: invited.invitationId,
    });
    const revoked = await callJson(guest.idToken, 'getCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: invited.invitationId,
    });
    expect(revoked.invitation).toMatchObject({ state: 'revoked', canRespond: false });

    const replacement = await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'co-talk',
      email: GUEST.email,
    });
    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: replacement.invitationId,
      response: 'accept',
    });
    await callJson(lead.idToken, 'removeCoSpeaker', {
      proposalId: 'co-talk',
      uid: guest.uid,
    });
    expect(await readProposalById('co-talk')).toMatchObject({
      speakerIds: [lead.uid],
      formerSpeakerIds: [guest.uid],
    });
    await expect(
      callAs(guest.idToken, 'getProposalRoster', { proposalId: 'co-talk' }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  test('lets the lead remove a declined active co-speaker after a decision', async () => {
    const lead = await seededDraft();
    const guest = await createAccount(GUEST);
    await seedSpeaker(guest.uid, { name: GUEST.name, email: GUEST.email });
    const invited = await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'co-talk',
      email: GUEST.email,
    });
    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'co-talk',
      invitationId: invited.invitationId,
      response: 'accept',
    });
    await setProposalStatusDirect('co-talk', 'accepted');
    await callJson(guest.idToken, 'respondToDecision', {
      proposalId: 'co-talk',
      response: 'decline',
    });

    const roster = (
      await callJson(lead.idToken, 'getProposalRoster', { proposalId: 'co-talk' })
    ).roster;
    expect(roster.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: guest.uid,
          confirmationState: 'declined',
          canRemove: true,
        }),
      ]),
    );
    await callJson(lead.idToken, 'removeCoSpeaker', {
      proposalId: 'co-talk',
      uid: guest.uid,
    });
    expect(await readProposalById('co-talk')).toMatchObject({
      status: 'accepted',
      speakerIds: [lead.uid],
      formerSpeakerIds: [guest.uid],
    });
  });
});
