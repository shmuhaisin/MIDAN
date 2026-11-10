"""Graph A: turns a job into a practical assessment draft. It stops for a person and never publishes."""

import re
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from . import standard as S
from .package import from_stored, normalize, to_stored
from .providers import GENERATION_PROMPT_VERSION, LLMError
from .quality import evaluate
from .schemas import CriterionDraft, GeneratedAssessment, JobInput, Provenance, SkillRef, TaskDraft
from .templates import DATA_SKILL_SLUGS, SKILL_TASK, TEMPLATES

MAX_REPAIRS = 2
MAX_RESPONSIBILITIES = 4
MAX_SKILL_TASKS = 3
TEMPLATE_PROVENANCE = Provenance(mode="demo", provider="demo", model_version="templates-v2-requirements", prompt_version="none")
TASK_TYPES = {"responsibility", "daily_task"}
_SPLIT = re.compile(r"[\n.;؛]+")


class State(TypedDict, total=False):
    job: dict[str, Any]
    text_ar: str
    text_en: str
    responsibilities: list[dict[str, str]]
    skills: list[dict[str, Any]]
    warnings: list[str]
    templates: dict[str, Any]
    tasks: list[dict[str, Any]]
    errors: list[str]
    repairs: int
    review: dict[str, Any]
    outcome: str
    provenance: dict[str, Any]
    stored_version: dict[str, Any] | None
    stored_guide: dict[str, Any] | None
    quality: dict[str, Any]


def parse_job_description(state: State) -> State:
    job = JobInput.model_validate(state["job"])
    return {
        "text_ar": "\n".join(filter(None, [job.description_ar, job.requirements_ar])),
        "text_en": "\n".join(filter(None, [job.description_en, job.requirements_en])),
        "warnings": [],
    }


def extract_responsibilities(state: State) -> State:
    """Structured responsibilities and daily tasks come first: they're what the employer stated. Free text is the fallback."""
    job = JobInput.model_validate(state["job"])
    stated = [r for r in job.requirements if r.requirement_type in TASK_TYPES and (r.description_ar or r.description_en)]
    if stated:
        pairs = [{"ar": r.description_ar or r.description_en or "", "en": r.description_en or r.description_ar or "", "requirement_id": r.id}
                 for r in stated[:MAX_RESPONSIBILITIES]]
        warnings = state["warnings"] + (["responsibilities_truncated"] if len(stated) > MAX_RESPONSIBILITIES else [])
        return {"responsibilities": pairs, "warnings": warnings}
    split = lambda text: [line.strip(" -•\t") for line in _SPLIT.split(text) if len(line.strip()) > 8]
    ar, en = split(state["text_ar"]), split(state["text_en"])
    pairs = [
        {"ar": ar[i] if i < len(ar) else job.title_ar, "en": en[i] if i < len(en) else job.title_en, "requirement_id": None}
        for i in range(max(len(ar), len(en), 1))
    ][:2]
    warnings = state["warnings"] + ([] if ar or en else ["no_description"]) + ["no_structured_responsibilities"]
    return {"responsibilities": pairs, "warnings": warnings}


def extract_skills(state: State) -> State:
    job = JobInput.model_validate(state["job"])
    text = f"{state['text_ar']} {state['text_en']} {job.title_ar} {job.title_en}".lower()
    found = list(job.required_skills)
    for skill in job.taxonomy:
        names = [skill.name_ar, skill.name_en, *skill.synonyms]
        if any(name.lower() in text for name in names):
            found.append(skill)
    return {"skills": [s.model_dump() for s in found]}


def normalize_skills(state: State) -> State:
    unique = list({s["id"]: s for s in state["skills"]}.values())
    return {"skills": unique, "warnings": state["warnings"] + ([] if unique else ["no_skills"])}


def retrieve_task_templates(state: State) -> State:
    return {"templates": TEMPLATES}


def generate_tasks(state: State) -> State:
    templates = state["templates"]
    skills = [SkillRef.model_validate(s) for s in state["skills"]]
    data_skills = [s.id for s in skills if s.slug in DATA_SKILL_SLUGS]
    other_skills = [s.id for s in skills if s.slug not in DATA_SKILL_SLUGS] or [s.id for s in skills]
    tasks: list[TaskDraft] = []

    for r in state["responsibilities"]:
        t = templates["case_study"]
        tasks.append(TaskDraft(
            position=len(tasks) + 1, task_type=t["task_type"],
            title_ar=t["title_ar"], title_en=t["title_en"],
            instructions_ar=t["instructions_ar"].format(responsibility_ar=r["ar"]),
            instructions_en=t["instructions_en"].format(responsibility_en=r["en"]),
            weight=2, skill_ids=other_skills, requirement_ids=[r["requirement_id"]] if r.get("requirement_id") else [],
        ))
    job = JobInput.model_validate(state["job"])
    # One task for each required skill the organization linked from the sector workbooks, up to a few.
    context = state["responsibilities"][0] if state["responsibilities"] else {"ar": job.title_ar, "en": job.title_en}
    for ref in [r for r in job.reference_skills if r.is_required][:MAX_SKILL_TASKS]:
        tasks.append(TaskDraft(
            position=len(tasks) + 1, task_type=SKILL_TASK["task_type"],
            title_ar=SKILL_TASK["title_ar"].format(skill_ar=ref.name_ar), title_en=SKILL_TASK["title_en"].format(skill_ar=ref.name_ar),
            instructions_ar=SKILL_TASK["instructions_ar"].format(skill_ar=ref.name_ar, context_ar=f"في سياق: {context['ar']}"),
            instructions_en=SKILL_TASK["instructions_en"].format(skill_ar=ref.name_ar, context_en=f"In the context of: {context['en']}"),
            weight=2, skill_ids=[s.id for s in skills], reference_skill_ids=[ref.id],
        ))
    if data_skills:
        t = templates["data_analysis"]
        tasks.append(TaskDraft(
            position=len(tasks) + 1, task_type=t["task_type"],
            title_ar=t["title_ar"], title_en=t["title_en"],
            instructions_ar=t["instructions_ar"], instructions_en=t["instructions_en"],
            weight=2, config=t["config"], skill_ids=data_skills,
        ))
    t = templates["objective"]
    tasks.append(TaskDraft(
        position=len(tasks) + 1, task_type=t["task_type"],
        title_ar=t["title_ar"], title_en=t["title_en"],
        instructions_ar=t["instructions_ar"], instructions_en=t["instructions_en"],
        weight=1, config=t["config"], skill_ids=[s.id for s in skills],
    ))
    return {"tasks": [task.model_dump() for task in tasks], "provenance": TEMPLATE_PROVENANCE.model_dump()}


def check_generated(state: State):
    """What the schema can't see: a draft may use only what this job states, and must cover what it requires."""
    job = JobInput.model_validate(state["job"])
    # A model sees every stated responsibility (the templates' limit of a few doesn't apply), and must cover each one.
    requirements = {r["requirement_id"] for r in _stated(state, job)}
    known_requirements = requirements | {r.id for r in job.requirements}
    references = {r.id for r in job.reference_skills}
    required = {r.id for r in job.reference_skills if r.is_required}
    skills = {s["id"] for s in state["skills"]}

    def check(draft: GeneratedAssessment) -> None:
        for task in draft.tasks:
            for kind, used, known in (("requirement", task.requirement_ids, known_requirements), ("reference skill", task.reference_skill_ids, references), ("skill", task.skill_ids, skills)):
                unknown = set(used) - known
                if unknown:
                    raise ValueError(f"{kind} ids not in this job: {sorted(unknown)}")
            if task.task_type == "objective_questions":
                if not task.questions:
                    raise ValueError("objective_questions needs questions")
                for q in task.questions:
                    if q.answer not in {o.id for o in q.options}:
                        raise ValueError(f"question {q.id}: the answer isn't one of its options")
            elif len(task.criteria) < 2:
                raise ValueError("a written task needs at least 2 criteria")
        missing = (requirements - {r for t in draft.tasks for r in t.requirement_ids}) | (required - {r for t in draft.tasks for r in t.reference_skill_ids})
        if missing:
            raise ValueError(f"these aren't covered by any task: {sorted(missing)}")

    return check


def _stated(state: State, job: JobInput) -> list[dict[str, Any]]:
    """Every responsibility and daily task the employer stated, untruncated; the free-text fallback when there are none."""
    stated = [{"requirement_id": r.id, "ar": r.description_ar or r.description_en or "", "en": r.description_en or r.description_ar or ""}
              for r in job.requirements if r.requirement_type in TASK_TYPES and (r.description_ar or r.description_en)]
    return stated or [r for r in state["responsibilities"] if r.get("requirement_id")]


def make_generator(provider) -> Callable[[State], State]:
    """Uses the configured model through the shared contract. Without one, or if it can't produce a valid draft, the templates
    run instead and the draft is labeled as such, so nobody mistakes it for the model's work."""
    def generate(state: State) -> State:
        if provider.provenance.mode != "live":
            return generate_tasks(state)
        job = JobInput.model_validate(state["job"])
        context = {
            "title_ar": job.title_ar, "title_en": job.title_en,
            "description_ar": job.description_ar, "description_en": job.description_en,
            "requirements_ar": job.requirements_ar, "requirements_en": job.requirements_en,
            "company_type": job.company_type, "sector": job.sector, "experience_level": job.experience_level,
            "business_domain": job.business_domain,
            "responsibilities": [{"id": r["requirement_id"], "ar": r["ar"], "en": r["en"]} for r in (_stated(state, job) or state["responsibilities"])],
            "skills": [{"id": s["id"], "name_ar": s["name_ar"], "name_en": s["name_en"]} for s in state["skills"]],
            "reference_skills": [r.model_dump() for r in job.reference_skills],
            "standard": standard_summary(job.experience_level),
        }
        try:
            draft = normalize(provider.generate_assessment(context, check_generated(state)))
        except LLMError:
            result = generate_tasks(state)
            return {**result, "warnings": state["warnings"] + ["ai_generation_unavailable"]}
        draft, repair_warning = _repair_round(provider, job, context, draft, check_generated(state))
        stored = to_stored(draft)
        return {
            "tasks": stored["tasks"], "stored_version": stored["version"], "stored_guide": stored["guide"],
            # The templates' limit on responsibilities didn't apply to the model.
            "warnings": [w for w in state["warnings"] if w != "responsibilities_truncated"] + ([] if draft.standardized else ["not_standardized"])
                        + ([repair_warning] if repair_warning else []),
            "provenance": Provenance(mode="live", provider=provider.provenance.provider, model_version=provider.provenance.model_version,
                                     prompt_version=GENERATION_PROMPT_VERSION).model_dump(),
        }

    return generate


# Findings that live entirely in the assessor guide: a targeted fix of the guide can clear them.
GUIDE_CODES = {"reference_check_failed", "calculation_input_missing", "calculations_missing", "verification_steps_missing",
               "task_without_solution", "guide_section_missing", "decision_points_missing", "alternatives_missing",
               "not_scored_boundary_missing", "pass_mark_set"}


def _errors(job: JobInput, draft: GeneratedAssessment):
    return evaluate(job, draft).errors


def _described(errors) -> list[str]:
    return [f"{f.message}: {f.where}" if f.where else f.message for f in errors]


def _repair_round(provider, job: JobInput, context: dict[str, Any], draft: GeneratedAssessment, check) -> tuple[GeneratedAssessment, str | None]:
    """MIDAN's quality check runs on the model's draft; if it blocks approval, the model gets one chance to fix what it lists.
    When every blocking finding is in the assessor guide, only the guide (with the materials) goes back: that fits the
    provider's per-minute token limit where the whole draft doesn't. The revision is kept only when it has fewer blocking
    findings, so a failed or worse repair never costs the live draft. Employers can't edit materials or the assessor guide in
    the app, so this is what makes a live draft approvable."""
    if not draft.standardized:
        return draft, None
    errors = _errors(job, draft)
    if not errors:
        return draft, None
    problems = _described(errors)
    try:
        if {f.code for f in errors} <= GUIDE_CODES and hasattr(provider, "fix_guide"):
            guide = provider.fix_guide([m.model_dump(exclude_none=True) for m in draft.materials], draft.assessor_guide.model_dump(exclude_none=True), problems)
            revised = draft.model_copy(update={"assessor_guide": guide})
        elif hasattr(provider, "revise_assessment"):
            revised = normalize(provider.revise_assessment(context, draft.model_dump(exclude_none=True), problems, check))
        else:
            return draft, None
    except Exception:  # noqa: BLE001 - provider down, rate-limited, or a reply that doesn't validate: keep the first draft
        return draft, "ai_repair_unavailable"
    return (revised, "ai_repaired") if len(_errors(job, revised)) < len(errors) else (draft, "ai_repair_not_better")


def standard_summary(level: str | None) -> dict[str, Any]:
    """What the model needs to know of the standard: its version, the job families with their effort for this level, and the rubric."""
    return {
        "version": S.STANDARD_VERSION,
        "job_families": {name: {"for": p.summary_en, "effort_minutes": S.effort_range(name, level), "deliverable_formats": p.deliverable_formats}
                         for name, p in S.FAMILIES.items()},
        "rubric": {"total_points": S.RUBRIC_TOTAL, "criteria": S.CRITERIA_TOTAL, "points_per_criterion": S.CRITERION_POINTS, "levels": S.LEVEL_KEYS},
        "deliverable_formats": S.DELIVERABLE_FORMATS,
    }


def generate_rubrics(state: State) -> State:
    tasks = []
    for raw in state["tasks"]:
        task = TaskDraft.model_validate(raw)
        # A model's draft arrives with its own rubric, already checked.
        if task.criteria:
            tasks.append(task.model_dump())
            continue
        if task.task_type == "objective_questions":
            key = TEMPLATES["objective"]["answer_key"]
            task.criteria = [CriterionDraft(
                code="C1", description_ar="الإجابات الصحيحة", description_en="Correct answers",
                max_score=len(key), answer_key=key,
            )]
        elif task.reference_skill_ids:
            job = JobInput.model_validate(state["job"])
            ref = next(r for r in job.reference_skills if r.id == task.reference_skill_ids[0])
            # The descriptor is the workbook's own description of the skill. Without one, the criterion says so plainly.
            described = ref.description_ar or "كما تصفها مصنفات المهارات القطاعية"
            task.criteria = [
                CriterionDraft(code="C1", description_ar=f"يُظهر «{ref.name_ar}»: {described}",
                               description_en=f'Shows the skill "{ref.name_ar}" as the sector skills reference describes it',
                               max_score=10, weight=3, reference_skill_id=ref.id),
                CriterionDraft(code="C2", description_ar="يصف خطوات عملية واضحة ومرتبة", description_en="Describes clear, ordered, practical steps",
                               max_score=10, weight=1),
                CriterionDraft(code="C3", description_ar="يحدد كيف يتحقق من جودة النتيجة", description_en="Says how they would check the quality of the result",
                               max_score=10, weight=1),
            ]
        else:
            requirement = task.requirement_ids[0] if task.requirement_ids else None
            task.criteria = [
                CriterionDraft(code="C1", description_ar="يحدد المشكلة أو النمط الصحيح ويدعمه بدليل",
                               description_en="Identifies the right problem or pattern and supports it with evidence",
                               max_score=10, weight=2, requirement_id=requirement),
                CriterionDraft(code="C2", description_ar="يقدم خطوات أو توصية عملية يمكن تنفيذها",
                               description_en="Gives practical steps or a recommendation that can be acted on",
                               max_score=10, weight=2, requirement_id=requirement),
                CriterionDraft(code="C3", description_ar="يكتب بوضوح لمن سيعمل بما كتبه",
                               description_en="Writes clearly for the people who will act on it",
                               max_score=10, weight=1),
            ]
        tasks.append(task.model_dump())
    return {"tasks": tasks}


def validate_assessment(state: State) -> State:
    errors: list[str] = []
    tasks = [TaskDraft.model_validate(t) for t in state["tasks"]]
    if not tasks:
        errors.append("no_tasks")
    covered = {skill for t in tasks for skill in t.skill_ids}
    for skill in state["skills"]:
        if skill["id"] not in covered:
            errors.append(f"uncovered_skill:{skill['id']}")
    stated = {r["requirement_id"] for r in state["responsibilities"] if r.get("requirement_id")}
    for missing in stated - {req for t in tasks for req in t.requirement_ids}:
        errors.append(f"uncovered_requirement:{missing}")
    for t in tasks:
        if not t.criteria:
            errors.append(f"no_criteria:{t.position}")
        if t.task_type == "objective_questions":
            questions = {q["id"] for q in t.config.get("questions", [])}
            keys = {k for c in t.criteria for k in (c.answer_key or {})}
            if questions != keys:
                errors.append(f"answer_key_mismatch:{t.position}")
    return {"errors": errors}


def repair_assessment(state: State) -> State:
    """Assign any uncovered skill to the last task, and rebuild missing rubrics."""
    tasks = state["tasks"]
    covered = {skill for t in tasks for skill in t["skill_ids"]}
    if tasks:
        tasks[-1]["skill_ids"] += [s["id"] for s in state["skills"] if s["id"] not in covered]
    return {**generate_rubrics({**state, "tasks": tasks}), "repairs": state.get("repairs", 0) + 1}


def assess_quality(state: State) -> State:
    """The standard's check of the draft as it will be stored, after any repair. A template draft is reported as not standardized."""
    stored = {"version": state.get("stored_version"), "tasks": state["tasks"], "guide": state.get("stored_guide")}
    report = evaluate(JobInput.model_validate(state["job"]), from_stored(stored))
    return {"quality": report.model_dump()}


def human_review(state: State) -> State:
    return {"review": interrupt({
        "tasks": state["tasks"], "warnings": state["warnings"], "skills": state["skills"],
        "provenance": state.get("provenance") or TEMPLATE_PROVENANCE.model_dump(),
        # Under the standard: the version's candidate-facing fields and the assessor guide (stored apart, for staff only).
        "version": state.get("stored_version"), "guide": state.get("stored_guide"), "quality": state.get("quality"),
    })}


def finish(state: State) -> State:
    return {"outcome": "approved" if state["review"].get("approved") else "rejected"}


def fail(state: State) -> State:
    return {"outcome": "failed"}


def _after_validation(state: State) -> str:
    if not state["errors"]:
        return "assess_quality"
    return "repair_assessment" if state.get("repairs", 0) < MAX_REPAIRS else "fail"


def build_assessment_graph(checkpointer, *, generator: Callable[[State], State] = generate_tasks):
    graph = StateGraph(State)
    steps: list[tuple[str, Callable]] = [
        ("parse_job_description", parse_job_description),
        ("extract_responsibilities", extract_responsibilities),
        ("extract_skills", extract_skills),
        ("normalize_skills", normalize_skills),
        ("retrieve_task_templates", retrieve_task_templates),
        ("generate_tasks", generator),
        ("generate_rubrics", generate_rubrics),
        ("validate_assessment", validate_assessment),
    ]
    previous = START
    for name, fn in steps:
        graph.add_node(name, fn)
        graph.add_edge(previous, name)
        previous = name
    graph.add_node("repair_assessment", repair_assessment)
    graph.add_node("assess_quality", assess_quality)
    graph.add_edge("assess_quality", "human_review")
    graph.add_node("human_review", human_review)
    graph.add_node("return_assessment_draft", finish)
    graph.add_node("fail", fail)
    graph.add_conditional_edges("validate_assessment", _after_validation)
    graph.add_edge("repair_assessment", "validate_assessment")
    graph.add_edge("human_review", "return_assessment_draft")
    graph.add_edge("return_assessment_draft", END)
    graph.add_edge("fail", END)
    return graph.compile(checkpointer=checkpointer)
