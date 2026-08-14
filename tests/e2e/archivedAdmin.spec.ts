import { expect, test, type Page } from '@playwright/test';

import {
  createAccount,
  reset,
  seedCfp,
  seedMember,
  seedProposal,
  seedSpeaker,
} from './backend';
import { at, signInAs, type Identity } from './form';

const OWNER: Identity = {
  sub: 'archived-owner',
  email: 'archived-owner@example.org',
  name: 'Olivia Owner',
};
const SPEAKER: Identity = {
  sub: 'archived-speaker',
  email: 'archived-speaker@example.org',
  name: 'Sam Speaker',
};

const open = async (page: Page, tab: string) => {
  await page.goto(at(`/admin/${tab}`));
  await expect(page.locator('.admin-read-only')).toHaveCount(1);
  await expect(page.locator('.admin-read-only')).toContainText('Archived. It is read-only now.');
};

test('an archived admin workspace keeps records readable without offering writes', async ({
  page,
}) => {
  await reset();
  const owner = await createAccount(OWNER);
  const speaker = await createAccount(SPEAKER);
  await seedMember(owner.uid, 'owner', undefined, OWNER.email);
  await seedMember('archived-admin-uid', 'admin', undefined, 'past-admin@example.org');
  await seedSpeaker(speaker.uid, { name: SPEAKER.name, email: SPEAKER.email });
  await seedProposal('archived-boundary-talk', {
    speakerUid: speaker.uid,
    title: 'Archived boundary talk',
    status: 'submitted',
  });
  await seedCfp(undefined, { archived: true, ownerUid: owner.uid });

  await signInAs(page, OWNER, at('/admin/settings'));
  await expect(page.locator('.admin-read-only')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: /^Name/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save window' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Bring it back' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: /^Type devfest-mtl-2026/ })).toBeEnabled();

  await open(page, 'overview');
  await expect(
    page.locator('.setup-step', { hasText: 'Confirm the submission window' }),
  ).toHaveClass(/setup-step--done/);

  await open(page, 'committee');
  const pastAdmin = page.locator('.people__row', { hasText: 'past-admin@example.org' });
  await expect(pastAdmin.getByRole('combobox')).toBeDisabled();
  await expect(pastAdmin.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  const invite = page.locator('.grid--2');
  await expect(invite.getByRole('textbox', { name: /^Email/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Invite' })).toBeDisabled();

  await open(page, 'proposals');
  await expect(
    page.getByRole('combobox', { name: 'Status: Archived boundary talk' }),
  ).toBeDisabled();

  await open(page, 'submission');
  await expect(page.getByRole('button', { name: 'Save the form' })).toBeDisabled();
  await expect(page.locator('.optionlist input').first()).toBeDisabled();

  await open(page, 'confirmation');
  await expect(page.getByRole('button', { name: 'Add a question' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save questions' })).toBeDisabled();

  await open(page, 'email');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByText(/key is shared across every CFP/i)).toBeVisible();
  await expect(page.getByLabel(/^API key/)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^Send as/ })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Edit the wording' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send this to me' })).toBeDisabled();
  const compose = page.getByRole('region', { name: 'Write to all speakers on a talk' });
  await expect(compose.getByRole('button', { name: 'Review recipients' })).toBeDisabled();
});
