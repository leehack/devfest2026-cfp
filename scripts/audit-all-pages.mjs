import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = resolve(process.env.UI_AUDIT_DIR ?? 'test-results/manual-ui-audit');

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // 1. Sign in as Admin
  await page.goto('http://localhost:5173/orgs');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Event Admin/i }).click();
  await page.waitForTimeout(1000);

  const pagesToCapture = [
    { name: 'home', url: 'http://localhost:5173/' },
    { name: 'orgs_list', url: 'http://localhost:5173/orgs' },
    { name: 'org_workspace_events', url: 'http://localhost:5173/orgs/global-tech' },
    { name: 'cfp_devfest', url: 'http://localhost:5173/c/devfest-mtl-2026' },
    { name: 'cfp_ai_summit', url: 'http://localhost:5173/c/ai-world-summit-2026' },
    { name: 'speaker_form', url: 'http://localhost:5173/c/devfest-mtl-2026/submit' },
    { name: 'reviewer_deck', url: 'http://localhost:5173/c/devfest-mtl-2026/review' },
    { name: 'admin_overview', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/overview' },
    { name: 'admin_proposals', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/proposals' },
    { name: 'admin_committee', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/committee' },
    { name: 'admin_settings', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/settings' },
    { name: 'speaker_profile', url: 'http://localhost:5173/me' },
    { name: 'new_cfp', url: 'http://localhost:5173/new' },
  ];

  const captureAll = async (theme) => {
    await page.evaluate((t) => {
      globalThis.document.documentElement.dataset.theme = t;
      globalThis.document.documentElement.style.colorScheme = t;
      globalThis.localStorage.setItem('cfp.theme', t);
    }, theme);

    for (const item of pagesToCapture) {
      await page.goto(item.url);
      // Wait for loading indicator to disappear if present
      await page
        .locator('text=Loading...')
        .waitFor({ state: 'detached', timeout: 3000 })
        .catch(() => undefined);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${ARTIFACT_DIR}/audit_${theme}_${item.name}.png`, fullPage: true });
    }
  };

  await captureAll('light');
  await captureAll('dark');

  await browser.close();
  console.log('✅ Captured clean audits in both light and dark modes!');
}

main().catch(console.error);
