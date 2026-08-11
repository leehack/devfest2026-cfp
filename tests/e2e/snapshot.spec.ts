/**
 * The committee's copy of a speaker moves only after an explicit refresh.
 *
 * `speakerSnapshot` is frozen so a bio rewritten years later cannot change what
 * the committee actually read. A speaker can deliberately pull their current
 * public profile into one proposal without changing any other proposal.
 */

import { expect, test } from '@playwright/test';

import {
  callJson,
  createAccount,
  readProposalById,
  reset,
  seedProposal,
  seedSpeaker,
} from './backend';
import type { Identity } from './form';

const SPEAKER: Identity = { sub: 'snap-speaker', email: 'sam@example.org', name: 'Sam' };

const company = async (id: string): Promise<string | undefined> =>
  (await readProposalById(id))?.speakerSnapshot?.[0]?.company;

test.describe('the speaker snapshot', () => {
  test('stays frozen after a profile edit until the speaker explicitly refreshes it', async () => {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });

    // Seeded with no employer, which is what a snapshot taken before the
    // speaker got round to that part of the form looks like.
    await seedProposal('snap-open', {
      speakerUid: speaker.uid,
      title: 'Still being judged',
      status: 'submitted',
    });
    await seedProposal('snap-decided', {
      speakerUid: speaker.uid,
      title: 'Already answered',
      status: 'rejected',
    });

    expect(await company('snap-open')).toBeUndefined();

    await seedSpeaker(speaker.uid, {
      name: 'Sam',
      email: SPEAKER.email,
      company: 'Unity',
      jobTitle: 'Staff Engineer',
      pastTalks: 'DevFest Montréal 2024',
    });

    expect(await company('snap-open')).toBeUndefined();
    expect(await company('snap-decided')).toBeUndefined();

    const openPreview = await callJson(
      speaker.idToken,
      'previewProposalSpeakerProfile',
      { proposalId: 'snap-open' },
    );
    await callJson(speaker.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'snap-open',
      expectedCurrentFingerprint: openPreview.currentFingerprint,
      expectedLatestFingerprint: openPreview.latestFingerprint,
    });
    expect(await company('snap-open')).toBe('Unity');

    // Refreshing one session never turns a global profile edit into a bulk
    // rewrite of every historical proposal for that account.
    expect(await company('snap-decided')).toBeUndefined();
  });

  test('refreshes only the requested active speaker entry', async () => {
    await reset();
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, { name: 'Sam', email: SPEAKER.email });

    await seedProposal('snap-pair', {
      speakerUid: speaker.uid,
      title: 'Two of us',
      status: 'submitted',
      speaker: { uid: speaker.uid, name: 'Sam' },
    });

    // A second person on the same talk, whose entry this speaker's profile
    // edit has no business touching.
    const pair = await readProposalById('snap-pair');
    expect(pair?.speakerSnapshot).toHaveLength(1);

    await seedSpeaker(speaker.uid, {
      name: 'Sam',
      email: SPEAKER.email,
      company: 'Unity',
    });

    expect(await company('snap-pair')).toBeUndefined();
    const pairPreview = await callJson(
      speaker.idToken,
      'previewProposalSpeakerProfile',
      { proposalId: 'snap-pair' },
    );
    await callJson(speaker.idToken, 'refreshProposalSpeakerSnapshot', {
      proposalId: 'snap-pair',
      expectedCurrentFingerprint: pairPreview.currentFingerprint,
      expectedLatestFingerprint: pairPreview.latestFingerprint,
    });
    expect(await company('snap-pair')).toBe('Unity');
    expect((await readProposalById('snap-pair'))?.speakerSnapshot?.[0]?.uid).toBe(speaker.uid);
  });
});
