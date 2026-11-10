import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

loadEnv('.env', '.env.test.local');
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
type Person = { id: string; token: string; email: string };
const headers = { apikey: KEY, 'content-type': 'application/json' };
async function signIn(email: string, password: string): Promise<Person> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Local sign-in failed: ${res.status}`);
  const body = await res.json() as { access_token: string; user: { id: string } };
  return { id: body.user.id, token: body.access_token, email };
}
async function representative(): Promise<Person> {
  // Deliberately outside the privileged midan.test email pattern.
  const email = `access-${randomUUID()}@example.com`, password = randomBytes(20).toString('hex');
  const res = await fetch(`${BASE}/auth/v1/signup`, { method: 'POST', headers,
    body: JSON.stringify({ email, password, data: { midan_test_access: 'local-dev-access', display_name: 'Access representative' } }) });
  if (!res.ok) throw new Error(`Local signup failed: ${res.status}`);
  let link: string | undefined;
  for (let i = 0; i < 20 && !link; i++) {
    const mail = await (await fetch(`${BASE}/__mail?to=${encodeURIComponent(email)}`)).json() as { links: string[] }[];
    link = mail[0]?.links.find((l) => l.includes('/verify'));
    if (!link) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!link) throw new Error('Local verification mail missing');
  expect((await fetch(link, { redirect: 'manual' })).status).toBe(303);
  return signIn(email, password);
}

describe('restricted employer access (isolated local stack)', () => {
  let app: INestApplication, admin: Person, owner: Person, first: Person, second: Person, outsider: Person;
  const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54323}/midan` });
  const api = () => request(app.getHttpServer());
  const bearer = (p: Person) => ({ Authorization: `Bearer ${p.token}` });
  let registry: string, org: string, requestId: string, rejectedId: string, sandbox: string;
  const ownedUsers: string[] = [];
  async function rest(p: Person, method: string, path: string, body: unknown) {
    return fetch(`${BASE}/rest/v1/${path}`, { method, headers: { ...headers, authorization: `Bearer ${p.token}`, prefer: 'return=representation' }, body: JSON.stringify(body) });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init(); await db.connect();
    admin = await signIn(process.env.TEST_PLATFORM_ADMIN_EMAIL!, process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
    owner = await signIn(process.env.TEST_ORG_A_OWNER_EMAIL!, process.env.TEST_ORG_A_OWNER_PASSWORD!);
    for (let i = 0; i < 3; i++) { const p = await representative(); ownedUsers.push(p.id); if (i === 0) first = p; else if (i === 1) second = p; else outsider = p; }
    // Each run owns one registry fixture and never edits existing registry identities or demo records.
    registry = randomUUID();
    await db.query(`insert into public.employer_registry(id,source_company_id,name_ar,name_en,verification_status,source_file)
      values($1,$2,'جهة اختبار معزولة','Isolated access fixture','verified','employer-access.e2e')`, [registry, `access-${registry}`]);
    sandbox = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-access-${randomUUID()}`, name_ar: 'اختبار', name_en: 'Sandbox' }).expect(201)).body.id;
  });
  afterAll(async () => {
    // Only this suite's fixtures; never the shared demo seed or other suites' records.
    await db.query('delete from public.organizations where id = any($1::uuid[])', [[org, sandbox].filter(Boolean)]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [ownedUsers]);
    await db.query('delete from public.employer_registry where id=$1', [registry]);
    await db.end(); await app?.close();
  });

  it('denies arbitrary company creation and unknown registry requests', async () => {
    await api().post('/organizations').set(bearer(first)).send({ slug: `unknown-${randomUUID()}`, name_ar: 'شركة', name_en: 'Unknown' }).expect(403);
    await api().post('/me/employer-access').set(bearer(first)).send({ registry_id: randomUUID(), representative_name: 'Representative', job_title: 'Recruiter' }).expect(422);
  });
  it('opens an idempotent pending request without granting membership', async () => {
    const body = { registry_id: registry, representative_name: 'Representative', job_title: 'Recruiter' };
    const result = await api().post('/me/employer-access').set(bearer(first)).send(body).expect(201);
    requestId = result.body.id; expect(result.body.status).toBe('pending_approval');
    expect((await api().post('/me/employer-access').set(bearer(first)).send(body).expect(201)).body.id).toBe(requestId);
    expect((await db.query('select 1 from public.organization_members where user_id=$1', [first.id])).rowCount).toBe(0);
  });
  it('denies non-admin decisions, admin reads and direct request writes', async () => {
    await api().get('/admin/employer-access').set(bearer(first)).expect(403);
    await api().post(`/admin/employer-access/${requestId}/decision`).set(bearer(first)).send({ decision: 'approve' }).expect(403);
    expect((await rest(first, 'POST', 'rpc/admin_decide_employer_access', { p_request: requestId, p_decision: 'approve' })).status).toBe(403);
    expect((await rest(first, 'PATCH', `employer_access_requests?id=eq.${requestId}`, { status: 'approved' })).status).toBe(403);
    expect((await rest(first, 'POST', 'rpc/admin_set_platform_admin', { p_email: first.email, p_grant: true })).status).toBe(403);
  });
  it('approves into the registry workspace and records the audit', async () => {
    const result = await api().post(`/admin/employer-access/${requestId}/decision`).set(bearer(admin)).send({ decision: 'approve' }).expect(201);
    org = result.body.org_id; expect(result.body).toMatchObject({ status: 'approved', granted_role: 'owner' });
    expect((await db.query('select employer_registry_id,is_test from public.organizations where id=$1', [org])).rows[0]).toEqual({ employer_registry_id: registry, is_test: true });
    expect((await api().get('/admin/employer-access/history').set(bearer(admin)).expect(200)).body.some((a: { action: string; request_id: string }) => a.action === 'approve' && a.request_id === requestId)).toBe(true);
  });
  it('blocks direct member insertion into registry-linked test workspaces', async () => {
    expect((await rest(first, 'POST', 'organization_members', { org_id: org, user_id: second.id, role: 'recruiter' })).status).toBe(403);
  });
  it('keeps direct fixture membership limited to unlinked sandboxes', async () => {
    expect((await rest(owner, 'POST', 'organization_members', { org_id: sandbox, user_id: outsider.id, role: 'reviewer' })).status).toBe(201);
  });
  it('blocks membership identity transfer while allowing authorized role updates', async () => {
    expect((await rest(first, 'PATCH', `organization_members?org_id=eq.${org}&user_id=eq.${first.id}`, { user_id: second.id })).status).toBe(403);
    expect((await rest(owner, 'PATCH', `organization_members?org_id=eq.${sandbox}&user_id=eq.${outsider.id}`, { role: 'recruiter' })).status).toBe(200);
    const escalation = await rest(outsider, 'PATCH', `organization_members?org_id=eq.${sandbox}&user_id=eq.${outsider.id}`, { role: 'owner' });
    // RLS hides rows outside UPDATE's USING predicate: PostgREST returns 200 with zero changed rows.
    expect(escalation.status).toBe(200); expect(await escalation.json()).toEqual([]);
    expect((await db.query('select role from public.organization_members where org_id=$1 and user_id=$2', [sandbox, outsider.id])).rows[0].role).toBe('recruiter');
  });
  it('denies cross-tenant access and does not grant rejected requests access', async () => {
    expect([403, 404]).toContain((await api().get(`/organizations/${org}/applications`).set(bearer(second))).status);
    rejectedId = (await api().post('/me/employer-access').set(bearer(second)).send({ registry_id: registry, representative_name: 'Second representative', job_title: 'Recruiter' }).expect(201)).body.id;
    expect((await api().post(`/admin/employer-access/${rejectedId}/decision`).set(bearer(admin)).send({ decision: 'reject' }).expect(201)).body.status).toBe('rejected');
    expect((await db.query('select 1 from public.organization_members where user_id=$1', [second.id])).rowCount).toBe(0);
  });
  it('requires approval for invitations into registry-linked test workspaces', async () => {
    const invitation = (await db.query(`insert into public.organization_invitations(org_id,email,role,invited_by,expires_at) values($1,$2,'reviewer',$3,now()+interval '1 day') returning id`, [org, second.email, first.id])).rows[0].id;
    await api().post(`/me/invitations/${invitation}/accept`).set(bearer(second)).expect(201);
    expect((await db.query('select 1 from public.organization_members where user_id=$1', [second.id])).rowCount).toBe(0);
    const pending = (await db.query(`select id from public.employer_access_requests where user_id=$1 and status='pending_approval'`, [second.id])).rows[0];
    expect(pending).toBeDefined();
    // Keep the existing last-owner safeguard: hand ownership to an approved representative before revoking the first.
    await api().post(`/admin/employer-access/${requestId}/revoke`).set(bearer(admin)).send({}).expect(422);
    expect((await api().post(`/admin/employer-access/${pending.id}/decision`).set(bearer(admin)).send({ decision: 'approve', role: 'owner' }).expect(201)).body.org_id).toBe(org);
  });
  it('revokes approved access and enforces the membership removal', async () => {
    expect((await api().post(`/admin/employer-access/${requestId}/revoke`).set(bearer(admin)).send({ note: 'Local regression' }).expect(201)).body.status).toBe('revoked');
    expect((await db.query('select 1 from public.organization_members where org_id=$1 and user_id=$2', [org, first.id])).rowCount).toBe(0);
    expect([403, 404]).toContain((await api().get(`/organizations/${org}/applications`).set(bearer(first))).status);
  });
});
