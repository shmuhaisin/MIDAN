// The whole journey with a model behind the AI service: browse, apply, job-specific assessment, work, evaluation, employer review.
// Not part of test:e2e, which runs in demo mode. Needs the AI service in live mode, against tests/stub_provider.py or, once the
// owner adds a key to the local .env, a real provider. See docs/local-development.md. Fictional data only, on the local stack.
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
type Session = { id: string; token: string };

async function signIn(name: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`TEST_${name}_EMAIL`], password: process.env[`TEST_${name}_PASSWORD`] }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { id: body.user.id, token: body.access_token };
}

describe('the journey with a model behind the AI service', () => {
  let app: INestApplication;
  let owner: Session, outsider: Session, candidate: Session;
  let org: string, job: string, version: string, application: string, attempt: string, evaluation: string;
  let skill: { id: string; name_ar: string };
  const slug = `midan-test-live-${RUN}`;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  /** Approves a draft as the screen does: with a review of every change made to MIDAN's draft (20261107150000). */
  const approve = async (who: Session, version: string) => {
    const path = `${base()}/assessment-versions/${version}`;
    const state = await api().get(`${path}/changes`).set(bearer(who)).expect(200);
    return api().post(`${path}/publish`).set(bearer(who)).send({ reviewed_through: state.body.latest_change_id });
  };
  const base = () => `/organizations/${org}`;
  // What the Data API gives this person from reference_skill_scores for this evaluation.
  const rows = async (s: Session) => (await (await fetch(`${BASE}/rest/v1/reference_skill_scores?result_id=eq.${evaluation}&select=id`,
    { headers: { apikey: KEY, Authorization: `Bearer ${s.token}` } })).json()) as unknown[];

  beforeAll(async () => {
    const health = (await (await fetch(`${process.env.AI_SERVICE_URL}/health`)).json()) as { mode: string };
    if (health.mode !== 'live') throw new Error('Start the AI service in live mode first: see docs/local-development.md');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, outsider, candidate] = await Promise.all(['ORG_A_OWNER', 'ORG_B_OWNER', 'CANDIDATE_TWO'].map(signIn));
    const pool = await fetch(`${BASE}/rest/v1/reference_skills?sector_code=eq.digital&skill_kind=eq.technical&limit=1&select=id,name_ar`, { headers: { apikey: KEY } });
    [skill] = (await pool.json()) as { id: string; name_ar: string }[];
  });
  afterAll(() => app?.close());

  it("generates a draft from the job's own context, recorded as the model's work, for the employer to approve", async () => {
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug, name_ar: 'رحلة حية', name_en: 'Live journey' }).expect(201)).body.id;
    job = (await api().post(`${base()}/jobs`).set(bearer(owner)).send({ slug: 'engineer', title_ar: 'مهندس منصات', title_en: 'Platform engineer' }).expect(201)).body.id;
    await api().patch(`${base()}/jobs/${job}`).set(bearer(owner)).send({ description_ar: `يعمل على ${skill.name_ar}.` }).expect(200);
    await api().post(`${base()}/jobs/${job}/requirements`).set(bearer(owner))
      .send({ requirement_type: 'responsibility', description_ar: 'تشغيل المنصات الرقمية ومتابعة أعطالها', description_en: 'Run digital platforms and follow up their incidents' }).expect(201);
    const analysis = (await api().post(`${base()}/jobs/${job}/analyses`).set(bearer(owner)).expect(201)).body;
    await api().post(`${base()}/jobs/${job}/analyses/${analysis.id}/accept`).set(bearer(owner)).send({ skills: [skill.id], required: [skill.id], set_sector: true }).expect(201);

    const generated = (await api().post(`${base()}/jobs/${job}/assessment/generate`).set(bearer(owner)).send({}).expect(201)).body;
    expect(generated.mode).toBe('live');
    version = generated.version_id;
    const view = (await api().get(`${base()}/jobs/${job}/assessment`).set(bearer(owner)).expect(200)).body;
    expect(view.run.mode).toBe('live');
    const tasks = view.version.assessment_tasks as { reference_skill_ids: string[]; task_requirement_mappings: unknown[]; rubric_criteria: { reference_skill_id: string | null }[] }[];
    expect(tasks.some((t) => t.task_requirement_mappings.length === 1)).toBe(true);
    expect(tasks.flatMap((t) => t.reference_skill_ids)).toContain(skill.id);
    expect(tasks.every((t) => t.rubric_criteria.length >= 1)).toBe(true);

    // The employer reviews the draft and corrects it before approving. The model's answer key says "a", and the employer says "b".
    const objective = (view.version.assessment_tasks as { id: string; task_type: string; config: { questions: { id: string; prompt_ar: string; prompt_en: string; options: unknown[] }[] } }[]).find((t) => t.task_type === 'objective_questions');
    // A draft to the standard may be written tasks only; the stand-in always adds objective questions.
    if (objective) {
      await api().patch(`${base()}/assessment-tasks/${objective.id}/questions`).set(bearer(owner))
        .send({ questions: objective.config.questions.map((q) => ({ ...q, answer: 'b' })) }).expect(200);
    }

    await api().post(`${base()}/assessment-versions/${version}/publish`).set(bearer(outsider)).expect(403);
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(200);
    expect((await approve(owner, version)).status).toBe(201);
  });

  it('lets a candidate find the job, apply and complete the assessment, without seeing the rubric', async () => {
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate Two' }).expect(200);
    expect((await api().get('/jobs').set(bearer(candidate)).expect(200)).body.map((j: { id: string }) => j.id)).toContain(job);
    application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201)).body.id;
    const mine = (await api().get('/me/applications').set(bearer(candidate)).expect(200)).body.find((a: { id: string }) => a.id === application);
    attempt = mine.assessment_attempts[0].id;
    const seen = (await api().get(`/experience/${slug}/engineer/1`).set(bearer(candidate)).expect(200)).body;
    expect(JSON.stringify(seen)).not.toMatch(/rubric_criteria|answer_key|reference_skill_id/);
    await api().post(`/attempts/${attempt}/start`).set(bearer(candidate)).expect(201);
    for (const t of seen.version.assessment_tasks) {
      const answer = t.task_type === 'objective_questions' ? { choices: { q1: 'b' } } : { text: 'I would check the logs, isolate the failing service, fix it, and confirm with monitoring.' };
      await api().put(`/attempts/${attempt}/responses/${t.id}`).set(bearer(candidate)).send({ answer }).expect(200);
    }
    await api().post(`/attempts/${attempt}/submit`).set(bearer(candidate)).expect(201);
  });

  it("evaluates the work with the model's scores recorded as proposals, for the employer to review", async () => {
    await api().post(`/attempts/${attempt}/evaluate`).set(bearer(outsider)).expect(404);
    evaluation = (await api().post(`/attempts/${attempt}/evaluate`).set(bearer(owner)).expect(201)).body.id;
    const full = (await api().get(`/attempts/${attempt}/evaluation`).set(bearer(owner)).expect(200)).body;
    expect(full.evaluation_results.ai_mode).toBe('live');
    expect(full.evaluation_results.status).toBe('needs_human_review');
    const scores = full.evaluation_results.criterion_scores as { source: string; score: string; model_version: string; provider: string | null; evidence_ref: string | null; explanation: string }[];
    // Provenance names the provider and the exact model the AI service is running, e.g. groq and openai/gpt-oss-120b.
    const running = (await (await fetch(`${process.env.AI_SERVICE_URL}/health`)).json()) as { provider: string; model: string };
    expect(scores.length).toBeGreaterThan(0);
    const written = scores.filter((s) => s.source === 'ai_assisted');
    expect(written.length).toBeGreaterThan(0);
    for (const s of written) {
      expect(s.model_version).toBe(running.model);
      expect(s.provider).toBe(running.provider);
      expect(s.explanation).toBeTruthy();
    }
    // Objective questions are graded by plain code, against the employer's corrected key.
    if (scores.some((s) => s.source === 'deterministic')) {
      expect(scores.find((s) => s.source === 'deterministic')).toMatchObject({ score: '1', explanation: '1 of 1 correct.' });
    }
    // Nothing reaches the candidate before a person reviews it.
    await api().get(`/attempts/${attempt}/report`).set(bearer(candidate)).expect(404);
    await api().get(`/attempts/${attempt}/evaluation`).set(bearer(candidate)).expect(403);
  });

  it('lets the employer review and release the result, then shortlist and hire', async () => {
    expect((await api().post(`/evaluations/${evaluation}/review`).set(bearer(owner)).send({ scores: [], notes: 'Checked against the rubric' }).expect(201)).body.status).toBe('reviewed');
    // The workbook skill the tasks measure, as a percentage from the reviewed scores. The workbooks define no levels, so none is given.
    const reviewed = (await api().get(`/attempts/${attempt}/evaluation`).set(bearer(owner)).expect(200)).body;
    const workbook = reviewed.evaluation_results.reference_skill_scores as { reference_skill_id: string; score_pct: string; source: string }[];
    expect(workbook).toEqual([expect.objectContaining({ reference_skill_id: skill.id, source: 'human_reviewed' })]);
    expect(Number(workbook[0].score_pct)).toBeGreaterThan(0);
    expect(Number(workbook[0].score_pct)).toBeLessThanOrEqual(100);
    expect(Object.keys(workbook[0])).not.toContain('level');
    expect(await rows(candidate)).toEqual([]);
    await api().post(`/evaluations/${evaluation}/release`).set(bearer(owner)).expect(201);
    const report = (await api().get(`/attempts/${attempt}/report`).set(bearer(candidate)).expect(200)).body;
    expect(JSON.stringify(report)).not.toContain('Checked against the rubric');
    expect(report.reference_skill_scores).toEqual([{ score_pct: workbook[0].score_pct, reference_skills: expect.objectContaining({ id: skill.id, name_ar: skill.name_ar }) }]);
    expect(await rows(candidate)).toHaveLength(1);
    expect(await rows(outsider)).toEqual([]);
    await api().post(`${base()}/applications/${application}/outcome`).set(bearer(owner)).send({ outcome: 'hired' }).expect(422);
    await api().patch(`/applications/${application}/status`).set(bearer(owner)).send({ status: 'shortlisted' }).expect(200);
    await api().post(`${base()}/applications/${application}/outcome`).set(bearer(owner)).send({ outcome: 'hired', message_en: 'Welcome.' }).expect(201);
    expect((await api().get(`/me/applications/${application}`).set(bearer(candidate)).expect(200)).body.status).toBe('hired');
  });
});
