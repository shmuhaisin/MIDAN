import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { listableJobs } from '../common/test-data';
import { PracticeKind, practiceChecklist, practiceTask } from './practice';
import { Prisma } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class TargetDto {
  @ApiPropertyOptional({ description: "The candidate's own words. Stored and shown as written." })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) job_title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) sector_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) job_family_ar?: string;
}

type TitleSkill = { id: string; name_ar: string; name_en: string | null; source: 'skill' | 'reference'; jobs: number };

class PlanItemDto {
  @ApiProperty() @IsUUID() reference_skill_id!: string;
  @ApiProperty() @IsIn(['skill_goal', 'project', 'course', 'certification']) kind!: 'skill_goal' | 'project' | 'course' | 'certification';
  @ApiPropertyOptional() @IsOptional() @IsUUID() resource_id?: string;
}

class PracticeDto {
  @ApiProperty() @IsUUID() reference_skill_id!: string;
  @ApiProperty({ enum: ['simulated_task', 'portfolio_project'] }) @IsIn(['simulated_task', 'portfolio_project']) kind!: PracticeKind;
}

class PracticeUpdateDto {
  @ApiPropertyOptional({ enum: ['start', 'save', 'submit', 'complete'] }) @IsIn(['start', 'save', 'submit', 'complete']) action!: 'start' | 'save' | 'submit' | 'complete';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) submission?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) @Matches(/^https:\/\//) submission_url?: string;
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
  @ApiOperation({
    summary: 'The official employer registry, with search by official name, alias or company ID.',
    description: 'An entry is an identity record: not a partner, an account or a source of vacancies. With q, each result says whether it matched an official name, an alias (with the status the source gives the alias) or the company ID.',
  })
  async employers(@Query('q') q?: string) {
    const text = q?.trim().slice(0, 100) ?? '';
    return this.db.asAnon(async (tx) => {
      const hits = text ? await tx.$queryRaw<{ registry_id: string; matched_by: string; matched_text: string; alias_status: string | null; exact: boolean }[]>`
        select * from public.search_employers(${text})` : null;
      const rows = await tx.employer_registry.findMany({
        where: hits ? { id: { in: hits.map((h) => h.registry_id) } } : undefined,
        orderBy: { source_company_id: 'asc' },
        select: {
          id: true, source_company_id: true, name_ar: true, name_en: true, entity_type: true, sector: true, official_website: true, career_url: true,
          verification_status: true, partnership_status: true,
          employer_aliases: { select: { name_variant: true, language: true, alias_status: true }, orderBy: { name_variant: 'asc' } },
        },
      });
      const counts = await tx.$queryRaw<{ registry_id: string; n: number }[]>`
        select e.id as registry_id, (select count(*)::int from public.employer_jobs(e.id)) as n from public.employer_registry e`;
      const open = new Map(counts.map((c) => [c.registry_id, c.n]));
      const why = new Map((hits ?? []).map((h) => [h.registry_id, h]));
      const withJobs = rows.map((r) => ({ ...r, open_jobs: open.get(r.id) ?? 0, match: why.get(r.id) ?? null }));
      // Exact matches first, then official names before aliases.
      return hits ? withJobs.sort((a, b) => Number(b.match!.exact) - Number(a.match!.exact) || Number(b.match!.matched_by === 'official_name') - Number(a.match!.matched_by === 'official_name')) : withJobs;
    });
  }

  @Get('employers/:id')
  @ApiOperation({
    summary: "One employer's profile, as the official registry states it.",
    description: 'Identity, verification and partnership as the source states them, aliases kept apart from official names, sources with the date they were checked, where each value came from, and the opportunities connected to the employer. Brand assets are returned only when the source establishes permission to use them.',
  })
  employer(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.asAnon(async (tx) => {
      const e = await tx.employer_registry.findUnique({
        where: { id },
        include: {
          employer_aliases: { select: { name_variant: true, language: true, alias_status: true, source_row: true, added_by: true }, orderBy: { name_variant: 'asc' } },
          employer_sources: { select: { source_url: true, source_type: true, checked_on: true, source_row: true }, orderBy: { source_url: 'asc' } },
        },
      });
      if (!e) throw new NotFoundException();
      const jobs = await tx.$queryRaw`select * from public.employer_jobs(${id}::uuid)`;
      const usable = e.usage_permission === 'permission_verified' && e.identity_status === 'verified';
      return {
        id: e.id, source_company_id: e.source_company_id, name_ar: e.name_ar, name_en: e.name_en, entity_type: e.entity_type, sector: e.sector,
        official_website: e.official_website, career_url: e.career_url, verification_status: e.verification_status, verification_source: e.verification_source,
        partnership_status: e.partnership_status, notes: e.notes,
        brand: {
          usable, identity_status: e.identity_status, usage_permission: e.usage_permission, notes: e.brand_notes,
          // Logos, colors and fonts only with established permission. Otherwise screens use Midan's neutral identity.
          ...(usable && { logo_asset_url: e.brand_logo_asset_url, primary_hex: e.brand_primary_hex, secondary_hex: e.brand_secondary_hex, official_font: e.brand_official_font }),
        },
        aliases: e.employer_aliases.map(({ added_by, ...a }) => ({ ...a, added_by_admin: Boolean(added_by) })),
        sources: e.employer_sources,
        lineage: {
          source_file: e.source_file, source_sheet: e.source_sheet, source_row: e.source_row, brand_source_row: e.brand_source_row,
          imported_at: e.updated_at ?? e.created_at,
        },
        jobs,
      };
    });
  }

  @Get('job-titles')
  @ApiOperation({
    summary: 'What a typed job title can be linked to: workbook job families and published job titles that contain it.',
    description: 'Suggestions only. Nothing here is an official title list: the workbooks name families, and job titles are what organizations wrote.',
  })
  titles(@Query('q') q?: string) {
    const text = (q ?? '').trim().slice(0, 120);
    if (text.length < 2) return { families: [], jobs: [] };
    return this.db.asAnon(async (tx) => {
      const families = await tx.$queryRaw<{ sector_code: string; job_family_ar: string }[]>`
        select distinct s.sector_code, c.job_family_ar from public.reference_skill_contexts c join public.reference_skills s on s.id = c.skill_id
        where public.normalize_arabic(c.job_family_ar) like '%' || public.normalize_arabic(${text}) || '%' order by 2 limit 10`;
      const jobs = await tx.jobs.findMany({
        where: { ...listableJobs(), OR: [{ title_ar: { contains: text, mode: 'insensitive' } }, { title_en: { contains: text, mode: 'insensitive' } }] },
        select: { title_ar: true, title_en: true }, take: 50,
      });
      const counted = new Map<string, { title_ar: string; title_en: string; jobs: number }>();
      for (const j of jobs) {
        const key = `${j.title_ar}|${j.title_en}`;
        counted.set(key, { title_ar: j.title_ar, title_en: j.title_en, jobs: (counted.get(key)?.jobs ?? 0) + 1 });
      }
      return { families, jobs: [...counted.values()].slice(0, 10) };
    });
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
      const skills = !target?.job_family_ar ? [] : await tx.reference_skills.findMany({
        where: {
          sector_code: target.sector_code!, skill_kind: 'technical',
          OR: [{ reference_skill_contexts: { some: { job_family_ar: target.job_family_ar } } }, { listed_job_families: { has: target.job_family_ar } }],
        },
        orderBy: [{ is_priority: { sort: 'desc', nulls: 'last' } }, { name_ar: 'asc' }],
        take: SKILL_LIMIT,
        select: {
          id: true, name_ar: true, description_ar: true, is_priority: true, source_file: true, source_sheet: true,
          learning_resources: { select: { id: true, kind: true, title_ar: true, title_en: true, provider: true, url: true, verified_on: true } },
        },
      });
      // What published MIDAN jobs with a similar title ask for. Organizations' own requirements, counted, not invented.
      const titled = !target?.job_title ? [] : await tx.jobs.findMany({
        where: { ...listableJobs(user.email), OR: [{ title_ar: { contains: target.job_title, mode: 'insensitive' } }, { title_en: { contains: target.job_title, mode: 'insensitive' } }] },
        take: 50,
        select: {
          job_skills: { where: { is_required: true, review_status: 'approved' }, select: { skills: { select: { id: true, name_ar: true, name_en: true } } } },
          job_reference_skills: { where: { is_required: true }, select: { reference_skills: { select: { id: true, name_ar: true } } } },
        },
      });
      const titleSkills = new Map<string, TitleSkill>();
      const count = (s: Omit<TitleSkill, 'jobs'>) => titleSkills.set(s.id, { ...s, jobs: (titleSkills.get(s.id)?.jobs ?? 0) + 1 });
      for (const j of titled) {
        j.job_skills.forEach((s) => count({ ...s.skills, source: 'skill' }));
        j.job_reference_skills.forEach((s) => count({ ...s.reference_skills, name_en: null, source: 'reference' }));
      }
      const mine = new Set((await tx.candidate_skills.findMany({ where: { candidate_id: user.id }, select: { skill_id: true } })).map((s) => s.skill_id));
      const shown = new Set(assessed.filter((s) => s.level >= 3).map((s) => s.skills.id));
      return {
        target,
        title_jobs: titled.length,
        title_skills: [...titleSkills.values()].sort((a, b) => b.jobs - a.jobs).slice(0, SKILL_LIMIT).map((s) => ({
          ...s,
          evidence: shown.has(s.id) ? 'assessed' : mine.has(s.id) || selfReported.has(s.id) ? 'self_reported' : 'no_evidence',
        })),
        role_skills: skills.map(({ learning_resources, ...skill }) => ({
          ...skill,
          evidence: selfReported.has(skill.id) ? 'self_reported' : 'no_evidence',
          resources: learning_resources,
        })),
        demonstrated_needs: assessed.filter((s) => s.level < 3).map((s) => ({ ...s.skills, level: s.level })),
        demonstrated_strengths: assessed.filter((s) => s.level >= 3).map((s) => ({ ...s.skills, level: s.level })),
        plan,
        practice: await tx.practice_tasks.findMany({ where: { candidate_id: user.id }, orderBy: { created_at: 'asc' } }),
      };
    });
  }

  @Put('target')
  @ApiOperation({ summary: 'A typed job title, a workbook job family, or both. A family must exist in the reference.' })
  setTarget(@CurrentUser() user: AuthUser, @Body() body: TargetDto) {
    const job_title = body.job_title?.trim() || null;
    const family = body.sector_code && body.job_family_ar ? { sector_code: body.sector_code, job_family_ar: body.job_family_ar } : null;
    if (!job_title && !family) throw new UnprocessableEntityException('Type a job title or choose a job family');
    if (Boolean(body.sector_code) !== Boolean(body.job_family_ar)) throw new UnprocessableEntityException('Choose both a sector and a job family');
    return this.db.asUser(user, async (tx) => {
      if (family) {
        const exists = await tx.reference_skills.findFirst({
          where: { sector_code: family.sector_code, reference_skill_contexts: { some: { job_family_ar: family.job_family_ar } } },
          select: { id: true },
        });
        if (!exists) throw new UnprocessableEntityException('This role is not in the skills reference');
      }
      const data = { job_title, sector_code: family?.sector_code ?? null, job_family_ar: family?.job_family_ar ?? null };
      return tx.career_targets.upsert({
        where: { candidate_id: user.id },
        create: { candidate_id: user.id, ...data },
        update: { ...data, updated_at: new Date() },
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

  @Post('practice')
  @ApiOperation({ summary: "A practice task for one of the target role's skills, from MIDAN's templates. Practice, never employment." })
  addPractice(@CurrentUser() user: AuthUser, @Body() body: PracticeDto) {
    return this.db.asUser(user, async (tx) => {
      const [skill, target] = await Promise.all([
        tx.reference_skills.findUnique({ where: { id: body.reference_skill_id }, select: { name_ar: true } }),
        tx.career_targets.findUnique({ where: { candidate_id: user.id } }),
      ]);
      if (!skill) throw new NotFoundException();
      const found = await tx.practice_tasks.findFirst({ where: { candidate_id: user.id, reference_skill_id: body.reference_skill_id, kind: body.kind } });
      if (found) return found;
      await tx.$executeRaw`select set_config('midan.practice', 'midan', true)`;
      return tx.practice_tasks.create({
        data: { candidate_id: user.id, reference_skill_id: body.reference_skill_id, ...practiceTask(body.kind, skill.name_ar, target?.job_title ?? target?.job_family_ar ?? null) },
      });
    });
  }

  @Patch('practice/:id')
  @ApiOperation({ summary: "Start, save, submit or complete a practice task. Submitting returns MIDAN's checklist, which isn't an assessment." })
  updatePractice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: PracticeUpdateDto) {
    return this.db.asUser(user, async (tx) => {
      const task = await tx.practice_tasks.findFirst({ where: { id, candidate_id: user.id } });
      if (!task) throw new NotFoundException();
      if (task.status === 'completed') throw new UnprocessableEntityException('This task is complete');
      const submission = body.submission ?? task.submission ?? '';
      const url = body.submission_url ?? task.submission_url ?? null;
      if (body.action === 'complete') {
        if (task.status !== 'submitted') throw new UnprocessableEntityException('Submit the task first');
        await tx.$executeRaw`select set_config('midan.practice', 'midan', true)`;
        return tx.practice_tasks.update({ where: { id }, data: { status: 'completed', completed_at: new Date() } });
      }
      if (body.action === 'submit') {
        if (!submission.trim()) throw new UnprocessableEntityException('Write your submission first');
        const skill = await tx.reference_skills.findUniqueOrThrow({ where: { id: task.reference_skill_id }, select: { name_ar: true } });
        const feedback = practiceChecklist(task.kind as PracticeKind, skill.name_ar, submission, url, (task.deliverables as unknown[]).length);
        await tx.$executeRaw`select set_config('midan.practice', 'midan', true)`;
        return tx.practice_tasks.update({ where: { id }, data: { status: 'submitted', submission, submission_url: url, submitted_at: new Date(), feedback } });
      }
      // Saving again after submitting reopens the work: the checklist is cleared until it's submitted again.
      if (task.status === 'submitted') await tx.$executeRaw`select set_config('midan.practice', 'midan', true)`;
      return tx.practice_tasks.update({
        where: { id },
        data: { status: 'in_progress', ...(body.action === 'save' && { submission, submission_url: url }), ...(task.status === 'submitted' && { feedback: Prisma.DbNull, submitted_at: null }) },
      });
    });
  }
}
