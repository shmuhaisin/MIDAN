// The employer side of organization review (supabase/migrations/20261111090000_organization_verification.sql):
// the organization's profile, its private documents, submitting for review, and the decisions so far.
// The database decides what may change and when; these routes add clear refusals on top.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { COMPANY_TYPES, PROFESSIONAL_FIELDS } from '../common/fields';
import { documentType } from '../common/file-type';
import { requireRole } from '../common/roles';
import { signedUrl, storageFetch } from '../common/storage';
import { AuthUser, DbService, Tx } from '../db/db.service';

export const DOCUMENT_KINDS = ['commercial_registration', 'authorization_letter', 'tax_certificate', 'other'] as const;
const MAX_DOCUMENT = 10 * 1024 * 1024;
const MANAGERS = ['owner', 'admin'] as const;
/** The statuses in which the organization edits its documents (private.org_documents_editable decides). */
const EDITABLE = ['draft', 'changes_requested', 'rejected'];

/** Empty strings clear a field. Each rule matches the check constraint on public.organizations. */
const nullable = (o: object, key: string) => (o as Record<string, unknown>)[key] !== null && (o as Record<string, unknown>)[key] !== '';

export class OrganizationProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name_en?: string;
  @ApiPropertyOptional({ enum: COMPANY_TYPES }) @IsOptional() @ValidateIf((o) => nullable(o, 'company_type')) @IsIn(COMPANY_TYPES) company_type?: string | null;
  @ApiPropertyOptional({ enum: PROFESSIONAL_FIELDS }) @IsOptional() @ValidateIf((o) => nullable(o, 'industry')) @IsIn(PROFESSIONAL_FIELDS) industry?: string | null;
  @ApiPropertyOptional({ description: 'Saudi commercial registration: 10 digits.' }) @IsOptional() @ValidateIf((o) => nullable(o, 'commercial_registration')) @Matches(/^[0-9]{10}$/) commercial_registration?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'website')) @Matches(/^https?:\/\/[^\s]+$/) @MaxLength(300) website?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'business_email')) @IsEmail() @MaxLength(200) business_email?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'contact_phone')) @Matches(/^\+?[0-9 ]{7,20}$/) contact_phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'city')) @IsString() @MinLength(2) @MaxLength(100) city?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'description_ar')) @IsString() @MaxLength(4000) description_ar?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'description_en')) @IsString() @MaxLength(4000) description_en?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'representative_name')) @IsString() @MinLength(2) @MaxLength(200) representative_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => nullable(o, 'representative_title')) @IsString() @MinLength(2) @MaxLength(200) representative_title?: string | null;
}

class DocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS }) @IsIn(DOCUMENT_KINDS) kind!: string;
}

export const PROFILE_FIELDS = {
  id: true, slug: true, name_ar: true, name_en: true, company_type: true, verification_status: true, verification_updated_at: true,
  commercial_registration: true, website: true, business_email: true, contact_phone: true, city: true,
  description_ar: true, description_en: true, representative_name: true, representative_title: true, is_demo: true, is_test: true, created_at: true,
} as const;

/** The profile, documents and every decision, for the organization's owners and admins (or a platform administrator). */
export async function verificationState(tx: Tx, orgId: string) {
  const [organization, branding, documents, requests] = await Promise.all([
    tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: PROFILE_FIELDS }),
    tx.organization_branding.findUnique({ where: { org_id: orgId }, select: { industry: true, logo_path: true } }),
    tx.organization_documents.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' }, select: { id: true, kind: true, file_name: true, mime_type: true, size_bytes: true, created_at: true } }),
    tx.organization_verification_requests.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' }, take: 50 }),
  ]);
  return { organization: { ...organization, industry: branding?.industry ?? null, has_logo: Boolean(branding?.logo_path) }, documents, requests };
}

@ApiTags('organization review')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId')
export class OrganizationVerificationController {
  constructor(private readonly db: DbService) {}

  @Get('verification')
  @ApiOperation({ summary: "The organization's profile, documents, review status and the decisions so far (owners and admins)." })
  state(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      return verificationState(tx, orgId);
    });
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Updates the profile. Names and the commercial registration are locked while under review, approved or suspended.' })
  updateProfile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: OrganizationProfileDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      const { industry, ...fields } = body;
      const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]));
      if (Object.keys(data).length) await tx.organizations.update({ where: { id: orgId }, data });
      if (industry !== undefined) await tx.organization_branding.updateMany({ where: { org_id: orgId }, data: { industry: industry || null } });
      return verificationState(tx, orgId);
    });
  }

  @Post('verification/documents')
  @ApiOperation({ summary: 'Adds a private document (PDF, PNG or JPEG, up to 10 MB), while the organization can be edited for review.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT } }))
  async addDocument(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') token: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: DocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      const { verification_status } = await tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { verification_status: true } });
      if (!EDITABLE.includes(verification_status)) throw new UnprocessableEntityException('Documents cannot be changed while the organization is under review or approved');
    });
    const type = file && documentType(file.buffer);
    if (!file || !type) throw new UnprocessableEntityException('Upload a PDF, PNG or JPEG file');
    const path = `${orgId}/${randomUUID()}.${type.extension}`;
    const upload = await storageFetch(`object/organization-documents/${path}`, token, { method: 'POST', headers: { 'content-type': type.mime }, body: new Uint8Array(file.buffer) });
    if (!upload.ok) throw new ServiceUnavailableException('Upload failed');
    try {
      return await this.db.asUser(user, (tx) => tx.organization_documents.create({
        data: { org_id: orgId, kind: body.kind, path, file_name: (file.originalname || `document.${type.extension}`).slice(0, 200), mime_type: type.mime, size_bytes: file.size, uploaded_by: user.id },
        select: { id: true, kind: true, file_name: true, mime_type: true, size_bytes: true, created_at: true },
      }));
    } catch (error) {
      // Refused (for example while under review): the file doesn't stay behind.
      await storageFetch(`object/organization-documents/${path}`, token, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
  }

  @Delete('verification/documents/:id')
  async removeDocument(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    const removed = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      const doc = await tx.organization_documents.findFirst({ where: { id, org_id: orgId }, select: { path: true } });
      if (!doc) throw new NotFoundException();
      const { count } = await tx.organization_documents.deleteMany({ where: { id, org_id: orgId } });
      if (count === 0) throw new UnprocessableEntityException('Documents cannot be changed while the organization is under review or approved');
      return doc.path;
    });
    await storageFetch(`object/organization-documents/${removed}`, token, { method: 'DELETE' }).catch(() => undefined);
    return { ok: true };
  }

  @Get('verification/documents/:id/url')
  async documentUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      return tx.organization_documents.findFirst({ where: { id, org_id: orgId }, select: { path: true } });
    });
    const url = doc ? await signedUrl('organization-documents', doc.path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post('verification/submit')
  @ApiOperation({ summary: 'Submits the organization for review. Refused (422) until the required profile fields and a commercial registration document are present.' })
  submit(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, [...MANAGERS]);
      await tx.$queryRaw`select id from public.submit_organization_verification(${orgId}::uuid)`;
      return verificationState(tx, orgId);
    });
  }
}
