// Platform administration, the import pipeline, listing ingestion, job analysis and the background queue.
// Runs against the database in .env with the test accounts in .env.test.local, like foundation.e2e-spec.ts.
// Everything it creates is synthetic and marked (midan-test-*, started_by 'e2e'); supabase/test-cleanup.sql removes it.
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';
import { AuthUser } from './db/db.service';
import { BackgroundWorker } from './jobs-queue/worker';

loadEnv('.env', '.env.test.local');
const { Client } = createRequire(__filename)('pg') as typeof import('pg');

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const RUN = Date.now().toString(36);
const IMPORTER = process.env.IMPORT_DATABASE_URL ?? `postgresql://midan_importer:midan-importer-local@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan`;

type Session = AuthUser & { token: string };

async function signIn(name: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[`TEST_${name}_EMAIL`], password: process.env[`TEST_${name}_PASSWORD`] }),
  });
  const body = (await res.json()) as { access_token: string; user: AuthUser };
  if (!res.ok) throw new Error(`Sign-in failed for ${name}: ${res.status}`);
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

describe('Midan administration and data pipeline', () => {
  let app: INestApplication;
  let admin: Session, ownerA: Session, candidate: Session;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [admin, ownerA, candidate] = await Promise.all(['PLATFORM_ADMIN', 'ORG_A_OWNER', 'CANDIDATE_ONE'].map(signIn));
  });
  afterAll(() => app.close());

  describe('platform administration', () => {
    it('is refused to everyone who is not a platform administrator', async () => {
      await api().get('/admin/overview').expect(401);
      await api().get('/admin/overview').set(bearer(candidate)).expect(403);
      await api().get('/admin/overview').set(bearer(ownerA)).expect(403);
      await api().get('/admin/audit').set(bearer(ownerA)).expect(403);
      await api().post('/admin/admins').set(bearer(ownerA)).send({ email: ownerA.email, grant: true }).expect(403);
      // Straight to the database, the functions refuse too.
      expect((await rest(ownerA, 'POST', 'rpc/admin_set_platform_admin', { p_email: ownerA.email, p_grant: true })).status).toBe(403);
      expect((await rest(candidate, 'GET', 'import_runs')).body).toEqual([]);
      expect((await rest(null, 'GET', 'import_records')).status).toBe(401);
    });

    it('shows counts and integration status, saying only what is configured', async () => {
      const res = await api().get('/admin/overview').set(bearer(admin)).expect(200);
      expect(res.body.counts.employers).toBe(10);
      expect(res.body.counts.reference_skills).toBeGreaterThan(5000);
      expect(res.body.integrations.ai_service).toMatchObject({ reachable: true, mode: 'demo' });
      expect(res.body.integrations.daily).toEqual({ configured: Boolean(process.env.DAILY_API_KEY) });
    });

    it('grants and revokes administration, never to oneself by mistake, and audits it', async () => {
      await api().post('/admin/admins').set(bearer(admin)).send({ email: ownerA.email, grant: true }).expect(201);
      await api().get('/admin/overview').set(bearer(ownerA)).expect(200);
      await api().post('/admin/admins').set(bearer(admin)).send({ email: ownerA.email, grant: false }).expect(201);
      await api().get('/admin/overview').set(bearer(ownerA)).expect(403);
      await api().post('/admin/admins').set(bearer(admin)).send({ email: admin.email, grant: false }).expect(422);
      await api().post('/admin/admins').set(bearer(admin)).send({ email: `nobody-${RUN}@example.com`, grant: true }).expect(404);
      const audit = await api().get('/admin/audit?entity=platform_admins').set(bearer(admin)).expect(200);
      expect(audit.body.slice(0, 2).map((a: { action: string }) => a.action)).toEqual(['revoke', 'grant']);
      expect(audit.body[0].actor_email).toBe(admin.email);
    });

    it('lists accounts and organizations without any profile or CV content', async () => {
      const users = await api().get(`/admin/users?q=${encodeURIComponent('midan.test')}`).set(bearer(admin)).expect(200);
      expect(users.body.length).toBeGreaterThanOrEqual(5);
      expect(Object.keys(users.body[0]).sort()).toEqual(['created_at', 'display_name', 'email', 'id', 'memberships', 'platform_admin']);
      await api().get('/admin/organizations').set(bearer(admin)).expect(200);
    });
  });

  describe('imports and their lineage', () => {
    it('keeps every run with its sources, sheets and statistics', async () => {
      const runs = await api().get('/admin/imports').set(bearer(admin)).expect(200);
      const skills = runs.body.find((r: { kind: string; status: string }) => r.kind === 'sector_skills' && r.status === 'completed');
      expect(skills).toBeDefined();
      expect(skills.sources).toHaveLength(7);
      expect(skills.sources[0].sheets.length).toBeGreaterThan(5);
      expect(skills.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      const total = Object.values(skills.stats.by_status as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(5000);
      const employers = runs.body.find((r: { kind: string }) => r.kind === 'employer_registry');
      expect(employers.stats.by_entity.employer).toBe(10);
    });

    it('traces a record to its workbook, sheet and row, and keeps what the cell held', async () => {
      const runs = (await api().get('/admin/imports').set(bearer(admin)).expect(200)).body;
      const run = runs.find((r: { kind: string; status: string }) => r.kind === 'sector_skills' && r.status === 'completed');
      // A first import records rows as imported; a repeat records them as unchanged.
      let detail = await api().get(`/admin/imports/${run.id}?status=imported`).set(bearer(admin)).expect(200);
      if (!detail.body.records.length) detail = await api().get(`/admin/imports/${run.id}?status=unchanged`).set(bearer(admin)).expect(200);
      const record = detail.body.records.find((r: { entity: string }) => r.entity === 'reference_skill');
      expect(['imported', 'unchanged']).toContain(record.status);
      expect(record.source_file).toMatch(/\.xlsx$/);
      expect(record.source_sheet).toBeTruthy();
      expect(record.source_row).toBeGreaterThan(0);
      expect(typeof record.original_value).toBe('string');
      const skill = await rest(null, 'GET', `reference_skills?id=eq.${record.target_id}&select=name_ar,source_file,source_row,last_import_run_id`);
      expect(skill.body[0].source_file).toBe(record.source_file);
    });

    it('sends near-duplicates and priority disagreements to review instead of merging them', async () => {
      const review = await api().get('/admin/review').set(bearer(admin)).expect(200);
      const kinds = new Set(review.body.records.map((r: { issue_kind: string }) => r.issue_kind));
      expect(kinds.has('near_duplicate_name')).toBe(true);
      expect(kinds.has('priority_skill_not_in_skill_list')).toBe(true);
      const item = review.body.records.find((r: { issue_kind: string }) => r.issue_kind === 'near_duplicate_name');
      // Both spellings stayed as separate skills.
      expect(item.detail).toMatch(/not merged/);
      await api().post(`/admin/import-records/${item.id}/resolve`).set(bearer(ownerA)).send({ resolution: 'accepted' }).expect(403);
    });
  });

  describe('external job listings', () => {
    let importer: InstanceType<typeof Client>;
    let run: string;
    let skillNames: string[];
    const listing = (id: string, employer: string, extra: Record<string, unknown> = {}) => ({
      source_job_id: `midan-test-${RUN}-${id}`, employer_name_raw: employer, job_title: `وظيفة اختبار ${id}`,
      job_description: `نص تجريبي يذكر ${skillNames.join(' و ')} للاختبار فقط`, job_url: `https://example.com/midan-test/${RUN}/${id}`, ...extra,
    });

    beforeAll(async () => {
      importer = new Client({ connectionString: IMPORTER });
      await importer.connect();
      const found = await rest(null, 'GET', `reference_skills?sector_code=eq.digital&skill_kind=eq.technical&name_ar=like.*${encodeURIComponent(' ')}*&select=name_ar&order=name_ar&limit=3`);
      skillNames = found.body.map((s: { name_ar: string }) => s.name_ar);
      run = (await importer.query(`select private.begin_import('job_listings', '[]', 'e2e') as id`)).rows[0].id;
    });
    afterAll(() => importer.end());

    const importBatch = async (rows: unknown[]) =>
      (await importer.query('select private.import_listing_batch($1, $2, $3) as counts', [run, 'employer_provided', JSON.stringify(rows)])).rows[0].counts;
    const find = async (id: string) =>
      (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body.find((l: { source_job_id: string }) => l.source_job_id === `midan-test-${RUN}-${id}`);

    it('keeps the collected record, matches the employer with a stated confidence and classifies the text', async () => {
      const counts = await importBatch([
        listing('exact', 'وزارة التجارة'),
        listing('partial', 'التجارة'),
        listing('unknown', 'شركة غير موجودة في السجل'),
        listing('bad', 'وزارة التجارة', { job_url: 'http://example.com/not-https' }),
      ]);
      expect(counts).toMatchObject({ imported: 3, rejected: 1 });
      const exact = await find('exact');
      expect(exact).toMatchObject({ match_status: 'matched', source_company_id: 'ALM-001', review_status: 'pending', published: false, sector_code: 'digital' });
      expect(Number(exact.match_confidence)).toBe(1);
      expect(exact.match_evidence.rule).toBe('official_name');
      expect(exact.skills.length).toBeGreaterThanOrEqual(2);
      // Nothing was filled in that the source didn't state.
      expect(exact.location).toBeNull();
      expect(exact.employment_type).toBeNull();
      const partial = await find('partial');
      expect(partial.match_status).toBe('uncertain');
      expect(Number(partial.match_confidence)).toBeLessThan(0.9);
      expect((await find('unknown')).match_status).toBe('unmatched');
      const review = await api().get('/admin/review').set(bearer(admin)).expect(200);
      expect(review.body.listings.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining([exact.id, partial.id]));
    });

    it('updates a re-imported job in place and flags the same job from another source', async () => {
      const again = await importBatch([listing('exact', 'وزارة التجارة')]);
      expect(again).toEqual({ unchanged: 1 });
      await importBatch([listing('exact-copy', 'وزارة التجارة', { job_title: `وظيفة اختبار exact` , source_job_id: `midan-test-${RUN}-copy` })]);
      const all = (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body
        .filter((l: { title_original: string }) => l.title_original === 'وظيفة اختبار exact');
      expect(all).toHaveLength(2);
      const copy = all.find((l: { duplicate_of: string | null }) => l.duplicate_of);
      expect(copy.duplicate_of).toBe(all.find((l: { duplicate_of: string | null }) => !l.duplicate_of).id);
    });

    it('publishes only after review, with a confirmed employer, and never a duplicate', async () => {
      const exact = await find('exact');
      const partial = await find('partial');
      await api().post(`/admin/listings/${exact.id}/review`).set(bearer(ownerA)).send({ action: 'approve' }).expect(403);
      await api().post(`/admin/listings/${exact.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(422);
      await api().post(`/admin/listings/${exact.id}/review`).set(bearer(admin)).send({ action: 'approve' }).expect(201);
      await api().post(`/admin/listings/${exact.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(201);
      expect((await rest(null, 'GET', `external_job_listings?id=eq.${exact.id}&select=id`)).body).toHaveLength(1);

      await api().post(`/admin/listings/${partial.id}/review`).set(bearer(admin)).send({ action: 'approve' }).expect(201);
      await api().post(`/admin/listings/${partial.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(422);
      await api().post(`/admin/listings/${partial.id}/review`).set(bearer(admin)).send({ action: 'confirm_employer' }).expect(201);
      await api().post(`/admin/listings/${partial.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(201);

      const copy = (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body.find((l: { duplicate_of: string | null; title_original: string }) => l.duplicate_of && l.title_original === 'وظيفة اختبار exact');
      await api().post(`/admin/listings/${copy.id}/review`).set(bearer(admin)).send({ action: 'approve' }).expect(201);
      await api().post(`/admin/listings/${copy.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(422);

      for (const id of [exact.id, partial.id]) await api().post(`/admin/listings/${id}/review`).set(bearer(admin)).send({ action: 'unpublish' }).expect(201);
      const audit = await api().get('/admin/audit?entity=external_job_listings').set(bearer(admin)).expect(200);
      expect(audit.body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['approve', 'publish', 'confirm_employer', 'unpublish']));
    });

    it('records the run and finishes it with statistics', async () => {
      const done = (await importer.query(`select * from private.finish_import($1, '{}')`, [run])).rows[0];
      expect(done.status).toBe('completed');
      expect(done.stats.by_status.rejected).toBe(1);
      expect(done.stats.issues.uncertain_employer_match).toBeGreaterThanOrEqual(1);
      // The importer can't read or change anything else.
      await expect(importer.query('select count(*) from public.users')).rejects.toThrow(/permission denied/);
    });
  });

  describe('job analysis', () => {
    let org: string, job: string;
    it('proposes reference skills with the words that matched, and changes nothing until accepted', async () => {
      const skills = await rest(null, 'GET', `reference_skills?sector_code=eq.financial_services&skill_kind=eq.technical&name_ar=like.*${encodeURIComponent(' ')}*&select=id,name_ar&order=name_ar&limit=2`);
      const [first, second] = skills.body as { id: string; name_ar: string }[];
      org = (await api().post('/organizations').set(bearer(ownerA)).send({ slug: `midan-test-analysis-${RUN}`, name_ar: 'تحليل', name_en: 'Analysis' }).expect(201)).body.id;
      job = (await api().post(`/organizations/${org}/jobs`).set(bearer(ownerA)).send({ slug: 'analyst', title_ar: 'محلل', title_en: 'Analyst' }).expect(201)).body.id;
      // The same words can appear in several sectors' workbooks, so the employer's own choice of sector decides.
      await api().patch(`/organizations/${org}/jobs/${job}`).set(bearer(ownerA))
        .send({ sector: 'financial_services', description_ar: `يتطلب الدور ${first.name_ar} وكذلك ${second.name_ar}.` }).expect(200);

      await api().post(`/organizations/${org}/jobs/${job}/analyses`).set(bearer(candidate)).expect(403);
      const analysis = (await api().post(`/organizations/${org}/jobs/${job}/analyses`).set(bearer(ownerA)).expect(201)).body;
      expect(analysis).toMatchObject({ status: 'proposed', sector_code: 'financial_services', method: 'reference_skill_mentions_v1' });
      const mentioned = analysis.proposals.filter((p: { basis: string }) => p.basis === 'mentioned');
      expect(mentioned.map((p: { reference_skill_id: string }) => p.reference_skill_id)).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(mentioned[0].evidence).toBeTruthy();
      expect(mentioned[0].source.file).toMatch(/\.xlsx$/);
      expect(analysis.proposals.filter((p: { basis: string; required: boolean }) => p.basis === 'family' && p.required)).toEqual([]);
      expect((await rest(ownerA, 'GET', `job_reference_skills?job_id=eq.${job}`)).body).toEqual([]);

      const accepted = (await api().post(`/organizations/${org}/jobs/${job}/analyses/${analysis.id}/accept`).set(bearer(ownerA))
        .send({ skills: [first.id, second.id], required: [first.id], set_sector: true }).expect(201)).body;
      expect(accepted.status).toBe('accepted');
      const linked = (await rest(ownerA, 'GET', `job_reference_skills?job_id=eq.${job}&select=reference_skill_id,is_required`)).body;
      expect(linked).toEqual(expect.arrayContaining([{ reference_skill_id: first.id, is_required: true }, { reference_skill_id: second.id, is_required: false }]));
      await api().post(`/organizations/${org}/jobs/${job}/analyses/${analysis.id}/accept`).set(bearer(ownerA)).send({ skills: [], required: [], set_sector: false }).expect(422);
    });
  });

  describe('background queue', () => {
    it('refuses work queued for someone else, and queues the same work only once', async () => {
      const other = await signIn('CANDIDATE_TWO');
      await api().put('/me/candidate-profile').set(bearer(other)).send({ full_name: 'Test Candidate Two' }).expect(200);
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
      const upload = await api().post('/me/cv').set(bearer(other)).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(201);
      const forged = await rest(candidate, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id });
      expect(forged.status).toBe(403);
      const first = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id, p_dedupe: `midan-test-${RUN}` });
      const second = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id, p_dedupe: `midan-test-${RUN}` });
      expect(second.body.id).toBe(first.body.id);
      // The payload, which can hold a file link, isn't readable through the Data API, even by its owner.
      expect((await rest(other, 'GET', `background_jobs?id=eq.${first.body.id}&select=payload`)).status).not.toBe(200);
      expect((await rest(other, 'GET', `background_jobs?id=eq.${first.body.id}&select=id,status`)).body).toHaveLength(1);
    });

    it('retries when the AI service is down, then finishes when it is back, as the candidate', async () => {
      const worker = app.get(BackgroundWorker);
      const saved = process.env.AI_SERVICE_URL;
      process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
      try {
        await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate One' }).expect(200);
        const docxLike = Buffer.from('%PDF-1.4\n%%EOF');
        const upload = await api().post('/me/cv').set(bearer(candidate)).attach('file', docxLike, { filename: 'cv.pdf', contentType: 'application/pdf' }).expect(201);
        let job: { status: string; attempts: number; last_error: string | null } | undefined;
        for (let i = 0; i < 40 && !(job && job.attempts >= 1 && job.status === 'queued'); i++) {
          await worker.tick();
          job = (await rest(candidate, 'GET', `background_jobs?subject_id=eq.${upload.body.analysis_id}&select=status,attempts,last_error`)).body[0];
          await new Promise((r) => setTimeout(r, 250));
        }
        expect(job).toMatchObject({ status: 'queued', attempts: 1 });
        expect(job?.last_error).not.toMatch(/candidate|@|pdf/i);
        process.env.AI_SERVICE_URL = saved;
        // The first retry waits 10 seconds.
        for (let i = 0; i < 60 && job?.status !== 'succeeded'; i++) {
          await new Promise((r) => setTimeout(r, 500));
          await worker.tick();
          job = (await rest(candidate, 'GET', `background_jobs?subject_id=eq.${upload.body.analysis_id}&select=status,attempts,last_error`)).body[0];
        }
        expect(job).toMatchObject({ status: 'succeeded', attempts: 2 });
        const analysis = await api().get(`/me/cv/analyses/${upload.body.analysis_id}`).set(bearer(candidate)).expect(200);
        expect(analysis.body.status).not.toBe('pending');
      } finally {
        process.env.AI_SERVICE_URL = saved;
      }
    });
  });

  describe('learning catalog', () => {
    it('accepts only checked entries from administrators', async () => {
      const skill = (await rest(null, 'GET', 'reference_skills?sector_code=eq.digital&limit=1&select=id')).body[0].id;
      const entry = { kind: 'course', title_en: `Midan test course ${RUN}`, provider: 'Midan test provider', url: 'https://example.com/midan-test-course', reference_skill_id: skill };
      await api().post('/admin/learning-resources').set(bearer(ownerA)).send({ ...entry, verified_on: '2026-11-01' }).expect(403);
      expect((await rest(candidate, 'POST', 'learning_resources', { ...entry, verified_on: '2026-11-01' })).status).toBe(403);
      await api().post('/admin/learning-resources').set(bearer(admin)).send({ ...entry, url: 'http://example.com/x', verified_on: '2026-11-01' }).expect(400);
      await api().post('/admin/learning-resources').set(bearer(admin)).send({ ...entry, verified_on: '2999-01-01' }).expect(422);
      const created = await api().post('/admin/learning-resources').set(bearer(admin)).send({ ...entry, verified_on: '2026-11-01' }).expect(201);
      expect(created.body.provider).toBe('Midan test provider');
      expect((await rest(admin, 'DELETE', `learning_resources?id=eq.${created.body.id}`)).status).toBe(200);
    });
  });
});
