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

/** The review before approval, as GET …/assessment-versions/:id/changes returns it (public.assessment_review_state). */
export type VersionContent = { tasks: ContentTask[]; settings: Record<string, unknown> };
export type ContentTask = {
  id: string; position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string;
  weight: number; config: unknown; reference_skill_ids: string[]; requirement_ids: string[];
  criteria: { id: string; code: string; description_ar: string; description_en: string; max_score: number; weight: number; answer_key: unknown; requirement_id: string | null; reference_skill_id: string | null }[];
};
export type Change = {
  id: number; action: 'create' | 'update' | 'delete'; entity: string; entity_id: string; actor_name: string | null; created_at: string; needs_review: boolean;
  details: { task_id?: string; criterion_id?: string; requirement_id?: string; reason?: string; kind?: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null };
};
export type Finding = { code: string; severity: 'error' | 'warning'; task_id?: string; text_ar?: string; text_en?: string };
export type ReviewState = {
  version: { id: string; version_number: number; status: string };
  original: { kind: 'generated' | 'revision_base'; content: VersionContent } | null;
  current: VersionContent;
  changes: Change[];
  reviews: { id: string; reviewer_name: string | null; reviewed_at: string; reviewed_through: number; change_count: number; warnings: number; note: string | null }[];
  validation: Finding[];
  latest_change_id: number;
  unreviewed: boolean;
};

// Bookkeeping that is never worth showing a reviewer.
const QUIET_FIELDS = new Set(['id', 'org_id', 'version_id', 'task_id', 'created_at', 'updated_at']);

/** Which fields a change touched, with their values before and after. A creation or deletion lists what the row held. */
export function changedFields(change: Change): { field: string; before: unknown; after: unknown }[] {
  const before = change.details.old ?? {};
  const after = change.details.new ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => !QUIET_FIELDS.has(f));
  return fields
    .filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null))
    .map((f) => ({ field: f, before: before[f] ?? null, after: after[f] ?? null }));
}

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

/**
 * True when a change can lower what the assessment measures: something that measured a requirement or workbook skill is
 * removed, or loses that link. The reviewer sees these first. Whether the job is still covered is MIDAN's validation's call.
 */
export function weakensCoverage(change: Change): boolean {
  const before = change.details.old ?? {};
  const after = change.details.new ?? {};
  const measured = (row: Record<string, unknown>) =>
    asArray(row.reference_skill_ids).length > 0 || asArray(row.requirement_ids).length > 0 || Boolean(row.requirement_id) || Boolean(row.reference_skill_id)
    || asArray(row.rubric_criteria).some((c) => Boolean((c as Record<string, unknown>).requirement_id) || Boolean((c as Record<string, unknown>).reference_skill_id));
  if (change.action === 'delete') return change.entity === 'task_requirement_mappings' || measured(before);
  if (change.action !== 'update') return false;
  const lost = (field: string) => asArray(before[field]).some((id) => !asArray(after[field]).includes(id));
  return lost('reference_skill_ids') || (Boolean(before.requirement_id) && !after.requirement_id) || (Boolean(before.reference_skill_id) && !after.reference_skill_id);
}

export type TaskComparison = { status: 'unchanged' | 'changed' | 'added' | 'removed'; original?: ContentTask; current?: ContentTask };

/** MIDAN's original beside the draft now, task by task. Tasks keep their ids through edits, so they're matched by id. */
export function compareTasks(original: VersionContent | null | undefined, current: VersionContent): TaskComparison[] {
  const before = new Map((original?.tasks ?? []).map((t) => [t.id, t]));
  const rows: TaskComparison[] = current.tasks.map((task) => {
    const was = before.get(task.id);
    if (!was) return { status: 'added', current: task };
    return { status: JSON.stringify(normalized(was)) === JSON.stringify(normalized(task)) ? 'unchanged' : 'changed', original: was, current: task };
  });
  for (const task of original?.tasks ?? []) {
    if (!current.tasks.some((t) => t.id === task.id)) rows.push({ status: 'removed', original: task });
  }
  return rows;
}

// Position alone isn't a change in what a task asks; everything else is.
const normalized = ({ position: _position, ...task }: ContentTask) => task;

/** The next id not yet used: q3 after q1 and q2, or c after a and b. */
export function nextId(used: string[], make: (n: number) => string) {
  for (let n = used.length + 1; ; n += 1) {
    if (!used.includes(make(n))) return make(n);
  }
}
