import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class TargetDto {
  @ApiProperty() @IsString() @MaxLength(60) sector_code!: string;
  @ApiProperty() @IsString() @MaxLength(300) job_family_ar!: string;
}

class PlanItemDto {
  @ApiProperty() @IsUUID() reference_skill_id!: string;
  @ApiProperty() @IsIn(['skill_goal', 'project', 'course', 'certification']) kind!: 'skill_goal' | 'project' | 'course' | 'certification';
  @ApiPropertyOptional() @IsOptional() @IsUUID() resource_id?: string;
}

class PlanStatusDto {
  @ApiProperty() @IsIn(['not_started', 'in_progress', 'completed']) status!: 'not_started' | 'in_progress' | 'completed';
}

const SKILL_LIMIT = 40;

/** Public: the sector skills reference, for choosing skills and target roles. These are references, not vacancies or courses. */
@ApiTags('reference data')
@Controller('reference')
export class ReferenceController {
  constructor(private readonly db: DbService) {}

  @Get('skills')
  @ApiOperation({ summary: 'Searches skill names, tolerating Arabic spelling differences such as hamza forms and ta marbuta.' })
  skills(@Query('q') q?: string, @Query('sector') sector?: string, @Query('family') family?: string) {
    const text = q?.trim().slice(0, 100) ?? '';
    if (text.length < 2 && !family) return [];
    return this.db.asAnon((tx) => tx.$queryRaw`
      with needle as (select public.normalize_arabic(${text}) as value)
      select s.id, s.name_ar, s.description_ar, s.sector_code, s.skill_kind, s.is_priority,
        array(select distinct c.job_family_ar from public.reference_skill_contexts c where c.skill_id = s.id limit 2) as job_families
      from public.reference_skills s, needle
      where (needle.value = '' or (
          select bool_and(s.name_search like '%' || word || '%') from unnest(string_to_array(needle.value, ' ')) as word
        ))
        and (${sector ?? null}::text is null or s.sector_code = ${sector ?? null})
        and (${family ?? null}::text is null or ${family ?? null} = any(s.listed_job_families)
          or exists (select 1 from public.reference_skill_contexts c where c.skill_id = s.id and c.job_family_ar = ${family ?? null}))
      order by (s.name_search = needle.value) desc, (s.name_search like needle.value || '%') desc, s.is_priority desc nulls last, length(s.name_ar), s.name_ar
      limit 30`);
  }

  @Get('employers')
  @ApiOperation({ summary: 'The employer reference directory. An entry is an identity record: not a partner, an account or a source of vacancies.' })
  employers() {
    return this.db.asAnon((tx) =>
      tx.employer_registry.findMany({
        orderBy: { source_company_id: 'asc' },
        select: {
          id: true, name_ar: true, name_en: true, entity_type: true, sector: true, official_website: true, career_url: true, verification_status: true,
          employer_aliases: { select: { name_variant: true } },
        },
      }),
    );
  }

  @Get('job-families')
  families(@Query('sector') sector?: string) {
    return this.db.asAnon(async (tx) => {
      const rows = await tx.$queryRaw<{ sector_code: string; job_family_ar: string; skills: number }[]>`
        select s.sector_code, c.job_family_ar, count(distinct s.id)::int as skills
        from public.reference_skill_contexts c join public.reference_skills s on s.id = c.skill_id
        where s.skill_kind = 'technical' and (${sector ?? null}::text is null or s.sector_code = ${sector ?? null})
        group by 1, 2 order by 1, 2`;
      return rows;
    });
  }
}

@ApiTags('career')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me/career')
export class CareerController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({
    summary: 'Gaps against a chosen target role, kept apart from demonstrated needs. Independent of any application.',
    description: 'A gap means there is no evidence yet, which is not the same as a weakness. Only released assessment results count as demonstrated.',
  })
  career(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      const [target, listed, assessed, plan] = await Promise.all([
        tx.career_targets.findUnique({ where: { candidate_id: user.id } }),
        tx.candidate_reference_skills.findMany({ where: { candidate_id: user.id }, select: { reference_skill_id: true } }),
        tx.skill_scores.findMany({
          where: { evaluation_results: { released_to_candidate: true, assessment_attempts: { candidate_id: user.id } } },
          select: { level: true, skills: { select: { id: true, name_ar: true, name_en: true } } },
        }),
        tx.career_plan_items.findMany({
          where: { candidate_id: user.id },
          orderBy: { created_at: 'asc' },
          select: {
            id: true, kind: true, status: true, completed_at: true, updated_at: true,
            reference_skills: { select: { id: true, name_ar: true } },
            learning_resources: { select: { id: true, title_ar: true, title_en: true, provider: true, url: true, verified_on: true } },
          },
        }),
      ]);
      const selfReported = new Set(listed.map((s) => s.reference_skill_id));
      const skills = !target ? [] : await tx.reference_skills.findMany({
        where: {
          sector_code: target.sector_code, skill_kind: 'technical',
          OR: [{ reference_skill_contexts: { some: { job_family_ar: target.job_family_ar } } }, { listed_job_families: { has: target.job_family_ar } }],
        },
        orderBy: [{ is_priority: { sort: 'desc', nulls: 'last' } }, { name_ar: 'asc' }],
        take: SKILL_LIMIT,
        select: {
          id: true, name_ar: true, description_ar: true, is_priority: true, source_file: true, source_sheet: true,
          learning_resources: { select: { id: true, kind: true, title_ar: true, title_en: true, provider: true, url: true, verified_on: true } },
        },
      });
      return {
        target,
        role_skills: skills.map(({ learning_resources, ...skill }) => ({
          ...skill,
          evidence: selfReported.has(skill.id) ? 'self_reported' : 'no_evidence',
          resources: learning_resources,
        })),
        demonstrated_needs: assessed.filter((s) => s.level < 3).map((s) => ({ ...s.skills, level: s.level })),
        demonstrated_strengths: assessed.filter((s) => s.level >= 3).map((s) => ({ ...s.skills, level: s.level })),
        plan,
      };
    });
  }

  @Put('target')
  setTarget(@CurrentUser() user: AuthUser, @Body() body: TargetDto) {
    return this.db.asUser(user, async (tx) => {
      const exists = await tx.reference_skills.findFirst({
        where: { sector_code: body.sector_code, reference_skill_contexts: { some: { job_family_ar: body.job_family_ar } } },
        select: { id: true },
      });
      if (!exists) throw new UnprocessableEntityException('This role is not in the skills reference');
      return tx.career_targets.upsert({
        where: { candidate_id: user.id },
        create: { candidate_id: user.id, ...body },
        update: { ...body, updated_at: new Date() },
      });
    });
  }

  @Post('plan')
  addToPlan(@CurrentUser() user: AuthUser, @Body() body: PlanItemDto) {
    return this.db.asUser(user, async (tx) => {
      if (['course', 'certification'].includes(body.kind) && !body.resource_id) throw new UnprocessableEntityException('Choose a verified resource');
      const found = await tx.career_plan_items.findFirst({
        where: { candidate_id: user.id, reference_skill_id: body.reference_skill_id, kind: body.kind, resource_id: body.resource_id ?? null },
      });
      return found ?? tx.career_plan_items.create({ data: { candidate_id: user.id, reference_skill_id: body.reference_skill_id, kind: body.kind, resource_id: body.resource_id } });
    });
  }

  @Patch('plan/:id')
  @ApiOperation({ summary: 'Self-reported progress. It verifies neither a certificate nor a skill.' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: PlanStatusDto) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.career_plan_items.updateMany({
        where: { id, candidate_id: user.id },
        data: { status: body.status, completed_at: body.status === 'completed' ? new Date() : null },
      });
      if (count === 0) throw new NotFoundException();
      return tx.career_plan_items.findUniqueOrThrow({ where: { id } });
    });
  }

  @Delete('plan/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.career_plan_items.deleteMany({ where: { id, candidate_id: user.id } });
      if (count === 0) throw new NotFoundException();
      return { removed: true };
    });
  }
}
