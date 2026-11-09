import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { applicantProfile } from '../common/applicant';
import { requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class TurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @ApiProperty() @IsString() @MaxLength(2000) text!: string;
}

class AskDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) question!: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @ApiPropertyOptional({ type: [TurnDto] }) @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => TurnDto) history?: TurnDto[];
}

type Fact = { id: string; text: string };
type Link = { key: string; href: string; label: string };

/** Readable names for stored statuses, so an answer never repeats a database value. */
const LABELS: Record<string, [string, string]> = {
  submitted: ['مُقدَّم', 'submitted'], under_review: ['قيد المراجعة', 'under review'], assessment_invited: ['بانتظار التقييم', 'assessment to do'],
  assessment_in_progress: ['التقييم جارٍ', 'assessment in progress'], assessment_submitted: ['التقييم مُسلَّم', 'assessment submitted'],
  evaluated: ['تم التقييم', 'evaluated'], shortlisted: ['في القائمة المختصرة', 'shortlisted'], hired: ['تم التوظيف', 'hired'],
  rejected: ['لم يُختر', 'not selected'], withdrawn: ['مسحوب', 'withdrawn'], invited: ['مدعو', 'invited'], in_progress: ['جارٍ', 'in progress'],
  accepted: ['مقبول', 'accepted'], reschedule_requested: ['طُلب موعد آخر', 'new time requested'], cancelled: ['ملغى', 'cancelled'],
  completed: ['مكتمل', 'completed'], no_show: ['لم يحضر', 'no show'], expired: ['انتهى موعده', 'expired'], not_started: ['لم يبدأ', 'not started'],
  draft: ['مسودة', 'draft'], published: ['منشورة', 'published'], closed: ['مغلقة', 'closed'],
};

/** Short, plain facts in the asker's language. Dates in their time zone. */
function phrasing(locale: 'ar' | 'en', timeZone = 'Asia/Riyadh') {
  const ar = locale === 'ar';
  const label = (status: string) => LABELS[status]?.[ar ? 0 : 1] ?? status.replace(/_/g, ' ');
  const pick = (a?: string | null, e?: string | null) => (ar ? a || e : e || a) ?? '';
  const when = (d: Date) => new Intl.DateTimeFormat(ar ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat(ar ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeZone }).format(d);
  return { ar, pick, when, day, label };
}

/**
 * MIDAN's assistant. The facts it may use are retrieved here, with the asker's own permissions (row-level security and
 * the same role checks as the pages), and only those facts and in-app links reach the AI service. It answers; it never
 * acts: anything consequential is a link to the page where the person does it and confirms it.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(AuthGuard)
// Tighter than the platform's 300 a minute: each question can spend the AI provider's per-minute tokens.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller()
export class AssistantController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Post('me/assistant')
  @ApiOperation({ summary: "Answers a candidate's question from their own profile, career plan, applications, assessments and interviews." })
  async candidate(@CurrentUser() user: AuthUser, @Body() body: AskDto) {
    const locale = body.locale ?? 'ar';
    const { facts, links } = await this.db.asUser(user, async (tx) => {
      const profile = await tx.candidate_profiles.findUnique({ where: { user_id: user.id }, select: { headline: true, time_zone: true, onboarding_completed_at: true, self_reported_skills: true } });
      const { pick, when, day, ar, label } = phrasing(locale, profile?.time_zone ?? 'Asia/Riyadh');
      const [applications, interviews, target, plan, practice, unread, listed] = await Promise.all([
        tx.applications.findMany({
          where: { candidate_id: user.id }, orderBy: { created_at: 'desc' }, take: 20,
          select: {
            id: true, status: true, created_at: true,
            jobs: { select: { title_ar: true, title_en: true, organizations: { select: { name_ar: true, name_en: true } } } },
            assessment_attempts: { select: { id: true, status: true, deadline_at: true, evaluation_results: { select: { released_to_candidate: true } } } },
          },
        }),
        tx.interviews.findMany({ where: { candidate_id: user.id, scheduled_at: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { scheduled_at: 'asc' }, take: 10,
          select: { id: true, scheduled_at: true, status: true, duration_minutes: true, applications: { select: { jobs: { select: { title_ar: true, title_en: true } } } } } }),
        tx.career_targets.findUnique({ where: { candidate_id: user.id } }),
        tx.career_plan_items.findMany({ where: { candidate_id: user.id }, select: { kind: true, status: true, reference_skills: { select: { name_ar: true } } } }),
        tx.practice_tasks.findMany({ where: { candidate_id: user.id }, select: { title_ar: true, title_en: true, status: true } }),
        tx.notifications.count({ where: { user_id: user.id, read_at: null } }),
        tx.candidate_reference_skills.count({ where: { candidate_id: user.id } }),
      ]);
      const facts: Fact[] = [];
      const links: Link[] = [
        { key: 'applications', href: '/applications', label: ar ? 'طلباتي' : 'My applications' },
        { key: 'assessments', href: '/assessments', label: ar ? 'تقييماتي' : 'My assessments' },
        { key: 'career', href: '/development', label: ar ? 'مساري المهني' : 'My career' },
        { key: 'skills', href: '/development/skills', label: ar ? 'المهارات والفجوات' : 'Skills and gaps' },
        { key: 'opportunities', href: '/opportunities', label: ar ? 'الفرص' : 'Opportunities' },
        { key: 'profile', href: '/profile', label: ar ? 'ملفي' : 'My profile' },
      ];
      facts.push({ id: 'profile', text: ar
        ? `الملف: ${profile ? `العنوان المهني «${profile.headline ?? 'غير مضاف'}»، ${listed} مهارة من المصنفات، والتسجيل ${profile.onboarding_completed_at ? 'مكتمل' : 'غير مكتمل'}` : 'لم يُنشأ الملف بعد'}.`
        : `Profile: ${profile ? `headline "${profile.headline ?? 'not added'}", ${listed} skills from the sector databases, onboarding ${profile.onboarding_completed_at ? 'complete' : 'not complete'}` : 'not created yet'}.` });
      for (const a of applications) {
        const title = pick(a.jobs.title_ar, a.jobs.title_en);
        const org = pick(a.jobs.organizations.name_ar, a.jobs.organizations.name_en);
        const attempts = a.assessment_attempts.map((t) => `${label(t.status)}${t.deadline_at ? (ar ? ` (الموعد النهائي ${day(t.deadline_at)})` : ` (deadline ${day(t.deadline_at)})`) : ''}${t.evaluation_results?.released_to_candidate ? (ar ? '، النتيجة صادرة' : ', result released') : ''}`).join('; ');
        facts.push({ id: `application:${a.id}`, text: ar
          ? `طلب لوظيفة ${title} لدى ${org}، قُدّم ${day(a.created_at)}، الحالة: ${label(a.status)}${attempts ? `، التقييمات: ${attempts}` : ''}.`
          : `Application for ${title} at ${org}, sent ${day(a.created_at)}, status: ${label(a.status)}${attempts ? `; assessments: ${attempts}` : ''}.` });
        links.push({ key: `application:${a.id}`, href: `/applications/${a.id}`, label: title });
      }
      for (const i of interviews) {
        const title = pick(i.applications.jobs.title_ar, i.applications.jobs.title_en);
        facts.push({ id: `interview:${i.id}`, text: ar
          ? `مقابلة لوظيفة ${title} في ${when(i.scheduled_at)} لمدة ${i.duration_minutes} دقيقة، الحالة: ${label(i.status)}.`
          : `Interview for ${title} on ${when(i.scheduled_at)}, ${i.duration_minutes} minutes, status: ${label(i.status)}.` });
        links.push({ key: `interview:${i.id}`, href: `/interviews/${i.id}`, label: title });
      }
      if (target) facts.push({ id: 'target', text: ar
        ? `الوجهة المهنية: ${[target.job_title, target.job_family_ar].filter(Boolean).join(' / ')}.`
        : `Career destination: ${[target.job_title, target.job_family_ar].filter(Boolean).join(' / ')}.` });
      if (target?.job_family_ar && target.sector_code) {
        const gaps = await tx.reference_skills.findMany({
          where: { sector_code: target.sector_code, skill_kind: 'technical', reference_skill_contexts: { some: { job_family_ar: target.job_family_ar } },
            NOT: { candidate_reference_skills: { some: { candidate_id: user.id } } } },
          orderBy: [{ is_priority: { sort: 'desc', nulls: 'last' } }, { name_ar: 'asc' }], take: 6, select: { name_ar: true, is_priority: true },
        });
        if (gaps.length) facts.push({ id: 'gaps', text: ar
          ? `مهارات في الدور المستهدف بلا دليل بعد (ذات الأولوية أولًا): ${gaps.map((g) => g.name_ar).join('، ')}.`
          : `Target-role skills with no evidence yet (priority first): ${gaps.map((g) => g.name_ar).join(', ')}.` });
      }
      if (plan.length) facts.push({ id: 'plan', text: ar
        ? `الخطة: ${plan.length} نشاط، منها ${plan.filter((p) => p.status === 'completed').length} مكتمل و${plan.filter((p) => p.status === 'in_progress').length} قيد التنفيذ.`
        : `Plan: ${plan.length} activities, ${plan.filter((p) => p.status === 'completed').length} completed and ${plan.filter((p) => p.status === 'in_progress').length} in progress.` });
      for (const [k, p] of practice.entries()) facts.push({ id: `practice:${k}`, text: ar ? `مهمة تطبيق: ${p.title_ar}، الحالة: ${label(p.status)}.` : `Practice task: ${p.title_en}, status: ${label(p.status)}.` });
      facts.push({ id: 'unread', text: ar ? `إشعارات غير مقروءة: ${unread}.` : `Unread notifications: ${unread}.` });
      return { facts, links };
    });
    return this.ai.answerQuestion({ role: 'candidate', locale, question: body.question, facts, links, history: body.history ?? [] });
  }

  @Post('organizations/:orgId/assistant')
  @ApiOperation({ summary: "Answers a staff member's question from their own organization's jobs, applicants, assessments and interviews." })
  async organization(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: AskDto) {
    const locale = body.locale ?? 'ar';
    const { pick, when, ar, label } = phrasing(locale);
    const { facts, links } = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const [org, jobs, applications, interviews, reviews] = await Promise.all([
        tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { name_ar: true, name_en: true } }),
        tx.jobs.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' }, take: 30, select: { id: true, title_ar: true, title_en: true, status: true } }),
        tx.applications.findMany({ where: { org_id: orgId, status: { not: 'withdrawn' } }, take: 300,
          select: { id: true, status: true, job_id: true, profile_snapshot: true, cv_snapshot_path: true, assessment_attempts: { select: { status: true } } } }),
        tx.interviews.findMany({ where: { org_id: orgId, scheduled_at: { gte: new Date(Date.now() - 86_400_000) }, status: { not: 'cancelled' } }, orderBy: { scheduled_at: 'asc' }, take: 15,
          select: { id: true, scheduled_at: true, status: true, application_id: true } }),
        tx.evaluation_results.findMany({ where: { org_id: orgId, status: 'needs_human_review' }, take: 30,
          select: { attempt_id: true, assessment_attempts: { select: { application_id: true } } } }),
      ]);
      const name = (id: string) => applicantProfile(applications.find((a) => a.id === id)?.profile_snapshot ?? null)?.full_name ?? (ar ? 'متقدم' : 'An applicant');
      const jobTitle = (id: string) => { const j = jobs.find((x) => x.id === id); return j ? pick(j.title_ar, j.title_en) : ''; };
      const base = `/organization/${orgId}`;
      const facts: Fact[] = [{ id: 'org', text: ar ? `المنشأة: ${pick(org.name_ar, org.name_en)}، ${jobs.length} وظيفة و${applications.length} طلبًا نشطًا.` : `Organization: ${pick(org.name_ar, org.name_en)}, ${jobs.length} jobs and ${applications.length} active applications.` }];
      const links: Link[] = [
        { key: 'jobs', href: `${base}/jobs`, label: ar ? 'الوظائف' : 'Jobs' },
        { key: 'candidates', href: `${base}/candidates`, label: ar ? 'المرشحون' : 'Candidates' },
        { key: 'assessments', href: `${base}/assessments`, label: ar ? 'التقييمات' : 'Assessments' },
        { key: 'interviews', href: `${base}/interviews`, label: ar ? 'المقابلات' : 'Interviews' },
        { key: 'hiring', href: `${base}/hiring`, label: ar ? 'التوظيف' : 'Hiring' },
      ];
      for (const j of jobs) {
        const apps = applications.filter((a) => a.job_id === j.id);
        const byStatus = Object.entries(apps.reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {})).map(([s, c]) => `${label(s)} ${c}`).join(ar ? '، ' : ', ');
        facts.push({ id: `job:${j.id}`, text: ar ? `وظيفة ${pick(j.title_ar, j.title_en)}: الحالة ${label(j.status)}، ${apps.length} طلب${byStatus ? ` (${byStatus})` : ''}.` : `Job ${pick(j.title_ar, j.title_en)}: ${label(j.status)}, ${apps.length} applications${byStatus ? ` (${byStatus})` : ''}.` });
        links.push({ key: `job:${j.id}`, href: `${base}/jobs/${j.id}`, label: pick(j.title_ar, j.title_en) });
      }
      for (const r of reviews) {
        const app = r.assessment_attempts.application_id;
        facts.push({ id: `review:${r.attempt_id}`, text: ar ? `عمل ${name(app)} في التقييم بانتظار مراجعة شخص.` : `${name(app)}'s assessment work is waiting for a person's review.` });
        links.push({ key: `review:${r.attempt_id}`, href: `${base}/review/${r.attempt_id}`, label: name(app) });
      }
      const shortlisted = applications.filter((a) => a.status === 'shortlisted' && !interviews.some((i) => i.application_id === a.id));
      for (const a of shortlisted.slice(0, 10)) {
        facts.push({ id: `shortlisted:${a.id}`, text: ar ? `${name(a.id)} في القائمة المختصرة لوظيفة ${jobTitle(a.job_id)} ولا توجد له مقابلة مجدولة.` : `${name(a.id)} is shortlisted for ${jobTitle(a.job_id)} with no interview scheduled.` });
        links.push({ key: `applicant:${a.id}`, href: `${base}/applicants/${a.id}`, label: name(a.id) });
      }
      const waiting = applications.filter((a) => a.assessment_attempts.some((t) => t.status === 'invited' || t.status === 'in_progress'));
      if (waiting.length) facts.push({ id: 'pending-work', text: ar ? `${waiting.length} متقدمًا لم يسلّموا تقييمهم بعد.` : `${waiting.length} applicants haven't submitted their assessment yet.` });
      const noCv = applications.filter((a) => !a.cv_snapshot_path).length;
      if (noCv) facts.push({ id: 'no-cv', text: ar ? `${noCv} طلبًا بلا سيرة ذاتية مشاركة.` : `${noCv} applications have no shared CV.` });
      for (const i of interviews) {
        facts.push({ id: `interview:${i.id}`, text: ar ? `مقابلة مع ${name(i.application_id)} في ${when(i.scheduled_at)}، الحالة: ${label(i.status)}.` : `Interview with ${name(i.application_id)} on ${when(i.scheduled_at)}, status: ${label(i.status)}.` });
      }
      return { facts, links };
    });
    return this.ai.answerQuestion({ role: 'employer', locale, question: body.question, facts, links, history: body.history ?? [] });
  }
}
