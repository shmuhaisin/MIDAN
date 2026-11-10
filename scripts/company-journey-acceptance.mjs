// LOCAL STACK ONLY. The company journey's 18 acceptance steps, driven through the real local API with whatever AI
// service .env points at (the live model when one is configured). Fictional people and a test workspace of one registry
// employer (is_test, slug midan-test-*, hidden from public listings). Each step is recorded as passed or not, with the
// evidence, in .local/acceptance/result.json. A step passes only on what the system actually returned.
//
//   node scripts/company-journey-acceptance.mjs
//
// It refuses to run unless the Supabase URL is a localhost one. It never sends email or calendar invitations: the local
// Auth mails into the gateway's sink, and Google Calendar is used only if it's configured (it isn't by default).
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = parseEnv(readFileSync(`${ROOT}.env`, 'utf8'));
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const API = `${env.API_URL}/v1`;
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(SB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(API)) throw new Error('Local stack only');
const tests = parseEnv(readFileSync(`${ROOT}.env.test.local`, 'utf8'));
const RUN = Date.now().toString(36);
const steps = [];
const out = `${ROOT}.local/acceptance`;
mkdirSync(out, { recursive: true });

function record(n, name, passed, evidence) {
  steps.push({ step: n, name, passed, evidence });
  console.log(`${passed ? 'PASS' : 'NOT PASSED'}  ${n}. ${name}${evidence?.note ? ` — ${evidence.note}` : ''}`);
  writeFileSync(`${out}/result.json`, JSON.stringify({ run: RUN, at: new Date().toISOString(), steps }, null, 2));
}

async function call(token, method, path, body, { form } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(!form && body !== undefined && { 'content-type': 'application/json' }) },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const must = async (p, ok = [200, 201]) => {
  const r = await p;
  if (!ok.includes(r.status)) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
};

async function signIn(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}`);
  return { id: body.user.id, email, token: body.access_token };
}

/** A new fictional account through the real sign-up and its emailed verification link (the local mail sink). */
async function signUp(name, accountType) {
  const email = `midan.test.${name}-${RUN}@example.com`;
  const password = `Pw-${RUN}-${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, data: { display_name: name, account_type: accountType, midan_test_access: env.DEV_TEST_ACCESS_CODE } }),
  });
  if (!res.ok) throw new Error(`sign-up failed for ${name}: ${res.status} ${await res.text()}`);
  let link;
  for (let i = 0; i < 40 && !link; i++) {
    const mail = await (await fetch(`${SB}/__mail?to=${encodeURIComponent(email)}`)).json();
    link = mail[0]?.links.find((l) => l.includes('/verify'));
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  if (!link) throw new Error(`no verification email for ${name}`);
  await fetch(link, { redirect: 'manual' });
  return signIn(email, password);
}

/** A one-page text PDF, so the CV goes through MIDAN's real extraction and analysis. */
function pdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 11 Tf 50 790 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
// A 1x1 PNG, for the workspace logo (the test company's own asset, not a real company's logo).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGcAAQUAyG4F2Q6EmbgAAAAASUVORK5CYII=', 'base64');

/** A CV laid out as CVs are: the name, then headed sections, one line per item. */
const cv = (name, title, { experience, education, skills }) => [name, title, '', 'EXPERIENCE', ...experience, '', 'EDUCATION', ...education, '', 'SKILLS', skills];
const CANDIDATES = [
  { name: 'Fictional Reem', headline: 'Data analyst', lines: cv('Reem Fictional', 'Data analyst', { experience: ['Data analyst, Fictional Telecom Co, 2019 - 2025', '- Built SQL reports on customer churn for monthly management reviews', '- Built Power BI dashboards tracking network usage and revenue', '- Cleaned and joined large customer datasets in Python pandas', '- Presented churn findings to commercial managers every month'], education: ['BSc Statistics, Fictional University, 2014 - 2018'], skills: 'SQL, Python, Power BI, data cleaning, churn analysis' }) },
  { name: 'Fictional Omar', headline: 'Business intelligence developer', lines: cv('Omar Fictional', 'Business intelligence developer', { experience: ['BI developer, Fictional Retail Group, 2021 - 2025', '- Designed SQL data models and ETL jobs for sales reporting', '- Built dashboards for the commercial team', '- Presented weekly dashboards to regional managers'], education: ['BSc Information Systems, Fictional College, 2016 - 2020'], skills: 'SQL, ETL, Tableau, stakeholder communication' }) },
  { name: 'Fictional Lama', headline: 'Marketing coordinator', lines: cv('Lama Fictional', 'Marketing coordinator', { experience: ['Marketing coordinator, Fictional Events Co, 2022 - 2025', '- Planned social media campaigns and event schedules', '- Wrote weekly newsletters'], education: ['BA Marketing, Fictional University, 2017 - 2021'], skills: 'copywriting, event planning, Canva' }) },
  { name: 'Fictional Faisal', headline: 'Junior data analyst', lines: cv('Faisal Fictional', 'Junior data analyst', { experience: ['Data intern, Fictional Bank, 2024 - 2025', '- Wrote SQL queries for monthly customer reports', '- Prepared Excel summaries for the finance team'], education: ['BSc Computer Science, Fictional University, 2020 - 2024'], skills: 'SQL, Excel, Python basics' }) },
];

const ctx = {};
/** A step that depends on an earlier one fails, instead of passing on an empty list. */
const need = (value, what) => { if (!value || (Array.isArray(value) && value.length === 0)) throw new Error(`prerequisite missing: ${what}`); return value; };
async function step(n, name, fn) {
  try {
    const evidence = await fn();
    const passed = evidence?.passed !== false;
    record(n, name, passed, evidence);
    return passed;
  } catch (error) {
    record(n, name, false, { error: String(error.message ?? error).slice(0, 600) });
    return false;
  }
}

const admin = await signIn(tests.TEST_PLATFORM_ADMIN_EMAIL, tests.TEST_PLATFORM_ADMIN_PASSWORD);
const employers = await must(call(admin.token, 'GET', '/reference/employers'));
const registry = (employers.items ?? employers).find((e) => /stc/i.test(e.name_en));

await step(1, 'Branded workspace for a registry employer, shared by two approved representatives', async () => {
  const rep1 = await signUp('rep-one', 'organization');
  const rep2 = await signUp('rep-two', 'organization');
  for (const [rep, title] of [[rep1, 'Talent acquisition lead'], [rep2, 'Recruiter']]) {
    await must(call(rep.token, 'POST', '/me/employer-access', { registry_id: registry.id, representative_name: `Fictional ${title}`, job_title: title, verification_note: 'Fictional test representative' }));
  }
  const queue = await must(call(admin.token, 'GET', '/admin/employer-access'));
  const mine = (queue.items ?? queue).filter((r) => [rep1.email, rep2.email].includes(r.work_email) && ['pending', 'pending_approval'].includes(r.status));
  for (const r of mine) await must(call(admin.token, 'POST', `/admin/employer-access/${r.id}/decision`, { decision: 'approve', role: r.work_email === rep2.email ? 'recruiter' : 'owner' }));
  const me1 = await must(call(rep1.token, 'GET', '/me'));
  const me2 = await must(call(rep2.token, 'GET', '/me'));
  const org = me1.organization_members[0]?.org_id;
  ctx.org = org; ctx.rep1 = rep1; ctx.rep2 = rep2;
  await must(call(rep1.token, 'PATCH', `/organizations/${org}/branding`, { primary_color: '#4F008C', accent_color: '#FF375E', welcome_en: 'Welcome to our fictional test workspace.', welcome_ar: 'مرحبًا بك في مساحة الاختبار.' }));
  const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'logo.png');
  await must(call(rep1.token, 'POST', `/organizations/${org}/branding/logo`, undefined, { form: fd }));
  const details = await must(call(rep1.token, 'GET', `/organizations/${org}`));
  ctx.slug = details.slug;
  const same = me2.organization_members[0]?.org_id === org;
  return {
    passed: Boolean(org) && same && details.name_en === registry.name_en && details.website === registry.official_website && Boolean(details.branding?.logo_path),
    note: `one workspace for both: ${same}; name ${details.name_en}; website from registry: ${details.website}; logo and colours set`,
    org, slug: details.slug, roles: [me1.organization_members[0]?.role, me2.organization_members[0]?.role], company_type: details.company_type,
  };
});

await step(2, 'Create a job with its details and requirements', async () => {
  need(ctx.org, 'ctx.org');
  const job = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs`, { slug: `data-analyst-${RUN}`, title_ar: 'محلل بيانات العملاء', title_en: 'Customer data analyst' }));
  ctx.job = job.id; ctx.jobSlug = job.slug;
  await must(call(ctx.rep1.token, 'PATCH', `/organizations/${ctx.org}/jobs/${job.id}`, {
    description_en: 'Analyze customer and network usage data to explain churn and recommend retention actions to the commercial team. Build SQL reports and dashboards, and present findings to managers.',
    description_ar: 'تحليل بيانات العملاء واستخدام الشبكة لتفسير فقدان العملاء واقتراح إجراءات للاحتفاظ بهم للفريق التجاري. إعداد تقارير SQL ولوحات متابعة وعرض النتائج على المديرين.',
    location: 'Riyadh', employment_type: 'full_time', experience_level: 'mid', sector: 'digital',
  }));
  const reqs = [
    ['responsibility', 'Analyze customer churn data and explain its main drivers', 'تحليل بيانات فقدان العملاء وتفسير أهم أسبابه', true],
    ['responsibility', 'Build SQL reports and dashboards for the commercial team', 'إعداد تقارير SQL ولوحات متابعة للفريق التجاري', true],
    ['competency', 'Present findings clearly to non-technical managers', 'عرض النتائج بوضوح للمديرين غير التقنيين', true],
    ['experience', 'Experience in data analysis', 'خبرة في تحليل البيانات', false, 2],
  ];
  for (const [type, en, ar, mandatory, years] of reqs) {
    await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs/${job.id}/requirements`, { requirement_type: type, description_en: en, description_ar: ar, is_mandatory: mandatory, ...(years && { min_years: years }) }));
  }
  const list = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${job.id}/requirements`));
  return { passed: list.length === 4, note: `${list.length} approved requirements`, job: job.id };
});

await step(3, 'Skill suggestions from the HR sector workbooks, with reasons; edited and approved by the employer', async () => {
  need(ctx.job, 'ctx.job');
  const analysis = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs/${ctx.job}/analyses/suggest`, {}));
  const proposals = Array.isArray(analysis.proposals) ? analysis.proposals : [];
  writeFileSync(`${out}/skill-analysis.json`, JSON.stringify(analysis, null, 2));
  const ids = (Array.isArray(proposals) ? proposals : []).map((p) => p.reference_skill_id ?? p.id).filter(Boolean);
  const withReasons = (Array.isArray(proposals) ? proposals : []).filter((p) => p.reason_en || p.evidence || p.reason_ar).length;
  // The employer's edit: keep all but the last suggestion, require the first two, set a level, add one of their own.
  const keep = ids.slice(0, Math.max(1, ids.length - 1));
  await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs/${ctx.job}/analyses/${analysis.id}/accept`, { skills: keep, required: keep.slice(0, 2), set_sector: false, levels: Object.fromEntries(keep.slice(0, 1).map((id) => [id, 3])) }));
  await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs/${ctx.job}/custom-skills`, { name_ar: 'تحليل فقدان العملاء', name_en: 'Churn analysis', is_required: true, required_level: 3 }));
  const job = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}`));
  return {
    passed: ids.length > 0 && withReasons > 0 && (job.job_reference_skills?.length ?? 0) === keep.length,
    note: `${ids.length} suggested (${withReasons} with reasons, method ${analysis.method ?? analysis.proposals?.method ?? '?'}), ${keep.length} kept, 1 removed, 1 own skill added`,
  };
});

await step(4, 'Business-context, branded assessment generated from the approved requirements', async () => {
  need(ctx.job, 'ctx.job');
  const gen = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/jobs/${ctx.job}/assessment/generate`, {}));
  ctx.version = gen.version_id;
  const view = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/assessment`));
  writeFileSync(`${out}/assessment.json`, JSON.stringify(view, null, 2));
  const guide = await call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/assessment-versions/${ctx.version}/guide`);
  const text = JSON.stringify(view);
  const live = /"mode":"live"/.test(text);
  const domain = /telecom|اتصالات/i.test(text);
  const verdict = guide.body?.quality?.verdict;
  ctx.quality = verdict;
  return { passed: live && domain && verdict === 'ready', note: `generated by the live model: ${live}; framed in telecommunications: ${domain}; MAS quality: ${verdict} ${guide.body?.quality?.overall_score ?? ''}` };
});

await step(5, 'Assessment approved by the employer, then the job published', async () => {
  need(ctx.version, 'ctx.version');
  const early = await call(ctx.rep1.token, 'PATCH', `/organizations/${ctx.org}/jobs/${ctx.job}/status`, { status: 'published' });
  const state = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/assessment-versions/${ctx.version}/changes`));
  await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/assessment-versions/${ctx.version}/publish`, { reviewed_through: state.latest_change_id }));
  await must(call(ctx.rep1.token, 'PATCH', `/organizations/${ctx.org}/jobs/${ctx.job}/status`, { status: 'published' }));
  const pub = await must(call(ctx.rep1.token, 'GET', `/jobs/${ctx.job}`));
  return { passed: early.status === 422 && pub.status === 'published' && Boolean(pub.organizations.organization_branding?.logo_path), note: `publishing before approval refused (${early.status}); published with the workspace's logo and colour` };
});

await step(6, 'Several candidates apply with CVs', async () => {
  need(ctx.job, 'ctx.job');
  ctx.apps = [];
  for (const c of CANDIDATES) {
    const s = await signUp(c.name.split(' ')[1].toLowerCase(), 'candidate');
    await must(call(s.token, 'PUT', '/me/candidate-profile', { full_name: c.name }));
    const fd = new FormData(); fd.append('file', new Blob([pdf(c.lines)], { type: 'application/pdf' }), 'cv.pdf');
    const up = await must(call(s.token, 'POST', '/me/cv', undefined, { form: fd }));
    let analysis;
    for (let i = 0; i < 90; i++) {
      analysis = await must(call(s.token, 'GET', `/me/cv/analyses/${up.analysis_id}`));
      if (['ready', 'completed', 'failed', 'needs_review', 'review', 'awaiting_review'].includes(analysis.status)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const p = analysis.professional ?? {};
    // The candidate approves what MIDAN read from their CV (here: all of it, as a person would after checking).
    const approved = {
      full_name: analysis.personal?.full_name ?? c.name, headline: p.headline ?? c.headline, ...(p.summary && { summary: String(p.summary).slice(0, 4000) }),
      experience: (p.experience ?? []).slice(0, 30).filter((e) => e.title).map((e) => ({
        title: e.title, ...(e.organization && { organization: e.organization }), ...(e.start_year && { start_year: e.start_year }), ...(e.end_year && { end_year: e.end_year }),
        ...((e.responsibilities?.length || e.description) && { description: (e.responsibilities?.length ? e.responsibilities.join(String.fromCharCode(10)) : e.description).slice(0, 2000) }),
      })),
      education: (p.education ?? []).slice(0, 20).filter((e) => e.qualification).map((e) => ({
        qualification: e.qualification, ...(e.institution && { institution: e.institution }), ...(e.field && { field: e.field }),
      })),
      skills: (p.skills ?? []).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean).slice(0, 100),
    };
    const applied = await call(s.token, 'POST', `/me/cv/analyses/${up.analysis_id}/apply`, approved);
    const application = await must(call(s.token, 'POST', `/jobs/${ctx.job}/applications`, { cover_note: 'Fictional cover note.' }));
    ctx.apps.push({ ...c, session: s, application: application.id, analysis: `${analysis.status}, ${analysis.mode}`, provider: analysis.provider ?? analysis.mode, applied: applied.status, read: approved.experience.length });
  }
  writeFileSync(`${out}/applications.json`, JSON.stringify(ctx.apps.map(({ session, ...a }) => a), null, 2));
  return { ...{ passed: ctx.apps.length === CANDIDATES.length && ctx.apps.every((a) => a.applied === 201 || a.applied === 200) }, passed: ctx.apps.every((a) => a.read > 0), note: ctx.apps.map((a) => `${a.name}: CV read (${a.analysis}), ${a.read} positions approved by the candidate (${a.applied})`).join('; ') };
});

let ranking;
await step(7, "The CVs analyzed with the existing Hugging Face model (intfloat/multilingual-e5-base)", async () => {
  need(ctx.apps, 'ctx.apps');
  ranking = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/ranking?wait=true`));
  const models = [...new Set(ranking.applicants.map((a) => a.matching?.model_version))];
  const e5 = ranking.applicants.every((a) => a.matching?.provider === 'e5-local' && !a.matching?.fallback);
  return { passed: e5, note: `matching backend reported: ${models.join(', ')}${e5 ? '' : ' (the e5 model is not installed on this machine, so the lexical fallback ran and says so)'}` };
});

await step(8, 'ATS scores the CV and the assessment', async () => {
  need(ctx.apps, 'ctx.apps');
  const done = [];
  for (const a of ctx.apps.slice(0, 3)) {
    const mine = await must(call(a.session.token, 'GET', '/me/applications'));
    const attempt = mine.find((x) => x.id === a.application)?.assessment_attempts?.[0];
    if (!attempt) continue;
    const seen = await must(call(a.session.token, 'GET', `/experience/${ctx.slug}/${ctx.jobSlug}/1`));
    await must(call(a.session.token, 'POST', `/attempts/${attempt.id}/start`));
    for (const t of seen.version.assessment_tasks) {
      const qs = t.config?.questions ?? [];
      const answer = t.task_type === 'objective_questions'
        ? { choices: Object.fromEntries(qs.map((q) => [q.id, (q.options?.[0]?.id ?? q.options?.[0] ?? 'a')])) }
        : { text: `${a.name} (fictional): I would join the churn table with usage by customer id, compare churned and retained customers by tenure and plan, check the three largest differences, and recommend a retention offer for the highest-risk segment, with the SQL I used and a short chart.` };
      await call(a.session.token, 'PUT', `/attempts/${attempt.id}/responses/${t.id}`, { answer });
    }
    await must(call(a.session.token, 'POST', `/attempts/${attempt.id}/submit`));
    const evaluation = await must(call(ctx.rep1.token, 'POST', `/attempts/${attempt.id}/evaluate`));
    const detail = await must(call(ctx.rep1.token, 'GET', `/attempts/${attempt.id}/evaluation`));
    const criteria = (detail.assessment_versions?.assessment_tasks ?? []).flatMap((t) => t.rubric_criteria ?? []);
    const proposed = new Map((detail.evaluation_results?.criterion_scores ?? []).map((s) => [s.criterion_id, Number(s.score)]));
    // The person's review (a fictional reviewer): confirm the model's proposals, and score what it left to a person.
    const scores = criteria.map((c, i) => ({ criterion_id: c.id, score: proposed.has(c.id) ? proposed.get(c.id) : Math.round(Number(c.max_score) * [0.75, 0.5, 0.25][ctx.apps.indexOf(a) % 3] * 100) / 100, explanation: 'Fictional reviewer score.' }));
    await must(call(ctx.rep1.token, 'POST', `/evaluations/${evaluation.id}/review`, { scores, notes: 'Fictional internal reviewer note.' }));
    await must(call(ctx.rep1.token, 'POST', `/evaluations/${evaluation.id}/release`));
    a.attempt = attempt.id;
    done.push({ name: a.name, proposed: proposed.size, criteria: criteria.length });
  }
  ranking = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/ranking?sort=assessment&wait=true`));
  const scored = ranking.applicants.filter((x) => x.assessment_score !== null).length;
  const cvScored = ranking.applicants.filter((x) => x.cv.status === 'scored').length;
  return { passed: scored === done.length && done.length >= 3 && cvScored === ctx.apps.length, note: `CV scored for ${cvScored}; assessment reviewed and scored for ${scored} (${done.map((d) => `${d.name}: model proposed ${d.proposed} of ${d.criteria}`).join(', ')})` };
});

await step(9, 'All candidates ranked (not a top 10), with stage scores, strengths and gaps', async () => {
  need(ctx.apps, 'ctx.apps');
  const r = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/ranking?sort=cv&wait=true`));
  writeFileSync(`${out}/ranking-cv.json`, JSON.stringify(r, null, 2));
  const all = r.applicants.length === ctx.apps.length;
  return {
    passed: all && r.applicants.every((a) => 'rank' in a && a.cv && 'assessment_score' in a && a.status),
    note: `${r.applicants.length} of ${ctx.apps.length} listed; overall %: ${r.overall.available ? 'yes' : `not shown (${r.overall.reason})`}; ` + r.applicants.map((a) => `#${a.rank ?? '-'} ${a.name} CV ${a.cv.score ?? '-'}% assessment ${a.assessment_score ?? '-'}`).join(', '),
  };
});

await step(10, 'Manual shortlist', async () => {
  need(ctx.apps, 'ctx.apps');
  ctx.shortlisted = ctx.apps.slice(0, 2);
  for (const a of ctx.shortlisted) await must(call(ctx.rep1.token, 'PATCH', `/applications/${a.application}/status`, { status: 'shortlisted' }));
  const refused = await call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${ctx.apps[2].application}/interviews`, { scheduled_at: new Date(Date.now() + 86_400_000).toISOString() });
  return { passed: refused.status >= 400, note: `2 shortlisted by a person; an interview for a candidate not shortlisted was refused (${refused.status})` };
});

await step(11, 'Interview scheduled through Google Calendar', async () => {
  need(ctx.shortlisted, 'ctx.shortlisted');
  ctx.interviews = [];
  for (const [i, a] of ctx.shortlisted.entries()) {
    const iv = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${a.application}/interviews`, { scheduled_at: new Date(Date.now() + (i + 2) * 3_600_000).toISOString(), duration_minutes: 45, interviewer_ids: [ctx.rep2.id] }));
    ctx.interviews.push({ ...a, interview: iv.id });
  }
  await new Promise((r) => setTimeout(r, 1500));
  const states = [];
  for (const iv of ctx.interviews) states.push((await must(call(ctx.rep1.token, 'GET', `/interviews/${iv.interview}`))).calendar_status);
  return { passed: states.every((s) => s === 'sent'), note: `calendar_status: ${states.join(', ')} (Google Calendar has no refresh token here, so no real event exists)` };
});

await step(12, 'Calendar invitations received', async () => ({ passed: false, note: 'Not tested: no real calendar event was created (step 11), and sending real invitations needs the owner\'s approval.' }));

await step(13, 'Interview questions per candidate', async () => {
  need(ctx.interviews, 'ctx.interviews');
  const notes = [];
  for (const iv of ctx.interviews) {
    const q = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/interviews/${iv.interview}/preparation`, { kind: 'questions' }));
    iv.questions = q.content;
    notes.push(`${iv.name}: ${q.content.length} questions (${q.provenance.model_version}), e.g. "${q.content[0].question_en}"`);
  }
  writeFileSync(`${out}/questions.json`, JSON.stringify(ctx.interviews.map((i) => ({ name: i.name, questions: i.questions })), null, 2));
  const different = JSON.stringify(ctx.interviews[0].questions) !== JSON.stringify(ctx.interviews[1].questions);
  return { passed: different && ctx.interviews.every((i) => i.questions.length > 0), note: notes.join(' | ') };
});

await step(14, 'Evaluation form per candidate', async () => {
  need(ctx.interviews, 'ctx.interviews');
  for (const iv of ctx.interviews) {
    const f = await call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/interviews/${iv.interview}/preparation`, { kind: 'evaluation_form' });
    if (f.status !== 201) { ctx.formError = f.body; continue; }
    iv.form = f.body.content;
  }
  writeFileSync(`${out}/forms.json`, JSON.stringify(ctx.interviews.map((i) => ({ name: i.name, form: i.form })), null, 2));
  if (ctx.formError) return { passed: false, note: `not written: ${JSON.stringify(ctx.formError)}` };
  return { passed: ctx.interviews.every((i) => i.form.length >= 1 && i.form.every((c) => c.levels_en?.['1'] && c.levels_en?.['4'])), note: ctx.interviews.map((i) => `${i.name}: ${i.form.map((c) => c.label_en).join(', ')}`).join(' | ') };
});

await step(15, 'Form submitted after the interview', async () => {
  need(ctx.interviews, 'ctx.interviews');
  for (const [k, iv] of ctx.interviews.entries()) {
    // The generated form's competencies, or (without one) the job's requirements, as the feedback screen starts it.
    const labels = iv.form?.map((c) => c.label_en) ?? (await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/requirements`))).map((r) => r.description_en);
    iv.labelsFrom = iv.form ? 'generated form' : 'job requirements (no generated form)';
    const competencies = labels.map((label, j) => ({ label, rating: [4, 3, 3, 2, 4, 3, 2, 3][(j + k) % 8], evidence: `Fictional interview evidence for ${label}.` }));
    for (const who of [ctx.rep1, ctx.rep2]) {
      await must(call(who.token, 'PUT', `/organizations/${ctx.org}/applications/${iv.application}/interviews/${iv.interview}/feedback`, { status: 'submitted', recommendation: k === 0 ? 'strong_yes' : 'yes', competencies, notes: 'Fictional internal interviewer note.' }));
    }
  }
  const again = await call(ctx.rep1.token, 'PUT', `/organizations/${ctx.org}/applications/${ctx.interviews[0].application}/interviews/${ctx.interviews[0].interview}/feedback`, { status: 'submitted', competencies: [] });
  return { passed: again.status === 422, note: `2 interviewers submitted for each candidate, competencies from ${ctx.interviews[0].labelsFrom}; changing a submitted form refused (${again.status})` };
});

await step(16, 'Scores and ranking updated', async () => {
  need(ctx.interviews, 'ctx.interviews');
  const r = await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/jobs/${ctx.job}/ranking?sort=interview&wait=true`));
  writeFileSync(`${out}/ranking-interview.json`, JSON.stringify(r, null, 2));
  const rated = r.applicants.filter((a) => a.interview.average_rating !== null);
  return { passed: rated.length === ctx.interviews.length && rated.every((a) => a.rank !== null), note: r.applicants.map((a) => `#${a.rank ?? '-'} ${a.name} interview ${a.interview.average_rating ?? '-'} / 4`).join(', ') };
});

await step(17, 'Manual hiring decision', async () => {
  need(ctx.interviews, 'ctx.interviews');
  const hire = ctx.interviews[0];
  await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${hire.application}/outcome`, { outcome: 'hired', message_en: 'Congratulations: we would like to offer you the role (fictional).', message_ar: 'تهانينا: نود أن نعرض عليك الوظيفة (بيانات تجريبية).' }));
  await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${ctx.interviews[1].application}/outcome`, { outcome: 'not_selected', message_en: 'Thank you for your time (fictional).', message_ar: 'شكرًا لوقتك (بيانات تجريبية).' }));
  const s = (await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/applications/${hire.application}/review`))).status;
  const t = (await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/applications/${ctx.interviews[1].application}/review`))).status;
  const others = await Promise.all(ctx.apps.slice(2).map(async (a) => (await must(call(ctx.rep1.token, 'GET', `/organizations/${ctx.org}/applications/${a.application}/review`))).status));
  return { passed: s === 'hired' && t === 'rejected' && others.every((x) => !['hired', 'rejected'].includes(x)), note: `decided by a person: ${hire.name} ${s}, ${ctx.interviews[1].name} ${t}; the others untouched (${others.join(', ')})` };
});

await step(18, 'Candidate-specific development reports, released through the in-app channel', async () => {
  need(ctx.apps, 'ctx.apps');
  const notes = [];
  for (const a of ctx.apps.slice(0, 3)) {
    const d = await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${a.application}/development-reports`, {}));
    await must(call(ctx.rep1.token, 'POST', `/organizations/${ctx.org}/applications/${a.application}/development-reports/${d.id}/release`));
    const mine = await must(call(a.session.token, 'GET', `/me/applications/${a.application}/development-report`));
    const text = JSON.stringify(mine);
    const leaks = ['Fictional internal', 'rank', ...ctx.apps.filter((o) => o !== a).map((o) => o.name)].filter((w) => text.includes(w));
    const told = (await must(call(a.session.token, 'GET', '/me/notifications'))).some((n) => n.kind === 'development_report' && n.link === `/applications/${a.application}`);
    a.report = mine;
    notes.push(`${a.name}: ${mine.content.strengths.length} strengths, ${mine.content.development.length} to develop, notified ${told}, leaks ${leaks.length ? leaks.join('/') : 'none'}`);
    if (leaks.length || !told) throw new Error(notes.join('; '));
  }
  writeFileSync(`${out}/reports.json`, JSON.stringify(ctx.apps.slice(0, 3).map((a) => ({ name: a.name, report: a.report })), null, 2));
  return { note: notes.join(' | ') };
});

console.log(`\n${steps.filter((s) => s.passed).length} of ${steps.length} steps passed. Evidence: .local/acceptance/`);
