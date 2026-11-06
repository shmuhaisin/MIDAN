// LOCAL DEVELOPMENT ONLY. Writes .env and .env.test.local for the local stack, and creates the test accounts through
// the local Supabase Auth: a real sign-up with the development access code, then the real verification link from the
// local mail sink. Needs scripts/local-db.sh start and node scripts/local-supabase.mjs running.
//
//   node scripts/local-env.mjs           refuses to replace an existing .env that points somewhere else
//   node scripts/local-env.mjs --force   replaces it (keep a copy first if it holds hosted credentials)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { LOCAL } from './local-supabase.mjs';

const root = new URL('..', import.meta.url).pathname;
const envPath = `${root}.env`;
const testPath = `${root}.env.test.local`;
const force = process.argv.includes('--force');

if (existsSync(envPath) && !force) {
  const current = parseEnv(readFileSync(envPath, 'utf8'));
  if (current.NEXT_PUBLIC_SUPABASE_URL !== LOCAL.url) {
    console.error('.env points at another Supabase project. Move it aside or pass --force.');
    process.exit(1);
  }
}

const existingTest = existsSync(testPath) ? parseEnv(readFileSync(testPath, 'utf8')) : {};
const aiToken = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')).AI_SERVICE_TOKEN : undefined;

writeFileSync(envPath, `# Local stack, written by scripts/local-env.mjs. Every value here is local-only.
NEXT_PUBLIC_SUPABASE_URL=${LOCAL.url}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${LOCAL.publishableKey}
DATABASE_URL=postgresql://midan_api:midan-api-local@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan?connection_limit=5
DIRECT_URL=postgresql://midan_api:midan-api-local@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan
API_URL=http://localhost:4000
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_TOKEN=${aiToken ?? randomBytes(32).toString('hex')}
# Postgres-backed LangGraph checkpoints, so interrupted evaluations survive a restart.
CHECKPOINT_DATABASE_URL=postgresql://midan_ai:midan-ai-local@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=
OPENAI_API_KEY=
OPENAI_MODEL=
DEV_TEST_SIGNUP=true
DEV_TEST_ACCESS_CODE=local-dev-access
APP_URL=http://localhost:3100
# Integrations stay off until real credentials are added. Each screen says so.
DAILY_API_KEY=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
`, { mode: 0o600 });

const ACCOUNTS = ['org-a-owner', 'org-a-recruiter', 'org-b-owner', 'candidate-one', 'candidate-two', 'unverified', 'platform-admin'];
const headers = { apikey: LOCAL.publishableKey, 'content-type': 'application/json' };
const lines = [];

for (const name of ACCOUNTS) {
  const key = name.toUpperCase().replaceAll('-', '_');
  const email = `midan.test.${name}@example.com`;
  const password = existingTest[`TEST_${key}_PASSWORD`] ?? randomBytes(18).toString('base64url');
  lines.push(`TEST_${key}_EMAIL=${email}`, `TEST_${key}_PASSWORD=${password}`);

  const signIn = await fetch(`${LOCAL.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  if (signIn.ok) continue;
  const signUp = await fetch(`${LOCAL.url}/auth/v1/signup`, {
    method: 'POST', headers,
    body: JSON.stringify({ email, password, data: { display_name: `Midan test: ${name}`, midan_test_access: 'local-dev-access' } }),
  });
  if (!signUp.ok && signUp.status !== 422) throw new Error(`Sign-up failed for ${name}: ${signUp.status} ${await signUp.text()}`);
  if (name === 'unverified') continue;
  // Follow the verification link Auth emailed, as a person would.
  let link;
  for (let i = 0; i < 20 && !link; i++) {
    const mail = await (await fetch(`${LOCAL.url}/__mail?to=${encodeURIComponent(email)}`)).json();
    link = mail[0]?.links.find((l) => l.includes('/verify'));
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  if (!link) throw new Error(`No verification email arrived for ${name}`);
  const verified = await fetch(link, { redirect: 'manual' });
  if (verified.status !== 303 || !verified.headers.get('location')?.includes('access_token')) throw new Error(`Verification failed for ${name}`);
}

writeFileSync(testPath, `${lines.join('\n')}\n`, { mode: 0o600 });

// The platform administrator test account. On a hosted project, the first administrator is added the same way, by SQL.
const { createRequire } = await import('node:module');
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan` });
await db.connect();
await db.query(`insert into private.platform_admins (user_id, note) select id, 'local test administrator' from public.users
  where email = 'midan.test.platform-admin@example.com' on conflict do nothing`);
await db.end();
console.log(`Wrote .env and .env.test.local; ${ACCOUNTS.length} local test accounts ready.`);
