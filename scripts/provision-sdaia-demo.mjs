// Creates one pre-confirmed SDAIA demo employer in a local or explicitly named staging project.
// Credentials are read only from .env.sdaia-demo.local, which is git-ignored.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = fileURLToPath(new URL('../.env.sdaia-demo.local', import.meta.url));
const PRODUCTION_REF = 'squpszwbrqkflezfltoj';
const SDEMO_EMAIL = 'sdaia.demo@example.com';
const ORG_NAME_AR = 'الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا)';
const ORG_NAME_EN = 'Saudi Data and Artificial Intelligence Authority (SDAIA)';

function readConfig(path) {
  if (!existsSync(path)) {
    throw new Error('Copy .env.sdaia-demo.example to .env.sdaia-demo.local and fill it before running this script.');
  }
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error('Invalid line in .env.sdaia-demo.local.');
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function requireValue(config, key) {
  const value = config[key]?.trim();
  if (!value) throw new Error(`${key} is required in .env.sdaia-demo.local.`);
  return value;
}

function verifyTarget(config, url) {
  const target = requireValue(config, 'SDAIA_DEMO_TARGET');
  const projectRef = requireValue(config, 'SDAIA_DEMO_PROJECT_REF');
  const hostname = url.hostname.toLowerCase();
  const local = hostname === 'localhost' || hostname === '127.0.0.1';

  if (projectRef === PRODUCTION_REF || hostname === `${PRODUCTION_REF}.supabase.co`) {
    throw new Error('Refusing to use the team's main production project.');
  }
  if (target === 'local') {
    if (!local) throw new Error('SDAIA_DEMO_TARGET=local requires a localhost Supabase URL.');
    return;
  }
  if (target !== 'staging' || local) throw new Error('SDAIA_DEMO_TARGET must be local or staging and match the URL.');
  if (config.SDAIA_DEMO_CONFIRM_STAGING !== 'yes') throw new Error('Remote creation requires SDAIA_DEMO_CONFIRM_STAGING=yes.');
  const ref = /^([a-z0-9-]+)\.supabase\.co$/.exec(hostname)?.[1];
  if (!ref || ref !== projectRef) throw new Error('The staging project ref must match the Supabase URL.');
}

async function request(url, key, path, options = {}) {
  return fetch(`${url.replace(/\/+$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

const config = readConfig(CONFIG_PATH);
const supabaseUrl = new URL(requireValue(config, 'SDAIA_DEMO_SUPABASE_URL'));
verifyTarget(config, supabaseUrl);
const serviceRoleKey = requireValue(config, 'SDAIA_DEMO_SERVICE_ROLE_KEY');
const email = requireValue(config, 'SDAIA_DEMO_EMAIL').toLowerCase();
const password = requireValue(config, 'SDAIA_DEMO_PASSWORD');
const accessCode = requireValue(config, 'SDAIA_DEMO_ACCESS_CODE');
if (email !== SDEMO_EMAIL) throw new Error(`Use the reserved demo address ${SDEMO_EMAIL}.`);
if (password.length < 12) throw new Error('SDAIA_DEMO_PASSWORD must be at least 12 characters.');

const created = await request(supabaseUrl.origin, serviceRoleKey, '/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: ORG_NAME_EN,
      account_type: 'organization',
      org_name_ar: ORG_NAME_AR,
      org_name_en: ORG_NAME_EN,
      midan_test_access: accessCode,
    },
  }),
});
if (!created.ok) {
  const details = await created.json().catch(() => ({}));
  if (created.status === 422 || created.status === 409) throw new Error(`Auth refused demo user creation (${created.status}); verify the test access code and whether the address already exists.`);
  throw new Error(`Auth refused demo user creation (${created.status}): ${details.msg ?? details.message ?? 'unknown error'}`);
}
const user = await created.json();
if (!user?.id || user.email_confirmed_at == null) throw new Error('Auth created a user without confirming its email.');

const memberResponse = await request(supabaseUrl.origin, serviceRoleKey, `/rest/v1/organization_members?user_id=eq.${encodeURIComponent(user.id)}&select=org_id,role`);
if (!memberResponse.ok) throw new Error(`Could not verify the organization provisioned for ${email} (${memberResponse.status}).`);
const members = await memberResponse.json();
if (!Array.isArray(members) || members.length !== 1 || members[0].role !== 'owner') {
  throw new Error('The confirmed account exists, but its organization owner membership was not provisioned.');
}

const orgResponse = await request(supabaseUrl.origin, serviceRoleKey, `/rest/v1/organizations?id=eq.${encodeURIComponent(members[0].org_id)}&select=id,name_ar,name_en,is_demo`);
if (!orgResponse.ok) throw new Error(`Could not verify the SDAIA organization (${orgResponse.status}).`);
const orgs = await orgResponse.json();
if (!Array.isArray(orgs) || orgs.length !== 1 || orgs[0].name_ar !== ORG_NAME_AR || orgs[0].name_en !== ORG_NAME_EN) {
  throw new Error('The provisioned organization did not match the approved SDAIA names; no branding changes were made.');
}

if (!orgs[0].is_demo) {
  const marked = await request(supabaseUrl.origin, serviceRoleKey, `/rest/v1/organizations?id=eq.${encodeURIComponent(orgs[0].id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ is_demo: true }),
  });
  if (!marked.ok) throw new Error(`Organization was created but could not be marked as demo (${marked.status}).`);
}

console.log(`Created confirmed demo employer ${email}. Organization: ${orgs[0].id}.`);
console.log('Email confirmation remains unchanged for every other account. The password was not printed.');
