import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for AAELink.
 *
 * Tests run against the Next.js dev server at localhost:3040.
 * A Postgres database must be available for full integration paths.
 *
 * Usage:
 *   npx playwright test              # run all e2e tests
 *   npx playwright test --ui         # interactive UI mode
 *   npx playwright test --project=chromium
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',

  /* Maximum time per test */
  timeout: 30_000,

  /* Global setup/teardown */
  expect: { timeout: 5_000 },

  /* Run tests in parallel */
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,

  /* Reporter */
  reporter: process.env.CI
    ? [['html', { outputFolder: './e2e/.report' }]]
    : [['list']],

  /* Shared settings */
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3040',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Accept self-signed certs for local dev */
    ignoreHTTPSErrors: true,
  },

  /* Browser targets */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Mobile viewports */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  /* Automatically start the dev server before tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3040',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
