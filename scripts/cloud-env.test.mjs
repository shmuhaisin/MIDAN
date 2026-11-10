import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOUD_AUTH_ORIGIN, CLOUD_PROJECT_REF, cloudChildEnv, validateCloudEnv, withheldSettings } from './cloud-env.mjs';

const direct = `postgresql://midan_api:synthetic-test-value@db.${CLOUD_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const pooler = `postgresql://midan_api.${CLOUD_PROJECT_REF}:synthetic-test-value@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5`;
const valid = () => ({
  NEXT_PUBLIC_SUPABASE_URL: CLOUD_AUTH_ORIGIN,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-test-key',
  DATABASE_URL: pooler,
  DIRECT_URL: direct,
  APP_URL: 'http://localhost:3100',
  API_URL: 'http://localhost:4000',
  DEV_TEST_SIGNUP: 'true',
  DEV_TEST_ACCESS_CODE: 'synthetic-test-gate',
});

test('accepts the expected project with restricted direct and pooler logins and required TLS', () => {
  assert.deepEqual(validateCloudEnv(valid()), { ok: true, errors: [] });
  const profile = { ...valid(), DATABASE_URL: direct, DIRECT_URL: pooler.replace(':6543/', ':5432/'), APP_URL: 'https://midan.example' };
  assert.equal(validateCloudEnv(profile).ok, true);
  assert.equal(validateCloudEnv({ ...profile, CHECKPOINT_DATABASE_URL: direct.replace('midan_api:', 'midan_ai:') }).ok, true);
});

test('missing profile settings are named without exposing configuration values', () => {
  assert.deepEqual(validateCloudEnv({}).errors, ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'DATABASE_URL', 'DIRECT_URL', 'APP_URL', 'API_URL']);
  const profile = valid(); delete profile.DEV_TEST_ACCESS_CODE;
  assert.deepEqual(validateCloudEnv(profile).errors, ['DEV_TEST_ACCESS_CODE']);
  assert.equal(validateCloudEnv({ ...profile, DEV_TEST_SIGNUP: 'false' }).ok, true);
});

test('rejects local databases, another project, privileged roles and missing passwords', () => {
  for (const value of [
    'postgresql://midan_api:synthetic-test-value@127.0.0.1:54323/midan?sslmode=require',
    direct.replace(CLOUD_PROJECT_REF, 'another-project'),
    pooler.replace(`midan_api.${CLOUD_PROJECT_REF}`, 'midan_api.another-project'),
    direct.replace('midan_api:', 'postgres:'),
    pooler.replace('midan_api.', 'postgres.'),
    direct.replace(':synthetic-test-value@', '@'),
    direct.replace('/postgres?', '/another_database?'),
  ]) assert.deepEqual(validateCloudEnv({ ...valid(), DATABASE_URL: value }).errors, ['DATABASE_URL']);
});

test('TLS cannot be disabled or routing overridden with connection parameters', () => {
  for (const value of [
    direct.replace('?sslmode=require', ''), direct.replace('sslmode=require', 'sslmode=prefer'),
    `${direct}&ssl=false`, `${direct}&sslmode=disable`, `${direct}&host=localhost`, `${direct}&user=postgres`,
  ]) assert.deepEqual(validateCloudEnv({ ...valid(), DIRECT_URL: value }).errors, ['DIRECT_URL']);
});

test('requires matching Auth aliases and safe application origins', () => {
  assert.deepEqual(validateCloudEnv({ ...valid(), SUPABASE_URL: 'http://localhost:54321' }).errors, ['SUPABASE_URL']);
  assert.deepEqual(validateCloudEnv({ ...valid(), SUPABASE_PUBLISHABLE_KEY: 'different-key' }).errors, ['SUPABASE_PUBLISHABLE_KEY']);
  assert.deepEqual(validateCloudEnv({ ...valid(), NEXT_PUBLIC_SUPABASE_URL: 'https://another-project.supabase.co' }).errors, ['NEXT_PUBLIC_SUPABASE_URL']);
  assert.deepEqual(validateCloudEnv({ ...valid(), APP_URL: 'http://public.example' }).errors, ['APP_URL']);
  assert.equal(validateCloudEnv({ ...valid(), SUPABASE_URL: CLOUD_AUTH_ORIGIN, SUPABASE_PUBLISHABLE_KEY: valid().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }).ok, true);
});

test('explicit Cloud settings replace ambient local aliases and optional signup values', () => {
  const profile = valid(); delete profile.DEV_TEST_SIGNUP; delete profile.DEV_TEST_ACCESS_CODE;
  const child = cloudChildEnv(profile, {
    PATH: '/synthetic/tools', SUPABASE_URL: 'http://localhost:54321', SUPABASE_PUBLISHABLE_KEY: 'local-key',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', DATABASE_URL: 'local-database', DIRECT_URL: 'local-direct',
    DEV_TEST_SIGNUP: 'true', DEV_TEST_ACCESS_CODE: 'local-gate', CHECKPOINT_DATABASE_URL: 'local-checkpoints',
  });
  assert.equal(child.SUPABASE_URL, CLOUD_AUTH_ORIGIN);
  assert.equal(child.NEXT_PUBLIC_SUPABASE_URL, CLOUD_AUTH_ORIGIN);
  assert.equal(child.SUPABASE_PUBLISHABLE_KEY, profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(child.DATABASE_URL, pooler); assert.equal(child.DIRECT_URL, direct);
  assert.equal(child.DEV_TEST_SIGNUP, 'false'); assert.equal(child.DEV_TEST_ACCESS_CODE, '');
  assert.equal(child.CHECKPOINT_DATABASE_URL, ''); assert.equal(child.PATH, '/synthetic/tools');
  assert.equal(child.MIDAN_DIST_DIR, '.next-cloud');
  assert.throws(() => cloudChildEnv({}, {}), /NEXT_PUBLIC_SUPABASE_URL/);
});

// Added on the integration branch.
test('ambient stack and libpq settings never reach the services; non-stack settings do', () => {
  const child = cloudChildEnv(valid(), {
    PATH: '/synthetic/tools', HOME: '/synthetic/home', PGHOST: '127.0.0.1', PGPORT: '54323', PGUSER: 'postgres', PGPASSWORD: 'synthetic-local',
    PGSSLMODE: 'disable', LOCAL_PG_PORT: '54323', LOCAL_SUPABASE_PORT: '54321', TEST_PLATFORM_ADMIN_PASSWORD: 'synthetic-local',
    AI_SERVICE_URL: 'http://localhost:9999', MIDAN_DIST_DIR: '.next',
  });
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'LOCAL_PG_PORT', 'LOCAL_SUPABASE_PORT', 'TEST_PLATFORM_ADMIN_PASSWORD', 'AI_SERVICE_URL']) {
    assert.equal(child[key], undefined, key);
  }
  assert.equal(child.MIDAN_DIST_DIR, '.next-cloud');
  assert.equal(child.PATH, '/synthetic/tools'); assert.equal(child.HOME, '/synthetic/home');
});

test('privileged connection strings in the profile are withheld from every service', () => {
  const privileged = `postgresql://postgres.${CLOUD_PROJECT_REF}:synthetic-test-value@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`;
  const profile = { ...valid(), MIGRATION_DATABASE_URL: privileged, IMPORT_DATABASE_URL: privileged };
  assert.equal(validateCloudEnv(profile).ok, true);
  assert.deepEqual(withheldSettings(profile), ['IMPORT_DATABASE_URL', 'MIGRATION_DATABASE_URL']);
  const child = cloudChildEnv(profile, { MIGRATION_DATABASE_URL: privileged });
  // Empty rather than absent, so the services' own .env loading can't fill them in again.
  assert.equal(child.MIGRATION_DATABASE_URL, ''); assert.equal(child.IMPORT_DATABASE_URL, '');
  assert.ok(!Object.values(child).includes(privileged));
});

test('a privileged role is refused for the service databases, the checkpoint store included', () => {
  for (const role of ['postgres', 'supabase_admin', 'service_role', 'midan_ai']) {
    assert.deepEqual(validateCloudEnv({ ...valid(), DATABASE_URL: pooler.replace('midan_api.', `${role}.`) }).errors, ['DATABASE_URL'], role);
  }
  assert.deepEqual(validateCloudEnv({ ...valid(), CHECKPOINT_DATABASE_URL: direct }).errors, ['CHECKPOINT_DATABASE_URL']);
  assert.deepEqual(validateCloudEnv({ ...valid(), CHECKPOINT_DATABASE_URL: direct.replace('midan_api:', 'postgres:') }).errors, ['CHECKPOINT_DATABASE_URL']);
});

test('the Cloud build directory is never the local one, and a secret key is not a publishable key', () => {
  for (const dir of ['.next', 'next', '../.next', '.next/cloud', '']) assert.deepEqual(validateCloudEnv({ ...valid(), MIDAN_DIST_DIR: dir }).errors, ['MIDAN_DIST_DIR'], dir);
  assert.equal(validateCloudEnv({ ...valid(), MIDAN_DIST_DIR: '.next-cloud' }).ok, true);
  assert.deepEqual(validateCloudEnv({ ...valid(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' }).errors, ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
  assert.deepEqual(validateCloudEnv({ ...valid(), AI_SERVICE_URL: 'http://ai.example' }).errors, ['AI_SERVICE_URL']);
});

test('failures name settings, never their values', () => {
  const secret = 'synthetic-secret-value-that-must-not-leak';
  const profile = { ...valid(), DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:54323/midan`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${secret}` };
  const result = validateCloudEnv(profile);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.throws(() => cloudChildEnv(profile, {}), (error) => !String(error.message).includes(secret));
});
