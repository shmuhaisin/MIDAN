import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { signedUrl, storageFetch } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';

class ClaimDto {
  @ApiProperty() @IsUUID() registry_id!: string;
  @ApiProperty({ description: "The requester's role at the employer." }) @IsString() @MinLength(2) @MaxLength(200) role_title!: string;
  @ApiProperty({ description: 'Why this organization may manage the employer, and how that can be checked.' }) @IsString() @MinLength(10) @MaxLength(4000) evidence_note!: string;
}

/** The file's own first bytes decide its type, not what the upload says it is. */
function evidenceType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { extension: 'pdf', mime: 'application/pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: 'png', mime: 'image/png' };
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: 'jpg', mime: 'image/jpeg' };
  return null;
}

@ApiTags('employer claims')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/employer-claims')
export class EmployerClaimsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: "This organization's claims to manage an employer, newest first, and the employer it manages, if any." })
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const claims = await tx.$queryRaw`
        select c.id, c.registry_id, c.role_title, c.evidence_note, c.evidence_path is not null as has_evidence, c.status, c.review_note, c.reviewed_at, c.created_at,
          e.name_ar as employer_name_ar, e.name_en as employer_name_en, e.source_company_id
        from public.employer_claims c join public.employer_registry e on e.id = c.registry_id where c.org_id = ${orgId}::uuid order by c.created_at desc limit 20`;
      const organization = await tx.organizations.findUniqueOrThrow({
        where: { id: orgId },
        select: { is_demo: true, employer_registry: { select: { id: true, name_ar: true, name_en: true, source_company_id: true, partnership_status: true } } },
      });
      return { claims, employer: organization.employer_registry, is_demo: organization.is_demo };
    });
  }

  @Post()
  @ApiOperation({ summary: 'Asks to manage an employer, with evidence for a platform administrator to check. Nothing is granted automatically.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async submit(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') token: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ClaimDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.db.asUser(user, (tx) => requireRole(tx, user, orgId, ['owner', 'admin']));
    let path: string | null = null;
    if (file) {
      const type = evidenceType(file.buffer);
      if (!type) throw new UnprocessableEntityException('Upload a PDF, PNG or JPEG file');
      path = `${orgId}/${randomUUID()}.${type.extension}`;
      const upload = await storageFetch(`object/employer-claims/${path}`, token, { method: 'POST', headers: { 'content-type': type.mime }, body: new Uint8Array(file.buffer) });
      if (!upload.ok) throw new ServiceUnavailableException('Upload failed');
    }
    try {
      const [claim] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ id: string; status: string; email_domain_matches: boolean }[]>`
        select id, status, email_domain_matches from public.submit_employer_claim(${orgId}::uuid, ${body.registry_id}::uuid, ${body.role_title}, ${body.evidence_note}, ${path})`);
      return claim;
    } catch (error) {
      // A refused claim leaves no evidence behind. Storage policies keep it from being removed by mistake elsewhere.
      if (path) await storageFetch(`object/employer-claims/${path}`, token, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const [claim] = await tx.$queryRaw<unknown[]>`select id, status from public.withdraw_employer_claim(${id}::uuid)`;
      return claim;
    });
  }

  @Get(':id/evidence-url')
  async evidence(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    const [claim] = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      return tx.$queryRaw<{ evidence_path: string | null }[]>`select evidence_path from public.employer_claims where id = ${id}::uuid and org_id = ${orgId}::uuid`;
    });
    const url = claim?.evidence_path ? await signedUrl('employer-claims', claim.evidence_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }
}
