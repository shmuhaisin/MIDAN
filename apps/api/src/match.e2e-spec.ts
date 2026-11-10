// Requirement matching through the real stack: the proposal and its evidence, staff reviews, and who may see or record
// them. Fictional data, local only. The AI service must be running (it serves /match/requirements), with
// EMBEDDING_PROVIDER=lexical so the statuses are deterministic; the e5 model has its own test (services/ai/tests/test_matching_e5.py).
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

type Row = { key: string; kind: string; proposal: { status: string; evidence_text: string | null; evidence_source: string | null; reason_code: string } | null; review: { status: string; decision: string; note: string | null } | null };

describe('requirement matching', () => {
  let app: INestApplication;
  let owner: Session, reviewer: Session, outsider: Session, candidate: Session;
  let org: string, job: string, application: string;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const matchPath = () => `/organizations/${org}/applications/${application}/match`;
  let rows: Row[] = [];

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, reviewer, outsider, candidate] = await Promise.all(['ORG_A_OWNER', 'ORG_A_RECRUITER', 'ORG_B_OWNER', 'CANDIDATE_ONE'].map(signIn));
  });
  afterAll(() => app.close());

  it('sets up a published job with requirements, and an applicant with a dated profile', async () => {
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-match-${RUN}`, name_ar: 'جهة مطابقة', name_en: 'Match org' }).expect(201)).body.id;
    await approveOrganization(app.getHttpServer(), owner.token, org);
    // The second account joins as a reviewer: it may read, but recording reviews is for owners, admins and recruiters.
    await api().post(`/organizations/${org}/team/invitations`).set(bearer(owner)).send({ email: reviewer.email, role: 'reviewer' }).expect(201);
    const invitation = ((await api().get('/me/invitations').set(bearer(reviewer)).expect(200)).body as { id: string; org_id: string }[]).find((i) => i.org_id === org)!;
    await api().post(`/me/invitations/${invitation.id}/accept`).set(bearer(reviewer)).expect(201);
    job = (await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ slug: `match-${RUN}`, title_ar: `محلل مطابقة ${RUN}`, title_en: `Match analyst ${RUN}`, status: 'published' }).expect(201)).body.id;
    const add = (body: object) => api().post(`/organizations/${org}/jobs/${job}/requirements`).set(bearer(owner)).send(body).expect(201);
    await add({ requirement_type: 'experience', description_en: 'Building sales dashboards and SQL reporting', description_ar: 'بناء لوحات المبيعات وتقارير SQL', min_years: 2 });
    await add({ requirement_type: 'competency', description_en: 'Negotiating supplier contracts', is_mandatory: false });
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({
      full_name: 'Test Candidate One', headline: 'Junior data analyst',
      experience: [{ title: 'Data analyst', organization: 'Fictional Retail Co', start_year: 2021, end_year: 2024, description: 'Built weekly sales dashboards in Power BI and wrote SQL reporting queries.' }],
    }).expect(200);
    application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201)).body.id;
  });

  it('proposes a status per requirement, with the evidence line it used and why', async () => {
    const res = await api().get(`${matchPath()}?wait=true`).set(bearer(owner)).expect(200);
    rows = res.body.requirements;
    expect(rows).toHaveLength(2);
    const dashboards = rows.find((r) => r.kind === 'experience')!;
    expect(['matched', 'partial']).toContain(dashboards.proposal!.status);
    expect(dashboards.proposal!.evidence_source).toBe('experience');
    expect(dashboards.proposal!.evidence_text).toContain('sales dashboards');
    const contracts = rows.find((r) => r.kind === 'competency')!;
    expect(contracts.proposal).toMatchObject({ status: 'missing', evidence_text: null, reason_code: 'missing' });
    expect(res.body.summary.counts.missing).toBeGreaterThanOrEqual(1);
    expect(res.body.provenance).toMatchObject({ mode: 'deterministic' });
    expect(res.body.evidence_lines).toBeGreaterThan(0);
    // Contact details never become evidence.
    expect(JSON.stringify(res.body)).not.toContain(candidate.email);
  });

  it('lets staff read it, and only the organization: never another organization or the candidate', async () => {
    await api().get(`${matchPath()}?wait=true`).set(bearer(reviewer)).expect(200);
    expect([403, 404]).toContain((await api().get(`${matchPath()}?wait=true`).set(bearer(outsider))).status);
    expect([403, 404]).toContain((await api().get(`${matchPath()}?wait=true`).set(bearer(candidate))).status);
    expect((await api().get(`${matchPath()}?wait=true`)).status).toBe(401);
  });

  it('records reviews as a history: confirmed or corrected, by the roles that may, and never changes the application', async () => {
    const key = rows.find((r) => r.kind === 'competency')!.key;
    const before = (await api().get(`/organizations/${org}/applications/${application}/review`).set(bearer(owner)).expect(200)).body.status;
    await api().post(`${matchPath()}/reviews`).set(bearer(reviewer)).send({ requirement_key: key, status: 'missing', proposed_status: 'missing' }).expect(403);
    await api().post(`${matchPath()}/reviews`).set(bearer(outsider)).send({ requirement_key: key, status: 'missing', proposed_status: 'missing' }).expect((r) => expect([403, 404]).toContain(r.status));
    await api().post(`${matchPath()}/reviews`).set(bearer(owner)).send({ requirement_key: 'requirement:not-a-key', status: 'missing', proposed_status: 'missing' }).expect(400);
    await api().post(`${matchPath()}/reviews`).set(bearer(owner)).send({ requirement_key: key, status: 'unknown', proposed_status: 'missing' }).expect(400);
    const first = await api().post(`${matchPath()}/reviews`).set(bearer(owner)).send({ requirement_key: key, status: 'missing', proposed_status: 'missing' }).expect(201);
    expect(first.body).toMatchObject({ decision: 'confirmed', reviewer_id: owner.id });
    const second = await api().post(`${matchPath()}/reviews`).set(bearer(owner)).send({ requirement_key: key, status: 'partial', proposed_status: 'missing', note: 'Mentioned supplier work in the interview.' }).expect(201);
    expect(second.body.decision).toBe('corrected');
    const after = (await api().get(`${matchPath()}?wait=true`).set(bearer(owner)).expect(200)).body;
    expect(after.requirements.find((r: Row) => r.key === key).review).toMatchObject({ status: 'partial', decision: 'corrected', note: 'Mentioned supplier work in the interview.' });
    expect(after.reviewed).toBe(1);
    expect((await api().get(`/organizations/${org}/applications/${application}/review`).set(bearer(owner)).expect(200)).body.status).toBe(before);
  });

  it("shows the candidate their own profile against the job: calculateMatch, plus each requirement with its line", async () => {
    // A line added to the live profile after applying: the candidate's view uses it, the organization's snapshot doesn't.
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({
      full_name: 'Test Candidate One', headline: 'Junior data analyst',
      experience: [
        { title: 'Data analyst', organization: 'Fictional Retail Co', start_year: 2021, end_year: 2024, description: 'Built weekly sales dashboards in Power BI and wrote SQL reporting queries.' },
        { title: 'Note', description: 'No experience negotiating supplier contracts.' },
      ],
    }).expect(200);
    const mine = (await api().get(`/me/jobs/${job}/match`).set(bearer(candidate)).expect(200)).body;
    expect(mine).toHaveProperty('total');  // calculateMatch's answer is still there
    const contracts = mine.semantic.requirements.find((r: Row) => r.kind === 'competency');
    // The line says the opposite: never a match. Word comparison reads it as negated (missing); e5, which also relates the
    // positive lines to it, sends the conflict to a person. Both are the documented rule (matching.py), never "matched".
    expect([{ status: 'missing', reason_code: 'negated' }, { status: 'needs_review', reason_code: 'contradictory' }])
      .toContainEqual({ status: contracts.proposal.status, reason_code: contracts.proposal.reason_code });
    // The negating line is shown either as the evidence (negated) or beside it as the counter-evidence (contradictory).
    expect(contracts.proposal.reason_code === 'negated' ? contracts.proposal.evidence_text : contracts.proposal.counter_evidence_text).toContain('No experience negotiating supplier contracts');
    const dashboards = mine.semantic.requirements.find((r: Row) => r.kind === 'experience');
    expect(['matched', 'partial']).toContain(dashboards.proposal.status);
    // The organization still sees the profile as it was submitted.
    const theirs = (await api().get(`${matchPath()}?wait=true`).set(bearer(owner)).expect(200)).body;
    expect(theirs.requirements.find((r: Row) => r.kind === 'competency').proposal.reason_code).toBe('missing');
  });

  it('answers with the skills match alone when the analysis service is unreachable, and only for published jobs', async () => {
    const saved = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';  // nothing listens there
    try {
      const res = (await api().get(`/me/jobs/${job}/match`).set(bearer(candidate)).expect(200)).body;
      expect(res).toHaveProperty('total');
      expect(res.semantic).toEqual({ error: 'unavailable' });
    } finally {
      process.env.AI_SERVICE_URL = saved;
    }
    await api().get('/me/jobs/00000000-0000-4000-8000-000000000000/match').set(bearer(candidate)).expect(404);
    await api().get(`/me/jobs/${job}/match`).expect(401);
  });

  it("refuses direct writes outside the organization, and closes with the application's withdrawal", async () => {
    const res = await fetch(`${BASE}/rest/v1/application_match_reviews`, {
      method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${outsider.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ application_id: application, org_id: org, requirement_key: rows[0].key, decision: 'confirmed', status: 'matched', proposed_status: 'matched', reviewer_id: outsider.id }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await api().post(`/applications/${application}/withdraw`).set(bearer(candidate)).expect(201);
    await api().get(`${matchPath()}?wait=true`).set(bearer(owner)).expect(404);
    await api().post(`${matchPath()}/reviews`).set(bearer(owner)).send({ requirement_key: rows[0].key, status: 'matched', proposed_status: 'matched' }).expect(404);
  });
});
