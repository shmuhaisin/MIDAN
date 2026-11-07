import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { requirement_type } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ChangeReasonDto, recordChangeReason } from '../common/change-reason';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class RequirementDto {
  @ApiProperty({ enum: requirement_type }) @IsEnum(requirement_type) requirement_type!: requirement_type;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description_ar?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description_en?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_mandatory?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) position?: number;
  @ApiPropertyOptional() @ValidateIf((o) => o.min_years !== null) @IsOptional() @IsNumber() @Min(0) @Max(70) min_years?: number | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.skill_id !== null) @IsOptional() @IsUUID() skill_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) source_reference?: string | null;
}

class UpdateRequirementDto {
  @ApiPropertyOptional({ enum: requirement_type }) @IsOptional() @IsEnum(requirement_type) requirement_type?: requirement_type;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description_ar?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description_en?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_mandatory?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) position?: number;
  @ApiPropertyOptional() @ValidateIf((o) => o.min_years !== null) @IsOptional() @IsNumber() @Min(0) @Max(70) min_years?: number | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.skill_id !== null) @IsOptional() @IsUUID() skill_id?: string | null;
}

class TaskRequirementsDto extends ChangeReasonDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) requirement_ids!: string[];
}

@ApiTags('job requirements')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId')
export class RequirementsController {
  constructor(private readonly db: DbService) {}

  @Get('jobs/:jobId/requirements')
  @ApiOperation({ summary: "A job's active requirements, with the tasks that measure each one." })
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return tx.job_requirements.findMany({
        where: { job_id: jobId, org_id: orgId, retired_at: null },
        orderBy: [{ requirement_type: 'asc' }, { position: 'asc' }, { created_at: 'asc' }],
        include: {
          skills: { select: { id: true, name_ar: true, name_en: true } },
          task_requirement_mappings: {
            select: {
              assessment_tasks: {
                select: {
                  id: true, position: true, title_ar: true, title_en: true, version_id: true,
                  assessment_versions: { select: { assessments: { select: { title_ar: true, title_en: true } } } },
                },
              },
            },
          },
        },
      });
    });
  }

  @Post('jobs/:jobId/requirements')
  create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() body: RequirementDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const job = await tx.jobs.findFirst({ where: { id: jobId, org_id: orgId }, select: { id: true } });
      if (!job) throw new NotFoundException();
      const last = await tx.job_requirements.aggregate({ where: { job_id: jobId, requirement_type: body.requirement_type }, _max: { position: true } });
      // Entered by a person at the organization, so it counts as stated by the employer.
      return tx.job_requirements.create({
        data: { position: (last._max.position ?? 0) + 1, ...body, job_id: jobId, org_id: orgId, origin: 'employer_stated' },
      });
    });
  }

  @Patch('job-requirements/:id')
  update(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRequirementDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.job_requirements.updateMany({ where: { id, org_id: orgId, retired_at: null }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.job_requirements.findUniqueOrThrow({ where: { id } });
    });
  }

  @Delete('job-requirements/:id')
  @ApiOperation({ summary: 'Deletes an unused requirement. One linked to a task or rubric is retired, so history stays traceable.' })
  remove(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.job_requirements.findFirst({
        where: { id, org_id: orgId, retired_at: null },
        select: { _count: { select: { task_requirement_mappings: true, rubric_criteria: true } } },
      });
      if (!found) throw new NotFoundException();
      if (found._count.task_requirement_mappings + found._count.rubric_criteria > 0) {
        await tx.job_requirements.update({ where: { id }, data: { retired_at: new Date() } });
        return { removed: 'retired' };
      }
      await tx.job_requirements.delete({ where: { id } });
      return { removed: 'deleted' };
    });
  }

  @Put('assessment-tasks/:taskId/requirements')
  @ApiOperation({ summary: 'Sets which job requirements a task measures. Locked once the version is published.' })
  setTaskRequirements(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: TaskRequirementsDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const task = await tx.assessment_tasks.findFirst({ where: { id: taskId, org_id: orgId }, select: { id: true } });
      if (!task) throw new NotFoundException();
      await recordChangeReason(tx, body.reason);
      const wanted = [...new Set(body.requirement_ids)];
      await tx.task_requirement_mappings.deleteMany({ where: { task_id: taskId, requirement_id: { notIn: wanted } } });
      await tx.task_requirement_mappings.createMany({
        data: wanted.map((requirement_id) => ({ task_id: taskId, requirement_id, org_id: orgId })),
        skipDuplicates: true,
      });
      return tx.task_requirement_mappings.findMany({ where: { task_id: taskId }, select: { requirement_id: true } });
    });
  }
}
