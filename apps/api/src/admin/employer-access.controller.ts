// Employer access: a representative asks for access to one of the registry employers MIDAN supports, and a platform
// administrator approves, rejects or revokes it. The database functions enforce every rule (20261112090000); these
// endpoints only pass the request through as the signed-in person, so a modified request can't skip a check.
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';
import { PlatformAdminGuard } from './admin.controller';

class AccessRequestDto {
  @ApiProperty({ description: 'The registry employer, from GET /reference/employers.' }) @IsUUID() registry_id!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) representative_name!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) job_title!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[0-9 ]{7,20}$/) phone?: string;
  @ApiPropertyOptional({ description: 'How the administrator can verify the representative (department, manager, employee number).' })
  @IsOptional() @IsString() @MaxLength(2000) verification_note?: string;
}

class DecisionDto {
  @ApiProperty({ enum: ['approve', 'reject'] }) @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @ApiPropertyOptional({ enum: ['owner', 'admin', 'recruiter', 'reviewer'], description: 'The role granted on approval. Default: owner for the first representative, otherwise the requested role.' })
  @IsOptional() @IsIn(['owner', 'admin', 'recruiter', 'reviewer']) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class RevokeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

const REQUEST_COLUMNS = `r.id, r.registry_id, r.representative_name, r.job_title, r.work_email, r.phone, r.verification_note, r.source,
  r.requested_role, r.status, r.org_id, r.granted_role, r.decided_at, r.decision_note, r.created_at,
  e.name_ar as employer_name_ar, e.name_en as employer_name_en, e.sector as employer_sector, e.partnership_status`;

@ApiTags('employer access')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me/employer-access')
export class MyEmployerAccessController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in person's latest employer access request, or null." })
  async mine(@CurrentUser() user: AuthUser) {
    const rows = await this.db.asUser(user, (tx) => tx.$queryRawUnsafe<unknown[]>(
      `select ${REQUEST_COLUMNS} from public.employer_access_requests r join public.employer_registry e on e.id = r.registry_id
       where r.user_id = auth.uid() order by r.created_at desc limit 1`));
    return rows[0] ?? null;
  }

  @Get('signup-choice')
  @ApiOperation({ summary: 'The supported employer this verified organization account chose at sign-up, or null. Lets the person retry a request that sign-up provisioning could not open. Grants nothing.' })
  async signupChoice(@CurrentUser() user: AuthUser) {
    const rows = await this.db.asUser(user, (tx) => tx.$queryRaw<unknown[]>`select * from public.my_signup_employer_choice()`);
    return rows[0] ?? null;
  }

  @Post()
  @ApiOperation({ summary: 'Ask for access to one supported employer. Nothing is granted until a platform administrator approves.' })
  request(@CurrentUser() user: AuthUser, @Body() body: AccessRequestDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.request_employer_access(${body.registry_id}::uuid,
        ${body.representative_name}, ${body.job_title}, ${body.phone ?? null}, ${body.verification_note ?? null})`;
      return row;
    });
  }
}

@ApiTags('administration')
@ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/employer-access')
export class AdminEmployerAccessController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'Employer access requests, pending first.' })
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.db.asUser(user, (tx) => tx.$queryRawUnsafe<unknown[]>(
      `select ${REQUEST_COLUMNS}, o.name_en as org_name_en, o.name_ar as org_name_ar, o.is_test as org_is_test, d.email as decided_by_email
       from public.employer_access_requests r join public.employer_registry e on e.id = r.registry_id
       left join public.organizations o on o.id = r.org_id left join public.users d on d.id = r.decided_by
       where ($1::text is null or r.status = $1) order by (r.status = 'pending_approval') desc, r.created_at desc limit 300`, status ?? null));
  }

  @Get('workspaces')
  @ApiOperation({ summary: 'The workspace of each supported employer, with its members.' })
  workspaces(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select e.id as registry_id, e.name_ar, e.name_en, e.partnership_status, o.id as org_id, o.is_test,
        coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role) order by m.role, u.email)
                  from public.organization_members m join public.users u on u.id = m.user_id where m.org_id = o.id), '[]'::jsonb) as members
      from public.employer_registry e left join public.organizations o on o.employer_registry_id = e.id and not o.is_demo
      order by e.name_en, o.is_test`);
  }

  @Get('history')
  @ApiOperation({ summary: 'Every request, approval, rejection and revocation, newest first.' })
  history(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`
      select a.id, a.action, a.entity_id as request_id, a.details, a.created_at, u.email as actor_email
      from public.audit_logs a left join public.users u on u.id = a.actor_id
      where a.entity = 'employer_access_requests' order by a.created_at desc limit 300`);
  }

  @Post(':id/decision')
  @ApiOperation({ summary: 'Approve (adds the representative to the employer\'s workspace, creating it the first time) or reject.' })
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_decide_employer_access(${id}::uuid, ${body.decision},
        ${body.role ?? null}::public.org_role, ${body.note ?? null})`;
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Removes an approved representative from the workspace.' })
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeDto) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.admin_revoke_employer_access(${id}::uuid, ${body.note ?? null})`;
      return row;
    });
  }
}
