import { randomUUID } from 'node:crypto';
import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PROFESSIONAL_FIELDS } from '../common/fields';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class AssessmentFieldDto {
  @ApiPropertyOptional({ enum: PROFESSIONAL_FIELDS, nullable: true }) @IsOptional() @IsIn(PROFESSIONAL_FIELDS) professional_field?: string | null;
}

class GenerateDto {
  @ApiPropertyOptional({ description: 'Adds a version to this assessment.' }) @IsOptional() @IsUUID() assessment_id?: string;
  @ApiPropertyOptional({ description: 'With title_en, starts another assessment for the job.' })
  @ValidateIf((o) => o.title_ar !== undefined || o.title_en !== undefined) @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => o.title_ar !== undefined || o.title_en !== undefined) @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
}

class UpdateAssessmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
}

class VersionSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) scenario_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) scenario_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2160) deadline_hours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_timed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() rubric_shared?: boolean;
}

class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() weight?: number;
}

class UpdateCriterionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() max_score?: number;
  @ApiPropertyOptional() @ValidateIf((o) => o.requirement_id !== null) @IsOptional() @IsUUID() requirement_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() weight?: number;
}

class NewCriterionDto {
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(2000) description_ar!: string;
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(2000) description_en!: string;
  @ApiPropertyOptional() @IsNumber() @IsPositive() @Max(100) max_score!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() requirement_id?: string;
}

/** A task an organization writes by hand. Open-answer types only: objective questions need an answer key built with them. */
class NewTaskDto {
  @ApiPropertyOptional({ enum: ['written_case_study', 'file_submission'] }) @IsIn(['written_case_study', 'file_submission']) task_type!: 'written_case_study' | 'file_submission';
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(200) title_ar!: string;
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(200) title_en!: string;
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_ar!: string;
  @ApiPropertyOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_en!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() weight?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) requirement_ids?: string[];
  @ApiPropertyOptional({ type: [NewCriterionDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => NewCriterionDto) criteria!: NewCriterionDto[];
}

type DraftTask = {
  position: number; task_type: Prisma.assessment_tasksCreateManyInput['task_type'];
  title_ar: string; title_en: string; instructions_ar: string; instructions_en: string;
  weight: number; config: Prisma.InputJsonValue; skill_ids: string[]; requirement_ids?: string[]; reference_skill_ids?: string[];
  criteria: {
    code: string; description_ar: string; description_en: string; max_score: number; weight: number; answer_key: Prisma.InputJsonValue | null;
    requirement_id?: string | null; reference_skill_id?: string | null;
  }[];
};
type Draft = { tasks: DraftTask[]; warnings: string[] };

const ASSESSMENT_SUMMARY = {
  id: true, title_ar: true, title_en: true, professional_field: true,
  assessment_versions: { orderBy: { version_number: 'desc' }, select: { id: true, version_number: true, status: true } },
} satisfies Prisma.assessmentsSelect;

@ApiTags('assessments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId')
export class AssessmentsController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get('jobs/:jobId/assessment')
  @ApiOperation({ summary: "The job's assessments, and the latest version of one with its confidential rubric. Without a choice, the oldest assessment." })
  async latest(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Query('assessment', new ParseUUIDPipe({ optional: true })) assessmentId?: string,
  ) {
    const { version, assessments } = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const all = await tx.assessments.findMany({ where: { org_id: orgId, job_id: jobId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select: ASSESSMENT_SUMMARY });
      if (assessmentId && !all.some((a) => a.id === assessmentId)) throw new NotFoundException();
      const chosen = assessmentId ?? all[0]?.id;
      const found = !chosen ? null : await tx.assessment_versions.findFirst({
        where: { org_id: orgId, assessment_id: chosen },
        orderBy: { version_number: 'desc' },
        include: {
          assessments: { select: { id: true, title_ar: true, title_en: true, professional_field: true } },
          assessment_tasks: {
            orderBy: { position: 'asc' },
            include: {
              rubric_criteria: { orderBy: { code: 'asc' } },
              task_skill_mappings: { include: { skills: { select: { id: true, name_ar: true, name_en: true } } } },
              task_requirement_mappings: { select: { requirement_id: true } },
            },
          },
        },
      });
      return { version: found, assessments: all };
    });
    const run = version?.ai_thread_id
      ? await this.db.asUser(user, (tx) => tx.ai_workflow_runs.findUnique({ where: { thread_id: version.ai_thread_id as string }, select: { mode: true, model_version: true } }))
      : null;
    return { version, run, assessments };
  }

  @Post('jobs/:jobId/assessment/generate')
  @ApiOperation({ summary: 'Runs the assessment builder graph and saves the result as a draft. Never publishes.' })
  async generate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() body: GenerateDto) {
    const { job, taxonomy, target, existing } = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.jobs.findFirst({
        where: { id: jobId, org_id: orgId },
        include: {
          job_skills: { include: { skills: true } },
          // Only what the employer stated or approved shapes the draft.
          job_requirements: { where: { retired_at: null, review_status: 'approved' }, orderBy: { position: 'asc' } },
          job_reference_skills: { include: { reference_skills: { select: { id: true, name_ar: true, description_ar: true } } } },
        },
      });
      if (!found) throw new NotFoundException();
      const assessment = body.assessment_id
        ? await tx.assessments.findFirst({ where: { id: body.assessment_id, org_id: orgId, job_id: jobId } })
        : body.title_ar ? null : await tx.assessments.findFirst({ where: { org_id: orgId, job_id: jobId }, orderBy: { created_at: 'asc' } });
      if (body.assessment_id && !assessment) throw new NotFoundException();
      return {
        job: found,
        target: assessment,
        taxonomy: await tx.skills.findMany(),
        existing: !assessment ? null : await tx.assessment_versions.findFirst({ where: { assessment_id: assessment.id }, orderBy: { version_number: 'desc' } }),
      };
    });
    if (existing && ['draft', 'in_review'].includes(existing.status)) throw new ConflictException('A draft already exists');

    const toRef = (s: (typeof taxonomy)[number]) => ({ id: s.id, slug: s.slug, name_ar: s.name_ar, name_en: s.name_en, synonyms: s.synonyms });
    const threadId = `builder-${randomUUID()}`;
    const result = await this.ai.run<Draft>('assessment-builder', {
      thread_id: threadId,
      job: {
        title_ar: job.title_ar, title_en: job.title_en,
        description_ar: job.description_ar, description_en: job.description_en,
        requirements_ar: job.requirements_ar, requirements_en: job.requirements_en,
        required_skills: job.job_skills.map((j) => toRef(j.skills)),
        taxonomy: taxonomy.map(toRef),
        requirements: job.job_requirements.map((r) => ({
          id: r.id, requirement_type: r.requirement_type, description_ar: r.description_ar, description_en: r.description_en, is_mandatory: r.is_mandatory,
        })),
        reference_skills: job.job_reference_skills.map((r) => ({
          id: r.reference_skills.id, name_ar: r.reference_skills.name_ar, description_ar: r.reference_skills.description_ar, is_required: r.is_required,
        })),
      },
    });
    if (result.status !== 'awaiting_human_review') throw new UnprocessableEntityException('The draft could not be generated');

    return this.db.asUser(user, async (tx) => {
      const assessment = target ?? await tx.assessments.create({
        data: { org_id: orgId, job_id: jobId, title_ar: body.title_ar ?? job.title_ar, title_en: body.title_en ?? job.title_en },
      });
      const version = await tx.assessment_versions.create({
        data: {
          assessment_id: assessment.id, org_id: orgId, version_number: (existing?.version_number ?? 0) + 1,
          duration_minutes: 45, ai_thread_id: threadId,
          instructions_ar: 'أكمل المهام بأسلوبك. قيّم هذا العمل بنفسك دون مساعدة خارجية، واحفظ إجاباتك أولًا بأول.',
          instructions_en: 'Complete the tasks in your own way. Do the work yourself, without outside help. Your answers save as you go.',
        },
      });
      for (const task of result.payload.tasks) {
        const created = await tx.assessment_tasks.create({
          data: {
            version_id: version.id, org_id: orgId, position: task.position, task_type: task.task_type,
            title_ar: task.title_ar, title_en: task.title_en, instructions_ar: task.instructions_ar, instructions_en: task.instructions_en,
            weight: task.weight, config: task.config, reference_skill_ids: task.reference_skill_ids ?? [],
          },
        });
        await tx.rubric_criteria.createMany({
          data: task.criteria.map((c) => ({
            task_id: created.id, org_id: orgId, code: c.code, description_ar: c.description_ar, description_en: c.description_en,
            max_score: c.max_score, weight: c.weight, answer_key: c.answer_key ?? Prisma.DbNull,
            requirement_id: c.requirement_id ?? null, reference_skill_id: c.reference_skill_id ?? null,
          })),
        });
        if (task.requirement_ids?.length) {
          await tx.task_requirement_mappings.createMany({ data: task.requirement_ids.map((requirement_id) => ({ task_id: created.id, requirement_id, org_id: orgId })) });
        }
        await tx.task_skill_mappings.createMany({
          data: [...new Set(task.skill_ids)].map((skill_id) => ({ task_id: created.id, org_id: orgId, skill_id })),
        });
      }
      await tx.ai_workflow_runs.create({
        data: { org_id: orgId, workflow: 'assessment_builder', thread_id: threadId, status: 'awaiting_human_review', started_by: user.id, ...result.provenance },
      });
      return { version_id: version.id, assessment_id: assessment.id, warnings: result.payload.warnings, mode: result.provenance.mode };
    });
  }

  @Patch('assessments/:assessmentId')
  rename(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('assessmentId', ParseUUIDPipe) id: string, @Body() body: UpdateAssessmentDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.assessments.updateMany({ where: { id, org_id: orgId }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.assessments.findUniqueOrThrow({ where: { id } });
    });
  }

  @Delete('assessments/:assessmentId')
  @ApiOperation({ summary: 'Removes an assessment that was never published. Published ones stay, so results remain traceable.' })
  remove(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('assessmentId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.assessments.findFirst({ where: { id, org_id: orgId }, select: { assessment_versions: { select: { status: true } } } });
      if (!found) throw new NotFoundException();
      if (found.assessment_versions.some((v) => !['draft', 'in_review'].includes(v.status))) throw new ConflictException('A published assessment cannot be removed');
      await tx.assessments.delete({ where: { id } });
      return { removed: true };
    });
  }

  @Patch('assessments/:assessmentId/field')
  @ApiOperation({ summary: 'The professional field decides which approved Humaidan candidates see.' })
  setField(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('assessmentId', ParseUUIDPipe) id: string, @Body() body: AssessmentFieldDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.assessments.updateMany({ where: { id, org_id: orgId }, data: { professional_field: body.professional_field ?? null } });
      if (count === 0) throw new NotFoundException();
      return tx.assessments.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post('assessment-versions/:versionId/tasks')
  @ApiOperation({ summary: 'Adds a task by hand to a draft, with its rubric. A published version refuses it.' })
  addTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() body: NewTaskDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const version = await tx.assessment_versions.findFirst({ where: { id: versionId, org_id: orgId }, select: { id: true, assessment_tasks: { select: { position: true } } } });
      if (!version) throw new NotFoundException();
      const position = Math.max(0, ...version.assessment_tasks.map((t) => t.position)) + 1;
      const task = await tx.assessment_tasks.create({
        data: {
          version_id: versionId, org_id: orgId, position, task_type: body.task_type, title_ar: body.title_ar, title_en: body.title_en,
          instructions_ar: body.instructions_ar, instructions_en: body.instructions_en, weight: body.weight ?? 1, config: {},
        },
      });
      await tx.rubric_criteria.createMany({
        data: body.criteria.map((c, i) => ({
          task_id: task.id, org_id: orgId, code: `C${i + 1}`, description_ar: c.description_ar, description_en: c.description_en,
          max_score: c.max_score, weight: c.weight ?? 1, requirement_id: c.requirement_id ?? null,
        })),
      });
      if (body.requirement_ids?.length) {
        await tx.task_requirement_mappings.createMany({ data: body.requirement_ids.map((requirement_id) => ({ task_id: task.id, requirement_id, org_id: orgId })) });
      }
      return tx.assessment_tasks.findUniqueOrThrow({ where: { id: task.id }, include: { rubric_criteria: true, task_requirement_mappings: { select: { requirement_id: true } } } });
    });
  }

  @Delete('assessment-tasks/:taskId')
  @ApiOperation({ summary: 'Removes a task from a draft, with its rubric and links. The last task stays: a version needs at least one.' })
  removeTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { version_id: true, position: true } });
      if (!task) throw new NotFoundException();
      const remaining = await tx.assessment_tasks.count({ where: { version_id: task.version_id } });
      if (remaining <= 1) throw new UnprocessableEntityException('A version needs at least one task');
      await tx.assessment_tasks.delete({ where: { id: taskId } });
      // Keep positions continuous so candidates see 1, 2, 3.
      const later = await tx.assessment_tasks.findMany({ where: { version_id: task.version_id, position: { gt: task.position } }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
      for (const t of later) await tx.assessment_tasks.update({ where: { id: t.id }, data: { position: t.position - 1 } });
      return { removed: true };
    });
  }

  @Post('assessment-tasks/:taskId/criteria')
  addCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: NewCriterionDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { task_type: true, rubric_criteria: { select: { code: true } } } });
      if (!task) throw new NotFoundException();
      if (task.task_type === 'objective_questions') throw new UnprocessableEntityException('Objective questions are scored by their answer key');
      const next = Math.max(0, ...task.rubric_criteria.map((c) => Number(c.code.replace(/\D/g, '')) || 0)) + 1;
      return tx.rubric_criteria.create({
        data: { task_id: taskId, org_id: orgId, code: `C${next}`, description_ar: body.description_ar, description_en: body.description_en, max_score: body.max_score, weight: body.weight ?? 1, requirement_id: body.requirement_id ?? null },
      });
    });
  }

  @Delete('rubric-criteria/:criterionId')
  removeCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('criterionId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const criterion = await tx.rubric_criteria.findFirst({ where: { id, org_id: orgId }, select: { task_id: true } });
      if (!criterion) throw new NotFoundException();
      if ((await tx.rubric_criteria.count({ where: { task_id: criterion.task_id } })) <= 1) throw new UnprocessableEntityException('A task needs at least one criterion');
      await tx.rubric_criteria.delete({ where: { id } });
      return { removed: true };
    });
  }

  @Patch('assessment-tasks/:taskId')
  updateTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: UpdateTaskDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.assessment_tasks.updateMany({ where: { id: taskId, org_id: orgId }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.assessment_tasks.findUniqueOrThrow({ where: { id: taskId } });
    });
  }

  @Patch('rubric-criteria/:criterionId')
  updateCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('criterionId', ParseUUIDPipe) id: string, @Body() body: UpdateCriterionDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.rubric_criteria.updateMany({ where: { id, org_id: orgId }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.rubric_criteria.findUniqueOrThrow({ where: { id } });
    });
  }

  @Patch('assessment-versions/:versionId')
  @ApiOperation({ summary: 'What candidates are told, and the deadline and timer. Locked once published.' })
  updateVersion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string, @Body() body: VersionSettingsDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.assessment_versions.updateMany({ where: { id, org_id: orgId }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.assessment_versions.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post('assessment-versions/:versionId/publish')
  @ApiOperation({ summary: 'Human approval. Only an owner or admin can publish, and the version then becomes immutable.' })
  async publish(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    const version = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const { count } = await tx.assessment_versions.updateMany({ where: { id, org_id: orgId }, data: { status: 'published' } });
      if (count === 0) throw new NotFoundException();
      return tx.assessment_versions.findUniqueOrThrow({ where: { id } });
    });
    if (version.ai_thread_id) {
      await this.ai.resume('assessment-builder', version.ai_thread_id, { approved: true, by: user.id }).catch(() => undefined);
      await this.db.asUser(user, (tx) => tx.ai_workflow_runs.updateMany({ where: { thread_id: version.ai_thread_id as string }, data: { status: 'approved' } }));
    }
    return version;
  }
}
