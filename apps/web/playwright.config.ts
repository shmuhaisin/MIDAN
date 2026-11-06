import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 420_000,
  // The local API talks to the database in another region, so each save takes a few seconds.
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3100', locale: 'ar',
    // Optional: a Chromium already on the machine, when Playwright's own download isn't available.
    ...(process.env.CHROMIUM_PATH && { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }),
  },
});
