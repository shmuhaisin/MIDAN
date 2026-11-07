import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { applicantProfile } from '../common/applicant';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class NoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

class CompetencyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) label!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 4 }) @IsOptional() @IsInt() @Min(1) @Max(4) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) evidence?: string;
}

class FeedbackDto {
  @ApiProperty({ enum: ['draft', 'submitted'] }) @IsIn(['draft', 'submitted']) status!: 'draft' | 'submitted';
  @ApiPropertyOptional({ enum: ['strong_yes', 'yes', 'no', 'strong_no'], description: "The interviewer's own view. Not a decision." })
  @IsOptional() @IsIn(['strong_yes', 'yes', 'no', 'strong_no']) recommendation?: string;
  @ApiProperty({ type: [CompetencyDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CompetencyDto) competencies!: CompetencyDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) notes?: string;
}

type Named = { id: string; name_ar: string; name_en: string | null };
const same = (a: string) => a.trim().toLowerCase();

/**
 * One applicant, for the organization they applied to: what they gave the application, MIDAN's reviewed assessment
 * results, interviews and their feedback, the organization's notes and every status change. Nothing here is live
 * profile data, and nothing here decides anything: shortlisting, rejecting and hiring stay deliberate staff actions.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/applications/:applicationId')
export class ApplicationReviewController {
  constructor(private readonly db: DbService) {}

  @Get('review')
  @ApiOperation({ summary: 'Everything the organization holds about one application, for its staff only.' })
  review(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const application = await tx.applications.findFirst({
        where: { id, org_id: orgId, status: { not: 'withdrawn' } },
        select: {
          id: true, status: true, created_at: true, cover_note: true, profile_snapshot: true, cv_snapshot_path: true,
          jobs: {
            select: {
              id: true, title_ar: true, title_en: true,
              job_skills: { where: { review_status: 'approved' }, select: { is_required: true, skills: { select: { id: true, name_ar: true, name_en: true } } } },
              job_reference_skills: { select: { is_required: true, reference_skills: { select: { id: true, name_ar: true } } } },
            },
          },
          application_status_history: { orderBy: { created_at: 'asc' }, select: { id: true, from_status: true, to_status: true, changed_by: true, created_at: true } },
          hiring_outcomes: { orderBy: { issued_at: 'desc' }, select: { id: true, outcome: true, message_ar: true, message_en: true, issued_by: true, issued_at: true } },
          assessment_attempts: {
            orderBy: { created_at: 'asc' },
            select: {
              id: true, status: true, submitted_at: true,
              assessment_versions: { select: { version_number: true, assessments: { select: { title_ar: true, title_en: true } } } },
              evaluation_results: {
                select: {
                  id: true, status: true, overall_score: true, released_to_candidate: true, ai_mode: true,
                  skill_scores: { select: { level: true, source: true, skills: { select: { id: true, name_ar: true, name_en: true } } } },
                  reference_skill_scores: { orderBy: { score_pct: 'desc' }, select: { score_pct: true, reference_skills: { select: { id: true, name_ar: true } } } },
                  criterion_scores: {
                    select: {
                      score: true, source: true, explanation: true, evidence_ref: true,
                      rubric_criteria: { select: { code: true, description_ar: true, description_en: true, max_score: true } },
                    },
                  },
                  evaluation_reviews: { orderBy: { created_at: 'desc' }, select: { notes: true, reviewer_id: true, created_at: true } },
                },
              },
            },
          },
          interviews: {
            orderBy: { scheduled_at: 'desc' },
            select: {
              id: true, scheduled_at: true, duration_minutes: true, time_zone: true, status: true, calendar_status: true, reschedule_note: true, created_by: true,
              interview_participants: { select: { user_id: true } },
              interview_events: { orderBy: { created_at: 'asc' }, select: { kind: true, scheduled_at: true, created_at: true } },
            },
          },
        },
      });
      if (!application) throw new NotFoundException();
      const [notes, feedback, team, membership] = await Promise.all([
        tx.application_notes.findMany({ where: { application_id: id }, orderBy: { created_at: 'desc' }, select: { id: true, body: true, author_id: true, created_at: true } }),
        // Row security returns submitted feedback, and the caller's own drafts.
        tx.interview_feedback.findMany({ where: { application_id: id }, orderBy: { created_at: 'asc' } }),
        tx.$queryRaw<{ user_id: string; email: string; display_name: string | null; role: string }[]>`select user_id, email, display_name, role::text from public.organization_team(${orgId}::uuid)`,
        tx.organization_members.findFirst({ where: { org_id: orgId, user_id: user.id }, select: { role: true } }),
      ]);

      const { cv_snapshot_path, profile_snapshot, jobs, ...rest } = application;
      const profile = applicantProfile(profile_snapshot);
      const { skills = [], reference_skills = [], email = null, ...fields } = profile ?? {};

      // Required skills the candidate listed when applying, or showed in a reviewed assessment of this application.
      // A listed skill is the candidate's own statement, not verified. It isn't a score, a ranking or a prediction.
      const reviewed = application.assessment_attempts.flatMap((a) => (a.evaluation_results?.status === 'reviewed' ? a.evaluation_results.skill_scores : []));
      const assessed = new Set(reviewed.filter((s) => s.level >= 3).map((s) => s.skills.id));
      const listedIds = new Set([...skills.map((s) => s.id), ...reference_skills.map((s) => s.id)]);
      const ownWords = new Set(((fields.self_reported_skills as string[] | undefined) ?? []).map(same));
      const required: Named[] = [
        ...jobs.job_skills.filter((s) => s.is_required).map((s) => s.skills),
        ...jobs.job_reference_skills.filter((s) => s.is_required).map((s) => ({ ...s.reference_skills, name_en: null })),
      ];
      const evidence = (s: Named) =>
        assessed.has(s.id) ? 'assessed' : listedIds.has(s.id) || ownWords.has(same(s.name_ar)) || (s.name_en && ownWords.has(same(s.name_en))) ? 'listed' : null;
      const matched = required.filter((s) => evidence(s)).map((s) => ({ ...s, evidence: evidence(s) }));

      const people = new Map(team.map((m) => [m.user_id, { user_id: m.user_id, email: m.email, display_name: m.display_name, role: m.role }]));
      const person = (userId: string | null) => (userId ? people.get(userId) ?? { user_id: userId, email: null, display_name: null, role: null } : null);
      return {
        ...rest,
        job: { id: jobs.id, title_ar: jobs.title_ar, title_en: jobs.title_en },
        my_role: membership?.role ?? null,
        my_user_id: user.id,
        has_cv: Boolean(cv_snapshot_path),
        captured_at: profile?.captured_at ?? null,
        profile: profile ? { ...fields, email } : null,
        skills: { listed: skills, reference: reference_skills },
        relevance: {
          total: required.length,
          matched,
          gaps: required.filter((s) => !evidence(s)),
        },
        application_status_history: application.application_status_history.map((h) => ({ ...h, changed_by: person(h.changed_by) })),
        hiring_outcomes: application.hiring_outcomes.map((o) => ({ ...o, issued_by: person(o.issued_by) })),
        interviews: application.interviews.map(({ interview_participants, ...i }) => ({
          ...i,
          participants: interview_participants.map((p) => person(p.user_id)),
          feedback: feedback.filter((f) => f.interview_id === i.id).map((f) => ({ ...f, author: person(f.author_id) })),
        })),
        notes: notes.map((n) => ({ ...n, author: person(n.author_id) })),
        team: team.map((m) => people.get(m.user_id)),
      };
    });
  }

  @Post('notes')
  @ApiOperation({ summary: 'A note for the organization only. Notes are kept as written: nobody edits or deletes one.' })
  addNote(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const application = await tx.applications.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!application) throw new NotFoundException();
      return tx.application_notes.create({ data: { application_id: id, org_id: orgId, author_id: user.id, body: body.body.trim() } });
    });
  }

  @Put('interviews/:interviewId/feedback')
  @ApiOperation({
    summary: "Saves the caller's own feedback on an interview they took part in: as a draft, or submitted for good.",
    description: 'Separate from the technical assessment, and never a decision: the hiring decision is an outcome a person issues.',
  })
  saveFeedback(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() body: FeedbackDto,
  ) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const interview = await tx.interviews.findFirst({ where: { id: interviewId, application_id: applicationId, org_id: orgId }, select: { id: true } });
      if (!interview) throw new NotFoundException();
      const data = {
        status: body.status,
        recommendation: body.recommendation ?? null,
        competencies: body.competencies.map((c) => ({ label: c.label.trim(), rating: c.rating ?? null, evidence: c.evidence?.trim() ?? '' })),
        notes: body.notes?.trim() || null,
      };
      const mine = await tx.interview_feedback.findFirst({ where: { interview_id: interviewId, author_id: user.id }, select: { id: true, status: true } });
      if (mine?.status === 'submitted') throw new UnprocessableEntityException("Submitted feedback can't be changed");
      // The database checks the rest: participants only, drafts only, everything rated before submitting.
      return mine
        ? tx.interview_feedback.update({ where: { id: mine.id }, data })
        : tx.interview_feedback.create({ data: { ...data, interview_id: interviewId, org_id: orgId, application_id: applicationId, author_id: user.id } });
    });
  }
}
