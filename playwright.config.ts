import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true,
  // Installed-browser fallback also limits startup pressure on older local hosts.
  ...(process.env.PLAYWRIGHT_CHANNEL ? { workers: 1 } : {}),
  // Optional installed-browser fallback for hosts unsupported by bundled Chromium.
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
  // B03 permits only Vite's loopback origin for its explicit local test labels.
  webServer: { command: 'npm run dev --workspace @deal-table/web -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
});
