// Organization review through the real stack (20261111090000_organization_verification): a new organization can't
// recruit until a platform administrator approves it; decisions carry reasons, are audited and reach the organization;
// suspension hides its jobs and stops applications. Fictional data, local only.
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';
import { FICTIONAL_PROFILE, TINY_PDF, fictionalCr } from './test-support/approve-organization';

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

describe('organization review (20261111090000)', () => {
  let app: INestApplication;
  let admin: Session, owner: Session, outsider: Session, candidate: Session;
  let org: string, job: string, doc: string;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const base = () => `/organizations/${org}`;
  const status = async () => (await api().get(`${base()}/verification`).set(bearer(owner)).expect(200)).body.organization.verification_status;

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [admin, owner, outsider, candidate] = await Promise.all(['PLATFORM_ADMIN', 'ORG_A_OWNER', 'ORG_B_OWNER', 'CANDIDATE_ONE'].map(signIn));
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-review-${RUN}`, name_ar: 'جهة مراجعة', name_en: 'Review org' }).expect(201)).body.id;
    job = (await api().post(`${base()}/jobs`).set(bearer(owner)).send({ title_ar: `محلل ${RUN}`, title_en: `Analyst ${RUN}` }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('starts as a draft that cannot publish, invite or be reviewed by outsiders', async () => {
    expect(await status()).toBe('draft');
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(422);
    await api().post(`${base()}/jobs`).set(bearer(owner)).send({ title_ar: 'منشورة', title_en: 'Published', status: 'published' }).expect(422);
    await api().post(`${base()}/team/invitations`).set(bearer(owner)).send({ email: outsider.email, role: 'recruiter' }).expect(422);
    await api().get(`${base()}/verification`).set(bearer(outsider)).expect(403);
    await api().get(`${base()}/verification`).set(bearer(candidate)).expect(403);
  });

  it('does not let a member set its own status, directly or through the API', async () => {
    const direct = await rest(owner, 'PATCH', `organizations?id=eq.${org}`, { verification_status: 'approved' });
    expect(direct.status).not.toBe(200);
    await api().patch(`${base()}/profile`).set(bearer(owner)).send({ verification_status: 'approved' }).expect(400);
    expect(await status()).toBe('draft');
  });

  it('refuses to submit until the profile and a commercial registration document are present', async () => {
    await api().post(`${base()}/verification/submit`).set(bearer(owner)).expect(422);
    await api().patch(`${base()}/profile`).set(bearer(owner)).send({ commercial_registration: '12345' }).expect(400);
    await api().patch(`${base()}/profile`).set(bearer(owner))
      .send({ ...FICTIONAL_PROFILE, commercial_registration: fictionalCr(), company_type: 'private_company', industry: 'technology', description_en: 'A fictional company.' }).expect(200);
    await api().post(`${base()}/verification/submit`).set(bearer(owner)).expect(422);
    // Only a real PDF, PNG or JPEG, whatever the name says.
    await api().post(`${base()}/verification/documents`).set(bearer(owner)).field('kind', 'commercial_registration')
      .attach('file', Buffer.from('not a pdf'), { filename: 'cr.pdf', contentType: 'application/pdf' }).expect(422);
    await api().post(`${base()}/verification/documents`).set(bearer(outsider)).field('kind', 'commercial_registration')
      .attach('file', TINY_PDF, { filename: 'cr.pdf', contentType: 'application/pdf' }).expect(403);
    doc = (await api().post(`${base()}/verification/documents`).set(bearer(owner)).field('kind', 'commercial_registration')
      .attach('file', TINY_PDF, { filename: 'cr.pdf', contentType: 'application/pdf' }).expect(201)).body.id;
  });

  it('keeps documents private: the organization and platform administrators only', async () => {
    expect((await api().get(`${base()}/verification/documents/${doc}/url`).set(bearer(owner)).expect(200)).body.url).toContain('/storage/v1/object/sign/organization-documents/');
    await api().get(`${base()}/verification/documents/${doc}/url`).set(bearer(outsider)).expect(403);
    expect((await api().get(`/admin/organizations/${org}/documents/${doc}/url`).set(bearer(admin)).expect(200)).body.url).toBeTruthy();
    await api().get(`/admin/organizations/${org}/documents/${doc}/url`).set(bearer(owner)).expect(403);
    expect((await rest(outsider, 'GET', `organization_documents?org_id=eq.${org}`)).body).toEqual([]);
  });

  it('submits for review and locks what is being reviewed', async () => {
    const state = (await api().post(`${base()}/verification/submit`).set(bearer(owner)).expect(201)).body;
    expect(state.organization.verification_status).toBe('pending_review');
    expect(state.requests[0]).toMatchObject({ status: 'pending_review' });
    expect(state.requests[0].snapshot.documents).toHaveLength(1);
    await api().post(`${base()}/verification/submit`).set(bearer(owner)).expect(422);
    await api().patch(`${base()}/profile`).set(bearer(owner)).send({ name_en: 'Renamed while pending' }).expect(422);
    await api().post(`${base()}/verification/documents`).set(bearer(owner)).field('kind', 'other')
      .attach('file', TINY_PDF, { filename: 'more.pdf', contentType: 'application/pdf' }).expect(422);
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(422);
    // The platform administrators' queue shows it first.
    const listed = (await api().get('/admin/organizations?status=pending_review').set(bearer(admin)).expect(200)).body as { id: string; verification_status: string }[];
    expect(listed.find((o) => o.id === org)?.verification_status).toBe('pending_review');
    expect(listed.every((o) => o.verification_status === 'pending_review')).toBe(true);
    expect((await api().get('/admin/overview').set(bearer(admin)).expect(200)).body.counts.organizations_pending_review).toBeGreaterThanOrEqual(1);
  });

  it('lets only platform administrators decide, and requires a reason to refuse or ask for changes', async () => {
    await api().post(`/admin/organizations/${org}/decision`).set(bearer(owner)).send({ decision: 'approve' }).expect(403);
    await api().get(`/admin/organizations/${org}`).set(bearer(owner)).expect(403);
    await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'reject' }).expect(422);
    await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'request_changes', note: '   ' }).expect(422);
    await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'promote' }).expect(400);
    const state = (await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'request_changes', note: 'Add the authorization letter.' }).expect(201)).body;
    expect(state.organization.verification_status).toBe('changes_requested');
  });

  it('shows the organization the request and its reason, and lets it correct and resubmit', async () => {
    const state = (await api().get(`${base()}/verification`).set(bearer(owner)).expect(200)).body;
    expect(state.requests[0]).toMatchObject({ status: 'changes_requested', decision_note: 'Add the authorization letter.' });
    const notes = (await api().get('/me/notifications').set(bearer(owner)).expect(200)).body as { kind: string; link: string }[];
    expect(notes.some((n) => n.kind === 'organization_changes_requested' && n.link === `/organization/${org}/verification`)).toBe(true);
    await api().post(`${base()}/verification/documents`).set(bearer(owner)).field('kind', 'authorization_letter')
      .attach('file', TINY_PDF, { filename: 'letter.pdf', contentType: 'application/pdf' }).expect(201);
    await api().post(`${base()}/verification/submit`).set(bearer(owner)).expect(201);
    const detail = (await api().get(`/admin/organizations/${org}`).set(bearer(admin)).expect(200)).body;
    expect(detail.requests).toHaveLength(2);
    expect(detail.requests[0].snapshot.previous_status).toBe('changes_requested');
    expect(detail.requests[1].reviewed_by_email).toBe(admin.email);
    expect(detail.documents).toHaveLength(2);
  });

  it('approves: the organization can publish, invite and receive applications', async () => {
    const state = (await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(state.organization.verification_status).toBe('approved');
    await api().post(`/admin/organizations/${org}/decision`).set(bearer(admin)).send({ decision: 'approve' }).expect(404);
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(200);
    // This is a test organization: its published job is open to the test accounts, and "not found" to anyone else,
    // even with a direct link (common/test-data.ts, viewableJob).
    await api().get(`/jobs/${job}`).set(bearer(candidate)).expect(200);
    await api().get(`/jobs/${job}`).expect(404);
    // What was approved is locked; the description can still be improved.
    await api().patch(`${base()}/profile`).set(bearer(owner)).send({ name_en: 'Renamed after approval' }).expect(422);
    await api().patch(`${base()}/profile`).set(bearer(owner)).send({ description_en: 'A fictional company, described better.' }).expect(200);
  });

  it('suspends with a reason: its jobs leave the public listing and receive no applications; reactivation restores them', async () => {
    await api().post(`/admin/organizations/${org}/suspension`).set(bearer(admin)).send({ suspend: true, reason: ' ' }).expect(422);
    await api().post(`/admin/organizations/${org}/suspension`).set(bearer(admin)).send({ suspend: false, reason: 'Not suspended' }).expect(422);
    await api().post(`/admin/organizations/${org}/suspension`).set(bearer(owner)).send({ suspend: true, reason: 'x' }).expect(403);
    await api().post(`/admin/organizations/${org}/suspension`).set(bearer(admin)).send({ suspend: true, reason: 'Reported listing under investigation.' }).expect(201);
    expect(await status()).toBe('suspended');
    // Suspension hides it even from the test accounts that could see it before.
    await api().get(`/jobs/${job}`).set(bearer(candidate)).expect(404);
    expect((await rest(null, 'GET', `jobs?id=eq.${job}`)).body).toEqual([]);
    await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect((res) => expect([404, 422]).toContain(res.status));
    await api().get(`${base()}/jobs/${job}`).set(bearer(owner)).expect(200);
    await api().post(`/admin/organizations/${org}/suspension`).set(bearer(admin)).send({ suspend: false, reason: 'Investigation closed.' }).expect(201);
    expect(await status()).toBe('approved');
    await api().get(`/jobs/${job}`).set(bearer(candidate)).expect(200);
  });

  it('records every step in the audit log, with who, what and why', async () => {
    const audit = (await api().get(`/admin/organizations/${org}`).set(bearer(admin)).expect(200)).body.audit as { action: string; details: { to?: string; reason?: string | null }; actor_email: string }[];
    const actions = audit.map((a) => a.action).reverse();
    expect(actions).toEqual(['submit', 'request_changes', 'submit', 'approve', 'suspend', 'reactivate']);
    expect(audit.find((a) => a.action === 'suspend')).toMatchObject({ actor_email: admin.email, details: { to: 'suspended', reason: 'Reported listing under investigation.' } });
    expect(audit.find((a) => a.action === 'request_changes')?.details.reason).toBe('Add the authorization letter.');
  });

  it('refuses rejection notes the organization can see only through its own record', async () => {
    // Another organization's owner learns nothing about this one's review.
    expect((await rest(outsider, 'GET', `organization_verification_requests?org_id=eq.${org}`)).body).toEqual([]);
    await api().get(`/admin/organizations?status=approved`).set(bearer(outsider)).expect(403);
  });
});
