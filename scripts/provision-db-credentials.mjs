// Generates the API database password and test account passwords on this machine.
// Plaintext goes only into git-ignored .env files. The SQL file holds only salted hashes.
// Usage: node scripts/provision-db-credentials.mjs <output.sql> (run from the repo root, after npm install).
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const bcrypt = createRequire(new URL('../apps/api/', import.meta.url))('bcryptjs');
const REF = 'squpszwbrqkflezfltoj';
const POOLER = process.env.POOLER_HOST ?? 'aws-1-eu-central-1.pooler.supabase.com';
const out = process.argv[2];
if (!out) throw new Error('Pass the output SQL path');

function scramVerifier(password) {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const dbPassword = randomBytes(32).toString('hex');
const USERS = ['org-a-owner', 'org-a-recruiter', 'org-b-owner', 'candidate-one', 'candidate-two'];
const testEnv = [];
let sql = `alter role midan_api login password '${scramVerifier(dbPassword)}';\n`;
for (const name of USERS) {
  const id = randomUUID();
  const email = `midan.test.${name}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const key = name.toUpperCase().replaceAll('-', '_');
  testEnv.push(`TEST_${key}_EMAIL=${email}`, `TEST_${key}_PASSWORD=${password}`);
  const hash = bcrypt.hashSync(password, 10);
  sql += `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}', '${hash}', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Midan test: ${name}"}', now(), now(), '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('${id}', '${id}', '{"sub":"${id}","email":"${email}","email_verified":true}', 'email', now(), now(), now());\n`;
}

const base = (existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8'))
  .split('\n').filter((l) => !l.startsWith('DATABASE_URL=') && !l.startsWith('DIRECT_URL=') && !l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).join('\n').trimEnd();
const user = `midan_api.${REF}`;
writeFileSync('.env', `${base}
# Transaction pooler for the app; session pooler for Prisma introspection.
DATABASE_URL=postgresql://${user}:${dbPassword}@${POOLER}:6543/postgres?pgbouncer=true&connection_limit=5
DIRECT_URL=postgresql://${user}:${dbPassword}@${POOLER}:5432/postgres
`, { mode: 0o600 });
writeFileSync('.env.test.local', testEnv.join('\n') + '\n', { mode: 0o600 });
writeFileSync(out, sql, { mode: 0o600 });
console.log('Wrote .env, .env.test.local and', out);
