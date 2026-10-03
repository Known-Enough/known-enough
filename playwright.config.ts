import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true,
  // Installed-browser fallback also limits startup pressure on older local hosts.
  ...(process.env.PLAYWRIGHT_CHANNEL ? { workers: 1 } : {}),
  // Optional installed-browser fallback for hosts unsupported by bundled Chromium.
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
  // B03 permits only Vite's loopback origin for its explicit local test labels.
  webServer: [
    { command: 'node scripts/run-local-api.mjs', port: 8788, env: { PORT: '8788' }, reuseExistingServer: false },
    { command: 'npm run dev --workspace @deal-table/web -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
    // Configured browser UI tests intercept public Cognito calls; no AWS credential or live request.
    { command: 'npm run dev --workspace @deal-table/web -- --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
      env: { VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_localtest',
        VITE_COGNITO_DOMAIN: 'https://localtest.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'localparticipant',
        VITE_COGNITO_DISPLAY_CLIENT_ID: 'localdisplay', VITE_API_BASE_URL: 'https://local-api.example.invalid' } },
  ],
});
