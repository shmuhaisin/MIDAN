import { Body, CanActivate, ConflictException, Controller, ExecutionContext, ForbiddenException, Get, Headers, Injectable, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { Request } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';
import { integrationStatus } from './integrations';
import { LISTING_SOURCE_TYPES, ListingFileError, ListingRow, parseListingFile } from './listing-file';

/** Runs after AuthGuard. The database decides, as the caller: private.platform_admins is the only list. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly db: DbService) {}
  async canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) return false;
    const [row] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ ok: boolean }[]>`select public.am_platform_admin() as ok`);
    if (!row?.ok) throw new ForbiddenException();
    return true;
  }
}

class ResolveDto {
  @ApiProperty({ enum: ['accepted', 'dismissed'] }) @IsIn(['accepted', 'dismissed']) resolution!: 'accepted' | 'dismissed';
}
class AliasDto {
  @ApiProperty() @IsString() @MaxLength(300) name!: string;
  @ApiProperty({ enum: ['ar', 'en'] }) @IsIn(['ar', 'en']) language!: 'ar' | 'en';
}
class ListingUploadDto {
  @ApiProperty({ enum: LISTING_SOURCE_TYPES }) @IsIn(LISTING_SOURCE_TYPES) source_type!: string;
  @ApiProperty({ description: 'Who the records came from.' }) @IsString() @MinLength(2) @MaxLength(200) source_name!: string;
  @ApiProperty({ description: 'What permits using them. Kept with the import.' }) @IsString() @MinLength(5) @MaxLength(1000) authorization_note!: string;
  @ApiPropertyOptional({ description: 'When saving: the file the preview was made from.' }) @IsOptional() @IsString() @MaxLength(100) preview_sha256?: string;
}

class ClaimReviewDto {
  @ApiProperty({ enum: ['approved', 'rejected'] }) @IsIn(['approved', 'rejected']) decision!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class ListingReviewDto {
  @ApiProperty({ enum: ['confirm_employer', 'reject_employer', 'approve', 'reject', 'publish', 'unpublish', 'not_duplicate'] })
  @IsIn(['confirm_employer', 'reject_employer', 'approve', 'reject', 'publish', 'unpublish', 'not_duplicate']) action!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() registry_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class AdminDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsBoolean() grant!: boolean;
}
class EmployerLinkDto {
  @ApiPropertyOptional({ nullable: true, description: 'The registry entity this organization account is, or null to remove the link.' })
  @IsOptional() @IsUUID() registry_id?: string | null;
}
class ResourceDto {
  @ApiProperty({ enum: ['course', 'certification'] }) @IsIn(['course', 'certification']) kind!: 'course' | 'certification';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title_en?: string;
  @ApiProperty() @IsString() @MaxLength(120) provider!: string;
  @ApiProperty() @Matches(/^https:\/\/[^\s]+$/) @MaxLength(1000) url!: string;
  @ApiProperty({ description: 'The date a person opened the link and checked the details shown.' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) verified_on!: string;
  @ApiProperty() @IsUUID() reference_skill_id!: string;
}

const MAX_LISTING_FILE = 5 * 1024 * 1024;
const STATUSES = ['imported', 'updated', 'unchanged', 'duplicate', 'rejected', 'ambiguous', 'warning'];

@ApiTags('administration')
@ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly db: DbService) {}

  @Get('session')
  @ApiOperation({ summary: 'Whether the caller is a platform administrator: 200 if so, 403 otherwise (the guards decide). Reveals no data.' })
  session() {
    return { ok: true };
  }

  @Get('overview')
  @ApiOperation({ summary: 'Counts and integration status. Counts come from the database; integrations say only whether they are configured.' })
  async overview(@CurrentUser() user: AuthUser) {
    const [counts] = await this.db.asUser(user, (tx) => tx.$queryRaw<Record<string, number>[]>`
      select
        (select count(*)::int from public.users) as users,
        (select count(*)::int from public.organizations where not is_test and not is_demo) as organizations,
        (select count(*)::int from public.organizations where is_test) as test_organizations,
        (select count(*)::int from public.organizations where verification_status = 'pending_review') as organizations_pending_review,
        (select count(*)::int from public.organizations where verification_status = 'changes_requested') as organizations_changes_requested,
        (select count(*)::int from public.organizations where verification_status = 'approved') as organizations_approved,
        (select count(*)::int from public.organizations where verification_status = 'rejected') as organizations_rejected,
        (select count(*)::int from public.organizations where verification_status = 'suspended') as organizations_suspended,
        (select count(*)::int from public.organizations where verification_status = 'draft') as organizations_draft,
        (select count(*)::int from public.candidate_profiles) as candidates,
        (select count(*)::int from public.applications a join public.jobs j on j.id = a.job_id where not j.is_demo) as applications,
        (select count(*)::int from public.applications a join public.jobs j on j.id = a.job_id where not j.is_demo and a.created_at > now() - interval '7 days') as applications_last_7_days,
        (select count(*)::int from public.interviews where scheduled_at > now()) as upcoming_interviews,
        (select count(*)::int from public.jobs where status = 'published' and not is_demo) as published_jobs,
        (select count(*)::int from public.reference_skills) as reference_skills,
        (select count(*)::int from public.employer_registry) as employers,
        (select count(*)::int from public.import_runs) as import_runs,
        (select count(*)::int from public.import_runs where status = 'failed') as failed_imports,
        (select count(*)::int from public.import_records where review_status = 'open') as open_review_items,
        (select count(*)::int from public.external_job_listings) as external_listings,
        (select count(*)::int from public.external_job_listings where review_status = 'pending') as listings_pending_review,
        (select count(*)::int from public.external_job_listings where match_status = 'uncertain') as uncertain_matches,
        (select count(*)::int from public.background_jobs where status = 'failed') as failed_jobs,
        (select count(*)::int from public.learning_resources) as learning_resources`);
    return { counts, integrations: await integrationStatus() };
  }

  @Get('imports')
  imports(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select id, kind, status, sources, stats, started_by, started_at, finished_at, failure from public.import_runs order by started_at desc limit 100`);
  }

  @Get('imports/:id')
  async importRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string, @Query('issue') issue?: string) {
    const filter = status && STATUSES.includes(status) ? status : null;
    return this.db.asUser(user, async (tx) => {
      const [run] = await tx.$queryRaw<unknown[]>`select * from public.import_runs where id = ${id}::uuid`;
      if (!run) throw new ForbiddenException();
      const records = await tx.$queryRaw`
        select id, entity, source_file, source_sheet, source_row, original_value, normalized_value, status, issue_kind, detail, target_id, review_status, reviewed_at
        from public.import_records where run_id = ${id}::uuid
          and (${filter}::text is null or status = ${filter}) and (${issue ?? null}::text is null or issue_kind = ${issue ?? null})
          and (${filter}::text is not null or ${issue ?? null}::text is not null or status not in ('unchanged'))
        order by (status in ('rejected', 'ambiguous', 'duplicate')) desc, id limit 300`;
      return { run, records };
    });
  }

  @Get('review')
  @ApiOperation({ summary: 'Everything waiting for a person: ambiguous or rejected import records, and listings with uncertain matches.' })
  review(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => ({
      records: await tx.$queryRaw`
        select r.id, r.run_id, k.kind, r.entity, r.source_file, r.source_sheet, r.source_row, r.original_value, r.status, r.issue_kind, r.detail, r.target_id, r.created_at
        from public.import_records r join public.import_runs k on k.id = r.run_id
        where r.review_status = 'open'
          -- A later run of the same kind supersedes an earlier one's open items for the same source row.
          and k.id = (select id from public.import_runs x where x.kind = k.kind and x.status = 'completed' order by started_at desc limit 1)
        order by r.issue_kind, r.source_file, r.source_row limit 500`,
      listings: await this.listingRows(tx, 'pending'),
    }));
  }

  @Post('import-records/:id/resolve')
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: ResolveDto) {
    await this.db.asUser(user, (tx) => tx.$executeRaw`select public.admin_resolve_import_record(${id}::bigint, ${body.resolution})`);
    return { ok: true };
  }

  @Get('employers')
  employers(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select e.*, public.employer_brand_usable(e) as brand_usable,
        coalesce((select jsonb_agg(jsonb_build_object('name_variant', a.name_variant, 'language', a.language, 'alias_status', a.alias_status, 'source_row', a.source_row,
          'added_by_admin', a.added_by is not null) order by a.name_variant) from public.employer_aliases a where a.registry_id = e.id), '[]') as aliases,
        coalesce((select jsonb_agg(jsonb_build_object('source_url', s.source_url, 'source_type', s.source_type, 'checked_on', s.checked_on, 'source_row', s.source_row))
          from public.employer_sources s where s.registry_id = e.id), '[]') as sources,
        (select count(*)::int from public.external_job_listings l where l.employer_registry_id = e.id) as listings
      from public.employer_registry e order by e.source_company_id`);
  }

  @Post('employers/:id/aliases')
  addAlias(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: AliasDto) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`select * from public.admin_add_employer_alias(${id}::uuid, ${body.name}, ${body.language})`);
  }

  @Get('listings')
  listings(@CurrentUser() user: AuthUser, @Query('review') review?: string) {
    return this.db.asUser(user, (tx) => this.listingRows(tx, ['pending', 'approved', 'rejected'].includes(review ?? '') ? review! : null));
  }

  @Post('listings/preview')
  @ApiOperation({ summary: 'Reads a CSV or JSON file of authorized job records and says what importing it would do. Saves nothing.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LISTING_FILE } }))
  async previewListings(@CurrentUser() user: AuthUser, @Body() body: ListingUploadDto, @UploadedFile() file?: Express.Multer.File) {
    const { name, sha256, parsed, valid, invalid } = this.readListings(file, body);
    const results = await this.previewRows(user, body, valid, name);
    const rows = [
      ...invalid.map((r) => ({ row: r.row, title: r.record.job_title ?? null, employer: r.record.employer_name ?? null, status: 'invalid', errors: r.errors, warnings: r.warnings })),
      ...results.map((r) => ({ ...r, errors: [], warnings: valid.find((v) => v.row === r.row)?.warnings ?? [] })),
    ].sort((a, b) => a.row - b.row);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      file: name, sha256, format: parsed.format, total: rows.length, counts, can_import: valid.length > 0, unknown_columns: parsed.unknown_columns, missing_columns: parsed.missing_columns,
      // A long file is summarized by its counts; the problem rows come first so they're seen.
      rows: [...rows.filter((r) => r.status === 'invalid'), ...rows.filter((r) => r.status !== 'invalid')].slice(0, 300),
    };
  }

  @Post('listings/import')
  @ApiOperation({ summary: 'Saves a file that was previewed, as a recorded import. Nothing is published, and every record waits for review.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LISTING_FILE } }))
  async importListings(@CurrentUser() user: AuthUser, @Body() body: ListingUploadDto, @UploadedFile() file?: Express.Multer.File) {
    const { name, sha256, parsed, valid, invalid } = this.readListings(file, body);
    if (body.preview_sha256 !== sha256) throw new ConflictException('Preview this file before saving it');
    if (valid.length === 0) throw new UnprocessableEntityException('This file has no valid records');
    const previewed = await this.previewRows(user, body, valid, name);
    const repeated = new Set(previewed.filter((r) => r.status === 'duplicate_in_file').map((r) => r.row));
    const toSave = valid.filter((r) => !repeated.has(r.row));
    const issues = [
      ...invalid.map((r) => ({ kind: 'malformed_record', source_file: name, source_row: r.row, value: r.record.job_title ?? '', detail: r.errors.join(', ') })),
      ...valid.filter((r) => repeated.has(r.row)).map((r) => ({ kind: 'duplicate_row', source_file: name, source_row: r.row, value: r.record.job_title ?? '', detail: 'repeated in this file; the first was kept' })),
    ];
    const sources = [{ file: name, sha256, format: parsed.format, rows: parsed.rows.length, source_type: body.source_type, source_name: body.source_name, authorization_note: body.authorization_note }];
    const [row] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ result: { run_id: string; counts: Record<string, number> } }[]>`
      select public.admin_import_listings(${body.source_type}, ${JSON.stringify(sources)}::jsonb, ${JSON.stringify(toSave.map((r) => this.importRow(r, name, body)))}::jsonb, ${JSON.stringify(issues)}::jsonb) as result`);
    return { ...row.result, rejected: invalid.length, repeated: repeated.size };
  }

  private readListings(file: Express.Multer.File | undefined, body: ListingUploadDto) {
    if (!file) throw new UnprocessableEntityException('Choose a CSV or JSON file');
    // A browser sends a non-ASCII file name as Latin-1 bytes. It's only a label, kept in the import's record.
    const name = basename(Buffer.from(file.originalname, 'latin1').toString('utf8')).slice(0, 200);
    let parsed;
    try {
      parsed = parseListingFile(file.buffer, name);
    } catch (error) {
      if (error instanceof ListingFileError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
    const sha256 = createHash('sha256').update(file.buffer).update(`|${body.source_type}|${body.source_name}`).digest('hex');
    return { name, sha256, parsed, valid: parsed.rows.filter((r) => r.errors.length === 0), invalid: parsed.rows.filter((r) => r.errors.length > 0) };
  }

  private importRow(r: ListingRow, file: string, body: ListingUploadDto) {
    return { ...r.record, source_name: body.source_name, source_file: file, source_row: r.row };
  }

  private async previewRows(user: AuthUser, body: ListingUploadDto, rows: ListingRow[], file: string) {
    if (rows.length === 0) return [];
    // The same shape as the import, so "unchanged" means what it says.
    const payload = rows.map((r) => this.importRow(r, file, body));
    const [row] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ result: { row: number; status: string; title: string | null; employer: string | null }[] }[]>`
      select public.admin_preview_listings(${body.source_type}, ${JSON.stringify(payload)}::jsonb) as result`);
    return row.result;
  }

  @Post('listings/:id/convert')
  @ApiOperation({ summary: "Turns an approved record into a draft job of the organization that manages its employer. It isn't published." })
  convertListing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.convert_listing_to_job(${id}::uuid)`;
      return row;
    });
  }

  @Get('employer-claims')
  @ApiOperation({ summary: 'Claims to manage an employer, with their evidence, newest first.' })
  employerClaims(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select c.id, c.org_id, c.registry_id, c.role_title, c.evidence_note, c.evidence_path is not null as has_evidence, c.email_domain_matches, c.status, c.review_note, c.reviewed_at, c.created_at,
        o.name_ar as org_name_ar, o.name_en as org_name_en, o.is_test, e.name_ar as employer_name_ar, e.name_en as employer_name_en, e.source_company_id, e.official_website,
        u.email as requested_by_email
      from public.employer_claims c join public.organizations o on o.id = c.org_id join public.employer_registry e on e.id = c.registry_id
      left join public.users u on u.id = c.requested_by
      where (${status ?? null}::text is null or c.status = ${status ?? null}) order by (c.status = 'pending') desc, c.created_at desc limit 200`);
  }

  @Get('employer-claims/:id/evidence-url')
  async claimEvidence(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const [claim] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ evidence_path: string | null }[]>`select evidence_path from public.employer_claims where id = ${id}::uuid`);
    const url = claim?.evidence_path ? await signedUrl('employer-claims', claim.evidence_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post('employer-claims/:id/review')
  @ApiOperation({ summary: 'A person decides. Approval links the account to the employer. It never changes the employer record or claims a partnership.' })
  reviewClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ClaimReviewDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_review_employer_claim(${id}::uuid, ${body.decision}, ${body.note ?? null})`;
      return row;
    });
  }

  @Post('listings/:id/review')
  reviewListing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ListingReviewDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_review_listing(${id}::uuid, ${body.action}, ${body.registry_id ?? null}::uuid, ${body.note ?? null})`;
      return row;
    });
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Organizations, waiting reviews first. Filters: status (review status) and q (name, slug or commercial registration).' })
  organizations(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('q') q?: string) {
    const needle = q?.trim().toLowerCase().slice(0, 100) || null;
    const wanted = status && ['draft', 'pending_review', 'changes_requested', 'rejected', 'approved', 'suspended'].includes(status) ? status : null;
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select o.id, o.slug, o.name_ar, o.name_en, o.is_demo, o.is_test, o.created_at, o.employer_registry_id,
        o.verification_status, o.verification_updated_at, o.commercial_registration, o.city, o.company_type,
        (select r.created_at from public.organization_verification_requests r where r.org_id = o.id order by r.created_at desc limit 1) as last_submitted_at,
        (select count(*)::int from public.organization_verification_requests r where r.org_id = o.id) as submissions,
        (select e.source_company_id from public.employer_registry e where e.id = o.employer_registry_id) as employer_company_id,
        (select count(*)::int from public.organization_members m where m.org_id = o.id) as members,
        (select count(*)::int from public.jobs j where j.org_id = o.id) as jobs,
        (select count(*)::int from public.jobs j where j.org_id = o.id and j.status = 'published') as published_jobs
      from public.organizations o
      where (${wanted}::text is null or o.verification_status = ${wanted})
        and (${needle}::text is null or lower(o.name_en) like '%' || ${needle} || '%' or o.name_ar like '%' || ${needle} || '%'
          or o.slug like '%' || ${needle} || '%' or coalesce(o.commercial_registration, '') like '%' || ${needle} || '%')
      order by (o.verification_status = 'pending_review') desc, o.is_test, coalesce(o.verification_updated_at, o.created_at) desc limit 500`);
  }

  @Post('organizations/:id/employer')
  @ApiOperation({ summary: 'Confirms an organization account as one official registry entity, after a person has checked it. Never a partnership.' })
  linkEmployer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: EmployerLinkDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_link_organization_employer(${id}::uuid, ${body.registry_id ?? null}::uuid)`;
      return row;
    });
  }

  @Get('users')
  @ApiOperation({ summary: 'Accounts and their roles. No profile, CV or assessment content.' })
  users(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    const needle = q?.trim().toLowerCase().slice(0, 100) || null;
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select u.id, u.email, u.display_name, u.created_at,
        coalesce((select jsonb_agg(jsonb_build_object('org_id', m.org_id, 'role', m.role, 'name_en', o.name_en, 'name_ar', o.name_ar))
          from public.organization_members m join public.organizations o on o.id = m.org_id where m.user_id = u.id), '[]') as memberships,
        exists (select 1 from public.admin_list_platform_admins() a where a.user_id = u.id) as platform_admin
      from public.users u
      where ${needle}::text is null or lower(u.email) like '%' || ${needle} || '%' or lower(coalesce(u.display_name, '')) like '%' || ${needle} || '%'
      order by u.created_at desc limit 200`);
  }

  @Get('admins')
  admins(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`select * from public.admin_list_platform_admins()`);
  }

  @Post('admins')
  async setAdmin(@CurrentUser() user: AuthUser, @Body() body: AdminDto) {
    await this.db.asUser(user, (tx) => tx.$executeRaw`select public.admin_set_platform_admin(${body.email}, ${body.grant})`);
    return { ok: true };
  }

  @Get('audit')
  audit(@CurrentUser() user: AuthUser, @Query('entity') entity?: string, @Query('before') before?: string) {
    const cursor = before && /^\d+$/.test(before) ? BigInt(before) : null;
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select l.id, l.org_id, l.actor_id, u.email as actor_email, l.action, l.entity, l.entity_id, l.details, l.created_at
      from public.audit_logs l left join public.users u on u.id = l.actor_id
      where (${entity ?? null}::text is null or l.entity = ${entity ?? null}) and (${cursor}::bigint is null or l.id < ${cursor})
      order by l.id desc limit 200`);
  }

  @Get('reference')
  @ApiOperation({ summary: 'The sector skills reference, summarized by sector, with its lineage.' })
  reference(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select s.sector_code,
        count(*) filter (where s.skill_kind = 'technical')::int as technical,
        count(*) filter (where s.skill_kind = 'general')::int as general,
        count(*) filter (where s.is_priority)::int as priority_flagged,
        count(*) filter (where s.priority_listed)::int as priority_listed,
        count(*) filter (where s.description_ar is null)::int as without_description,
        (select count(*)::int from public.reference_skill_contexts c join public.reference_skills x on x.id = c.skill_id where x.sector_code = s.sector_code) as contexts,
        (select count(distinct c.subsector_ar)::int from public.reference_skill_contexts c join public.reference_skills x on x.id = c.skill_id where x.sector_code = s.sector_code) as subsectors,
        (select count(distinct c.job_family_ar)::int from public.reference_skill_contexts c join public.reference_skills x on x.id = c.skill_id where x.sector_code = s.sector_code) as job_families,
        min(s.source_file) as source_file
      from public.reference_skills s group by s.sector_code order by s.sector_code`);
  }

  @Get('learning-resources')
  resources(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select r.*, s.name_ar as skill_name_ar, s.sector_code from public.learning_resources r left join public.reference_skills s on s.id = r.reference_skill_id
      order by r.created_at desc`);
  }

  @Post('learning-resources')
  @ApiOperation({ summary: 'Adds a course or certification a person has checked. Without a checked link and date it is refused.' })
  addResource(@CurrentUser() user: AuthUser, @Body() body: ResourceDto) {
    if (!body.title_ar && !body.title_en) throw new ForbiddenException('A title is needed');
    return this.db.asUser(user, (tx) => tx.learning_resources.create({
      data: { kind: body.kind, title_ar: body.title_ar, title_en: body.title_en, provider: body.provider, url: body.url, verified_on: new Date(body.verified_on), reference_skill_id: body.reference_skill_id },
    }));
  }

  @Get('background-jobs')
  backgroundJobs(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select id, kind, status, attempts, max_attempts, last_error, run_after, locked_at, created_at, updated_at, finished_at
      from public.background_jobs where (${status ?? null}::text is null or status = ${status ?? null}) order by created_at desc limit 200`);
  }

  @Post('background-jobs/:id/retry')
  async retryJob(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.asUser(user, (tx) => tx.$executeRaw`select public.admin_retry_background_job(${id}::uuid)`);
    return { ok: true };
  }

  private async listingRows(tx: Parameters<Parameters<DbService['asUser']>[1]>[0], review: string | null) {
    const rows = await tx.$queryRaw<{ row: unknown }[]>`select public.admin_listings(${review}::text) as row`;
    return rows.map((r) => r.row);
  }
}
