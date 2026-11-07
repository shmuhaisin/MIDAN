import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { org_role } from '@prisma/client';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

const INVITABLE: org_role[] = ['admin', 'recruiter', 'reviewer'];
const ROLES: org_role[] = ['owner', 'admin', 'recruiter', 'reviewer'];

class InviteDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
  @ApiProperty({ enum: INVITABLE }) @IsIn(INVITABLE) role!: org_role;
}

class MemberRoleDto {
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role!: org_role;
}

@ApiTags('team')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/team')
export class TeamController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: "The organization's people. Pending invitations are for its owners and admins." })
  team(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const members = await tx.$queryRaw<unknown[]>`select * from public.organization_team(${orgId}::uuid)`;
      // Row security leaves this empty for recruiters and reviewers.
      const invitations = await tx.organization_invitations.findMany({
        where: { org_id: orgId, accepted_at: null, expires_at: { gt: new Date() } }, orderBy: { created_at: 'desc' },
        select: { id: true, email: true, role: true, expires_at: true, created_at: true },
      });
      return { members, invitations };
    });
  }

  @Post('invitations')
  @ApiOperation({ summary: 'Invites someone by email. Ownership is never granted by invitation, and inviting again renews it.' })
  invite(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: InviteDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const [invitation] = await tx.$queryRaw<{ id: string; email: string; role: string; expires_at: Date }[]>`
        select id, email, role, expires_at from public.invite_organization_member(${orgId}::uuid, ${body.email}, ${body.role}::public.org_role)`;
      return invitation;
    });
  }

  @Delete('invitations/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const { count } = await tx.organization_invitations.deleteMany({ where: { id, org_id: orgId, accepted_at: null } });
      if (count === 0) throw new NotFoundException();
      return { revoked: true };
    });
  }

  @Patch('members/:userId')
  @ApiOperation({ summary: "Changes a member's role. Only an owner can give or take ownership, and an organization always keeps an owner." })
  changeRole(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: MemberRoleDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      // Row security refuses what this role may not do: an admin can't touch an owner, or make one.
      const { count } = await tx.organization_members.updateMany({ where: { org_id: orgId, user_id: userId }, data: { role: body.role } });
      if (count === 0) throw new NotFoundException();
      return { user_id: userId, role: body.role };
    });
  }

  @Delete('members/:userId')
  remove(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const { count } = await tx.organization_members.deleteMany({ where: { org_id: orgId, user_id: userId } });
      if (count === 0) throw new NotFoundException();
      return { removed: true };
    });
  }
}

@ApiTags('team')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me/invitations')
export class MyInvitationsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: "Invitations addressed to this account's verified email." })
  mine(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw`select * from public.my_organization_invitations()`);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<{ org_id: string }[]>`select public.accept_organization_invitation(${id}::uuid) as org_id`;
      if (!row) throw new BadRequestException();
      return { org_id: row.org_id };
    });
  }

  @Post(':id/decline')
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.asUser(user, (tx) => tx.$executeRaw`select public.decline_organization_invitation(${id}::uuid)`);
    return { declined: true };
  }
}
