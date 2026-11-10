import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { applicantProfile } from '../common/applicant';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';
import { jobMatchItems, matchSnapshot, type MatchStatus } from './ats';
import { cvScore, interviewSummary, rankBy, RANK_KEYS, type RankKey } from './ranking';

/** At most this many matching calls at once, so a long list doesn't flood the AI service. */
const CONCURRENCY = 4;

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

/**
 * Every applicant to one job, side by side, for its organization's staff: the CV match from MIDAN's matching model, the
 * reviewed assessment score, the interview feedback, and the stage. Computed on request, so a new evaluation, a review of a
 * match or a submitted interview form re-ranks the list the next time it's read.
 *
 * The stage scores are never combined: no approved rule weights them against each other. The order is the employer's
 * choice of one stage (`sort`); applicants whose stage is still pending are listed after the scored ones, unranked. Nothing
 * here changes an application: shortlisting, rejecting and hiring stay deliberate staff actions.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/jobs/:jobId/ranking')
export class JobRankingController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get()
  @ApiOperation({ summary: 'All active applicants to a job with their stage scores, ordered by one stage the employer chooses.' })
  @ApiQuery({ name: 'sort', required: false, enum: RANK_KEYS })
  async ranking(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Query('sort') sortParam?: string) {
    const sort: RankKey = (RANK_KEYS as readonly string[]).includes(sortParam ?? '') ? (sortParam as RankKey) : 'cv';
    const data = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const job = await tx.jobs.findFirst({
        where: { id: jobId, org_id: orgId },
        select: { id: true, title_ar: true, title_en: true, assessments: { select: { id: true, title_ar: true, title_en: true, assessment_versions: { where: { status: 'published' }, select: { id: true } } } } },
      });
      if (!job) throw new NotFoundException();
      const [items, applications] = await Promise.all([
        jobMatchItems(tx, orgId, jobId),
        tx.applications.findMany({
          where: { job_id: jobId, org_id: orgId, status: { not: 'withdrawn' } },
          orderBy: { created_at: 'asc' },
          select: {
            id: true, status: true, created_at: true, profile_snapshot: true,
            assessment_attempts: {
              select: {
                id: true, status: true,
                assessment_versions: { select: { assessment_id: true } },
                evaluation_results: { select: { status: true, overall_score: true } },
              },
            },
            interviews: { select: { id: true, status: true, scheduled_at: true } },
          },
        }),
      ]);
      // Neither table is a relation of applications in the schema: read them for these applications at once.
      const ids = applications.map((a) => a.id);
      const [reviews, feedback] = await Promise.all([
        tx.application_match_reviews.findMany({ where: { application_id: { in: ids }, org_id: orgId }, orderBy: { created_at: 'desc' }, select: { application_id: true, requirement_key: true, status: true } }),
        tx.interview_feedback.findMany({ where: { application_id: { in: ids }, org_id: orgId, status: 'submitted' }, select: { application_id: true, recommendation: true, competencies: true } }),
      ]);
      return {
        job, items,
        applications: applications.map((a) => ({
          ...a,
          application_match_reviews: reviews.filter((r) => r.application_id === a.id),
          interview_feedback: feedback.filter((f) => f.application_id === a.id),
        })),
      };
    });

    const live = data.job.assessments.filter((a) => a.assessment_versions.length > 0);
    const rows = await pool(data.applications, CONCURRENCY, async (a) => {
      let cv: ReturnType<typeof cvScore> | { status: 'unavailable' } | { status: 'no_requirements' };
      let provenance: Record<string, unknown> | null = null;
      if (data.items.length === 0) cv = { status: 'no_requirements' };
      else {
        try {
          const { result } = await matchSnapshot(this.ai, data.items, a.profile_snapshot);
          provenance = result?.provenance ?? null;
          cv = cvScore(data.items, result?.matches ?? [], latestReviews(a.application_match_reviews));
        } catch {
          cv = { status: 'unavailable' };
        }
      }
      const assessments = live.map((s) => {
        const attempt = a.assessment_attempts.find((t) => t.assessment_versions.assessment_id === s.id);
        const reviewed = attempt?.evaluation_results?.status === 'reviewed' && attempt.evaluation_results.overall_score !== null;
        return {
          assessment_id: s.id, title_ar: s.title_ar, title_en: s.title_en,
          state: !attempt ? 'not_assigned' : reviewed ? 'scored' : attempt.status === 'submitted' ? 'awaiting_review' : attempt.status,
          // The person-reviewed score only: a proposal waiting for review isn't a score yet.
          score: reviewed ? Number(attempt!.evaluation_results!.overall_score) : null,
        };
      });
      const profile = applicantProfile(a.profile_snapshot);
      return {
        application_id: a.id, status: a.status, applied_at: a.created_at,
        name: profile?.full_name ?? null, headline: profile?.headline ?? null,
        cv, assessments,
        // One score per stage only when it is one number: with several assessments each keeps its own score.
        assessment_score: assessments.length === 1 ? assessments[0].score : null,
        interview: interviewSummary(a.interviews, a.interview_feedback),
        matching: provenance && { provider: provenance.provider ?? null, model_version: provenance.model_version ?? null, fallback: provenance.fallback ?? null },
      };
    });

    return {
      job: { id: data.job.id, title_ar: data.job.title_ar, title_en: data.job.title_en },
      sort,
      // Why there is no single overall percentage: stated, so a screen can say it rather than invent one.
      overall: { available: false, reason: 'no_approved_weights' },
      requirements: data.items.length,
      applicants: rankBy(rows, sort),
    };
  }
}

function latestReviews(reviews: { requirement_key: string; status: string }[]) {
  const latest = new Map<string, MatchStatus>();
  for (const r of reviews) if (!latest.has(r.requirement_key)) latest.set(r.requirement_key, r.status as MatchStatus);
  return latest;
}

