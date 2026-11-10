// Several representatives of one supported employer, decided at the same moment (20261112090000: approvals serialize on
// the registry row). Every run uses its own registry employer, inserted and removed here, so no existing registry
// identity, workspace or demo record is touched. Local stack only.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
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
const authAdmin = { apikey: KEY, authorization: `Bearer ${serviceKey()}`, 'content-type': 'application/json' };
const created: string[] = [];

/** A fictional representative whose sign-up was verified (provisioning runs as after the email link). */
async function representative(name: string, meta: Record<string, unknown>): Promise<Session> {
  const email = `concurrent-${name}-${RUN}@example.org`;
  const password = `Concurrent-${RUN}-${name}-x9`;
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: authAdmin,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: `Rep ${name} (fictional)`, midan_test_access: process.env.DEV_TEST_ACCESS_CODE, ...meta } }),
  });
  if (!res.ok) throw new Error(`creating ${email}: ${res.status}`);
  created.push((await res.json()).id);
  const token = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = (await token.json()) as { access_token: string; user: { id: string } };
  if (!token.ok) throw new Error(`sign-in failed for ${email}`);
  return { id: session.user.id, email, token: session.access_token };
}

describe('employer access under concurrency: one workspace per employer, every approved representative in it', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session | string) => ({ Authorization: `Bearer ${typeof s === 'string' ? s : s.token}` });
  const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54323}/midan` });
  const registry = randomUUID();
  let adminToken: string;
  let reps: Session[];

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    await db.connect();
    await db.query(`insert into public.employer_registry (id, source_company_id, name_ar, name_en, verification_status, source_file)
      values ($1, $2, 'جهة اختبار التزامن', 'Concurrency fixture ${RUN}', 'verified', 'employer-access-concurrency.e2e')`, [registry, `concurrency-${registry}`]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    adminToken = await platformAdminToken();
    const meta = { account_type: 'organization', registry_id: registry, job_title: 'HR Officer (fictional)' };
    reps = await Promise.all(['a', 'b', 'c', 'd'].map((n) => representative(n, meta)));
  });
  afterAll(async () => {
    // Only this run's records: its workspace first (its members go with it, so the last-owner rule doesn't block deleting
    // the owner), then its users (their requests cascade), then its registry employer.
    await db.query('delete from public.organizations where employer_registry_id = $1', [registry]);
    for (const id of created) await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: authAdmin });
    await db.query('delete from public.employer_registry where id = $1', [registry]);
    await db.end();
    await app?.close();
  });

  it('gives each representative of the same employer their own pending request, and nothing else', async () => {
    for (const rep of reps) {
      expect((await api().get('/me/employer-access').set(bearer(rep)).expect(200)).body).toMatchObject({ registry_id: registry, status: 'pending_approval', org_id: null });
      expect((await api().get('/me').set(bearer(rep)).expect(200)).body.organization_members).toEqual([]);
    }
  });

  it('approves four representatives at the same moment into exactly one workspace with one owner', async () => {
    const ids = await Promise.all(reps.map(async (rep) => (await api().get('/me/employer-access').set(bearer(rep)).expect(200)).body.id as string));
    const results = await Promise.all(ids.map((id) => api().post(`/admin/employer-access/${id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const orgs = new Set(results.map((r) => r.body.org_id));
    expect(orgs.size).toBe(1);
    const [org] = [...orgs];
    expect(results.map((r) => r.body.granted_role).sort()).toEqual(['owner', 'recruiter', 'recruiter', 'recruiter']);
    const workspaces = (await db.query('select id, is_test from public.organizations where employer_registry_id = $1', [registry])).rows;
    expect(workspaces).toEqual([{ id: org, is_test: true }]);
    const members = (await db.query('select user_id, role from public.organization_members where org_id = $1 order by role', [org])).rows;
    expect(members.map((m) => m.user_id).sort()).toEqual(reps.map((r) => r.id).sort());
    for (const rep of reps) await api().get(`/organizations/${org}`).set(bearer(rep)).expect(200);
  });

  it('a later approval reuses the workspace', async () => {
    const late = await representative('e', { account_type: 'organization', registry_id: registry, job_title: 'Recruiter (fictional)' });
    const { id } = (await api().get('/me/employer-access').set(bearer(late)).expect(200)).body;
    const decided = (await api().post(`/admin/employer-access/${id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' }).expect(201)).body;
    expect((await db.query('select count(*)::int as n from public.organizations where employer_registry_id = $1', [registry])).rows[0].n).toBe(1);
    expect(decided).toMatchObject({ status: 'approved', granted_role: 'recruiter' });
  });

  it('answers concurrent duplicate requests from one person with the same open request', async () => {
    const rep = await representative('f', { account_type: 'organization' }); // no employer chosen at sign-up: no request yet
    const body = { registry_id: registry, representative_name: 'Rep F (fictional)', job_title: 'Talent Partner' };
    const answers = await Promise.all(Array.from({ length: 5 }, () => api().post('/me/employer-access').set(bearer(rep)).send(body)));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect((await db.query(`select count(*)::int as n from public.employer_access_requests where user_id = $1`, [rep.id])).rows[0].n).toBe(1);
    expect((await api().get('/me').set(bearer(rep)).expect(200)).body.organization_members).toEqual([]);
  });

  it('recovers a verified sign-up whose provisioning failed: the choice is kept, the retry is idempotent, nothing is granted', async () => {
    // A one-letter job title fails the request's check constraint inside provisioning; confirmation still succeeds.
    const rep = await representative('g', { account_type: 'organization', registry_id: registry, job_title: 'X' });
    expect((await api().get('/me/employer-access').set(bearer(rep)).expect(200)).body).toEqual({});
    expect((await db.query(`select details from public.audit_logs where action = 'provision_failed' and actor_id = $1`, [rep.id])).rows[0].details)
      .toMatchObject({ account_type: 'organization', sqlstate: '23514' });
    const choice = (await api().get('/me/employer-access/signup-choice').set(bearer(rep)).expect(200)).body;
    expect(choice).toMatchObject({ registry_id: registry, job_title: 'X' });
    const body = { registry_id: choice.registry_id, representative_name: 'Rep G (fictional)', job_title: 'HR Officer' };
    const first = (await api().post('/me/employer-access').set(bearer(rep)).send(body).expect(201)).body;
    const again = (await api().post('/me/employer-access').set(bearer(rep)).send(body).expect(201)).body;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ registry_id: registry, status: 'pending_approval' });
    expect((await api().get('/me').set(bearer(rep)).expect(200)).body.organization_members).toEqual([]);
    // Someone else's sign-up choice is never visible: the function reads only the caller's own account.
    expect((await api().get('/me/employer-access/signup-choice').set(bearer(adminToken)).expect(200)).body).toEqual({});
  });
});
