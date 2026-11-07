import { applicantProfile, withApplicantName } from '../common/applicant';
import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AiClient, Provenance } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { EVALUATORS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class HumanScoreDto {
  @ApiProperty() @IsUUID() criterion_id!: string;
  @ApiProperty() @IsNumber() @Min(0) score!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
}

class ReviewDto {
  @ApiProperty({ type: [HumanScoreDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => HumanScoreDto) scores!: HumanScoreDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

type Proposal = { criterion_id: string; task_id: string; score: number; source: 'deterministic' | 'ai_assisted'; evidence_ref: string | null; explanation: string; confidence: number };
type ReferenceScore = { reference_skill_id: string; name_ar: string; score_pct: number };
type Proposed = { proposals: Proposal[]; overall: number; skill_levels: { skill_id: string; level: number }[]; reference_skills?: ReferenceScore[]; review_reasons: string[] };
type Final = { overall: number; skill_levels: { skill_id: string; level: number }[]; reference_skills?: ReferenceScore[]; report: Prisma.InputJsonValue };

@ApiTags('evaluations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class EvaluationsController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Post('attempts/:id/evaluate')
  @ApiOperation({ summary: 'Runs the evaluation graph on submitted work and stores proposals for human review.' })
  async evaluate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const snapshot = await this.db.asUser(user, async (tx) => {
      const attempt = await tx.assessment_attempts.findFirst({
        where: { id },
        include: {
          assessment_versions: {
            include: {
              assessment_tasks: {
                orderBy: { position: 'asc' },
                include: { rubric_criteria: true, task_skill_mappings: { include: { skills: true } } },
              },
              assessments: {
                select: { jobs: { select: { job_reference_skills: { select: { reference_skills: { select: { id: true, name_ar: true, description_ar: true } } } } } } },
              },
            },
          },
          task_responses: true,
          evidence_files: { select: { task_id: true, file_name: true } },
          evaluation_results: { select: { id: true } },
          applications: { select: { profile_snapshot: true, users: { select: { display_name: true } } } },
        },
      });
      if (!attempt) throw new NotFoundException();
      await requireRole(tx, user, attempt.org_id, EVALUATORS);
      if (attempt.status !== 'submitted') throw new UnprocessableEntityException('Only submitted work can be evaluated');
      if (attempt.evaluation_results) throw new ConflictException('This attempt already has an evaluation');
      return attempt;
    });

    const tasks = snapshot.assessment_versions.assessment_tasks;
    const skills = new Map(tasks.flatMap((t) => t.task_skill_mappings.map((m) => [m.skill_id, m.skills] as const)));
    const threadId = `evaluation-${id}`;
    const payload = {
      attempt_id: id,
      attempt_status: snapshot.status,
      // Names to redact from answers: the one the candidate applied under, and their account's.
      known_names: [applicantProfile(snapshot.applications.profile_snapshot)?.full_name, snapshot.applications.users.display_name].filter(Boolean),
      rubric_version: snapshot.assessment_versions.version_number,
      skills: [...skills.values()].map((s) => ({ id: s.id, slug: s.slug, name_ar: s.name_ar, name_en: s.name_en })),
      // The workbook skills the job links and its tasks measure. Names stay Arabic: the workbooks have no others.
      reference_skills: snapshot.assessment_versions.assessments.jobs.job_reference_skills.map((r) => r.reference_skills)
        .filter((r) => tasks.some((t) => t.reference_skill_ids.includes(r.id))),
      tasks: tasks.map((t) => ({
        id: t.id, task_type: t.task_type, weight: Number(t.weight),
        // Arabic first, as candidates read them and mostly answer.
        title_ar: t.title_ar, instructions_ar: t.instructions_ar, title_en: t.title_en, instructions_en: t.instructions_en,
        reference_skill_ids: t.reference_skill_ids,
        skill_ids: t.task_skill_mappings.map((m) => m.skill_id),
        skill_weights: Object.fromEntries(t.task_skill_mappings.map((m) => [m.skill_id, Number(m.weight)])),
        criteria: t.rubric_criteria.map((c) => ({
          id: c.id, code: c.code, description_ar: c.description_ar, description_en: c.description_en, max_score: Number(c.max_score), weight: Number(c.weight), answer_key: c.answer_key,
        })),
      })),
      responses: Object.fromEntries(snapshot.task_responses.map((r) => [r.task_id, r.answer])),
      evidence: snapshot.evidence_files.reduce<Record<string, string[]>>((all, f) => {
        (all[f.task_id] ??= []).push(f.file_name);
        return all;
      }, {}),
    };

    const result = await this.ai.run<Proposed>('evaluation', { thread_id: threadId, input: payload });
    if (result.status !== 'awaiting_human_review') throw new UnprocessableEntityException('This work could not be evaluated');
    return this.persistProposal(user, snapshot.org_id, id, threadId, result.payload, result.provenance, payload.rubric_version);
  }

  private persistProposal(user: AuthUser, orgId: string, attemptId: string, threadId: string, proposed: Proposed, provenance: Provenance, rubricVersion: number) {
    return this.db.asUser(user, async (tx) => {
      const evaluation = await tx.evaluation_results.create({
        data: {
          attempt_id: attemptId, org_id: orgId, status: 'needs_human_review', overall_score: proposed.overall,
          ai_thread_id: threadId, ai_mode: provenance.mode, review_reasons: proposed.review_reasons,
        },
      });
      await tx.criterion_scores.createMany({
        data: proposed.proposals.map((p) => ({
          result_id: evaluation.id, criterion_id: p.criterion_id, org_id: orgId, score: p.score, source: p.source,
          evidence_ref: p.evidence_ref, explanation: p.explanation, confidence: p.confidence,
          model_version: provenance.model_version, prompt_version: provenance.prompt_version, rubric_version: rubricVersion,
        })),
      });
      await tx.ai_workflow_runs.create({
        data: { org_id: orgId, workflow: 'evaluation', thread_id: threadId, status: 'awaiting_human_review', started_by: user.id, ...provenance },
      });
      return evaluation;
    });
  }

  @Get('attempts/:id/evaluation')
  @ApiOperation({ summary: 'Everything a reviewer needs, for staff of the owning organization only.' })
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const attempt = await tx.assessment_attempts.findFirst({
        where: { id },
        include: {
          applications: {
            select: {
              job_id: true,
              jobs: { select: { title_ar: true, title_en: true } },
              profile_snapshot: true,
            },
          },
          task_responses: true,
          evidence_files: { select: { id: true, task_id: true, file_name: true, size_bytes: true } },
          assessment_versions: {
            select: {
              version_number: true,
              assessments: { select: { title_ar: true, title_en: true } },
              assessment_tasks: { orderBy: { position: 'asc' }, include: { rubric_criteria: { orderBy: { code: 'asc' } } } },
            },
          },
          evaluation_results: {
            include: {
              criterion_scores: true,
              skill_scores: { include: { skills: { select: { name_ar: true, name_en: true } } } },
              reference_skill_scores: { orderBy: { score_pct: 'desc' }, include: { reference_skills: { select: { name_ar: true } } } },
              evaluation_reviews: { orderBy: { created_at: 'desc' } },
            },
          },
        },
      });
      if (!attempt) throw new NotFoundException();
      await requireRole(tx, user, attempt.org_id);
      return { ...attempt, applications: withApplicantName(attempt.applications) };
    });
  }

  @Post('evaluations/:id/review')
  @ApiOperation({ summary: 'The human decision. Totals are recomputed in code from the final scores.' })
  async submitReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    const evaluation = await this.db.asUser(user, async (tx) => {
      const found = await tx.evaluation_results.findFirst({
        where: { id },
        include: {
          criterion_scores: { select: { criterion_id: true } },
          assessment_attempts: {
            select: { assessment_versions: { select: { assessment_tasks: { select: { rubric_criteria: { select: { id: true, max_score: true } } } } } } },
          },
        },
      });
      if (!found) throw new NotFoundException();
      await requireRole(tx, user, found.org_id, EVALUATORS);
      if (found.status === 'reviewed') throw new ConflictException('This evaluation was already reviewed');
      return found;
    });

    const criteria = evaluation.assessment_attempts.assessment_versions.assessment_tasks.flatMap((t) => t.rubric_criteria);
    const limits = new Map(criteria.map((c) => [c.id, Number(c.max_score)]));
    for (const s of body.scores) {
      if (!limits.has(s.criterion_id) || s.score > (limits.get(s.criterion_id) as number)) {
        throw new UnprocessableEntityException('A score is out of range');
      }
    }
    const scored = new Set([...evaluation.criterion_scores.map((c) => c.criterion_id), ...body.scores.map((s) => s.criterion_id)]);
    if (criteria.some((c) => !scored.has(c.id))) throw new UnprocessableEntityException('Every criterion needs a score');

    const final = await this.ai.resume<Final>('evaluation', evaluation.ai_thread_id as string, {
      scores: Object.fromEntries(body.scores.map((s) => [s.criterion_id, s.score])),
      reviewer: user.id,
    });
    if (final.status !== 'reviewed') throw new UnprocessableEntityException('This evaluation could not be finalized');

    return this.db.asUser(user, async (tx) => {
      await tx.criterion_scores.createMany({
        data: body.scores.map((s) => ({
          result_id: id, criterion_id: s.criterion_id, org_id: evaluation.org_id, score: s.score, source: 'human_reviewed' as const,
          explanation: s.explanation, created_by: user.id,
        })),
      });
      await tx.skill_scores.createMany({
        data: final.payload.skill_levels.map((s) => ({
          result_id: id, skill_id: s.skill_id, org_id: evaluation.org_id, level: s.level, source: 'human_reviewed' as const,
        })),
      });
      await tx.reference_skill_scores.createMany({
        data: (final.payload.reference_skills ?? []).map((s) => ({
          result_id: id, reference_skill_id: s.reference_skill_id, org_id: evaluation.org_id, score_pct: s.score_pct, source: 'human_reviewed' as const,
        })),
      });
      if (body.notes?.trim()) {
        await tx.evaluation_reviews.create({ data: { result_id: id, org_id: evaluation.org_id, reviewer_id: user.id, notes: body.notes.trim() } });
      }
      await tx.ai_workflow_runs.updateMany({ where: { thread_id: evaluation.ai_thread_id as string }, data: { status: 'reviewed' } });
      return tx.evaluation_results.update({
        where: { id },
        data: { status: 'reviewed', overall_score: final.payload.overall, report: final.payload.report },
      });
    });
  }

  @Post('evaluations/:id/release')
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const found = await tx.evaluation_results.findFirst({ where: { id } });
      if (!found) throw new NotFoundException();
      await requireRole(tx, user, found.org_id, EVALUATORS);
      if (found.status !== 'reviewed') throw new UnprocessableEntityException('Review this evaluation first');
      return tx.evaluation_results.update({ where: { id }, data: { released_to_candidate: true } });
    });
  }

  @Get('attempts/:id/report')
  @ApiOperation({ summary: "The candidate's report. Exists only after the organization releases it." })
  report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const criteria = await tx.$queryRaw<unknown[]>`select * from public.released_result_details(${id}::uuid)`;
      const result = await tx.evaluation_results.findFirst({
        where: { attempt_id: id, released_to_candidate: true, assessment_attempts: { candidate_id: user.id } },
        select: {
          overall_score: true, report: true, ai_mode: true, released_at: true,
          assessment_attempts: { select: { assessment_versions: { select: { assessments: { select: { title_ar: true, title_en: true } } } }, applications: { select: { jobs: { select: { title_ar: true, title_en: true, organizations: { select: { name_ar: true, name_en: true } } } } } } } },
          skill_scores: {
            select: {
              level: true, source: true,
              skills: { select: { id: true, name_ar: true, name_en: true, skill_levels: { orderBy: { level: 'asc' } } } },
            },
          },
          reference_skill_scores: { orderBy: { score_pct: 'desc' }, select: { score_pct: true, reference_skills: { select: { id: true, name_ar: true, description_ar: true } } } },
        },
      });
      if (!result) throw new NotFoundException();
      return { ...result, criteria };
    });
  }

  @Get('organizations/:orgId/jobs/:jobId/report')
  @ApiOperation({ summary: 'Attempts for one job. Compare only within one assessment version, where the criteria are the same.' })
  compare(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const attempts = await tx.assessment_attempts.findMany({
        where: { org_id: orgId, applications: { job_id: jobId, status: { not: 'withdrawn' } } },
        orderBy: { created_at: 'asc' },
        select: {
          id: true, status: true,
          assessment_versions: { select: { id: true, version_number: true, assessment_id: true, assessments: { select: { title_ar: true, title_en: true } } } },
          applications: { select: { profile_snapshot: true, users: { select: { email: true } } } },
          evaluation_results: {
            select: {
              id: true, status: true, overall_score: true, released_to_candidate: true,
              skill_scores: { select: { skill_id: true, level: true, skills: { select: { name_ar: true, name_en: true } } } },
            },
          },
        },
      });
      return attempts.map((a) => ({ ...a, applications: withApplicantName(a.applications) }));
    });
  }
}
