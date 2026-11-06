import { Body, Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl } from '../common/storage';
import { AuthUser, DbService, Tx } from '../db/db.service';

class OnboardingDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) step?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() completed?: boolean;
}

class ReferenceSkillsDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) ids!: string[];
}

type NamedSkill = { id: string; name_ar: string; name_en: string | null };
export type Match = {
  total: number;
  percentage: number | null;
  matched: (NamedSkill & { evidence: 'assessed' | 'self_reported' })[];
  gaps: NamedSkill[];
};

const JOB_SKILLS = {
  job_skills: { where: { review_status: 'approved' }, select: { is_required: true, skills: { select: { id: true, name_ar: true, name_en: true } } } },
  job_reference_skills: { select: { is_required: true, reference_skills: { select: { id: true, name_ar: true } } } },
} as const;

type JobSkills = {
  job_skills: { is_required: boolean; skills: NamedSkill }[];
  job_reference_skills: { is_required: boolean; reference_skills: { id: string; name_ar: string } }[];
};

async function candidateEvidence(tx: Tx, userId: string) {
  const [listed, listedReference, assessed] = await Promise.all([
    tx.candidate_skills.findMany({ where: { candidate_id: userId }, select: { skill_id: true } }),
    tx.candidate_reference_skills.findMany({ where: { candidate_id: userId }, select: { reference_skill_id: true } }),
    // Only released results are readable by a candidate, so this can't reveal an unreleased score.
    tx.skill_scores.findMany({ where: { evaluation_results: { released_to_candidate: true, assessment_attempts: { candidate_id: userId } } }, select: { skill_id: true, level: true } }),
  ]);
  return {
    listed: new Set([...listed.map((s) => s.skill_id), ...listedReference.map((s) => s.reference_skill_id)]),
    assessed: new Set(assessed.filter((s) => s.level >= 3).map((s) => s.skill_id)),
  };
}

/**
 * The defined calculation behind any match shown to a candidate: required skills they have evidence for, divided
 * by the job's required skills. It isn't a prediction or a hiring signal. With no required skills there is no percentage.
 */
export function calculateMatch(job: JobSkills, evidence: { listed: Set<string>; assessed: Set<string> }): Match {
  const required: NamedSkill[] = [
    ...job.job_skills.filter((s) => s.is_required).map((s) => s.skills),
    ...job.job_reference_skills.filter((s) => s.is_required).map((s) => ({ id: s.reference_skills.id, name_ar: s.reference_skills.name_ar, name_en: null })),
  ];
  const matched: Match['matched'] = [];
  const gaps: NamedSkill[] = [];
  for (const skill of required) {
    if (evidence.assessed.has(skill.id)) matched.push({ ...skill, evidence: 'assessed' });
    else if (evidence.listed.has(skill.id)) matched.push({ ...skill, evidence: 'self_reported' });
    else gaps.push(skill);
  }
  return { total: required.length, matched, gaps, percentage: required.length ? Math.round((matched.length / required.length) * 100) : null };
}

async function refreshCandidateState(tx: Tx) {
  await tx.$queryRaw`select public.expire_my_overdue_attempts()`;
  await tx.$executeRaw`select public.create_my_deadline_reminders()`;
}

export async function recommendedJobs(tx: Tx, userId: string) {
  const [jobs, mine, evidence] = await Promise.all([
    tx.jobs.findMany({
      where: { status: 'published' },
      orderBy: { published_at: 'desc' },
      take: 200,
      select: { id: true, title_ar: true, title_en: true, location: true, is_demo: true, organizations: { select: { name_ar: true, name_en: true } }, ...JOB_SKILLS },
    }),
    tx.applications.findMany({ where: { candidate_id: userId }, select: { job_id: true } }),
    candidateEvidence(tx, userId),
  ]);
  const applied = new Set(mine.map((a) => a.job_id));
  return jobs
    .filter((job) => !applied.has(job.id))
    .map(({ job_skills, job_reference_skills, ...job }) => ({ ...job, match: calculateMatch({ job_skills, job_reference_skills }, evidence) }))
    .filter((job) => job.match.matched.length > 0)
    .sort((a, b) => (b.match.percentage ?? 0) - (a.match.percentage ?? 0))
    .slice(0, 6);
}

const ATTEMPT_DETAILS = {
  orderBy: { created_at: 'asc' },
  select: {
    id: true, status: true, deadline_at: true, expires_at: true, started_at: true, submitted_at: true, receipt_code: true, created_at: true,
    assessment_versions: {
      select: {
        id: true, version_number: true, duration_minutes: true, is_timed: true, deadline_hours: true,
        assessments: { select: { title_ar: true, title_en: true } },
      },
    },
    // Enough to link a released report. Scores come only from the report endpoint.
    evaluation_results: { select: { released_to_candidate: true } },
  },
} as const;

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class CandidateController {
  constructor(private readonly db: DbService) {}

  @Get('dashboard')
  @ApiOperation({ summary: "Everything on a candidate's dashboard, from real records. Works with no data at all." })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      await refreshCandidateState(tx);
      const now = new Date();
      const [interviews, unread, recent, plan, analysis, recommended] = await Promise.all([
        tx.interviews.findMany({
          where: { candidate_id: user.id, status: { in: ['invited', 'accepted', 'reschedule_requested'] }, scheduled_at: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) } },
          orderBy: { scheduled_at: 'asc' },
          select: { id: true, scheduled_at: true, duration_minutes: true, status: true, applications: { select: { jobs: { select: { title_ar: true, title_en: true } } } } },
        }),
        tx.notifications.count({ where: { user_id: user.id, read_at: null } }),
        tx.notifications.findMany({ where: { user_id: user.id, read_at: null }, orderBy: { created_at: 'desc' }, take: 5 }),
        tx.career_plan_items.groupBy({ by: ['status'], where: { candidate_id: user.id }, _count: true }),
        tx.cv_analyses.findFirst({ where: { candidate_id: user.id }, orderBy: { created_at: 'desc' }, select: { id: true, status: true, failure_code: true } }),
        recommendedJobs(tx, user.id),
      ]);
      return { interviews, unread, notifications: recent, plan, analysis, recommended };
    });
  }

  @Get('applications/:id')
  @ApiOperation({ summary: "One of the candidate's applications, as submitted, with everything that has happened since." })
  application(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await refreshCandidateState(tx);
      const application = await tx.applications.findFirst({
        where: { id, candidate_id: user.id },
        select: {
          id: true, status: true, created_at: true, updated_at: true, cover_note: true, profile_snapshot: true, cv_snapshot_path: true,
          jobs: {
            select: {
              id: true, slug: true, title_ar: true, title_en: true, location: true, employment_type: true, application_deadline: true, status: true,
              organizations: { select: { slug: true, name_ar: true, name_en: true } },
            },
          },
          assessment_attempts: ATTEMPT_DETAILS,
          application_status_history: { orderBy: { created_at: 'asc' }, select: { to_status: true, created_at: true } },
          interviews: { orderBy: { scheduled_at: 'asc' }, select: { id: true, scheduled_at: true, duration_minutes: true, time_zone: true, status: true } },
          hiring_outcomes: { orderBy: { issued_at: 'desc' }, select: { id: true, outcome: true, message_ar: true, message_en: true, issued_at: true } },
        },
      });
      if (!application) throw new NotFoundException();
      const { cv_snapshot_path, ...rest } = application;
      return { ...rest, has_cv: Boolean(cv_snapshot_path) };
    });
  }

  @Get('applications/:id/cv-url')
  async applicationCv(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const application = await this.db.asUser(user, (tx) => tx.applications.findFirst({ where: { id, candidate_id: user.id }, select: { cv_snapshot_path: true } }));
    const url = application?.cv_snapshot_path ? await signedUrl('candidate-documents', application.cv_snapshot_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Patch('onboarding')
  onboarding(@CurrentUser() user: AuthUser, @Body() body: OnboardingDto) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.candidate_profiles.updateMany({
        where: { user_id: user.id },
        data: {
          ...(body.step !== undefined && { onboarding_step: body.step }),
          ...(body.completed && { onboarding_completed_at: new Date() }),
        },
      });
      if (count === 0) throw new NotFoundException();
      return { saved: true };
    });
  }

  @Put('reference-skills')
  @ApiOperation({ summary: 'Skills the candidate says they have, chosen from the sector skills reference. Self-reported, never treated as assessed.' })
  setReferenceSkills(@CurrentUser() user: AuthUser, @Body() body: ReferenceSkillsDto) {
    return this.db.asUser(user, async (tx) => {
      const wanted = [...new Set(body.ids)];
      await tx.candidate_reference_skills.deleteMany({ where: { candidate_id: user.id, reference_skill_id: { notIn: wanted } } });
      await tx.candidate_reference_skills.createMany({ data: wanted.map((reference_skill_id) => ({ candidate_id: user.id, reference_skill_id })), skipDuplicates: true });
      return tx.candidate_reference_skills.findMany({
        where: { candidate_id: user.id },
        select: { reference_skills: { select: { id: true, name_ar: true, sector_code: true, skill_kind: true } } },
      });
    });
  }

  @Get('reference-skills')
  referenceSkills(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) =>
      tx.candidate_reference_skills.findMany({
        where: { candidate_id: user.id },
        select: { reference_skills: { select: { id: true, name_ar: true, sector_code: true, skill_kind: true } } },
      }),
    );
  }

  @Get('recommended-jobs')
  recommended(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => recommendedJobs(tx, user.id));
  }

  @Get('jobs/:id/match')
  @ApiOperation({ summary: 'Which required skills the candidate has evidence for. See calculateMatch for the definition.' })
  match(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const job = await tx.jobs.findFirst({ where: { id, status: 'published' }, select: JOB_SKILLS });
      if (!job) throw new NotFoundException();
      return calculateMatch(job, await candidateEvidence(tx, user.id));
    });
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      await refreshCandidateState(tx);
      return tx.notifications.findMany({ where: { user_id: user.id }, orderBy: { created_at: 'desc' }, take: 100 });
    });
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.notifications.updateMany({ where: { id, user_id: user.id, read_at: null }, data: { read_at: new Date() } });
      return { updated: count };
    });
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.notifications.updateMany({ where: { user_id: user.id, read_at: null }, data: { read_at: new Date() } });
      return { updated: count };
    });
  }
}
