"""Checks an assessment against the MIDAN Assessment Standard and says whether it is ready for approval.

Deterministic: the same package always gets the same report, whichever provider (or none) produced it. It judges a draft against
the standard's rules, its own job's inputs and its own materials. It never compares a draft with a reference package and has no
similarity input, so resembling a reference earns nothing."""

import re
from typing import Any, Literal

from pydantic import BaseModel

from . import standard as S
from .schemas import GeneratedAssessment, GeneratedTask, JobInput

EVALUATOR_VERSION = "quality-v1"
_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[A-Za-z]")
_WORD = re.compile(r"[\w؀-ۿ]+")
_PLACEHOLDER = re.compile(r"\b(TODO|TBD|lorem|ipsum|xxx+)\b|\[\.\.\.\]|<placeholder>|\?\?\?", re.IGNORECASE)
_VAGUE = re.compile(r"\b(etc|and so on|as appropriate|as needed|whatever)\b|إلخ|وغيرها|حسب الحاجة|وما إلى ذلك", re.IGNORECASE)
_FICTIONAL = re.compile(r"fictional|fictitious|hypothetical|خيالي|افتراضي|مصطنع|وهمي", re.IGNORECASE)
_PERSONAL = re.compile(
    r"\b(your age|how old|gender|nationality|religio\w*|marital|pregnan\w*|disabilit\w*|health condition|ethnic\w*)\b"
    r"|عمرك|جنسك|جنسيتك|ديانتك|حالتك الاجتماعية|إعاقتك|حالتك الصحية", re.IGNORECASE)
# Words that make a claim about a law, a regulator or a published standard. Each needs a source in the guide.
_REGULATORY = re.compile(
    r"\b(law|laws|regulations?|decree|statute|article \d+|NCA|SAMA|PDPL|ZATCA|SDAIA|CST|GDPR|HIPAA|PCI[ -]?DSS|ISO[ /]?\d{4,5}|NIST|ECC-?\d?)\b"
    r"|لائحة|اللائحة|نظام حماية البيانات|المادة \d+|مرسوم|الهيئة الوطنية للأمن السيبراني|البنك المركزي السعودي|هيئة الزكاة", re.IGNORECASE)
_ACRONYM = re.compile(r"\b(NCA|SAMA|PDPL|ZATCA|SDAIA|CST|GDPR|HIPAA|PCI[ -]?DSS|ISO[ /]?\d{4,5}|NIST|ECC)\b", re.IGNORECASE)
_GUIDE_PHRASES = re.compile(
    r"answer key|reference solution|assessor guide|assessor-only|assessor only|common mistakes|scoring rubric weights"
    r"|مفتاح الإجابة|الحل المرجعي|دليل المقيم|الأخطاء الشائعة", re.IGNORECASE)
_SECRET_KEYS = {"answer", "answers", "answer_key", "solution", "reference_solution", "expected", "expected_outputs", "key", "levels"}


class Finding(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str
    where: str = ""


class Dimension(BaseModel):
    score: int
    evidence: list[str] = []
    missing: list[str] = []
    errors: list[Finding] = []
    warnings: list[Finding] = []


class QualityReport(BaseModel):
    standard_version: str = S.STANDARD_VERSION
    evaluator_version: str = EVALUATOR_VERSION
    standardized: bool
    verdict: Literal["ready", "needs_revision", "blocked"]
    overall_score: int
    dimensions: dict[str, Dimension]
    errors: list[Finding]
    warnings: list[Finding]
    required_revisions: list[str]
    checks_run: int = 0
    checks_skipped: int = 0


class _Collector:
    def __init__(self) -> None:
        self.dims = {d: Dimension(score=100) for d in S.DIMENSIONS}

    def add(self, code: str, where: str = "", detail: str = "") -> None:
        rule = S.RULES[code]
        message = rule.en + (f": {detail}" if detail else "")
        finding = Finding(code=code, severity=rule.severity, message=message, where=where)
        dim = self.dims[rule.dimension]
        (dim.errors if rule.severity == "error" else dim.warnings).append(finding)
        if rule.severity == "error":
            dim.missing.append(message + (f" ({where})" if where else ""))

    def ok(self, dimension: str, evidence: str) -> None:
        self.dims[dimension].evidence.append(evidence)


def _words(text: str | None) -> int:
    return len(_WORD.findall(text or ""))


def _norm(value: Any) -> str:
    return str(value).strip().lower()


def _matches(row: dict[str, Any], where: dict[str, Any]) -> bool:
    for column, condition in where.items():
        value = row.get(column)
        if isinstance(condition, dict):
            for op, target in condition.items():
                if op == "in" and _norm(value) not in {_norm(t) for t in target}:
                    return False
                if op == "ne" and _norm(value) == _norm(target):
                    return False
                if op in ("gte", "lte", "gt", "lt"):
                    a, b = _comparable(value), _comparable(target)
                    if a is None or b is None or type(a) is not type(b):
                        return False
                    if (op == "gte" and a < b) or (op == "lte" and a > b) or (op == "gt" and a <= b) or (op == "lt" and a >= b):
                        return False
        elif _norm(value) != _norm(condition):
            return False
    return True


def _comparable(value: Any) -> float | str | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return str(value)


def recompute(check: dict[str, Any], rows: list[dict[str, Any]]) -> Any:
    """A small, closed set of operations over a material's rows. Nothing is evaluated as code."""
    selected = [r for r in rows if _matches(r, check.get("where") or {})]
    op, column = check.get("op"), check.get("column")
    values = [r.get(column) for r in selected] if column else []
    if op == "count":
        return len(selected)
    if op == "count_distinct":
        return len({_norm(v) for v in values if v not in (None, "")})
    if op in ("sum", "min", "max"):
        numbers = [float(v) for v in values if v not in (None, "")]
        if not numbers:
            return None
        return {"sum": sum, "min": min, "max": max}[op](numbers)
    if op == "first":
        return min((str(v) for v in values if v not in (None, "")), default=None)
    if op == "last":
        return max((str(v) for v in values if v not in (None, "")), default=None)
    if op == "argmax_count":
        counts: dict[str, int] = {}
        for v in values:
            if v not in (None, ""):
                counts[_norm(v)] = counts.get(_norm(v), 0) + 1
        return max(sorted(counts), key=lambda k: counts[k]) if counts else None
    raise ValueError(f"unknown check operation {op!r}")


def _equal(actual: Any, expected: Any, tolerance: float) -> bool:
    if actual is None:
        return False
    try:
        return abs(float(actual) - float(expected)) <= tolerance
    except (TypeError, ValueError):
        return _norm(actual) == _norm(expected)


def _candidate_texts(pkg: GeneratedAssessment) -> list[tuple[str, str]]:
    """Everything a candidate reads, except the raw contents of materials (which legitimately hold the inputs)."""
    out: list[tuple[str, str]] = []
    b = pkg.candidate_brief
    if b:
        for name in ("company_context", "scenario", "objective", "assumptions_policy", "submission_format"):
            for lang in ("ar", "en"):
                out.append((f"brief.{name}_{lang}", getattr(b, f"{name}_{lang}")))
        for lang in ("ar", "en"):
            out += [(f"brief.rules_{lang}", "\n".join(getattr(b, f"rules_{lang}"))), (f"brief.tools_{lang}", "\n".join(getattr(b, f"tools_{lang}")))]
        for d in b.deliverables:
            out += [(f"deliverable.{d.id}", f"{d.title_ar}\n{d.title_en}\n{d.description_ar}\n{d.description_en}")]
    for i, t in enumerate(pkg.tasks, 1):
        out.append((f"task {i}", f"{t.title_ar}\n{t.title_en}\n{t.instructions_ar}\n{t.instructions_en}"))
        for q in t.questions:
            out.append((f"task {i} question {q.id}", f"{q.prompt_ar}\n{q.prompt_en}"))
    for m in pkg.materials:
        out.append((f"material {m.id} description", f"{m.title_ar}\n{m.title_en}\n{m.description_ar}\n{m.description_en}"))
    return out


def _all_texts(pkg: GeneratedAssessment) -> str:
    parts = [t for _, t in _candidate_texts(pkg)]
    for m in pkg.materials:
        parts += [m.content_ar or "", m.content_en or ""]
    g = pkg.assessor_guide
    if g:
        parts += [g.scope_and_limits, *g.boundaries, *g.not_scored, *g.verification_steps, *g.approval_notes]
        for s in g.task_solutions:
            parts += [s.reference_solution, *s.expected_outputs, *s.accepted_alternatives, *s.common_mistakes]
        parts += [f"{c.label} {c.formula}" for c in g.calculations]
        parts += [f"{d.point} {d.accepted} {d.not_accepted}" for d in g.decision_points]
    return "\n".join(parts)


def _task_points(task: GeneratedTask) -> float:
    if task.task_type == "objective_questions":
        return task.weight
    return sum(c.points or 0 for c in task.criteria)


def evaluate(job: JobInput, pkg: GeneratedAssessment, rows: dict[str, list[dict[str, Any]]] | None = None) -> QualityReport:
    """`rows` supplies the rows of materials attached as files (material id → rows), so reference figures can be recomputed."""
    c = _Collector()
    rows = {**{m.id: m.rows for m in pkg.materials if m.rows}, **(rows or {})}
    if not pkg.standardized:
        c.add("not_standardized", "assessment")
        return _finish(c, pkg, standardized=False, checks=(0, 0))
    brief, guide = pkg.candidate_brief, pkg.assessor_guide
    assert brief and guide and pkg.job_family
    family = S.requirements_for(pkg.job_family, list(pkg.secondary_families))
    tasks = pkg.tasks
    materials = {m.id: m for m in pkg.materials}
    deliverables = {d.id: d for d in brief.deliverables}

    # --- completeness
    required_brief = ["company_context", "scenario", "objective", "assumptions_policy", "submission_format"]
    present = 0
    for name in required_brief:
        for lang in ("ar", "en"):
            if (getattr(brief, f"{name}_{lang}") or "").strip():
                present += 1
            else:
                c.add("brief_field_missing", f"brief.{name}_{lang}")
    for name in ("rules", "tools"):
        for lang in ("ar", "en"):
            if getattr(brief, f"{name}_{lang}"):
                present += 1
            else:
                c.add("brief_field_missing", f"brief.{name}_{lang}")
    if brief.effort_minutes <= 0:
        c.add("brief_field_missing", "brief.effort_minutes")
    if not brief.deliverables:
        c.add("brief_field_missing", "brief.deliverables")
    for name in ("scope_and_limits", "task_solutions", "boundaries", "approval_notes"):
        if not getattr(guide, name):
            c.add("guide_section_missing", f"guide.{name}")
    if not tasks:
        c.add("no_tasks")
    c.ok("completeness", f"{present} of {len(required_brief) * 2 + 4} brief text fields present; {len(tasks)} tasks; "
                         f"{len(brief.deliverables)} deliverables; {len(pkg.materials)} materials")

    # --- language: every candidate-facing field in both languages
    def bilingual(where: str, ar: str | None, en: str | None) -> None:
        if not ar or not _ARABIC.search(ar):
            c.add("language_missing", where, "Arabic")
        if not en or not _LATIN.search(en):
            c.add("language_missing", where, "English")

    for name in required_brief:
        bilingual(f"brief.{name}", getattr(brief, f"{name}_ar"), getattr(brief, f"{name}_en"))
    for i, t in enumerate(tasks, 1):
        bilingual(f"task {i} title", t.title_ar, t.title_en)
        bilingual(f"task {i} instructions", t.instructions_ar, t.instructions_en)
        for j, cr in enumerate(t.criteria, 1):
            bilingual(f"task {i} criterion {j}", cr.description_ar, cr.description_en)
        for q in t.questions:
            bilingual(f"task {i} question {q.id}", q.prompt_ar, q.prompt_en)
    for d in brief.deliverables:
        bilingual(f"deliverable {d.id}", d.title_ar, d.title_en)
    for m in pkg.materials:
        bilingual(f"material {m.id} title", m.title_ar, m.title_en)
    c.ok("language", "Checked Arabic and English text in the brief, tasks, criteria, questions, deliverables and material titles")

    # --- relevance: the job, its company type and sector
    context = f"{brief.company_context_ar}\n{brief.company_context_en}".lower()
    if job.sector and job.sector != "other":
        words = S.SECTORS[job.sector]
        if any(w.lower() in context for w in (*words["ar"], *words["en"])):
            c.ok("relevance", f"Company context reflects the sector ({job.sector})")
        else:
            c.add("context_ignored", "brief.company_context", f"sector {job.sector}")
    if job.company_type:
        ar, en = S.COMPANY_TYPES[job.company_type]
        if ar in context or en.lower() in context:
            c.ok("relevance", f"Company context reflects the company type ({job.company_type})")
        else:
            c.add("context_ignored", "brief.company_context", f"company type {job.company_type}")
    scenario = f"{brief.scenario_ar}\n{brief.scenario_en}\n{brief.company_context_ar}\n{brief.company_context_en}".lower()
    title_words = [w for w in _WORD.findall(job.title_en.lower()) if len(w) > 3] + [w for w in _WORD.findall(job.title_ar) if len(w) > 2]
    if any(w.lower() in scenario for w in title_words):
        c.ok("relevance", "The scenario names the role")
    else:
        c.add("job_not_reflected", "brief.scenario")

    # --- skill coverage
    stated_requirements = {r.id for r in job.requirements if r.requirement_type in ("responsibility", "daily_task")}
    mandatory = {r.id for r in job.requirements if r.requirement_type in ("responsibility", "daily_task") and r.is_mandatory}
    skills = {s.id for s in job.required_skills} | {s.id for s in job.taxonomy}
    references = {r.id for r in job.reference_skills}
    required_refs = {r.id for r in job.reference_skills if r.is_required}
    for i, t in enumerate(tasks, 1):
        for kind, used, known in (("responsibility", t.requirement_ids, {r.id for r in job.requirements}), ("skill", t.skill_ids, skills),
                                  ("workbook skill", t.reference_skill_ids, references)):
            unknown = set(used) - known
            if unknown:
                c.add("unknown_id", f"task {i}", f"{kind} {sorted(unknown)}")
        if not (t.requirement_ids or t.skill_ids or t.reference_skill_ids):
            c.add("task_not_mapped", f"task {i}")
    for rid in sorted(mandatory - {r for t in tasks for r in t.requirement_ids}):
        c.add("requirement_not_measured", rid)
    for sid in sorted({s.id for s in job.required_skills} - {s for t in tasks for s in t.skill_ids}):
        c.add("skill_not_measured", sid)
    for rid in sorted(required_refs - {r for t in tasks for r in t.reference_skill_ids}):
        c.add("skill_not_measured", rid, "workbook skill")
    mapped = len({r for t in tasks for r in t.requirement_ids} & stated_requirements)
    c.ok("skill_coverage", f"{mapped} of {len(stated_requirements)} stated responsibilities and "
                           f"{len({s for t in tasks for s in t.skill_ids} & skills)} skills are measured by tasks; "
                           f"skill map has {len(guide.skill_map)} entries")

    # --- realism
    if not _FICTIONAL.search(f"{brief.company_context_ar} {brief.company_context_en}"):
        c.add("not_fictional", "brief.company_context")
    if _words(brief.scenario_en) < S.MIN_SCENARIO_WORDS or _words(brief.scenario_ar) < S.MIN_SCENARIO_WORDS * 0.7:
        c.add("scenario_too_short", "brief.scenario", f"{_words(brief.scenario_en)} English words, {_words(brief.scenario_ar)} Arabic")
    low, high = S.WINDOW_HOURS
    if not low <= brief.deadline_hours <= high:
        c.add("window_out_of_range", "brief.deadline_hours", str(brief.deadline_hours))
    everything = _all_texts(pkg)
    placeholder = _PLACEHOLDER.search(everything)
    if placeholder:
        c.add("placeholder_text", "", placeholder.group(0))
    c.ok("realism", f"Scenario: {_words(brief.scenario_en)} English and {_words(brief.scenario_ar)} Arabic words; "
                    f"window {brief.deadline_hours} h; materials provenance: {sorted({m.provenance for m in pkg.materials})}")

    # --- difficulty
    lo, hi = S.effort_range(pkg.job_family, job.experience_level)
    if brief.effort_minutes and not lo <= brief.effort_minutes <= hi:
        c.add("effort_out_of_range", "brief.effort_minutes", f"{brief.effort_minutes} min, expected {lo}–{hi} for {job.experience_level or 'any level'}")
    if family.needs_decision_points and not guide.decision_points:
        c.add("decision_points_missing", "guide.decision_points")
    if job.experience_level in ("senior", "lead") and len(guide.decision_points) < 2:
        c.add("few_decision_points", "guide.decision_points")
    if family.needs_accepted_alternatives and not any(s.accepted_alternatives for s in guide.task_solutions):
        c.add("alternatives_missing", "guide.task_solutions")
    c.ok("difficulty", f"Effort {brief.effort_minutes} min against {lo}–{hi}; {len(guide.decision_points)} decision points; "
                       f"level {job.experience_level or 'not stated'}")

    # --- clarity
    for i, t in enumerate(tasks, 1):
        for lang in ("ar", "en"):
            text = getattr(t, f"instructions_{lang}")
            if len(text.strip()) < 40:
                c.add("instruction_too_short", f"task {i} ({lang})")
            vague = _VAGUE.search(text)
            if vague:
                c.add("vague_instruction", f"task {i} ({lang})", vague.group(0))
        ratio = (len(t.instructions_ar) + 1) / (len(t.instructions_en) + 1)
        if not 0.4 <= ratio <= 2.5:
            c.add("instructions_unbalanced", f"task {i}")
    if family.needs_not_scored_boundary and not guide.not_scored:
        c.add("not_scored_boundary_missing", "guide.not_scored")
    c.ok("clarity", "Instructions checked for length, unbounded wording and balance between languages")

    # --- data sufficiency and reference consistency
    if family.needs_materials and not pkg.materials:
        c.add("no_materials")
    tables = [m for m in pkg.materials if m.kind in ("table", "log")]
    if family.needs_table_material and not tables:
        c.add("no_table_material")
    for m in tables:
        if not m.columns:
            c.add("data_dictionary_missing", f"material {m.id}", "no columns")
        elif family.needs_data_dictionary or m.kind == "log":
            for col in m.columns:
                if not (col.meaning_ar or col.meaning_en) or not col.unit:
                    c.add("data_dictionary_missing", f"material {m.id}.{col.name}")
    for i, t in enumerate(tasks, 1):
        for mid in t.material_ids:
            if mid not in materials:
                c.add("material_unknown", f"task {i}", mid)
    for calc in guide.calculations:
        for ref in calc.inputs:
            mid, _, column = ref.partition(".")
            if mid not in materials:
                c.add("calculation_input_missing", f"calculation {calc.id}", ref)
            elif column and materials[mid].columns and column not in {col.name for col in materials[mid].columns}:
                c.add("calculation_input_missing", f"calculation {calc.id}", ref)
        if calc.task_ref > len(tasks):
            c.add("material_unknown", f"calculation {calc.id}", f"task {calc.task_ref}")
    run = skipped = 0
    for calc in guide.calculations:
        if not calc.check:
            continue
        mid = calc.check.get("material")
        if mid not in materials:
            c.add("material_unknown", f"calculation {calc.id} check", str(mid))
            continue
        if not rows.get(mid):
            skipped += 1
            continue
        run += 1
        # The check comes from the draft, often a model's: a malformed one (a "where" that isn't a mapping, a tolerance that
        # isn't a number) is a finding about the draft, never a crash of the evaluator.
        try:
            actual = recompute(calc.check, rows[mid])
            tolerance = float(calc.check.get("tolerance", 0))
        except (ValueError, TypeError, AttributeError, KeyError) as error:
            why = {"AttributeError": "its filter isn't a column-to-value mapping", "TypeError": "its filter isn't a column-to-value mapping",
                   "KeyError": "it names a column the table doesn't have", "ValueError": "a value in it isn't a number"}.get(type(error).__name__, type(error).__name__)
            c.add("reference_check_failed", f"calculation {calc.id}", f"the check can't be run: {why}")
            continue
        expected = calc.check.get("expect", calc.result)
        if not _equal(actual, expected, tolerance):
            c.add("reference_check_failed", f"calculation {calc.id}", f"recomputed {actual!r}, guide says {expected!r}")
    c.ok("data_sufficiency", f"{len(pkg.materials)} materials ({len(tables)} tables or logs); {len(guide.calculations)} calculations "
                             f"with inputs checked")
    c.ok("reference_consistency", f"{run} reference figures recomputed from the materials" + (f", {skipped} not run (rows not supplied)" if skipped else ""))

    solutions = {s.task_ref: s for s in guide.task_solutions}
    for i, t in enumerate(tasks, 1):
        if t.task_type == "objective_questions":
            for q in t.questions:
                if q.answer not in {o.id for o in q.options} or len({o.id for o in q.options}) != len(q.options):
                    c.add("objective_answer_invalid", f"task {i} question {q.id}")
            continue
        s = solutions.get(i)
        if not s or not s.reference_solution.strip() or not s.expected_outputs:
            c.add("task_without_solution", f"task {i}")
        uses_data = any(materials[m].kind in ("table", "log") for m in t.material_ids if m in materials)
        if uses_data and family.min_calculations_per_task and sum(1 for k in guide.calculations if k.task_ref == i) < family.min_calculations_per_task:
            c.add("calculations_missing", f"task {i}")
    if len(guide.verification_steps) < family.min_verification_steps:
        c.add("verification_steps_missing", "guide.verification_steps", f"{len(guide.verification_steps)} of {family.min_verification_steps}")

    # --- measurability
    used = set()
    for i, t in enumerate(tasks, 1):
        if t.task_type == "objective_questions":
            continue
        known = [d for d in t.deliverable_ids if d in deliverables]
        if not known:
            c.add("task_without_deliverable", f"task {i}")
        used |= set(known)
    for d in brief.deliverables:
        if d.format not in S.DELIVERABLE_FORMATS:
            c.add("deliverable_format_invalid", f"deliverable {d.id}", d.format)
        if d.id not in used:
            c.add("deliverable_unused", f"deliverable {d.id}")
    c.ok("measurability", f"{len(used)} of {len(brief.deliverables)} deliverables answered by tasks, each with a format")

    # --- rubric quality and scoring consistency
    written = [cr for t in tasks if t.task_type != "objective_questions" for cr in t.criteria]
    count = len(written) + sum(1 for t in tasks if t.task_type == "objective_questions")
    total = sum(_task_points(t) for t in tasks)
    if abs(total - S.RUBRIC_TOTAL) > 0.01:
        c.add("rubric_total_not_100", "rubric", f"{total:g}")
    lo_c, hi_c = S.CRITERIA_TOTAL
    if not lo_c <= count <= hi_c:
        c.add("criteria_count_out_of_range", "rubric", str(count))
    lo_p, hi_p = S.CRITERION_POINTS
    seen: set[str] = set()
    for i, t in enumerate(tasks, 1):
        if t.task_type == "objective_questions":
            if not lo_p <= t.weight <= hi_p:
                c.add("criterion_points_out_of_range", f"task {i}", f"{t.weight:g}")
            continue
        if len(t.criteria) < S.CRITERIA_PER_WRITTEN_TASK[0]:
            c.add("written_task_few_criteria", f"task {i}")
        for j, cr in enumerate(t.criteria, 1):
            where = f"task {i} criterion {j}"
            if cr.points is None or not lo_p <= cr.points <= hi_p:
                c.add("criterion_points_out_of_range", where, f"{cr.points}")
            if cr.max_score != 4:
                c.add("level_scale_invalid", where, f"maximum {cr.max_score:g}")
            ok_levels = False
            for levels in (cr.levels_ar, cr.levels_en):
                texts = [levels.get(k, "").strip() for k in S.LEVEL_KEYS]
                if all(texts) and len(set(texts)) == len(texts):
                    ok_levels = True
            if not ok_levels:
                c.add("criterion_levels_incomplete", where)
            if not (cr.evidence_ar.strip() or cr.evidence_en.strip()):
                c.add("criterion_without_evidence", where)
            key = cr.description_en.strip().lower()
            if key in seen:
                c.add("duplicate_criterion", where)
            seen.add(key)
        if t.criteria and abs(t.weight - sum(cr.points or 0 for cr in t.criteria)) > 0.01:
            c.add("task_weight_mismatch", f"task {i}", f"weight {t.weight:g}, criteria {sum(cr.points or 0 for cr in t.criteria):g}")
    if guide.pass_mark is not None:
        c.add("pass_mark_set", "guide.pass_mark")
    c.ok("rubric_quality", f"{count} criteria, {total:g} points")
    c.ok("scoring_consistency", "Levels 0–4, score = points × level ÷ 4, task weight = sum of its criteria's points, no pass mark")

    # --- separation: nothing only the assessor may see reaches the candidate
    candidate = _candidate_texts(pkg)
    secrets = {_norm(k.result) for k in guide.calculations if len(k.result.strip()) >= 3 and not re.fullmatch(r"\d{1,2}", k.result.strip())}
    for where, text in candidate:
        phrase = _GUIDE_PHRASES.search(text)
        if phrase:
            c.add("assessor_content_exposed", where, phrase.group(0))
        low_text = text.lower()
        for secret in secrets:
            if re.search(rf"(?<![\w.]){re.escape(secret)}(?![\w])", low_text):
                c.add("assessor_content_exposed", where, "a reference result from the guide")
    c.ok("separation", f"{len(candidate)} candidate-facing texts checked against {len(secrets)} reference results and guide-only phrases")

    # --- integrity
    claims = [m.group(0) for m in _REGULATORY.finditer(everything)]
    if claims and not guide.sources:
        c.add("regulatory_claim_unsourced", "", ", ".join(sorted(set(claims))[:5]))
    sourced = " ".join(f"{s.title} {s.supports} {s.url or ''}" for s in guide.sources).lower()
    for acronym in sorted({a.upper() for a in _ACRONYM.findall(everything)}):
        if acronym.lower() not in sourced:
            c.add("regulatory_claim_unsourced", "", acronym)
    for s in guide.sources:
        if s.verification == "verified" and not s.accessed:
            c.add("source_invalid", s.title, "verified without an access date")
        if s.verification == "unverified" and s.kind != "internal_fictional":
            c.add("source_unverified", s.title)
    for m in pkg.materials:
        if m.provenance != "fictional" and not m.source:
            c.add("material_unsourced", f"material {m.id}")
        if m.provenance == "public_dataset" and not m.licence:
            c.add("material_unsourced", f"material {m.id}", "no licence")
    for i, t in enumerate(tasks, 1):
        found = _PERSONAL.search(f"{t.instructions_ar}\n{t.instructions_en}\n" + "\n".join(f"{q.prompt_ar}\n{q.prompt_en}" for q in t.questions))
        if found:
            c.add("personal_attribute", f"task {i}", found.group(0))
    c.ok("integrity", f"{len(guide.sources)} sources; {len(claims)} references to laws, regulators or standards checked")

    return _finish(c, pkg, standardized=True, checks=(run, skipped))


def config_exposes(config: dict[str, Any]) -> bool:
    """True when a task's candidate-visible config carries something only the assessor may see."""
    def keys(value: Any) -> set[str]:
        if isinstance(value, dict):
            return set(value) | {k for v in value.values() for k in keys(v)}
        if isinstance(value, list):
            return {k for v in value for k in keys(v)}
        return set()
    return bool(keys(config) & _SECRET_KEYS)


def _finish(c: _Collector, pkg: GeneratedAssessment, *, standardized: bool, checks: tuple[int, int]) -> QualityReport:
    for dim in c.dims.values():
        dim.score = max(0, 100 - 35 * len(dim.errors) - 10 * len(dim.warnings))
    errors = [f for d in c.dims.values() for f in d.errors]
    warnings = [f for d in c.dims.values() for f in d.warnings]
    overall = round(sum(d.score for d in c.dims.values()) / len(c.dims)) if standardized else 0
    if errors:
        verdict = "blocked"
    elif overall < S.READY_OVERALL or any(d.score < S.READY_DIMENSION for d in c.dims.values()):
        verdict = "needs_revision"
    else:
        verdict = "ready"
    revisions = [f"Fix: {f.message}" + (f" ({f.where})" if f.where else "") for f in errors]
    revisions += [f"Strengthen {name} (score {d.score})" for name, d in c.dims.items() if d.score < S.READY_DIMENSION and not d.errors]
    return QualityReport(standardized=standardized, verdict=verdict, overall_score=overall, dimensions=c.dims, errors=errors,
                         warnings=warnings, required_revisions=revisions, checks_run=checks[0], checks_skipped=checks[1])
