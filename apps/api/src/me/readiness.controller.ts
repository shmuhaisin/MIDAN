import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { evidenceFrom } from '../applications/ats';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class StartDto {
  @ApiProperty({ description: 'The job the candidate wants, in their own words.' }) @IsString() @MinLength(2) @MaxLength(120) target_title!: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

class AnswerDto {
  @ApiProperty() @Matches(/^Q[0-9]{1,2}$/) question_id!: string;
  @ApiProperty() @IsString() @MaxLength(6000) text!: string;
}

class AnswersDto {
  @ApiProperty({ type: [AnswerDto] }) @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => AnswerDto) answers!: AnswerDto[];
}

type Requirement = { key: string; name_ar: string; name_en: string; category: string; importance: string; proficiency: string; why_ar: string; why_en: string };
type Question = { id: string; kind: string; requirement_keys: string[]; prompt_ar: string; prompt_en: string; rubric_ar: string; rubric_en: string; minutes: number };
type Plan = { title_ar: string; title_en: string; summary_ar: string; summary_en: string; requirements: Requirement[]; questions: Question[]; provenance: Record<string, unknown> };
type Match = { key: string; status: 'matched' | 'partial' | 'missing' | 'needs_review'; evidence_text: string | null; evidence_source: string | null; reason_code: string };
type Row = { id: string; target_title: string; locale: string; status: string; plan: Plan; comparison: { matches: Match[]; summary: unknown; provenance: unknown };
  answers: { question_id: string; text: string }[] | null; evaluation: Record<string, unknown> | null; created_at: Date; evaluated_at: Date | null };

/**
 * Career readiness for a job the candidate types (مساري المهني): the target role's requirements and a practical readiness
 * assessment from the live model, the candidate's own profile compared with them by MIDAN's matching model (e5, the ATS's
 * rule), then the answers evaluated with a roadmap whose courses and certifications come only from the verified catalog.
 * Everything here is the candidate's own (row security: candidate_id = auth.uid()). Without a live model: 503 with the
 * reason, and nothing is stored.
 */
@ApiTags('career')
@ApiBearerAuth()
@UseGuards(AuthGuard)
// Each check spends the AI provider's tokens.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('me/career/readiness')
export class ReadinessController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get()
  @ApiOperation({ summary: "The candidate's readiness checks, newest first." })
  list(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) => tx.$queryRaw<Row[]>`
      select id, target_title, locale, status, plan, comparison, answers, evaluation, created_at, evaluated_at
      from public.career_readiness where candidate_id = auth.uid() order by created_at desc limit 10`);
  }

  @Get(':id')
  async one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withResources(user, await this.load(user, id));
  }

  @Post()
  @ApiOperation({ summary: 'Start a readiness check for a target job: requirements, the profile compared with them, and the practical questions.' })
  async start(@CurrentUser() user: AuthUser, @Body() body: StartDto) {
    const title = body.target_title.trim();
    const locale = body.locale ?? 'ar';
    const profile = await this.db.asUser(user, (tx) => tx.candidate_profiles.findUnique({
      where: { user_id: user.id },
      select: { headline: true, summary: true, experience: true, education: true, projects: true, courses: true, certifications: true, self_reported_skills: true, languages: true },
    }));
    const evidence = evidenceFrom(profile as never);
    const plan = await this.ai.careerPlan<Plan>({ target_title: title, locale, profile: evidence.map(({ id, source, text }) => ({ id, source, text })) });
    // The comparison is MIDAN's matching model on the candidate's own lines, the ATS's rule: never the model's guess.
    const comparison = evidence.length === 0
      ? { matches: plan.requirements.map((r) => ({ key: r.key, status: 'missing', evidence_text: null, evidence_source: null, reason_code: 'missing' })), summary: null, provenance: { provider: 'none', note: 'empty profile' } }
      : await this.ai.matchRequirements<{ matches: Match[]; summary: unknown; provenance: unknown }>({
        requirements: plan.requirements.map((r) => ({ key: r.key, text: `${r.name_ar} / ${r.name_en}`, mandatory: r.importance === 'core', min_years: null, skill_id: null })),
        evidence, mode: 'fast',
      }, 60_000);
    return this.db.asUser(user, async (tx) => {
      const [row] = await tx.$queryRaw<Row[]>`
        insert into public.career_readiness (candidate_id, target_title, locale, plan, comparison, provenance)
        values (auth.uid(), ${title}, ${locale}, ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(comparison)}::jsonb, ${JSON.stringify(plan.provenance)}::jsonb)
        returning id, target_title, locale, status, plan, comparison, answers, evaluation, created_at, evaluated_at`;
      // The target the rest of the career pages (and Humaidan) read, in the candidate's own words.
      await tx.career_targets.upsert({ where: { candidate_id: user.id }, create: { candidate_id: user.id, job_title: title }, update: { job_title: title, updated_at: new Date() } });
      return row;
    });
  }

  @Post(':id/answers')
  @ApiOperation({ summary: 'Submit the answers: each scored against its rubric, a readiness reading and a roadmap, with verified courses and certifications.' })
  async answer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: AnswersDto) {
    const row = await this.load(user, id);
    if (row.status === 'evaluated') throw new UnprocessableEntityException('This readiness check was already evaluated; start a new one');
    const known = new Set(row.plan.questions.map((q) => q.id));
    const answers = body.answers.filter((a) => known.has(a.question_id)).map((a) => ({ question_id: a.question_id, text: a.text.trim() }));
    if (!answers.some((a) => a.text.length >= 20)) throw new UnprocessableEntityException('Answer at least one question (20 characters or more)');
    const catalog = await this.db.asUser(user, (tx) => tx.$queryRaw<{ id: string; kind: 'course' | 'certification'; title: string; provider: string; skills: string[]; level: string | null }[]>`
      select id::text, kind, coalesce(title_en, title_ar) as title, provider, skills_en || skills_ar as skills, level from public.learning_resources`);
    const matches = new Map(row.comparison.matches.map((m) => [m.key, m]));
    const evaluation = await this.ai.careerEvaluate<Record<string, unknown>>({
      target_title: row.plan.title_en || row.target_title, locale: row.locale,
      requirements: row.plan.requirements.map((r) => ({ key: r.key, name_en: r.name_en, name_ar: r.name_ar, importance: r.importance,
        status: matches.get(r.key)?.status ?? 'needs_review', evidence_text: matches.get(r.key)?.evidence_text ?? null })),
      questions: row.plan.questions, answers, catalog,
    });
    const updated = await this.db.asUser(user, async (tx) => {
      const [out] = await tx.$queryRaw<Row[]>`
        update public.career_readiness set answers = ${JSON.stringify(answers)}::jsonb, evaluation = ${JSON.stringify(evaluation)}::jsonb, status = 'evaluated'
        where id = ${id}::uuid and candidate_id = auth.uid()
        returning id, target_title, locale, status, plan, comparison, answers, evaluation, created_at, evaluated_at`;
      return out;
    });
    return this.withResources(user, updated);
  }

  private async load(user: AuthUser, id: string) {
    const [row] = await this.db.asUser(user, (tx) => tx.$queryRaw<Row[]>`
      select id, target_title, locale, status, plan, comparison, answers, evaluation, created_at, evaluated_at
      from public.career_readiness where id = ${id}::uuid and candidate_id = auth.uid()`);
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The recommended catalog entries in full (title, provider, official link, what was verified), for the page. */
  private async withResources(user: AuthUser, row: Row) {
    const ev = row.evaluation as { recommendations?: { resource_id: string }[]; roadmap?: { resource_ids?: string[] }[] } | null;
    const ids = [...new Set([...(ev?.recommendations ?? []).map((r) => r.resource_id), ...(ev?.roadmap ?? []).flatMap((s) => s.resource_ids ?? [])])];
    const resources = ids.length === 0 ? [] : await this.db.asUser(user, (tx) => tx.$queryRaw<unknown[]>`
      select id::text, kind, title_ar, title_en, provider, url, verified_on, skills_en, skills_ar, level, duration, cost, prerequisites
      from public.learning_resources where id = any(${ids}::uuid[])`);
    return { ...row, resources };
  }
}
