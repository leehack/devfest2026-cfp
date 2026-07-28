/**
 * When the committee's copy of a speaker is allowed to move.
 *
 * `speakerSnapshot` is frozen so a bio rewritten years later cannot change what
 * the committee actually read. The question these prove is *when* the freeze
 * starts: at submission is too early — a speaker who fills in their employer an
 * hour after submitting is not rewriting history, and the first real submission
 * in production lost exactly that.
 */

import { expect, test } from '@playwright/test';

import { createAccount, readProposalById, reset, seedProposal, seedSpeaker } from './backend';
import type { Identity } from './form';

const SPEAKER: Identity = { sub: 'snap-speaker', email: 'sam@example.org', name: 'Sam' };

const company = async (id: string): Promise<string | undefined> =>
  (await readProposalById(id))?.speakerSnapshot?.[0]?.company;

test.describe('the speaker snapshot', () => {
  test('picks up a profile filled in after submitting, and stops once decided', async () => {
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

    await expect.poll(() => company('snap-open')).toBe('Unity');

    // The committee has answered on this one. What they read stays what they
    // read — this is the half of the freeze that must not regress.
    expect(await company('snap-decided')).toBeUndefined();
  });

  test('leaves a co-presenter alone', async () => {
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

    await expect.poll(() => company('snap-pair')).toBe('Unity');
    expect((await readProposalById('snap-pair'))?.speakerSnapshot?.[0]?.uid).toBe(speaker.uid);
  });
});
