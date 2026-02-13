import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for visual regression testing.
 *
 * Captures screenshots of key pages and compares them against baselines.
 * Run with: npm run test:visual
 *
 * First run generates baseline screenshots in __screenshots__/.
 * Subsequent runs compare against baselines and fail on pixel diff.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.visual.ts'],

  /* Snapshot settings */
  snapshotDir: './__screenshots__',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Allow 0.2% pixel difference to account for anti-aliasing
      maxDiffPixelRatio: 0.002,
      // Animations can cause flaky tests — wait for them to complete
      animations: 'disabled',
    },
  },

  /* Run tests sequentially to avoid port conflicts */
  fullyParallel: false,
  workers: 1,

  /* Retry on CI for flakiness */
  retries: process.env.CI ? 2 : 0,

  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:3000',
    /* Screenshot on failure for debugging */
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
      },
    },
  ],

  /* Start the dev server if not already running */
  webServer: {
    command: 'npm run build:web && npx next start -p 3000',
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    cwd: '../../', // Run from project root
  },
});
