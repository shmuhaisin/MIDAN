import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, ServiceUnavailableException, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';
import { CalendarClient, DailyClient } from './video-and-calendar';
import { assertInterviewCandidateShortlisted, futureInterviewTime } from './interview-rules';

class ScheduleDto {
  @ApiProperty({ description: 'ISO-8601 timestamp with Z or an explicit UTC offset.' }) @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) scheduled_at!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(480) duration_minutes?: number;
  @ApiPropertyOptional({ default: 'Asia/Riyadh', enum: ['Asia/Riyadh'], description: 'MIDAN interviews use Saudi Arabia time consistently.' }) @IsOptional() @IsIn(['Asia/Riyadh']) time_zone?: 'Asia/Riyadh';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) instructions_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) instructions_en?: string;
  @ApiPropertyOptional({ description: 'Members who interview with the scheduler. Only participants can join the room.' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) interviewer_ids?: string[];
}

class UpdateInterviewDto {
  @ApiPropertyOptional({ description: 'ISO-8601 timestamp with Z or an explicit UTC offset.' }) @IsOptional() @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) scheduled_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(480) duration_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['cancelled', 'completed', 'no_show']) status?: 'cancelled' | 'completed' | 'no_show';
  @ApiPropertyOptional({ description: 'Replaces the interviewers. Whoever scheduled the interview always stays.' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) interviewer_ids?: string[];
}

class RespondDto {
  @ApiProperty() @IsIn(['accept', 'request_reschedule']) action!: 'accept' | 'request_reschedule';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class OutcomeDto {
  @ApiProperty() @IsIn(['hired', 'not_selected', 'on_hold', 'additional_interview']) outcome!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message_ar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message_en?: string;
}

const EARLY_MS = 15 * 60_000;
const LATE_MS = 60 * 60_000;

const CANDIDATE_VIEW = {
  id: true, application_id: true, candidate_id: true, org_id: true, scheduled_at: true, duration_minutes: true, time_zone: true, instructions_ar: true, instructions_en: true,
  status: true, reschedule_note: true, calendar_status: true, updated_at: true,
  applications: { select: { jobs: { select: { title_ar: true, title_en: true, organizations: { select: { name_ar: true, name_en: true } } } } } },
  interview_events: { orderBy: { created_at: 'asc' }, select: { kind: true, scheduled_at: true, created_at: true } },
} as const;

function joinWindow(start: Date, minutes: number) {
  return { opens: new Date(start.getTime() - EARLY_MS), closes: new Date(start.getTime() + minutes * 60_000 + LATE_MS) };
}

@ApiTags('interviews')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class InterviewsController {
  constructor(private readonly db: DbService, private readonly daily: DailyClient, private readonly calendar: CalendarClient) {}

  private async syncCalendar(user: AuthUser, id: string) {
    const details = await this.db.asUser(user, (tx) =>
      tx.interviews.findUniqueOrThrow({
        where: { id },
        select: {
          id: true, org_id: true, scheduled_at: true, duration_minutes: true, time_zone: true, calendar_event_id: true, status: true,
          users_interviews_candidate_idTousers: { select: { email: true } },
          interview_participants: { select: { user_id: true } },
          applications: { select: { jobs: { select: { title_ar: true, organizations: { select: { name_ar: true } } } } } },
        },
      }),
    );
    if (details.status === 'cancelled') {
      const cancelled = details.calendar_event_id ? await this.calendar.cancel(details.calendar_event_id) : !this.calendar.configured;
      const calendar_status = details.calendar_event_id ? (cancelled ? 'sent' : 'failed') : 'not_configured';
      return this.db.asUser(user, (tx) => tx.interviews.update({ where: { id }, data: { calendar_status } }));
    }
    const job = details.applications.jobs;
    // Attendees: the candidate and everyone taking part, whoever saved last.
    const team = await this.db.asUser(user, (tx) => tx.$queryRaw<{ user_id: string; email: string }[]>`select user_id, email from public.organization_team(${details.org_id}::uuid)`);
    const taking = new Set(details.interview_participants.map((p) => p.user_id));
    const result = await this.calendar.save({
      id: details.calendar_event_id ?? undefined,
      interviewId: id,
      title: `${job.title_ar} — ${job.organizations.name_ar}`,
      start: details.scheduled_at,
      minutes: details.duration_minutes,
      timeZone: details.time_zone,
      attendees: [details.users_interviews_candidate_idTousers.email, ...team.filter((m) => taking.has(m.user_id)).map((m) => m.email)],
      link: `${process.env.APP_URL}/interviews/${id}`,
    });
    return this.db.asUser(user, (tx) =>
      tx.interviews.update({ where: { id }, data: { calendar_status: result.status, calendar_event_id: result.eventId ?? details.calendar_event_id } }),
    );
  }

  @Get('me/interviews')
  mine(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.interviews.findMany({ where: { candidate_id: user.id }, orderBy: { scheduled_at: 'desc' }, select: CANDIDATE_VIEW }));
  }

  @Get('interviews/:id')
  @ApiOperation({ summary: 'One interview, for its candidate or a member of its organization.' })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const interview = await this.db.asUser(user, (tx) => tx.interviews.findFirst({ where: { id }, select: CANDIDATE_VIEW }));
    if (!interview) throw new NotFoundException();
    const { opens, closes } = joinWindow(interview.scheduled_at, interview.duration_minutes);
    const [{ allowed }] = await this.db.asUser(user, (tx) => tx.$queryRaw<{ allowed: boolean }[]>`select public.can_join_interview(${id}::uuid) as allowed`);
    return { ...interview, join_opens_at: opens, join_closes_at: closes, video_available: this.daily.configured, is_candidate: interview.candidate_id === user.id, is_participant: allowed };
  }

  @Post('interviews/:id/respond')
  async respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RespondDto) {
    await this.db.asUser(user, (tx) => tx.$queryRaw`select id from public.respond_to_interview(${id}::uuid, ${body.action}, ${body.note ?? null})`);
    return this.db.asUser(user, (tx) => tx.interviews.findUniqueOrThrow({ where: { id }, select: CANDIDATE_VIEW }));
  }

  /**
   * Checks who is asking and when, then issues a short-lived token for this interview's room only.
   * Leaving the call changes nothing: an interview is completed only when the organization says so.
   */
  @Post('interviews/:id/join')
  async join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const interview = await this.db.asUser(user, async (tx) => {
      const found = await tx.interviews.findFirst({ where: { id }, select: { candidate_id: true, org_id: true, status: true, scheduled_at: true, duration_minutes: true } });
      if (!found) throw new NotFoundException();
      const profile = await tx.users.findUnique({ where: { id: user.id }, select: { display_name: true, candidate_profiles: { select: { full_name: true } } } });
      // The candidate, or one of the interview's participants who is still a member. Seeing the interview isn't enough.
      const [{ allowed }] = await tx.$queryRaw<{ allowed: boolean }[]>`select public.can_join_interview(${id}::uuid) as allowed`;
      if (!allowed) throw new ForbiddenException("Only this interview's participants can join");
      return { ...found, name: profile?.candidate_profiles?.full_name ?? profile?.display_name ?? '' };
    });
    const candidate = interview.candidate_id === user.id;
    if (candidate ? interview.status !== 'accepted' : !['invited', 'accepted', 'reschedule_requested'].includes(interview.status)) {
      throw new ForbiddenException('This interview is not open to join');
    }
    const { opens, closes } = joinWindow(interview.scheduled_at, interview.duration_minutes);
    const now = Date.now();
    if (now < opens.getTime() || now > closes.getTime()) throw new ForbiddenException('The interview is not open to join at this time');
    if (!this.daily.configured) throw new ServiceUnavailableException('Video is not configured');
    const room = `midan-${id}`;
    const url = await this.daily.ensureRoom(room, closes);
    const expires = new Date(Math.min(closes.getTime(), now + 2 * 60 * 60_000));
    return { room_url: url, token: await this.daily.token(room, interview.name, expires, !candidate), expires_at: expires };
  }

  @Post('organizations/:orgId/applications/:applicationId/interviews')
  async schedule(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) applicationId: string, @Body() body: ScheduleDto) {
    const when = futureInterviewTime(body.scheduled_at);
    const created = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const application = await tx.applications.findFirst({ where: { id: applicationId, org_id: orgId }, select: { candidate_id: true, status: true } });
      if (!application) throw new NotFoundException();
      // Defense in depth: the database trigger enforces this too, including writes outside this controller.
      assertInterviewCandidateShortlisted(application.status);
      const duplicate = await tx.interviews.findFirst({
        where: { application_id: applicationId, org_id: orgId, scheduled_at: when, status: { in: ['invited', 'accepted', 'reschedule_requested'] } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('An active interview already exists for this application at this time');
      const { interviewer_ids = [], ...fields } = body;
      const interview = await tx.interviews.create({
        data: { ...fields, scheduled_at: when, application_id: applicationId, org_id: orgId, candidate_id: application.candidate_id, calendar_status: 'pending' },
      });
      // The scheduler is added by the database. Anyone else must be a member: the database refuses otherwise.
      await tx.interview_participants.createMany({
        data: [...new Set(interviewer_ids)].filter((id) => id !== user.id).map((id) => ({ interview_id: interview.id, org_id: orgId, user_id: id })),
      });
      return interview;
    });
    return this.syncCalendar(user, created.id);
  }

  @Patch('organizations/:orgId/interviews/:id')
  @ApiOperation({ summary: 'A new time asks the candidate to accept again. Completion is set here, never by leaving a call.' })
  async update(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateInterviewDto) {
    const needsCalendar = Boolean(body.scheduled_at || body.duration_minutes || body.status === 'cancelled' || body.interviewer_ids);
    if (body.scheduled_at) futureInterviewTime(body.scheduled_at);
    const { scheduled_at, interviewer_ids, ...rest } = body;
    const updated = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const { count } = await tx.interviews.updateMany({
        where: { id, org_id: orgId },
        data: { ...rest, ...(scheduled_at && { scheduled_at: new Date(scheduled_at) }), ...(needsCalendar && { calendar_status: 'pending' }) },
      });
      if (count === 0) throw new NotFoundException();
      const saved = await tx.interviews.findUniqueOrThrow({ where: { id } });
      if (interviewer_ids) {
        const keep = new Set([...interviewer_ids, ...(saved.created_by ? [saved.created_by] : [])]);
        await tx.interview_participants.deleteMany({ where: { interview_id: id, user_id: { notIn: [...keep] } } });
        await tx.interview_participants.createMany({
          data: [...keep].map((userId) => ({ interview_id: id, org_id: orgId, user_id: userId })),
          skipDuplicates: true,
        });
      }
      return saved;
    });
    return needsCalendar ? this.syncCalendar(user, id) : updated;
  }

  @Post('organizations/:orgId/interviews/:id/calendar-retry')
  async retryCalendar(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const found = await tx.interviews.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
    });
    return this.syncCalendar(user, id);
  }

  @Get('organizations/:orgId/integrations')
  @ApiOperation({ summary: "Whether Google Calendar and video are configured on this server, for the organization's staff. Booleans only: never a credential." })
  integrations(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return { calendar: this.calendar.configured, video: this.daily.configured };
    });
  }

  @Get('organizations/:orgId/applications/:applicationId/interviews')
  forApplication(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return {
        interviews: await tx.interviews.findMany({
          where: { application_id: applicationId, org_id: orgId },
          orderBy: { scheduled_at: 'desc' },
          include: { interview_participants: { select: { user_id: true } } },
        }),
        outcomes: await tx.hiring_outcomes.findMany({ where: { application_id: applicationId, org_id: orgId }, orderBy: { issued_at: 'desc' } }),
      };
    });
  }

  @Post('organizations/:orgId/applications/:applicationId/outcome')
  @ApiOperation({ summary: "The organization's decision. It's written by a person, and what's here is what the candidate reads." })
  outcome(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('applicationId', ParseUUIDPipe) applicationId: string, @Body() body: OutcomeDto) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId, BUILDERS);
      const application = await tx.applications.findFirst({ where: { id: applicationId, org_id: orgId }, select: { candidate_id: true } });
      if (!application) throw new NotFoundException();
      return tx.hiring_outcomes.create({ data: { ...body, application_id: applicationId, org_id: orgId, candidate_id: application.candidate_id } });
    });
  }
}
