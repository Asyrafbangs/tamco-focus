import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const usesExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';

/**
 * What the in-between widths run.
 *
 * Every spec runs at 390 and 1440; only these run at 768, 1024 and 1280 as
 * well, because a full pass at five widths costs more than it finds. Layout is
 * the exception — a popover anchored to the wrong edge starts hanging off the
 * screen somewhere in the middle of that range, which is precisely where
 * nothing was looking.
 */
const EVERY_WIDTH = /(00-ui-parity|responsive-overflow-v118)\.spec\.ts/;

export default defineConfig({
  testDir: './tests/e2e',
  // Deterministic runs: no `.only` in CI, retry once to absorb transient
  // browser/server timing, and never silently pass a flaky spec.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-1280',
      testMatch: EVERY_WIDTH,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet-landscape',
      testMatch: EVERY_WIDTH,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'tablet-portrait',
      testMatch: EVERY_WIDTH,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  webServer: usesExternalServer
    ? undefined
    : {
        command:
          process.platform === 'win32'
            ? 'node scripts/start-e2e-server.mjs'
            : 'NEXT_DIST_DIR=.next-e2e npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
