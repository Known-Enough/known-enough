import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    browserName: 'chromium',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    serviceWorkers: 'block',
  },
});
