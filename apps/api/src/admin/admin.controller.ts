import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';
import { integrationStatus } from './integrations';

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
class ResourceDto {
  @ApiProperty({ enum: ['course', 'certification'] }) @IsIn(['course', 'certification']) kind!: 'course' | 'certification';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title_en?: string;
  @ApiProperty() @IsString() @MaxLength(120) provider!: string;
  @ApiProperty() @Matches(/^https:\/\/[^\s]+$/) @MaxLength(1000) url!: string;
  @ApiProperty({ description: 'The date a person opened the link and checked the details shown.' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) verified_on!: string;
  @ApiProperty() @IsUUID() reference_skill_id!: string;
}

const STATUSES = ['imported', 'updated', 'unchanged', 'duplicate', 'rejected', 'ambiguous', 'warning'];

@ApiTags('administration')
@ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly db: DbService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Counts and integration status. Counts come from the database; integrations say only whether they are configured.' })
  async overview(@CurrentUser() user: AuthUser) {
    const [counts] = await this.db.asUser(user, (tx) => tx.$queryRaw<Record<string, number>[]>`
      select
        (select count(*)::int from public.users) as users,
        (select count(*)::int from public.organizations where not is_test and not is_demo) as organizations,
        (select count(*)::int from public.organizations where is_test) as test_organizations,
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

  @Post('listings/:id/review')
  reviewListing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ListingReviewDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_review_listing(${id}::uuid, ${body.action}, ${body.registry_id ?? null}::uuid, ${body.note ?? null})`;
      return row;
    });
  }

  @Get('organizations')
  organizations(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select o.id, o.slug, o.name_ar, o.name_en, o.is_demo, o.is_test, o.created_at,
        (select count(*)::int from public.organization_members m where m.org_id = o.id) as members,
        (select count(*)::int from public.jobs j where j.org_id = o.id) as jobs,
        (select count(*)::int from public.jobs j where j.org_id = o.id and j.status = 'published') as published_jobs
      from public.organizations o order by o.is_test, o.created_at desc limit 500`);
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

  private listingRows(tx: Parameters<Parameters<DbService['asUser']>[1]>[0], review: string | null) {
    return tx.$queryRaw`
      select l.id, l.title_original, l.title_ar, l.title_en, l.employer_name_raw, l.source_type, l.source_name, l.source_url, l.source_job_id, l.collected_at,
        l.match_status, l.match_confidence, l.match_evidence, l.sector_code, l.subsector_ar, l.job_family_ar, l.classification -> 'confidence' as classification_confidence,
        l.classification -> 'mentions' as mentions, l.review_status, l.published, l.duplicate_of, l.reviewed_at, l.review_note, l.location, l.employment_type,
        e.id as registry_id, e.name_ar as registry_name_ar, e.name_en as registry_name_en, e.source_company_id,
        coalesce((select jsonb_agg(jsonb_build_object('name_ar', s.name_ar, 'evidence', k.evidence)) from public.external_job_skills k
          join public.reference_skills s on s.id = k.reference_skill_id where k.listing_id = l.id), '[]') as skills
      from public.external_job_listings l left join public.employer_registry e on e.id = l.employer_registry_id
      where (${review}::text is null or l.review_status = ${review}) order by l.created_at desc limit 300`;
  }
}
