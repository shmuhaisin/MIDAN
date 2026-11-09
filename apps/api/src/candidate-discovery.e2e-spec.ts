// Candidate discovery through the real stack: saved jobs belong to their candidate only and only published jobs can be
// saved; a job past its application deadline isn't offered and refuses applications (enforced by the database); results
// sort by deadline. Fictional data, local only.
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

const day = (offset: number) => new Date(Date.now() + 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

describe('candidate discovery', () => {
  let app: INestApplication;
  let owner: Session, candidate: Session, other: Session;
  let org: string, open: string, soon: string, closed: string, draft: string;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, candidate, other] = await Promise.all(['ORG_A_OWNER', 'CANDIDATE_ONE', 'CANDIDATE_TWO'].map(signIn));
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate One' }).expect(200);
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug: `midan-test-discovery-${RUN}`, name_ar: 'جهة اكتشاف', name_en: 'Discovery org' }).expect(201)).body.id;
    const make = async (title: string, status: string, deadline: string | null) => {
      const id = (await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ title_ar: title, title_en: title, description_en: `Discovery ${RUN}`, status }).expect(201)).body.id;
      if (deadline) await api().patch(`/organizations/${org}/jobs/${id}`).set(bearer(owner)).send({ application_deadline: deadline }).expect(200);
      return id;
    };
    open = await make(`Open role ${RUN}`, 'published', day(30));
    soon = await make(`Soon role ${RUN}`, 'published', day(2));
    closed = await make(`Closed role ${RUN}`, 'published', day(-1));
    draft = await make(`Draft role ${RUN}`, 'draft', null);
  });
  afterAll(() => app.close());

  const search = (extra = '') => api().get(`/jobs?q=${RUN}&page=1&page_size=50${extra}`).set(bearer(candidate)).expect(200).then((r) => r.body.items.map((j: { id: string }) => j.id));

  it('offers only jobs still open to applications, and the closed one only when asked', async () => {
    const ids = await search();
    expect(ids).toEqual(expect.arrayContaining([open, soon]));
    expect(ids).not.toContain(closed);
    expect(ids).not.toContain(draft);
    expect(await search('&include_closed=1')).toContain(closed);
  });

  it('sorts by the soonest deadline', async () => {
    const ids = await search('&sort=deadline');
    expect(ids.indexOf(soon)).toBeLessThan(ids.indexOf(open));
  });

  it('refuses an application after the deadline, in the database, and accepts one before it', async () => {
    expect((await api().post(`/jobs/${closed}/applications`).set(bearer(candidate)).send({})).status).toBe(422);
    await api().post(`/jobs/${soon}/applications`).set(bearer(candidate)).send({}).expect(201);
  });

  it('saves published jobs for their candidate only', async () => {
    await api().put(`/me/saved-jobs/${open}`).set(bearer(candidate)).expect(200);
    await api().put(`/me/saved-jobs/${open}`).set(bearer(candidate)).expect(200); // saving twice changes nothing
    await api().put(`/me/saved-jobs/${draft}`).set(bearer(candidate)).expect(404);
    const mine = (await api().get('/me/saved-jobs').set(bearer(candidate)).expect(200)).body;
    expect(mine.map((j: { id: string }) => j.id)).toEqual([open]);
    expect(mine[0].organizations.name_en).toBe('Discovery org');
    // Another candidate sees none of it, and can't remove it.
    expect((await api().get('/me/saved-jobs').set(bearer(other)).expect(200)).body.map((j: { id: string }) => j.id)).not.toContain(open);
    await api().delete(`/me/saved-jobs/${open}`).set(bearer(other)).expect(200);
    expect((await api().get('/me/saved-jobs').set(bearer(candidate)).expect(200)).body).toHaveLength(1);
    await api().delete(`/me/saved-jobs/${open}`).set(bearer(candidate)).expect(200);
    expect((await api().get('/me/saved-jobs').set(bearer(candidate)).expect(200)).body).toHaveLength(0);
    expect((await api().get('/me/saved-jobs')).status).toBe(401);
  });
});
