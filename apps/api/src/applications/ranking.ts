import type { Prisma } from '@prisma/client';
import type { MatchItem, MatchStatus, Proposal } from './ats';

export const RANK_KEYS = ['cv', 'assessment', 'interview'] as const;
export type RankKey = (typeof RANK_KEYS)[number];

type Line = { key: string; text_ar: string | null; text_en: string | null; mandatory: boolean };

/**
 * The CV stage: MIDAN's existing matching rule (services/ai matching.py `summary.score`), applied to each requirement's
 * current status, which is a staff member's latest review where there is one and MIDAN's proposal otherwise. The rule is
 * unchanged: mandatory requirements count twice, matched = 1, partial = 0.5, missing = 0, and requirements needing review
 * are left out of the score and counted. Strengths are the matched requirements; gaps are the mandatory ones not shown.
 */
export function cvScore(items: MatchItem[], proposals: Pick<Proposal, 'key' | 'status'>[], reviews: Map<string, MatchStatus>) {
  const proposed = new Map(proposals.map((p) => [p.key, p.status]));
  const current = items.map((item) => ({ item, status: reviews.get(item.key) ?? proposed.get(item.key) ?? ('needs_review' as MatchStatus), reviewed: reviews.has(item.key) }));
  const value: Record<Exclude<MatchStatus, 'needs_review'>, number> = { matched: 1, partial: 0.5, missing: 0 };
  const counted = current.filter((c) => c.status !== 'needs_review');
  const total = counted.reduce((sum, c) => sum + (c.item.mandatory ? 2 : 1), 0);
  const earned = counted.reduce((sum, c) => sum + (c.item.mandatory ? 2 : 1) * value[c.status as keyof typeof value], 0);
  const line = (c: (typeof current)[number]): Line => ({ key: c.item.key, text_ar: c.item.text_ar, text_en: c.item.text_en, mandatory: c.item.mandatory });
  const counts = { matched: 0, partial: 0, missing: 0, needs_review: 0 } as Record<MatchStatus, number>;
  for (const c of current) counts[c.status] += 1;
  return {
    status: 'scored' as const,
    score: total ? Math.round((100 * earned) / total) : null,
    counts,
    reviewed: current.filter((c) => c.reviewed).length,
    strengths: current.filter((c) => c.status === 'matched').map(line),
    partial: current.filter((c) => c.status === 'partial').map(line),
    gaps: current.filter((c) => c.status === 'missing' && c.item.mandatory).map(line),
  };
}

type Competency = { label?: unknown; rating?: unknown };

/**
 * The interview stage, as the submitted forms recorded it: each competency's 1–4 rating, averaged over the forms, and each
 * interviewer's recommendation counted. It isn't turned into a percentage: no approved rule does that.
 */
export function interviewSummary(
  interviews: { status: string; scheduled_at: Date }[],
  feedback: { recommendation: string | null; competencies: Prisma.JsonValue }[],
) {
  const ratings = feedback.flatMap((f) => (Array.isArray(f.competencies) ? (f.competencies as Competency[]) : []))
    .map((c) => (typeof c?.rating === 'number' ? c.rating : null)).filter((r): r is number => r !== null && r >= 1 && r <= 4);
  const recommendations: Record<string, number> = {};
  for (const f of feedback) if (f.recommendation) recommendations[f.recommendation] = (recommendations[f.recommendation] ?? 0) + 1;
  const scheduled = interviews.filter((i) => i.status !== 'cancelled');
  return {
    state: feedback.length > 0 ? 'scored' : scheduled.length > 0 ? 'scheduled' : 'none',
    interviews: scheduled.length,
    forms: feedback.length,
    average_rating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null,
    recommendations,
  };
}

type Rankable = { application_id: string; applied_at: Date | string; cv: { status: string; score?: number | null }; assessment_score: number | null; interview: { average_rating: number | null } };

/** The value one stage gives an applicant, or null while that stage is pending for them. */
export function stageValue(row: Rankable, key: RankKey): number | null {
  if (key === 'cv') return row.cv.status === 'scored' ? row.cv.score ?? null : null;
  if (key === 'assessment') return row.assessment_score;
  return row.interview.average_rating;
}

/**
 * Orders every applicant by the chosen stage, highest first; equal values share a rank (1, 2, 2, 4). Applicants without a
 * value for that stage follow, unranked, in the order they applied. Nobody is dropped: this is the whole list.
 */
export function rankBy<T extends Rankable>(rows: T[], key: RankKey): (T & { rank: number | null })[] {
  const applied = (r: T) => new Date(r.applied_at).getTime();
  const scored = rows.filter((r) => stageValue(r, key) !== null).sort((a, b) => stageValue(b, key)! - stageValue(a, key)! || applied(a) - applied(b));
  const pending = rows.filter((r) => stageValue(r, key) === null).sort((a, b) => applied(a) - applied(b));
  let rank = 0;
  let previous: number | null = null;
  const ranked = scored.map((r, i) => {
    const value = stageValue(r, key)!;
    if (value !== previous) { rank = i + 1; previous = value; }
    return { ...r, rank };
  });
  return [...ranked, ...pending.map((r) => ({ ...r, rank: null }))];
}
