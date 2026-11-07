import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/listings')
export class OrganizationListingsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'Approved records for the employer this organization manages, for its owners and admins.' })
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const rows = await tx.$queryRaw<{ row: unknown }[]>`select public.organization_listings(${orgId}::uuid) as row`;
      return rows.map((r) => r.row);
    });
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Turns an approved record into a draft job here, to review and publish. Only for the employer this organization manages.' })
  convert(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, ['owner', 'admin']);
      const [job] = await tx.$queryRaw<{ id: string; org_id: string; status: string }[]>`select id, org_id, status from public.convert_listing_to_job(${id}::uuid)`;
      return job;
    });
  }
}
