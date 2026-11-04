import { Body, Controller, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { application_status } from '@prisma/client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class UpdateStatusDto {
  @ApiProperty({ enum: application_status }) @IsEnum(application_status) status!: application_status;
}

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly db: DbService) {}

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const [application] = await tx.$queryRaw<{ id: string; status: string }[]>`
        select id, status from public.withdraw_application(${id}::uuid)`;
      return application;
    });
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStatusDto) {
    return this.db.asUser(user, async (tx) => {
      // RLS hides rows from other tenants, and a candidate's own row is not theirs to change.
      const { count } = await tx.applications.updateMany({ where: { id }, data: { status: body.status } });
      if (count === 0) throw new NotFoundException();
      return tx.applications.findUniqueOrThrow({ where: { id } });
    });
  }
}
