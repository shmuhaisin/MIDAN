import { randomUUID } from 'node:crypto';
import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { COMPANY_TYPES, PROFESSIONAL_FIELDS } from '../common/fields';
import { loadForQuality, loadJobInput, QualityReport, qualitySummary } from './assessment-quality';

/** A guide is an object holding an assessor_guide object, and small enough to keep (200 kB). */
const HasAssessorGuide = () => ValidateBy({
  name: 'hasAssessorGuide',
  validator: {
    validate: (value: unknown) => typeof value === 'object' && value !== null
      && typeof (value as Record<string, unknown>).assessor_guide === 'object' && (value as Record<string, unknown>).assessor_guide !== null
      && JSON.stringify(value).length <= 200_000,
    defaultMessage: () => 'content must hold an assessor_guide object and be at most 200 kB',
  },
});
import { ChangeReasonDto, recordChangeReason } from '../common/change-reason';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService, Tx } from '../db/db.service';

class AssessmentFieldDto {
  @ApiPropertyOptional({ enum: PROFESSIONAL_FIELDS, nullable: true }) @IsOptional() @IsIn(PROFESSIONAL_FIELDS) professional_field?: string | null;
}

class GenerateDto {
  @ApiPropertyOptional({ description: 'Adds a version to this assessment.' }) @IsOptional() @IsUUID() assessment_id?: string;
  @ApiPropertyOptional({ enum: COMPANY_TYPES, description: "The company's type for this generation. Defaults to the organization's." })
  @IsOptional() @IsIn(COMPANY_TYPES) company_type?: string;
  @ApiPropertyOptional({ description: 'With title_en, starts another assessment for the job.' })
  @ValidateIf((o) => o.title_ar !== undefined || o.title_en !== undefined) @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => o.title_ar !== undefined || o.title_en !== undefined) @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
}

class GuideDto extends ChangeReasonDto {
  @ApiProperty({ example: 'MAS-1.0' }) @IsString() @Matches(/^MAS-\d+\.\d+$/) standard_version!: string;
  @ApiProperty({ description: 'The guide as MIDAN stores it: { job_family, secondary_families, assessor_guide, criteria_guidance }.' })
  @IsObject() @HasAssessorGuide() content!: Record<string, unknown>;
}

class UpdateAssessmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
}

class VersionSettingsDto extends ChangeReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) scenario_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) scenario_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2160) deadline_hours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_timed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() rubric_shared?: boolean;
}

class UpdateTaskDto extends ChangeReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) instructions_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() weight?: number;
}

class UpdateCriterionDto extends ChangeReasonDto {
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

class AddCriterionDto extends NewCriterionDto {
  @ApiPropertyOptional({ description: 'Why this change was made. Kept in the change history.' }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** A task an organization writes by hand. Open-answer types only: objective questions need an answer key built with them. */
class TaskOrderDto extends ChangeReasonDto {
  @ApiProperty({ type: [String], description: "Every task of the version, once each, in the new order." })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) task_ids!: string[];
}

class NewTaskDto extends ChangeReasonDto {
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

class QuestionOptionDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,40}$/) id!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) label_ar!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) label_en!: string;
}

class QuestionDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,40}$/) id!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) prompt_ar!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) prompt_en!: string;
  @ApiProperty({ type: [QuestionOptionDto] })
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options!: QuestionOptionDto[];
  @ApiProperty({ description: 'The id of the correct option. It stays in the rubric and never reaches candidates.' }) @IsString() answer!: string;
}

class UpdateQuestionsDto extends ChangeReasonDto {
  @ApiProperty({ type: [QuestionDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions!: QuestionDto[];
}

class ReviewChangesDto {
  @ApiPropertyOptional({ description: 'The id of the last change the reviewer saw, from GET …/changes (latest_change_id). Omit when there are none.' })
  @IsOptional() @IsInt() @Min(0) reviewed_through?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
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
/** Under the MIDAN Assessment Standard the builder also returns the version's candidate-facing fields and the assessor guide. */
type StandardVersionFields = {
  scenario_ar: string; scenario_en: string; instructions_ar: string; instructions_en: string;
  duration_minutes: number | null; deadline_hours: number; candidate_package: Prisma.InputJsonValue;
};
type Draft = {
  tasks: DraftTask[]; warnings: string[];
  version?: StandardVersionFields | null; guide?: ({ standard_version: string } & Record<string, unknown>) | null;
};

const ASSESSMENT_SUMMARY = {
  id: true, title_ar: true, title_en: true, professional_field: true,
  assessment_versions: { orderBy: { version_number: 'desc' }, select: { id: true, version_number: true, status: true } },
} satisfies Prisma.assessmentsSelect;

class RegenerateTaskDto {
  /** What the employer wants different, passed to the model as data. Optional. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

type RegeneratedTask = {
  task: {
    task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string; weight: number;
    config: { questions?: unknown[] }; skill_ids: string[]; requirement_ids: string[]; reference_skill_ids: string[];
    criteria: { code: string; description_ar: string; description_en: string; max_score: number; weight: number; answer_key: Record<string, string> | null; requirement_id: string | null; reference_skill_id: string | null }[];
  };
  provenance: { mode: string; provider?: string; model_version: string; prompt_version: string };
};

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
    const { job, target, existing } = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      // The job, its sector and level, and the company's type (the one chosen for this generation, or the organization's).
      const input = await loadJobInput(tx, orgId, jobId, body.company_type);
      if (!input) throw new NotFoundException();
      const assessment = body.assessment_id
        ? await tx.assessments.findFirst({ where: { id: body.assessment_id, org_id: orgId, job_id: jobId } })
        : body.title_ar ? null : await tx.assessments.findFirst({ where: { org_id: orgId, job_id: jobId }, orderBy: { created_at: 'asc' } });
      if (body.assessment_id && !assessment) throw new NotFoundException();
      return {
        job: input,
        target: assessment,
        existing: !assessment ? null : await tx.assessment_versions.findFirst({ where: { assessment_id: assessment.id }, orderBy: { version_number: 'desc' } }),
      };
    });
    if (existing && ['draft', 'in_review'].includes(existing.status)) throw new ConflictException('A draft already exists');

    const threadId = `builder-${randomUUID()}`;
    const result = await this.ai.run<Draft>('assessment-builder', { thread_id: threadId, job });
    if (result.status !== 'awaiting_human_review') throw new UnprocessableEntityException('The draft could not be generated');
    const { version: standardFields, guide } = result.payload;

    const created = await this.db.asUser(user, async (tx) => {
      // What follows is MIDAN's generated draft, not a person's edit: recorded as generation, and kept as the original.
      await tx.$queryRaw`select set_config('midan.assessment_change', 'generation', true)`;
      const assessment = target ?? await tx.assessments.create({
        data: { org_id: orgId, job_id: jobId, title_ar: body.title_ar ?? job.title_ar, title_en: body.title_en ?? job.title_en },
      });
      const version = await tx.assessment_versions.create({
        data: {
          assessment_id: assessment.id, org_id: orgId, version_number: (existing?.version_number ?? 0) + 1, ai_thread_id: threadId,
          // Under the standard, the brief's scenario, instructions, effort, window and structured package; otherwise as before.
          ...(standardFields
            ? {
              duration_minutes: standardFields.duration_minutes ?? 45, deadline_hours: standardFields.deadline_hours,
              scenario_ar: standardFields.scenario_ar, scenario_en: standardFields.scenario_en,
              instructions_ar: standardFields.instructions_ar, instructions_en: standardFields.instructions_en,
              candidate_package: standardFields.candidate_package,
            }
            : {
              duration_minutes: 45,
              instructions_ar: 'أكمل المهام بأسلوبك. قيّم هذا العمل بنفسك دون مساعدة خارجية، واحفظ إجاباتك أولًا بأول.',
              instructions_en: 'Complete the tasks in your own way. Do the work yourself, without outside help. Your answers save as you go.',
            }),
        },
      });
      if (guide) {
        // The assessor guide goes to its own table, which only the organization's staff can read.
        await tx.$executeRaw`insert into public.assessment_assessor_guides (version_id, org_id, standard_version, content)
          values (${version.id}::uuid, ${orgId}::uuid, ${guide.standard_version}, ${JSON.stringify(guide)}::jsonb)`;
      }
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
      await tx.$queryRaw`select set_config('midan.assessment_change', '', true)`;
      await tx.$queryRaw`select id from public.record_generated_draft(${version.id}::uuid)`;
      return { version_id: version.id, assessment_id: assessment.id, warnings: result.payload.warnings, mode: result.provenance.mode };
    });
    // MIDAN's check of the draft as stored. If it can't run now, the draft stays, and approval asks for the check first.
    const quality = await this.checkQuality(user, orgId, created.version_id).then(qualitySummary).catch(() => null);
    return { ...created, standardized: Boolean(guide), quality };
  }

  /**
   * Runs the MIDAN Assessment Standard's check on a version as it is stored now, and records the report through MIDAN's
   * service role (an organization cannot write a report). The report holds the digest of the content it judged, so a later
   * change makes it stale.
   */
  private async checkQuality(user: AuthUser, orgId: string, versionId: string): Promise<QualityReport> {
    const loaded = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...BUILDERS]);
      return loadForQuality(tx, orgId, versionId);
    });
    if (!loaded || !loaded.job) throw new NotFoundException();
    if (!['draft', 'in_review'].includes(loaded.status)) throw new UnprocessableEntityException('Only a draft is checked; an approved version cannot be changed');
    const report = await this.ai.evaluateQuality<QualityReport>({ job: loaded.job, stored: loaded.stored });
    await this.db.asWorker((tx) => tx.$queryRaw`
      select private.record_quality_report(${versionId}::uuid, ${loaded.digest}, ${JSON.stringify(report)}::jsonb)`);
    return report;
  }

  @Get('assessment-versions/:versionId/guide')
  @ApiOperation({ summary: "The version's assessor guide and its latest quality report. Organization staff only; never shown to a candidate." })
  guideFor(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter', 'reviewer']);
      const found = await tx.assessment_versions.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
      const [guide] = await tx.$queryRaw<unknown[]>`
        select standard_version, content, updated_at from public.assessment_assessor_guides where version_id = ${id}::uuid`;
      return { guide: guide ?? null, quality: await this.latestReport(tx, id) };
    });
  }

  @Put('assessment-versions/:versionId/guide')
  @ApiOperation({
    summary: "Writes the version's assessor guide (draft only). Recorded and reviewed like any other change. A version with a guide is under the MIDAN Assessment Standard: approval then needs a current, ready quality report.",
  })
  saveGuide(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string, @Body() body: GuideDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.assessment_versions.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
      await recordChangeReason(tx, body.reason);
      const content = JSON.stringify(body.content);
      await tx.$executeRaw`
        insert into public.assessment_assessor_guides (version_id, org_id, standard_version, content)
        values (${id}::uuid, ${orgId}::uuid, ${body.standard_version}, ${content}::jsonb)
        on conflict (version_id) do update set standard_version = excluded.standard_version, content = excluded.content`;
      return { saved: true };
    });
  }

  @Post('assessment-versions/:versionId/quality')
  @ApiOperation({ summary: "Checks the draft against the MIDAN Assessment Standard as it is now, records the report, and returns it." })
  quality(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    return this.checkQuality(user, orgId, id);
  }

  @Get('assessment-versions/:versionId/quality')
  @ApiOperation({ summary: 'The latest quality report, and whether it is still current (the version has not changed since).' })
  latestQuality(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter', 'reviewer']);
      const found = await tx.assessment_versions.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
      return this.latestReport(tx, id);
    });
  }

  private async latestReport(tx: Tx, versionId: string) {
    const [latest] = await tx.$queryRaw<{ verdict: string; overall_score: number; standardized: boolean; created_at: Date; current: boolean; report: unknown }[]>`
      select q.verdict, q.overall_score, q.standardized, q.created_at, q.report,
        q.content_digest = public.assessment_content_digest(q.version_id) as current
      from public.assessment_quality_reports q where q.version_id = ${versionId}::uuid order by q.id desc limit 1`;
    return latest ?? null;
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
      await recordChangeReason(tx, body.reason);
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
  @ApiOperation({ summary: 'Removes a task from a draft, with its rubric and links. The last task stays: a version needs at least one. The change history keeps what was removed.' })
  removeTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Query() query: ChangeReasonDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { version_id: true, position: true } });
      if (!task) throw new NotFoundException();
      const remaining = await tx.assessment_tasks.count({ where: { version_id: task.version_id } });
      if (remaining <= 1) throw new UnprocessableEntityException('A version needs at least one task');
      await recordChangeReason(tx, query.reason);
      await tx.assessment_tasks.delete({ where: { id: taskId } });
      // Keep positions continuous so candidates see 1, 2, 3. Recorded too, with the cause.
      await recordChangeReason(tx, 'Renumbered after a task was removed');
      const later = await tx.assessment_tasks.findMany({ where: { version_id: task.version_id, position: { gt: task.position } }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
      for (const t of later) await tx.assessment_tasks.update({ where: { id: t.id }, data: { position: t.position - 1 } });
      return { removed: true };
    });
  }

  @Put('assessment-versions/:versionId/task-order')
  @ApiOperation({
    summary: 'Reorders the tasks of a draft. The body lists every task once, in the new order; task ids, rubrics and links stay as they are. A published version refuses it.',
  })
  reorderTasks(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() body: TaskOrderDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const version = await tx.assessment_versions.findFirst({ where: { id: versionId, org_id: orgId }, select: { assessment_tasks: { select: { id: true, position: true } } } });
      if (!version) throw new NotFoundException();
      const current = new Map(version.assessment_tasks.map((t) => [t.id, t.position]));
      const order = body.task_ids;
      if (order.length !== current.size || new Set(order).size !== order.length || order.some((id) => !current.has(id))) {
        throw new UnprocessableEntityException('The new order must list every task of this version exactly once');
      }
      const moves = order.map((id, i) => ({ id, position: i + 1 })).filter((m) => current.get(m.id) !== m.position);
      if (moves.length > 0) {
        await recordChangeReason(tx, body.reason?.trim() || 'Tasks reordered');
        // Positions are unique per version. Checking that at commit lets each task move once, straight to its new place,
        // so the change history records only real moves (supabase/migrations/20261110120000_assessment_task_order.sql).
        await tx.$executeRaw`set constraints public.assessment_tasks_version_position_key deferred`;
        for (const m of moves) await tx.assessment_tasks.update({ where: { id: m.id }, data: { position: m.position } });
      }
      return tx.assessment_tasks.findMany({ where: { version_id: versionId }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
    });
  }

  @Post('assessment-tasks/:taskId/criteria')
  addCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: AddCriterionDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { task_type: true, rubric_criteria: { select: { code: true } } } });
      if (!task) throw new NotFoundException();
      if (task.task_type === 'objective_questions') throw new UnprocessableEntityException('Objective questions are scored by their answer key');
      await recordChangeReason(tx, body.reason);
      const next = Math.max(0, ...task.rubric_criteria.map((c) => Number(c.code.replace(/\D/g, '')) || 0)) + 1;
      return tx.rubric_criteria.create({
        data: { task_id: taskId, org_id: orgId, code: `C${next}`, description_ar: body.description_ar, description_en: body.description_en, max_score: body.max_score, weight: body.weight ?? 1, requirement_id: body.requirement_id ?? null },
      });
    });
  }

  @Delete('rubric-criteria/:criterionId')
  removeCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('criterionId', ParseUUIDPipe) id: string, @Query() query: ChangeReasonDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const criterion = await tx.rubric_criteria.findFirst({ where: { id, org_id: orgId }, select: { task_id: true } });
      if (!criterion) throw new NotFoundException();
      if ((await tx.rubric_criteria.count({ where: { task_id: criterion.task_id } })) <= 1) throw new UnprocessableEntityException('A task needs at least one criterion');
      await recordChangeReason(tx, query.reason);
      await tx.rubric_criteria.delete({ where: { id } });
      return { removed: true };
    });
  }

  @Patch('assessment-tasks/:taskId')
  updateTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: UpdateTaskDto) {
    const { reason, ...data } = body;
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      await recordChangeReason(tx, reason);
      const { count } = await tx.assessment_tasks.updateMany({ where: { id: taskId, org_id: orgId }, data });
      if (count === 0) throw new NotFoundException();
      return tx.assessment_tasks.findUniqueOrThrow({ where: { id: taskId } });
    });
  }

  @Post('assessment-tasks/:taskId/regenerate')
  @ApiOperation({ summary: "Writes one task of a draft again with the live AI model, keeping its type and place. Recorded as a change to review before approval; needs the model (503 without it). A published version refuses it." })
  async regenerateTask(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: RegenerateTaskDto) {
    const loaded = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({
        where: { id: taskId, org_id: orgId },
        include: {
          rubric_criteria: { orderBy: { code: 'asc' } },
          task_requirement_mappings: { select: { requirement_id: true } },
          task_skill_mappings: { select: { skill_id: true } },
          assessment_versions: { select: { status: true, assessment_tasks: { where: { id: { not: taskId } }, select: { title_en: true }, orderBy: { position: 'asc' } }, assessments: { select: { job_id: true } } } },
        },
      });
      if (!task) throw new NotFoundException();
      if (!['draft', 'in_review'].includes(task.assessment_versions.status)) throw new UnprocessableEntityException('Only a draft can change; an approved version cannot');
      const job = await loadJobInput(tx, orgId, task.assessment_versions.assessments.job_id);
      if (!job) throw new NotFoundException();
      return { task, job };
    });
    const { task, job } = loaded;
    const result = await this.ai.regenerateTask<RegeneratedTask>({
      job,
      task: {
        task_type: task.task_type, title_ar: task.title_ar, title_en: task.title_en, instructions_ar: task.instructions_ar, instructions_en: task.instructions_en,
        weight: Number(task.weight), requirement_ids: task.task_requirement_mappings.map((m) => m.requirement_id),
        skill_ids: task.task_skill_mappings.map((m) => m.skill_id), reference_skill_ids: task.reference_skill_ids,
        criteria: task.task_type === 'objective_questions' ? [] : task.rubric_criteria.map((c) => ({ description_ar: c.description_ar, description_en: c.description_en, max_score: Number(c.max_score), weight: Number(c.weight) })),
      },
      other_titles: task.assessment_versions.assessment_tasks.map((t) => t.title_en),
      ...(body.note && { note: body.note }),
    });
    const next = result.task;
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      // A person asked for it and reviews it: recorded as their change, saying where the text came from.
      await recordChangeReason(tx, `Regenerated with AI (${result.provenance.provider ?? 'model'} ${result.provenance.model_version})${body.note ? `: ${body.note}` : ''}`.slice(0, 1000));
      const config = task.task_type === 'objective_questions'
        ? { ...(task.config as Prisma.JsonObject), questions: JSON.parse(JSON.stringify(next.config.questions ?? [])) }
        : (task.config as Prisma.JsonObject);
      const { count } = await tx.assessment_tasks.updateMany({
        where: { id: taskId, org_id: orgId },
        data: { title_ar: next.title_ar, title_en: next.title_en, instructions_ar: next.instructions_ar, instructions_en: next.instructions_en, weight: next.weight, config, reference_skill_ids: next.reference_skill_ids },
      });
      if (count === 0) throw new NotFoundException();
      await tx.rubric_criteria.deleteMany({ where: { task_id: taskId } });
      await tx.rubric_criteria.createMany({
        data: next.criteria.map((c) => ({
          task_id: taskId, org_id: orgId, code: c.code, description_ar: c.description_ar, description_en: c.description_en, max_score: c.max_score,
          weight: c.weight, answer_key: c.answer_key ?? Prisma.DbNull, requirement_id: c.requirement_id ?? null, reference_skill_id: c.reference_skill_id ?? null,
        })),
      });
      await tx.task_requirement_mappings.deleteMany({ where: { task_id: taskId } });
      if (next.requirement_ids.length) await tx.task_requirement_mappings.createMany({ data: next.requirement_ids.map((requirement_id) => ({ task_id: taskId, requirement_id, org_id: orgId })) });
      await tx.task_skill_mappings.deleteMany({ where: { task_id: taskId } });
      if (next.skill_ids.length) await tx.task_skill_mappings.createMany({ data: [...new Set(next.skill_ids)].map((skill_id) => ({ task_id: taskId, skill_id, org_id: orgId })) });
      const saved = await tx.assessment_tasks.findUniqueOrThrow({ where: { id: taskId }, include: { rubric_criteria: true } });
      return { task: saved, provenance: result.provenance };
    });
  }

  @Patch('assessment-tasks/:taskId/questions')
  @ApiOperation({ summary: "A draft's objective questions and their answer key, reviewed and edited before approval. A published version refuses it." })
  updateQuestions(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: UpdateQuestionsDto) {
    for (const q of body.questions) {
      const options = q.options.map((o) => o.id);
      if (new Set(options).size !== options.length) throw new UnprocessableEntityException('Each option needs its own id');
      if (!options.includes(q.answer)) throw new UnprocessableEntityException('The answer must be one of the options');
    }
    if (new Set(body.questions.map((q) => q.id)).size !== body.questions.length) throw new UnprocessableEntityException('Each question needs its own id');
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { task_type: true, config: true, rubric_criteria: { select: { id: true } } } });
      if (!task) throw new NotFoundException();
      if (task.task_type !== 'objective_questions') throw new UnprocessableEntityException('Only objective questions have an answer key');
      await recordChangeReason(tx, body.reason);
      const questions = body.questions.map(({ answer: _answer, ...question }) => question);
      const key = Object.fromEntries(body.questions.map((q) => [q.id, q.answer]));
      await tx.assessment_tasks.update({ where: { id: taskId }, data: { config: { ...(task.config as Prisma.JsonObject), questions: JSON.parse(JSON.stringify(questions)) } } });
      await tx.rubric_criteria.update({ where: { id: task.rubric_criteria[0].id }, data: { answer_key: key, max_score: body.questions.length } });
      return tx.assessment_tasks.findUniqueOrThrow({ where: { id: taskId }, include: { rubric_criteria: true } });
    });
  }

  @Patch('rubric-criteria/:criterionId')
  updateCriterion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('criterionId', ParseUUIDPipe) id: string, @Body() body: UpdateCriterionDto) {
    const { reason, ...data } = body;
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      await recordChangeReason(tx, reason);
      const { count } = await tx.rubric_criteria.updateMany({ where: { id, org_id: orgId }, data });
      if (count === 0) throw new NotFoundException();
      return tx.rubric_criteria.findUniqueOrThrow({ where: { id } });
    });
  }

  @Patch('assessment-versions/:versionId')
  @ApiOperation({ summary: 'What candidates are told, and the deadline and timer. Locked once published.' })
  updateVersion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string, @Body() body: VersionSettingsDto) {
    const { reason, ...data } = body;
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      await recordChangeReason(tx, reason);
      const { count } = await tx.assessment_versions.updateMany({ where: { id, org_id: orgId }, data });
      if (count === 0) throw new NotFoundException();
      return tx.assessment_versions.findUniqueOrThrow({ where: { id } });
    });
  }

  @Get('assessment-versions/:versionId/changes')
  @ApiOperation({
    summary: "Everything the review before approval needs: MIDAN's original, the draft now, every change with its before and after, earlier reviews and MIDAN's validation.",
  })
  async changes(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    const [row] = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      return tx.$queryRaw<{ state: unknown }[]>`
        select public.assessment_review_state(v.id) as state from public.assessment_versions v where v.id = ${id}::uuid and v.org_id = ${orgId}::uuid`;
    });
    if (!row) throw new NotFoundException();
    return row.state;
  }

  @Post('assessment-versions/:versionId/review')
  @ApiOperation({
    summary: 'An owner or admin records that they reviewed every change up to reviewed_through, with the validation as it stood. Refused if the draft changed since.',
  })
  review(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string, @Body() body: ReviewChangesDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      return this.recordReview(tx, orgId, id, body);
    });
  }

  @Post('assessment-versions/:versionId/revise')
  @ApiOperation({
    summary: 'Starts a new draft version from an approved one, to change an assessment candidates already take. The approved version and its attempts never change.',
  })
  async revise(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string) {
    const [version] = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.assessment_versions.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
      return tx.$queryRaw<{ id: string; version_number: number; assessment_id: string }[]>`
        select id, version_number, assessment_id from public.create_assessment_revision(${id}::uuid)`;
    });
    return version;
  }

  private async recordReview(tx: Tx, orgId: string, versionId: string, body: ReviewChangesDto) {
    const found = await tx.assessment_versions.findFirst({ where: { id: versionId, org_id: orgId }, select: { id: true } });
    if (!found) throw new NotFoundException();
    const [review] = await tx.$queryRaw<unknown[]>`
      select * from public.review_assessment_changes(${versionId}::uuid, ${body.reviewed_through ?? 0}::bigint, ${body.note ?? null}::text)`;
    return review;
  }

  @Post('assessment-versions/:versionId/publish')
  @ApiOperation({
    summary: 'Human approval. Only an owner or admin can publish, and the version then becomes immutable.',
    description: "Every change people made to MIDAN's draft must be reviewed first. Pass reviewed_through (and a note) to review and approve in one step; "
      + 'without it, a draft with unreviewed changes gets 422. MIDAN validation errors also give 422; its warnings are shown in the review and do not block.',
  })
  async publish(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('versionId', ParseUUIDPipe) id: string, @Body() body: ReviewChangesDto) {
    // Under the MIDAN Assessment Standard, check the version as it is now; the database refuses approval without a current, ready report.
    const [{ under }] = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const found = await tx.assessment_versions.findFirst({ where: { id, org_id: orgId }, select: { assessment_id: true } });
      if (!found) throw new NotFoundException();
      return tx.$queryRaw<{ under: boolean }[]>`
        select exists (select 1 from public.assessment_assessor_guides g join public.assessment_versions v on v.id = g.version_id
          where v.assessment_id = ${found.assessment_id}::uuid) as under`;
    });
    if (under) {
      const report = await this.checkQuality(user, orgId, id);
      if (report.verdict !== 'ready') {
        throw new UnprocessableEntityException({ message: 'This version does not meet the MIDAN Assessment Standard yet', quality: qualitySummary(report) });
      }
    }
    const version = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      if (body.reviewed_through !== undefined) await this.recordReview(tx, orgId, id, body);
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
