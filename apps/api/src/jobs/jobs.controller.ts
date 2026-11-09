import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import { listableJobs, viewableJob } from '../common/test-data';
import { storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

class ApplyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  cover_note?: string;
}

/** Today's date in Riyadh, as the date the database compares application deadlines with. */
export function riyadhToday() {
  return new Date(`${new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
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

/** What a visitor sees of a listing. The raw record, review notes and who reviewed it stay with administrators. */
const PUBLIC_LISTING = {
  id: true, title_ar: true, title_en: true, title_original: true, description_original: true, requirements_original: true, employer_name_ar: true, employer_name_en: true,
  location: true, sector: true, sector_code: true, employment_type: true, source_name: true, source_url: true, source_type: true, collected_at: true, published: true, created_at: true,
  employer_registry: { select: { id: true, name_ar: true, name_en: true } },
} satisfies Prisma.external_job_listingsSelect;

const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_TERMS = 8;

function paging(page?: string, pageSize?: string) {
  const number = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(pageSize ?? '12', 10) || 12));
  return { number, size, skip: (number - 1) * size };
}

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

/** The search, spelled the way the stored text is: public.normalize_arabic, which also lowers case. */
async function searchTerms(db: DbService, q?: string) {
  const text = q?.trim().slice(0, 200);
  if (!text) return [];
  const [row] = await db.asAnon((tx) => tx.$queryRaw<{ normalized: string }[]>`select public.normalize_arabic(${text}) as normalized`);
  return row.normalized.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
}

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Published jobs on Midan, with optional filters. Test fixtures never appear here, and demo jobs only with demo=1.' })
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('demo') demo?: string,
    @Query('q') q?: string, @Query('employer') employer?: string, @Query('location') location?: string, @Query('sector') sector?: string,
    @Query('employment_type') employmentType?: string, @Query('experience_level') experienceLevel?: string,
    @Query('registry', new ParseUUIDPipe({ optional: true })) registry?: string,
    @Query('page') page?: string, @Query('page_size') pageSize?: string,
    @Query('sort') sort?: string, @Query('include_closed') includeClosed?: string,
  ) {
    const contains = (value: string) => ({ contains: value.slice(0, 100), mode: Prisma.QueryMode.insensitive });
    const base: Prisma.jobsWhereInput = demo === '1' ? { status: 'published', is_demo: true } : listableJobs(user?.email);
    const terms = await searchTerms(this.db, q);
    const where: Prisma.jobsWhereInput = {
      ...base,
      // Every word has to appear somewhere: the title, description or requirements, either language, or the employer's name.
      ...(terms.length > 0 && {
        AND: terms.map((term) => ({
          OR: [
            { search_text: { contains: term } },
            { job_requirements: { some: { retired_at: null, review_status: 'approved', search_text: { contains: term } } } },
            { organizations: { OR: [{ name_ar: contains(term) }, { name_en: contains(term) }] } },
          ],
        })),
      }),
      ...(employer?.trim() && { organizations: { OR: [{ name_ar: contains(employer.trim()) }, { name_en: contains(employer.trim()) }] } }),
      ...(registry && { organizations: { employer_registry_id: registry } }),
      ...(location?.trim() && { location: contains(location.trim()) }),
      ...(sector && { sector }),
      ...(employmentType && { employment_type: employmentType }),
      ...(experienceLevel && { experience_level: experienceLevel }),
      // A job past its application deadline (a date, Riyadh time, inclusive) can't be applied to, so it isn't offered.
      ...(includeClosed !== '1' && { OR: [{ application_deadline: null }, { application_deadline: { gte: riyadhToday() } }] }),
    };
    // Newest first, or the soonest deadline first (jobs without a deadline last).
    const orderBy: Prisma.jobsOrderByWithRelationInput[] = sort === 'deadline'
      ? [{ application_deadline: { sort: 'asc', nulls: 'last' } }, { published_at: 'desc' }, { id: 'asc' }]
      : [{ published_at: 'desc' }, { id: 'asc' }];
    // Without a page, the plain list that other callers already read.
    if (page === undefined) return this.db.asAnon((tx) => tx.jobs.findMany({ where, select: PUBLIC_JOB, orderBy: { published_at: 'desc' }, take: 100 }));
    const { number, size, skip } = paging(page, pageSize);
    return this.db.asAnon(async (tx) => {
      const [items, total, all] = await Promise.all([
        tx.jobs.findMany({ where, select: PUBLIC_JOB, orderBy, skip, take: size }),
        tx.jobs.count({ where }),
        // What the filters can offer: everything listable, not just this page.
        tx.jobs.findMany({ where: base, select: { location: true, employment_type: true, experience_level: true, organizations: { select: { name_ar: true, name_en: true } } }, take: 1000 }),
      ]);
      return {
        items, total, page: number, page_size: size,
        facets: {
          locations: distinct(all.map((j) => j.location)),
          employment_types: distinct(all.map((j) => j.employment_type)),
          experience_levels: distinct(all.map((j) => j.experience_level)),
          employers: [...new Map(all.map((j) => [j.organizations.name_en, j.organizations])).values()],
        },
      };
    });
  }

  @Get('external')
  @ApiOperation({ summary: "Listings on other sites. They link to their source, and can't be applied to here." })
  async external(@Query('q') q?: string, @Query('sector') sector?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string) {
    const terms = await searchTerms(this.db, q);
    const where: Prisma.external_job_listingsWhereInput = {
      published: true,
      is_demo: false,
      AND: [
        // Once its record has become a job here, the job is what people find.
        { OR: [{ converted_job: { is: null } }, { converted_job: { status: { not: 'published' } } }] },
        ...(sector ? [{ OR: [{ sector }, { sector_code: sector }] }] : []),
        ...terms.map((term) => ({ search_text: { contains: term } })),
      ],
    };
    if (page === undefined) return this.db.asAnon((tx) => tx.external_job_listings.findMany({ where, select: PUBLIC_LISTING, orderBy: { created_at: 'desc' }, take: 50 }));
    const { number, size, skip } = paging(page, pageSize);
    return this.db.asAnon(async (tx) => {
      const [items, total] = await Promise.all([
        tx.external_job_listings.findMany({ where, select: PUBLIC_LISTING, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip, take: size }),
        tx.external_job_listings.count({ where }),
      ]);
      return { items, total, page: number, page_size: size };
    });
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async get(@CurrentUser() user: AuthUser | undefined, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.db.asAnon(async (tx) => {
      // Test organizations' jobs are "not found" except to the test accounts (common/test-data.ts).
      const job = await tx.jobs.findFirst({ where: viewableJob(id, user?.email), select: PUBLIC_JOB });
      if (!job) return null;
      return { job, assessments: await tx.$queryRaw<unknown[]>`select * from public.job_assessment_overview(${id}::uuid)` };
    });
    if (!result) throw new NotFoundException();
    return { ...result.job, assessments: result.assessments };
  }

  @Post(':id/applications')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply to a published job as the signed-in candidate.' })
  async apply(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplyDto) {
    const { job, existing, cvPath } = await this.db.asUser(user, async (tx) => ({
      job: await tx.jobs.findFirst({ where: { ...viewableJob(id, user.email), status: 'published' }, select: { org_id: true } }),
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
