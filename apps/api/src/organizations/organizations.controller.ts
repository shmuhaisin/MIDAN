import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { job_status, org_role } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService, Tx } from '../db/db.service';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class CreateOrganizationDto {
  @ApiProperty() @IsString() @Matches(SLUG) @MaxLength(80) slug!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name_ar!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name_en!: string;
}

class CreateJobDto {
  @ApiProperty() @IsString() @Matches(SLUG) @MaxLength(80) slug!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title_ar!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title_en!: string;
  @ApiPropertyOptional({ enum: job_status }) @IsOptional() @IsEnum(job_status) status?: job_status;
}

class JobStatusDto {
  @ApiProperty({ enum: job_status }) @IsEnum(job_status) status!: job_status;
}

/** Backend check on top of RLS, so a non-member gets a clear refusal instead of an empty list. */
async function requireRole(tx: Tx, user: AuthUser, orgId: string, roles?: org_role[]) {
  const member = await tx.organization_members.findFirst({
    where: { org_id: orgId, user_id: user.id, ...(roles && { role: { in: roles } }) },
    select: { id: true },
  });
  if (!member) throw new ForbiddenException();
}

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly db: DbService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateOrganizationDto) {
    const [organization] = await this.db.asUser(user, (tx) =>
      tx.$queryRaw<{ id: string; slug: string; name_ar: string; name_en: string }[]>`
        select id, slug, name_ar, name_en from public.create_organization(${body.slug}, ${body.name_ar}, ${body.name_en})`,
    );
    return organization;
  }

  @Get(':orgId')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const [organization, member] = await Promise.all([
        tx.organizations.findUniqueOrThrow({ where: { id: orgId } }),
        tx.organization_members.findFirstOrThrow({ where: { org_id: orgId, user_id: user.id }, select: { role: true } }),
      ]);
      return { ...organization, my_role: member.role };
    });
  }

  @Get(':orgId/jobs')
  listJobs(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return tx.jobs.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } });
    });
  }

  @Post(':orgId/jobs')
  createJob(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: CreateJobDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter']);
      return tx.jobs.create({
        data: { ...body, org_id: orgId, published_at: body.status === 'published' ? new Date() : null },
      });
    });
  }

  @Patch(':orgId/jobs/:jobId/status')
  setJobStatus(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: JobStatusDto,
  ) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter']);
      const { count } = await tx.jobs.updateMany({
        where: { id: jobId, org_id: orgId },
        data: { status: body.status, ...(body.status === 'published' && { published_at: new Date() }) },
      });
      if (count === 0) throw new NotFoundException();
      return tx.jobs.findUniqueOrThrow({ where: { id: jobId } });
    });
  }

  @Get(':orgId/applications')
  listApplications(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      // A withdrawn candidate's details are no longer visible to the organization.
      return tx.applications.findMany({
        where: { org_id: orgId, status: { not: 'withdrawn' } },
        orderBy: { created_at: 'desc' },
        include: {
          jobs: { select: { id: true, title_ar: true, title_en: true } },
          users: { select: { id: true, email: true, candidate_profiles: { select: { full_name: true, headline: true } } } },
        },
      });
    });
  }
}
