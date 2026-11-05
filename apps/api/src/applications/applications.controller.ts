import { Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { application_status } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { signedUrl } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

class UpdateStatusDto {
  @ApiProperty({ enum: application_status }) @IsEnum(application_status) status!: application_status;
}

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly db: DbService) {}

  @Get(':id/profile')
  @ApiOperation({ summary: "An applicant's profile, for staff of the organization they applied to, while the application is active." })
  profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const application = await tx.applications.findFirst({
        where: { id, status: { not: 'withdrawn' } },
        include: {
          jobs: { select: { id: true, title_ar: true, title_en: true, job_skills: { select: { skill_id: true, required_level: true, skills: { select: { name_ar: true, name_en: true } } } } } },
          users: {
            select: {
              email: true,
              candidate_profiles: true,
              candidate_skills: { select: { skill_id: true, skills: { select: { name_ar: true, name_en: true } } } },
            },
          },
          assessment_attempts: { select: { id: true, status: true } },
        },
      });
      if (!application) throw new NotFoundException();
      await requireRole(tx, user, application.org_id);
      return application;
    });
  }

  @Get(':id/cv-url')
  async cvUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const path = await this.db.asUser(user, async (tx) => {
      const application = await tx.applications.findFirst({
        where: { id, status: { not: 'withdrawn' } },
        select: { org_id: true, users: { select: { candidate_profiles: { select: { cv_path: true } } } } },
      });
      if (!application) throw new NotFoundException();
      await requireRole(tx, user, application.org_id);
      return application.users.candidate_profiles?.cv_path;
    });
    if (!path) throw new NotFoundException();
    const url = await signedUrl('candidate-documents', path, token);
    if (!url) throw new ForbiddenException();
    return { url };
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const [application] = await tx.$queryRaw<{ id: string; status: string }[]>`
        select id, status from public.withdraw_application(${id}::uuid)`;
      return application;
    });
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStatusDto) {
    return this.db.asUser(user, async (tx) => {
      // RLS hides rows from other tenants, and a candidate's own row is not theirs to change.
      const { count } = await tx.applications.updateMany({ where: { id }, data: { status: body.status } });
      if (count === 0) throw new NotFoundException();
      return tx.applications.findUniqueOrThrow({ where: { id } });
    });
  }
}
