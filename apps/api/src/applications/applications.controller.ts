import { Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { application_status } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { signedUrl, storageFetch } from '../common/storage';
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
              candidate_reference_skills: { select: { reference_skills: { select: { id: true, name_ar: true } } } },
            },
          },
          assessment_attempts: { orderBy: { created_at: 'asc' }, select: { id: true, status: true, assessment_versions: { select: { assessments: { select: { title_ar: true, title_en: true } } } } } },
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
        select: { org_id: true, cv_snapshot_path: true, users: { select: { candidate_profiles: { select: { cv_path: true } } } } },
      });
      if (!application) throw new NotFoundException();
      await requireRole(tx, user, application.org_id);
      return application.cv_snapshot_path ?? application.users.candidate_profiles?.cv_path;
    });
    if (!path) throw new NotFoundException();
    const url = await signedUrl('candidate-documents', path, token);
    if (!url) throw new ForbiddenException();
    return { url };
  }

  @Post(':id/withdraw')
  async withdraw(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const { application, snapshot } = await this.db.asUser(user, async (tx) => {
      const before = await tx.applications.findFirst({ where: { id, candidate_id: user.id }, select: { cv_snapshot_path: true } });
      const [withdrawn] = await tx.$queryRaw<{ id: string; status: string }[]>`
        select id, status from public.withdraw_application(${id}::uuid)`;
      return { application: withdrawn, snapshot: before?.cv_snapshot_path };
    });
    if (snapshot) await storageFetch(`object/candidate-documents/${snapshot}`, token, { method: 'DELETE' }).catch(() => undefined);
    return application;
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: "A staff member's decision on an application.",
    description: 'Only the moves in public.set_application_status are allowed (422 otherwise). Assessment stages, outcomes and withdrawal are set elsewhere.',
  })
  async updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStatusDto) {
    // Another organization's application, or a candidate's own, is reported as not found by the database.
    const [application] = await this.db.asUser(user, (tx) =>
      tx.$queryRaw<unknown[]>`select * from public.set_application_status(${id}::uuid, ${body.status}::public.application_status)`);
    return application;
  }
}
