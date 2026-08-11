import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  readProposalById,
  readScheduleConfigDirect,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  setScheduleNeedsAttentionDirect,
} from './backend';

const SPEAKER = {
  sub: 'profile-refresh-speaker',
  email: 'profile-refresh@example.org',
  name: 'Leila Haddad',
};
const ADMIN = {
  sub: 'profile-refresh-admin',
  email: 'profile-refresh-admin@example.org',
  name: 'Programme Admin',
};
const OUTSIDER = {
  sub: 'profile-refresh-outsider',
  email: 'profile-refresh-outsider@example.org',
  name: 'Unrelated Account',
};

test.describe('explicit event speaker profile copies', () => {
  test.beforeEach(async () => reset());

  test('speaker and admin can explicitly refresh without changing confirmation or old copies automatically', async () => {
    const [speaker, admin, outsider] = await Promise.all(
      [SPEAKER, ADMIN, OUTSIDER].map(createAccount),
    );
    await Promise.all([
      seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email),
      seedSpeaker(speaker.uid, {
        name: SPEAKER.name,
        email: SPEAKER.email,
        bio: 'The current global profile explains reliable production AI systems in practical detail.',
        company: 'Northstar Labs',
        jobTitle: 'Staff Engineer',
      }),
      seedProposal('profile-refresh-talk', {
        speakerUid: speaker.uid,
        title: 'Production AI without surprises',
        status: 'confirmed',
        speaker: {
          name: 'Old programme name',
          bio: 'The previously approved event copy remains stable until somebody explicitly refreshes it.'.repeat(2),
          company: 'Former Company',
          jobTitle: 'Engineer',
        },
        confirmAnswers: { shirtSize: 'M' },
      }),
      setScheduleNeedsAttentionDirect(false),
    ]);

    // Updating the private global profile alone no longer rewrites event history.
    expect((await readProposalById('profile-refresh-talk'))?.speakerSnapshot[0]).toMatchObject({
      name: 'Old programme name',
      company: 'Former Company',
    });

    const refused = await callAs(outsider.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'profile-refresh-talk',
      speakerUid: speaker.uid,
    });
    expect(refused).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });

    expect(
      await callJson(speaker.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'profile-refresh-talk',
      }),
    ).toMatchObject({ changed: true, scheduleNeedsAttention: true });

    const afterSpeaker = await readProposalById('profile-refresh-talk');
    expect(afterSpeaker).toMatchObject({
      status: 'confirmed',
      confirmAnswers: { shirtSize: 'M' },
    });
    expect(afterSpeaker?.speakerSnapshot[0]).toMatchObject({
      uid: speaker.uid,
      name: SPEAKER.name,
      company: 'Northstar Labs',
      jobTitle: 'Staff Engineer',
    });
    expect(afterSpeaker?.speakerSnapshot[0]).not.toHaveProperty('email');
    expect((await readScheduleConfigDirect())?.needsAttention).toBe(true);

    await Promise.all([
      seedSpeaker(speaker.uid, {
        name: 'Leila Haddad-Santos',
        email: SPEAKER.email,
        bio: 'An updated biography for the public programme with enough concrete detail to be useful.',
        company: 'Independent',
        jobTitle: 'Principal Consultant',
      }),
      setScheduleNeedsAttentionDirect(false),
    ]);

    expect(
      await callJson(admin.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'profile-refresh-talk',
        speakerUid: speaker.uid,
      }),
    ).toMatchObject({ changed: true, scheduleNeedsAttention: true });
    expect((await readProposalById('profile-refresh-talk'))?.speakerSnapshot[0]).toMatchObject({
      name: 'Leila Haddad-Santos',
      company: 'Independent',
      jobTitle: 'Principal Consultant',
    });
  });
});
