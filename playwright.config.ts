import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the emulated stack `npm start` brings up. Serial and
 * single-worker on purpose: the tests reset one shared emulator between cases,
 * so parallel workers would clear each other's data.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-CA',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // Cold start builds functions and boots three emulators.
    timeout: 180_000,
    stdout: 'pipe',
  },
});
