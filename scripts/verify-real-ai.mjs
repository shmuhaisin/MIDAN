#!/usr/bin/env node
// Verifies the configured AI provider through the running local stack, with fictional data only:
//   0. CV analysis: the demo's fictional CV, uploaded by a test candidate, read with personal details kept local;
//   1. generation: a draft from a fictional job, its provenance, its quality report, and whether the quality gate lets it
//      be approved;
//   2. evaluation: a fictional candidate's written work on the demo job, scored by the model, with provenance and evidence,
//      then reviewed by a person.
// Usage, from the repository root, with the demo running (scripts/demo-up.sh) and the demo seeded:
//   node scripts/verify-real-ai.mjs                 all three, in order
//   node scripts/verify-real-ai.mjs cv evaluation   only those (each step uses part of the provider's per-minute allowance)
// Local stack only. It prints no secrets, and writes its report to .local/verify/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...parseEnv(readFileSync(resolve(root, '.env.test.local'), 'utf8')) };
for (const k of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'API_URL', 'AI_SERVICE_URL']) {
  if (!/^(http|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)(:\d+)?/.test(env[k] ?? '')) throw new Error(`${k} must point at the local stack`);
}
const RUN = Date.now().toString(36);
// The test application is removed from the local demo database (scripts/local-db.sh, its local superuser), so the demo stays as seeded and the check can run again.
const psql = `${process.env.PGBIN ?? '/opt/homebrew/opt/postgresql@16/bin'}/psql`;
const cleanup = () => execFileSync(psql, ['-q', '-v', 'ON_ERROR_STOP=1', 'postgresql://postgres:postgres@127.0.0.1:54322/midan', '-f', resolve(root, 'scripts/verify-cleanup.sql')]);
cleanup();
const report = { at: new Date().toISOString(), ai: null, cv: {}, generation: {}, evaluation: {} };
const steps = process.argv.slice(2);
const want = (step) => steps.length === 0 || steps.includes(step);

async function token(who) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${who}`);
  return (await res.json()).access_token;
}
async function call(who, method, path, body, ok = true) {
  const t0 = Date.now();
  const res = await fetch(`${env.API_URL}/v1${path}`, { method, headers: { authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (ok && !res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, data, ms: Date.now() - t0 };
}

report.ai = await (await fetch(`${env.AI_SERVICE_URL}/health`)).json();
console.log(`AI service: ${report.ai.mode}, ${report.ai.provider}, ${report.ai.model}`);
if (report.ai.mode !== 'live') throw new Error(`The AI service is in ${report.ai.mode} mode (missing: ${report.ai.missing_settings?.join(', ') || 'nothing'}). Nothing to verify.`);

// 0. CV analysis. The demo's fictional CV (written by scripts/demo-seed.mjs), as the first test candidate.
if (want('cv')) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(resolve(root, '.local/demo/fictional-cv.docx'))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'fictional-cv.docx');
  const t0 = Date.now();
  const upload = await fetch(`${env.API_URL}/v1/me/cv`, { method: 'POST', headers: { authorization: `Bearer ${await token('CANDIDATE_ONE')}` }, body: form });
  if (!upload.ok) throw new Error(`CV upload: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
  const id = (await upload.json()).analysis_id;
  let analysis;
  for (let i = 0; i < 120; i++) {
    analysis = (await call('CANDIDATE_ONE', 'GET', `/me/cv/analyses/${id}`)).data;
    if (analysis.status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const p = analysis.professional ?? {};
  report.cv = {
    seconds: Math.round((Date.now() - t0) / 1000), status: analysis.status, mode: analysis.mode,
    provider: analysis.provider, model_version: analysis.model_version,
    experience: p.experience?.length ?? 0, skills: p.skills, languages: p.languages, achievements: p.achievements?.length ?? 0,
    personal_kept_local: Object.keys(analysis.personal ?? {}),
  };
  console.log('CV analysis:', JSON.stringify(report.cv, null, 1));
}

if (want('generation')) {
// 1. Generation, on a fictional job in a test organization (removed by supabase/test-cleanup.sql).
const org = (await call('ORG_A_OWNER', 'POST', '/organizations', { slug: `midan-test-ai-${RUN}`, name_ar: 'تحقق خيالي', name_en: 'Fictional AI check' })).data.id;
const job = (await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs`, { slug: 'analyst', title_ar: 'محلل بيانات', title_en: 'Data analyst' })).data.id;
const skill = (await (await fetch(`${env.API_URL}/v1/skills`)).json()).find((s) => s.slug === 'data-analysis');
await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job}`, {
  description_ar: 'يحلل بيانات المبيعات الشهرية لمتجر خيالي ويعدّ تقريرًا موجزًا للإدارة.',
  description_en: 'Analyses a fictional store\'s monthly sales data and writes a short report for management.',
  skills: [{ skill_id: skill.id, required_level: 3 }],
});
await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs/${job}/requirements`, {
  requirement_type: 'responsibility', description_ar: 'تفسير تغيّر المبيعات الشهرية من البيانات', description_en: 'Explain the change in monthly sales from the data',
});
const generated = await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs/${job}/assessment/generate`, {});
const version = generated.data.version_id;
const view = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/jobs/${job}/assessment`)).data;
const quality = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/assessment-versions/${version}/quality`)).data;
const guide = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/assessment-versions/${version}/guide`)).data;
await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job}/status`, { status: 'published' });
const state = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/assessment-versions/${version}/changes`)).data;
const approval = await call('ORG_A_OWNER', 'POST', `/organizations/${org}/assessment-versions/${version}/publish`, { reviewed_through: state.latest_change_id }, false);
report.generation = {
  seconds: Math.round(generated.ms / 1000), mode: generated.data.mode, warnings: generated.data.warnings,
  run: view.run && { mode: view.run.mode, provider: view.run.provider, model_version: view.run.model_version, prompt_version: view.run.prompt_version },
  tasks: view.version.assessment_tasks.map((t) => ({ type: t.task_type, criteria: t.rubric_criteria.length, title_en: t.title_en })),
  guide: Boolean(guide.guide), quality: quality && { verdict: quality.verdict, score: quality.overall_score, standardized: quality.standardized, current: quality.current,
    errors: (quality.report?.errors ?? []).map((e) => e.code), revisions: (quality.report?.required_revisions ?? []).slice(0, 5) },
  approval: { status: approval.status, message: approval.data?.message },
};
console.log('Generation:', JSON.stringify(report.generation, null, 1).slice(0, 1500));
}

if (want('evaluation')) {

// 2. Evaluation, on the demo job's published assessment, by the second fictional candidate.
const demo = (await call('ORG_A_OWNER', 'GET', '/me')).data.organization_members.find((m) => m.organizations.name_en.startsWith('Oasis Digital'));
if (!demo) throw new Error('Seed the demo first: node scripts/demo-seed.mjs');
const demoJobs = (await call('ORG_A_OWNER', 'GET', `/organizations/${demo.org_id}/jobs`)).data;
const demoJob = demoJobs.find((j) => j.slug === 'data-analyst');
if (!(await call('CANDIDATE_ONE', 'GET', '/me')).data.candidate_profiles) await call('CANDIDATE_ONE', 'PUT', '/me/candidate-profile', { full_name: 'Test Candidate One' });
const application = (await call('CANDIDATE_ONE', 'POST', `/jobs/${demoJob.id}/applications`, {})).data.id;
const attempt = (await call('CANDIDATE_ONE', 'GET', '/me/applications')).data.find((a) => a.id === application).assessment_attempts[0].id;
const seen = (await call('CANDIDATE_ONE', 'GET', '/experience/midan-demo-oasis/data-analyst/1')).data;
await call('CANDIDATE_ONE', 'POST', `/attempts/${attempt}/start`);
for (const t of seen.version.assessment_tasks) {
  const answer = t.task_type === 'objective_questions'
    ? { choices: Object.fromEntries((t.config?.questions ?? []).map((q) => [q.id, q.options?.[0]?.id ?? 'a'])) }
    : { text: 'المبيعات انخفضت 12% في الشهر الخيالي لأن المرتجعات تضاعفت من 40 إلى 80 طلبًا في فئة واحدة. سأراجع دفعة المورد لتلك الفئة أولًا، وأوقف العروض عليها حتى يتأكد السبب، ثم أقارن النتائج بالشهر السابق.' };
  await call('CANDIDATE_ONE', 'PUT', `/attempts/${attempt}/responses/${t.id}`, { answer });
}
await call('CANDIDATE_ONE', 'POST', `/attempts/${attempt}/submit`);
const evaluated = await call('ORG_A_OWNER', 'POST', `/attempts/${attempt}/evaluate`);
const full = (await call('ORG_A_OWNER', 'GET', `/attempts/${attempt}/evaluation`)).data;
const scores = full.evaluation_results.criterion_scores;
const reviewed = await call('ORG_A_OWNER', 'POST', `/evaluations/${evaluated.data.id}/review`, { scores: [], notes: 'Checked by a person (fictional verification).' });
report.evaluation = {
  seconds: Math.round(evaluated.ms / 1000), ai_mode: full.evaluation_results.ai_mode, status_before_review: full.evaluation_results.status,
  status_after_review: reviewed.data.status, review_reasons: full.evaluation_results.review_reasons,
  scores: scores.map((s) => ({ source: s.source, score: s.score, provider: s.provider, model_version: s.model_version, prompt_version: s.prompt_version,
    confidence: s.confidence, has_evidence: Boolean(s.evidence_ref), explanation: (s.explanation ?? '').slice(0, 160) })),
};
console.log('Evaluation:', JSON.stringify(report.evaluation, null, 1).slice(0, 2500));
}

// The second candidate's demo application is withdrawn, so the demo stays as seeded for the main candidate.
cleanup();
mkdirSync(resolve(root, '.local/verify'), { recursive: true });
const file = resolve(root, `.local/verify/ai-${RUN}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`Report: ${file}`);
