/**
 * The platform, rather than any one call for proposals.
 *
 * Two things are being proved here. That the front door works — a public CFP is
 * listed, a private one is not but is reachable by link, and anyone signed in
 * can start one. And that a tenant is a boundary: an admin of one CFP is
 * nobody's admin on another, from the callables as well as from the screen.
 *
 * The second is the one worth the run time. `firestore.rules` has its own
 * cross-tenant block, but the rules only cover what a client does directly —
 * everything behind a callable is checked in `functions/src/index.ts`, and this
 * is where that half is tested.
 */

import { expect, test } from '@playwright/test';

import {
  CFP_ID,
  callAs,
  callJson,
  createAccount,
  inviteRole,
  readProposalById,
  readStoredObjects,
  reset,
  seedCfp,
  seedMember,
  seedProposal,
  seedReview,
  seedSpeaker,
  storeObjectDirect,
} from './backend';
import { at, signInAs, alerts } from './form';

const OTHER = 'someone-elses-conf';

const OWNER = { sub: 'plat-owner', email: 'owner@devfest.test', name: 'Ora Owner' };
const OUTSIDER = { sub: 'plat-outsider', email: 'outsider@other.test', name: 'Otto Outsider' };
const SPEAKER = { sub: 'plat-speaker', email: 'speaker@example.test', name: 'Sam Speaker' };

test.describe('the front door', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('lists the public calls and not the private ones', async ({ page }) => {
    await seedCfp(OTHER, { name: 'Someone Else’s Conf', visibility: 'private' });

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'DevFest Montréal 2026' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Someone Else’s Conf' })).toHaveCount(0);
  });

  test('a private call is unlisted, not secret — its link still opens', async ({ page }) => {
    await seedCfp(OTHER, { name: 'Someone Else’s Conf', visibility: 'private' });

    // Its front page opens for anyone holding the link...
    await page.goto(`/c/${OTHER}`);
    await expect(page.getByRole('heading', { name: 'Someone Else’s Conf' })).toBeVisible();

    // ...and so does the form behind it, which is what the link is for.
    await page.goto(`/c/${OTHER}/submit`);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('an archived call drops off the list', async ({ page }) => {
    await seedCfp(OTHER, { name: 'Last Year’s Conf', archived: true });

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Last Year’s Conf' })).toHaveCount(0);
  });

  test('signing in and starting one makes you its owner', async ({ page }) => {
    await signInAs(page, OWNER, '/new');

    await page.getByRole('textbox', { name: /^Name/ }).fill('Test Conf 2027');
    // The address follows the name until it is typed into directly.
    await expect(page.getByRole('textbox', { name: /^Address/ })).toHaveValue('test-conf-2027');
    await page.getByRole('button', { name: 'Create it' }).click();

    // Straight to the organiser overview, where the new owner can finish the
    // event details, form, committee, and email setup before sharing it.
    await expect(
      page.getByRole('heading', { name: 'Finish the essentials before you share' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Setup checklist' })).toBeVisible();
    expect(page.url()).toContain('/c/test-conf-2027/admin/overview');
  });

  /*
   * Without this the only route to a private CFP you review for is the link in
   * your invitation email — lose it and the call is unreachable, even though
   * you hold a role on it.
   *
   * A collection-group query on `members`, then one `get` each: a private CFP is
   * unlistable by design, and `allow get: if true` is what lets the link work.
   */
  test('a private call you were invited onto is findable from the home page', async ({ page }) => {
    await seedCfp(OTHER, { name: 'Someone Else’s Conf', visibility: 'private' });
    const reviewer = await createAccount(OUTSIDER);
    await seedMember(reviewer.uid, 'reviewer', OTHER);

    await signInAs(page, OUTSIDER, '/');
    await expect(page.getByRole('heading', { name: 'Where you help out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Someone Else’s Conf' })).toBeVisible();
  });

  test('an address already taken is refused, and says so', async ({ page }) => {
    await signInAs(page, OWNER, '/new');

    await page.getByRole('textbox', { name: /^Name/ }).fill('DevFest Montréal 2026');
    await page.getByRole('textbox', { name: /^Address/ }).fill(CFP_ID);
    await page.getByRole('button', { name: 'Create it' }).click();

    await expect(alerts(page)).toContainText('That address is taken.');
  });
});

test.describe('nothing crosses between two calls', () => {
  test.beforeEach(async () => {
    await reset();
    await seedCfp(OTHER, { name: 'Someone Else’s Conf' });
  });

  test('an admin of one is nobody on the other', async () => {
    await inviteRole(OWNER.email, 'admin', CFP_ID);
    const chair = await createAccount(OWNER);
    await callAs(chair.idToken, 'claimRole', { cfpId: CFP_ID });

    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, SPEAKER);
    await seedProposal('theirs', {
      cfpId: OTHER,
      speakerUid: speaker.uid,
      title: 'Not yours to read',
      status: 'submitted',
    });

    // Every callable takes a cfpId and checks the role against *that* id. Naming
    // a CFP you hold nothing on is the whole attack, and it buys nothing.
    for (const [name, data] of [
      ['setProposalStatus', { proposalId: 'theirs', status: 'accepted' }],
      ['emailQueue', { action: 'preview' }],
      ['recomputeAggregates', {}],
      ['setCfpWindow', { paused: true }],
      ['grantRole', { email: 'friend@evil.test', role: 'admin' }],
      ['setConfirmForm', { fields: [] }],
      ['sendSpeakerMessage', { proposalId: 'theirs', subject: 's', body: 'b' }],
      ['headshotImage', { speakerUid: speaker.uid, key: 'headshot' }],
      ['setEmailSettings', { from: 'x@evil.test', replyTo: '' }],
      ['setEmailTemplate', { kind: 'accepted', locale: 'en', subject: 's', body: 'b' }],
    ] as const) {
      expect(
        await callAs(chair.idToken, name, { cfpId: OTHER, ...data }),
        `${name} on another CFP`,
      ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }

    // And the one it does hold: same call, same person, its own tenant.
    expect(await callAs(chair.idToken, 'emailQueue', { action: 'preview' })).toMatchObject({
      ok: true,
    });
  });

  test('the review queue and the aggregate stop at the tenant', async () => {
    await inviteRole(OWNER.email, 'admin', CFP_ID);
    const chair = await createAccount(OWNER);
    await callAs(chair.idToken, 'claimRole', { cfpId: CFP_ID });

    const speaker = await createAccount(SPEAKER);
    await seedProposal('ours', { speakerUid: speaker.uid, title: 'Ours', status: 'submitted' });
    await seedProposal('theirs', {
      cfpId: OTHER,
      speakerUid: speaker.uid,
      title: 'Theirs',
      status: 'submitted',
    });

    // A score on each side. The one on the other CFP is the bait: an unfiltered
    // collection-group query would sweep it into this round's aggregate.
    await seedReview('ours', chair.uid, 3, CFP_ID);
    await seedReview('theirs', chair.uid, 1, OTHER);

    const recomputed = await callJson(chair.idToken, 'recomputeAggregates', { cfpId: CFP_ID });
    expect(recomputed.reviewCount).toBe(1);
    expect(recomputed.proposalCount).toBe(1);

    // Ours got the score it was given, and nothing of theirs reached it.
    expect((await readProposalById('ours'))?.aggregate).toMatchObject({
      avgScore: 3,
      reviewCount: 1,
    });
    // And the other CFP's proposal is untouched — a recompute must not write
    // across the boundary either.
    expect((await readProposalById('theirs', OTHER))?.aggregate).toBeUndefined();
  });

  test('a speaker on both keeps two separate drafts and two separate photos', async ({ page }) => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, SPEAKER);

    // The same person, the same key, two CFPs — two objects, neither shadowing
    // the other. That is why the tenant is in the Storage path.
    for (const cfpId of [CFP_ID, OTHER]) {
      await storeObjectDirect(
        `cfps/${cfpId}/headshots/${speaker.uid}/headshot`,
        'image/jpeg',
        cfpId,
      );
    }
    expect(await readStoredObjects('cfps/')).toEqual([
      `cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`,
      `cfps/${OTHER}/headshots/${speaker.uid}/headshot`,
    ]);

    // And the form only ever shows the talks belonging to the CFP it is on.
    await seedProposal('ours', { speakerUid: speaker.uid, title: 'Ours', status: 'draft' });
    await seedProposal('theirs', {
      cfpId: OTHER,
      speakerUid: speaker.uid,
      title: 'Theirs',
      status: 'draft',
    });

    await signInAs(page, SPEAKER, at());
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveValue('Ours');
  });
});

test.describe('archiving and deleting', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('an archived call refuses a submission, and un-archiving takes it back', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner');

    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, SPEAKER);
    await seedProposal('p-1', { speakerUid: speaker.uid, title: 'A talk', status: 'draft' });

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({ ok: true });
    expect(await callAs(speaker.idToken, 'submitProposal', { proposalId: 'p-1' })).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: false })).toMatchObject({
      ok: true,
    });
    expect(await callAs(speaker.idToken, 'submitProposal', { proposalId: 'p-1' })).toMatchObject({
      ok: true,
    });
  });

  test('an admin cannot archive or delete — that is the owner’s alone', async () => {
    await inviteRole(OUTSIDER.email, 'admin');
    const chair = await createAccount(OUTSIDER);
    await callAs(chair.idToken, 'claimRole', {});

    for (const name of ['archiveCfp', 'deleteCfp'] as const) {
      expect(await callAs(chair.idToken, name, { archived: true, confirm: CFP_ID })).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED',
      });
    }
  });

  test('deleting takes two steps, and takes the proposals and photos with it', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner');

    const speaker = await createAccount(SPEAKER);
    await seedProposal('p-1', { speakerUid: speaker.uid, title: 'A talk', status: 'submitted' });
    await storeObjectDirect(`cfps/${CFP_ID}/headshots/${speaker.uid}/headshot`, 'image/jpeg');

    // Not while it is live: the round has to be visibly over first.
    expect(await callAs(owner.idToken, 'deleteCfp', { confirm: CFP_ID })).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });

    await callAs(owner.idToken, 'archiveCfp', { archived: true });

    // And not without typing the address back. This destroys other people's
    // writing, so a confirm dialog on its own is not enough.
    expect(await callAs(owner.idToken, 'deleteCfp', { confirm: 'yes' })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
    });

    expect(await callAs(owner.idToken, 'deleteCfp', { confirm: CFP_ID })).toMatchObject({
      ok: true,
    });
    expect(await readProposalById('p-1')).toBeNull();
    expect(await readStoredObjects('cfps/')).toEqual([]);
  });
});
