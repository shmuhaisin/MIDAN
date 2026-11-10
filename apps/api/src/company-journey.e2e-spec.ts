// The company journey (feature/midan-company-journey) through the real stack: publishing waits for the assessment,
// every applicant is ranked with separate stage scores, interview preparation and the development report are written by
// the live model only (this suite runs with the AI service in demo mode, so they must refuse), and the database rules of
// the development report. Fictional data, local only.
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { approveOrganization } from './test-support/approve-organization';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

loadEnv('.env', '.env.test.local');

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

describe('the company journey', () => {
  let app: INestApplication;
  let owner: Session, outsider: Session, one: Session, two: Session;
  let org: string, job: string, version: string, appOne: string, appTwo: string, interview: string;
  const slug = `midan-test-journey-${RUN}`;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const base = () => `/organizations/${org}`;

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, outsider, one, two] = await Promise.all(['ORG_A_OWNER', 'ORG_B_OWNER', 'CANDIDATE_ONE', 'CANDIDATE_TWO'].map(signIn));
  });
  afterAll(() => app.close());

  it('publishes a job with an assessment only after the assessment is approved', async () => {
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug, name_ar: 'منشأة الرحلة', name_en: 'Journey org' }).expect(201)).body.id;
    await approveOrganization(app.getHttpServer(), owner.token, org);
    job = (await api().post(`${base()}/jobs`).set(bearer(owner)).send({ slug: 'analyst', title_ar: 'محلل بيانات', title_en: 'Data analyst' }).expect(201)).body.id;
    const skill = ((await api().get('/skills').expect(200)).body as { id: string; slug: string }[]).find((s) => s.slug === 'sql')!;
    await api().patch(`${base()}/jobs/${job}`).set(bearer(owner))
      .send({ description_en: 'Build SQL reports for monthly sales.', description_ar: 'إعداد تقارير SQL للمبيعات الشهرية.', skills: [{ skill_id: skill.id, required_level: 3 }] }).expect(200);
    version = (await api().post(`${base()}/jobs/${job}/assessment/generate`).set(bearer(owner)).send({}).expect(201)).body.version_id;
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(422);
    const state = (await api().get(`${base()}/assessment-versions/${version}/changes`).set(bearer(owner)).expect(200)).body;
    await api().post(`${base()}/assessment-versions/${version}/publish`).set(bearer(owner)).send({ reviewed_through: state.latest_change_id }).expect(201);
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(200);
  });

  it('ranks every applicant with separate stage scores, never combined, and changes no status', async () => {
    await api().put('/me/candidate-profile').set(bearer(one)).send({
      full_name: 'Fictional One', headline: 'Reporting analyst', summary: 'I build SQL reports for monthly sales every week.',
      experience: [{ title: 'Reporting analyst', organization: 'Fictional Co', start_year: 2020, end_year: null, description: 'Built SQL reports for monthly sales\nAutomated weekly dashboards' }],
    }).expect(200);
    await api().put('/me/candidate-profile').set(bearer(two)).send({ full_name: 'Fictional Two', headline: 'Event coordinator', summary: 'I organize events.' }).expect(200);
    appOne = (await api().post(`/jobs/${job}/applications`).set(bearer(one)).send({}).expect(201)).body.id;
    appTwo = (await api().post(`/jobs/${job}/applications`).set(bearer(two)).send({}).expect(201)).body.id;

    const ranking = (await api().get(`${base()}/jobs/${job}/ranking`).set(bearer(owner)).expect(200)).body;
    expect(ranking.overall).toEqual({ available: false, reason: 'no_approved_weights' });
    expect(ranking.applicants.map((a: { application_id: string }) => a.application_id).sort()).toEqual([appOne, appTwo].sort());
    const byId = (id: string) => ranking.applicants.find((a: { application_id: string }) => a.application_id === id);
    expect(byId(appOne).cv.status).toBe('scored');
    expect(byId(appOne).cv.score).toBeGreaterThanOrEqual(byId(appTwo).cv.score ?? 0);
    expect(byId(appOne).rank).toBe(1);
    expect(byId(appOne).matching.provider).toBeTruthy();
    // The assessment isn't reviewed yet: by that stage, nobody is ranked.
    const byAssessment = (await api().get(`${base()}/jobs/${job}/ranking?sort=assessment`).set(bearer(owner)).expect(200)).body;
    expect(byAssessment.sort).toBe('assessment');
    expect(byAssessment.applicants.every((a: { rank: number | null; assessment_score: number | null }) => a.rank === null && a.assessment_score === null)).toBe(true);
    // Reading the ranking decides nothing.
    for (const id of [appOne, appTwo]) {
      const status = (await api().get(`${base()}/applications/${id}/review`).set(bearer(owner)).expect(200)).body.status;
      expect(['submitted', 'assessment_invited']).toContain(status);
    }
    await api().get(`/organizations/${org}/jobs/${job}/ranking`).set(bearer(outsider)).expect(403);
    await api().get(`/organizations/${org}/jobs/${job}/ranking`).set(bearer(one)).expect(403);
  });

  it('prepares interview questions and the form with the live model only, for staff only', async () => {
    await api().patch(`/applications/${appOne}/status`).set(bearer(owner)).send({ status: 'shortlisted' }).expect(200);
    interview = (await api().post(`${base()}/applications/${appOne}/interviews`).set(bearer(owner))
      .send({ scheduled_at: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body.id;
    for (const kind of ['questions', 'evaluation_form']) {
      const res = await api().post(`${base()}/interviews/${interview}/preparation`).set(bearer(owner)).send({ kind }).expect(503);
      expect(res.body.reason).toBe('not_configured');
    }
    expect((await api().get(`${base()}/interviews/${interview}/preparation`).set(bearer(owner)).expect(200)).body)
      .toMatchObject({ questions: null, evaluation_form: null, history: { questions: 0, evaluation_form: 0 } });
    await api().get(`${base()}/interviews/${interview}/preparation`).set(bearer(one)).expect(403);
    await api().post(`${base()}/interviews/${interview}/preparation`).set(bearer(one)).send({ kind: 'questions' }).expect(403);
    // Nobody writes a preparation for another organization, nor one the model didn't write.
    const row = (mode: string) => ({ interview_id: interview, application_id: appOne, org_id: org, kind: 'questions', content: [{}], facts: [], provenance: { mode, model_version: 'x' } });
    expect((await rest(outsider, 'POST', 'interview_preparations', row('live'))).status).toBeGreaterThanOrEqual(400);
    expect((await rest(owner, 'POST', 'interview_preparations', row('demo'))).status).toBeGreaterThanOrEqual(400);
    expect((await rest(one, 'GET', `interview_preparations?interview_id=eq.${interview}`)).body).toEqual([]);
  });

  it('writes a development report only with the live model, and the database keeps a released report as it is', async () => {
    const res = await api().post(`${base()}/applications/${appOne}/development-reports`).set(bearer(owner)).send({}).expect(503);
    expect(['not_configured', 'no_evidence']).toContain(res.body.reason);
    expect((await api().get(`/me/applications/${appOne}/development-report`).set(bearer(one)).expect(200)).body).toEqual({});

    // The database rules, directly: the candidate can't write one, a draft is invisible to them, release fixes it.
    expect((await rest(one, 'POST', 'candidate_development_reports', { application_id: appOne, content: {}, provenance: { mode: 'live' } })).status).toBeGreaterThanOrEqual(400);
    const draft = await rest(owner, 'POST', 'candidate_development_reports', { application_id: appOne, content: { strengths: [] }, provenance: { mode: 'live' } });
    expect(draft.status).toBe(201);
    const id = draft.body[0].id as string;
    expect(draft.body[0].status).toBe('draft');
    expect((await rest(one, 'GET', `candidate_development_reports?id=eq.${id}`)).body).toEqual([]);
    expect((await rest(outsider, 'GET', `candidate_development_reports?id=eq.${id}`)).body).toEqual([]);
    expect((await rest(owner, 'PATCH', `candidate_development_reports?id=eq.${id}`, { content: { strengths: ['changed'] } })).status).toBeGreaterThanOrEqual(400);
    await api().post(`${base()}/applications/${appOne}/development-reports/${id}/release`).set(bearer(owner)).expect(201);
    const mine = (await api().get(`/me/applications/${appOne}/development-report`).set(bearer(one)).expect(200)).body;
    expect(mine.id).toBe(id);
    expect(mine.content).not.toHaveProperty('facts');
    await api().post(`${base()}/applications/${appOne}/development-reports/${id}/release`).set(bearer(owner)).expect(404);
    const notes = (await api().get('/me/notifications').set(bearer(one)).expect(200)).body as { kind: string; link: string }[];
    expect(notes.filter((n) => n.kind === 'development_report' && n.link === `/applications/${appOne}`)).toHaveLength(1);
    // The other candidate never sees it.
    expect((await rest(two, 'GET', `candidate_development_reports?id=eq.${id}`)).body).toEqual([]);
  });
});
