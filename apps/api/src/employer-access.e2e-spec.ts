// Employer access through the real stack (20261112090000_employer_access_requests): only the registry's supported
// employers, and nobody gets an employer workspace without a platform administrator's approval. Representatives are
// fictional accounts created through the local Auth administration with confirmed emails, so sign-up provisioning runs
// exactly as after a verification link. Local stack only.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';
import { platformAdminToken } from './test-support/approve-organization';

loadEnv('.env', '.env.test.local');

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const RUN = Date.now().toString(36);
type Session = { id: string; email: string; token: string };

function serviceKey() {
  const secret = readFileSync(resolve(__dirname, '../../../scripts/local-supabase.mjs'), 'utf8').match(/jwtSecret: '([^']+)'/)![1];
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const admin = { apikey: KEY, authorization: `Bearer ${serviceKey()}`, 'content-type': 'application/json' };
const created: string[] = [];

/** A representative who registered for `registry` and verified their email. */
async function representative(name: string, meta: Record<string, unknown>): Promise<Session> {
  const email = `access-${name}-${RUN}@example.org`;
  const password = `Access-${RUN}-${name}-x9`;
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: `Rep ${name} (fictional)`, midan_test_access: process.env.DEV_TEST_ACCESS_CODE, ...meta } }),
  });
  if (!res.ok) throw new Error(`creating ${email}: ${res.status} ${await res.text()}`);
  created.push((await res.json()).id);
  return signIn(email, password);
}
async function signIn(email: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = (await res.json()) as { access_token: string; user: { id: string; email: string } };
  if (!res.ok) throw new Error(`Sign-in failed for ${email}`);
  return { id: body.user.id, email: body.user.email, token: body.access_token };
}
async function fixture(name: string): Promise<Session> {
  return signIn(process.env[`TEST_${name}_EMAIL`] as string, process.env[`TEST_${name}_PASSWORD`] as string);
}
async function rest(who: Session, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: { apikey: KEY, authorization: `Bearer ${who.token}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('employer access: the supported employers only, and only with a platform administrator\'s approval', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session | string) => ({ Authorization: `Bearer ${typeof s === 'string' ? s : s.token}` });
  let adminToken: string;
  let owner: Session, candidate: Session;
  let registryA: string, registryB: string;
  let repA: Session, repB: Session, repC: Session, repD: Session;
  let orgA: string, orgC: string;
  const requestOf = async (s: Session) => (await api().get('/me/employer-access').set(bearer(s)).expect(200)).body;

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    adminToken = await platformAdminToken();
    [owner, candidate] = await Promise.all([fixture('ORG_A_OWNER'), fixture('CANDIDATE_ONE')]);
    const registry = (await api().get('/reference/employers').expect(200)).body as { id: string }[];
    expect(registry.length).toBeGreaterThanOrEqual(3);
    [registryA, registryB] = [registry[0].id, registry[1].id];
    const meta = (registry: string) => ({ account_type: 'organization', registry_id: registry, job_title: 'HR Manager (fictional)', verification_note: 'Department: HR; manager: fictional' });
    [repA, repB, repC, repD] = await Promise.all([representative('a', meta(registryA)), representative('b', meta(registryA)), representative('c', meta(registryB)), representative('d', meta(registryA))]);
  });
  afterAll(async () => {
    // Revoke what this run approved (an administrator may leave a registry workspace without an owner), then delete.
    const mine = ((await api().get('/admin/employer-access').set(bearer(adminToken))).body as { id: string; status: string; work_email: string }[] ?? [])
      .filter((r) => r.status === 'approved' && r.work_email.includes(RUN));
    for (const r of mine) await api().post(`/admin/employer-access/${r.id}/revoke`).set(bearer(adminToken)).send({ note: 'Test cleanup' });
    for (const id of created) await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
    await app.close();
  });

  it('turns a verified registration into a pending request, and grants nothing', async () => {
    const mine = await requestOf(repA);
    expect(mine).toMatchObject({ status: 'pending_approval', registry_id: registryA, source: 'registration', job_title: 'HR Manager (fictional)', org_id: null });
    expect(mine.partnership_status).toBe('not_partner');
    expect((await api().get('/me').set(bearer(repA)).expect(200)).body.organization_members).toEqual([]);
  });

  it('refuses arbitrary organizations, unknown employers and a second open request', async () => {
    await api().post('/organizations').set(bearer(repA)).send({ slug: `arbitrary-${RUN}`, name_ar: 'جهة', name_en: 'Arbitrary Co' }).expect(403);
    // The same through the Data API: the function refuses, and the table has no insert policy at all.
    expect((await rest(repA, 'POST', 'rpc/create_organization', { p_slug: `arbitrary-rpc-${RUN}`, p_name_ar: 'جهة', p_name_en: 'Arbitrary' })).status).toBe(403);
    expect((await rest(repA, 'POST', 'organizations', { slug: `arbitrary-rest-${RUN}`, name_ar: 'جهة', name_en: 'Arbitrary' })).status).toBeGreaterThanOrEqual(400);
    await api().post('/me/employer-access').set(bearer(repA)).send({ registry_id: '00000000-0000-4000-8000-000000000000', representative_name: 'X', job_title: 'Y' }).expect(400); // name too short
    expect([404, 422]).toContain((await api().post('/me/employer-access').set(bearer(repC)).send({ registry_id: '00000000-0000-4000-8000-000000000000', representative_name: 'Rep C', job_title: 'Manager' })).status);
    // A candidate account can't ask for employer access.
    expect((await api().post('/me/employer-access').set(bearer(candidate)).send({ registry_id: registryA, representative_name: 'Cand', job_title: 'Manager' })).status).toBe(403);
    // One open request at a time: asking again returns the same pending request.
    const again = (await api().post('/me/employer-access').set(bearer(repA)).send({ registry_id: registryB, representative_name: 'Rep A', job_title: 'Manager' }).expect(201)).body;
    expect(again).toMatchObject({ registry_id: registryA, status: 'pending_approval' });
  });

  it('keeps an unapproved representative out of every workspace and out of administration', async () => {
    const someOrg = (await api().get('/me').set(bearer(owner)).expect(200)).body.organization_members[0].org_id;
    expect([403, 404]).toContain((await api().get(`/organizations/${someOrg}`).set(bearer(repA))).status);
    expect([403, 404]).toContain((await api().get(`/organizations/${someOrg}/jobs`).set(bearer(repA))).status);
    await api().get('/admin/employer-access').set(bearer(repA)).expect(403);
  });

  it('lets only a platform administrator decide, never the requester or an organization owner', async () => {
    const { id } = await requestOf(repA);
    await api().post(`/admin/employer-access/${id}/decision`).set(bearer(repA)).send({ decision: 'approve' }).expect(403);
    await api().post(`/admin/employer-access/${id}/decision`).set(bearer(owner)).send({ decision: 'approve' }).expect(403);
    expect((await rest(repA, 'POST', 'rpc/admin_decide_employer_access', { p_request: id, p_decision: 'approve' })).status).toBe(403);
    // Nobody can write requests directly.
    expect((await rest(repA, 'PATCH', `employer_access_requests?id=eq.${id}`, { status: 'approved' })).status).toBeGreaterThanOrEqual(400);
    expect((await requestOf(repA)).status).toBe('pending_approval');
  });

  it('approves into the employer\'s single workspace: owner first, then the role chosen, never a duplicate workspace', async () => {
    // The first representative of a workspace becomes its owner (a workspace left from an earlier run may have one).
    const before = ((await api().get('/admin/employer-access/workspaces').set(bearer(adminToken)).expect(200)).body as { registry_id: string; is_test: boolean; members: { role: string }[] }[])
      .find((w) => w.registry_id === registryA && w.is_test);
    const expected = before?.members.some((m) => m.role === 'owner') ? 'recruiter' : 'owner';
    const a = (await api().post(`/admin/employer-access/${(await requestOf(repA)).id}/decision`).set(bearer(adminToken)).send({ decision: 'approve', note: 'Checked with HR (fictional)' }).expect(201)).body;
    expect(a).toMatchObject({ status: 'approved', granted_role: expected });
    orgA = a.org_id;
    const workspace = (await api().get(`/organizations/${orgA}`).set(bearer(repA)).expect(200)).body;
    expect(workspace.employer_registry_id ?? registryA).toBe(registryA);
    const b = (await api().post(`/admin/employer-access/${(await requestOf(repB)).id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' }).expect(201)).body;
    expect(b).toMatchObject({ status: 'approved', org_id: orgA, granted_role: 'recruiter' });
    await api().get(`/organizations/${orgA}`).set(bearer(repB)).expect(200);
    // A decided request can't be decided again.
    expect((await api().post(`/admin/employer-access/${b.id}/decision`).set(bearer(adminToken)).send({ decision: 'reject', note: 'again' })).status).toBe(422);
    const workspaces = (await api().get('/admin/employer-access/workspaces').set(bearer(adminToken)).expect(200)).body.filter((w: { registry_id: string; org_id: string }) => w.registry_id === registryA && w.org_id);
    expect(workspaces.filter((w: { org_id: string }) => w.org_id === orgA)).toHaveLength(1);
  });

  it('isolates one employer\'s workspace from another\'s, through the API and the Data API', async () => {
    orgC = (await api().post(`/admin/employer-access/${(await requestOf(repC)).id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' }).expect(201)).body.org_id;
    expect(orgC).not.toBe(orgA);
    expect([403, 404]).toContain((await api().get(`/organizations/${orgA}`).set(bearer(repC))).status);
    expect([403, 404]).toContain((await api().get(`/organizations/${orgA}/applications`).set(bearer(repC))).status);
    expect((await rest(repC, 'GET', `organization_members?org_id=eq.${orgA}&select=user_id`)).body).toEqual([]);
    expect((await rest(repC, 'GET', `employer_access_requests?select=id`)).body).toHaveLength(1); // only their own
  });

  it('admits no one by a direct insert or a membership update, even the workspace owner', async () => {
    expect((await rest(repA, 'POST', 'organization_members', { org_id: orgA, user_id: repD.id, role: 'admin' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(repA, 'PATCH', `organization_members?org_id=eq.${orgA}&user_id=eq.${repB.id}`, { user_id: repD.id })).status).toBeGreaterThanOrEqual(400);
    expect([403, 404]).toContain((await api().get(`/organizations/${orgA}`).set(bearer(repD))).status);
  });

  it('turns an invitation into a real employer workspace into a request for the administrator', async () => {
    const email = `access-e-${RUN}@example.org`;
    await api().post(`/organizations/${orgA}/team/invitations`).set(bearer(repA)).send({ email, role: 'reviewer' }).expect(201);
    const repE = await representative('e', {});
    const invitation = ((await api().get('/me/invitations').set(bearer(repE)).expect(200)).body as { id: string; org_id: string }[]).find((i) => i.org_id === orgA)!;
    await api().post(`/me/invitations/${invitation.id}/accept`).set(bearer(repE)).expect(201);
    expect([403, 404]).toContain((await api().get(`/organizations/${orgA}`).set(bearer(repE))).status);
    expect(await requestOf(repE)).toMatchObject({ status: 'pending_approval', source: 'invitation', registry_id: registryA, requested_role: 'reviewer' });
  });

  it('rejects with a note, and revokes approved access', async () => {
    const d = (await api().post(`/admin/employer-access/${(await requestOf(repD)).id}/decision`).set(bearer(adminToken)).send({ decision: 'reject', note: 'Could not verify (fictional)' }).expect(201)).body;
    expect(d.status).toBe('rejected');
    expect((await api().get('/me').set(bearer(repD)).expect(200)).body.organization_members).toEqual([]);
    const { id } = await requestOf(repB);
    await api().post(`/admin/employer-access/${id}/revoke`).set(bearer(repA)).send({ note: 'x' }).expect(403);
    expect((await api().post(`/admin/employer-access/${id}/revoke`).set(bearer(adminToken)).send({ note: 'Left the organization (fictional)' }).expect(201)).body.status).toBe('revoked');
    expect([403, 404]).toContain((await api().get(`/organizations/${orgA}`).set(bearer(repB))).status);
    // Revoking the workspace's owner works too (the last-owner rule doesn't block the administrator).
    const owners = ((await api().get('/admin/employer-access').set(bearer(adminToken)).expect(200)).body as { id: string; status: string; org_id: string; granted_role: string; work_email: string }[])
      .filter((r) => r.status === 'approved' && r.org_id === orgC && r.work_email.includes(RUN));
    expect((await api().post(`/admin/employer-access/${owners[0].id}/revoke`).set(bearer(adminToken)).send({ note: 'Owner left (fictional)' }).expect(201)).body.status).toBe('revoked');
    expect([403, 404]).toContain((await api().get(`/organizations/${orgC}`).set(bearer(repC))).status);
    const history = (await api().get('/admin/employer-access/history').set(bearer(adminToken)).expect(200)).body as { action: string; request_id: string }[];
    expect(history.filter((h) => h.request_id === id).map((h) => h.action)).toEqual(expect.arrayContaining(['request', 'approve', 'revoke']));
  });

  it('keeps the existing employer accounts and the fixtures working', async () => {
    const mine = (await api().get('/me').set(bearer(owner)).expect(200)).body.organization_members;
    expect(mine.length).toBeGreaterThan(0);
    await api().get(`/organizations/${mine[0].org_id}`).set(bearer(owner)).expect(200);
    const test = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-access-${RUN}`, name_ar: 'جهة اختبار', name_en: 'Access test org' }).expect(201)).body;
    expect(test.id).toBeTruthy();
  });

  it('never changes the registry records', async () => {
    const after = (await api().get('/reference/employers').expect(200)).body as { id: string; partnership_status?: string }[];
    expect(after.find((e) => e.id === registryA)).toBeTruthy();
    const workspaces = (await api().get('/admin/employer-access/workspaces').set(bearer(adminToken)).expect(200)).body as { partnership_status: string }[];
    expect(new Set(workspaces.map((w) => w.partnership_status))).toEqual(new Set(['not_partner']));
  });
});
