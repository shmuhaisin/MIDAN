import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 180_000,
  // The local API talks to the database in another region, so each save takes a few seconds.
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3100', locale: 'ar' },
});
