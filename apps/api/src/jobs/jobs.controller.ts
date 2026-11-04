import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class ApplyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  cover_note?: string;
}

const PUBLIC_JOB = {
  id: true, slug: true, title_ar: true, title_en: true, description_ar: true, description_en: true,
  location: true, status: true, is_demo: true, published_at: true,
  organizations: { select: { id: true, slug: true, name_ar: true, name_en: true, is_demo: true } },
} as const;

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'Published jobs. No sign-in needed.' })
  list() {
    return this.db.asAnon((tx) =>
      tx.jobs.findMany({ where: { status: 'published' }, select: PUBLIC_JOB, orderBy: { published_at: 'desc' }, take: 100 }),
    );
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.db.asAnon((tx) => tx.jobs.findUnique({ where: { id }, select: PUBLIC_JOB }));
    if (!job) throw new NotFoundException();
    return job;
  }

  @Post(':id/applications')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply to a published job as the signed-in candidate.' })
  apply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplyDto) {
    return this.db.asUser(user, async (tx) => {
      const job = await tx.jobs.findFirst({ where: { id, status: 'published' }, select: { org_id: true } });
      if (!job) throw new NotFoundException();
      return tx.applications.create({
        data: { job_id: id, org_id: job.org_id, candidate_id: user.id, cover_note: body.cover_note },
      });
    });
  }
}
