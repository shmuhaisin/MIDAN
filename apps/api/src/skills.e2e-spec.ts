// A job's skills through the real stack: suggestions recorded as a reviewable analysis (only real catalog skills), levels
// and required/preferred on accept, catalog search, the employer's own skills for one job, isolation between jobs and
// organizations, and the accepted list reaching requirement matching. The AI service runs in demo mode here, so the
// suggestions are the labelled similarity shortlist, never the model's choice.
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`TEST_${name}_EMAIL`], password: process.env[`TEST_${name}_PASSWORD`] }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string; email: string } };
  if (!res.ok) throw new Error(`Sign-in failed for ${name}`);
  return { id: body.user.id, email: body.user.email, token: body.access_token };
}

type Proposal = { reference_skill_id: string; basis: string; level: number | null; required: boolean; reason_en: string | null };

describe('job skills', () => {
  let app: INestApplication;
  let owner: Session, outsider: Session, candidate: Session;
  let org: string, job: string, otherJob: string;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, outsider, candidate] = await Promise.all(['ORG_A_OWNER', 'ORG_B_OWNER', 'CANDIDATE_ONE'].map(signIn));
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-skills-${RUN}`, name_ar: 'جهة مهارات', name_en: 'Skills org' }).expect(201)).body.id;
    const make = async (title: string, description: string) => {
      const id = (await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ title_ar: title, title_en: title, description_en: description, status: 'published' }).expect(201)).body.id;
      await api().patch(`/organizations/${org}/jobs/${id}`).set(bearer(owner)).send({ sector: 'digital' }).expect(200);
      return id;
    };
    job = await make(`Data analyst ${RUN}`, 'Analyse sales data and build dashboards for management.');
    otherJob = await make(`Security analyst ${RUN}`, 'Monitor security alerts and investigate incidents.');
  });
  afterAll(() => app.close());

  let proposals: Proposal[] = [];

  it('records suggestions as an analysis to review, labelled when the model is unavailable, with only real catalog skills', async () => {
    const res = await api().post(`/organizations/${org}/jobs/${job}/analyses/suggest`).set(bearer(owner)).expect(201);
    expect(res.body.status).toBe('proposed');
    expect(res.body.method).toBe('semantic_similarity_v1');
    expect(res.body.provenance).toMatchObject({ mode: 'similarity_only' });
    proposals = res.body.proposals;
    expect(proposals.length).toBeGreaterThan(0);
    // Without the model nothing is invented: no reasons, levels or required flags.
    expect(proposals.every((p) => p.basis === 'similar' && p.level === null && !p.required && !p.reason_en)).toBe(true);
    // Nothing is linked until the employer accepts.
    expect((await api().get(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).expect(200)).body.job_reference_skills).toHaveLength(0);
    // Outside the organization: refused.
    expect([403, 404]).toContain((await api().post(`/organizations/${org}/jobs/${job}/analyses/suggest`).set(bearer(outsider))).status);
    expect([403, 404]).toContain((await api().post(`/organizations/${org}/jobs/${job}/analyses/suggest`).set(bearer(candidate))).status);
  });

  it('links the chosen skills with required/preferred and the employer\'s levels, and lets them change or go', async () => {
    const latest = (await api().get(`/organizations/${org}/jobs/${job}/analyses/latest`).set(bearer(owner)).expect(200)).body;
    const [a, b] = proposals.map((p) => p.reference_skill_id);
    await api().post(`/organizations/${org}/jobs/${job}/analyses/${latest.id}/accept`).set(bearer(owner))
      .send({ skills: [a, b], required: [a], set_sector: false, levels: { [a]: 3, [b]: 9 } }).expect(201);
    let linked = (await api().get(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).expect(200)).body.job_reference_skills;
    const byId = (id: string) => linked.find((l: { reference_skills: { id: string } }) => l.reference_skills.id === id);
    expect(byId(a)).toMatchObject({ is_required: true, required_level: 3 });
    expect(byId(b)).toMatchObject({ is_required: false, required_level: null }); // 9 isn't a level
    await api().patch(`/organizations/${org}/jobs/${job}/reference-skills/${b}`).set(bearer(owner)).send({ required_level: 2, is_required: true }).expect(200);
    await api().patch(`/organizations/${org}/jobs/${job}/reference-skills/${b}`).set(bearer(owner)).send({ required_level: 5 }).expect(400);
    linked = (await api().get(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).expect(200)).body.job_reference_skills;
    expect(byId(b)).toMatchObject({ is_required: true, required_level: 2 });
    await api().delete(`/organizations/${org}/jobs/${job}/reference-skills/${b}`).set(bearer(owner)).expect(200);
    expect((await api().get(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).expect(200)).body.job_reference_skills).toHaveLength(1);
    // The other job is untouched.
    expect((await api().get(`/organizations/${org}/jobs/${otherJob}`).set(bearer(owner)).expect(200)).body.job_reference_skills).toHaveLength(0);
    // Another organization can't change them.
    expect([403, 404]).toContain((await api().patch(`/organizations/${org}/jobs/${job}/reference-skills/${a}`).set(bearer(outsider)).send({ required_level: 1 })).status);
  });

  it('finds workbook skills by name and adds one from search', async () => {
    const found = (await api().get(`/organizations/${org}/reference-skills`).query({ q: 'الأمن السيبراني' }).set(bearer(owner)).expect(200)).body;
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].name_ar).toContain('السيبراني');
    expect((await api().get(`/organizations/${org}/reference-skills`).query({ q: 'x' }).set(bearer(owner)).expect(200)).body).toEqual([]);
    await api().post(`/organizations/${org}/jobs/${otherJob}/reference-skills`).set(bearer(owner)).send({ reference_skill_id: found[0].id, is_required: true, required_level: 3 }).expect(201);
    const linked = (await api().get(`/organizations/${org}/jobs/${otherJob}`).set(bearer(owner)).expect(200)).body.job_reference_skills;
    expect(linked).toEqual([expect.objectContaining({ is_required: true, required_level: 3 })]);
  });

  it("keeps the employer's own skills on their job only, and lets them be edited and removed", async () => {
    const created = (await api().post(`/organizations/${org}/jobs/${job}/custom-skills`).set(bearer(owner))
      .send({ name_en: 'Power BI dashboards', name_ar: 'لوحات Power BI', is_required: true, required_level: 3, description: 'Monthly sales dashboards.' }).expect(201)).body;
    await api().post(`/organizations/${org}/jobs/${job}/custom-skills`).set(bearer(owner)).send({ description: 'no name' }).expect(400);
    await api().post(`/organizations/${org}/jobs/${job}/custom-skills`).set(bearer(owner)).send({ name_en: 'x', required_level: 7 }).expect(400);
    await api().patch(`/organizations/${org}/jobs/${job}/custom-skills/${created.id}`).set(bearer(owner)).send({ required_level: 4, is_required: false }).expect(200);
    const list = (await api().get(`/organizations/${org}/jobs/${job}/custom-skills`).set(bearer(owner)).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ name_en: 'Power BI dashboards', required_level: 4, is_required: false })]);
    expect((await api().get(`/organizations/${org}/jobs/${otherJob}/custom-skills`).set(bearer(owner)).expect(200)).body).toEqual([]);
    expect([403, 404]).toContain((await api().get(`/organizations/${org}/jobs/${job}/custom-skills`).set(bearer(outsider))).status);
    expect([403, 404]).toContain((await api().delete(`/organizations/${org}/jobs/${job}/custom-skills/${created.id}`).set(bearer(outsider))).status);
    // It never becomes a shared catalog skill.
    expect((await api().get(`/organizations/${org}/reference-skills`).query({ q: 'Power BI dashboards' }).set(bearer(owner)).expect(200)).body).toEqual([]);
  });

  it('feeds the accepted workbook skills and the employer\'s own skills into requirement matching', async () => {
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate One', headline: 'Data analyst' }).expect(200);
    const application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201)).body.id;
    const match = (await api().get(`/organizations/${org}/applications/${application}/match`).set(bearer(owner)).expect(200)).body;
    const keys = match.requirements.map((r: { key: string }) => r.key);
    expect(keys.some((k: string) => k.startsWith('reference:'))).toBe(true);
    expect(keys.some((k: string) => k.startsWith('custom:'))).toBe(true);
  });
});
