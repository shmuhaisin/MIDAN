// Platform administrators review organizations (supabase/migrations/20261111090000_organization_verification.sql):
// the application with its documents, the decision with its reason, suspension and reactivation, and the history.
// Every change goes through a security-definer function that checks private.platform_admins and writes the audit log.
import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl } from '../common/storage';
import { AuthUser, DbService } from '../db/db.service';
import { verificationState } from '../organizations/organization-verification.controller';
import { PlatformAdminGuard } from './admin.controller';

class DecisionDto {
  @ApiProperty({ enum: ['approve', 'reject', 'request_changes'] }) @IsIn(['approve', 'reject', 'request_changes']) decision!: string;
  @ApiPropertyOptional({ description: 'Required to reject or to request changes; shown to the organization.' }) @IsOptional() @IsString() @MaxLength(4000) note?: string;
}

class SuspensionDto {
  @ApiProperty() @IsBoolean() suspend!: boolean;
  @ApiProperty({ description: 'Required; kept in the audit log.' }) @IsString() @MaxLength(2000) reason!: string;
}

@ApiTags('administration')
@ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/organizations/:id')
export class AdminOrganizationsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'One organization: profile, documents, every application and decision, members, jobs and its audit trail.' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const exists = await tx.organizations.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException();
      const [state, members, jobs, audit, people] = await Promise.all([
        verificationState(tx, id),
        tx.$queryRaw`select m.user_id, m.role, m.created_at, u.email, u.display_name from public.organization_members m
          join public.users u on u.id = m.user_id where m.org_id = ${id}::uuid order by m.created_at`,
        tx.$queryRaw`select status::text, count(*)::int as count from public.jobs where org_id = ${id}::uuid group by status`,
        tx.$queryRaw`select l.id::text, l.action, l.entity, l.details, l.created_at, u.email as actor_email from public.audit_logs l
          left join public.users u on u.id = l.actor_id where l.org_id = ${id}::uuid
          and (l.entity = 'organization_verification' or (l.entity = 'organizations' and l.action in ('suspend', 'reactivate', 'approved_before_review')))
          order by l.id desc limit 50`,
        // Who submitted and who decided each application.
        tx.$queryRaw<{ id: string; email: string }[]>`select u.id, u.email from public.users u where u.id in (
          select submitted_by from public.organization_verification_requests where org_id = ${id}::uuid
          union select reviewed_by from public.organization_verification_requests where org_id = ${id}::uuid)`,
      ]);
      const email = new Map(people.map((p) => [p.id, p.email]));
      const requests = state.requests.map((r) => ({
        ...r, submitted_by_email: r.submitted_by ? email.get(r.submitted_by) ?? null : null, reviewed_by_email: r.reviewed_by ? email.get(r.reviewed_by) ?? null : null,
      }));
      return { ...state, requests, members, jobs, audit };
    });
  }

  @Get('documents/:docId/url')
  async documentUrl(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    const doc = await this.db.asUser(user, (tx) => tx.organization_documents.findFirst({ where: { id: docId, org_id: id }, select: { path: true } }));
    const url = doc ? await signedUrl('organization-documents', doc.path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post('decision')
  @ApiOperation({ summary: 'Approves, rejects (reason required) or asks for changes (reason required) on the waiting application.' })
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.db.asUser(user, async (tx) => {
      await tx.$queryRaw`select id from public.admin_decide_organization(${id}::uuid, ${body.decision}, ${body.note ?? null})`;
      return verificationState(tx, id);
    });
  }

  @Post('suspension')
  @ApiOperation({ summary: 'Suspends an approved organization or reactivates a suspended one, with a reason.' })
  suspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: SuspensionDto) {
    return this.db.asUser(user, async (tx) => {
      await tx.$queryRaw`select id from public.admin_set_organization_suspension(${id}::uuid, ${body.suspend}, ${body.reason})`;
      return verificationState(tx, id);
    });
  }
}
