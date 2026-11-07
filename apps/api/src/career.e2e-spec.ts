// Career intelligence through the real stack: target job titles in the candidate's own words, what similar published
// jobs ask for, practice tasks that are never employment, and CV languages and achievements reaching the profile only
// when approved. Fictional data, local only.
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

loadEnv('.env', '.env.test.local');

const { Client } = createRequire(__filename)('pg') as typeof import('pg');
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const RUN = Date.now().toString(36);
type Session = { id: string; email: string; token: string };

async function signIn(name: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`TEST_${name}_EMAIL`], password: process.env[`TEST_${name}_PASSWORD`] }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string; email: string } };
  if (!res.ok) throw new Error(`Sign-in failed for ${name}`);
  return { id: body.user.id, email: body.user.email, token: body.access_token };
}

async function rest(who: Session | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, authorization: `Bearer ${who?.token ?? KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('career intelligence', () => {
  let app: INestApplication;
  let owner: Session, candidate: Session, other: Session;
  let org: string, job: string, skill: { id: string; name_en: string }, workbookSkill: { id: string; name_ar: string };
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, candidate, other] = await Promise.all(['ORG_B_OWNER', 'CANDIDATE_TWO', 'CANDIDATE_ONE'].map(signIn));
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-career-${RUN}`, name_ar: 'جهة', name_en: 'Career org' }).expect(201)).body.id;
    job = (await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ slug: 'analyst', title_ar: `محلل بيانات ${RUN}`, title_en: `Data analyst ${RUN}`, status: 'published' }).expect(201)).body.id;
    skill = ((await api().get('/skills').expect(200)).body as { id: string; slug: string; name_en: string }[]).find((s) => s.slug === 'data-analysis')!;
    await api().patch(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).send({ skills: [{ skill_id: skill.id, required_level: 3 }] }).expect(200);
    [workbookSkill] = (await (await fetch(`${BASE}/rest/v1/reference_skills?sector_code=eq.digital&skill_kind=eq.technical&limit=1&select=id,name_ar`, { headers: { apikey: KEY } })).json()) as { id: string; name_ar: string }[];
  });
  afterAll(() => app.close());

  it('takes a target job title in the candidate\'s own words, and shows it as theirs', async () => {
    await api().put('/me/career/target').set(bearer(candidate)).send({}).expect(422);
    await api().put('/me/career/target').set(bearer(candidate)).send({ job_title: 'x' }).expect(400);
    await api().put('/me/career/target').set(bearer(candidate)).send({ sector_code: 'digital' }).expect(422);
    await api().put('/me/career/target').set(bearer(candidate)).send({ sector_code: 'digital', job_family_ar: 'أسرة غير موجودة' }).expect(422);
    const saved = (await api().put('/me/career/target').set(bearer(candidate)).send({ job_title: `  Data analyst ${RUN} ` }).expect(200)).body;
    expect(saved).toMatchObject({ job_title: `Data analyst ${RUN}`, sector_code: null, job_family_ar: null });

    const career = (await api().get('/me/career').set(bearer(candidate)).expect(200)).body;
    expect(career.target.job_title).toBe(`Data analyst ${RUN}`);
    // Skills come from the published job with that title, counted, with the candidate's evidence. Nothing is invented.
    expect(career.title_jobs).toBe(1);
    expect(career.title_skills).toEqual([expect.objectContaining({ id: skill.id, source: 'skill', jobs: 1 })]);
    expect(['self_reported', 'no_evidence', 'assessed']).toContain(career.title_skills[0].evidence);
    expect(career.role_skills).toEqual([]);

    const families = (await api().get('/reference/job-families?sector=digital').expect(200)).body as { sector_code: string; job_family_ar: string }[];
    const { sector_code, job_family_ar } = families[0];
    const both = (await api().put('/me/career/target').set(bearer(candidate)).send({ job_title: `Data analyst ${RUN}`, sector_code, job_family_ar }).expect(200)).body;
    expect(both).toMatchObject({ job_title: `Data analyst ${RUN}`, job_family_ar: families[0].job_family_ar });
    expect((await api().get('/me/career').set(bearer(candidate)).expect(200)).body.role_skills.length).toBeGreaterThan(0);

    const suggestions = (await api().get(`/reference/job-titles?q=${encodeURIComponent(families[0].job_family_ar.slice(0, 4))}`).expect(200)).body;
    expect(suggestions.families.length).toBeGreaterThan(0);
    expect((await api().get('/reference/job-titles?q=a').expect(200)).body).toEqual({ families: [], jobs: [] });
  });

  it('gives practice tasks that say what they are, and keeps MIDAN\'s checklist MIDAN\'s', async () => {
    const task = (await api().post('/me/career/practice').set(bearer(candidate)).send({ reference_skill_id: workbookSkill.id, kind: 'simulated_task' }).expect(201)).body;
    expect(task).toMatchObject({ status: 'not_started', kind: 'simulated_task', template_version: 'practice-v1', feedback: null });
    expect(task.brief_en).toMatch(/practice only: not a job, not work experience/);
    expect(task.title_ar).toContain(workbookSkill.name_ar);
    expect((await api().post('/me/career/practice').set(bearer(candidate)).send({ reference_skill_id: workbookSkill.id, kind: 'simulated_task' }).expect(201)).body.id).toBe(task.id);
    await api().post('/me/career/practice').set(bearer(candidate)).send({ reference_skill_id: workbookSkill.id, kind: 'employment' }).expect(400);

    // Through the Data API, a candidate can't create a task, or write MIDAN's checklist or a submitted state.
    expect((await rest(candidate, 'POST', 'practice_tasks', { reference_skill_id: workbookSkill.id, kind: 'portfolio_project', template_version: 'x', title_ar: 'x', title_en: 'x', brief_ar: 'x', brief_en: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(candidate, 'PATCH', `practice_tasks?id=eq.${task.id}`, { feedback: [{ code: 'enough_detail', met: true }] })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(candidate, 'PATCH', `practice_tasks?id=eq.${task.id}`, { status: 'completed' })).status).toBeGreaterThanOrEqual(400);

    await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'submit', submission: ' ' }).expect(422);
    await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'complete' }).expect(422);
    const saved = (await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'save', submission: 'First draft.' }).expect(200)).body;
    expect(saved).toMatchObject({ status: 'in_progress', submission: 'First draft.' });
    const work = ['The situation: a late monthly report.', `The steps: I would use ${workbookSkill.name_ar} to compare the months.`, 'The check: compare with last month.'].join('\n\n');
    const submitted = (await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'submit', submission: work }).expect(200)).body;
    expect(submitted.status).toBe('submitted');
    expect(submitted.feedback).toEqual([
      { code: 'enough_detail', met: false },
      { code: 'each_deliverable', met: true },
      { code: 'names_skill', met: true },
    ]);
    expect((await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'complete' }).expect(200)).body.status).toBe('completed');
    await api().patch(`/me/career/practice/${task.id}`).set(bearer(candidate)).send({ action: 'save', submission: 'later' }).expect(422);

    // The candidate's own: nobody else reads or changes it.
    await api().patch(`/me/career/practice/${task.id}`).set(bearer(other)).send({ action: 'save' }).expect(404);
    expect((await rest(other, 'GET', `practice_tasks?id=eq.${task.id}`)).body).toEqual([]);
    expect((await rest(owner, 'GET', `practice_tasks?id=eq.${task.id}`)).body).toEqual([]);
    const career = (await api().get('/me/career').set(bearer(candidate)).expect(200)).body;
    expect(career.practice.map((p: { id: string }) => p.id)).toContain(task.id);

    const portfolio = (await api().post('/me/career/practice').set(bearer(candidate)).send({ reference_skill_id: workbookSkill.id, kind: 'portfolio_project' }).expect(201)).body;
    expect(portfolio.brief_en).toMatch(/your own work, not work experience/);
    await api().patch(`/me/career/practice/${portfolio.id}`).set(bearer(candidate)).send({ action: 'save', submission_url: 'http://insecure.example.com' }).expect(400);
  });

  it('saves CV languages and achievements only when the candidate approves them, and shares them through the snapshot', async () => {
    const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan` });
    await db.connect();
    let analysis: string;
    try {
      const document = (await db.query(
        `insert into public.cv_documents (candidate_id, storage_path, mime_type, size_bytes, is_current) values ($1, $2, 'application/pdf', 10, false) returning id`,
        [candidate.id, `${candidate.id}/cv-test-${RUN}.pdf`],
      )).rows[0].id as string;
      analysis = (await db.query(
        `insert into public.cv_analyses (document_id, candidate_id, status, mode, professional) values ($1, $2, 'awaiting_review', 'local_only', $3) returning id`,
        [document, candidate.id, JSON.stringify({
          skills: ['Excel'], languages: [{ name: 'العربية' }, { name: 'English', level: 'Fluent' }], achievements: [{ title: 'Fictional award 2023' }],
          skill_details: [{ name: 'Excel', kind: 'unclassified', evidence: null }], feedback: [{ type: 'gap', code: 'no_measurable_results', values: [] }],
        })],
      )).rows[0].id as string;
    } finally {
      await db.end();
    }
    if (!(await api().get('/me').set(bearer(candidate)).expect(200)).body.candidate_profiles) {
      await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate Two' }).expect(200);
    }
    const before = (await api().get('/me').set(bearer(candidate)).expect(200)).body.candidate_profiles;
    expect(before.languages).not.toContainEqual({ name: 'English', level: 'Fluent' });
    await api().post(`/me/cv/analyses/${analysis}/apply`).set(bearer(candidate)).send({ languages: [{ name: '' }] }).expect(400);
    await api().post(`/me/cv/analyses/${analysis}/apply`).set(bearer(candidate))
      .send({ languages: [{ name: 'English', level: 'Fluent' }], achievements: [{ title: 'Fictional award 2023' }] }).expect(201);
    const after = (await api().get('/me').set(bearer(candidate)).expect(200)).body.candidate_profiles;
    expect(after.languages).toContainEqual({ name: 'English', level: 'Fluent' });
    expect(after.languages).not.toContainEqual({ name: 'العربية' });
    expect(after.achievements).toContainEqual({ title: 'Fictional award 2023' });

    const application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201)).body.id;
    const seen = (await api().get(`/organizations/${org}/applications/${application}/review`).set(bearer(owner)).expect(200)).body;
    expect(seen.profile.languages).toContainEqual({ name: 'English', level: 'Fluent' });
    expect(seen.profile.achievements).toContainEqual({ title: 'Fictional award 2023' });
    await api().post(`/applications/${application}/withdraw`).set(bearer(candidate)).expect(201);
  });
});
