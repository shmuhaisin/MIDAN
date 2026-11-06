import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import { listableJobs } from '../common/test-data';
import { storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

class ApplyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  cover_note?: string;
}

const PUBLIC_JOB = {
  id: true, slug: true, title_ar: true, title_en: true, description_ar: true, description_en: true,
  location: true, status: true, is_demo: true, published_at: true, requirements_ar: true, requirements_en: true,
  employment_type: true, application_deadline: true, salary_min: true, salary_max: true, sector: true, experience_level: true,
  job_reference_skills: { select: { is_required: true, reference_skills: { select: { id: true, name_ar: true, description_ar: true } } } },
  job_skills: { select: { required_level: true, is_required: true, skills: { select: { id: true, name_ar: true, name_en: true } } } },
  job_requirements: {
    where: { retired_at: null, review_status: 'approved' },
    orderBy: [{ requirement_type: 'asc' }, { position: 'asc' }],
    select: { id: true, requirement_type: true, description_ar: true, description_en: true, is_mandatory: true, min_years: true },
  },
  organizations: {
    select: {
      id: true, slug: true, name_ar: true, name_en: true, is_demo: true,
      // The official registry entity this account was confirmed as, if any. Not a partnership.
      employer_registry: { select: { id: true, source_company_id: true, name_ar: true, name_en: true, verification_status: true, partnership_status: true } },
    },
  },
} satisfies Prisma.jobsSelect;

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Published jobs on Midan, with optional filters. Test fixtures never appear here, and demo jobs only with demo=1.' })
  list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('demo') demo?: string,
    @Query('q') q?: string, @Query('employer') employer?: string, @Query('location') location?: string, @Query('sector') sector?: string,
    @Query('employment_type') employmentType?: string, @Query('experience_level') experienceLevel?: string,
    @Query('registry', new ParseUUIDPipe({ optional: true })) registry?: string,
  ) {
    const contains = (value: string) => ({ contains: value.slice(0, 100), mode: Prisma.QueryMode.insensitive });
    const where: Prisma.jobsWhereInput = {
      ...(demo === '1' ? { status: 'published', is_demo: true } : listableJobs(user?.email)),
      ...(q?.trim() && { OR: [{ title_ar: contains(q.trim()) }, { title_en: contains(q.trim()) }] }),
      ...(employer?.trim() && { organizations: { OR: [{ name_ar: contains(employer.trim()) }, { name_en: contains(employer.trim()) }] } }),
      ...(registry && { organizations: { employer_registry_id: registry } }),
      ...(location?.trim() && { location: contains(location.trim()) }),
      ...(sector && { sector }),
      ...(employmentType && { employment_type: employmentType }),
      ...(experienceLevel && { experience_level: experienceLevel }),
    };
    return this.db.asAnon((tx) => tx.jobs.findMany({ where, select: PUBLIC_JOB, orderBy: { published_at: 'desc' }, take: 100 }));
  }

  @Get('external')
  @ApiOperation({ summary: "Listings on other sites. They link to their source, and can't be applied to here." })
  external(@Query('q') q?: string, @Query('sector') sector?: string) {
    const text = q?.trim().slice(0, 100);
    return this.db.asAnon((tx) =>
      tx.external_job_listings.findMany({
        where: {
          published: true,
          is_demo: false,
          ...(sector && { sector }),
          ...(text && { OR: [{ title_ar: { contains: text, mode: Prisma.QueryMode.insensitive } }, { title_en: { contains: text, mode: Prisma.QueryMode.insensitive } }] }),
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
    );
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const { job, assessments } = await this.db.asAnon(async (tx) => ({
      job: await tx.jobs.findUnique({ where: { id }, select: PUBLIC_JOB }),
      assessments: await tx.$queryRaw<unknown[]>`select * from public.job_assessment_overview(${id}::uuid)`,
    }));
    if (!job) throw new NotFoundException();
    return { ...job, assessments };
  }

  @Post(':id/applications')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply to a published job as the signed-in candidate.' })
  async apply(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplyDto) {
    const { job, existing, cvPath } = await this.db.asUser(user, async (tx) => ({
      job: await tx.jobs.findFirst({ where: { id, status: 'published' }, select: { org_id: true } }),
      existing: await tx.applications.findFirst({ where: { job_id: id, candidate_id: user.id } }),
      cvPath: (await tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } }))?.cv_path,
    }));
    // A second click or a retry gets the same application.
    if (existing) return existing;
    if (!job) throw new NotFoundException();

    // The application keeps its own copy, so replacing a CV later doesn't change what was submitted.
    let snapshot: string | null = null;
    if (cvPath) {
      snapshot = `${user.id}/applications/${id}/${randomUUID()}.${cvPath.split('.').pop()}`;
      const copied = await storageFetch('object/copy', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bucketId: 'candidate-documents', sourceKey: cvPath, destinationKey: snapshot }),
      });
      if (!copied.ok) throw new ServiceUnavailableException('The CV could not be attached');
    }
    try {
      return await this.db.asUser(user, (tx) =>
        tx.applications.create({ data: { job_id: id, org_id: job.org_id, candidate_id: user.id, cover_note: body.cover_note, cv_snapshot_path: snapshot } }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (snapshot) await storageFetch(`object/candidate-documents/${snapshot}`, token, { method: 'DELETE' });
        return this.db.asUser(user, (tx) => tx.applications.findFirstOrThrow({ where: { job_id: id, candidate_id: user.id } }));
      }
      throw error;
    }
  }
}
