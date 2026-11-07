import { randomUUID } from 'node:crypto';
import { Body, ConflictException, Controller, Get, Headers, Logger, NotFoundException, Param, ParseUUIDPipe, Post, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl } from '../common/storage';
import { PermanentJobError } from '../jobs-queue/errors';
import { AuthUser, DbService } from '../db/db.service';

class ApprovedExperience {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) organization?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) start_year?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) end_year?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class ApprovedEducation {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) qualification!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) institution?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) field?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) start_year?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) end_year?: number;
}

class ApprovedTitled {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

/** Only what the candidate approved on the review screen. Anything left out stays as it is in their profile. */
class ApprovedLanguage {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
}

class ApplyAnalysisDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) full_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) headline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(70) years_experience?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ApprovedExperience) experience?: ApprovedExperience[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ApprovedEducation) education?: ApprovedEducation[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true }) skills?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ApprovedTitled) projects?: ApprovedTitled[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ApprovedTitled) courses?: ApprovedTitled[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ApprovedTitled) certifications?: ApprovedTitled[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ApprovedLanguage) languages?: ApprovedLanguage[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ApprovedTitled) achievements?: ApprovedTitled[];
}

const STALE_MS = 2 * 60 * 1000;
const FILE_TIMEOUT_MS = 60_000;

/**
 * Whether a queued link is a signed link to this person's own file on our Storage. Anything else is never fetched: the
 * queue can be written through the Data API, and this server can reach addresses the outside world can't.
 */
export function isOwnFileLink(link: string, userId: string) {
  try {
    const url = new URL(link);
    return url.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).origin
      && url.pathname.startsWith(`/storage/v1/object/sign/candidate-documents/${userId}/`);
  } catch {
    return false;
  }
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function merged<T>(existing: unknown, added: T[] | undefined, key: (item: T) => string): T[] | undefined {
  if (!added) return undefined;
  const current = (Array.isArray(existing) ? existing : []) as T[];
  const seen = new Set(current.map(key));
  // Existing entries are never replaced, so manual corrections survive a reanalysis.
  return [...current, ...added.filter((item) => !seen.has(key(item)))];
}

type AnalyzeResult = {
  status: 'ok' | 'blocked' | 'failed';
  code?: string;
  mode?: 'external_ai' | 'local_only';
  personal?: Prisma.InputJsonValue;
  professional?: Prisma.InputJsonValue;
  counts?: Record<string, number>;
};

@ApiTags('cv')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me/cv/analyses')
export class CvController {
  // Operational facts only. CV content and removed values are never logged.
  private readonly logger = new Logger(CvController.name);

  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  /**
   * Runs from the background queue, as the candidate. The file arrives through a short-lived signed link made when the
   * job was queued, so no session token is stored. Failures that retrying can fix are thrown; the rest are recorded.
   */
  async process(user: AuthUser, analysisId: string, fileUrl: string) {
    const finish = (data: Prisma.cv_analysesUpdateInput) =>
      this.db.asUser(user, (tx) => tx.cv_analyses.updateMany({ where: { id: analysisId, status: 'pending' }, data: { ...data, finished_at: new Date() } }));
    const pending = await this.db.asUser(user, (tx) => tx.cv_analyses.findFirst({ where: { id: analysisId, status: 'pending' }, select: { id: true } }));
    // Dismissed, or settled by an earlier attempt: nothing to do, and running it again would change nothing.
    if (!pending) return { skipped: true };
    if (!isOwnFileLink(fileUrl, user.id)) {
      await finish({ status: 'failed', failure_code: 'file_unavailable' });
      throw new PermanentJobError('file_unavailable');
    }
    const file = await fetch(fileUrl, { redirect: 'error', signal: AbortSignal.timeout(FILE_TIMEOUT_MS) }).catch(() => null);
    // Storage having a bad moment says nothing about the link, so the queue tries again. An expired link stays expired.
    if (!file || file.status >= 500 || file.status === 429) throw new Error('StorageUnavailable');
    if (!file.ok) {
      await finish({ status: 'failed', failure_code: 'file_unavailable' });
      throw new PermanentJobError('file_unavailable');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const names = await this.knownNames(user);
    // An unavailable AI service throws here, and the queue retries with a growing delay.
    const result = await this.ai.analyzeCv<AnalyzeResult>({ file_base64: bytes.toString('base64'), known_names: names });
    this.logger.log(`CV analysis ${analysisId}: ${result.status} ${result.code ?? ''} redactions=${Object.values(result.counts ?? {}).reduce((a, b) => a + b, 0)}`);
    if (result.status === 'ok') {
      await finish({ status: 'awaiting_review', mode: result.mode, personal: result.personal, professional: result.professional, redaction_counts: result.counts ?? {} });
    } else {
      await finish({ status: result.status, failure_code: result.code ?? 'analysis_failed', redaction_counts: result.counts ?? {} });
    }
    return { status: result.status };
  }

  /** Called when the queue gives up, so the candidate sees a failure instead of a spinner. */
  async markFailed(user: AuthUser, analysisId: string, code: string | null) {
    await this.db.asUser(user, (tx) => tx.cv_analyses.updateMany({
      where: { id: analysisId, status: 'pending' },
      data: { status: 'failed', failure_code: code === 'file_unavailable' ? code : 'analysis_unavailable', finished_at: new Date() },
    }));
  }

  /** Names the redaction step removes. Read when the job runs, so the queue never stores them. */
  private async knownNames(user: AuthUser) {
    const profile = await this.db.asUser(user, (tx) => tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { full_name: true } }));
    return [profile?.full_name ?? '', user.email.split('@')[0].replace(/[._\d-]+/g, ' ')].filter((n) => n.trim().length >= 3);
  }

  /** Starts the pipeline for a document: the analysis row first, then a queued job. Used after an upload and for a retry. */
  async start(user: AuthUser, token: string, documentId: string, storagePath: string) {
    const analysis = await this.db.asUser(user, (tx) => tx.cv_analyses.create({ data: { document_id: documentId, candidate_id: user.id } }));
    // Long enough for the queue's retries; a later retry from the candidate makes a fresh link.
    const fileUrl = await signedUrl('candidate-documents', storagePath, token, 30 * 60);
    if (!fileUrl) {
      await this.markFailed(user, analysis.id, 'file_unavailable');
      return { ...analysis, status: 'failed' };
    }
    await this.db.asUser(user, (tx) =>
      tx.$queryRaw`select id from public.enqueue_background_job('cv_analysis', ${analysis.id}::uuid, ${JSON.stringify({ file_url: fileUrl })}::jsonb)`);
    return analysis;
  }

  @Get('latest')
  latest(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.cv_analyses.findFirst({ where: { candidate_id: user.id }, orderBy: { created_at: 'desc' } }));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const analysis = await this.db.asUser(user, (tx) => tx.cv_analyses.findFirst({ where: { id, candidate_id: user.id } }));
    if (!analysis) throw new NotFoundException();
    return analysis;
  }

  @Post()
  @ApiOperation({ summary: 'Analyzes the current CV again, through the same privacy pipeline.' })
  async retry(@CurrentUser() user: AuthUser, @Headers('authorization') token: string) {
    const { document, running } = await this.db.asUser(user, async (tx) => ({
      document: await tx.cv_documents.findFirst({ where: { candidate_id: user.id, is_current: true } }),
      running: await tx.cv_analyses.findFirst({ where: { candidate_id: user.id, status: 'pending', created_at: { gte: new Date(Date.now() - STALE_MS) } }, select: { id: true } }),
    }));
    if (!document) throw new NotFoundException();
    if (running) throw new ConflictException('An analysis is already running');
    return this.start(user, token, document.id, document.storage_path);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: "Saves what the candidate approved. Nothing from an analysis reaches the profile any other way." })
  apply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplyAnalysisDto) {
    return this.db.asUser(user, async (tx) => {
      const analysis = await tx.cv_analyses.findFirst({ where: { id, candidate_id: user.id }, select: { status: true } });
      if (!analysis) throw new NotFoundException();
      if (analysis.status !== 'awaiting_review') throw new UnprocessableEntityException('This analysis is not waiting for review');
      const profile = await tx.candidate_profiles.findUniqueOrThrow({ where: { user_id: user.id } });
      const { experience, education, skills, projects, courses, certifications, languages, achievements, ...fields } = body;
      const lists = {
        experience: merged(profile.experience, experience, (e) => `${e.title}|${e.organization ?? ''}`),
        education: merged(profile.education, education, (e) => `${e.qualification}|${e.institution ?? ''}`),
        projects: merged(profile.projects, projects, (e) => e.title),
        courses: merged(profile.courses, courses, (e) => e.title),
        certifications: merged(profile.certifications, certifications, (e) => e.title),
        self_reported_skills: merged(profile.self_reported_skills, skills, (e) => e),
        languages: merged(profile.languages, languages, (e) => e.name.trim().toLowerCase()),
        achievements: merged(profile.achievements, achievements, (e) => e.title),
      };
      const data = Object.fromEntries(Object.entries(lists).filter(([, v]) => v !== undefined).map(([k, v]) => [k, json(v)]));
      await tx.candidate_profiles.update({ where: { user_id: user.id }, data: { ...fields, ...data } });
      // What wasn't approved shouldn't linger.
      return tx.cv_analyses.update({ where: { id }, data: { status: 'applied', reviewed_at: new Date(), personal: Prisma.DbNull, professional: Prisma.DbNull } });
    });
  }

  @Post(':id/dismiss')
  dismiss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.cv_analyses.updateMany({
        where: { id, candidate_id: user.id, status: { in: ['awaiting_review', 'failed', 'blocked'] } },
        data: { status: 'dismissed', reviewed_at: new Date(), personal: Prisma.DbNull, professional: Prisma.DbNull },
      });
      if (count === 0) throw new NotFoundException();
      return { dismissed: true };
    });
  }
}

export const newCvPath = (userId: string, extension: string) => `${userId}/cv-${randomUUID()}.${extension}`;
