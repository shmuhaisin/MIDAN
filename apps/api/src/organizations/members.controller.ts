import { createHash, createHmac } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { AuthUser, DbService, Tx } from '../db/db.service';
import { InvitationMailer } from './invitation-mailer';

const ROLES = ['owner', 'admin', 'recruiter', 'reviewer'] as const;
class RoleDto {
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role!: typeof ROLES[number];
}
class InviteDto {
  // Reuse this UUID on retries. The existing invitation ID is the idempotency key.
  @ApiProperty() @IsUUID() request_id!: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ enum: ROLES.slice(1) }) @IsIn(['admin', 'recruiter', 'reviewer']) role!: 'admin' | 'recruiter' | 'reviewer';
}
class AcceptDto {
  @ApiProperty() @IsString() @MinLength(43) @MaxLength(43) token!: string;
}
const projection = { id: true, email: true, role: true, created_at: true, expires_at: true, accepted_at: true } as const;
const MANAGERS: ('owner' | 'admin')[] = ['owner', 'admin'];
export function invitationStatus(i: { accepted_at: Date | null; expires_at: Date }, now = new Date()) {
  return i.accepted_at ? 'accepted' : i.expires_at <= now ? 'expired' : 'pending';
}

@ApiTags('organization members')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class MembersController {
  constructor(private readonly db: DbService, private readonly mailer: InvitationMailer) {}

  private async lock(tx: Tx, user: AuthUser, org: string, managers = true) {
    await requireRole(tx, user, org, managers ? MANAGERS : undefined);
    await tx.$queryRaw`select id from public.organizations where id = ${org}::uuid for update`;
    // Permissions may have changed while this request waited for the lock.
    await requireRole(tx, user, org, managers ? MANAGERS : undefined);
  }

  @Get('organizations/:orgId/members')
  members(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string) {
    return this.db.asUser(user, async tx => {
      await requireRole(tx, user, org);
      return tx.$queryRaw`select * from public.list_organization_members(${org}::uuid)`;
    });
  }

  @Patch('organizations/:orgId/members/:memberId')
  role(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string, @Param('memberId', ParseUUIDPipe) member: string, @Body() body: RoleDto) {
    return this.db.asUser(user, async tx => {
      await this.lock(tx, user, org);
      const target = await tx.organization_members.findFirst({ where: { id: member, org_id: org } });
      if (!target) throw new NotFoundException();
      if (target.role === 'owner' || body.role === 'owner') await requireRole(tx, user, org, ['owner']);
      // Conditional update prevents moving an ID from another tenant.
      const { count } = await tx.organization_members.updateMany({ where: { id: member, org_id: org }, data: { role: body.role } });
      if (count !== 1) throw new ForbiddenException();
      return { ok: true };
    });
  }

  @Delete('organizations/:orgId/members/:memberId')
  remove(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string, @Param('memberId', ParseUUIDPipe) member: string) {
    return this.db.asUser(user, async tx => {
      await this.lock(tx, user, org);
      const target = await tx.organization_members.findFirst({ where: { id: member, org_id: org } });
      if (!target) throw new NotFoundException();
      if (target.role === 'owner') await requireRole(tx, user, org, ['owner']);
      const { count } = await tx.organization_members.deleteMany({ where: { id: member, org_id: org } });
      if (count !== 1) throw new ForbiddenException();
      return { ok: true };
    });
  }

  @Get('organizations/:orgId/invitations')
  invitations(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string) {
    return this.db.asUser(user, async tx => {
      await requireRole(tx, user, org, MANAGERS);
      const rows = await tx.organization_invitations.findMany({ where: { org_id: org }, select: projection, orderBy: { created_at: 'desc' } });
      return rows.map(i => ({ ...i, status: invitationStatus(i) }));
    });
  }

  @Post('organizations/:orgId/invitations')
  async invite(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string, @Body() body: InviteDto) {
    const email = body.email.trim().toLowerCase();
    const secret = process.env.INVITATION_TOKEN_SECRET;
    let origin: URL;
    try { origin = new URL(process.env.APP_URL ?? ''); } catch { throw new ServiceUnavailableException('Configure APP_URL'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new ServiceUnavailableException('Configure a secure APP_URL');
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('Configure INVITATION_TOKEN_SECRET');
    const data = await this.db.asUser(user, async tx => {
      await this.lock(tx, user, org);
      const existing = await tx.organization_invitations.findFirst({ where: { org_id: org, id: body.request_id } });
      const created = existing?.created_at ?? new Date();
      // Creation time prevents a cancelled/deleted ID from reviving its old link.
      const token = createHmac('sha256', secret).update(`${org}:${body.request_id}:${created.toISOString()}`).digest('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      if (existing) {
        if (existing.email !== email || existing.role !== body.role || existing.token_hash !== hash || invitationStatus(existing) !== 'pending') throw new ConflictException('Invitation retry does not match');
      } else {
        const duplicate = await tx.organization_invitations.findFirst({ where: { org_id: org, email, accepted_at: null, expires_at: { gt: new Date() } } });
        if (duplicate) throw new ConflictException('A pending invitation already exists');
        const members = await tx.$queryRaw<{ email: string }[]>`select email from public.list_organization_members(${org}::uuid)`;
        if (members.some(m => m.email.toLowerCase() === email)) throw new ConflictException('Already a member');
      }
      const invitation = existing ?? await tx.organization_invitations.create({ data: {
        id: body.request_id, org_id: org, email, role: body.role, token_hash: hash, invited_by: user.id,
        created_at: created, expires_at: new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000),
      } });
      const organization = await tx.organizations.findUniqueOrThrow({ where: { id: org }, select: { name_ar: true, name_en: true } });
      const sender = await tx.users.findUnique({ where: { id: user.id }, select: { display_name: true } });
      return { invitation, organization, sender, token };
    });
    // Deliberately outside the retried DB transaction. SMTP success means accepted by
    // the server, never proof of inbox delivery. A retry reuses the same row and link.
    const url = new URL('/ar/invitations/accept', origin.origin);
    url.hash = data.token; // Avoid tokens in HTTP request/access logs and referrers.
    await this.mailer.send({ to: email, organization: `${data.organization.name_ar} / ${data.organization.name_en}`, inviter: data.sender?.display_name, role: body.role, expires: data.invitation.expires_at, url: url.href });
    const { id, role, created_at, expires_at, accepted_at } = data.invitation;
    return { id, email, role, created_at, expires_at, accepted_at, status: invitationStatus(data.invitation), email_accepted: true };
  }

  @Delete('organizations/:orgId/invitations/:invitationId')
  cancel(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) org: string, @Param('invitationId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async tx => {
      await this.lock(tx, user, org);
      const invitation = await tx.organization_invitations.findFirst({ where: { id, org_id: org } });
      if (!invitation) throw new NotFoundException();
      if (invitation.accepted_at) throw new BadRequestException('Invitation already accepted');
      await tx.organization_invitations.deleteMany({ where: { id, org_id: org, accepted_at: null } });
      return { ok: true };
    });
  }

  @Post('invitations/accept')
  async accept(@CurrentUser() user: AuthUser, @Body() body: AcceptDto) {
    if (!user.emailConfirmed) throw new ForbiddenException('A verified email is required');
    return this.db.asUser(user, async tx => {
      const [row] = await tx.$queryRaw<{ org_id: string }[]>`select public.accept_organization_invitation(${body.token}) as org_id`;
      return row;
    });
  }
}
