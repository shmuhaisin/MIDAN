import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';
import { assertLocalStack } from './e2e/local-only';

assertLocalStack();

// The test checks this value never appears in what the browser receives.
process.env.DEV_TEST_ACCESS_CODE ??= parseEnv(readFileSync('../../.env', 'utf8')).DEV_TEST_ACCESS_CODE;

const stubbed = { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54399' };

export default defineConfig({
  testDir: 'e2e-forms',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    ...(process.env.CHROMIUM_PATH && { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }),
  },
  webServer: [
    { command: 'node e2e-forms/stub-auth.mjs', url: 'http://localhost:54399/__calls', reuseExistingServer: false },
    {
      command: 'npx next dev -p 3200',
      url: 'http://localhost:3200/en/login',
      timeout: 180_000,
      reuseExistingServer: false,
      env: { ...stubbed, DEV_TEST_SIGNUP: 'true', APP_URL: 'http://localhost:3200', MIDAN_DIST_DIR: '.next-forms-on' },
    },
    {
      command: 'npx next dev -p 3201',
      url: 'http://localhost:3201/en/login',
      timeout: 180_000,
      reuseExistingServer: false,
      env: { ...stubbed, DEV_TEST_SIGNUP: 'false', MIDAN_DIST_DIR: '.next-forms-off' },
    },
  ],
});
