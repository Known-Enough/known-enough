import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/hosted-preview',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: 'npm run preview:hosted --workspace @deal-table/web -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/hosted-preview/index.html',
    reuseExistingServer: false,
  },
});
