import { defineConfig, devices } from '@playwright/test';

// Import context.ts as helper/instructions
import './tests/context';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://playwright.dev',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false,  // Always run in headed mode
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,  // Ensure Chrome runs in headed mode
        // Context.ts provides instructions for:
        // - Step-by-step execution with 1s delays
        // - DOM inspection on failures
        // - Browser stays open on failures
        // - Enhanced debugging helpers
        testIdAttribute: 'data-testid',
      },
    },
  ],
});
