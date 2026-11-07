// Platform administration, the import pipeline, listing ingestion, job analysis and the background queue.
// Runs against the database in .env with the test accounts in .env.test.local, like foundation.e2e-spec.ts.
// Everything it creates is synthetic and marked (midan-test-*, started_by 'e2e'); supabase/test-cleanup.sql removes it.
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { INestApplication, Logger } from '@nestjs/common';
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
  /** Approves a draft as the screen does: with a review of every change made to MIDAN's draft (20261107150000). */
  const approve = async (who: Session, orgId: string, version: string) => {
    const path = `/organizations/${orgId}/assessment-versions/${version}`;
    const state = await api().get(`${path}/changes`).set(bearer(who)).expect(200);
    return api().post(`${path}/publish`).set(bearer(who)).send({ reviewed_through: state.body.latest_change_id });
  };

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
        // The workbook marks this alias ambiguous: Diriyah Gate Development Authority, not Diriyah Company.
        listing('ambiguous', 'بوابة الدرعية'),
        listing('bad', 'وزارة التجارة', { job_url: 'http://example.com/not-https' }),
      ]);
      expect(counts).toMatchObject({ imported: 4, rejected: 1 });
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
      const ambiguous = await find('ambiguous');
      expect(ambiguous).toMatchObject({ match_status: 'uncertain', source_company_id: 'ALM-004' });
      expect(ambiguous.match_evidence).toMatchObject({ rule: 'alias_needs_review', alias_status: 'ambiguous_manual_review' });
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

  describe('employer registry in the application', () => {
    it('lists all ten prepared entities with their source IDs, and none as a partner', async () => {
      const res = await api().get('/reference/employers').expect(200);
      expect(res.body.map((e: { source_company_id: string }) => e.source_company_id)).toEqual(
        ['ALM-001', 'ALM-002', 'ALM-003', 'ALM-004', 'ALM-005', 'ALM-006', 'ALM-007', 'ALM-008', 'ALM-009', 'ALM-010']);
      expect(res.body.every((e: { partnership_status: string }) => e.partnership_status === 'not_partner')).toBe(true);
      expect(res.body.find((e: { source_company_id: string }) => e.source_company_id === 'ALM-001')).toMatchObject({ name_ar: 'وزارة التجارة', name_en: 'Ministry of Commerce' });
      // The fictional demo organizations never appear in the registry.
      expect(JSON.stringify(res.body)).not.toMatch(/demo|تجريبية/i);
    });

    it('finds employers by official name, alias, spelling variant and company ID, and says which', async () => {
      const search = async (q: string) => (await api().get(`/reference/employers?q=${encodeURIComponent(q)}`).expect(200)).body;
      const [sdaia] = await search('سدايا');
      expect(sdaia).toMatchObject({ source_company_id: 'ALM-006', match: { matched_by: 'alias', matched_text: 'سدايا', alias_status: 'common', exact: true } });
      const [gea] = await search('هيئه الترفيه');
      expect(gea).toMatchObject({ source_company_id: 'ALM-002', match: { matched_by: 'alias' } });
      const [mof] = await search('Ministry of Finance');
      expect(mof).toMatchObject({ source_company_id: 'ALM-009', match: { matched_by: 'official_name', exact: true } });
      expect((await search('alm-004'))[0]).toMatchObject({ source_company_id: 'ALM-004', match: { matched_by: 'company_id' } });
      expect((await search('Ministry')).map((e: { source_company_id: string }) => e.source_company_id).sort()).toEqual(['ALM-001', 'ALM-009']);
      expect(await search('لا توجد جهة بهذا الاسم')).toEqual([]);
    });

    it('shows a profile as the source states it: aliases apart, brand neutral without permission, missing values missing', async () => {
      const id = (await api().get('/reference/employers?q=ALM-004').expect(200)).body[0].id;
      const p = (await api().get(`/reference/employers/${id}`).expect(200)).body;
      expect(p).toMatchObject({ source_company_id: 'ALM-004', partnership_status: 'not_partner', verification_status: 'verified_official' });
      expect(p.aliases).toEqual(expect.arrayContaining([
        expect.objectContaining({ name_variant: 'بوابة الدرعية', alias_status: 'ambiguous_manual_review' }),
        expect.objectContaining({ alias_status: 'official' }),
      ]));
      expect(p.brand).toMatchObject({ usable: false, usage_permission: 'permission_not_verified' });
      expect(p.brand).not.toHaveProperty('logo_asset_url');
      expect(p.lineage).toMatchObject({ source_sheet: 'Employers', source_row: 5 });
      expect(p.lineage.source_file).toMatch(/\.xlsx$/);
      expect(p.sources[0]).toMatchObject({ source_type: 'official_source', checked_on: '2026-11-05T00:00:00.000Z' });
      const gea = (await api().get('/reference/employers?q=ALM-002').expect(200)).body[0];
      expect(gea.career_url).toBeNull();
      await api().get('/reference/employers/00000000-0000-0000-0000-000000000000').expect(404);
    });

    it('links an organization account to a registry entity only through a platform administrator, never for test or demo organizations', async () => {
      const org = (await api().post('/organizations').set(bearer(ownerA)).send({ slug: `midan-test-link-${RUN}`, name_ar: 'ربط', name_en: 'Link' }).expect(201)).body.id;
      const registry = (await api().get('/reference/employers?q=ALM-003').expect(200)).body[0].id;
      expect((await rest(ownerA, 'PATCH', `organizations?id=eq.${org}`, { employer_registry_id: registry })).status).not.toBe(200);
      await api().post(`/admin/organizations/${org}/employer`).set(bearer(ownerA)).send({ registry_id: registry }).expect(403);
      // Test organizations can't be linked, so fixtures never attach to a real employer.
      await api().post(`/admin/organizations/${org}/employer`).set(bearer(admin)).send({ registry_id: registry }).expect(422);
    });

    it('connects reviewed external listings to the employer profile and directory count', async () => {
      const importer = new Client({ connectionString: IMPORTER });
      await importer.connect();
      const run = (await importer.query(`select private.begin_import('job_listings', '[]', 'e2e') as id`)).rows[0].id;
      await importer.query('select private.import_listing_batch($1, $2, $3)', [run, 'employer_provided', JSON.stringify([{
        source_job_id: `midan-test-${RUN}-employer`, employer_name_raw: 'سبكيم', job_title: 'وظيفة اختبار لملف الجهة', job_url: `https://example.com/midan-test/${RUN}/employer`,
      }])]);
      await importer.query(`select private.finish_import($1, '{}')`, [run]);
      await importer.end();
      const listing = (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body.find((l: { source_job_id: string }) => l.source_job_id === `midan-test-${RUN}-employer`);
      expect(listing).toMatchObject({ source_company_id: 'ALM-007', match_status: 'matched' });
      const id = listing.registry_id;
      expect((await api().get(`/reference/employers/${id}`).expect(200)).body.jobs).toEqual([]);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'approve' }).expect(201);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(201);
      const jobs = (await api().get(`/reference/employers/${id}`).expect(200)).body.jobs;
      expect(jobs).toEqual([expect.objectContaining({ kind: 'external', id: listing.id, title_original: 'وظيفة اختبار لملف الجهة' })]);
      const listed = (await api().get('/reference/employers?q=ALM-007').expect(200)).body[0];
      expect(listed.open_jobs).toBe(1);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'unpublish' }).expect(201);
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

  describe('assessments built from requirements', () => {
    let org: string, job: string, version: string, skill: { id: string; name_ar: string };
    const base = () => `/organizations/${org}`;

    it('builds tasks from stated responsibilities and linked workbook skills, and links them back', async () => {
      skill = (await rest(null, 'GET', `reference_skills?sector_code=eq.digital&skill_kind=eq.technical&description_ar=not.is.null&select=id,name_ar&order=name_ar&limit=1`)).body[0];
      org = (await api().post('/organizations').set(bearer(ownerA)).send({ slug: `midan-test-build-${RUN}`, name_ar: 'بناء', name_en: 'Build' }).expect(201)).body.id;
      job = (await api().post(`${base()}/jobs`).set(bearer(ownerA)).send({ slug: 'builder', title_ar: 'مطور', title_en: 'Developer' }).expect(201)).body.id;
      const responsibility = (await api().post(`${base()}/jobs/${job}/requirements`).set(bearer(ownerA))
        .send({ requirement_type: 'responsibility', description_ar: 'بناء واجهات برمجية لخدمة الطلبات', description_en: 'Build APIs that serve orders' }).expect(201)).body;
      await api().post(`${base()}/jobs/${job}/requirements`).set(bearer(ownerA)).send({ requirement_type: 'education', description_en: 'A degree in computing' }).expect(201);
      expect((await rest(ownerA, 'POST', 'job_reference_skills', { job_id: job, org_id: org, reference_skill_id: skill.id, is_required: true })).status).toBe(201);

      const generated = await api().post(`${base()}/jobs/${job}/assessment/generate`).set(bearer(ownerA)).send({}).expect(201);
      version = generated.body.version_id;
      const view = await api().get(`${base()}/jobs/${job}/assessment?assessment=${generated.body.assessment_id}`).set(bearer(ownerA)).expect(200);
      const tasks = view.body.version.assessment_tasks as { id: string; title_ar: string; instructions_en: string; reference_skill_ids?: string[]; task_requirement_mappings: { requirement_id: string }[] }[];
      expect(tasks[0].instructions_en).toContain('Build APIs that serve orders');
      expect(tasks[0].task_requirement_mappings).toEqual([{ requirement_id: responsibility.id }]);
      const skillTask = tasks.find((t) => t.title_ar.includes(skill.name_ar));
      expect(skillTask).toBeDefined();
      const criteria = (await rest(ownerA, 'GET', `rubric_criteria?task_id=eq.${skillTask!.id}&select=code,reference_skill_id,description_ar&order=code`)).body;
      expect(criteria[0].reference_skill_id).toBe(skill.id);
      // A candidate never sees the rubric.
      expect((await rest(candidate, 'GET', `rubric_criteria?task_id=eq.${skillTask!.id}`)).body).toEqual([]);
    });

    it("lets the organization review and correct a draft's questions and answer key, which candidates never receive", async () => {
      const view = (await api().get(`${base()}/jobs/${job}/assessment`).set(bearer(ownerA)).expect(200)).body;
      const objective = view.version.assessment_tasks.find((t: { task_type: string }) => t.task_type === 'objective_questions');
      expect(objective.config.questions.length).toBeGreaterThan(0);
      const written = view.version.assessment_tasks.find((t: { task_type: string }) => t.task_type !== 'objective_questions');
      const option = (id: string) => ({ id, label_ar: `خيار ${id}`, label_en: `Option ${id}` });
      const question = { id: 'q1', prompt_ar: 'ما الخطوة الأولى في مراجعة العقد؟', prompt_en: 'What comes first when reviewing the contract?', options: [option('a'), option('b')], answer: 'b' };
      const path = `${base()}/assessment-tasks/${objective.id}/questions`;

      await api().patch(path).set(bearer(candidate)).send({ questions: [question] }).expect(403);
      await api().patch(path).set(bearer(ownerA)).send({ questions: [] }).expect(400);
      await api().patch(path).set(bearer(ownerA)).send({ questions: [{ ...question, options: [option('a')] }] }).expect(400);
      await api().patch(path).set(bearer(ownerA)).send({ questions: [{ ...question, answer: 'z' }] }).expect(422);
      await api().patch(path).set(bearer(ownerA)).send({ questions: [question, question] }).expect(422);
      await api().patch(`${base()}/assessment-tasks/${written.id}/questions`).set(bearer(ownerA)).send({ questions: [question] }).expect(422);

      const saved = (await api().patch(path).set(bearer(ownerA)).send({ questions: [question, { ...question, id: 'q2', answer: 'a' }] }).expect(200)).body;
      expect(saved.rubric_criteria[0]).toMatchObject({ answer_key: { q1: 'b', q2: 'a' }, max_score: '2' });
      expect(JSON.stringify(saved.config)).not.toContain('answer');
      const audit = (await rest(ownerA, 'GET', `audit_logs?entity=eq.assessment_tasks&entity_id=eq.${objective.id}&action=eq.update&select=actor_id`)).body;
      expect(audit).toEqual([{ actor_id: ownerA.id }]);
      const rubricAudit = (await rest(ownerA, 'GET', `audit_logs?entity=eq.rubric_criteria&entity_id=eq.${saved.rubric_criteria[0].id}&select=actor_id,action`)).body;
      expect(rubricAudit).toEqual([{ actor_id: ownerA.id, action: 'update' }]);
    });

    it('lets the organization add and remove tasks and criteria on a draft, and refuses it once published', async () => {
      await api().post(`${base()}/assessment-versions/${version}/tasks`).set(bearer(candidate)).send({}).expect(400);
      const task = {
        task_type: 'written_case_study', title_ar: 'مهمة يدوية', title_en: 'A hand-written task', instructions_ar: 'اشرح', instructions_en: 'Explain',
        criteria: [{ description_ar: 'وضوح', description_en: 'Clarity', max_score: 5 }],
      };
      await api().post(`${base()}/assessment-versions/${version}/tasks`).set(bearer(candidate)).send(task).expect(403);
      const added = (await api().post(`${base()}/assessment-versions/${version}/tasks`).set(bearer(ownerA)).send(task).expect(201)).body;
      expect(added.rubric_criteria).toHaveLength(1);
      const extra = (await api().post(`${base()}/assessment-tasks/${added.id}/criteria`).set(bearer(ownerA))
        .send({ description_ar: 'دقة', description_en: 'Accuracy', max_score: 5 }).expect(201)).body;
      expect(extra.code).toBe('C2');
      await api().delete(`${base()}/rubric-criteria/${extra.id}`).set(bearer(ownerA)).expect(200);
      await api().delete(`${base()}/rubric-criteria/${added.rubric_criteria[0].id}`).set(bearer(ownerA)).expect(422);
      await api().delete(`${base()}/assessment-tasks/${added.id}`).set(bearer(ownerA)).expect(200);

      expect((await approve(ownerA, org, version)).status).toBe(201);
      await api().post(`${base()}/assessment-versions/${version}/tasks`).set(bearer(ownerA)).send(task).expect(422);
      const view = await api().get(`${base()}/jobs/${job}/assessment`).set(bearer(ownerA)).expect(200);
      await api().delete(`${base()}/assessment-tasks/${view.body.version.assessment_tasks[0].id}`).set(bearer(ownerA)).expect(422);
    });
  });

  describe('the seven sector workbooks in matching', () => {
    const SECTORS = ['construction_real_estate', 'culture_entertainment', 'digital', 'financial_services', 'manufacturing', 'tourism_hospitality', 'wholesale_retail'];

    it('classifies a job to the sector whose workbook names its skills, for every one of the seven', async () => {
      const org = (await api().post('/organizations').set(bearer(ownerA)).send({ slug: `midan-test-sectors-${RUN}`, name_ar: 'قطاعات', name_en: 'Sectors' }).expect(201)).body.id;
      for (const [i, sector] of SECTORS.entries()) {
        const candidates = (await rest(null, 'GET', `reference_skills?sector_code=eq.${sector}&skill_kind=eq.technical&name_search=like.*${encodeURIComponent(' ')}*&select=name_ar,name_search&order=name_ar&limit=40`)).body as { name_ar: string; name_search: string }[];
        const elsewhere = new Set((await rest(null, 'GET', `reference_skills?sector_code=neq.${sector}&name_search=in.(${candidates.map((c) => `"${encodeURIComponent(c.name_search)}"`).join(',')})&select=name_search`)).body
          .map((r: { name_search: string }) => r.name_search));
        const unique = candidates.filter((c) => !elsewhere.has(c.name_search)).slice(0, 3);
        expect(unique).toHaveLength(3);
        const job = (await api().post(`/organizations/${org}/jobs`).set(bearer(ownerA)).send({ slug: `sector-${i}`, title_ar: 'وظيفة', title_en: 'Job' }).expect(201)).body.id;
        await api().patch(`/organizations/${org}/jobs/${job}`).set(bearer(ownerA)).send({ description_ar: unique.map((u) => u.name_ar).join('، ') }).expect(200);
        const analysis = (await api().post(`/organizations/${org}/jobs/${job}/analyses`).set(bearer(ownerA)).expect(201)).body;
        expect([sector, analysis.sector_code]).toEqual([sector, sector]);
        expect(analysis.job_family_ar).toBeTruthy();
        expect(analysis.proposals.filter((p: { basis: string }) => p.basis === 'mentioned').length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('the complete journey on the sector workbooks: browse, apply, job-specific assessment, evaluation', () => {
    let org: string, orgSlug: string, job: string, version: string, application: string, attempt: string, evaluation: string;
    let skills: { id: string; name_ar: string }[];
    let ownerB: Session, candidateTwo: Session;
    const base = () => `/organizations/${org}`;

    beforeAll(async () => {
      [ownerB, candidateTwo] = await Promise.all(['ORG_B_OWNER', 'CANDIDATE_TWO'].map(signIn));
    });

    it('builds a job whose skills come from the workbooks, through job analysis', async () => {
      // Two multi-word digital skills that no other workbook names, so classification has one right answer.
      const pool = (await rest(null, 'GET', `reference_skills?sector_code=eq.digital&skill_kind=eq.technical&description_ar=not.is.null&name_search=like.*${encodeURIComponent(' ')}*&select=id,name_ar,name_search&order=name_ar&limit=40`)).body as { id: string; name_ar: string; name_search: string }[];
      const elsewhere = new Set((await rest(null, 'GET', `reference_skills?sector_code=neq.digital&name_search=in.(${pool.map((c) => `"${encodeURIComponent(c.name_search)}"`).join(',')})&select=name_search`)).body
        .map((r: { name_search: string }) => r.name_search));
      skills = pool.filter((c) => !elsewhere.has(c.name_search)).slice(0, 2);
      expect(skills).toHaveLength(2);

      orgSlug = `midan-test-journey-${RUN}`;
      org = (await api().post('/organizations').set(bearer(ownerA)).send({ slug: orgSlug, name_ar: 'رحلة كاملة', name_en: 'Full journey' }).expect(201)).body.id;
      job = (await api().post(`${base()}/jobs`).set(bearer(ownerA)).send({ slug: 'engineer', title_ar: 'مهندس منصات', title_en: 'Platform engineer' }).expect(201)).body.id;
      await api().patch(`${base()}/jobs/${job}`).set(bearer(ownerA)).send({ description_ar: `يعمل على ${skills[0].name_ar} و${skills[1].name_ar}.` }).expect(200);
      await api().post(`${base()}/jobs/${job}/requirements`).set(bearer(ownerA))
        .send({ requirement_type: 'responsibility', description_ar: 'تشغيل المنصات الرقمية ومتابعة أعطالها', description_en: 'Run digital platforms and follow up their incidents' }).expect(201);

      const analysis = (await api().post(`${base()}/jobs/${job}/analyses`).set(bearer(ownerA)).expect(201)).body;
      expect(analysis.sector_code).toBe('digital');
      const mentioned = analysis.proposals.filter((p: { basis: string }) => p.basis === 'mentioned').map((p: { reference_skill_id: string }) => p.reference_skill_id);
      expect(mentioned).toEqual(expect.arrayContaining(skills.map((k) => k.id)));
      await api().post(`${base()}/jobs/${job}/analyses/${analysis.id}/accept`).set(bearer(ownerA))
        .send({ skills: skills.map((k) => k.id), required: skills.map((k) => k.id), set_sector: true }).expect(201);
    });

    it('generates an assessment from the job, approved by the employer before anyone can take it', async () => {
      const generated = (await api().post(`${base()}/jobs/${job}/assessment/generate`).set(bearer(ownerA)).send({}).expect(201)).body;
      version = generated.version_id;
      const view = (await api().get(`${base()}/jobs/${job}/assessment`).set(bearer(ownerA)).expect(200)).body;
      const tasks = view.version.assessment_tasks as { id: string; title_ar: string; instructions_en: string; task_requirement_mappings: unknown[] }[];
      expect(tasks[0].instructions_en).toContain('Run digital platforms');
      expect(tasks[0].task_requirement_mappings).toHaveLength(1);
      for (const k of skills) {
        const task = tasks.find((t) => t.title_ar.includes(k.name_ar));
        expect(task).toBeDefined();
        const [criterion] = (await rest(ownerA, 'GET', `rubric_criteria?task_id=eq.${task!.id}&code=eq.C1&select=reference_skill_id,description_ar`)).body;
        expect(criterion.reference_skill_id).toBe(k.id);
      }
      await api().patch(`${base()}/jobs/${job}/status`).set(bearer(ownerA)).send({ status: 'published' }).expect(200);
      // The employer's approval: only a published version is ever assigned to a candidate.
      expect((await approve(ownerA, org, version)).status).toBe(201);
    });

    it('lets a candidate browse the job, see their workbook-skill match, and apply', async () => {
      await api().put('/me/candidate-profile').set(bearer(candidateTwo)).send({ full_name: 'Test Candidate Two' }).expect(200);
      await api().put('/me/reference-skills').set(bearer(candidateTwo)).send({ ids: [skills[0].id] }).expect(200);
      const listed = (await api().get('/jobs').set(bearer(candidateTwo)).expect(200)).body;
      expect(listed.map((j: { id: string }) => j.id)).toContain(job);
      const detail = (await api().get(`/jobs/${job}`).expect(200)).body;
      expect(detail.organizations.name_en).toBe('Full journey');
      expect(detail.job_reference_skills.map((s: { reference_skills: { id: string } }) => s.reference_skills.id).sort()).toEqual(skills.map((k) => k.id).sort());
      const recommended = (await api().get('/me/dashboard').set(bearer(candidateTwo)).expect(200)).body.recommended.find((j: { id: string }) => j.id === job);
      expect(recommended.match).toMatchObject({ total: 2, percentage: 50 });

      application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidateTwo)).send({}).expect(201)).body.id;
      // A second click gets the same application.
      expect((await api().post(`/jobs/${job}/applications`).set(bearer(candidateTwo)).send({}).expect(201)).body.id).toBe(application);
      const mine = (await api().get('/me/applications').set(bearer(candidateTwo)).expect(200)).body.find((a: { id: string }) => a.id === application);
      expect(mine).toMatchObject({ job_id: job, org_id: org, candidate_id: candidateTwo.id });
      // The approved assessment was assigned at the moment of applying.
      expect(mine.assessment_attempts).toHaveLength(1);
      attempt = mine.assessment_attempts[0].id;
    });

    it('shows the candidate the instructions only, and saves their answers against the application', async () => {
      const seen = (await api().get(`/experience/${orgSlug}/engineer/1`).set(bearer(candidateTwo)).expect(200)).body;
      expect(JSON.stringify(seen)).not.toMatch(/rubric_criteria|answer_key|reference_skill_id/);
      await api().post(`/attempts/${attempt}/start`).set(bearer(candidateTwo)).expect(201);
      for (const t of seen.version.assessment_tasks) {
        const answer = t.task_type === 'objective_questions' ? { choices: { q1: 'b', q2: 'a' } } : { text: `My approach: I would check the logs, isolate the failing service, fix it, and confirm with monitoring. Task ${t.position}.` };
        await api().put(`/attempts/${attempt}/responses/${t.id}`).set(bearer(candidateTwo)).send({ answer }).expect(200);
      }
      await api().post(`/attempts/${attempt}/submit`).set(bearer(candidateTwo)).expect(201);
    });

    it('gives the employer the application, the answers and an evaluation against its own rubric, and nobody else', async () => {
      const apps = (await api().get(`${base()}/applications`).set(bearer(ownerA)).expect(200)).body;
      expect(apps.map((a: { id: string }) => a.id)).toContain(application);
      await api().get(`${base()}/applications`).set(bearer(ownerB)).expect(403);

      // Submitted but not yet reviewed: no hiring, by hand or through an outcome.
      await api().patch(`/applications/${application}/status`).set(bearer(ownerA)).send({ status: 'hired' }).expect(422);
      await api().post(`${base()}/applications/${application}/outcome`).set(bearer(ownerA)).send({ outcome: 'hired' }).expect(422);

      evaluation = (await api().post(`/attempts/${attempt}/evaluate`).set(bearer(ownerA)).expect(201)).body.id;
      const full = (await api().get(`/attempts/${attempt}/evaluation`).set(bearer(ownerA)).expect(200)).body;
      expect(full.task_responses.length).toBeGreaterThan(0);
      // The answers and the evaluation belong to this application, for this job.
      expect(full.application_id).toBe(application);
      expect(full.applications.job_id).toBe(job);
      expect(full.task_responses.every((r: { attempt_id: string }) => r.attempt_id === attempt)).toBe(true);
      const scored = full.evaluation_results.criterion_scores as { criterion_id: string }[];
      expect(scored.length).toBeGreaterThan(0);
      await api().get(`/attempts/${attempt}/evaluation`).set(bearer(ownerB)).expect(404);
      await api().get(`/attempts/${attempt}/evaluation`).set(bearer(candidateTwo)).expect(403);

      const reviewed = (await api().post(`/evaluations/${evaluation}/review`).set(bearer(ownerA)).send({ scores: [], notes: 'Checked against the rubric' }).expect(201)).body;
      expect(reviewed.status).toBe('reviewed');
      await api().post(`/evaluations/${evaluation}/release`).set(bearer(ownerA)).expect(201);
      const report = (await api().get(`/attempts/${attempt}/report`).set(bearer(candidateTwo)).expect(200)).body;
      expect(JSON.stringify(report)).not.toContain('Checked against the rubric');
      const mine = (await api().get('/me/applications').set(bearer(candidateTwo)).expect(200)).body.find((a: { id: string }) => a.id === application);
      expect(mine.status).toBe('evaluated');
    });

    it('hires only once the assessment has been reviewed, and only by the owning organization', async () => {
      await api().patch(`/applications/${application}/status`).set(bearer(ownerB)).send({ status: 'hired' }).expect(404);
      expect((await api().patch(`/applications/${application}/status`).set(bearer(ownerA)).send({ status: 'hired' }).expect(200)).body.status).toBe('hired');
      await api().patch(`/applications/${application}/status`).set(bearer(ownerA)).send({ status: 'rejected' }).expect(422);
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
      const first = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id });
      const second = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id });
      expect(second.body.id).toBe(first.body.id);
      // What the function returns holds no link, and a caller can't name another job's key or queue a URL of their choosing.
      expect(first.body.payload).toEqual({});
      expect(first.body.acting_email).toBeNull();
      const named = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id, p_dedupe: `cv_analysis:${upload.body.analysis_id}` });
      expect(named.status).not.toBe(200);
      const elsewhere = await rest(other, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: upload.body.analysis_id, p_payload: { file_url: 'http://169.254.169.254/latest/meta-data/' } });
      expect(elsewhere.status).toBe(400);
      // The payload, which can hold a file link, isn't readable through the Data API, even by its owner.
      expect((await rest(other, 'GET', `background_jobs?id=eq.${first.body.id}&select=payload`)).status).not.toBe(200);
      expect((await rest(other, 'GET', `background_jobs?id=eq.${first.body.id}&select=id,status`)).body).toHaveLength(1);
    });

    // Needs this test's worker to be the only one on the database: stop any other API process, or run it with
    // BACKGROUND_WORKER=off. Another worker with a working AI service would correctly finish the job first.
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

    it('reports an expired link as a failure the candidate can retry, and logs no link', async () => {
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))));
      const worker = app.get(BackgroundWorker);
      const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean) => {
        let value = await read();
        for (let i = 0; i < 60 && !done(value); i++) {
          await worker.tick();
          await new Promise((r) => setTimeout(r, 500));
          value = await read();
        }
        return value;
      };
      try {
        const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
        const upload = await api().post('/me/cv').set(bearer(candidate)).attach('file', pdf, { filename: 'expiry.pdf', contentType: 'application/pdf' }).expect(201);
        const analysis = (id: string) => () => api().get(`/me/cv/analyses/${id}`).set(bearer(candidate)).then((r) => r.body as { status: string; failure_code: string | null });
        await until(analysis(upload.body.analysis_id), (a) => a.status !== 'pending');

        const document = (await rest(candidate, 'GET', 'cv_documents?is_current=eq.true&select=id,storage_path')).body[0];
        const row = (await rest(candidate, 'POST', 'cv_analyses', { document_id: document.id, candidate_id: candidate.id })).body[0];
        const signed = await fetch(`${BASE}/storage/v1/object/sign/candidate-documents/${document.storage_path}`, {
          method: 'POST',
          headers: { apikey: KEY, authorization: `Bearer ${candidate.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ expiresIn: 1 }),
        });
        const link = `${BASE}/storage/v1${((await signed.json()) as { signedURL: string }).signedURL}`;
        await new Promise((r) => setTimeout(r, 2100));
        expect((await rest(candidate, 'POST', 'rpc/enqueue_background_job', { p_kind: 'cv_analysis', p_subject: row.id, p_payload: { file_url: link } })).status).toBe(200);

        const failed = await until(analysis(row.id), (a) => a.status !== 'pending');
        expect(failed).toMatchObject({ status: 'failed', failure_code: 'file_unavailable' });
        const job = (await rest(candidate, 'GET', `background_jobs?subject_id=eq.${row.id}&select=status,attempts,last_error`)).body[0];
        // One attempt: retrying can't bring an expired link back, so the queue doesn't try.
        expect(job).toMatchObject({ status: 'failed', attempts: 1, last_error: 'file_unavailable' });

        const again = await api().post('/me/cv/analyses').set(bearer(candidate)).expect(201);
        const fresh = await until(analysis(again.body.id), (a) => a.status !== 'pending');
        expect(fresh.failure_code).not.toBe('file_unavailable');

        const token = new URL(link).searchParams.get('token') as string;
        expect(lines.join('\n')).not.toContain(token);
        expect(lines.join('\n')).not.toMatch(/token=|object\/sign/);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
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
