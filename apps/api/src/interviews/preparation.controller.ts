import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { jobMatchItems, matchSnapshot, type MatchItem } from '../applications/ats';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { requireRole } from '../common/roles';
import { AuthUser, DbService, type Tx } from '../db/db.service';

class PrepareDto {
  @ApiProperty({ enum: ['questions', 'evaluation_form'] }) @IsIn(['questions', 'evaluation_form']) kind!: 'questions' | 'evaluation_form';
}

type Fact = { id: string; kind: string; text: string; requirement_key?: string };
type Row = { id: string; kind: string; content: unknown; facts: unknown; provenance: unknown; created_by: string; created_at: Date };

const label = (r: MatchItem) => [r.text_en, r.text_ar].filter(Boolean).join(' / ');

/**
 * What MIDAN's model may know about one interview: numbered facts, read here with the staff member's own permissions.
 * The job's approved requirements, the company's context, the CV match (MIDAN's matching model, on the application's
 * snapshot) and the person-reviewed assessment results. Nothing else about the candidate, and never their contact details.
 */
async function interviewFacts(tx: Tx, ai: AiClient, orgId: string, interviewId: string) {
  const interview = await tx.interviews.findFirst({
    where: { id: interviewId, org_id: orgId },
    select: {
      id: true, application_id: true,
      applications: {
        select: {
          job_id: true, profile_snapshot: true,
          jobs: { select: { title_ar: true, title_en: true, experience_level: true, sector: true } },
          assessment_attempts: {
            select: {
              evaluation_results: {
                select: {
                  status: true, overall_score: true,
                  criterion_scores: { select: { score: true, explanation: true, rubric_criteria: { select: { code: true, description_en: true, description_ar: true, max_score: true, requirement_id: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!interview) throw new NotFoundException();
  const app = interview.applications;
  const [items, organization, domain] = await Promise.all([
    jobMatchItems(tx, orgId, app.job_id),
    tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { company_type: true, description_en: true, description_ar: true } }),
    tx.$queryRaw<{ sector: string | null; entity_type: string | null }[]>`select sector, entity_type from public.organization_business_domain(${orgId}::uuid)`,
  ]);
  return { interview, app, items, organization, domain: domain[0] ?? null };
}

function buildFacts(data: Awaited<ReturnType<typeof interviewFacts>>, cv: Awaited<ReturnType<typeof matchSnapshot>>['result']) {
  const facts: Fact[] = [];
  const add = (kind: string, text: string, requirement_key?: string) => {
    if (text.trim() && facts.length < 120) facts.push({ id: `F${facts.length + 1}`, kind, text: text.slice(0, 1500), ...(requirement_key && { requirement_key }) });
  };
  const job = data.app.jobs;
  add('job', `Role: ${job.title_en} / ${job.title_ar}${job.experience_level ? `; level: ${job.experience_level}` : ''}${job.sector ? `; sector: ${job.sector}` : ''}`);
  for (const r of data.items) add('requirement', `${r.mandatory ? 'Mandatory' : 'Preferred'} ${r.kind}: ${label(r)}${r.min_years ? ` (${r.min_years} years)` : ''}`, r.key);
  if (data.domain?.sector) add('company', `Business domain: ${data.domain.sector}${data.domain.entity_type ? ` (${data.domain.entity_type})` : ''}`);
  if (data.organization.company_type) add('company', `Company type: ${data.organization.company_type}`);
  if (data.organization.description_en || data.organization.description_ar) add('company', `About the company: ${data.organization.description_en ?? data.organization.description_ar}`);
  const byKey = new Map(data.items.map((r) => [r.key, r]));
  for (const m of cv?.matches ?? []) {
    const r = byKey.get(m.key);
    if (!r) continue;
    if (m.status === 'matched') add('cv_strength', `CV shows "${label(r)}": ${m.evidence_text ?? ''}`, m.key);
    else if (m.status === 'missing' && r.mandatory) add('cv_gap', `Mandatory requirement not shown in the CV: ${label(r)}`, m.key);
    else if (m.status === 'partial' || m.status === 'needs_review') add('cv_uncertain', `CV partly or uncertainly shows "${label(r)}"${m.evidence_text ? `: ${m.evidence_text}` : ''}`, m.key);
  }
  const requirementKey = (id: string | null) => (id && byKey.has(`requirement:${id}`) ? `requirement:${id}` : undefined);
  for (const a of data.app.assessment_attempts) {
    const e = a.evaluation_results;
    // Only results a person reviewed: a proposal waiting for review isn't evidence yet.
    if (e?.status !== 'reviewed') continue;
    if (e.overall_score !== null) add('assessment', `Assessment score, reviewed by a person: ${Number(e.overall_score)} / 100`);
    for (const c of e.criterion_scores) {
      add('assessment', `Criterion ${c.rubric_criteria.code} (${c.rubric_criteria.description_en}): ${Number(c.score)} of ${Number(c.rubric_criteria.max_score)}${c.explanation ? `. ${c.explanation}` : ''}`,
        requirementKey(c.rubric_criteria.requirement_id));
    }
  }
  return facts;
}

/**
 * Interview preparation for the organization's staff: the questions to ask this candidate and the evaluation form for
 * afterwards, proposed by MIDAN's live model and kept with the facts they rest on. Never shown to the candidate. Without a
 * model, nothing is written: the reason is returned and interviewers prepare their own.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/interviews/:interviewId/preparation')
export class InterviewPreparationController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Get()
  @ApiOperation({ summary: 'The current questions and evaluation form for one interview, with how many earlier versions exist.' })
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('interviewId', ParseUUIDPipe) interviewId: string) {
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const found = await tx.interviews.findFirst({ where: { id: interviewId, org_id: orgId }, select: { id: true } });
      if (!found) throw new NotFoundException();
      const rows = await tx.$queryRaw<Row[]>`
        select id, kind, content, facts, provenance, created_by, created_at from public.interview_preparations
        where interview_id = ${interviewId}::uuid and org_id = ${orgId}::uuid order by created_at desc`;
      const latest = (kind: string) => rows.find((r) => r.kind === kind) ?? null;
      return {
        questions: latest('questions'), evaluation_form: latest('evaluation_form'),
        history: { questions: rows.filter((r) => r.kind === 'questions').length, evaluation_form: rows.filter((r) => r.kind === 'evaluation_form').length },
      };
    });
  }

  @Post()
  @ApiOperation({ summary: 'Asks MIDAN\'s model for new questions or a new evaluation form, grounded in this candidate\'s facts; kept as a new version.' })
  async prepare(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('interviewId', ParseUUIDPipe) interviewId: string, @Body() body: PrepareDto) {
    const data = await this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      return interviewFacts(tx, this.ai, orgId, interviewId);
    });
    // The CV match runs outside the transaction: it is a call to the AI service.
    const { result: cv } = data.items.length ? await matchSnapshot(this.ai, data.items, data.app.profile_snapshot, 'fast').catch(() => ({ result: null })) : { result: null };
    const facts = buildFacts(data, cv);
    const job = data.app.jobs;
    const reply = await this.ai.interview<{ questions?: unknown[]; competencies?: unknown[] }>(body.kind === 'questions' ? 'questions' : 'evaluation-form', {
      title_ar: job.title_ar, title_en: job.title_en, facts,
    });
    if (!reply.ok) throw new ServiceUnavailableException({ message: 'MIDAN\'s model is not available to prepare this', reason: reply.reason });
    const content = body.kind === 'questions' ? reply.questions : reply.competencies;
    return this.db.asUser(user, async (tx) => {
      await requireRole(tx, user, orgId);
      const [row] = await tx.$queryRaw<Row[]>`
        insert into public.interview_preparations (interview_id, application_id, org_id, kind, content, facts, provenance, created_by)
        values (${interviewId}::uuid, ${data.interview.application_id}::uuid, ${orgId}::uuid, ${body.kind}, ${JSON.stringify(content)}::jsonb,
                ${JSON.stringify(facts)}::jsonb, ${JSON.stringify(reply.provenance)}::jsonb, ${user.id}::uuid)
        returning id, kind, content, facts, provenance, created_by, created_at`;
      return row;
    });
  }
}
