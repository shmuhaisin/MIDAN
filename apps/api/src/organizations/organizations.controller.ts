import { withApplicantName } from '../common/applicant';
import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { job_status } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { COMPANY_TYPES, PROFESSIONAL_FIELDS } from '../common/fields';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';
import { type BrandPalette, extractPalette, PALETTE_VERSION, themesFor, withCurrentThemes } from './brand-palette';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class CreateOrganizationDto {
  @ApiProperty() @IsString() @Matches(SLUG) @MaxLength(80) slug!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name_ar!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name_en!: string;
}

class CreateJobDto {
  /** Optional: when left out, one is made from the English title. Employers aren't asked for it. */
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(SLUG) @MaxLength(80) slug?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title_ar!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title_en!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) description_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) description_en?: string;
  @ApiPropertyOptional({ enum: job_status }) @IsOptional() @IsEnum(job_status) status?: job_status;
}

/** A job's address from its English title, with a random ending so two jobs with the same title don't collide. */
export function jobSlug(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${base || 'job'}-${randomBytes(3).toString('hex')}`;
}

class BrandingDto {
  @ApiPropertyOptional({ enum: PROFESSIONAL_FIELDS }) @IsOptional() @IsIn(PROFESSIONAL_FIELDS) industry?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) primary_color?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) accent_color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) welcome_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) welcome_en?: string;
}

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
class ApprovePaletteDto {
  @ApiPropertyOptional() @IsOptional() @Matches(HEX_COLOUR) primary?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.secondary !== null) @Matches(HEX_COLOUR) secondary?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.accent !== null) @Matches(HEX_COLOUR) accent?: string | null;
}

/** The colours a person chose, each one of the logo's own; anything else is refused. Unset choices keep the suggestion. */
function chooseFromLogo(suggested: BrandPalette, body: ApprovePaletteDto) {
  const fromLogo = new Set([suggested.primary, suggested.secondary, suggested.accent, ...suggested.swatches.map((s) => s.hex)].filter(Boolean).map((h) => h!.toLowerCase()));
  for (const chosen of [body.primary, body.secondary, body.accent]) {
    if (chosen && !fromLogo.has(chosen.toLowerCase())) throw new UnprocessableEntityException('Choose colours from the logo');
  }
  return {
    primary: (body.primary ?? suggested.primary).toLowerCase(),
    secondary: body.secondary === undefined ? suggested.secondary : body.secondary?.toLowerCase() ?? null,
    accent: body.accent === undefined ? suggested.accent : body.accent?.toLowerCase() ?? null,
  };
}

/** The logo's palette, or why it couldn't be read: an unreadable image never blocks saving the logo itself. */
async function readPalette(image: Buffer): Promise<{ palette?: BrandPalette; error?: string }> {
  try {
    return { palette: await extractPalette(image) };
  } catch (error) {
    return { error: error instanceof Error && /no visible mark/.test(error.message) ? error.message : 'The logo’s colours could not be read' };
  }
}

class CompanyTypeDto {
  @ApiProperty({ enum: COMPANY_TYPES, nullable: true }) @ValidateIf((o) => o.company_type !== null) @IsIn(COMPANY_TYPES) company_type!: string | null;
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
  @ApiPropertyOptional() @ValidateIf((o) => o.sector !== null) @IsOptional() @IsIn(['digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail', 'other']) sector?: string | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.experience_level !== null) @IsOptional() @IsIn(['entry', 'junior', 'mid', 'senior', 'lead']) experience_level?: string | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.employment_type !== null) @IsOptional() @IsIn(['full_time', 'part_time', 'contract', 'temporary', 'internship', 'flexible']) employment_type?: string | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.salary_min !== null) @IsOptional() @IsNumber() @Min(0) salary_min?: number | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.salary_max !== null) @IsOptional() @IsNumber() @Min(0) salary_max?: number | null;
  @ApiPropertyOptional() @ValidateIf((o) => o.application_deadline !== null) @IsOptional() @IsISO8601({ strict: true }) application_deadline?: string | null;
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
      const branding = await tx.organization_branding.findUnique({ where: { org_id: orgId } });
      return { ...organization, my_role: member.role, branding: withCurrentThemes(branding) };
    });
  }

  /** The company's type. MIDAN's assessment generation receives it with the job's sector and level; the company's name is never sent. */
  @Patch(':orgId/company-type')
  updateCompanyType(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: CompanyTypeDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const { count } = await tx.organizations.updateMany({ where: { id: orgId }, data: { company_type: body.company_type } });
      if (count === 0) throw new NotFoundException();
      return tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, company_type: true } });
    });
  }

  @Patch(':orgId/branding')
  updateBranding(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: BrandingDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const { count } = await tx.organization_branding.updateMany({ where: { org_id: orgId }, data: body });
      if (count === 0) throw new NotFoundException();
      return tx.organization_branding.findUniqueOrThrow({ where: { org_id: orgId } });
    });
  }

  @Post(':orgId/branding/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') token: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file?.mimetype ?? ''];
    if (!file || !extension) throw new UnprocessableEntityException('Upload a PNG, JPEG or WebP image');
    await this.db.asUser(user, (tx) => requireRole(tx, user, orgId, ['owner', 'admin']));
    const path = `${orgId}/logo-${Date.now()}.${extension}`;
    const upload = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/organization-assets/${path}`, {
      method: 'POST',
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', authorization: token, 'content-type': file.mimetype },
      body: new Uint8Array(file.buffer),
    });
    if (!upload.ok) throw new ServiceUnavailableException('Upload failed');
    // The logo's colours become a suggested identity at once; the workspace keeps its approved colours until an owner
    // or admin approves the new ones. A logo whose colours can't be read is still saved, and the reason is returned.
    const read = await readPalette(file.buffer);
    const saved = await this.db.asUser(user, (tx) =>
      tx.organization_branding.update({
        where: { org_id: orgId },
        data: { logo_path: path, ...(read.palette && { palette: read.palette as object, palette_status: 'suggested', palette_logo_path: path }) },
      }),
    );
    return { ...saved, palette_error: read.error ?? null };
  }

  /** Reads the colours of the logo already uploaded again, for a logo saved before extraction existed or after a fix. */
  @Post(':orgId/branding/palette/extract')
  async extractBrandPalette(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    const branding = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      return tx.organization_branding.findUnique({ where: { org_id: orgId } });
    });
    if (!branding?.logo_path) throw new UnprocessableEntityException('Upload a logo first');
    const image = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/organization-assets/${branding.logo_path}`).catch(() => null);
    if (!image?.ok) throw new ServiceUnavailableException('The logo could not be read from storage');
    const read = await readPalette(Buffer.from(await image.arrayBuffer()));
    if (!read.palette) throw new UnprocessableEntityException(read.error);
    return this.db.asUser(user, (tx) =>
      tx.organization_branding.update({ where: { org_id: orgId }, data: { palette: read.palette as object, palette_status: 'suggested', palette_logo_path: branding.logo_path } }),
    );
  }

  /** The light and dark themes a choice of the logo's colours would give, for the live preview. Saves nothing. */
  @Post(':orgId/branding/palette/preview')
  previewBrandPalette(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: ApprovePaletteDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const branding = await tx.organization_branding.findUnique({ where: { org_id: orgId } });
      const suggested = branding?.palette as BrandPalette | null;
      if (!suggested || suggested.version !== PALETTE_VERSION) throw new UnprocessableEntityException('There is no identity read from the logo');
      const choice = chooseFromLogo(suggested, body);
      return { ...choice, ...themesFor(choice.primary, choice.accent) };
    });
  }

  /**
   * Approves the identity read from the logo, as suggested or with other colours chosen from the logo's own swatches.
   * The approved colours then theme the workspace, the job posting and the assessments.
   */
  @Post(':orgId/branding/palette/approve')
  approveBrandPalette(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: ApprovePaletteDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const branding = await tx.organization_branding.findUnique({ where: { org_id: orgId } });
      const suggested = branding?.palette as BrandPalette | null;
      if (!branding || !suggested || suggested.version !== PALETTE_VERSION) throw new UnprocessableEntityException('There is no identity read from the logo to approve');
      const { primary, secondary, accent } = chooseFromLogo(suggested, body);
      const palette: BrandPalette = { ...suggested, primary, secondary, accent, ...themesFor(primary, accent) };
      return tx.organization_branding.update({
        where: { org_id: orgId },
        data: {
          palette: palette as object, applied_palette: palette as object, palette_status: 'approved', palette_approved_at: new Date(), palette_approved_by: user.id,
          primary_color: primary, secondary_color: secondary, accent_color: accent ?? secondary ?? primary,
        },
      });
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
        data: { ...body, slug: body.slug ?? jobSlug(body.title_en), org_id: orgId, published_at: body.status === 'published' ? new Date() : null },
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
          job_reference_skills: { select: { is_required: true, required_level: true, reference_skills: { select: { id: true, name_ar: true, sector_code: true } } } },
          applications: {
            where: { status: { not: 'withdrawn' } },
            orderBy: { created_at: 'desc' },
            include: {
              users: { select: { email: true } },
              assessment_attempts: {
                orderBy: { created_at: 'asc' },
                select: {
                  id: true, status: true,
                  assessment_versions: { select: { id: true, version_number: true, assessment_id: true, assessments: { select: { title_ar: true, title_en: true } } } },
                  evaluation_results: { select: { id: true, status: true, released_to_candidate: true } },
                },
              },
            },
          },
        },
      });
      if (!job) throw new NotFoundException();
      return { ...job, applications: job.applications.map(withApplicantName) };
    });
  }

  @Patch(':orgId/jobs/:jobId')
  updateJob(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() { skills, ...fields }: UpdateJobDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin', 'recruiter']);
      const { application_deadline, ...rest } = fields;
      const data = {
        ...rest,
        ...(application_deadline !== undefined && { application_deadline: application_deadline ? new Date(application_deadline) : null }),
      };
      // An update with only skills has no job fields to write (the DTO's other fields are present but undefined), and
      // Prisma reports no rows for an update that writes nothing.
      const { count } = Object.values(data).some((v) => v !== undefined)
        ? await tx.jobs.updateMany({ where: { id: jobId, org_id: orgId }, data })
        : { count: await tx.jobs.count({ where: { id: jobId, org_id: orgId } }) };
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
      const applications = await tx.applications.findMany({
        where: { org_id: orgId, status: { not: 'withdrawn' } },
        orderBy: { created_at: 'desc' },
        include: {
          jobs: { select: { id: true, title_ar: true, title_en: true } },
          users: { select: { id: true, email: true } },
        },
      });
      return applications.map(withApplicantName);
    });
  }
}
