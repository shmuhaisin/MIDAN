import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e-members', workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:3300', launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } },
  webServer: [
    { command: 'node e2e-members/stub-api.mjs', url: 'http://127.0.0.1:54398/health', reuseExistingServer: false },
    { command: 'npx next dev --hostname 127.0.0.1 -p 3300', url: 'http://127.0.0.1:3300/en/invitations/accept', timeout: 180_000, reuseExistingServer: false,
      env: { API_URL: 'http://127.0.0.1:54398', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54398', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-test-only', APP_URL: 'http://127.0.0.1:3300', MIDAN_DIST_DIR: '.next-members', DEV_TEST_SIGNUP: 'false' } },
  ],
});
