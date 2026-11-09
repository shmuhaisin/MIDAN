import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsUUID } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class AcceptDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(80) @IsUUID('all', { each: true }) skills!: string[];
  @ApiProperty({ type: [String], description: 'Which of the chosen skills are required. The rest are preferred.' })
  @IsArray() @ArrayMaxSize(80) @IsUUID('all', { each: true }) required!: string[];
  @ApiProperty() @IsBoolean() set_sector!: boolean;
  @ApiProperty({ required: false, description: 'Expected level (0–4, or null) per chosen skill id; the employer\'s choice wins over a suggested level.' })
  @IsOptional() @IsObject() levels?: Record<string, number | null>;
}

/** Only whole levels 0–4 (or null, "not set") pass; anything else is dropped. */
function levelsOf(levels: Record<string, number | null> | undefined) {
  return Object.fromEntries(Object.entries(levels ?? {}).filter(([id, v]) => /^[0-9a-f-]{36}$/.test(id) && (v === null || (Number.isInteger(v) && v >= 0 && v <= 4))));
}

@ApiTags('job analysis')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/jobs/:jobId/analyses')
export class JobAnalysisController {
  constructor(private readonly db: DbService) {}

  @Post()
  @ApiOperation({
    summary: 'Analyzes the job against the sector skills reference.',
    description: 'Finds reference skills the job text names, with the matched words, and priority skills of the proposed job family. Proposes only; nothing changes until accepted.',
  })
  analyze(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const [row] = await tx.$queryRaw<unknown[]>`select * from public.analyze_job(${jobId}::uuid) where org_id = ${orgId}::uuid`;
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  @Get('latest')
  latest(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const [row] = await tx.$queryRaw<unknown[]>`
        select * from public.job_analyses where job_id = ${jobId}::uuid and org_id = ${orgId}::uuid order by created_at desc limit 1`;
      return row ?? null;
    });
  }

  @Post(':analysisId/accept')
  accept(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('analysisId', ParseUUIDPipe) id: string, @Body() body: AcceptDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const [row] = await tx.$queryRaw<unknown[]>`
        select * from public.accept_job_analysis(${id}::uuid, ${body.skills}::uuid[], ${body.required}::uuid[], ${body.set_sector}, ${JSON.stringify(levelsOf(body.levels))}::jsonb)`;
      return row;
    });
  }

  @Post(':analysisId/dismiss')
  async dismiss(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('analysisId', ParseUUIDPipe) id: string) {
    await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      await tx.$executeRaw`select public.dismiss_job_analysis(${id}::uuid)`;
    });
    return { dismissed: true };
  }
}
