import { Prisma } from '@prisma/client';
import type { Tx } from '../db/db.service';

/**
 * What MIDAN's generation and its quality check receive about a job: what the employer stated, its sector and level, and the
 * company's type. Never the company's name: an assessment's company is fictional, of the same type and sector.
 */
export type JobInput = {
  title_ar: string; title_en: string;
  description_ar: string | null; description_en: string | null; requirements_ar: string | null; requirements_en: string | null;
  required_skills: SkillRef[]; taxonomy: SkillRef[];
  requirements: { id: string; requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean }[];
  reference_skills: { id: string; name_ar: string; description_ar: string | null; is_required: boolean }[];
  company_type: string | null; sector: string | null; experience_level: string | null;
  // The registry employer's own business domain (its official sector, such as "Telecommunications"), when the workspace is
  // one of the registry's employers. The scenario's company stays fictional; this only sets the business it is in.
  business_domain?: string | null;
};
type SkillRef = { id: string; slug: string; name_ar: string; name_en: string; synonyms: string[] };

/** A version as stored, in the shape services/ai/midan_ai/package.py `from_stored` reads. */
export type StoredVersion = {
  version: { candidate_package: Prisma.JsonValue | null };
  tasks: {
    position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string;
    weight: number; config: Prisma.JsonValue; requirement_ids: string[]; skill_ids: string[]; reference_skill_ids: string[];
    criteria: { code: string; description_ar: string; description_en: string; max_score: number; weight: number; answer_key: Prisma.JsonValue | null }[];
  }[];
  guide: Prisma.JsonValue | null;
};

export type QualityReport = {
  standard_version: string; evaluator_version: string; standardized: boolean;
  verdict: 'ready' | 'needs_revision' | 'blocked'; overall_score: number;
  dimensions: Record<string, { score: number; evidence: string[]; missing: string[]; errors: Finding[]; warnings: Finding[] }>;
  errors: Finding[]; warnings: Finding[]; required_revisions: string[];
};
type Finding = { code: string; severity: 'error' | 'warning'; message: string; where: string };

const toRef = (s: { id: string; slug: string; name_ar: string; name_en: string; synonyms: string[] }): SkillRef =>
  ({ id: s.id, slug: s.slug, name_ar: s.name_ar, name_en: s.name_en, synonyms: s.synonyms });

/** The company type the employer chose for this generation, or the one the organization keeps. */
export function contextFor(job: { sector: string | null; experience_level: string | null }, companyType: string | null, override?: string) {
  return { company_type: override ?? companyType ?? null, sector: job.sector ?? null, experience_level: job.experience_level ?? null };
}

export async function loadJobInput(tx: Tx, orgId: string, jobId: string, companyTypeOverride?: string): Promise<JobInput | null> {
  const job = await tx.jobs.findFirst({
    where: { id: jobId, org_id: orgId },
    include: {
      job_skills: { include: { skills: true } },
      // Only what the employer stated or approved shapes the draft.
      job_requirements: { where: { retired_at: null, review_status: 'approved' }, orderBy: { position: 'asc' } },
      job_reference_skills: { include: { reference_skills: { select: { id: true, name_ar: true, description_ar: true } } } },
    },
  });
  if (!job) return null;
  // The employer's own skills for this job, with the levels they set, reach the draft through the requirements text: tasks
  // link only to real requirement records, so these can't be given ids of their own.
  const custom = await tx.job_custom_skills.findMany({ where: { job_id: jobId, org_id: orgId }, orderBy: { created_at: 'asc' } });
  const level = (l: number | null) => (l === null ? '' : ` L${l}`);
  const leveled = job.job_reference_skills.filter((r) => r.required_level !== null);
  const extraEn = [
    ...custom.map((c) => `Skill set by the employer: ${c.name_en ?? c.name_ar} (${c.is_required ? 'required' : 'preferred'}${level(c.required_level)})${c.description ? `: ${c.description}` : ''}`),
    ...leveled.map((r) => `Expected level for "${r.reference_skills.name_ar}": L${r.required_level}`),
  ];
  const extraAr = [
    ...custom.map((c) => `مهارة حددتها المنشأة: ${c.name_ar ?? c.name_en} (${c.is_required ? 'مطلوبة' : 'مفضلة'}${level(c.required_level)})${c.description ? `: ${c.description}` : ''}`),
    ...leveled.map((r) => `المستوى المتوقع في «${r.reference_skills.name_ar}»: L${r.required_level}`),
  ];
  const withExtra = (text: string | null, extra: string[]) => (extra.length ? [text, ...extra].filter(Boolean).join('\n') : text);
  const [organization, taxonomy, domain] = await Promise.all([
    tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { company_type: true } }),
    tx.skills.findMany(),
    tx.$queryRaw<{ sector: string | null }[]>`select sector from public.organization_business_domain(${orgId}::uuid)`,
  ]);
  return {
    title_ar: job.title_ar, title_en: job.title_en,
    description_ar: job.description_ar, description_en: job.description_en,
    requirements_ar: withExtra(job.requirements_ar, extraAr), requirements_en: withExtra(job.requirements_en, extraEn),
    required_skills: job.job_skills.map((j) => toRef(j.skills)),
    taxonomy: taxonomy.map(toRef),
    requirements: job.job_requirements.map((r) => ({
      id: r.id, requirement_type: r.requirement_type, description_ar: r.description_ar, description_en: r.description_en, is_mandatory: r.is_mandatory,
    })),
    reference_skills: job.job_reference_skills.map((r) => ({
      id: r.reference_skills.id, name_ar: r.reference_skills.name_ar, description_ar: r.reference_skills.description_ar, is_required: r.is_required,
    })),
    ...contextFor(job, organization.company_type, companyTypeOverride),
    business_domain: domain[0]?.sector ?? null,
  };
}

type TaskRow = {
  position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string;
  weight: Prisma.Decimal | number; config: Prisma.JsonValue; reference_skill_ids: string[];
  rubric_criteria: { code: string; description_ar: string; description_en: string; max_score: Prisma.Decimal | number; weight: Prisma.Decimal | number; answer_key: Prisma.JsonValue | null }[];
  task_requirement_mappings: { requirement_id: string }[];
  task_skill_mappings: { skill_id: string }[];
};

/** Pure: the database rows of a version in the shape the quality check reads. */
export function storedFromRows(candidatePackage: Prisma.JsonValue | null, tasks: TaskRow[], guide: Prisma.JsonValue | null): StoredVersion {
  return {
    version: { candidate_package: candidatePackage },
    tasks: tasks.map((t) => ({
      position: t.position, task_type: t.task_type, title_ar: t.title_ar, title_en: t.title_en,
      instructions_ar: t.instructions_ar, instructions_en: t.instructions_en, weight: Number(t.weight), config: t.config ?? {},
      requirement_ids: t.task_requirement_mappings.map((m) => m.requirement_id),
      skill_ids: [...new Set(t.task_skill_mappings.map((m) => m.skill_id))],
      reference_skill_ids: t.reference_skill_ids,
      criteria: t.rubric_criteria.map((c) => ({
        code: c.code, description_ar: c.description_ar, description_en: c.description_en, max_score: Number(c.max_score), weight: Number(c.weight),
        answer_key: c.answer_key,
      })),
    })),
    guide,
  };
}

/** Reads a version, its guide, its job's context and its content digest, in one transaction, so the digest is of what was read. */
export async function loadForQuality(tx: Tx, orgId: string, versionId: string) {
  const version = await tx.assessment_versions.findFirst({
    where: { id: versionId, org_id: orgId },
    include: {
      assessments: { select: { job_id: true } },
      assessment_tasks: {
        orderBy: { position: 'asc' },
        include: {
          rubric_criteria: { orderBy: { code: 'asc' } },
          task_requirement_mappings: { select: { requirement_id: true } },
          task_skill_mappings: { select: { skill_id: true } },
        },
      },
    },
  });
  if (!version) return null;
  const [guide] = await tx.$queryRaw<{ content: Prisma.JsonValue }[]>`
    select content from public.assessment_assessor_guides where version_id = ${versionId}::uuid`;
  const [{ digest }] = await tx.$queryRaw<{ digest: string }[]>`select public.assessment_content_digest(${versionId}::uuid) as digest`;
  const job = await loadJobInput(tx, orgId, version.assessments.job_id);
  return { job, digest, status: version.status, stored: storedFromRows(version.candidate_package, version.assessment_tasks, guide?.content ?? null) };
}

/** A short summary for API responses; the full report is stored and returned by GET …/quality. */
export function qualitySummary(report: QualityReport) {
  return {
    verdict: report.verdict, standardized: report.standardized, overall_score: report.overall_score, standard_version: report.standard_version,
    errors: report.errors.length, warnings: report.warnings.length, required_revisions: report.required_revisions,
  };
}
