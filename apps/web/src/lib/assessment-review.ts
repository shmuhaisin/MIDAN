/** What a draft doesn't measure, shown before approval. The organization can edit a draft freely, so this informs and doesn't block. */
type Req = { id: string; requirement_type: string; is_mandatory?: boolean; description_ar: string | null; description_en: string | null };
type ReviewedTask = { reference_skill_ids?: string[]; task_requirement_mappings: { requirement_id: string }[] };
type LinkedSkill = { is_required: boolean; reference_skills: { id: string; name_ar: string } };

const TASK_REQUIREMENTS = new Set(['responsibility', 'daily_task']);

export function uncoveredItems(tasks: ReviewedTask[], requirements: Req[], skills: LinkedSkill[], text: (ar: string | null, en: string | null) => string) {
  const mapped = new Set(tasks.flatMap((t) => t.task_requirement_mappings.map((m) => m.requirement_id)));
  const measured = new Set(tasks.flatMap((t) => t.reference_skill_ids ?? []));
  return [
    ...requirements.filter((r) => TASK_REQUIREMENTS.has(r.requirement_type) && r.is_mandatory !== false && !mapped.has(r.id)).map((r) => text(r.description_ar, r.description_en)),
    ...skills.filter((s) => s.is_required && !measured.has(s.reference_skills.id)).map((s) => s.reference_skills.name_ar),
  ];
}

/** The next id not yet used: q3 after q1 and q2, or c after a and b. */
export function nextId(used: string[], make: (n: number) => string) {
  for (let n = used.length + 1; ; n += 1) {
    if (!used.includes(make(n))) return make(n);
  }
}
