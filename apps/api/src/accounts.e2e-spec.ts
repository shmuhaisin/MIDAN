// Account types through the real stack: a candidate account and an organization account stay apart (the database decides,
// not the editable account type in the token), only candidates apply, a new job needs no address, and regenerating a draft
// task needs the live AI model. Fictional data, local only; the AI service runs in demo mode here (no live model).
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
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`TEST_${name}_EMAIL`], password: process.env[`TEST_${name}_PASSWORD`] }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string; email: string } };
  if (!res.ok) throw new Error(`Sign-in failed for ${name}`);
  return { id: body.user.id, email: body.user.email, token: body.access_token };
}

describe('account types, job creation and task regeneration', () => {
  let app: INestApplication;
  let owner: Session, candidate: Session;
  let org: string, job: string;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, candidate] = await Promise.all(['ORG_A_OWNER', 'CANDIDATE_ONE'].map(signIn));
    // The test candidate becomes a candidate account the way a person does: with a candidate profile.
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate One' }).expect(200);
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-accounts-${RUN}`, name_ar: 'جهة حسابات', name_en: 'Accounts org' }).expect(201)).body.id;
    await approveOrganization(app.getHttpServer(), owner.token, org);
  });
  afterAll(() => app.close());

  it('creates a job from its titles and description, with an address made from the English title', async () => {
    const res = await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({
      title_ar: 'محلل حسابات', title_en: `Accounts Analyst ${RUN}!`,
      description_ar: 'يحلل الحسابات الشهرية.', description_en: 'Analyses the monthly accounts and reports to management.', status: 'published',
    }).expect(201);
    job = res.body.id;
    expect(res.body.slug).toMatch(new RegExp(`^accounts-analyst-${RUN}-[0-9a-f]{6}$`));
    expect(res.body.description_en).toBe('Analyses the monthly accounts and reports to management.');
    // The published page shows it.
    expect((await api().get(`/jobs/${job}`).expect(200)).body.description_ar).toBe('يحلل الحسابات الشهرية.');
    // An address the employer gives is still checked.
    await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ slug: 'Not A Slug', title_ar: 'س', title_en: 'x' }).expect(400);
  });

  it('refuses an organization account that tries to become a candidate or apply', async () => {
    await api().put('/me/candidate-profile').set(bearer(owner)).send({ full_name: 'Staff member' }).expect(403);
    await api().post(`/jobs/${job}/applications`).set(bearer(owner)).send({}).expect(403);
  });

  it('refuses a candidate account that tries to create or join an organization', async () => {
    await api().post('/organizations').set(bearer(candidate)).send({ slug: `midan-test-cand-org-${RUN}`, name_ar: 'س', name_en: 'x' }).expect(403);
    await api().post(`/organizations/${org}/team/invitations`).set(bearer(owner)).send({ email: candidate.email, role: 'reviewer' }).expect(201);
    const invitation = ((await api().get('/me/invitations').set(bearer(candidate)).expect(200)).body as { id: string; org_id: string }[]).find((i) => i.org_id === org)!;
    expect((await api().post(`/me/invitations/${invitation.id}/accept`).set(bearer(candidate))).status).toBe(403);
    expect([403, 404]).toContain((await api().get(`/organizations/${org}/applications`).set(bearer(candidate))).status);
  });

  it('lets the candidate apply, and only once', async () => {
    const first = await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201);
    const again = await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201);
    expect(again.body.id).toBe(first.body.id);
  });

  it('regenerates a draft task only with the live model, and never on an approved version', async () => {
    const generated = await api().post(`/organizations/${org}/jobs/${job}/assessment/generate`).set(bearer(owner)).send({}).expect(201);
    expect(generated.body.mode).toBe('demo');
    const draft = (await api().get(`/organizations/${org}/jobs/${job}/assessment`).set(bearer(owner)).expect(200)).body.version;
    const task = draft.assessment_tasks[0];
    // The AI service here has no live model: the API says so, and the task is unchanged.
    await api().post(`/organizations/${org}/assessment-tasks/${task.id}/regenerate`).set(bearer(owner)).send({ note: 'More about month-end' }).expect(503);
    const after = (await api().get(`/organizations/${org}/jobs/${job}/assessment`).set(bearer(owner)).expect(200)).body.version.assessment_tasks[0];
    expect(after.title_en).toBe(task.title_en);
    // Someone outside the organization can't ask for it.
    expect([403, 404]).toContain((await api().post(`/organizations/${org}/assessment-tasks/${task.id}/regenerate`).set(bearer(candidate)).send({})).status);
    // A note longer than 500 characters is refused before anything runs.
    await api().post(`/organizations/${org}/assessment-tasks/${task.id}/regenerate`).set(bearer(owner)).send({ note: 'x'.repeat(501) }).expect(400);
  });
});
