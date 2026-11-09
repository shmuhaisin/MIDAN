#!/usr/bin/env node
// MIDAN demo data: ten DEMO tenants (named after the registry's reference employers, never linked to them), twenty sample
// jobs with requirements, skills and approved assessments, and ten fictional candidates with applications, submitted work,
// reviewed evaluations and pipeline decisions. Docs: docs/testing/MIDAN_DEMO_DATA_GUIDE.md.
//
//   node scripts/demo-seed.mjs                                    local stack (the default; refuses anything else)
//   node scripts/demo-seed.mjs --target cloud --approved-by-owner <project-ref>
//                                                                 Supabase Cloud, only with the owner's approval and a
//                                                                 SUPABASE_SECRET_KEY in .env.cloud (Auth administration)
//   node scripts/demo-seed.mjs --clean [--target ...]              removes only what this seed created
//   --fixtures <path>   the test fixture file holding the platform administrator's password (default .env.test.local)
//   --admin-email <e>   that administrator (default: the fixture platform admin; on the cloud, the approved test admin)
//
// Idempotent: everything is found by its slug or email first, so a rerun completes what's missing and duplicates nothing.
// Accounts are created through Supabase Auth administration (never by writing Auth tables), pass the sign-up gate with
// the server's access code, and get random passwords kept only in .local/demo/demo-accounts-<target>.json (git-ignored).
// Every other write goes through MIDAN's API as the account concerned, except two marked database updates: the DEMO
// flags on this seed's own organizations and jobs (the API has no way to set them), and --clean.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ANSWERS, CANDIDATES, DEMO_NOTE_AR, DEMO_NOTE_EN, TENANTS } from './demo-data/dataset.mjs';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const TARGET = arg('--target') ?? 'local';
const CLEAN = argv.includes('--clean');
const ORG_PREFIX = 'midan-demo-org-';
const EMAIL = (kind, key) => `midan.demo.${kind}.${key}@example.com`;
const EMAIL_PATTERN = 'midan.demo.%@example.com';

// --- Target and its safety checks
const envFile = TARGET === 'cloud' ? '.env.cloud' : '.env';
const env = parseEnv(readFileSync(resolve(root, envFile), 'utf8'));
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const API = (env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(SUPA ?? '');
if (TARGET === 'local' && !local) throw new Error('.env does not point at the local stack; use --target cloud for Supabase Cloud');
if (TARGET === 'cloud') {
  const ref = new URL(SUPA).hostname.replace(/\.supabase\.co$/, '');
  if (arg('--approved-by-owner') !== ref) throw new Error(`Cloud writes need the owner's approval: --approved-by-owner ${ref}`);
  if (!env.SUPABASE_SECRET_KEY) throw new Error('Add SUPABASE_SECRET_KEY (the project secret key) to .env.cloud: accounts are created through Auth administration');
} else if (TARGET !== 'local') throw new Error('--target is local or cloud');
const ACCESS_CODE = env.DEV_TEST_ACCESS_CODE;
if (!CLEAN && !ACCESS_CODE) throw new Error(`DEV_TEST_ACCESS_CODE is empty in ${envFile}: accounts must pass the sign-up gate like anyone else`);

// Auth administration: the local stack's service role, signed with its development secret; the cloud project's secret key.
function localServiceKey() {
  const secret = readFileSync(resolve(root, 'scripts/local-supabase.mjs'), 'utf8').match(/jwtSecret: '([^']+)'/)[1];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iss: 'midan-demo-seed', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const ADMIN_KEY = TARGET === 'cloud' ? env.SUPABASE_SECRET_KEY : localServiceKey();
const adminHeaders = { apikey: TARGET === 'cloud' ? ADMIN_KEY : env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${ADMIN_KEY}`, 'content-type': 'application/json' };

// Database access, only for the DEMO flags and --clean. Connection parts go through the environment, never argv.
function sql(statement) {
  const pgbin = process.env.PG17BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
  const conn = TARGET === 'cloud'
    ? (() => { const u = new URL(env.DIRECT_URL); return { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) || 'postgres', PGSSLMODE: 'require' }; })()
    : { PGHOST: '127.0.0.1', PGPORT: new URL(env.DATABASE_URL).port || '5432', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'midan', PGSSLMODE: 'disable' };
  return execFileSync(`${pgbin}/psql`, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { env: { ...process.env, ...conn }, encoding: 'utf8' }).trim();
}

// --- Accounts and their credentials (git-ignored, created once)
const credFile = resolve(root, `.local/demo/demo-accounts-${TARGET}.json`);
mkdirSync(resolve(root, '.local/demo'), { recursive: true });
const creds = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
const saveCreds = () => writeFileSync(credFile, JSON.stringify(creds, null, 1), { mode: 0o600 });

let userIndex;
async function allUsers() {
  if (userIndex) return userIndex;
  userIndex = new Map();
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`${SUPA}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: adminHeaders });
    if (!res.ok) throw new Error(`Auth admin list: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const { users } = await res.json();
    for (const u of users) userIndex.set(u.email, u);
    if (users.length < 200) break;
  }
  return userIndex;
}
async function ensureAccount(email, displayName) {
  creds[email] ??= { password: `Demo-${randomBytes(12).toString('base64url')}` };
  saveCreds();
  const existing = (await allUsers()).get(email);
  if (existing) return existing.id;
  const res = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ email, password: creds[email].password, email_confirm: true, user_metadata: { display_name: displayName, midan_test_access: ACCESS_CODE } }),
  });
  if (!res.ok) throw new Error(`Creating ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const user = await res.json();
  userIndex.set(email, user);
  return user.id;
}

const tokens = {};
async function token(email) {
  if (tokens[email]) return tokens[email];
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: creds[email]?.password }) });
  if (!res.ok) throw new Error(`Sign-in failed for ${email}: ${res.status}`);
  return (tokens[email] = (await res.json()).access_token);
}
async function call(email, method, path, body, { allow = [] } = {}) {
  const res = await fetch(`${API}/v1${path}`, { method, headers: { authorization: `Bearer ${await token(email)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 240)}`);
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const log = (line) => console.log(`• ${line}`);

// --- Clean: only this seed's organizations (and what hangs off them) and accounts
if (CLEAN) {
  const removed = sql(`begin;
    delete from public.evaluation_results r using public.assessment_attempts t, public.organizations o where r.attempt_id = t.id and t.org_id = o.id and o.slug like '${ORG_PREFIX}%';
    delete from public.assessment_attempts t using public.organizations o where t.org_id = o.id and o.slug like '${ORG_PREFIX}%';
    delete from public.applications a using public.organizations o where a.org_id = o.id and o.slug like '${ORG_PREFIX}%';
    with gone as (delete from public.organizations where slug like '${ORG_PREFIX}%' returning 1) select count(*) from gone;
    commit;`);
  log(`removed ${removed || 0} demo organizations and their jobs, applications and evaluations`);
  let users = 0;
  for (const [email, u] of await allUsers()) {
    if (!/^midan\.demo\.[a-z]+\.[a-z0-9-]+@example\.com$/.test(email)) continue;
    const res = await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: adminHeaders });
    if (res.ok) users++; else console.warn(`  could not remove ${email}: ${res.status}`);
  }
  log(`removed ${users} demo accounts`);
  process.exit(0);
}

// --- Platform administrator: approves the demo tenants' organization review, as for any organization
const ADMIN = arg('--admin-email') ?? (TARGET === 'cloud' ? 'midan.test.org-b-owner@example.com' : 'midan.test.platform-admin@example.com');
// Its password comes from the test fixture file (git-ignored): --fixtures <path>, or .env.test.local in this checkout.
const fixtures = parseEnv(readFileSync(resolve(arg('--fixtures') ?? resolve(root, '.env.test.local')), 'utf8'));
const adminKey = Object.keys(fixtures).find((k) => k.endsWith('_EMAIL') && fixtures[k] === ADMIN);
creds[ADMIN] = { password: adminKey ? fixtures[adminKey.replace(/_EMAIL$/, '_PASSWORD')] : undefined };
if (!creds[ADMIN].password) throw new Error(`No password for the platform administrator ${ADMIN} in the test fixture file`);

// --- Tenants and jobs
const jobsByRef = {};
for (const tenant of TENANTS) {
  const owner = EMAIL('employer', tenant.key);
  await ensureAccount(owner, `${tenant.name_en} — demo owner`);
  const slug = `${ORG_PREFIX}${tenant.key}`;
  const mine = (await call(owner, 'GET', '/me')).data.organization_members ?? [];
  let org = mine.length ? mine[0].org_id : null;
  if (!org) org = (await call(owner, 'POST', '/organizations', { slug, name_ar: tenant.name_ar, name_en: tenant.name_en })).data.id;
  const review = (await call(owner, 'GET', `/organizations/${org}/verification`)).data.organization;
  if (review.verification_status !== 'approved') {
    if (review.verification_status === 'draft' || review.verification_status === 'changes_requested') {
      // Review requires the company type, like any organization's application.
      const companyType = ['elm', 'stc', 'sipchem'].includes(tenant.key) ? 'large_enterprise' : 'government_entity';
      await call(owner, 'PATCH', `/organizations/${org}/company-type`, { company_type: companyType });
      await call(owner, 'PATCH', `/organizations/${org}/profile`, {
        commercial_registration: `7${String(TENANTS.indexOf(tenant)).padStart(2, '0')}0000000`.slice(0, 10), business_email: `demo-${tenant.key}@example.com`,
        contact_phone: '+966 11 000 0000', city: 'Riyadh', representative_name: 'Demo Representative (fictional)', representative_title: 'Demo account',
        description_en: DEMO_NOTE_EN, description_ar: DEMO_NOTE_AR,
      });
      const form = new FormData();
      form.set('kind', 'commercial_registration');
      form.set('file', new Blob(['%PDF-1.4\n% DEMO placeholder document, not a real registration\n%%EOF\n'], { type: 'application/pdf' }), 'demo-registration.pdf');
      const upload = await fetch(`${API}/v1/organizations/${org}/verification/documents`, { method: 'POST', headers: { authorization: `Bearer ${await token(owner)}` }, body: form });
      if (!upload.ok) throw new Error(`Document upload for ${slug}: ${upload.status}`);
      await call(owner, 'POST', `/organizations/${org}/verification/submit`);
    }
    await call(ADMIN, 'POST', `/admin/organizations/${org}/decision`, { decision: 'approve', note: 'DEMO tenant approved for demonstration only.' });
  }
  for (const spec of tenant.jobs) {
    let job = (await call(owner, 'GET', `/organizations/${org}/jobs`)).data.find((j) => j.slug === spec.slug);
    if (!job) {
      job = (await call(owner, 'POST', `/organizations/${org}/jobs`, { slug: spec.slug, title_ar: spec.title_ar, title_en: spec.title_en, description_ar: `${spec.description_ar}\n\n${DEMO_NOTE_AR}`, description_en: `${spec.description_en}\n\n${DEMO_NOTE_EN}` })).data;
      await call(owner, 'PATCH', `/organizations/${org}/jobs/${job.id}`, { sector: tenant.sector, employment_type: 'full_time', experience_level: spec.level, location: 'Riyadh' });
    }
    if (!(await call(owner, 'GET', `/organizations/${org}/jobs/${job.id}/requirements`)).data.length) {
      for (const [i, r] of spec.requirements.entries()) await call(owner, 'POST', `/organizations/${org}/jobs/${job.id}/requirements`, { ...r, position: i + 1 });
    }
    if (!(await call(owner, 'GET', `/organizations/${org}/jobs/${job.id}/custom-skills`)).data.length) {
      for (const s of spec.skills) await call(owner, 'POST', `/organizations/${org}/jobs/${job.id}/custom-skills`, s);
    }
    let assessment = (await call(owner, 'GET', `/organizations/${org}/jobs/${job.id}/assessment`, undefined, { allow: [404] })).data;
    let note = '';
    if (!assessment?.version) {
      await call(owner, 'POST', `/organizations/${org}/jobs/${job.id}/assessment/generate`, {});
      assessment = (await call(owner, 'GET', `/organizations/${org}/jobs/${job.id}/assessment`)).data;
    }
    const version = assessment.version;
    if (version.status !== 'published') {
      const state = (await call(owner, 'GET', `/organizations/${org}/assessment-versions/${version.id}/changes`)).data;
      const approved = await call(owner, 'POST', `/organizations/${org}/assessment-versions/${version.id}/publish`, { reviewed_through: state.latest_change_id }, { allow: [409, 422] });
      if (approved.status !== 201 && approved.status !== 200) note = ' (assessment left as a draft: it did not meet the MIDAN Assessment Standard; a person revises it)';
    }
    await call(owner, 'PATCH', `/organizations/${org}/jobs/${job.id}/status`, { status: 'published' }, { allow: [409, 422] });
    jobsByRef[`${tenant.key}:${spec.slug}`] = { org, job: job.id, owner, orgSlug: slug, jobSlug: spec.slug, version: version.version_number ?? 1 };
    log(`${tenant.name_en}: ${spec.title_en}${note}`);
  }
}
// The DEMO marks: this seed's organizations and their jobs only. Demo jobs then appear in the labelled demo listing.
sql(`update public.organizations set is_demo = true where slug like '${ORG_PREFIX}%' and not is_demo;
     update public.jobs j set is_demo = true from public.organizations o where j.org_id = o.id and o.slug like '${ORG_PREFIX}%' and not j.is_demo;`);
log('organizations and jobs marked DEMO');

// --- Candidates: profile, applications, submitted work
const submitted = [];
for (const c of CANDIDATES) {
  const email = EMAIL('candidate', c.key);
  await ensureAccount(email, c.full_name);
  await call(email, 'PUT', '/me/candidate-profile', {
    full_name: c.full_name, headline: c.headline, city: c.city, summary: c.summary, years_experience: c.years,
    experience: c.experience, education: c.education, self_reported_skills: c.skills,
  });
  for (const ref of c.applies) {
    const target = jobsByRef[ref];
    const appId = (await call(email, 'POST', `/jobs/${target.job}/applications`, {})).data.id; // returns the existing one on rerun
    const application = (await call(email, 'GET', '/me/applications')).data.find((a) => a.id === appId);
    const attempt = application?.assessment_attempts?.[0];
    if (attempt && ['invited', 'in_progress'].includes(attempt.status)) {
      const seen = (await call(email, 'GET', `/experience/${target.orgSlug}/${target.jobSlug}/${target.version}`)).data;
      if (attempt.status === 'invited') await call(email, 'POST', `/attempts/${attempt.id}/start`);
      for (const t of seen.version.assessment_tasks) {
        const answer = t.task_type === 'objective_questions'
          ? { choices: Object.fromEntries((t.config?.questions ?? []).map((q) => [q.id, q.options?.[c.answer === 'strong' ? 0 : (q.options?.length ?? 1) - 1]?.id ?? 'a'])) }
          : { text: ANSWERS[c.answer] };
        await call(email, 'PUT', `/attempts/${attempt.id}/responses/${t.id}`, { answer }, { allow: [409, 422] });
      }
      await call(email, 'POST', `/attempts/${attempt.id}/submit`, undefined, { allow: [409] });
    }
    submitted.push({ c, ref, appId, attemptId: attempt?.id, ...target });
  }
  log(`${c.scenario}: ${c.full_name} applied to ${c.applies.length} job(s)`);
}

// --- Employers: evaluations reviewed and released by a person; pipeline decisions
for (const s of submitted) {
  if (s.attemptId) {
    const read = async () => (await call(s.owner, 'GET', `/attempts/${s.attemptId}/evaluation`, undefined, { allow: [404] })).data;
    let view = await read();
    if (!view?.evaluation_results) { await call(s.owner, 'POST', `/attempts/${s.attemptId}/evaluate`, undefined, { allow: [409, 422] }); view = await read(); }
    const evaluation = view?.evaluation_results;
    if (evaluation?.status === 'needs_human_review') {
      // The person's review: every criterion the model didn't score gets a score in line with the scenario.
      const scored = new Set((evaluation.criterion_scores ?? []).map((c) => c.criterion_id));
      const share = { strong: 0.85, partial: 0.55, weak: 0.2 }[s.c.answer];
      const scores = view.assessment_versions.assessment_tasks.flatMap((t) => t.rubric_criteria)
        .filter((c) => !scored.has(c.id))
        .map((c) => ({ criterion_id: c.id, score: Math.round(Number(c.max_score) * share), explanation: 'DEMO: scored by a person for the fictional dataset.' }));
      await call(s.owner, 'POST', `/evaluations/${evaluation.id}/review`, { scores, notes: 'Reviewed by a person for the DEMO dataset.' });
    }
    if (evaluation?.id) await call(s.owner, 'POST', `/evaluations/${evaluation.id}/release`, undefined, { allow: [409] });
  }
  await call(s.owner, 'GET', `/organizations/${s.org}/applications/${s.appId}/match`, undefined, { allow: [404, 503] });
  if (s.c.answer === 'strong') await call(s.owner, 'PATCH', `/applications/${s.appId}/status`, { status: 'shortlisted' }, { allow: [409, 422] });
  if (s.c.answer === 'weak') await call(s.owner, 'POST', `/organizations/${s.org}/applications/${s.appId}/outcome`, { outcome: 'not_selected', message_en: 'Thank you for applying. We will not continue at this stage (DEMO message).' }, { allow: [409, 422] });
}
log(`${submitted.length} applications: evaluations reviewed and released by a person; strong matches shortlisted, the weak one declined`);
console.log(`\nDemo data ready on ${TARGET}. Accounts and passwords: ${credFile} (git-ignored). Guide: docs/testing/MIDAN_DEMO_DATA_GUIDE.md`);
