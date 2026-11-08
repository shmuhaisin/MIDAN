import { defineConfig } from '@playwright/test';
import { assertLocalStack } from './e2e/local-only';

assertLocalStack();

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 420_000,
  // Generous waits: some steps wait on the local AI service and background queue.
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3100', locale: 'ar',
    // Optional: a Chromium already on the machine, when Playwright's own download isn't available.
    ...(process.env.CHROMIUM_PATH && { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }),
  },
});
