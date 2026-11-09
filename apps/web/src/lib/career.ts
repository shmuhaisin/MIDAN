/**
 * The career journey's data, as `GET /me/career` returns it, and what can honestly be derived from it.
 * Every figure here is a count of real records. Nothing is a percentage of readiness: a gap only means there is no
 * evidence yet, and only results an organization released after human review count as demonstrated.
 */

export type Resource = { id: string; kind: string; title_ar: string | null; title_en: string | null; provider: string; url: string; verified_on: string };
export type Evidence = 'assessed' | 'self_reported' | 'no_evidence';
export type RoleSkill = {
  id: string; name_ar: string; description_ar: string | null; is_priority: boolean | null; source_file: string; source_sheet?: string;
  evidence: 'self_reported' | 'no_evidence'; resources: Resource[];
};
export type TitleSkill = { id: string; name_ar: string; name_en: string | null; source: 'skill' | 'reference'; jobs: number; evidence: Evidence };
export type ShownSkill = { id: string; name_ar: string; name_en: string; level: number };
export type PlanItem = {
  id: string; kind: 'skill_goal' | 'project' | 'course' | 'certification'; status: 'not_started' | 'in_progress' | 'completed';
  completed_at?: string | null; updated_at?: string; reference_skills: { id: string; name_ar: string }; learning_resources: Resource | null;
};
export type PracticeTask = {
  id: string; reference_skill_id: string; kind: 'simulated_task' | 'portfolio_project'; status: string; title_ar: string; title_en: string; brief_ar: string; brief_en: string;
  instructions: { ar: string; en: string }[]; deliverables: { ar: string; en: string }[];
  submission: string | null; submission_url: string | null; feedback: { code: string; met: boolean }[] | null;
  submitted_at?: string | null; completed_at?: string | null; created_at?: string;
};
export type Target = { sector_code: string | null; job_family_ar: string | null; job_title: string | null };
export type Career = {
  target: Target | null;
  title_jobs?: number;
  title_skills?: TitleSkill[];
  role_skills: RoleSkill[];
  demonstrated_needs: ShownSkill[];
  demonstrated_strengths: ShownSkill[];
  plan: PlanItem[];
  practice?: PracticeTask[];
};
export type Family = { sector_code: string; job_family_ar: string; skills: number };
/** One skill of a job family, from `GET /reference/skills?family=…&sector=…` (at most 30, priority first). */
export type FamilySkill = { id: string; name_ar: string; description_ar: string | null; sector_code: string; skill_kind: 'technical' | 'general' | string; is_priority: boolean | null; job_families: string[] };

/** The sectors of the skills databases, in the order the product shows them. */
export const SECTOR_KEYS = ['digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail'] as const;

export const EMPTY_CAREER: Career = { target: null, role_skills: [], demonstrated_needs: [], demonstrated_strengths: [], plan: [], practice: [] };

/** The four kinds of planned activity the API accepts. */
export const ACTIVITY_KINDS = ['skill_goal', 'project', 'course', 'certification'] as const;
export const PLAN_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export const PRACTICE_STATUSES = ['not_started', 'in_progress', 'submitted', 'completed'] as const;

export function hasTarget(c: Career) {
  return Boolean(c.target?.job_family_ar || c.target?.job_title);
}

/**
 * Where each of the role's skills stands. The role's skills come from the sector workbooks, and the API says for each
 * whether the candidate listed it or nothing shows it yet. Released assessment results name a different catalogue (the
 * assessments' skills), so they're kept apart as `shown` and `needs` and never matched to the role's skills by name.
 */
export function evidenceOf(c: Career) {
  return {
    listed: c.role_skills.filter((s) => s.evidence === 'self_reported'),
    open: c.role_skills.filter((s) => s.evidence === 'no_evidence'),
    shown: c.demonstrated_strengths,
    needs: c.demonstrated_needs,
  };
}

/** What to work on first: the role's priority skills with nothing behind them yet, then its other skills with nothing yet. */
export function priorities(c: Career, limit = 3) {
  const { open } = evidenceOf(c);
  return [...open.filter((s) => s.is_priority), ...open.filter((s) => !s.is_priority)].slice(0, limit);
}

/** Counts of real records, for the progress view. */
export function progressOf(c: Career) {
  const practice = c.practice ?? [];
  const byKind = (kind: PlanItem['kind']) => c.plan.filter((p) => p.kind === kind);
  const done = (items: { status: string }[]) => items.filter((i) => i.status === 'completed').length;
  return {
    goals: { total: byKind('skill_goal').length, done: done(byKind('skill_goal')) },
    courses: { total: byKind('course').length, done: done(byKind('course')) },
    certifications: { total: byKind('certification').length, done: done(byKind('certification')) },
    projects: { total: byKind('project').length, done: done(byKind('project')) },
    practice: {
      total: practice.length,
      submitted: practice.filter((p) => p.status === 'submitted').length,
      done: practice.filter((p) => p.status === 'completed').length,
    },
    evidence: practice.filter((p) => p.status === 'submitted' || p.status === 'completed').length,
    shown: c.demonstrated_strengths.length,
  };
}

/** The verified learning resources across the role's skills, each with the skill it develops. */
export function resourcesOf(c: Career) {
  return c.role_skills.flatMap((s) => s.resources.map((r) => ({ resource: r, skill: s })));
}

/**
 * The stations of the journey, each reached only by something recorded: a target, a planned activity, practice work
 * submitted, a released result, an application. Used for the journey road on the overview.
 */
export function stationsOf(c: Career, applications: number) {
  const p = progressOf(c);
  return [
    hasTarget(c),
    c.plan.length > 0,
    p.evidence > 0,
    c.demonstrated_strengths.length + c.demonstrated_needs.length > 0,
    applications > 0,
  ];
}

/** A job family's address segment: the Arabic name, encoded once by the router. */
export const familyHref = (sector: string, family: string) => `/development/roles/${sector}/${encodeURIComponent(family)}`;

/** Tolerant matching for the role search: case, Arabic letter forms (alef, ta marbuta, ya) and diacritics. */
export function normalize(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}
