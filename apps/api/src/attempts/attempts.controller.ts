import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { signedUrl, storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

class SaveResponseDto {
  @ApiProperty() @IsObject() answer!: Record<string, unknown>;
}

const MAX_UPLOAD = 25 * 1024 * 1024;

@ApiTags('attempts')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class AttemptsController {
  constructor(private readonly db: DbService) {}

  @Post('applications/:id/invite')
  invite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const application = await tx.applications.findFirst({ where: { id } });
      if (!application) throw new NotFoundException();
      await requireRole(tx, user, application.org_id, BUILDERS);
      const version = await tx.assessment_versions.findFirst({
        where: { org_id: application.org_id, status: 'published', assessments: { job_id: application.job_id } },
        orderBy: { version_number: 'desc' },
      });
      if (!version) throw new UnprocessableEntityException('Publish an assessment for this job first');
      return tx.assessment_attempts.create({
        data: { application_id: id, version_id: version.id, org_id: application.org_id, candidate_id: application.candidate_id },
      });
    });
  }

  /** The branded experience. A candidate gets their attempt; a staff member gets a read-only preview. */
  @Get('experience/:orgSlug/:jobSlug/:version')
  experience(
    @CurrentUser() user: AuthUser,
    @Param('orgSlug') orgSlug: string,
    @Param('jobSlug') jobSlug: string,
    @Param('version', ParseIntPipe) versionNumber: number,
  ) {
    return this.db.asUser(user, async (tx) => {
      const version = await tx.assessment_versions.findFirst({
        where: { version_number: versionNumber, assessments: { jobs: { slug: jobSlug, organizations: { slug: orgSlug } } } },
        include: { assessment_tasks: { orderBy: { position: 'asc' } }, assessments: { select: { professional_field: true } } },
      });
      if (!version) throw new NotFoundException();
      const [organization, branding, job, attempt] = await Promise.all([
        tx.organizations.findFirstOrThrow({ where: { slug: orgSlug }, select: { name_ar: true, name_en: true, is_demo: true } }),
        tx.organization_branding.findUnique({ where: { org_id: version.org_id } }),
        tx.jobs.findFirstOrThrow({ where: { slug: jobSlug, org_id: version.org_id }, select: { title_ar: true, title_en: true } }),
        tx.assessment_attempts.findFirst({
          where: { version_id: version.id, candidate_id: user.id },
          include: { task_responses: true, evidence_files: { select: { id: true, task_id: true, file_name: true, size_bytes: true } } },
        }),
      ]);
      return { mode: attempt ? 'attempt' : 'preview', organization, branding, job, version, attempt };
    });
  }

  @Post('attempts/:id/start')
  async start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const [attempt] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ id: string; status: string }[]>`select id, status from public.start_attempt(${id}::uuid)`);
    return attempt;
  }

  @Put('attempts/:id/responses/:taskId')
  saveResponse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: SaveResponseDto) {
    return this.db.asUser(user, async (tx) => {
      const attempt = await tx.assessment_attempts.findFirst({ where: { id, candidate_id: user.id } });
      if (!attempt) throw new NotFoundException();
      const answer = body.answer as Prisma.InputJsonValue;
      return tx.task_responses.upsert({
        where: { attempt_id_task_id: { attempt_id: id, task_id: taskId } },
        create: { attempt_id: id, task_id: taskId, org_id: attempt.org_id, candidate_id: user.id, answer },
        update: { answer },
      });
    });
  }

  @Post('attempts/:id/evidence/:taskId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }))
  async uploadEvidence(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Attach a file');
    const attempt = await this.db.asUser(user, (tx) => tx.assessment_attempts.findFirst({ where: { id, candidate_id: user.id } }));
    if (!attempt) throw new NotFoundException();
    const name = file.originalname.normalize('NFC').replace(/[^\w.\-؀-ۿ]+/g, '_').slice(-120);
    const path = `${attempt.org_id}/${id}/${randomUUID()}-${Buffer.from(name).toString('hex').slice(0, 60)}`;

    const upload = await storageFetch(`object/assessment-evidence/${path}`, token, {
      method: 'POST',
      headers: { 'content-type': file.mimetype },
      body: new Uint8Array(file.buffer),
    });
    if (upload.status === 400 || upload.status === 413 || upload.status === 415) throw new UnprocessableEntityException('This file type or size is not allowed');
    if (upload.status === 403) throw new ForbiddenException();
    if (!upload.ok) throw new ServiceUnavailableException('Upload failed');

    return this.db.asUser(user, (tx) =>
      tx.evidence_files.create({
        data: {
          attempt_id: id, task_id: taskId, org_id: attempt.org_id, candidate_id: user.id,
          storage_path: path, file_name: name, mime_type: file.mimetype, size_bytes: file.size,
        },
        select: { id: true, task_id: true, file_name: true, size_bytes: true },
      }),
    );
  }

  @Get('evidence/:id/url')
  async evidenceUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.db.asUser(user, (tx) => tx.evidence_files.findFirst({ where: { id } }));
    if (!file) throw new NotFoundException();
    const url = await signedUrl('assessment-evidence', file.storage_path, token);
    if (!url) throw new ForbiddenException();
    return { url, file_name: file.file_name };
  }

  @Post('attempts/:id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const [attempt] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ id: string; status: string }[]>`select id, status from public.submit_attempt(${id}::uuid)`);
    return attempt;
  }
}
