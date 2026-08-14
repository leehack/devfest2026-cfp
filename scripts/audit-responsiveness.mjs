import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = resolve(process.env.UI_AUDIT_DIR ?? 'test-results/manual-ui-audit');

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 }, // iPhone 14/15
  { name: 'tablet', width: 768, height: 1024 }, // iPad
];

const PAGES = [
  { name: 'home', url: 'http://localhost:5173/' },
  { name: 'orgs_list', url: 'http://localhost:5173/orgs' },
  { name: 'org_workspace', url: 'http://localhost:5173/orgs/global-tech' },
  { name: 'cfp_devfest', url: 'http://localhost:5173/c/devfest-mtl-2026' },
  { name: 'speaker_form', url: 'http://localhost:5173/c/devfest-mtl-2026/submit' },
  { name: 'reviewer_deck', url: 'http://localhost:5173/c/devfest-mtl-2026/review' },
  { name: 'admin_overview', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/overview' },
  { name: 'admin_proposals', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/proposals' },
  { name: 'admin_committee', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/committee' },
  { name: 'admin_settings', url: 'http://localhost:5173/c/devfest-mtl-2026/admin/settings' },
  { name: 'new_cfp', url: 'http://localhost:5173/new' },
  { name: 'speaker_profile', url: 'http://localhost:5173/me' },
];

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const overflowIssues = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

    // 1. Sign in as Admin
    await page.goto('http://localhost:5173/orgs');
    await page.waitForTimeout(500);
    const adminBtn = page.getByRole('button', { name: /Event Admin/i });
    if (await adminBtn.isVisible()) {
      await adminBtn.click();
      await page.waitForTimeout(1000);
    }

    for (const item of PAGES) {
      await page.goto(item.url);
      await page
        .locator('text=Loading...')
        .waitFor({ state: 'detached', timeout: 3000 })
        .catch(() => undefined);
      await page.waitForTimeout(500);

      // Check for horizontal overflow
      const overflow = await page.evaluate(() => {
        const docWidth = globalThis.document.documentElement.clientWidth;
        const scrollWidth = globalThis.document.documentElement.scrollWidth;
        const bodyScrollWidth = globalThis.document.body.scrollWidth;
        const hasOverflow = scrollWidth > docWidth + 1 || bodyScrollWidth > docWidth + 1;

        // Find elements that exceed the viewport width
        const overflowingElements = [];
        if (hasOverflow) {
          const all = globalThis.document.querySelectorAll('*');
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.right > docWidth + 2) {
              overflowingElements.push({
                tag: el.tagName,
                className: el.className,
                id: el.id,
                right: rect.right,
                docWidth,
              });
            }
          }
        }
        return {
          docWidth,
          scrollWidth,
          hasOverflow,
          overflowingElements: overflowingElements.slice(0, 5),
        };
      });

      if (overflow.hasOverflow) {
        overflowIssues.push({
          viewport: vp.name,
          page: item.name,
          url: item.url,
          details: overflow,
        });
      }

      await page.screenshot({
        path: `${ARTIFACT_DIR}/responsive_${vp.name}_${item.name}.png`,
        fullPage: true,
      });
    }

    await page.close();
  }

  await browser.close();

  console.log('=== RESPONSIVENESS OVERFLOW REPORT ===');
  if (overflowIssues.length === 0) {
    console.log('✅ No horizontal overflow detected across mobile and tablet viewports!');
  } else {
    console.log(`⚠️ Found ${overflowIssues.length} potential overflow issues:`, JSON.stringify(overflowIssues, null, 2));
  }
}

main().catch(console.error);
