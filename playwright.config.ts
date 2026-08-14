import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the emulated stack `npm start` brings up. Serial and
 * single-worker on purpose: the tests reset one shared emulator between cases,
 * so parallel workers would clear each other's data.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env.E2E_SKIP_NETWORK ? '**/sessionize.spec.ts' : undefined,
  // Not tsconfig.json: Next owns that and sets jsx: preserve.
  tsconfig: './tsconfig.test.json',
  fullyParallel: false,
  workers: 1,
  // A busy Firestore emulator can hold its database-clear lock while delayed
  // triggers drain. Assertions keep their short timeouts; only the test budget
  // allows the bounded reset retry to recover.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-CA',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // Cold start builds functions and boots four emulators.
    timeout: 180_000,
    stdout: 'pipe',
  },
});
