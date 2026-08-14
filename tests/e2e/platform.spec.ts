/**
 * The platform, rather than any one call for proposals.
 *
 * Two things are being proved here. That the front door works — a public CFP is
 * listed, a private one is not but is reachable by link, and an organization
 * administrator can start one. And that a tenant is a boundary: an admin of one CFP is
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
  readCfp,
  readEmailLog,
  readEmailDomainBinding,
  readExternalMutationLease,
  readMember,
  readProposalById,
  readPlatformEmailConfigurationDirect,
  readProposalUpdateTime,
  reviewedEmailConfiguration,
  reviewedEmailRecipients,
  readStoredObjects,
  reserveCfpDeletionDirect,
  reset,
  seedCfp,
  seedEmailLog,
  seedExternalMutationLease,
  seedMember,
  seedProposal,
  seedReview,
  seedSpeaker,
  setEmailDeliveryReadyDirect,
  setPlatformEmailDeliveryReadyDirect,
  setSendingDomainDirect,
  setSendingDomainPointerDirect,
  setSubmissionFormDirect,
  storeObjectDirect,
} from './backend';
import { at, signInAs } from './form';
import {
  openPreferences,
  preferencesTrigger,
  selectInterfaceTheme,
  switchInterfaceLanguage,
} from './preferences';

const OTHER = 'someone-elses-conf';

const OWNER = { sub: 'plat-owner', email: 'owner@devfest.test', name: 'Ora Owner' };
const SECOND_OWNER = {
  sub: 'plat-owner-two',
  email: 'owner-two@devfest.test',
  name: 'Owen Owner',
};
const OUTSIDER = { sub: 'plat-outsider', email: 'outsider@other.test', name: 'Otto Outsider' };
const SPEAKER = { sub: 'plat-speaker', email: 'speaker@example.test', name: 'Sam Speaker' };
const THEME_KEY = 'cfp.theme';

test.describe('the front door', () => {
  test.beforeEach(async () => {
    await reset();
  });

  test('anonymous visitors can always find sign in in the global header', async ({ page }) => {
    for (const path of ['/', at(''), at('/review'), at('/admin/proposals')]) {
      await page.goto(path);
      const header = page.locator('header.header');
      await expect(header.locator('a.brand-home')).toHaveAttribute('href', '/');
      await expect(header.locator('a.brand-home')).toHaveAccessibleName('All Calls');
      await expect(header.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(header.getByRole('button', { name: 'Account' })).toHaveCount(0);
    }

    await expect(page.getByText(/address your organiser invited/)).toBeVisible();
    await page
      .locator('header.header')
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    await expect(page.locator('#sign-in')).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    const preferences = await preferencesTrigger(page).boundingBox();
    const signIn = await page
      .locator('header.header')
      .getByRole('button', { name: 'Sign in', exact: true })
      .boundingBox();
    expect(preferences).not.toBeNull();
    expect(signIn).not.toBeNull();
    expect(signIn!.x).toBeGreaterThan(preferences!.x);
    expect(signIn!.x + signIn!.width).toBeLessThanOrEqual(390);
  });

  test('uses the system theme until the visitor chooses one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(at(''));

    await openPreferences(page);
    await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBeNull();
  });

  test('an explicit theme survives reload and overrides the system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(at(''));

    const dark = await selectInterfaceTheme(page, 'dark');
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('dark');

    await page.reload();
    await openPreferences(page);
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('an explicit theme remains in effect when browser storage is unavailable', async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Storage is unavailable', 'SecurityError');
        setItem.call(this, name, value);
      };
    }, THEME_KEY);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(at(''));

    const dark = await selectInterfaceTheme(page, 'dark');
    await expect(dark).toHaveAttribute('aria-pressed', 'true');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the theme control stays labelled and contained in French on a phone', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(at(''));
    await selectInterfaceTheme(page, 'dark');
    await switchInterfaceLanguage(page, 'fr');
    const frenchDark = page.getByRole('button', { name: 'Sombre', exact: true });
    await expect(frenchDark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await page.setViewportSize({ width: 390, height: 844 });
    const header = page.locator('header.header');
    await expect(preferencesTrigger(page, 'fr')).toBeVisible();
    await expect(frenchDark).toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Se connecter', exact: true }),
    ).toBeVisible();

    const overflow = await page.evaluate(() => {
      const controls = document.querySelector<HTMLElement>('.header__right');
      return {
        document:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        controls: controls ? controls.scrollWidth - controls.clientWidth : 999,
      };
    });
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.controls).toBeLessThanOrEqual(1);

    await page.reload();
    await openPreferences(page);
    await expect(page.getByRole('button', { name: 'Sombre', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
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
    const owner = await createAccount(OWNER);
    await callJson(owner.idToken, 'createOrg', {
      name: 'Test Conference Group',
      slug: 'test-conference-group',
    });
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
    await expect(page.getByText(/^Setup checklist · \d+ of \d+ essentials complete$/)).toBeVisible();
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
    const owner = await createAccount(OWNER);
    await callJson(owner.idToken, 'createOrg', {
      name: 'Taken Address Group',
      slug: 'taken-address-group',
    });
    await signInAs(page, OWNER, '/new');

    await page.getByRole('textbox', { name: /^Name/ }).fill('DevFest Montréal 2026');
    await page.getByRole('textbox', { name: /^Address/ }).fill(CFP_ID);
    await page.getByRole('button', { name: 'Create it' }).click();

    await expect(page.getByText('That address is taken. Try another.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Address/ })).toBeFocused();
    await expect(page.getByRole('textbox', { name: /^Address/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
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
      ['emailQueue', { action: 'summary' }],
      ['emailQueue', { action: 'preview' }],
      ['recomputeAggregates', {}],
      ['setCfpWindow', { paused: true }],
      ['grantRole', { email: 'friend@evil.test', role: 'admin' }],
      ['setConfirmForm', { fields: [] }],
      ['sendSpeakerMessage', { proposalId: 'theirs', subject: 's', body: 'b' }],
      ['headshotImage', { proposalId: 'theirs', key: 'headshot' }],
      ['setEmailSettings', { senderMode: 'event', from: 'x@evil.test', replyTo: '' }],
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

  test('a copied Resend domain pointer cannot cross the CFP binding', async () => {
    await inviteRole(OWNER.email, 'admin', CFP_ID);
    const chair = await createAccount(OWNER);
    await callAs(chair.idToken, 'claimRole', { cfpId: CFP_ID });

    const domain = 'mail.someone-elses.example';
    const domainId = `dom-${domain}`;
    await setSendingDomainDirect(domain, OTHER);
    await setSendingDomainPointerDirect(domain, domainId, CFP_ID);

    expect(
      await callAs(chair.idToken, 'setEmailSettings', {
        cfpId: CFP_ID,
        senderMode: 'event',
        from: `Our CFP <cfp@${domain}>`,
        replyTo: '',
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });

    const readiness = await callJson(chair.idToken, 'emailQueue', {
      cfpId: CFP_ID,
      action: 'readiness',
    });
    expect(readiness).toMatchObject({
      domainId: '',
      domain: '',
      delivery: { ready: false, problems: expect.arrayContaining(['missing_domain']) },
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

    // Automatic aggregation should process the other tenant on its own. Capture
    // that value before manually refreshing this CFP so the isolation assertion
    // proves one refresh cannot alter the other's result.
    await expect
      .poll(async () => (await readProposalById('theirs', OTHER))?.aggregate?.avgScore)
      .toBe(1);
    const otherAggregate = (await readProposalById('theirs', OTHER))?.aggregate;

    const recomputed = await callJson(chair.idToken, 'recomputeAggregates', { cfpId: CFP_ID });
    expect(recomputed.reviewCount).toBe(1);
    expect(recomputed.proposalCount).toBe(1);

    // Ours got the score it was given, and nothing of theirs reached it.
    expect((await readProposalById('ours'))?.aggregate).toMatchObject({
      avgScore: 3,
      reviewCount: 1,
    });
    // And the other CFP's independently computed result is untouched.
    expect((await readProposalById('theirs', OTHER))?.aggregate).toEqual(otherAggregate);
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

  test('archive freezes event writes while preserving inspection, revocation, and unarchive', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, SPEAKER);
    await seedProposal('p-history', {
      speakerUid: speaker.uid,
      title: 'History stays readable',
      status: 'under_review',
    });
    const invitee = await createAccount({
      sub: 'archived-invitee',
      email: 'archived-invitee@example.org',
      name: 'Invited Reviewer',
    });
    await inviteRole('archived-invitee@example.org', 'reviewer');
    await setSendingDomainDirect('event.example');
    await Promise.all([
      seedEmailLog('held-history', { status: 'held', proposalId: 'p-history' }),
      seedEmailLog('failed-history', { status: 'failed', proposalId: 'p-history' }),
      seedEmailLog('dry-history', { status: 'dry_run', proposalId: 'p-history' }),
    ]);

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: true,
    });
    const preview = await callJson(owner.idToken, 'emailQueue', { action: 'preview' });

    const refused: [string, Record<string, unknown>][] = [
      ['updateCfp', { name: 'Changed after archive', visibility: 'private' }],
      ['setCfpWindow', { paused: true }],
      ['setConfirmForm', { fields: [] }],
      ['setSubmissionForm', {}],
      ['recomputeAggregates', {}],
      ['grantRole', { email: 'new-reviewer@example.org', role: 'reviewer' }],
      ['setProposalStatus', { proposalId: 'p-history', status: 'accepted' }],
      [
        'sendSpeakerMessage',
        { action: 'preview', proposalId: 'p-history' },
      ],
      [
        'setEmailSettings',
        { senderMode: 'event', from: 'Event <cfp@event.example>', replyTo: '' },
      ],
      [
        'setEmailTemplate',
        { kind: 'accepted', locale: 'en', subject: 'Accepted', body: 'Hello.' },
      ],
      ['sendTestEmail', { kind: 'accepted', locale: 'en' }],
      ['emailDomain', { action: 'add', domain: 'event.example' }],
      ['emailDomain', { action: 'verify' }],
      [
        'emailQueue',
        {
          action: 'release',
          logIds: ['held-history'],
          ...reviewedEmailConfiguration(preview),
        },
      ],
      [
        'emailQueue',
        {
          action: 'retry',
          ...reviewedEmailConfiguration(preview),
        },
      ],
      [
        'emailQueue',
        {
          action: 'resend',
          logId: 'failed-history',
          reviewedTo: 'speaker@example.org',
          ...reviewedEmailConfiguration(preview),
        },
      ],
    ];
    for (const [callable, data] of refused) {
      expect(await callAs(owner.idToken, callable, data), callable).toMatchObject({
        ok: false,
        code: 'FAILED_PRECONDITION',
      });
    }

    expect(await callAs(invitee.idToken, 'claimRole', {})).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
    expect(
      await callAs(owner.idToken, 'revokeRole', { email: 'archived-invitee@example.org' }),
    ).toMatchObject({ ok: true });

    expect(await callJson(owner.idToken, 'emailQueue', { action: 'readiness' })).toMatchObject({
      ok: true,
    });
    expect(await callJson(owner.idToken, 'emailQueue', { action: 'summary' })).toMatchObject({
      waiting: 0,
    });
    for (const logId of ['held-history', 'failed-history', 'dry-history']) {
      expect(preview.rows.find((row: { logId: string }) => row.logId === logId)).toMatchObject({
        stale: true,
      });
    }
    expect(preview.held).toEqual([]);

    await seedEmailLog('queued-after-archive', { status: 'queued', proposalId: 'p-history' });
    await expect
      .poll(async () => (await readEmailLog()).find((row) => row.id === 'queued-after-archive'))
      .toMatchObject({ status: 'failed', error: expect.stringContaining('archived') });

    expect(await readProposalById('p-history')).toMatchObject({ title: 'History stays readable' });
    expect((await readCfp())?.name).toBe('DevFest Montréal 2026');
    expect(await callAs(owner.idToken, 'archiveCfp', { archived: false })).toMatchObject({
      ok: true,
      code: '200',
    });
    expect(
      await callAs(owner.idToken, 'updateCfp', {
        name: 'Writable again',
        visibility: 'private',
      }),
    ).toMatchObject({ ok: true });
  });

  test('archive and provider mutations respect the external side-effect fence', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await setSendingDomainDirect('event.example');
    await seedExternalMutationLease(new Date(Date.now() + 60_000));

    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: false,
      code: 'ABORTED',
    });
    for (const [callable, data] of [
      ['emailDomain', { action: 'add', domain: 'fenced.example' }],
      ['emailDomain', { action: 'verify' }],
    ] as const) {
      expect(await callAs(owner.idToken, callable, data), callable).toMatchObject({
        ok: false,
        code: 'ABORTED',
      });
    }
    expect(await readCfp()).toMatchObject({ archived: false });
    expect(await readExternalMutationLease()).toMatchObject({
      id: 'seeded-external-mutation',
    });

    await seedExternalMutationLease(new Date(Date.now() - 1_000));
    expect(await callAs(owner.idToken, 'archiveCfp', { archived: true })).toMatchObject({
      ok: true,
    });
    expect(await readExternalMutationLease()).toBeNull();
  });

  test('a failed provider mutation releases an expired fence it reclaimed', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await setSendingDomainDirect('event.example');
    await seedExternalMutationLease(new Date(Date.now() - 1_000));

    // The emulator intentionally has no Resend key. Reaching this refusal proves
    // the expired fence was reclaimed; the token-matched finally path clears it.
    expect(await callAs(owner.idToken, 'emailDomain', { action: 'verify' })).toMatchObject({
      ok: false,
      code: 'FAILED_PRECONDITION',
    });
    expect(await readExternalMutationLease()).toBeNull();
  });

  test('explicit profile refresh and delayed aggregates cannot rewrite archived history', async () => {
    const owner = await createAccount(OWNER);
    const speaker = await createAccount(SPEAKER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await seedSpeaker(speaker.uid, { ...SPEAKER, name: 'Before review' });
    await seedProposal('p-frozen-history', {
      speakerUid: speaker.uid,
      title: 'A frozen record',
      status: 'under_review',
    });
    await seedSpeaker(speaker.uid, { ...SPEAKER, name: 'Committee version' });
    const currentPreview = await callJson(owner.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'p-frozen-history',
      speakerUid: speaker.uid,
    });
    expect(
      await callJson(owner.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'p-frozen-history',
        speakerUid: speaker.uid,
        expectedCurrentFingerprint: currentPreview.currentFingerprint,
        expectedLatestFingerprint: currentPreview.latestFingerprint,
      }),
    ).toMatchObject({ changed: true });
    const refreshedPreview = await callJson(owner.idToken, 'previewProposalSpeakerProfile', {
      proposalId: 'p-frozen-history',
      speakerUid: speaker.uid,
    });
    await seedReview('p-frozen-history', owner.uid, 2);
    await expect
      .poll(async () => await readProposalById('p-frozen-history'))
      .toMatchObject({
        speakerSnapshot: [expect.objectContaining({ name: 'Committee version' })],
        aggregate: expect.objectContaining({ reviewCount: 1, avgScore: 2 }),
      });

    await callJson(owner.idToken, 'archiveCfp', { archived: true });
    await seedSpeaker(speaker.uid, { ...SPEAKER, name: 'Changed after event' });
    expect(
      await callAs(owner.idToken, 'refreshProposalSpeakerSnapshot', {
        proposalId: 'p-frozen-history',
        speakerUid: speaker.uid,
        expectedCurrentFingerprint: refreshedPreview.currentFingerprint,
        expectedLatestFingerprint: refreshedPreview.latestFingerprint,
      }),
    ).toMatchObject({ ok: false, code: 'FAILED_PRECONDITION' });
    await seedReview('p-frozen-history', owner.uid, 4);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(await readProposalById('p-frozen-history')).toMatchObject({
      speakerSnapshot: [expect.objectContaining({ name: 'Committee version' })],
      aggregate: expect.objectContaining({ reviewCount: 1, avgScore: 2 }),
    });
  });

  test('submission and a required form edit serialize without a stale commit', async () => {
    const speaker = await createAccount(SPEAKER);
    await seedSpeaker(speaker.uid, SPEAKER);
    await Promise.all([
      seedProposal('racing-submit', {
        speakerUid: speaker.uid,
        title: 'The proposal being submitted',
        status: 'draft',
      }),
      ...Array.from({ length: 80 }, (_, index) =>
        seedProposal(`draft-${index}`, {
          speakerUid: speaker.uid,
          title: `Draft ${index}`,
          status: 'draft',
        }),
      ),
    ]);

    const submission = callAs(speaker.idToken, 'submitProposal', {
      proposalId: 'racing-submit',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const formUpdatedAt = await setSubmissionFormDirect({
      fields: [
        {
          key: 'late_required',
          type: 'text',
          label: { en: 'A newly required answer' },
          required: true,
        },
      ],
    });

    const result = await submission;
    if (result.ok) {
      // A 200 is valid only when the submission won and committed before the
      // edit. If the form won, the transaction retries against its required
      // field and the branch below must refuse the stale answers.
      const proposalUpdatedAt = await readProposalUpdateTime('racing-submit');
      expect(Date.parse(proposalUpdatedAt!)).toBeLessThanOrEqual(Date.parse(formUpdatedAt));
      expect(await readProposalById('racing-submit')).toMatchObject({ status: 'submitted' });
    } else {
      expect(result).toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(await readProposalById('racing-submit')).toMatchObject({ status: 'draft' });
    }
  });

  test('email retry recovers an expired sending lease but leaves a fresh claim alone', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await seedProposal('recover-email', {
      speakerUid: 'email-speaker',
      title: 'Recover this notification',
      status: 'accepted',
    });
    await Promise.all([
      seedEmailLog('expired-send', {
        status: 'sending',
        proposalId: 'recover-email',
        attempts: 1,
        sendingClaimId: 'abandoned-event',
        providerAttemptId: 'ambiguous-provider-attempt',
        sendingStartedAt: new Date(Date.now() - 11 * 60_000),
      }),
      seedEmailLog('fresh-send', {
        status: 'sending',
        proposalId: 'recover-email',
        attempts: 1,
        sendingClaimId: 'active-event',
        sendingStartedAt: new Date(),
      }),
    ]);

    await setEmailDeliveryReadyDirect();
    const preview = await callJson(owner.idToken, 'emailQueue', { action: 'preview' });
    expect(preview).toMatchObject({ recoverableSending: 1 });
    expect(preview.rows.find((row: { logId: string }) => row.logId === 'expired-send')).toMatchObject({
      status: 'sending',
      recoverable: true,
    });
    expect(await callJson(owner.idToken, 'emailQueue', {
      action: 'retry',
      logIds: preview.retryable.map((row: { logId: string }) => row.logId),
      reviewedRecipients: reviewedEmailRecipients(preview.retryable),
      ...reviewedEmailConfiguration(preview),
    })).toMatchObject({
      released: 1,
    });

    await expect
      .poll(async () => (await readEmailLog()).find((row) => row.id === 'expired-send'))
      .toMatchObject({ status: 'dry_run', attempts: 2 });
    expect((await readEmailLog()).find((row) => row.id === 'expired-send')).not.toHaveProperty(
      'providerAttemptId',
    );
    expect((await readEmailLog()).find((row) => row.id === 'fresh-send')).toMatchObject({
      status: 'sending',
      attempts: 1,
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
    await seedMember('departing-reviewer', 'reviewer');
    await setPlatformEmailDeliveryReadyDirect();
    await setSendingDomainDirect('deleting.example');

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
    expect(await readCfp()).toBeNull();
    expect(await readMember(owner.uid)).toBeNull();
    expect(await readMember('departing-reviewer')).toBeNull();
    expect(await readProposalById('p-1')).toBeNull();
    expect(await readStoredObjects('cfps/')).toEqual([]);
    expect(await readEmailDomainBinding('dom-deleting.example')).toBeNull();
    expect(await readPlatformEmailConfigurationDirect()).toMatchObject({
      from: 'CFP Platform <mail@platform.example.test>',
      domainId: 'dom-platform.example.test',
    });
    expect(await readEmailDomainBinding('dom-platform.example.test')).toMatchObject({
      scope: 'platform',
      domainId: 'dom-platform.example.test',
      domain: 'platform.example.test',
    });
  });

  test('delete and unarchive serialize so a deletion reservation cannot be revived', async () => {
    const owner = await createAccount(OWNER);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await callJson(owner.idToken, 'archiveCfp', { archived: true });

    const [deletion, unarchive] = await Promise.all([
      callAs(owner.idToken, 'deleteCfp', { confirm: CFP_ID }),
      callAs(owner.idToken, 'archiveCfp', { archived: false }),
    ]);
    expect(Number(deletion.ok) + Number(unarchive.ok)).toBe(1);

    const cfp = await readCfp();
    if (deletion.ok) {
      expect(cfp).toBeNull();
    } else {
      expect(unarchive).toMatchObject({ ok: true });
      expect(cfp).toMatchObject({ archived: false });
      expect(cfp).not.toHaveProperty('deleting', true);
    }
  });

  test('only the owner can resume an interrupted deletion', async () => {
    const [owner, admin] = await Promise.all([
      createAccount(OWNER),
      createAccount(SECOND_OWNER),
    ]);
    await seedMember(owner.uid, 'owner', undefined, OWNER.email);
    await Promise.all([
      seedMember(admin.uid, 'admin', undefined, SECOND_OWNER.email),
      seedProposal('delete-race-talk', {
        speakerUid: 'delete-race-speaker',
        title: 'Delete exactly once',
        status: 'submitted',
      }),
    ]);
    await reserveCfpDeletionDirect(owner.uid);

    expect(await callAs(admin.idToken, 'deleteCfp', { confirm: CFP_ID })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(await readCfp()).toMatchObject({ archived: true, deleting: true });
    expect(await readMember(owner.uid)).toMatchObject({ deletionReserved: true });
    expect(await readMember(admin.uid)).toMatchObject({ role: 'admin' });
    expect(await readProposalById('delete-race-talk')).not.toBeNull();

    expect(await callAs(owner.idToken, 'deleteCfp', { confirm: CFP_ID })).toMatchObject({
      ok: true,
    });
    expect(await readCfp()).toBeNull();
    expect(await readMember(owner.uid)).toBeNull();
    expect(await readMember(admin.uid)).toBeNull();
    expect(await readProposalById('delete-race-talk')).toBeNull();
  });
});
