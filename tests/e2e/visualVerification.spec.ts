import { expect, test } from '@playwright/test';
import {
  createAccount,
  reset,
  seedCfp,
  seedMember,
  seedProposal,
  seedSpeaker,
  seedPlatformMember,
  CFP_ID,
} from './backend';
import { at, field, signInAs, type Identity } from './form';

const ADMIN: Identity = { sub: 'visual-admin', email: 'visual-admin@example.org', name: 'Admin Alice' };
const REVIEWER: Identity = { sub: 'visual-reviewer', email: 'visual-reviewer@example.org', name: 'Reviewer Bob' };
const SPEAKER: Identity = { sub: 'visual-speaker', email: 'visual-speaker@example.org', name: 'Speaker Charlie' };

test.describe('Visual Verification & UI Capture', () => {
  test('captures admin settings, speaker form, reviewer deck, and organization workspace', async ({ page }, testInfo) => {
    await reset();

    // 1. Create accounts and seed CFP with custom theme and blind review
    const admin = await createAccount(ADMIN);
    const reviewer = await createAccount(REVIEWER);
    const speaker = await createAccount(SPEAKER);
    await seedPlatformMember(admin.uid, 'admin', ADMIN.email, ADMIN.name);

    await seedCfp(undefined, {
      theme: {
        primaryColor: '#0f766e',
        accentColor: '#0d9488',
        mastheadBg: '#115e59',
      },
      features: {
        blindReview: true,
      },
    });

    await seedMember(admin.uid, 'owner');
    await seedMember(reviewer.uid, 'reviewer');
    await seedSpeaker(speaker.uid, { name: 'Charlie Developer', email: SPEAKER.email, bio: 'AI & Cloud Engineer' });

    await seedProposal('prop-1', {
      title: 'Building Universal Multimodal CFP Platforms',
      abstract: 'An architectural deep-dive into multi-tenant reactive event platforms.',
      speakerUid: speaker.uid,
      status: 'submitted',
    });

    // 2. Capture Admin Settings Page
    await signInAs(page, ADMIN, at('/admin/settings'));
    await expect(page.getByRole('heading', { name: /Event theming/i })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('admin-settings.png'), fullPage: true });

    // 3. Capture Reviewer Deck Page (Blind Review in action)
    await signInAs(page, REVIEWER, `/c/${CFP_ID}/review`);
    await expect(page.getByRole('heading', { name: 'Building Universal Multimodal CFP Platforms' })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('reviewer-deck.png'), fullPage: true });

    // 4. Capture Speaker Submission Page with custom brand theme
    await signInAs(page, SPEAKER, `/c/${CFP_ID}/submit`);
    await expect(page.getByRole('textbox', { name: /^Title\b/ })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('speaker-form.png'), fullPage: true });

    // 5. Test Organization creation and workspace
    await signInAs(page, ADMIN, '/orgs');
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible({ timeout: 15_000 });

    // Click "+ Create an organization" button
    await page.getByRole('button', { name: /Create an organization/i }).first().click();
    await field(page, 'Organization name').fill('Global Tech Summit');
    await field(page, 'Organization slug').fill('global-tech');
    await page.getByRole('button', { name: /^Create organization$/i }).click();

    // Verify redirect to /orgs/global-tech workspace
    await expect(page.getByRole('heading', { name: 'Global Tech Summit' })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('org-workspace.png'), fullPage: true });

    // 6. Capture Organizations Directory Page with populated card
    await page.goto('/orgs');
    await expect(page.getByRole('heading', { name: 'Global Tech Summit' })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('orgs-list.png'), fullPage: true });

    // 7. Capture Home Page Discovery Catalog
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Find your next stage/i })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('home-catalog.png'), fullPage: true });

    // 8. Capture White-Labeled Event Landing Page
    await page.goto(`/c/${CFP_ID}`);
    await expect(page.getByRole('link', { name: /Submit a talk/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('white-labeled-event.png'), fullPage: true });
  });
});
