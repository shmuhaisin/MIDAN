import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Post, Put, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl, storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

const MIN_YEAR = 1950;
const MAX_YEAR = 2100;
const CV_TYPES: Record<string, { extension: string; signature: string }> = {
  'application/pdf': { extension: 'pdf', signature: '%PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', signature: 'PK' },
};

class EducationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) institution!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) qualification!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) field?: string;
  @ApiProperty() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) start_year!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) end_year?: number | null;
}

class ExperienceDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) organization!: string;
  @ApiProperty() @IsInt() @Min(MIN_YEAR) @Max(MAX_YEAR) start_year!: number;
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
  @ApiPropertyOptional({ type: [EducationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EducationDto) education?: EducationDto[];
  @ApiPropertyOptional({ type: [ExperienceDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ExperienceDto) experience?: ExperienceDto[];
}

class SkillsDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) skill_ids!: string[];
}

function assertYears(items: { start_year: number; end_year?: number | null }[] = []) {
  if (items.some((i) => i.end_year != null && i.end_year < i.start_year)) {
    throw new BadRequestException('An end year cannot be before its start year');
  }
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService) {}

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
    const { education, experience, ...fields } = body;
    const json = {
      ...(education && { education: JSON.parse(JSON.stringify(education)) as Prisma.InputJsonValue }),
      ...(experience && { experience: JSON.parse(JSON.stringify(experience)) as Prisma.InputJsonValue }),
    };
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
    await this.db.asUser(user, (tx) => tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: path } }));
    if (profile.cv_path) await storageFetch(`object/candidate-documents/${profile.cv_path}`, token, { method: 'DELETE' });
    return { cv_path: path };
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
    await this.db.asUser(user, (tx) => tx.candidate_profiles.update({ where: { user_id: user.id }, data: { cv_path: null } }));
    return { removed: true };
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) =>
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
            select: {
              id: true, status: true,
              assessment_versions: { select: { version_number: true, duration_minutes: true } },
              evaluation_results: { select: { released_to_candidate: true } },
            },
          },
        },
      }),
    );
  }
}
