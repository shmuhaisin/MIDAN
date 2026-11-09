import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class LinkSkillDto {
  @ApiPropertyOptional() @IsUUID() reference_skill_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_required?: boolean;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 4 }) @IsOptional() @ValidateIf((o) => o.required_level !== null) @IsInt() @Min(0) @Max(4) required_level?: number | null;
}

class UpdateLinkDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_required?: boolean;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 4 }) @IsOptional() @ValidateIf((o) => o.required_level !== null) @IsInt() @Min(0) @Max(4) required_level?: number | null;
}

class CustomSkillDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_required?: boolean;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 4 }) @IsOptional() @ValidateIf((o) => o.required_level !== null) @IsInt() @Min(0) @Max(4) required_level?: number | null;
}

type Suggested = {
  method: 'ai_suggestions_v1' | 'semantic_similarity_v1';
  suggestions: { reference_skill_id: string; score: number; reason_en: string | null; reason_ar: string | null; required: boolean; level: number | null }[];
  provenance: Record<string, unknown>;
};

/**
 * A job's skills, decided by the employer: suggestions that read the job's meaning (reviewed through the job analysis
 * accept/dismiss flow), workbook skills found by search, levels and required/preferred on each, and the employer's own
 * skills for this job. The accepted list is what matching and assessment generation read.
 */
@ApiTags('job skills')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId')
export class JobSkillsController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Post('jobs/:jobId/analyses/suggest')
  @ApiOperation({
    summary: "Suggests workbook skills for this job from its own title, description and requirements.",
    description: "Ranks the job's sector catalog by meaning; the live model then chooses from that shortlist with reasons and levels. Without the model, the shortlist is returned labelled as such. Recorded as a job analysis to accept or dismiss; nothing changes until then.",
  })
  async suggest(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    const { job, catalog } = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const job = await tx.jobs.findFirst({
        where: { id: jobId, org_id: orgId },
        select: {
          title_ar: true, title_en: true, description_ar: true, description_en: true, experience_level: true, sector: true,
          job_requirements: { where: { retired_at: null, review_status: 'approved' }, select: { description_ar: true, description_en: true } },
        },
      });
      if (!job) throw new NotFoundException();
      // One sector's workbook when the job has one; the whole catalog otherwise (slower the first time).
      const sector = job.sector && job.sector !== 'other' ? job.sector : undefined;
      const catalog = await tx.reference_skills.findMany({
        where: sector ? { sector_code: sector } : {},
        select: { id: true, name_ar: true, description_ar: true, is_priority: true },
      });
      return { job, catalog };
    });
    const result = await this.ai.suggestSkills<Suggested>({
      job: {
        title_ar: job.title_ar, title_en: job.title_en, description_ar: job.description_ar, description_en: job.description_en,
        experience_level: job.experience_level, sector: job.sector,
        requirements: job.job_requirements.map((r) => [r.description_ar, r.description_en].filter(Boolean).join(' / ')).filter(Boolean),
      },
      catalog: catalog.map((c) => ({ id: c.id, name_ar: c.name_ar, description_ar: c.description_ar?.slice(0, 1200) ?? null, is_priority: c.is_priority })),
    });
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<Record<string, unknown>[]>`
        select * from public.record_skill_suggestions(${jobId}::uuid, ${result.method}, ${job.sector}, ${JSON.stringify(result.suggestions)}::jsonb)`;
      return { ...row, provenance: result.provenance };
    });
  }

  @Get('reference-skills')
  @ApiOperation({ summary: 'Searches the sector skills workbooks by name (Arabic, spelling-tolerant).' })
  search(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query('q') q = '', @Query('sector') sector?: string) {
    const term = q.trim().slice(0, 100);
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      if (term.length < 2) return [];
      return tx.$queryRaw<unknown[]>`
        select id, name_ar, sector_code, skill_kind, is_priority, left(description_ar, 240) as description_ar
        from public.reference_skills
        where (name_search like '%' || public.normalize_arabic(${term}) || '%' or name_ar ilike '%' || ${term} || '%')
          and (${sector ?? null}::text is null or sector_code = ${sector ?? null}::text)
        order by is_priority desc nulls last, length(name_ar)
        limit 20`;
    });
  }

  @Post('jobs/:jobId/reference-skills')
  @ApiOperation({ summary: 'Adds a workbook skill to the job, with required/preferred and a level.' })
  link(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() body: LinkSkillDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const job = await tx.jobs.findFirst({ where: { id: jobId, org_id: orgId }, select: { id: true } });
      if (!job) throw new NotFoundException();
      return tx.job_reference_skills.upsert({
        where: { job_id_reference_skill_id: { job_id: jobId, reference_skill_id: body.reference_skill_id } },
        create: { job_id: jobId, org_id: orgId, reference_skill_id: body.reference_skill_id, is_required: body.is_required ?? false, required_level: body.required_level ?? null },
        update: { ...(body.is_required !== undefined && { is_required: body.is_required }), ...(body.required_level !== undefined && { required_level: body.required_level }) },
      });
    });
  }

  @Patch('jobs/:jobId/reference-skills/:skillId')
  updateLink(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string, @Body() body: UpdateLinkDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.job_reference_skills.updateMany({
        where: { job_id: jobId, org_id: orgId, reference_skill_id: skillId },
        data: { ...(body.is_required !== undefined && { is_required: body.is_required }), ...(body.required_level !== undefined && { required_level: body.required_level }) },
      });
      if (count === 0) throw new NotFoundException();
      return { updated: true };
    });
  }

  @Delete('jobs/:jobId/reference-skills/:skillId')
  unlink(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Param('skillId', ParseUUIDPipe) skillId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.job_reference_skills.deleteMany({ where: { job_id: jobId, org_id: orgId, reference_skill_id: skillId } });
      if (count === 0) throw new NotFoundException();
      return { removed: true };
    });
  }

  @Get('jobs/:jobId/custom-skills')
  customSkills(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return tx.job_custom_skills.findMany({ where: { job_id: jobId, org_id: orgId }, orderBy: { created_at: 'asc' } });
    });
  }

  @Post('jobs/:jobId/custom-skills')
  @ApiOperation({ summary: "Adds the employer's own skill to this job only. It never becomes a shared catalog skill." })
  addCustom(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() body: CustomSkillDto) {
    if (!body.name_ar?.trim() && !body.name_en?.trim()) throw new BadRequestException('A name in Arabic or English is required');
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const job = await tx.jobs.findFirst({ where: { id: jobId, org_id: orgId }, select: { id: true } });
      if (!job) throw new NotFoundException();
      return tx.job_custom_skills.create({
        data: {
          job_id: jobId, org_id: orgId, name_ar: body.name_ar?.trim() || null, name_en: body.name_en?.trim() || null,
          description: body.description?.trim() || null, is_required: body.is_required ?? false, required_level: body.required_level ?? null, created_by: user.id,
        },
      });
    });
  }

  @Patch('jobs/:jobId/custom-skills/:id')
  updateCustom(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomSkillDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.job_custom_skills.updateMany({
        where: { id, job_id: jobId, org_id: orgId },
        data: {
          ...(body.name_ar !== undefined && { name_ar: body.name_ar.trim() || null }), ...(body.name_en !== undefined && { name_en: body.name_en.trim() || null }),
          ...(body.description !== undefined && { description: body.description.trim() || null }),
          ...(body.is_required !== undefined && { is_required: body.is_required }), ...(body.required_level !== undefined && { required_level: body.required_level }),
        },
      });
      if (count === 0) throw new NotFoundException();
      return tx.job_custom_skills.findUniqueOrThrow({ where: { id } });
    });
  }

  @Delete('jobs/:jobId/custom-skills/:id')
  removeCustom(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.job_custom_skills.deleteMany({ where: { id, job_id: jobId, org_id: orgId } });
      if (count === 0) throw new NotFoundException();
      return { removed: true };
    });
  }
}
