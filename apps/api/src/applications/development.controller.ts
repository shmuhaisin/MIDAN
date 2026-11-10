import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';
import { jobMatchItems, matchSnapshot, type MatchItem } from './ats';

type Fact = { id: string; kind: string; text: string; requirement_key?: string };
type Row = { id: string; status: string; content: unknown; provenance: unknown; created_by: string; created_at: Date; released_by: string | null; released_at: Date | null };
type Competency = { label?: unknown; rating?: unknown };

const label = (r: MatchItem) => [r.text_en, r.text_ar].filter(Boolean).join(' / ');
const SELECT = 'id, status, content, provenance, created_by, created_at, released_by, released_at';

/**
 * A candidate's development report: written from their own evidence only, reviewed by the organization's staff, released
 * by an owner, admin or recruiter, and then read by the candidate (told through the in-app notifications). What it is
 * built from is listed in `evidence`, so the candidate sees the same basis the narrative cites. It holds no internal
 * notes, interviewer names or evidence text, no other candidate's results, no ranking and no contact details.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class DevelopmentReportController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get('organizations/:orgId/applications/:applicationId/development-reports')
  @ApiOperation({ summary: "The application's development reports, newest first, drafts included: staff only." })
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return tx.$queryRawUnsafe<Row[]>(`select ${SELECT} from public.candidate_development_reports where application_id = $1::uuid and org_id = $2::uuid order by created_at desc`, id, orgId);
    });
  }

  @Post('organizations/:orgId/applications/:applicationId/development-reports')
  @ApiOperation({ summary: "A new draft from the candidate's own evidence, the narrative written by MIDAN's model from cited facts. 503 without a model." })
  async draft(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string) {
    const data = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const application = await tx.applications.findFirst({
        where: { id, org_id: orgId, status: { not: 'withdrawn' } },
        select: {
          job_id: true, profile_snapshot: true,
          jobs: { select: { title_ar: true, title_en: true } },
          assessment_attempts: {
            select: {
              evaluation_results: {
                select: {
                  status: true, overall_score: true,
                  criterion_scores: { select: { score: true, rubric_criteria: { select: { code: true, description_ar: true, description_en: true, max_score: true } } } },
                },
              },
            },
          },
        },
      });
      if (!application) throw new NotFoundException();
      const [items, feedback] = await Promise.all([
        jobMatchItems(tx, orgId, application.job_id),
        tx.interview_feedback.findMany({ where: { application_id: id, org_id: orgId, status: 'submitted' }, select: { competencies: true } }),
      ]);
      return { application: { ...application, interview_feedback: feedback }, items };
    });
    const { application, items } = data;
    const { result: cv } = items.length ? await matchSnapshot(this.ai, items, application.profile_snapshot, 'fast').catch(() => ({ result: null })) : { result: null };

    const facts: Fact[] = [];
    const add = (kind: string, text: string, requirement_key?: string) => {
      if (text.trim() && facts.length < 120) facts.push({ id: `F${facts.length + 1}`, kind, text: text.slice(0, 1500), ...(requirement_key && { requirement_key }) });
    };
    add('job', `Role applied for: ${application.jobs.title_en} / ${application.jobs.title_ar}`);
    const byKey = new Map(items.map((r) => [r.key, r]));
    const shown: string[] = [];
    const notShown: string[] = [];
    for (const m of cv?.matches ?? []) {
      const r = byKey.get(m.key);
      if (!r) continue;
      if (m.status === 'matched') { add('cv_strength', `Your application shows: ${label(r)}`, m.key); shown.push(m.key); }
      else if (m.status === 'missing' || m.status === 'partial') {
        add('cv_gap', `${m.status === 'partial' ? 'Your application partly shows' : "Your application doesn't show"}: ${label(r)}${r.mandatory ? ' (a required part of the role)' : ''}`, m.key);
        notShown.push(m.key);
      }
    }
    const assessment: { criterion: string; description_ar: string; description_en: string; score: number; max: number }[] = [];
    for (const a of application.assessment_attempts) {
      const e = a.evaluation_results;
      if (e?.status !== 'reviewed') continue; // only results a person reviewed
      for (const c of e.criterion_scores) {
        const row = { criterion: c.rubric_criteria.code, description_ar: c.rubric_criteria.description_ar, description_en: c.rubric_criteria.description_en, score: Number(c.score), max: Number(c.rubric_criteria.max_score) };
        assessment.push(row);
        add('assessment', `Assessment criterion "${row.description_en}": ${row.score} of ${row.max}`);
      }
    }
    // Interview competencies as rated: the average per competency only. Never who rated, their notes or their evidence.
    const ratings = new Map<string, number[]>();
    for (const f of application.interview_feedback) {
      for (const c of Array.isArray(f.competencies) ? (f.competencies as Competency[]) : []) {
        if (typeof c?.label === 'string' && typeof c.rating === 'number') ratings.set(c.label, [...(ratings.get(c.label) ?? []), c.rating]);
      }
    }
    const interview = [...ratings].map(([name, r]) => ({ label: name, average: Math.round((r.reduce((x, y) => x + y, 0) / r.length) * 10) / 10 }));
    for (const c of interview) add('interview', `Interview competency "${c.label}": rated ${c.average} of 4`);
    if (facts.length < 2) throw new ServiceUnavailableException({ message: 'There is no evidence yet to write a report from', reason: 'no_evidence' });

    const reply = await this.ai.interview<{ strengths: unknown[]; development: unknown[]; next_steps: unknown[] }>('development-report', {
      title_ar: application.jobs.title_ar, title_en: application.jobs.title_en, facts,
    });
    if (!reply.ok) throw new ServiceUnavailableException({ message: "MIDAN's model is not available to write this report", reason: reply.reason });
    const evidenceLine = (key: string) => { const r = byKey.get(key)!; return { key, text_ar: r.text_ar, text_en: r.text_en, mandatory: r.mandatory }; };
    const content = {
      strengths: reply.strengths, development: reply.development, next_steps: reply.next_steps, facts,
      evidence: { requirements: { shown: shown.map(evidenceLine), not_shown: notShown.map(evidenceLine) }, assessment, interview },
    };
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `insert into public.candidate_development_reports (application_id, org_id, candidate_id, content, provenance, created_by)
         select a.id, a.org_id, a.candidate_id, $2::jsonb, $3::jsonb, $4::uuid from public.applications a where a.id = $1::uuid
         returning ${SELECT}`, id, JSON.stringify(content), JSON.stringify(reply.provenance), user.id);
      return row;
    });
  }

  @Post('organizations/:orgId/applications/:applicationId/development-reports/:reportId/release')
  @ApiOperation({ summary: 'Releases a draft to the candidate, who is told in their notifications. A released report never changes.' })
  release(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string, @Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const rows = await tx.$queryRawUnsafe<Row[]>(
        `update public.candidate_development_reports set status = 'released' where id = $1::uuid and application_id = $2::uuid and org_id = $3::uuid and status = 'draft' returning ${SELECT}`,
        reportId, id, orgId);
      if (rows.length === 0) throw new NotFoundException();
      return rows[0];
    });
  }

  @Get('me/applications/:applicationId/development-report')
  @ApiOperation({ summary: "The candidate's latest released development report for one of their applications, or null." })
  async mine(@CurrentUser() user: AuthUser, @Param('applicationId', ParseUUIDPipe) id: string) {
    const rows = await this.db.asUser(user, (tx) => tx.$queryRawUnsafe<(Row & { content: Record<string, unknown> })[]>(
      `select id, content, released_at from public.candidate_development_reports
       where application_id = $1::uuid and candidate_id = $2::uuid and status = 'released' order by released_at desc limit 1`, id, user.id));
    if (!rows[0]) return null;
    // The candidate reads the narrative and its evidence; the internal fact list stays with the organization.
    const { facts: _facts, ...content } = rows[0].content;
    return { id: rows[0].id, released_at: rows[0].released_at, content };
  }
}
