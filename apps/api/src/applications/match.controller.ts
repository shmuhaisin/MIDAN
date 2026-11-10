import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';
import { jobMatchItems, matchSnapshot } from './ats';

export { evidenceFrom } from './ats';

const STATUSES = ['matched', 'partial', 'missing', 'needs_review'] as const;
type MatchStatus = (typeof STATUSES)[number];

class MatchReviewDto {
  @ApiProperty({ example: 'requirement:00000000-0000-4000-8000-000000000000' })
  @Matches(/^(requirement|skill):[0-9a-f-]{36}$/) requirement_key!: string;
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status!: MatchStatus;
  @ApiProperty({ enum: STATUSES, description: "MIDAN's proposal the reviewer saw; equal to status when confirming." }) @IsIn(STATUSES) proposed_status!: MatchStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) note?: string;
}

/**
 * Requirement matching for one application, for its organization's staff. MIDAN proposes, per requirement, whether the
 * submitted profile shows it, with the evidence used; staff confirm or correct each proposal. Nothing here changes the
 * application: shortlisting, rejecting and hiring stay separate, deliberate actions.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/applications/:applicationId/match')
export class ApplicationMatchController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get()
  @ApiOperation({
    summary: "MIDAN's proposed match of the submitted profile against the job's requirements, with evidence and staff reviews.",
    description: 'Computed on request from the application snapshot. A proposal, never a decision. "missing" means nothing in the profile shows it, not that the applicant lacks it.',
  })
  async match(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string) {
    const data = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const application = await tx.applications.findFirst({
        where: { id, org_id: orgId, status: { not: 'withdrawn' } },
        select: { id: true, job_id: true, profile_snapshot: true },
      });
      if (!application) throw new NotFoundException();
      const [items, reviews] = await Promise.all([
        jobMatchItems(tx, orgId, application.job_id),
        tx.application_match_reviews.findMany({ where: { application_id: id, org_id: orgId }, orderBy: { created_at: 'desc' } }),
      ]);
      return { application, items, reviews };
    });

    const { items } = data;
    const { result, evidence } = await matchSnapshot(this.ai, items, data.application.profile_snapshot);
    const latest = new Map<string, (typeof data.reviews)[number]>();
    for (const review of data.reviews) if (!latest.has(review.requirement_key)) latest.set(review.requirement_key, review);
    const proposals = new Map((result?.matches ?? []).map((m) => [m.key, m]));
    return {
      requirements: items.map((r) => {
        const review = latest.get(r.key);
        return {
          ...r,
          proposal: proposals.get(r.key) ?? null,
          review: review ? { status: review.status, decision: review.decision, note: review.note, created_at: review.created_at, reviewer_id: review.reviewer_id } : null,
        };
      }),
      summary: result?.summary ?? null,
      evidence_lines: evidence.length,
      reviewed: latest.size,
      provenance: result?.provenance ?? null,
    };
  }

  @Post('reviews')
  @ApiOperation({ summary: "A staff member's review of one proposal: confirmed as proposed, or corrected. Kept as a history; never changes the application." })
  review(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string, @Body() body: MatchReviewDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const application = await tx.applications.findFirst({ where: { id, org_id: orgId, status: { not: 'withdrawn' } }, select: { id: true } });
      if (!application) throw new NotFoundException();
      return tx.application_match_reviews.create({
        data: {
          application_id: id, org_id: orgId, reviewer_id: user.id, requirement_key: body.requirement_key,
          decision: body.status === body.proposed_status ? 'confirmed' : 'corrected', status: body.status, proposed_status: body.proposed_status,
          note: body.note?.trim() || null,
        },
      });
    });
  }
}
