// Stands in for Supabase Auth on localhost, so browser tests can drive the real sign-in and sign-up
// forms without typing a password into a page that sends it to a hosted service. It answers with real
// Supabase sessions for the fixture accounts, fetched here, so everything after the form is real.
// Real Supabase sign-up, sign-in and sign-out are tested separately in apps/api.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = {
  ...parseEnv(readFileSync(new URL('../../../.env', import.meta.url), 'utf8')),
  ...parseEnv(readFileSync(new URL('../../../.env.test.local', import.meta.url), 'utf8')),
};
const real = async (who) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  if (!res.ok) throw new Error(`Fixture sign-in failed: ${who}`);
  return res.json();
};
const sessions = { candidate: await real('CANDIDATE_TWO'), organization: await real('ORG_B_OWNER') };
const PASSWORD = 'form-test-password-1';
const calls = [];

createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (pathname === '/__calls') return send(200, calls);
  calls.push({ path: pathname, query: req.url, email: body.email, data: body.data, hasPassword: Boolean(body.password) });
  // Email verification is on, so a real sign-up returns a user and no session.
  if (pathname === '/auth/v1/signup') return send(200, { id: 'stub-user', email: body.email });
  if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'password') {
    if (body.password !== PASSWORD) return send(400, { error_code: 'invalid_credentials' });
    if (body.email === 'form.unverified@example.com') return send(400, { error_code: 'email_not_confirmed' });
    if (body.email === 'form.org@example.com') return send(200, sessions.organization);
    if (body.email === 'form.candidate@example.com') return send(200, sessions.candidate);
    return send(400, { error_code: 'invalid_credentials' });
  }
  if (pathname === '/auth/v1/logout') return send(204, {});
  return send(404, {});
}).listen(54399, 'localhost');
