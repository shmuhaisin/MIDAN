import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Only public values and the API address are taken from the root .env. Database credentials stay out of the web app.
const rootEnv = path.join(__dirname, '../../.env');
const env = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {};

const config: NextConfig = {
  // Lets the form tests run their own instances beside the normal dev server.
  distDir: process.env.MIDAN_DIST_DIR ?? '.next',
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
  env: {
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    API_URL: process.env.API_URL ?? env.API_URL ?? 'http://localhost:4000',
    DEV_TEST_SIGNUP: process.env.DEV_TEST_SIGNUP ?? env.DEV_TEST_SIGNUP ?? 'false',
    // Referenced only in server actions, so it stays out of browser bundles.
    DEV_TEST_ACCESS_CODE: process.env.DEV_TEST_ACCESS_CODE ?? env.DEV_TEST_ACCESS_CODE ?? '',
    // No host default: the verification link must be the configured origin, or sign-up stops.
    APP_URL: process.env.APP_URL ?? env.APP_URL ?? '',
  },
  turbopack: { root: path.join(__dirname, '../..') },
};

export default withNextIntl(config);
