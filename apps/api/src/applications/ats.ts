import type { Prisma } from '@prisma/client';
import type { AiClient } from '../ai/ai.client';
import { applicantProfile, type ApplicantProfile } from '../common/applicant';
import type { Tx } from '../db/db.service';

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

export type MatchStatus = 'matched' | 'partial' | 'missing' | 'needs_review';
export type Proposal = { key: string; status: MatchStatus; score: number; evidence_id: string | null; evidence_text: string | null; evidence_source: string | null; reason: string };
export type AiMatch = { matches: Proposal[]; summary: { counts: Record<MatchStatus, number>; score: number | null; mandatory_missing: number }; provenance: Record<string, unknown> };

/** One requirement of a job as the CV is matched against it: only what the employer approved. */
export type MatchItem = { key: string; kind: string; text_ar: string | null; text_en: string | null; mandatory: boolean; min_years: number | null; skill_id: string | null };

/**
 * A job's approved requirements, required catalog skills, workbook skills and the employer's own skills: the source of
 * truth the CV is matched against. The same list for one applicant (match.controller) and for all of them (ranking).
 */
export async function jobMatchItems(tx: Tx, orgId: string, jobId: string): Promise<MatchItem[]> {
  const [requirements, skills, reference, custom] = await Promise.all([
    tx.job_requirements.findMany({
      where: { job_id: jobId, org_id: orgId, retired_at: null, review_status: 'approved', requirement_type: { not: 'daily_task' } },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
      select: { id: true, requirement_type: true, description_ar: true, description_en: true, is_mandatory: true, min_years: true, skill_id: true },
    }),
    tx.job_skills.findMany({
      where: { job_id: jobId, org_id: orgId, is_required: true, review_status: 'approved' },
      select: { skill_id: true, skills: { select: { name_ar: true, name_en: true } } },
    }),
    tx.job_reference_skills.findMany({
      where: { job_id: jobId, org_id: orgId },
      select: { reference_skill_id: true, is_required: true, reference_skills: { select: { name_ar: true } } },
    }),
    tx.job_custom_skills.findMany({ where: { job_id: jobId, org_id: orgId }, select: { id: true, name_ar: true, name_en: true, is_required: true } }),
  ]);
  return [
    ...requirements.map((r) => ({
      key: `requirement:${r.id}`, kind: r.requirement_type as string, text_ar: r.description_ar, text_en: r.description_en,
      mandatory: r.is_mandatory, min_years: r.min_years === null ? null : Number(r.min_years), skill_id: r.skill_id,
    })),
    ...skills.map((s) => ({ key: `skill:${s.skill_id}`, kind: 'skill', text_ar: s.skills.name_ar, text_en: s.skills.name_en, mandatory: true, min_years: null, skill_id: s.skill_id })),
    ...reference.map((r) => ({
      key: `reference:${r.reference_skill_id}`, kind: 'skill', text_ar: r.reference_skills.name_ar, text_en: null, mandatory: r.is_required, min_years: null, skill_id: null,
    })),
    ...custom.map((c) => ({ key: `custom:${c.id}`, kind: 'skill', text_ar: c.name_ar, text_en: c.name_en, mandatory: c.is_required, min_years: null, skill_id: null })),
  ].filter((r) => r.text_ar || r.text_en);
}

/**
 * MIDAN's matching model (services/ai matching.py: the configured similarity backend, intfloat/multilingual-e5-base when
 * EMBEDDING_PROVIDER=e5-local) on the application's own snapshot. Deterministic; its provenance says which backend ran,
 * including a lexical fallback, so a fallback is never shown as the model.
 */
export async function matchSnapshot(ai: AiClient, items: MatchItem[], snapshot: Prisma.JsonValue | null, mode: 'full' | 'fast' = 'full') {
  const evidence = evidenceFrom(applicantProfile(snapshot));
  const result = items.length === 0 ? null : await ai.matchRequirements<AiMatch>({
    requirements: items.map((r) => ({ key: r.key, text: [r.text_ar, r.text_en].filter(Boolean).join(' / '), mandatory: r.mandatory, min_years: r.min_years, skill_id: r.skill_id })),
    evidence,
    mode,
  });
  return { result, evidence };
}
