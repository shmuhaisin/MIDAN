import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { job_status } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

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

class JobSkillDto {
  @ApiProperty() @IsUUID() skill_id!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(4) required_level!: number;
}

class UpdateJobDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) description_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) description_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) requirements_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) requirements_en?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional({ type: [JobSkillDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => JobSkillDto) skills?: JobSkillDto[];
}

class JobStatusDto {
  @ApiProperty({ enum: job_status }) @IsEnum(job_status) status!: job_status;
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

  @Get(':orgId/jobs/:jobId')
  getJob(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const job = await tx.jobs.findFirst({
        where: { id: jobId, org_id: orgId },
        include: {
          organizations: { select: { slug: true } },
          job_skills: { select: { skill_id: true, required_level: true } },
          applications: {
            where: { status: { not: 'withdrawn' } },
            orderBy: { created_at: 'desc' },
            include: {
              users: { select: { email: true, candidate_profiles: { select: { full_name: true, headline: true } } } },
              assessment_attempts: { select: { id: true, status: true, evaluation_results: { select: { id: true, status: true, released_to_candidate: true } } } },
            },
          },
        },
      });
      if (!job) throw new NotFoundException();
      return job;
    });
  }

  @Patch(':orgId/jobs/:jobId')
  updateJob(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() { skills, ...fields }: UpdateJobDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter']);
      const { count } = await tx.jobs.updateMany({ where: { id: jobId, org_id: orgId }, data: fields });
      if (count === 0) throw new NotFoundException();
      if (skills) {
        await tx.job_skills.deleteMany({ where: { job_id: jobId } });
        await tx.job_skills.createMany({ data: skills.map((s) => ({ job_id: jobId, org_id: orgId, ...s })) });
      }
      return tx.jobs.findUniqueOrThrow({ where: { id: jobId } });
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
