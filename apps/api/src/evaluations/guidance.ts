/**
 * The assessor guide's guidance for one criterion, from the guide stored with the attempt's own assessment version
 * (assessment_assessor_guides.version_id = the attempt's version). Keys are "<task position>:<criterion code>", as
 * services/ai/midan_ai/package.py writes them. Missing or malformed guidance gives nothing rather than a guess.
 */
export type Guidance = { levels_ar?: Record<string, string>; levels_en?: Record<string, string>; evidence_ar?: string; evidence_en?: string };

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const levels = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string>
    : undefined;

export function guidanceFor(guide: unknown, position: number, code: string): Guidance {
  const all = (guide as { criteria_guidance?: Record<string, unknown> } | null)?.criteria_guidance;
  const found = all && typeof all === 'object' ? (all as Record<string, unknown>)[`${position}:${code}`] : undefined;
  if (!found || typeof found !== 'object') return {};
  const g = found as Record<string, unknown>;
  const out: Guidance = { levels_ar: levels(g.levels_ar), levels_en: levels(g.levels_en), evidence_ar: text(g.evidence_ar), evidence_en: text(g.evidence_en) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && !(typeof v === 'object' && Object.keys(v).length === 0))) as Guidance;
}
