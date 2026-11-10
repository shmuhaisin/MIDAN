// The employer's recruitment journey through the real stack: the unified applicant review, shortlisting and undoing it,
// notifications, notes, interview participants and interview feedback, and the human decision. Fictional data, local only.
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

describe('the recruitment journey', () => {
  let app: INestApplication;
  let owner: Session, recruiter: Session, outsider: Session, candidate: Session, second: Session;
  let org: string, job: string, skill: { id: string; name_en: string }, application: string, secondApplication: string, attempt: string;
  let interview: string, otherInterview: string;
  const slug = `midan-test-hire-${RUN}`;
  const api = () => request(app.getHttpServer());
  const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const base = () => `/organizations/${org}`;
  const review = (who: Session) => api().get(`${base()}/applications/${application}/review`).set(bearer(who));
  /** This run's notifications for one person: those linking to this run's applications and interviews. */
  const kinds = async (who: Session) => {
    const ours = new Set([`/applications/${application}`, `/applications/${secondApplication}`, `/interviews/${interview}`, `/interviews/${otherInterview}`]);
    return ((await api().get('/me/notifications').set(bearer(who)).expect(200)).body as { kind: string; link: string }[])
      .filter((n) => ours.has(n.link)).map((n) => n.kind);
  };
  const decisions = (all: string[]) => all.filter((k) => ['application_shortlisted', 'application_rejected'].includes(k));

  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('This suite is local only');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    [owner, recruiter, outsider, candidate, second] = await Promise.all(['ORG_A_OWNER', 'ORG_A_RECRUITER', 'ORG_B_OWNER', 'CANDIDATE_TWO', 'CANDIDATE_ONE'].map(signIn));
  });
  afterAll(() => app.close());

  it('sets up a fictional organization, its team, and a published job with a generated, reviewed assessment', async () => {
    org = (await api().post('/organizations').set(bearer(owner)).send({ slug, name_ar: 'جهة توظيف', name_en: 'Hiring org' }).expect(201)).body.id;
    await approveOrganization(app.getHttpServer(), owner.token, org);
    await api().post(`${base()}/team/invitations`).set(bearer(owner)).send({ email: recruiter.email, role: 'recruiter' }).expect(201);
    const invitation = ((await api().get('/me/invitations').set(bearer(recruiter)).expect(200)).body as { id: string; org_id: string }[]).find((i) => i.org_id === org);
    await api().post(`/me/invitations/${invitation!.id}/accept`).set(bearer(recruiter)).expect(201);

    job = (await api().post(`${base()}/jobs`).set(bearer(owner)).send({ slug: 'analyst', title_ar: 'محلل بيانات', title_en: 'Data analyst' }).expect(201)).body.id;
    const skills = (await api().get('/skills').expect(200)).body as { id: string; slug: string; name_en: string }[];
    skill = skills.find((s) => s.slug === 'data-analysis')!;
    await api().patch(`${base()}/jobs/${job}`).set(bearer(owner))
      .send({ description_en: 'Prepare monthly reports.', description_ar: 'إعداد التقارير الشهرية.', skills: [{ skill_id: skill.id, required_level: 3 }] }).expect(200);
    const version = (await api().post(`${base()}/jobs/${job}/assessment/generate`).set(bearer(owner)).send({}).expect(201)).body.version_id as string;
    // A job with an assessment is published only once the assessment is approved (20261113090000).
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(422);
    const state = (await api().get(`${base()}/assessment-versions/${version}/changes`).set(bearer(owner)).expect(200)).body;
    await api().post(`${base()}/assessment-versions/${version}/publish`).set(bearer(owner)).send({ reviewed_through: state.latest_change_id }).expect(201);
    await api().patch(`${base()}/jobs/${job}/status`).set(bearer(owner)).send({ status: 'published' }).expect(200);
  });

  it('takes an application, an assessment and a reviewed evaluation', async () => {
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({
      full_name: 'Test Candidate Two', headline: 'Fictional analyst', summary: 'Fictional summary.',
      experience: [{ title: 'Reporting analyst', organization: 'Fictional Co', start_year: 2020, end_year: null }],
    }).expect(200);
    await api().put('/me/skills').set(bearer(candidate)).send({ skill_ids: [skill.id] }).expect(200);
    application = (await api().post(`/jobs/${job}/applications`).set(bearer(candidate)).send({ cover_note: 'Fictional cover note.' }).expect(201)).body.id;
    expect(await kinds(candidate)).toContain('application_received');

    attempt = ((await api().get('/me/applications').set(bearer(candidate)).expect(200)).body.find((a: { id: string }) => a.id === application)).assessment_attempts[0].id;
    const seen = (await api().get(`/experience/${slug}/analyst/1`).set(bearer(candidate)).expect(200)).body;
    await api().post(`/attempts/${attempt}/start`).set(bearer(candidate)).expect(201);
    for (const t of seen.version.assessment_tasks as { id: string; task_type: string }[]) {
      const answer = t.task_type === 'objective_questions' ? { choices: { q1: 'b', q2: 'a' } } : { text: 'I would compare the months, check the outliers and write up what changed.' };
      await api().put(`/attempts/${attempt}/responses/${t.id}`).set(bearer(candidate)).send({ answer }).expect(200);
    }
    await api().post(`/attempts/${attempt}/submit`).set(bearer(candidate)).expect(201);
    const evaluation = (await api().post(`/attempts/${attempt}/evaluate`).set(bearer(owner)).expect(201)).body.id;
    await api().post(`/evaluations/${evaluation}/review`).set(bearer(owner)).send({ scores: [], notes: 'Fictional reviewer note' }).expect(201);
  });

  it('gives the organization one review of the application, from the snapshot, and nobody else', async () => {
    // A change after applying stays out of the organization's view.
    await api().put('/me/candidate-profile').set(bearer(candidate)).send({ full_name: 'Test Candidate Two', headline: 'Changed after applying' }).expect(200);
    const seen = (await review(owner).expect(200)).body;
    expect(seen.profile).toMatchObject({ full_name: 'Test Candidate Two', headline: 'Fictional analyst', email: candidate.email });
    for (const key of ['notification_prefs', 'time_zone', 'share_profile_consent', 'consent_updated_at', 'cv_path', 'onboarding_step']) expect(seen.profile).not.toHaveProperty(key);
    expect(seen).not.toHaveProperty('profile_snapshot');
    expect(seen).not.toHaveProperty('cv_snapshot_path');
    expect(seen.cover_note).toBe('Fictional cover note.');
    // Evidence for the job's required skill, with where it came from. Not a score.
    expect(seen.relevance.total).toBe(1);
    expect(seen.relevance.matched[0]).toMatchObject({ id: skill.id });
    expect(['listed', 'assessed']).toContain(seen.relevance.matched[0].evidence);
    // MIDAN's reviewed assessment, criterion by criterion, with the reviewer's note.
    const result = seen.assessment_attempts[0].evaluation_results;
    expect(result.status).toBe('reviewed');
    expect(result.criterion_scores.length).toBeGreaterThan(0);
    expect(result.criterion_scores[0].rubric_criteria).toHaveProperty('description_en');
    expect(JSON.stringify(result.criterion_scores)).not.toContain('answer_key');
    expect(result.evaluation_reviews[0].notes).toBe('Fictional reviewer note');
    expect(seen.application_status_history.map((h: { to_status: string }) => h.to_status)).toContain('submitted');
    expect(seen.team.map((m: { user_id: string }) => m.user_id)).toEqual(expect.arrayContaining([owner.id, recruiter.id]));

    expect((await review(recruiter).expect(200)).body.my_role).toBe('recruiter');
    await review(outsider).expect(403);
    await review(candidate).expect(403);
    await api().get(`${base()}/applications/00000000-0000-4000-8000-000000000000/review`).set(bearer(owner)).expect(404);
    await api().get(`/organizations/${org}/applications/${application}/review`).expect(401);
  });

  it('shortlists on purpose, undoes it without rejecting, and tells the candidate once per decision', async () => {
    await api().patch(`/applications/${application}/status`).set(bearer(outsider)).send({ status: 'shortlisted' }).expect(404);
    await api().patch(`/applications/${application}/status`).set(bearer(owner)).send({ status: 'shortlisted' }).expect(200);
    expect((await kinds(candidate)).filter((k) => k === 'application_shortlisted')).toHaveLength(1);
    // Undo: back to review, not rejected, and nothing more is announced.
    expect((await api().patch(`/applications/${application}/status`).set(bearer(recruiter)).send({ status: 'under_review' }).expect(200)).body.status).toBe('under_review');
    expect(decisions(await kinds(candidate))).toEqual(['application_shortlisted']);
    await api().patch(`/applications/${application}/status`).set(bearer(owner)).send({ status: 'shortlisted' }).expect(200);
    expect((await kinds(candidate)).filter((k) => k === 'application_shortlisted')).toHaveLength(2);
    const history = (await review(owner).expect(200)).body.application_status_history as { to_status: string; changed_by: { user_id: string } | null }[];
    expect(history.slice(-3).map((h) => h.to_status)).toEqual(['shortlisted', 'under_review', 'shortlisted']);
    expect(history.at(-2)?.changed_by?.user_id).toBe(recruiter.id);

    // A rejection by status tells the candidate. A rejection by a decision says it once, in the organization's words.
    if (!(await api().get('/me').set(bearer(second)).expect(200)).body.candidate_profiles) {
      await api().put('/me/candidate-profile').set(bearer(second)).send({ full_name: 'Test Candidate One' }).expect(200);
    }
    secondApplication = (await api().post(`/jobs/${job}/applications`).set(bearer(second)).send({}).expect(201)).body.id;
    await api().patch(`/applications/${secondApplication}/status`).set(bearer(owner)).send({ status: 'rejected' }).expect(200);
    const secondKinds = () => kinds(second);
    expect((await secondKinds()).filter((k) => k === 'application_rejected')).toHaveLength(1);
    await api().patch(`/applications/${secondApplication}/status`).set(bearer(owner)).send({ status: 'under_review' }).expect(200);
    await api().post(`${base()}/applications/${secondApplication}/outcome`).set(bearer(owner)).send({ outcome: 'not_selected', message_en: 'Thank you for applying.' }).expect(201);
    expect((await api().get(`/me/applications/${secondApplication}`).set(bearer(second)).expect(200)).body.status).toBe('rejected');
    const after = await secondKinds();
    expect(after.filter((k) => k === 'application_rejected')).toHaveLength(1);
    expect(after.filter((k) => k === 'hiring_decision')).toHaveLength(1);
  });

  it('keeps notes for the organization, as written', async () => {
    await api().post(`${base()}/applications/${application}/notes`).set(bearer(recruiter)).send({ body: '  Strong reporting examples.  ' }).expect(201);
    await api().post(`${base()}/applications/${application}/notes`).set(bearer(owner)).send({ body: '' }).expect(400);
    await api().post(`${base()}/applications/${application}/notes`).set(bearer(outsider)).send({ body: 'x' }).expect(403);
    await api().post(`${base()}/applications/${application}/notes`).set(bearer(candidate)).send({ body: 'x' }).expect(403);
    const notes = (await review(owner).expect(200)).body.notes as { id: string; body: string; author: { user_id: string } }[];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: 'Strong reporting examples.', author: { user_id: recruiter.id } });
    expect((await rest(candidate, 'GET', `application_notes?application_id=eq.${application}`)).body).toEqual([]);
    expect((await rest(outsider, 'GET', `application_notes?application_id=eq.${application}`)).body).toEqual([]);
    await rest(recruiter, 'PATCH', `application_notes?id=eq.${notes[0].id}`, { body: 'Rewritten' });
    await rest(recruiter, 'DELETE', `application_notes?id=eq.${notes[0].id}`);
    expect((await review(owner).expect(200)).body.notes[0].body).toBe('Strong reporting examples.');
  });

  it('schedules interviews with chosen participants, and tells the candidate about a cancellation', async () => {
    const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    interview = (await api().post(`${base()}/applications/${application}/interviews`).set(bearer(owner))
      .send({ scheduled_at: inMinutes(60), duration_minutes: 45, interviewer_ids: [recruiter.id] }).expect(201)).body.id;
    otherInterview = (await api().post(`${base()}/applications/${application}/interviews`).set(bearer(owner)).send({ scheduled_at: inMinutes(120) }).expect(201)).body.id;
    const interviews = (await review(owner).expect(200)).body.interviews as { id: string; participants: { user_id: string }[]; time_zone: string }[];
    const first = interviews.find((i) => i.id === interview)!;
    expect(first.participants.map((p) => p.user_id).sort()).toEqual([owner.id, recruiter.id].sort());
    expect(first.time_zone).toBe('Asia/Riyadh');
    expect(interviews.find((i) => i.id === otherInterview)!.participants.map((p) => p.user_id)).toEqual([owner.id]);
    expect(await kinds(candidate)).toContain('interview_invited');
    await api().patch(`${base()}/interviews/${otherInterview}`).set(bearer(owner)).send({ status: 'cancelled' }).expect(200);
    expect((await kinds(candidate)).filter((k) => k === 'interview_cancelled')).toHaveLength(1);
  });

  it("records each interviewer's feedback: a private draft, then submitted for good, apart from the assessment", async () => {
    const path = (id: string) => `${base()}/applications/${application}/interviews/${id}/feedback`;
    const competencies = [{ label: 'Data analysis', rating: 3, evidence: 'Walked through a monthly report clearly.' }];
    // Only participants: the recruiter isn't one of the second interview's.
    await api().put(path(otherInterview)).set(bearer(recruiter)).send({ status: 'draft', competencies }).expect(403);
    // And not on a cancelled interview, even for a participant.
    await api().put(path(otherInterview)).set(bearer(owner)).send({ status: 'draft', competencies }).expect(422);
    await api().put(path(interview)).set(bearer(outsider)).send({ status: 'draft', competencies }).expect(403);
    await api().put(path(interview)).set(bearer(candidate)).send({ status: 'draft', competencies }).expect(403);
    await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'draft', competencies: [{ label: 'x', rating: 5 }] }).expect(400);

    await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'draft', competencies: [{ label: 'Data analysis' }], notes: 'Draft thoughts' }).expect(200);
    const byOwner = (await review(owner).expect(200)).body.interviews.find((i: { id: string }) => i.id === interview);
    expect(byOwner.feedback).toEqual([]);
    const byRecruiter = (await review(recruiter).expect(200)).body.interviews.find((i: { id: string }) => i.id === interview);
    expect(byRecruiter.feedback[0]).toMatchObject({ status: 'draft', notes: 'Draft thoughts' });

    // Submitting needs every competency rated and a recommendation.
    await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'submitted', competencies: [{ label: 'Data analysis' }], recommendation: 'yes' }).expect(422);
    await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'submitted', competencies }).expect(422);
    const done = (await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'submitted', competencies, recommendation: 'yes', notes: 'Clear and careful.' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'submitted', author_id: recruiter.id, recommendation: 'yes' });
    expect(done.submitted_at).toBeTruthy();
    await api().put(path(interview)).set(bearer(recruiter)).send({ status: 'draft', competencies }).expect(422);
    expect((await rest(recruiter, 'PATCH', `interview_feedback?id=eq.${done.id}`, { recommendation: 'no' })).body).toEqual([]);

    const seen = (await review(owner).expect(200)).body.interviews.find((i: { id: string }) => i.id === interview).feedback;
    expect(seen).toEqual([expect.objectContaining({ status: 'submitted', recommendation: 'yes', author: expect.objectContaining({ user_id: recruiter.id }) })]);
    expect((await rest(candidate, 'GET', `interview_feedback?application_id=eq.${application}`)).body).toEqual([]);
    expect((await rest(outsider, 'GET', `interview_feedback?application_id=eq.${application}`)).body).toEqual([]);
    // It never touches MIDAN's assessment result.
    const result = (await review(owner).expect(200)).body.assessment_attempts[0].evaluation_results;
    expect(result.status).toBe('reviewed');
  });

  it('leaves the decision to a person, and shows the candidate where they stand', async () => {
    await api().patch(`${base()}/interviews/${interview}`).set(bearer(owner)).send({ status: 'completed' }).expect(200);
    // Feedback recommended, but nothing changed: the application waits for the organization's decision.
    expect((await api().get(`/me/applications/${application}`).set(bearer(candidate)).expect(200)).body.status).toBe('shortlisted');
    await api().post(`${base()}/applications/${application}/outcome`).set(bearer(recruiter)).send({ outcome: 'hired', message_en: 'Welcome aboard.' }).expect(201);
    const mine = (await api().get(`/me/applications/${application}`).set(bearer(candidate)).expect(200)).body;
    expect(mine.status).toBe('hired');
    expect(mine.application_status_history.map((h: { to_status: string }) => h.to_status).at(-1)).toBe('hired');
    expect(mine).not.toHaveProperty('notes');
    expect(JSON.stringify(mine)).not.toContain('Strong reporting examples');
    expect(JSON.stringify(mine)).not.toContain('Clear and careful');
    const notices = await kinds(candidate);
    expect(notices).toContain('hiring_decision');
    expect(notices).not.toContain('application_rejected');
  });
});
