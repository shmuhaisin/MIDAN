import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { applicantProfile, type ApplicantProfile } from '../common/applicant';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

const STATUSES = ['matched', 'partial', 'missing', 'needs_review'] as const;
type MatchStatus = (typeof STATUSES)[number];

class MatchReviewDto {
  @ApiProperty({ example: 'requirement:00000000-0000-4000-8000-000000000000' })
  @Matches(/^(requirement|skill):[0-9a-f-]{36}$/) requirement_key!: string;
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status!: MatchStatus;
  @ApiProperty({ enum: STATUSES, description: "MIDAN's proposal the reviewer saw; equal to status when confirming." }) @IsIn(STATUSES) proposed_status!: MatchStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) note?: string;
}

type Proposal = { key: string; status: MatchStatus; score: number; evidence_id: string | null; evidence_text: string | null; evidence_source: string | null; reason: string };
type AiMatch = { matches: Proposal[]; summary: { counts: Record<MatchStatus, number>; score: number | null; mandatory_missing: number }; provenance: Record<string, unknown> };
type Item = Record<string, unknown>;

const text = (...parts: unknown[]) => parts.filter((p) => typeof p === 'string' && p.trim()).join(' — ');
const list = (value: unknown) => (Array.isArray(value) ? (value as Item[]) : []);

/**
 * The evidence an organization may use: only what the applicant submitted with the application (the snapshot), as short
 * lines with their source. Contact details are never included.
 */
export function evidenceFrom(profile: ApplicantProfile | null) {
  if (!profile) return [];
  const now = new Date().getUTCFullYear();
  const lines: { id: string; text: string; source: string; skill_id?: string; years?: number }[] = [];
  const add = (source: string, i: number | string, line: string, extra: { skill_id?: string; years?: number } = {}) => {
    if (line.trim()) lines.push({ id: `${source}:${i}`, text: line.slice(0, 2000), source, ...extra });
  };
  if (profile.headline) add('headline', 0, String(profile.headline));
  if (typeof profile.summary === 'string') add('summary', 0, profile.summary);
  list(profile.experience).forEach((e, i) => {
    const start = typeof e.start_year === 'number' ? e.start_year : null;
    const end = typeof e.end_year === 'number' ? e.end_year : start ? now : null;
    // The position itself (title, organization), with its years, then each responsibility as its own line: one long line
    // per position dilutes the similarity of the sentence that actually shows a requirement. Only the position carries
    // years, so the years check counts each position once.
    const duties = typeof e.description === 'string' ? e.description.split('\n').map((d) => d.trim()).filter((d) => d.split(/\s+/).length >= 2) : [];
    add('experience', i, duties.length > 0 ? text(e.title, e.organization) : text(e.title, e.organization, e.description), start && end ? { years: Math.max(0, end - start) } : {});
    duties.forEach((d, j) => add('experience', `${i}:${j + 1}`, d));
  });
  list(profile.education).forEach((e, i) => add('education', i, text(e.qualification, e.field, e.institution)));
  list(profile.projects).forEach((p, i) => add('project', i, text(p.title, p.description)));
  list(profile.courses).forEach((c, i) => add('course', i, text(c.title, c.issuer, c.description)));
  list(profile.certifications).forEach((c, i) => add('certification', i, text(c.title, c.issuer, c.description)));
  (profile.skills ?? []).forEach((s, i) => add('skill', i, text(s.name_ar, s.name_en), { skill_id: s.id }));
  (profile.reference_skills ?? []).forEach((s, i) => add('reference_skill', i, s.name_ar));
  list(profile.self_reported_skills).forEach((s, i) => add('own_skill', i, String(s)));
  list(profile.languages).forEach((l, i) => add('language', i, text((l as Item).name, (l as Item).level)));
  return lines;
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
      const [requirements, skills, reviews] = await Promise.all([
        tx.job_requirements.findMany({
          where: { job_id: application.job_id, org_id: orgId, retired_at: null, review_status: 'approved', requirement_type: { not: 'daily_task' } },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: { id: true, requirement_type: true, description_ar: true, description_en: true, is_mandatory: true, min_years: true, skill_id: true },
        }),
        tx.job_skills.findMany({
          where: { job_id: application.job_id, org_id: orgId, is_required: true, review_status: 'approved' },
          select: { skill_id: true, required_level: true, skills: { select: { name_ar: true, name_en: true } } },
        }),
        tx.application_match_reviews.findMany({ where: { application_id: id, org_id: orgId }, orderBy: { created_at: 'desc' } }),
      ]);
      // The employer's accepted workbook skills and their own skills for this job are requirements too.
      const [reference, custom] = await Promise.all([
        tx.job_reference_skills.findMany({
          where: { job_id: application.job_id, org_id: orgId },
          select: { reference_skill_id: true, is_required: true, reference_skills: { select: { name_ar: true } } },
        }),
        tx.job_custom_skills.findMany({ where: { job_id: application.job_id, org_id: orgId }, select: { id: true, name_ar: true, name_en: true, is_required: true } }),
      ]);
      return { application, requirements, skills, reviews, reference, custom };
    });

    const items = [
      ...data.requirements.map((r) => ({
        key: `requirement:${r.id}`, kind: r.requirement_type as string, text_ar: r.description_ar, text_en: r.description_en,
        mandatory: r.is_mandatory, min_years: r.min_years === null ? null : Number(r.min_years), skill_id: r.skill_id,
      })),
      ...data.skills.map((s) => ({
        key: `skill:${s.skill_id}`, kind: 'skill', text_ar: s.skills.name_ar, text_en: s.skills.name_en,
        mandatory: true, min_years: null, skill_id: s.skill_id,
      })),
      ...data.reference.map((r) => ({
        key: `reference:${r.reference_skill_id}`, kind: 'skill', text_ar: r.reference_skills.name_ar, text_en: null as string | null,
        mandatory: r.is_required, min_years: null, skill_id: null as string | null,
      })),
      ...data.custom.map((c) => ({
        key: `custom:${c.id}`, kind: 'skill', text_ar: c.name_ar, text_en: c.name_en,
        mandatory: c.is_required, min_years: null, skill_id: null as string | null,
      })),
    ].filter((r) => r.text_ar || r.text_en);
    const evidence = evidenceFrom(applicantProfile(data.application.profile_snapshot));
    const result = items.length === 0 ? null : await this.ai.matchRequirements<AiMatch>({
      requirements: items.map((r) => ({ key: r.key, text: [r.text_ar, r.text_en].filter(Boolean).join(' / '), mandatory: r.mandatory, min_years: r.min_years, skill_id: r.skill_id })),
      evidence,
    });
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
