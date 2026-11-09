#!/usr/bin/env node
// The investor demo: one isolated, repeatable recruitment journey with synthetic data, through the real API.
//
//   node scripts/investor-demo.mjs                   build the showcase (idempotent: reuses what exists)
//   node scripts/investor-demo.mjs --reset           clear the candidates' side (applications, attempts, evaluations) and
//                                                    run it again. The organization, job and approved assessment keep
//                                                    their ids, so workspace and job links stay valid across resets.
//   node scripts/investor-demo.mjs --rebuild         remove the whole showcase organization and build it again (new ids:
//                                                    links to the old organization, job and attempts then lead to 404)
//   node scripts/investor-demo.mjs --with-interview  also schedule an interview (only with calendar keys blank, or a
//                                                    test calendar: the API creates real events when it has the keys)
//
// What it builds, all labelled synthetic: an organization "Showcase (synthetic data)", a published job with requirements,
// skills and an approved assessment, two applicants who complete it, evaluations reviewed and released by a person,
// requirement matches ready for staff review, one applicant shortlisted (and interviewed with --with-interview), the other with
// a recorded decision. Local stack only; it refuses any other address. Accounts come from .env.test.local.
// Instructions: docs/investor/INVESTOR_DEMO.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { PORTS } from './local-ports.mjs';

const root = resolve(import.meta.dirname, '..');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...parseEnv(readFileSync(resolve(root, '.env.test.local'), 'utf8')) };
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'API_URL']) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(env[k] ?? '')) throw new Error(`${k} must point at the local stack`);
}
const args = new Set(process.argv.slice(2));
const SLUG = 'midan-demo-showcase';
const DB = `postgresql://postgres:postgres@127.0.0.1:${PORTS.pg}/midan`;
const psql = `${process.env.PGBIN ?? '/opt/homebrew/opt/postgresql@16/bin'}/psql`;

if (args.has('--reset') || args.has('--rebuild')) {
  // Only the showcase organization and what hangs off it. Attempts and evaluations first: they don't cascade.
  const rebuild = args.has('--rebuild');
  execFileSync(psql, ['-q', '-v', 'ON_ERROR_STOP=1', DB, '-c', `
    begin;
    delete from public.evaluation_results r using public.assessment_attempts t, public.organizations o
      where r.attempt_id = t.id and t.org_id = o.id and o.slug = '${SLUG}';
    delete from public.assessment_attempts t using public.organizations o where t.org_id = o.id and o.slug = '${SLUG}';
    delete from public.applications a using public.organizations o where a.org_id = o.id and o.slug = '${SLUG}';
    ${rebuild ? `delete from public.organizations where slug = '${SLUG}';` : ''}
    commit;`]);
  console.log(rebuild ? 'Showcase removed.' : "Showcase candidates' side cleared; the organization, job and approved assessment are kept.");
}

const tokens = {};
async function token(who) {
  if (tokens[who]) return tokens[who];
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${who}`);
  return (tokens[who] = (await res.json()).access_token);
}
async function call(who, method, path, body, { allow = [] } = {}) {
  const res = await fetch(`${env.API_URL}/v1${path}`, { method, headers: { authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 240)}`);
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const step = (line) => console.log(`• ${line}`);

// 1. The organization and its team.
const mine = (await call('ORG_A_OWNER', 'GET', '/me')).data.organization_members ?? [];
let org = (await Promise.all(mine.map(async (m) => ({ id: m.org_id, slug: (await call('ORG_A_OWNER', 'GET', `/organizations/${m.org_id}`)).data.slug })))).find((o) => o.slug === SLUG)?.id;
if (!org) org = (await call('ORG_A_OWNER', 'POST', '/organizations', { slug: SLUG, name_ar: 'منشأة العرض (بيانات اصطناعية)', name_en: 'Showcase (synthetic data)' })).data.id;
await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/company-type`, { company_type: 'startup' });
// Organizations recruit only once a platform administrator approves them (20261111090000_organization_verification).
// The showcase goes through the real review: fictional profile, a placeholder PDF, submission, and the fixture
// administrator's approval.
if ((await call('ORG_A_OWNER', 'GET', `/organizations/${org}/verification`)).data.organization.verification_status !== 'approved') {
  await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/profile`, {
    commercial_registration: `9${String(Date.now()).slice(-9)}`, business_email: 'showcase@example.test', contact_phone: '+966 11 000 0000',
    city: 'Riyadh', representative_name: 'Showcase Representative', representative_title: 'HR Lead',
  });
  const form = new FormData();
  form.set('kind', 'commercial_registration');
  form.set('file', new Blob(['%PDF-1.4\n% Synthetic placeholder for the showcase\n%%EOF\n'], { type: 'application/pdf' }), 'showcase-cr.pdf');
  const upload = await fetch(`${env.API_URL}/v1/organizations/${org}/verification/documents`, { method: 'POST', headers: { authorization: `Bearer ${await token('ORG_A_OWNER')}` }, body: form });
  if (!upload.ok) throw new Error(`Document upload: ${upload.status}`);
  await call('ORG_A_OWNER', 'POST', `/organizations/${org}/verification/submit`);
  await call('PLATFORM_ADMIN', 'POST', `/admin/organizations/${org}/decision`, { decision: 'approve' });
  step('Showcase organization reviewed and approved by the fixture platform administrator');
}
const team = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/team`)).data;
if (!team.members.some((m) => m.email === env.TEST_ORG_A_RECRUITER_EMAIL)) {
  if (!team.invitations.some((i) => i.email === env.TEST_ORG_A_RECRUITER_EMAIL)) await call('ORG_A_OWNER', 'POST', `/organizations/${org}/team/invitations`, { email: env.TEST_ORG_A_RECRUITER_EMAIL, role: 'recruiter' });
  const invitation = (await call('ORG_A_RECRUITER', 'GET', '/me/invitations')).data.find((i) => i.org_id === org);
  if (invitation) await call('ORG_A_RECRUITER', 'POST', `/me/invitations/${invitation.id}/accept`);
}
step(`organization ${SLUG} with its owner and a recruiter`);

// 2. A published job with requirements, a required skill and an approved assessment.
let job = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/jobs`)).data.find((j) => j.slug === 'sales-data-analyst');
if (!job) {
  job = (await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs`, { slug: 'sales-data-analyst', title_ar: 'محلل بيانات المبيعات', title_en: 'Sales data analyst' })).data;
  const skill = (await (await fetch(`${env.API_URL}/v1/skills`)).json()).find((s) => s.slug === 'data-analysis');
  await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job.id}`, {
    description_ar: 'يحلل بيانات المبيعات الشهرية لمنشأة اصطناعية ويعدّ تقارير مختصرة للإدارة.',
    description_en: 'Analyses a synthetic company\'s monthly sales data and writes short reports for management.',
    sector: 'digital', employment_type: 'full_time', experience_level: 'mid', location: 'Riyadh',
    skills: skill ? [{ skill_id: skill.id, required_level: 3 }] : [],
  });
  for (const r of [
    { requirement_type: 'experience', description_ar: 'بناء لوحات معلومات المبيعات وتقارير SQL', description_en: 'Building sales dashboards and SQL reports', min_years: 2 },
    { requirement_type: 'responsibility', description_ar: 'إعداد تقرير شهري يشرح تغيّر المبيعات', description_en: 'Prepare a monthly report explaining changes in sales' },
    { requirement_type: 'competency', description_ar: 'عرض النتائج على الإدارة بوضوح', description_en: 'Presenting findings clearly to management' },
    { requirement_type: 'language', description_ar: 'العربية والإنجليزية', description_en: 'Arabic and English', is_mandatory: false },
  ]) await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs/${job.id}/requirements`, r);
  const version = (await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs/${job.id}/assessment/generate`, {})).data.version_id;
  await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job.id}/status`, { status: 'published' });
  const state = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/assessment-versions/${version}/changes`)).data;
  const approved = await call('ORG_A_OWNER', 'POST', `/organizations/${org}/assessment-versions/${version}/publish`, { reviewed_through: state.latest_change_id }, { allow: [422] });
  if (approved.status === 422) {
    console.log('\nThe generated draft did not meet the MIDAN Assessment Standard, so it was not approved (people approve; nothing is forced).');
    console.log('Open the job in the workspace and revise the draft, or run this script with the analysis service in demo mode, which uses MIDAN\'s templates.');
    process.exit(2);
  }
}
step(`published job "${job.title_en}" with requirements and an approved assessment`);

// 3. Two applicants with synthetic profiles complete the assessment.
const people = [
  { who: 'CANDIDATE_ONE', name: 'ريم (بيانات اصطناعية)', headline: 'محللة بيانات', experience: [{ title: 'محللة بيانات', organization: 'منشأة تجزئة اصطناعية', start_year: 2021, end_year: 2024, description: 'بنيت لوحات معلومات المبيعات الأسبوعية وكتبت تقارير SQL، وعرضت النتائج على الإدارة باللغتين.' }],
    answer: 'انخفضت المبيعات ١٢٪ في الشهر لأن المرتجعات تضاعفت من ٤٠ إلى ٨٠ طلبًا في فئة الأجهزة الصغيرة. أبدأ بمراجعة دفعة المورد لتلك الفئة، وأوقف العروض عليها مؤقتًا حتى يتأكد السبب، ثم أقارن النتائج بالشهر السابق وأرفع تقريرًا مختصرًا للإدارة يتضمن الجدول والأرقام.' },
  { who: 'CANDIDATE_TWO', name: 'سامي (بيانات اصطناعية)', headline: 'منسق مبيعات', experience: [{ title: 'منسق مبيعات', organization: 'منشأة اصطناعية', start_year: 2023, description: 'تابعت طلبات العملاء وجهزت جداول إكسل بسيطة.' }],
    answer: 'المبيعات قلت. أقترح نسوي عروض أكثر ونتابع الوضع الشهر الجاي.' },
];
const done = [];
for (const p of people) {
  await call(p.who, 'PUT', '/me/candidate-profile', { full_name: p.name, headline: p.headline, city: 'الرياض', experience: p.experience });
  const existing = (await call(p.who, 'GET', '/me/applications')).data.find((a) => a.jobs.id === job.id && a.status !== 'withdrawn');
  const appId = existing?.id ?? (await call(p.who, 'POST', `/jobs/${job.id}/applications`, {})).data.id;
  const application = (await call(p.who, 'GET', '/me/applications')).data.find((a) => a.id === appId);
  const attempt = application.assessment_attempts[0];
  if (attempt && ['invited', 'in_progress'].includes(attempt.status)) {
    const seen = (await call(p.who, 'GET', `/experience/${SLUG}/sales-data-analyst/1`)).data;
    if (attempt.status === 'invited') await call(p.who, 'POST', `/attempts/${attempt.id}/start`);
    for (const t of seen.version.assessment_tasks) {
      const answer = t.task_type === 'objective_questions'
        ? { choices: Object.fromEntries((t.config?.questions ?? []).map((q, i) => [q.id, q.options?.[p.who === 'CANDIDATE_ONE' ? 0 : Math.min(i + 1, (q.options?.length ?? 1) - 1)]?.id ?? 'a'])) }
        : { text: p.answer };
      await call(p.who, 'PUT', `/attempts/${attempt.id}/responses/${t.id}`, { answer });
    }
    await call(p.who, 'POST', `/attempts/${attempt.id}/submit`);
  }
  done.push({ ...p, appId, attemptId: attempt?.id });
}
step('two applicants applied and submitted their work');

// 4. The organization: evaluation reviewed and released by a person, the requirements match reviewed, then decisions.
for (const d of done.filter((x) => x.attemptId)) {
  let evaluation = (await call('ORG_A_OWNER', 'GET', `/attempts/${d.attemptId}/evaluation`, undefined, { allow: [404] })).data?.evaluation_results;
  if (!evaluation) evaluation = (await call('ORG_A_OWNER', 'POST', `/attempts/${d.attemptId}/evaluate`)).data;
  if (evaluation.status === 'needs_human_review') await call('ORG_A_OWNER', 'POST', `/evaluations/${evaluation.id}/review`, { scores: [], notes: 'Reviewed by a person (synthetic demo).' });
  await call('ORG_A_OWNER', 'POST', `/evaluations/${evaluation.id}/release`, undefined, { allow: [409, 422] });
  // The requirements match is computed when opened. Its proposals are left for the presenter to confirm or correct live:
  // a script confirming them would be a person's review that never happened.
  await call('ORG_A_OWNER', 'GET', `/organizations/${org}/applications/${d.appId}/match`);
}
step('evaluations reviewed and released; requirement matches ready for staff to review');
const [strong, weak] = done;
await call('ORG_A_OWNER', 'PATCH', `/applications/${strong.appId}/status`, { status: 'shortlisted' }, { allow: [422] });
if (args.has('--with-interview')) {
  const existing = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/applications/${strong.appId}/interviews`)).data;
  if (!existing.length) {
    const when = new Date(Date.now() + 2 * 86_400_000); when.setUTCHours(8, 0, 0, 0);
    const interview = (await call('ORG_A_OWNER', 'POST', `/organizations/${org}/applications/${strong.appId}/interviews`, { scheduled_at: when.toISOString(), duration_minutes: 45, instructions_ar: 'مقابلة اصطناعية للعرض.' })).data;
    step(`interview scheduled (calendar: ${interview.calendar_status})`);
  }
}
await call('ORG_A_OWNER', 'POST', `/organizations/${org}/applications/${weak.appId}/outcome`, { outcome: 'not_selected', message_ar: 'شكرًا لاهتمامكم. قررنا عدم المتابعة في هذه المرحلة (رسالة اصطناعية للعرض).' }, { allow: [409, 422] });
step('one applicant shortlisted, one with a recorded decision');
console.log(`\nShowcase ready: /organization/${org} (owner) and /applications (candidates). Logins: .local/demo/ACCOUNTS.md.`);
