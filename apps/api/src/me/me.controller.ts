import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Put, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl, storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';
import { CvController } from './cv.controller';

/** How many CVs a candidate keeps in their own library. */
const CV_LIBRARY = 5;

const MIN_YEAR = 1950;
const MAX_YEAR = 2100;
const CV_TYPES: Record<string, { extension: string; signature: string }> = {
  'application/pdf': { extension: 'pdf', signature: '%PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', signature: 'PK' },
};

class EducationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) institution?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) qualification!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) field?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) start_year?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) end_year?: number | null;
}

class TitledDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) issuer?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) year?: number | null;
}

class ExperienceDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) start_year?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) end_year?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class CandidateProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) full_name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) headline?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) summary?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(70) years_experience?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() share_profile_consent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) time_zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() notification_prefs?: { deadline_reminders?: boolean };
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true }) self_reported_skills?: string[];
  @ApiPropertyOptional({ type: [TitledDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TitledDto) projects?: TitledDto[];
  @ApiPropertyOptional({ type: [TitledDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TitledDto) courses?: TitledDto[];
  @ApiPropertyOptional({ type: [TitledDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TitledDto) certifications?: TitledDto[];
  @ApiPropertyOptional({ type: [EducationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EducationDto) education?: EducationDto[];
  @ApiPropertyOptional({ type: [ExperienceDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ExperienceDto) experience?: ExperienceDto[];
}

class SkillsDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) skill_ids!: string[];
}

function assertYears(items: { start_year?: number | null; end_year?: number | null }[] = []) {
  if (items.some((i) => i.end_year != null && i.start_year != null && i.end_year < i.start_year)) {
    throw new BadRequestException('An end year cannot be before its start year');
  }
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService, private readonly cv: CvController) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) =>
      tx.users.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          candidate_profiles: true,
          candidate_skills: { select: { skill_id: true, skills: { select: { name_ar: true, name_en: true } } } },
          organization_members: {
            select: { org_id: true, role: true, organizations: { select: { name_ar: true, name_en: true, is_demo: true } } },
          },
        },
      }),
    );
  }

  @Put('candidate-profile')
  upsertProfile(@CurrentUser() user: AuthUser, @Body() body: CandidateProfileDto) {
    assertYears(body.education);
    assertYears(body.experience);
    // Class instances out, plain JSON in, for the jsonb columns.
    const { education, experience, projects, courses, certifications, self_reported_skills, notification_prefs, ...fields } = body;
    const lists = { education, experience, projects, courses, certifications, self_reported_skills, notification_prefs };
    const json = Object.fromEntries(
      Object.entries(lists).filter(([, value]) => value !== undefined).map(([key, value]) => [key, JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue]),
    );
    return this.db.asUser(user, async (tx) => {
      const existing = await tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { share_profile_consent: true } });
      const consentChanged = body.share_profile_consent !== undefined && body.share_profile_consent !== (existing?.share_profile_consent ?? false);
      const data = { ...fields, ...json, ...(consentChanged && { consent_updated_at: new Date() }) };
      return tx.candidate_profiles.upsert({ where: { user_id: user.id }, create: { ...data, user_id: user.id }, update: data });
    });
  }

  @Put('skills')
  setSkills(@CurrentUser() user: AuthUser, @Body() body: SkillsDto) {
    return this.db.asUser(user, async (tx) => {
      await tx.candidate_skills.deleteMany({ where: { candidate_id: user.id } });
      await tx.candidate_skills.createMany({ data: [...new Set(body.skill_ids)].map((skill_id) => ({ candidate_id: user.id, skill_id })) });
      return tx.candidate_skills.findMany({ where: { candidate_id: user.id }, select: { skill_id: true } });
    });
  }

  @Post('cv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadCv(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @UploadedFile() file?: Express.Multer.File) {
    const type = file && CV_TYPES[file.mimetype];
    // The declared type alone can't be trusted, so the file's first bytes must agree.
    if (!file || !type || !file.buffer.subarray(0, type.signature.length).equals(Buffer.from(type.signature))) {
      throw new UnprocessableEntityException('Upload a PDF or Word document');
    }
    const profile = await this.db.asUser(user, (tx) => tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } }));
    if (!profile) throw new UnprocessableEntityException('Save your profile first');

    // The original file name often holds a person's name, so it isn't kept.
    const path = `${user.id}/cv-${randomUUID()}.${type.extension}`;
    const upload = await storageFetch(`object/candidate-documents/${path}`, token, {
      method: 'POST',
      headers: { 'content-type': file.mimetype },
      body: new Uint8Array(file.buffer),
    });
    if (!upload.ok) throw new ServiceUnavailableException('Upload failed');
    const document = await this.db.asUser(user, async (tx) => {
      await tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: path } });
      await tx.cv_documents.updateMany({ where: { candidate_id: user.id, is_current: true }, data: { is_current: false } });
      return tx.cv_documents.create({ data: { candidate_id: user.id, storage_path: path, mime_type: file.mimetype, size_bytes: file.size } });
    });
    // Earlier CVs stay in the candidate's own library (to choose one for an application), at most CV_LIBRARY files: the
    // oldest beyond that is deleted with what was read from it. Organizations only ever read the copy an application holds.
    const older = await this.db.asUser(user, (tx) => tx.cv_documents.findMany({
      where: { candidate_id: user.id, is_current: false }, orderBy: { created_at: 'desc' }, skip: CV_LIBRARY - 1, select: { id: true, storage_path: true },
    }));
    for (const old of older) {
      await storageFetch(`object/candidate-documents/${old.storage_path}`, token, { method: 'DELETE' });
      await this.db.asUser(user, (tx) => tx.cv_documents.deleteMany({ where: { id: old.id, candidate_id: user.id } }));
    }
    // Extraction and redaction run from here, inside Midan. The candidate reviews the result before anything is saved.
    const analysis = await this.cv.start(user, token, document.id, path);
    return { cv_path: path, analysis_id: analysis.id };
  }

  @Get('cv/documents')
  @ApiOperation({ summary: "The candidate's own CV library, newest first: which one is the profile's CV. No file contents." })
  cvDocuments(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => (await tx.cv_documents.findMany({
      where: { candidate_id: user.id }, orderBy: { created_at: 'desc' },
      select: { id: true, mime_type: true, size_bytes: true, is_current: true, created_at: true },
    })).map((d) => ({ ...d, size_bytes: Number(d.size_bytes) })));
  }

  @Get('cv/documents/:id/url')
  @ApiOperation({ summary: "A short-lived link to one of the candidate's own CVs, to preview it." })
  async cvDocumentUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.db.asUser(user, (tx) => tx.cv_documents.findFirst({ where: { id, candidate_id: user.id }, select: { storage_path: true } }));
    const url = doc ? await signedUrl('candidate-documents', doc.storage_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post('cv/documents/:id/current')
  @ApiOperation({ summary: "Makes one of the candidate's saved CVs the profile's CV." })
  async makeCurrent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const doc = await tx.cv_documents.findFirst({ where: { id, candidate_id: user.id }, select: { id: true, storage_path: true } });
      if (!doc) throw new NotFoundException();
      await tx.cv_documents.updateMany({ where: { candidate_id: user.id, is_current: true }, data: { is_current: false } });
      await tx.cv_documents.update({ where: { id }, data: { is_current: true } });
      await tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: doc.storage_path } });
      return { id, is_current: true };
    });
  }

  @Delete('cv/documents/:id')
  @ApiOperation({ summary: "Deletes one of the candidate's saved CVs and what was read from it. Applications keep their own copies." })
  async deleteCvDocument(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.db.asUser(user, (tx) => tx.cv_documents.findFirst({ where: { id, candidate_id: user.id }, select: { storage_path: true, is_current: true } }));
    if (!doc) throw new NotFoundException();
    const removed = await storageFetch(`object/candidate-documents/${doc.storage_path}`, token, { method: 'DELETE' });
    if (!removed.ok && removed.status !== 404) throw new ServiceUnavailableException('The file could not be removed');
    await this.db.asUser(user, async (tx) => {
      await tx.cv_documents.deleteMany({ where: { id, candidate_id: user.id } });
      if (doc.is_current) await tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: null } });
    });
    return { removed: true };
  }

  @Get('cv/url')
  async cvUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string) {
    const profile = await this.db.asUser(user, (tx) => tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } }));
    const url = profile?.cv_path ? await signedUrl('candidate-documents', profile.cv_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Delete('cv')
  async deleteCv(@CurrentUser() user: AuthUser, @Headers('authorization') token: string) {
    const profile = await this.db.asUser(user, (tx) => tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } }));
    if (!profile?.cv_path) throw new NotFoundException();
    const removed = await storageFetch(`object/candidate-documents/${profile.cv_path}`, token, { method: 'DELETE' });
    if (!removed.ok) throw new ServiceUnavailableException('The file could not be removed');
    await this.db.asUser(user, async (tx) => {
      await tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: null } });
      // Removing a CV takes what was read from it too.
      await tx.cv_documents.deleteMany({ where: { candidate_id: user.id } });
    });
    return { removed: true };
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      await tx.$queryRaw`select public.expire_my_overdue_attempts()`;
      return (
      tx.applications.findMany({
        where: { candidate_id: user.id },
        orderBy: { created_at: 'desc' },
        include: {
          jobs: {
            select: {
              id: true, slug: true, title_ar: true, title_en: true, is_demo: true,
              organizations: { select: { slug: true, name_ar: true, name_en: true } },
            },
          },
          assessment_attempts: {
            orderBy: { created_at: 'asc' },
            select: {
              id: true, status: true, deadline_at: true, expires_at: true, receipt_code: true,
              assessment_versions: { select: { id: true, version_number: true, duration_minutes: true, is_timed: true, assessments: { select: { title_ar: true, title_en: true } } } },
              evaluation_results: { select: { released_to_candidate: true } },
            },
          },
        },
      })
      );
    });
  }
}
