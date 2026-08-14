import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = resolve(process.env.ARTIFACT_DIR || 'test-results/live-preview');

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // 1. Home Page with all events listed
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${ARTIFACT_DIR}/screenshot_live_home.png`, fullPage: true });

  // 2. AI World Summit with emerald white-label theme
  await page.goto('http://localhost:5173/c/ai-world-summit-2026');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${ARTIFACT_DIR}/screenshot_live_ai_summit.png`, fullPage: true });

  // 3. Cloud Native Days with indigo white-label theme
  await page.goto('http://localhost:5173/c/cloud-native-days');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${ARTIFACT_DIR}/screenshot_live_cloud_days.png`, fullPage: true });

  // 4. Sign in via 1-click Fast Role Switcher
  await page.goto('http://localhost:5173/orgs');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Platform & CFP Owner/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ARTIFACT_DIR}/screenshot_live_signed_in_orgs.png`, fullPage: true });

  // 5. Admin Dashboard
  await page.goto('http://localhost:5173/c/devfest-mtl-2026/admin/overview');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ARTIFACT_DIR}/screenshot_live_admin_overview.png`, fullPage: true });

  await browser.close();
  console.log('✅ All live preview screenshots captured!');
}

main().catch(console.error);
