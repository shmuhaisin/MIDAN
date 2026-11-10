import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, ServiceUnavailableException, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { evidenceFrom } from '../applications/match.controller';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { signedUrl, storageFetch } from '../common/storage';
import { listableJobs } from '../common/test-data';
import { AuthUser, DbService, Tx } from '../db/db.service';

class OnboardingDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10) step?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() completed?: boolean;
}

class ReferenceSkillsDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) ids!: string[];
}

class OwnSkillsDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true }) names!: string[];
}

type SkillOption = { id: string; name_ar: string; description_ar: string | null; sector_code: string; job_families: string[] };

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
  // A job's skill counts as listed when the candidate listed exactly that name, in the reference or in their own words.
  const sameName = await tx.$queryRaw<{ id: string }[]>`
    select s.id from public.skills s
    where public.normalize_arabic(s.name_ar) in (
      select r.name_search from public.candidate_reference_skills c join public.reference_skills r on r.id = c.reference_skill_id where c.candidate_id = ${userId}::uuid
      union
      select public.normalize_arabic(value) from public.candidate_profiles p, jsonb_array_elements_text(p.self_reported_skills) where p.user_id = ${userId}::uuid
    )`;
  return {
    listed: new Set([...listed.map((s) => s.skill_id), ...listedReference.map((s) => s.reference_skill_id), ...sameName.map((s) => s.id)]),
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

export async function recommendedJobs(tx: Tx, userId: string, email?: string) {
  const [jobs, mine, evidence] = await Promise.all([
    tx.jobs.findMany({
      where: listableJobs(email),
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
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

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
        recommendedJobs(tx, user.id, user.email),
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
      const profile = await tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } });
      return { ...rest, has_cv: Boolean(cv_snapshot_path), can_share_cv: !cv_snapshot_path && application.status !== 'withdrawn' && Boolean(profile?.cv_path) };
    });
  }

  @Get('applications/:id/cv-url')
  async applicationCv(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const application = await this.db.asUser(user, (tx) => tx.applications.findFirst({ where: { id, candidate_id: user.id }, select: { cv_snapshot_path: true } }));
    const url = application?.cv_snapshot_path ? await signedUrl('candidate-documents', application.cv_snapshot_path, token) : null;
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post('applications/:id/share-cv')
  @ApiOperation({ summary: "Shares a copy of the candidate's current CV with an application made without one. Only the candidate can do this." })
  async shareCv(@CurrentUser() user: AuthUser, @Headers('authorization') token: string, @Param('id', ParseUUIDPipe) id: string) {
    const { application, cvPath } = await this.db.asUser(user, async (tx) => ({
      application: await tx.applications.findFirst({ where: { id, candidate_id: user.id }, select: { job_id: true, status: true, cv_snapshot_path: true } }),
      cvPath: (await tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { cv_path: true } }))?.cv_path,
    }));
    if (!application) throw new NotFoundException();
    if (application.status === 'withdrawn' || application.cv_snapshot_path) throw new UnprocessableEntityException('A CV cannot be shared with this application');
    if (!cvPath) throw new UnprocessableEntityException('There is no CV to share');
    const copy = `${user.id}/applications/${application.job_id}/${randomUUID()}.${cvPath.split('.').pop()}`;
    const copied = await storageFetch('object/copy', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bucketId: 'candidate-documents', sourceKey: cvPath, destinationKey: copy }),
    });
    if (!copied.ok) throw new ServiceUnavailableException('The CV could not be attached');
    try {
      await this.db.asUser(user, (tx) => tx.$executeRaw`select public.share_cv_with_application(${id}::uuid, ${copy})`);
    } catch (error) {
      // Nothing points at the copy, for example after a second click, so it doesn't stay.
      await storageFetch(`object/candidate-documents/${copy}`, token, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
    return { shared: true };
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

  @Put('own-skills')
  @ApiOperation({ summary: "Skills in the candidate's own words, for those the reference doesn't have. Never treated as assessed." })
  setOwnSkills(@CurrentUser() user: AuthUser, @Body() body: OwnSkillsDto) {
    const names = [...new Set(body.names.map((n) => n.trim()).filter(Boolean))];
    return this.db.asUser(user, async (tx) => {
      const { count } = await tx.candidate_profiles.updateMany({ where: { user_id: user.id }, data: { self_reported_skills: names } });
      if (count === 0) throw new NotFoundException();
      return names;
    });
  }

  @Get('skill-suggestions')
  @ApiOperation({
    summary: 'Skills from a reviewed CV or the profile, matched to the reference.',
    description: 'One exact match is offered directly. Several exact or partial matches need the candidate to choose. A skill with no match stays in their own words.',
  })
  suggestions(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      const [analysis, profile, chosen] = await Promise.all([
        tx.cv_analyses.findFirst({ where: { candidate_id: user.id, status: 'awaiting_review' }, orderBy: { created_at: 'desc' }, select: { professional: true } }),
        tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { self_reported_skills: true } }),
        tx.candidate_reference_skills.findMany({ where: { candidate_id: user.id }, select: { reference_skill_id: true } }),
      ]);
      const fromCv = ((analysis?.professional as { skills?: string[] } | null)?.skills ?? []).filter((s) => typeof s === 'string');
      const own = (profile?.self_reported_skills as string[] | null) ?? [];
      const selected = new Set(chosen.map((c) => c.reference_skill_id));
      const results = [];
      for (const name of [...new Set([...fromCv, ...own])].slice(0, 50)) {
        const exact = await tx.$queryRaw<SkillOption[]>`
          select s.id, s.name_ar, s.description_ar, s.sector_code,
            array(select distinct c.job_family_ar from public.reference_skill_contexts c where c.skill_id = s.id limit 2) as job_families
          from public.reference_skills s where s.name_search = public.normalize_arabic(${name}) order by s.sector_code limit 7`;
        const options = exact.length ? exact : await tx.$queryRaw<SkillOption[]>`
          select s.id, s.name_ar, s.description_ar, s.sector_code,
            array(select distinct c.job_family_ar from public.reference_skill_contexts c where c.skill_id = s.id limit 2) as job_families
          from public.reference_skills s
          where length(public.normalize_arabic(${name})) >= 3 and s.name_search like '%' || public.normalize_arabic(${name}) || '%'
          order by s.is_priority desc nulls last, length(s.name_ar) limit 5`;
        if (options.some((o) => selected.has(o.id))) continue;
        results.push({ name, source: fromCv.includes(name) ? 'cv' : 'own', status: exact.length === 1 ? 'match' : options.length ? 'choose' : 'no_match', options });
      }
      return results;
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
    return this.db.asUser(user, (tx) => recommendedJobs(tx, user.id, user.email));
  }

  @Get('jobs/:id/match')
  @ApiOperation({
    summary: 'How the candidate\'s own profile relates to a published job: required skills with evidence (calculateMatch), and per requirement the line that shows it.',
    description: 'The semantic part is a proposal: similarity is not proof of competence. If the analysis service is slow or down, `semantic` carries the reason and the skills match still answers.',
  })
  async match(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.db.asUser(user, async (tx) => {
      const job = await tx.jobs.findFirst({ where: { id, status: 'published' }, select: JOB_SKILLS });
      if (!job) throw new NotFoundException();
      const [evidence, requirements, profile] = await Promise.all([
        candidateEvidence(tx, user.id),
        tx.job_requirements.findMany({
          where: { job_id: id, retired_at: null, review_status: 'approved', requirement_type: { not: 'daily_task' } },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: { id: true, requirement_type: true, description_ar: true, description_en: true, is_mandatory: true, min_years: true, skill_id: true },
        }),
        tx.candidate_profiles.findUnique({
          where: { user_id: user.id },
          select: { headline: true, summary: true, experience: true, education: true, projects: true, courses: true, certifications: true, self_reported_skills: true, languages: true },
        }),
      ]);
      return { job, evidence, requirements, profile };
    });
    const base = calculateMatch(data.job, data.evidence);
    return { ...base, semantic: await this.semanticMatch(data).catch(() => ({ error: 'unavailable' as const })) };
  }

  /** Requirement-by-requirement matching of the candidate's own profile, through the analysis service. */
  private async semanticMatch({ job, evidence, requirements, profile }: {
    job: JobSkills; evidence: Awaited<ReturnType<typeof candidateEvidence>>;
    requirements: { id: string; requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean; min_years: unknown; skill_id: string | null }[];
    profile: Record<string, unknown> | null;
  }) {
    const required = [
      ...job.job_skills.filter((s) => s.is_required).map((s) => s.skills),
      ...job.job_reference_skills.filter((s) => s.is_required).map((s) => ({ id: s.reference_skills.id, name_ar: s.reference_skills.name_ar, name_en: null })),
    ];
    const items = [
      ...requirements.map((r) => ({ key: `requirement:${r.id}`, kind: r.requirement_type, text_ar: r.description_ar, text_en: r.description_en, mandatory: r.is_mandatory, min_years: r.min_years == null ? null : Number(r.min_years), skill_id: r.skill_id })),
      ...required.map((s) => ({ key: `skill:${s.id}`, kind: 'skill', text_ar: s.name_ar, text_en: s.name_en, mandatory: true, min_years: null, skill_id: s.id })),
    ].filter((r) => r.text_ar || r.text_en);
    if (items.length === 0) return { requirements: [], summary: null, provenance: null };
    // Explicit skill evidence travels as structure: a released assessment result, or the skill as the candidate listed it.
    const structured = required.flatMap((s, k) => [
      ...(evidence.assessed.has(s.id) ? [{ id: `assessed_skill:${k}`, text: s.name_en ?? s.name_ar, source: 'assessed_skill', skill_id: s.id }] : []),
      ...(evidence.listed.has(s.id) ? [{ id: `skill:${k}`, text: s.name_en ?? s.name_ar, source: 'skill', skill_id: s.id }] : []),
    ]);
    type Proposal = { key: string; status: string; score: number; evidence_text: string | null; evidence_source: string | null; counter_evidence_text: string | null; reason_code: string; reason_params: Record<string, number> };
    const result = await this.ai.matchRequirements<{ matches: Proposal[]; summary: unknown; provenance: unknown }>({
      requirements: items.map((r) => ({ key: r.key, text: [r.text_ar, r.text_en].filter(Boolean).join(' / '), mandatory: r.mandatory, min_years: r.min_years, skill_id: r.skill_id })),
      evidence: [...evidenceFrom(profile as never), ...structured],
      // The candidate waits on this screen: e5 alone (fast), never the background reranker.
      mode: 'fast',
    });
    const proposals = new Map(result.matches.map((m) => [m.key, m]));
    return { requirements: items.map((r) => ({ ...r, proposal: proposals.get(r.key) ?? null })), summary: result.summary, provenance: result.provenance };
  }

  @Get('saved-jobs')
  @ApiOperation({ summary: "The candidate's saved jobs that are still published, newest saved first." })
  savedJobs(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      const saved = await tx.saved_jobs.findMany({ where: { candidate_id: user.id }, orderBy: { created_at: 'desc' }, select: { job_id: true, created_at: true } });
      const jobs = await tx.jobs.findMany({
        where: { id: { in: saved.map((s) => s.job_id) }, status: 'published' },
        select: {
          id: true, title_ar: true, title_en: true, location: true, is_demo: true, sector: true, employment_type: true, experience_level: true,
          application_deadline: true, organizations: { select: { name_ar: true, name_en: true } },
          job_skills: { select: { skills: { select: { id: true, name_ar: true, name_en: true } } } },
          job_reference_skills: { select: { reference_skills: { select: { id: true, name_ar: true } } } },
        },
      });
      const byId = new Map(jobs.map((j) => [j.id, j]));
      return saved.flatMap((s) => (byId.has(s.job_id) ? [{ ...byId.get(s.job_id)!, saved_at: s.created_at }] : []));
    });
  }

  @Put('saved-jobs/:jobId')
  @ApiOperation({ summary: 'Saves a published job for later. Saving twice changes nothing.' })
  saveJob(@CurrentUser() user: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      const job = await tx.jobs.findFirst({ where: { id: jobId, status: 'published' }, select: { id: true } });
      if (!job) throw new NotFoundException();
      await tx.saved_jobs.upsert({ where: { candidate_id_job_id: { candidate_id: user.id, job_id: jobId } }, create: { candidate_id: user.id, job_id: jobId }, update: {} });
      return { saved: true };
    });
  }

  @Delete('saved-jobs/:jobId')
  unsaveJob(@CurrentUser() user: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.db.asUser(user, async (tx) => {
      await tx.saved_jobs.deleteMany({ where: { candidate_id: user.id, job_id: jobId } });
      return { saved: false };
    });
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => {
      await refreshCandidateState(tx);
      return tx.notifications.findMany({ where: { user_id: user.id }, orderBy: { created_at: 'desc' }, take: 100 });
    });
  }

  @Get('notifications/unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, async (tx) => ({ unread: await tx.notifications.count({ where: { user_id: user.id, read_at: null } }) }));
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
