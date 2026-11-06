import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Only public values and the API address are taken from the root .env. Database credentials stay out of the web app.
const rootEnv = path.join(__dirname, '../../.env');
const env = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {};

// The development sign-up code is a secret, so it isn't in `env` below: Next.js writes those values into the built
// code. It stays a runtime variable of this server process, which only server actions read (lib/auth-actions.ts).
// scripts/check-bundle-secrets.mjs confirms no build contains it.
process.env.DEV_TEST_ACCESS_CODE ??= env.DEV_TEST_ACCESS_CODE ?? '';

const appUrl = process.env.APP_URL ?? env.APP_URL ?? 'http://localhost:3100';

// For every response, static files included. The Content-Security-Policy needs a nonce per page, so src/proxy.ts sends it.
// HSTS only for a production build served over HTTPS: on plain HTTP it would lock browsers out of the site.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ...(process.env.NODE_ENV === 'production' && appUrl.startsWith('https://')
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Lets the form tests run their own instances beside the normal dev server.
  distDir: process.env.MIDAN_DIST_DIR ?? '.next',
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
  env: {
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    API_URL: process.env.API_URL ?? env.API_URL ?? 'http://localhost:4000',
    DEV_TEST_SIGNUP: process.env.DEV_TEST_SIGNUP ?? env.DEV_TEST_SIGNUP ?? 'false',
    APP_URL: appUrl,
  },
  turbopack: { root: path.join(__dirname, '../..') },
};

export default withNextIntl(config);
