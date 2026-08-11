import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  CFP_ID,
  callJson,
  createAccount,
  readEmailLog,
  reset,
  seedMember,
  seedProposal,
  seedSpeaker,
  seedSpeakerParticipant,
  setEmailDeliveryDirect,
  waitForEmail,
} from './backend';
import { at, field, signInAs } from './form';

const LEAD = { sub: 'ui-lead', email: 'lead-ui@example.org', name: 'Taylor Lead' };
const GUEST = { sub: 'ui-guest', email: 'guest-ui@example.org', name: 'Morgan Guest' };
const WRONG = { sub: 'ui-wrong', email: 'wrong-ui@example.org', name: 'Wrong Account' };
const ADMIN = { sub: 'ui-admin', email: 'admin-ui@example.org', name: 'Programme Admin' };
const ACKS = { noTravelSupport: true, coc: true, recording: true };
const ATTENDANCE = { status: 'local', needsVisa: false };
const INVITE_ABSTRACT =
  'A practical walkthrough of preparing, rehearsing, and delivering one coherent session with two presenters. ' +
  'The speakers demonstrate story planning, explicit handoffs, live-demo recovery, accessible audience interaction, and rehearsal checkpoints that keep the session aligned without making it feel scripted.';

async function expectContainedOnMobile(page: Page, locator: Locator) {
  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeTruthy();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth!);
  expect(
    await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

async function stagedInvitation() {
  const lead = await createAccount(LEAD);
  const guest = await createAccount(GUEST);
  await seedSpeaker(lead.uid, { name: LEAD.name, email: LEAD.email });
  await seedSpeaker(guest.uid, { name: GUEST.name, email: GUEST.email });
  await seedProposal('ui-linked-talk', {
    speakerUid: lead.uid,
    title: 'How two speakers ship one coherent session',
    abstract: INVITE_ABSTRACT,
    status: 'draft',
    includeSpeakerSnapshot: false,
  });
  const invitation = await callJson(lead.idToken, 'inviteCoSpeaker', {
    proposalId: 'ui-linked-talk',
    email: GUEST.email,
  });
  return { lead, guest, invitationId: String(invitation.invitationId) };
}

async function submittedPair() {
  const staged = await stagedInvitation();
  await callJson(staged.guest.idToken, 'respondToCoSpeakerInvitation', {
    proposalId: 'ui-linked-talk',
    invitationId: staged.invitationId,
    response: 'accept',
  });
  await seedSpeakerParticipant('ui-linked-talk', staged.guest.uid, {
    role: 'coSpeaker',
    acks: ACKS,
    attendance: ATTENDANCE,
  });
  await callJson(staged.lead.idToken, 'submitProposal', {
    proposalId: 'ui-linked-talk',
  });
  return staged;
}

test.describe('co-speaker UI', () => {
  test.beforeEach(async () => reset());

  test('the wrong-account invitation is masked, bilingual, and contained on mobile', async ({
    page,
  }) => {
    const { guest, invitationId } = await stagedInvitation();
    await page.setViewportSize({ width: 320, height: 720 });
    await signInAs(
      page,
      WRONG,
      `${at()}?proposal=ui-linked-talk&speakerInvite=${encodeURIComponent(invitationId)}`,
    );

    const invitation = page.locator('.co-speaker-invitation');
    await expect(
      page.getByRole('heading', { name: 'This invitation belongs to another account' }),
    ).toBeVisible();
    await expect(invitation).toContainText('g******@example.org');
    await expect(invitation).not.toContainText(GUEST.email);
    await expect(invitation).not.toContainText('How two speakers ship one coherent session');
    await expect(invitation).not.toContainText(INVITE_ABSTRACT);
    await expect(invitation).not.toContainText(LEAD.name);
    await expectContainedOnMobile(page, invitation);

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(
      page.getByRole('heading', { name: 'Cette invitation appartient à un autre compte' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Changer de compte' })).toBeVisible();
    await expectContainedOnMobile(page, invitation);

    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'ui-linked-talk',
      invitationId,
      response: 'accept',
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Cette invitation appartient à un autre compte' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vous avez rejoint cette proposition' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ouvrir la proposition' })).toHaveCount(0);
    await expect(invitation).not.toContainText('How two speakers ship one coherent session');
    await expect(invitation).not.toContainText(INVITE_ABSTRACT);
    await expect(invitation).not.toContainText(LEAD.name);
    await expectContainedOnMobile(page, invitation);
  });

  test('an invitee joins from the consent screen and gets read-only talk ownership', async ({
    page,
  }) => {
    const { invitationId } = await stagedInvitation();
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(
      page,
      GUEST,
      `${at()}?proposal=ui-linked-talk&speakerInvite=${encodeURIComponent(invitationId)}`,
    );

    const invitation = page.locator('.co-speaker-invitation');
    await expect(page.getByRole('heading', { name: 'Join this proposal' })).toBeVisible();
    await expect(invitation).toContainText('How two speakers ship one coherent session');
    await expect(invitation).toContainText(INVITE_ABSTRACT);
    await expect(invitation).toContainText('AI & ML');
    await expect(invitation).toContainText('Session — 40 minutes');
    await expect(invitation).toContainText('Intermediate');
    await expect(invitation).toContainText('English');
    await expect(
      page.getByRole('heading', { name: 'Committee access changes when you join' }),
    ).toBeVisible();
    await expectContainedOnMobile(page, invitation);

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(invitation).toContainText('IA et apprentissage automatique');
    await expect(invitation).toContainText('Session — 40 minutes');
    await expect(invitation).toContainText('Intermédiaire');
    await expect(invitation).toContainText('Anglais');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Save profile and join' }).click();

    const talkHeading = page.getByRole('heading', { name: 'Your talk' });
    await expect(talkHeading).toBeVisible();
    await expect(talkHeading).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('heading', { name: 'Speakers for this proposal' })).toBeVisible();
    await expect(page.getByText('You are a co-speaker on this proposal.')).toBeVisible();
    await expect(field(page, 'Title')).toBeDisabled();
    await expect(page.locator('.co-speaker-roster').getByText(GUEST.name, { exact: true })).toBeVisible();
    await expect(page.getByText('You', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Co-speaker email')).toHaveCount(0);
    await expectContainedOnMobile(page, page.locator('.co-speaker-roster'));
  });

  test('declining announces the new invitation state at the top of the page', async ({ page }) => {
    const { invitationId } = await stagedInvitation();
    await page.setViewportSize({ width: 320, height: 720 });
    await signInAs(
      page,
      GUEST,
      `${at()}?proposal=ui-linked-talk&speakerInvite=${encodeURIComponent(invitationId)}`,
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Decline invitation' }).click();
    const declined = page.getByRole('heading', { name: 'Invitation declined' });
    await expect(declined).toBeVisible();
    await expect(declined).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('button', { name: 'Save profile and join' })).toHaveCount(0);
  });

  test('the lead sees pending setup clearly and cannot submit past it in either language', async ({
    page,
  }) => {
    const { lead } = await stagedInvitation();
    const secondEmail = 'second.co-speaker.with-a-long-address@example.org';
    await callJson(lead.idToken, 'inviteCoSpeaker', {
      proposalId: 'ui-linked-talk',
      email: secondEmail,
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await signInAs(page, LEAD);

    const roster = page.locator('.co-speaker-roster');
    await expect(page.getByText(GUEST.email, { exact: true })).toBeVisible();
    await expect(page.getByText('Invitation pending', { exact: true })).toHaveCount(2);
    await expect(
      page.getByText('Complete every speaker’s setup before submitting', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit proposal' })).toBeDisabled();
    for (const email of [GUEST.email, secondEmail]) {
      const row = page.locator('.co-speaker-person').filter({ hasText: email });
      await expect(row).toHaveCount(1);
      const identity = row.locator('.co-speaker-person__identity strong');
      await expect(identity).toHaveText(email);
      expect(
        await identity.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            style.whiteSpace === 'normal' &&
            style.textOverflow === 'clip' &&
            element.scrollWidth <= element.clientWidth + 1
          );
        }),
      ).toBe(true);
      await expect(
        row.getByRole('button', { name: `Revoke invitation for ${email}`, exact: true }),
      ).toBeVisible();
    }
    const inviteEmail = page.getByLabel('Co-speaker email');
    await expect(inviteEmail).toHaveClass(/\bfield__input\b/);
    expect((await inviteEmail.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expectContainedOnMobile(page, roster);

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByText('Invitation en attente', { exact: true })).toHaveCount(2);
    await expect(
      page.getByText(
        'Complétez la préparation de chaque conférencier avant de soumettre',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soumettre la proposition' })).toBeDisabled();
    await expectContainedOnMobile(page, roster);
  });

  test('a failed invitation exposes a bilingual delivery retry action', async ({ page }) => {
    const { invitationId } = await stagedInvitation();
    const logId = `co_speaker_invited__ui-linked-talk__${invitationId}`;
    await waitForEmail((rows) => rows.some((row) => row.id === logId), 'invitation row');
    await setEmailDeliveryDirect(logId, { status: 'dry_run', attempts: 1 });
    await page.setViewportSize({ width: 320, height: 720 });
    await signInAs(page, LEAD);

    const row = page.locator('.co-speaker-person').filter({ hasText: GUEST.email });
    await expect(row.getByText('Email not delivered', { exact: true })).toBeVisible();
    const retry = row.getByRole('button', {
      name: `Retry invitation delivery for ${GUEST.email}`,
    });
    await expect(retry).toBeVisible();

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(row.getByText('Courriel non livré', { exact: true })).toBeVisible();
    await expect(
      row.getByRole('button', {
        name: `Réessayer l’envoi de l’invitation à ${GUEST.email}`,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await retry.click();

    await expect(
      page.getByText(`A new invitation email was queued for ${GUEST.email}.`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh speakers' })).toBeFocused();
    const rows = await waitForEmail(
      (current) => {
        const delivery = current.find((candidate) => candidate.id === logId);
        return Boolean(delivery && Number(delivery.attempts) >= 2);
      },
      'retried UI invitation',
    );
    expect(rows.filter((delivery) => delivery.id === logId)).toHaveLength(1);
    expect((await readEmailLog()).find((delivery) => delivery.id === logId)).toMatchObject({
      invitationId,
      invitationEmail: GUEST.email,
    });
  });

  test('each active-speaker action names the person it will affect', async ({ page }) => {
    const { guest, invitationId } = await stagedInvitation();
    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'ui-linked-talk',
      invitationId,
      response: 'accept',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, LEAD);

    const guestRow = page.locator('.co-speaker-person').filter({ hasText: GUEST.name });
    await expect(guestRow).toHaveCount(1);
    await expect(guestRow.locator('.co-speaker-person__revoke')).toHaveAccessibleName(
      new RegExp(GUEST.name),
    );
    await expectContainedOnMobile(page, page.locator('.co-speaker-roster'));
  });

  test('a co-speaker can leave without a false error and returns to their proposal list', async ({
    page,
  }) => {
    const { guest, invitationId } = await stagedInvitation();
    await callJson(guest.idToken, 'respondToCoSpeakerInvitation', {
      proposalId: 'ui-linked-talk',
      invitationId,
      response: 'accept',
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await signInAs(page, GUEST);

    const leave = page.getByRole('button', { name: 'Leave this proposal' });
    await expect(leave).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    page.once('dialog', (dialog) => dialog.accept());
    await leave.click();

    await expect(page.getByText('You left this proposal.', { exact: true })).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(0);
    await expect(page.locator('.co-speaker-roster')).toHaveCount(0);
    await expect(page.getByText('Save the draft before inviting a co-speaker.')).toBeVisible();
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.goto(
      `${at()}?proposal=ui-linked-talk&speakerInvite=${encodeURIComponent(invitationId)}`,
    );
    await expect(
      page.getByRole('heading', { name: 'This invitation is unavailable' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open the proposal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save profile and join' })).toHaveCount(0);
  });

  test('admin speaker management traps focus, restores it, and stays usable on mobile', async ({
    page,
  }) => {
    await submittedPair();
    const admin = await createAccount(ADMIN);
    await seedMember(admin.uid, 'admin', CFP_ID, ADMIN.email);
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, ADMIN, at('/admin/proposals'));

    const manage = page.getByRole('button', { name: /Open speaker roster for/ }).first();
    await expect(manage).toBeVisible();
    await manage.click();
    const dialog = page.getByRole('dialog', { name: 'Speakers for this proposal' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.getByText(LEAD.name, { exact: true })).toBeVisible();
    await expect(dialog.getByText(GUEST.name, { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText(LEAD.email);
    await expect(dialog).not.toContainText(GUEST.email);
    await expect(dialog).toContainText('Only the lead speaker can invite co-speakers before submission.');
    await expect(dialog.getByLabel('Co-speaker email')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
    await expectContainedOnMobile(page, dialog);

    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Refresh speakers' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      dialog.getByRole('button', { name: 'Close speaker roster' }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(manage).toBeFocused();

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    const manageFr = page.getByRole('button', {
      name: /Ouvrir la liste des conférenciers pour/,
    }).first();
    await manageFr.click();
    const dialogFr = page.getByRole('dialog', {
      name: 'Conférenciers de cette proposition',
    });
    await expect(dialogFr).toBeVisible();
    await expect(dialogFr).toContainText(
      'Seul le conférencier principal peut inviter des co-conférenciers avant la soumission.',
    );
    await expectContainedOnMobile(page, dialogFr);
    await page.keyboard.press('Escape');
    await expect(dialogFr).toBeHidden();
    await expect(manageFr).toBeFocused();

    await page.goto(`${at('/admin/proposals')}?manageSpeakers=ui-linked-talk`);
    const deepLinked = page.getByRole('dialog', {
      name: 'Conférenciers de cette proposition',
    });
    await expect(deepLinked).toBeVisible();
    await expect(deepLinked).toBeFocused();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(deepLinked).toBeFocused();
  });
});
