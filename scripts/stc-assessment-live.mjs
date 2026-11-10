// LOCAL STACK ONLY. Generates the STC Data Analyst assessment through MIDAN's real pipeline with the configured live model,
// and writes what came back (both languages, rubric and assessor guide) to .local/stc-assessment/.
//
//   node scripts/stc-assessment-live.mjs
//
// The path is the product's own: a representative signs up and verifies through local Auth, asks for access to the STC
// registry employer, a platform administrator approves, the representative creates the job and its requirements, then asks
// MIDAN to generate the assessment. It refuses to run against anything but localhost, and it refuses to report success when
// the AI service is in demo mode or the version wasn't written by the live model.
//
// The official employer workbook isn't in the repository (data/source/README.md). When it hasn't been imported, an STC
// registry row is added to the LOCAL database only, from public facts (name, sector, official website), with source_file
// 'local-fixture'. Its candidates and data are fictional; the assessment's sample data is synthetic and says so.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = parseEnv(readFileSync(`${ROOT}.env`, 'utf8'));
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const API = `${env.API_URL}/v1`;
const local = (u) => /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u);
if (!local(SB) || !local(API) || !/@127\.0\.0\.1:|@localhost:/.test(env.DATABASE_URL)) throw new Error('Local stack only');
const tests = parseEnv(readFileSync(`${ROOT}.env.test.local`, 'utf8'));
const RUN = Date.now().toString(36);
const out = `${ROOT}.local/stc-assessment`;
mkdirSync(out, { recursive: true });

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const must = async (p) => {
  const r = await p;
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  return r.body;
};
const psql = (sql) => execFileSync(`${ROOT}scripts/local-db.sh`, ['psql', '-At', '-c', sql], { encoding: 'utf8' }).trim();

async function signIn(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}`);
  return { id: body.user.id, email, token: body.access_token };
}
async function signUp(name, meta) {
  const email = `midan.test.${name}-${RUN}@example.com`;
  const password = `Pw-${RUN}-${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, data: { display_name: name, midan_test_access: env.DEV_TEST_ACCESS_CODE, ...meta } }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  let link;
  for (let i = 0; i < 40 && !link; i++) {
    const mail = await (await fetch(`${SB}/__mail?to=${encodeURIComponent(email)}`)).json();
    link = mail[0]?.links.find((l) => l.includes('/verify'));
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  if (!link) throw new Error('no verification email');
  await fetch(link, { redirect: 'manual' });
  return signIn(email, password);
}

// 0. The AI service must be on the live model.
const health = await (await fetch(`${env.AI_SERVICE_URL}/health`)).json();
console.log('AI health:', JSON.stringify(health));
if (health.provider === 'demo' || health.mode === 'demo') throw new Error('The AI service is in demo mode: no live model, nothing to prove');

// 1. The STC registry employer.
let registryId = psql(`select id from public.employer_registry where name_en ilike 'stc%' or name_en ilike '%saudi telecom%' limit 1`);
if (!registryId) {
  registryId = psql(`insert into public.employer_registry (source_company_id, name_ar, name_en, entity_type, sector, official_website, verification_status, source_file, notes)
    values ('local-fixture-stc', 'إس تي سي', 'stc', 'company', 'Telecommunications', 'https://www.stc.com.sa', 'pending_live_verification', 'local-fixture',
            'Local development fixture: the official employer workbook is not in this checkout') returning id`).split('\n')[0];
  console.log('Added a local-only STC registry fixture (the official workbook is not in this checkout).');
}

// 2. Representative → request → platform administrator approves → workspace.
const admin = await signIn(tests.TEST_PLATFORM_ADMIN_EMAIL, tests.TEST_PLATFORM_ADMIN_PASSWORD);
const rep = await signUp('stc-rep', { account_type: 'organization' });
await must(call(rep.token, 'POST', '/me/employer-access', { registry_id: registryId, representative_name: 'Fictional talent lead', job_title: 'Talent acquisition lead', verification_note: 'Fictional test representative' }));
const queue = await must(call(admin.token, 'GET', '/admin/employer-access'));
const request = (queue.items ?? queue).find((r) => r.work_email === rep.email && r.status === 'pending_approval');
if (!request) throw new Error('the access request did not reach the administrator queue');
await must(call(admin.token, 'POST', `/admin/employer-access/${request.id}/decision`, { decision: 'approve', role: 'owner' }));
const me = await must(call(rep.token, 'GET', '/me'));
const org = me.organization_members[0]?.org_id;
if (!org) throw new Error('approval did not create the workspace membership');

// 3. The job and its approved requirements.
const job = await must(call(rep.token, 'POST', `/organizations/${org}/jobs`, { slug: `data-analyst-${RUN}`, title_ar: 'محلل بيانات', title_en: 'Data Analyst' }));
await must(call(rep.token, 'PATCH', `/organizations/${org}/jobs/${job.id}`, {
  description_en: 'Join the consumer analytics team. Analyse subscriber, usage, billing and complaint data to explain churn and service experience, size retention opportunities, build SQL reports and dashboards, and present recommendations to commercial and customer-experience managers.',
  description_ar: 'انضم إلى فريق تحليلات قطاع الأفراد. حلّل بيانات المشتركين والاستخدام والفوترة والشكاوى لتفسير فقدان العملاء وتجربة الخدمة، وقدّر فرص الاحتفاظ بالعملاء، وأعدّ تقارير SQL ولوحات متابعة، واعرض التوصيات على مديري القطاع التجاري وتجربة العملاء.',
  location: 'Riyadh', employment_type: 'full_time', experience_level: 'mid', sector: 'digital',
}));
const requirements = [
  ['responsibility', 'Analyse customer churn and retention, and explain the main drivers', 'تحليل فقدان العملاء والاحتفاظ بهم وتفسير أهم الأسباب', true],
  ['responsibility', 'Write SQL to join, clean and aggregate large customer datasets', 'كتابة استعلامات SQL لربط بيانات العملاء الكبيرة وتنظيفها وتجميعها', true],
  ['competency', 'Build clear dashboards and KPIs for business stakeholders', 'بناء لوحات متابعة ومؤشرات أداء واضحة لأصحاب القرار', true],
  ['competency', 'Communicate findings and recommendations to non-technical managers', 'عرض النتائج والتوصيات بوضوح للمديرين غير التقنيين', true],
  ['qualification', 'Statistics: segmentation, trend analysis and testing a hypothesis', 'الإحصاء: التقسيم وتحليل الاتجاهات واختبار الفرضيات', false],
  ['experience', 'Experience in data analysis', 'خبرة في تحليل البيانات', false, 2],
];
for (const [type, en, ar, mandatory, years] of requirements) {
  await must(call(rep.token, 'POST', `/organizations/${org}/jobs/${job.id}/requirements`, { requirement_type: type, description_en: en, description_ar: ar, is_mandatory: mandatory, ...(years && { min_years: years }) }));
}

// 4. Generation through the API, which calls the AI service's assessment builder.
const started = Date.now();
const gen = await call(rep.token, 'POST', `/organizations/${org}/jobs/${job.id}/assessment/generate`, {});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
writeFileSync(`${out}/generate-response.json`, JSON.stringify(gen, null, 2));
if (gen.status >= 300) {
  console.error(`Generation refused after ${seconds}s: HTTP ${gen.status} ${JSON.stringify(gen.body).slice(0, 600)}`);
  process.exit(1);
}
const version = gen.body.version_id;
const view = await must(call(rep.token, 'GET', `/organizations/${org}/jobs/${job.id}/assessment`));
const guide = await must(call(rep.token, 'GET', `/organizations/${org}/assessment-versions/${version}/guide`));
// The generation's provenance is kept on its workflow run (assessment_versions.ai_thread_id), not on the version.
const provenance = psql(`select row_to_json(p) from (select r.mode, r.provider, r.model_version, r.prompt_version from public.assessment_versions v join public.ai_workflow_runs r on r.thread_id = v.ai_thread_id where v.id = '${version}') p`);
writeFileSync(`${out}/assessment.json`, JSON.stringify({ run: RUN, org, job: job.id, version, seconds, provenance: JSON.parse(provenance || 'null'), view, guide }, null, 2));
console.log(`Generated in ${seconds}s. Version ${version}. Provenance: ${provenance}`);
console.log(`Saved to ${out}/assessment.json`);
