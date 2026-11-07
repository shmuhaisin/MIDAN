// Phase 3 through the real stack: uploading job records, turning them into jobs, search, employer claims and team invitations.
// All data here is fictional. Local only: it marks one fixture organization as real, to reach what test organizations are refused.
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

loadEnv('.env', '.env.test.local');

const { Client } = createRequire(__filename)('pg') as typeof import('pg');
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

describe('Phase 3: jobs and employers', () => {
  let app: INestApplication;
  let admin: Session, owner: Session, recruiter: Session, outsider: Session, candidate: Session, other: Session;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const organization = async (who: Session, name: string) =>
    (await api().post('/organizations').set(bearer(who)).send({ slug: `midan-test-${name}-${RUN}`, name_ar: `جهة ${name}`, name_en: `Org ${name}` }).expect(201)).body.id as string;

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [admin, owner, recruiter, outsider, candidate, other] = await Promise.all(['PLATFORM_ADMIN', 'ORG_A_OWNER', 'ORG_A_RECRUITER', 'ORG_B_OWNER', 'CANDIDATE_ONE', 'CANDIDATE_TWO'].map(signIn));
  });
  afterAll(() => app.close());

  describe('uploading job records', () => {
    const upload = (path: string, file: string, name: string, fields: Record<string, string> = {}, who = admin) =>
      api().post(`/admin/listings/${path}`).set(bearer(who))
        .field({ source_type: 'employer_provided', source_name: 'Fictional source', authorization_note: 'Fictional records, for tests only', ...fields })
        .attach('file', Buffer.from(file), { filename: name, contentType: 'text/plain' });
    const csv = [
      'title,url,company,description,requirements,job_id,location',
      `محلل بيانات ${RUN},https://example.com/${RUN}/1,وزارة التجارة,"يحلل، ويقدم التقارير",خبرة في الجداول,midan-test-${RUN}-1,الرياض`,
      `,https://example.com/${RUN}/2,وزارة التجارة,,,midan-test-${RUN}-2,`,
      `Insecure ${RUN},http://example.com/${RUN}/3,وزارة التجارة,,,midan-test-${RUN}-3,`,
      `مكرر ${RUN},https://example.com/${RUN}/4,جهة غير موجودة,,,midan-test-${RUN}-1,`,
      `جهة مجهولة ${RUN},https://example.com/${RUN}/5,جهة غير موجودة,,,midan-test-${RUN}-5,`,
    ].join('\n');
    const mine = async () => (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body.filter((l: { source_job_id: string }) => l.source_job_id?.startsWith(`midan-test-${RUN}-`));
    let sha: string;

    it('is for platform administrators only, and needs a stated source and permission', async () => {
      await upload('preview', csv, 'jobs.csv', {}, owner).expect(403);
      await upload('preview', csv, 'jobs.csv', { source_type: 'scraped' }).expect(400);
      await upload('preview', csv, 'jobs.csv', { authorization_note: '' }).expect(400);
    });

    it('previews a CSV file row by row, and saves nothing', async () => {
      const preview = (await upload('preview', csv, 'jobs.csv').expect(201)).body;
      sha = preview.sha256;
      expect(preview).toMatchObject({ format: 'csv', total: 5, can_import: true, counts: { new: 2, invalid: 2, duplicate_in_file: 1 } });
      const row = (n: number) => preview.rows.find((r: { row: number }) => r.row === n);
      expect(row(2)).toMatchObject({ status: 'new', match_status: 'matched', registry_name_ar: 'وزارة التجارة' });
      expect(row(3).errors).toEqual(['missing_title']);
      expect(row(4).errors).toEqual(['url_not_https']);
      expect(row(5).status).toBe('duplicate_in_file');
      expect(row(6)).toMatchObject({ status: 'new', match_status: 'unmatched' });
      expect(await mine()).toEqual([]);
    });

    it('refuses to save a file that differs from the one previewed', async () => {
      await upload('import', csv, 'jobs.csv').expect(409);
      await upload('import', `${csv}\nأخرى ${RUN},https://example.com/${RUN}/9,,,,,`, 'jobs.csv', { preview_sha256: sha }).expect(409);
      await upload('import', csv, 'jobs.csv', { preview_sha256: sha, source_name: 'Another source' }).expect(409);
      expect(await mine()).toEqual([]);
    });

    it('saves the previewed file as a recorded import, unpublished, with its source and every problem kept', async () => {
      const saved = (await upload('import', csv, 'jobs.csv', { preview_sha256: sha }).expect(201)).body;
      expect(saved).toMatchObject({ counts: { imported: 2 }, rejected: 2, repeated: 1 });
      const listings = await mine();
      expect(listings).toHaveLength(2);
      expect(listings.every((l: { published: boolean; review_status: string }) => !l.published && l.review_status === 'pending')).toBe(true);
      expect(listings.find((l: { source_job_id: string }) => l.source_job_id.endsWith('-1'))).toMatchObject({ source_name: 'Fictional source', location: 'الرياض', title_original: `محلل بيانات ${RUN}` });
      const run = (await api().get(`/admin/imports/${saved.run_id}`).set(bearer(admin)).expect(200)).body;
      expect(run.run.sources[0]).toMatchObject({ file: 'jobs.csv', authorization_note: 'Fictional records, for tests only', source_type: 'employer_provided' });
      expect(run.records.map((r: { issue_kind: string }) => r.issue_kind)).toEqual(expect.arrayContaining(['malformed_record', 'duplicate_row']));
    });

    it('sees a re-upload for what it is, and the same job from another source', async () => {
      const again = (await upload('preview', csv, 'jobs.csv').expect(201)).body;
      expect(again.counts).toMatchObject({ unchanged: 2 });
      const json = JSON.stringify([
        { title: `محلل بيانات ${RUN}`, url: `https://example.com/${RUN}/other`, company: 'وزارة التجارة', job_id: `midan-test-${RUN}-other` },
        { title: `محلل بيانات ${RUN} محدث`, url: `https://example.com/${RUN}/1`, company: 'وزارة التجارة', job_id: `midan-test-${RUN}-1` },
      ]);
      const preview = (await upload('preview', json, 'jobs.json').expect(201)).body;
      expect(preview.format).toBe('json');
      expect(preview.rows[0].status).toBe('cross_source_duplicate');
      expect(preview.rows[0].duplicate_of).toBeTruthy();
      expect(preview.rows[1].status).toBe('update');
    });

    it('refuses what it cannot read, with a reason', async () => {
      await upload('preview', 'a,b', 'jobs.xlsx').expect(422);
      await upload('preview', '{nope', 'jobs.json').expect(422);
      await upload('preview', 'title,url\n', 'jobs.csv').expect(422);
    });

    it('keeps the source record and review notes from the public', async () => {
      // The listing whose employer is in the registry. The other one names an unknown employer and can't be published,
      // and the list has no fixed order, so picking the first was a flake.
      const listing = (await mine()).find((l: { source_job_id: string }) => l.source_job_id === `midan-test-${RUN}-1`);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'approve', note: 'An internal note' }).expect(201);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(201);
      for (const who of [null, candidate]) {
        for (const column of ['raw_record', 'review_note', 'reviewed_by', 'match_evidence', 'dedupe_key']) {
          expect((await rest(who, 'GET', `external_job_listings?id=eq.${listing.id}&select=${column}`)).status).not.toBe(200);
        }
        expect((await rest(who, 'GET', `external_job_listings?id=eq.${listing.id}&select=id,title_original`)).body).toHaveLength(1);
      }
      const shown = (await api().get(`/jobs/external?q=${encodeURIComponent(`${RUN}`)}`).expect(200)).body;
      expect(shown.map((l: { id: string }) => l.id)).toContain(listing.id);
      expect(JSON.stringify(shown)).not.toMatch(/raw_record|An internal note|dedupe_key/);
      await api().post(`/admin/listings/${listing.id}/review`).set(bearer(admin)).send({ action: 'unpublish' }).expect(201);
    });
  });

  describe('search and pages', () => {
    let org: string;
    const search = (query: string) => api().get(`/jobs?page=1&q=${encodeURIComponent(query)}`).set(bearer(owner)).expect(200).then((r) => r.body.items.map((j: { title_en: string }) => j.title_en));

    beforeAll(async () => {
      org = await organization(owner, 'search');
      const job = async (slug: string, body: object) =>
        (await api().post(`/organizations/${org}/jobs`).set(bearer(owner)).send({ slug: `${slug}-${RUN}`, status: 'published', ...body }).expect(201)).body.id as string;
      await job('title', { title_ar: `مهندس ${RUN}`, title_en: `Title ${RUN}` });
      const described = await job('described', { title_ar: `وظيفة ${RUN}`, title_en: `Described ${RUN}` });
      await api().patch(`/organizations/${org}/jobs/${described}`).set(bearer(owner)).send({ description_ar: 'إدارة الموارد البشرية في الشركة' }).expect(200);
      const required = await job('required', { title_ar: `وظيفة ${RUN}`, title_en: `Required ${RUN}` });
      await api().patch(`/organizations/${org}/jobs/${required}`).set(bearer(owner)).send({ requirements_en: 'Fluent in Kubernetes' }).expect(200);
      const structured = await job('structured', { title_ar: `وظيفة ${RUN}`, title_en: `Structured ${RUN}` });
      await api().post(`/organizations/${org}/jobs/${structured}/requirements`).set(bearer(owner)).send({ requirement_type: 'responsibility', description_ar: 'مراجعة عقود التوريد', description_en: 'Reviews supply contracts' }).expect(201);
      for (let i = 0; i < 13; i += 1) await job(`many-${i}`, { title_ar: `كثير ${RUN}`, title_en: `Many${RUN} ${i}` });
    });

    it('finds a word in the title, the description or the requirements, in either language', async () => {
      expect(await search(`مهندس ${RUN}`)).toEqual([`Title ${RUN}`]);
      expect(await search(`الموارد البشرية ${RUN}`)).toEqual([`Described ${RUN}`]);
      expect(await search(`kubernetes ${RUN}`)).toEqual([`Required ${RUN}`]);
      expect(await search(`supply contracts ${RUN}`)).toEqual([`Structured ${RUN}`]);
      expect(await search(`عقود التوريد ${RUN}`)).toEqual([`Structured ${RUN}`]);
    });

    it('tolerates Arabic spelling, and needs every word', async () => {
      expect(await search(`ادارة الموارد ${RUN}`)).toEqual([`Described ${RUN}`]);
      expect(await search(`موارد ${RUN} kubernetes`)).toEqual([]);
    });

    it('treats a search as text, not as a query', async () => {
      expect(await search(`%' or 1=1 -- ${RUN}`)).toEqual([]);
    });

    it('splits results into pages, with a total and every result exactly once', async () => {
      const page = (n: number) => api().get(`/jobs?page=${n}&page_size=5&q=Many${RUN}`).set(bearer(owner)).expect(200).then((r) => r.body);
      const [one, two, three, four] = await Promise.all([page(1), page(2), page(3), page(4)]);
      expect(one).toMatchObject({ total: 13, page: 1, page_size: 5 });
      expect([one, two, three].map((p) => p.items.length)).toEqual([5, 5, 3]);
      expect(four.items).toEqual([]);
      expect(new Set([one, two, three].flatMap((p) => p.items.map((j: { id: string }) => j.id))).size).toBe(13);
      expect(one.facets.employers.map((e: { name_en: string }) => e.name_en)).toContain('Org search');
      expect((await api().get('/jobs?page=1&page_size=1000').set(bearer(owner)).expect(200)).body.page_size).toBe(50);
      expect((await api().get('/jobs?page=nonsense').set(bearer(owner)).expect(200)).body.page).toBe(1);
    });

    it('keeps the plain list for callers that ask for no page', async () => {
      expect(Array.isArray((await api().get('/jobs').expect(200)).body)).toBe(true);
    });

    it('keeps fixtures out of what everyone else finds', async () => {
      const seen = (await api().get(`/jobs?page=1&q=Many${RUN}`).set(bearer({ ...candidate, token: 'no' })).expect(200)).body;
      expect(seen.total).toBe(0);
    });
  });

  describe('employer claims', () => {
    const pdf = Buffer.from('%PDF-1.4\nfictional letter\n%%EOF');
    let org: string, registry: string, claim: string;
    let superuser: InstanceType<typeof Client>;
    const submit = (who: Session, target: string, file?: Buffer) => {
      const req = api().post(`/organizations/${target}/employer-claims`).set(bearer(who))
        .field({ registry_id: registry, role_title: 'Fictional HR manager', evidence_note: 'A fictional letter, for tests only.' });
      return file ? req.attach('file', file, { filename: 'letter.pdf', contentType: 'application/pdf' }) : req;
    };

    beforeAll(async () => {
      superuser = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan` });
      await superuser.connect();
      org = await organization(owner, 'claim');
      registry = (await api().get('/reference/employers?q=ALM-005').expect(200)).body[0].id;
    });
    afterAll(() => superuser.end());

    // A trigger keeps this mark from ever changing, on purpose. The test steps past it for this one fixture.
    const asReal = async (isTest: boolean) => {
      await superuser.query('begin');
      await superuser.query('set local session_replication_role = replica');
      await superuser.query('update public.organizations set is_test = $2 where id = $1', [org, isTest]);
      await superuser.query('commit');
    };

    it('is for the organization\'s owners and admins, with a real file', async () => {
      await submit(outsider, org).expect(403);
      await submit(candidate, org).expect(403);
      await submit(owner, org, Buffer.from('not really a pdf')).expect(422);
      expect((await api().post(`/organizations/${org}/employer-claims`).set(bearer(owner)).field({ registry_id: registry, role_title: 'x', evidence_note: 'short' })).status).toBe(400);
      expect((await rest(owner, 'POST', 'employer_claims', { org_id: org, registry_id: registry, role_title: 'Direct', evidence_note: 'Straight to the table' })).status).toBe(403);
    });

    it('grants nothing on submission, and allows one open claim', async () => {
      const made = (await submit(owner, org, pdf).expect(201)).body;
      claim = made.id;
      expect(made).toMatchObject({ status: 'pending', email_domain_matches: false });
      const mine = (await api().get(`/organizations/${org}/employer-claims`).set(bearer(owner)).expect(200)).body;
      expect(mine.employer).toBeNull();
      expect(mine.claims[0]).toMatchObject({ id: claim, status: 'pending', has_evidence: true });
      await submit(owner, org).expect(422);
    });

    it('keeps the evidence private to the organization and platform administrators', async () => {
      const [{ evidence_path: path }] = (await superuser.query('select evidence_path from public.employer_claims where id = $1', [claim])).rows;
      const read = (who: Session) => fetch(`${BASE}/storage/v1/object/employer-claims/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${who.token}` } });
      expect((await read(owner)).ok).toBe(true);
      expect((await read(admin)).ok).toBe(true);
      expect((await read(outsider)).ok).toBe(false);
      expect((await read(candidate)).ok).toBe(false);
      expect((await rest(outsider, 'GET', `employer_claims?id=eq.${claim}`)).body).toEqual([]);
      await api().get(`/admin/employer-claims/${claim}/evidence-url`).set(bearer(owner)).expect(403);
      expect((await api().get(`/admin/employer-claims/${claim}/evidence-url`).set(bearer(admin)).expect(200)).body.url).toContain('employer-claims');
    });

    it('asks for a reason to reject, and tells the requester', async () => {
      await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(owner)).send({ decision: 'approved' }).expect(403);
      await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(admin)).send({ decision: 'rejected' }).expect(422);
      expect((await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(admin)).send({ decision: 'rejected', note: 'The letter is unsigned' }).expect(201)).body.status).toBe('rejected');
      await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(admin)).send({ decision: 'approved' }).expect(422);
      const notes = (await rest(owner, 'GET', 'notifications?kind=eq.employer_claim_rejected&select=link')).body;
      expect(notes.map((n: { link: string }) => n.link)).toContain(`/organization/${org}/settings`);
    });

    it('never links a test organization, so fixtures stay away from real employers', async () => {
      claim = (await submit(owner, org, pdf).expect(201)).body.id;
      await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(admin)).send({ decision: 'approved' }).expect(422);
      expect((await api().get(`/organizations/${org}/employer-claims`).set(bearer(owner)).expect(200)).body.employer).toBeNull();
    });

    describe('once approved', () => {
      let listing: string, job: string;

      beforeAll(async () => {
        await asReal(false);
        const reg = (await superuser.query('select name_ar from public.employer_registry where id = $1', [registry])).rows[0];
        const body = JSON.stringify([{ title: `مراجع عقود ${RUN}`, url: `https://example.com/${RUN}/claim`, company: reg.name_ar, job_id: `midan-test-${RUN}-claim`, description: 'يراجع عقود التوريد قبل توقيعها', location: 'جدة', employment_type: 'full_time' }]);
        const fields = { source_type: 'employer_provided', source_name: 'Fictional source', authorization_note: 'Fictional records, for tests only' };
        const preview = (await api().post('/admin/listings/preview').set(bearer(admin)).field(fields).attach('file', Buffer.from(body), { filename: 'c.json', contentType: 'application/json' }).expect(201)).body;
        await api().post('/admin/listings/import').set(bearer(admin)).field({ ...fields, preview_sha256: preview.sha256 }).attach('file', Buffer.from(body), { filename: 'c.json', contentType: 'application/json' }).expect(201);
        listing = (await api().get('/admin/listings').set(bearer(admin)).expect(200)).body.find((l: { source_job_id: string }) => l.source_job_id === `midan-test-${RUN}-claim`).id;
      });
      afterAll(async () => {
        // The registry entity is real, so the fixture lets go of it.
        await superuser.query('update public.organizations set employer_registry_id = null where id = $1', [org]);
        await asReal(true);
      });

      it('won\'t become a job before its record is approved, or without an organization managing the employer', async () => {
        await api().post(`/admin/listings/${listing}/convert`).set(bearer(admin)).expect(422);
        await api().post(`/admin/listings/${listing}/review`).set(bearer(admin)).send({ action: 'approve' }).expect(201);
        await api().post(`/admin/listings/${listing}/convert`).set(bearer(admin)).expect(422);
      });

      it('links the account to the employer, and changes nothing about the employer itself', async () => {
        const before = (await rest(null, 'GET', `employer_registry?id=eq.${registry}&select=partnership_status,verification_status,name_ar`)).body[0];
        expect((await api().post(`/admin/employer-claims/${claim}/review`).set(bearer(admin)).send({ decision: 'approved', note: 'Checked by phone' }).expect(201)).body.status).toBe('approved');
        expect((await rest(null, 'GET', `employer_registry?id=eq.${registry}&select=partnership_status,verification_status,name_ar`)).body[0]).toEqual(before);
        expect(before.partnership_status).toBe('not_partner');
        const mine = (await api().get(`/organizations/${org}/employer-claims`).set(bearer(owner)).expect(200)).body;
        expect(mine.employer.id).toBe(registry);
        // Another organization can't claim it now, and this one can't claim a second.
        const second = await organization(outsider, 'second');
        await submit(outsider, second).expect(422);
        await submit(owner, org).expect(422);
      });

      it('lets that organization see its approved records, and nobody else', async () => {
        const seen = (await api().get(`/organizations/${org}/listings`).set(bearer(owner)).expect(200)).body;
        expect(seen.map((l: { id: string }) => l.id)).toContain(listing);
        await api().get(`/organizations/${org}/listings`).set(bearer(outsider)).expect(403);
        const stranger = await organization(outsider, 'stranger');
        await api().post(`/organizations/${stranger}/listings/${listing}/convert`).set(bearer(outsider)).expect(403);
      });

      it('turns a record into a draft job, with its source, stated details and mentioned skills', async () => {
        const made = (await api().post(`/organizations/${org}/listings/${listing}/convert`).set(bearer(owner)).expect(201)).body;
        job = made.id;
        expect(made).toMatchObject({ org_id: org, status: 'draft' });
        const full = (await api().get(`/organizations/${org}/jobs/${job}`).set(bearer(owner)).expect(200)).body;
        expect(full).toMatchObject({ title_ar: `مراجع عقود ${RUN}`, title_en: `مراجع عقود ${RUN}`, description_ar: 'يراجع عقود التوريد قبل توقيعها', description_en: null, location: 'جدة', employment_type: 'full_time', source_listing_id: listing, salary_min: null, application_deadline: null });
        await api().post(`/admin/listings/${listing}/convert`).set(bearer(admin)).expect(422);
        expect((await api().get(`/organizations/${org}/listings`).set(bearer(owner)).expect(200)).body.find((l: { id: string }) => l.id === listing).job_id).toBe(job);
        // A draft isn't public.
        await api().get(`/jobs?page=1&q=${encodeURIComponent(`مراجع عقود ${RUN}`)}`).expect(200).then((r) => expect(r.body.total).toBe(0));
      });

      it('once published, the job takes the place of the record: people can apply, and it appears under the employer', async () => {
        await api().post(`/admin/listings/${listing}/review`).set(bearer(admin)).send({ action: 'publish' }).expect(201);
        const external = () => api().get(`/jobs/external?q=${encodeURIComponent(`مراجع عقود ${RUN}`)}`).expect(200).then((r) => r.body.map((l: { id: string }) => l.id));
        expect(await external()).toEqual([listing]);
        await api().patch(`/organizations/${org}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(200);
        expect(await external()).toEqual([]);
        const found = (await api().get(`/jobs?page=1&q=${encodeURIComponent(`مراجع عقود ${RUN}`)}`).expect(200)).body;
        expect(found.items.map((j: { id: string }) => j.id)).toEqual([job]);
        expect(found.items[0].organizations.employer_registry.id).toBe(registry);
        const listed = (await rest(null, 'POST', 'rpc/employer_jobs', { p_registry: registry })).body;
        expect(listed.filter((l: { id: string }) => [job, listing].includes(l.id)).map((l: { kind: string }) => l.kind)).toEqual(['midan']);
        expect((await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({}).expect(201)).body.id).toBeTruthy();
      });
    });
  });

  describe('team invitations', () => {
    let org: string;
    const team = (who = owner) => api().get(`/organizations/${org}/team`).set(bearer(who));
    const invite = (who: Session, email: string, role: string) => api().post(`/organizations/${org}/team/invitations`).set(bearer(who)).send({ email, role });
    const invitations = (who: Session) => api().get('/me/invitations').set(bearer(who)).expect(200).then((r) => r.body as { id: string; org_id: string; role: string }[]);
    const pending = async (who: Session) => (await invitations(who)).find((i) => i.org_id === org);
    const member = async (who: Session) => (await team().expect(200)).body.members.find((m: { user_id: string }) => m.user_id === who.id);

    beforeAll(async () => {
      org = await organization(owner, 'team');
    });

    it('lets owners invite, and never grants ownership by invitation', async () => {
      await invite(candidate, recruiter.email, 'recruiter').expect(403);
      await invite(outsider, recruiter.email, 'recruiter').expect(403);
      await invite(owner, recruiter.email, 'owner').expect(400);
      await invite(owner, 'not an email', 'admin').expect(400);
      await invite(owner, owner.email, 'admin').expect(422);
      const sent = (await invite(owner, recruiter.email.toUpperCase(), 'recruiter').expect(201)).body;
      expect(sent).toMatchObject({ email: recruiter.email, role: 'recruiter' });
      expect(JSON.stringify(sent)).not.toContain('token');
    });

    it('reaches the invited account, grants nothing yet, and is theirs alone', async () => {
      const mine = await pending(recruiter);
      expect(mine).toMatchObject({ role: 'recruiter', name_en: 'Org team' });
      expect((await rest(recruiter, 'GET', 'notifications?kind=eq.organization_invitation&select=link')).body.map((n: { link: string }) => n.link)).toContain('/invitations');
      await api().get(`/organizations/${org}`).set(bearer(recruiter)).expect(403);
      expect(await pending(other)).toBeUndefined();
      await api().post(`/me/invitations/${mine!.id}/accept`).set(bearer(other)).expect(404);
      await api().post(`/me/invitations/${mine!.id}/decline`).set(bearer(other)).expect(404);
      expect((await rest(recruiter, 'POST', 'organization_invitations', { org_id: org, email: other.email, role: 'admin', expires_at: '2099-01-01T00:00:00Z' })).status).not.toBe(201);
      expect((await rest(recruiter, 'GET', `organization_invitations?org_id=eq.${org}`)).body).toEqual([]);
    });

    it('makes them a member on accepting, with the invited role, once', async () => {
      const mine = await pending(recruiter);
      expect((await api().post(`/me/invitations/${mine!.id}/accept`).set(bearer(recruiter)).expect(201)).body.org_id).toBe(org);
      expect((await member(recruiter)).role).toBe('recruiter');
      expect((await api().get(`/organizations/${org}`).set(bearer(recruiter)).expect(200)).body.my_role).toBe('recruiter');
      await api().post(`/me/invitations/${mine!.id}/accept`).set(bearer(recruiter)).expect(404);
      await invite(owner, recruiter.email, 'admin').expect(422);
    });

    it('holds each role to its permissions', async () => {
      // A recruiter works on jobs, and doesn't manage the team.
      await invite(recruiter, other.email, 'reviewer').expect(403);
      await api().patch(`/organizations/${org}/team/members/${recruiter.id}`).set(bearer(recruiter)).send({ role: 'admin' }).expect(403);
      await api().delete(`/organizations/${org}/team/members/${owner.id}`).set(bearer(recruiter)).expect(403);
      expect((await api().post(`/organizations/${org}/jobs`).set(bearer(recruiter)).send({ slug: `team-job-${RUN}`, title_ar: 'و', title_en: 'J' })).status).toBe(201);
      const seen = (await team(recruiter).expect(200)).body;
      expect(seen.members.length).toBe(2);
      expect(seen.invitations).toEqual([]);
    });

    it('lets an admin manage the team, but not owners', async () => {
      await api().patch(`/organizations/${org}/team/members/${recruiter.id}`).set(bearer(owner)).send({ role: 'admin' }).expect(200);
      expect((await member(recruiter)).role).toBe('admin');
      expect((await api().patch(`/organizations/${org}/team/members/${recruiter.id}`).set(bearer(recruiter)).send({ role: 'owner' })).status).toBeGreaterThanOrEqual(400);
      expect((await api().patch(`/organizations/${org}/team/members/${owner.id}`).set(bearer(recruiter)).send({ role: 'reviewer' })).status).toBe(404);
      await api().delete(`/organizations/${org}/team/members/${owner.id}`).set(bearer(recruiter)).expect(404);
      expect((await member(owner)).role).toBe('owner');
      await invite(recruiter, other.email, 'reviewer').expect(201);
      expect((await team(recruiter).expect(200)).body.invitations.map((i: { email: string }) => i.email)).toEqual([other.email]);
    });

    it('always keeps an owner', async () => {
      await api().patch(`/organizations/${org}/team/members/${owner.id}`).set(bearer(owner)).send({ role: 'admin' }).expect(422);
      await api().delete(`/organizations/${org}/team/members/${owner.id}`).set(bearer(owner)).expect(422);
    });

    it('lets an invitation be revoked or declined, and removes a member', async () => {
      const open = (await team().expect(200)).body.invitations[0];
      await api().delete(`/organizations/${org}/team/invitations/${open.id}`).set(bearer(owner)).expect(200);
      expect(await pending(other)).toBeUndefined();
      await invite(owner, other.email, 'reviewer').expect(201);
      const again = await pending(other);
      await api().post(`/me/invitations/${again!.id}/decline`).set(bearer(other)).expect(201);
      expect(await pending(other)).toBeUndefined();
      await api().get(`/organizations/${org}`).set(bearer(other)).expect(403);
      await api().delete(`/organizations/${org}/team/members/${recruiter.id}`).set(bearer(owner)).expect(200);
      await api().get(`/organizations/${org}`).set(bearer(recruiter)).expect(403);
    });

    it('records who did what', async () => {
      const audit = (await rest(owner, 'GET', `audit_logs?org_id=eq.${org}&entity=eq.organization_invitations&select=action`)).body.map((a: { action: string }) => a.action);
      expect(audit).toEqual(expect.arrayContaining(['invite', 'accept']));
    });
  });
});
