"""Turns a package under the MIDAN Assessment Standard into what the database stores, and back.

The Core API writes exactly what `to_stored` returns and, to check a version again, sends back what it stored; `from_stored`
rebuilds the package. Keeping both directions here means the API never re-implements the mapping, and a round trip is tested.

Where each part goes:
- candidate-facing: version scenario, instructions, timing and `candidate_package` (brief and materials); task titles,
  instructions and `config` (deliverable and material ids, objective questions without answers);
- rubric_criteria: description, max_score 4, weight = points, answer keys (as before);
- assessor guide (organization staff only): the guide, plus each criterion's level descriptors and evidence, keyed by
  "<task position>:<criterion code>"."""

from typing import Any

from .standard import STANDARD_VERSION
from .schemas import (CriterionDraft, GeneratedAssessment, GeneratedCriterion, GeneratedOption, GeneratedQuestion, GeneratedTask,
                      TaskDraft)

_AI_POLICY = {
    "allowed_with_disclosure": ("يسمح باستخدام أدوات الذكاء الاصطناعي بشرط الإفصاح عن طريقة استخدامها.",
                                "AI tools may be used if you say how you used them."),
    "not_allowed": ("لا يسمح باستخدام أدوات الذكاء الاصطناعي في هذه المهمة.", "AI tools may not be used for this assessment."),
    "company_decides": ("تعلن الشركة سياسة استخدام الذكاء الاصطناعي قبل بدء المحاولة.",
                        "The company states its AI-use policy before you start."),
}


def normalize(draft: GeneratedAssessment) -> GeneratedAssessment:
    """Under the standard a criterion is scored on levels 0–4 and weighs its points; a written task weighs the sum of its points."""
    if not draft.standardized:
        return draft
    tasks = []
    for t in draft.tasks:
        if t.task_type != "objective_questions" and t.criteria and all(c.points for c in t.criteria):
            criteria = [c.model_copy(update={"max_score": 4, "weight": c.points}) for c in t.criteria]
            t = t.model_copy(update={"criteria": criteria, "weight": sum(c.points or 0 for c in criteria)})
        tasks.append(t)
    return draft.model_copy(update={"tasks": tasks})


def instructions(brief, lang: str) -> str:
    """The brief as the plain text every candidate screen already shows. The structured brief travels in candidate_package."""
    ar = lang == "ar"
    g = lambda name: getattr(brief, f"{name}_{lang}")
    lines = [g("objective"), ""]
    lines.append("القواعد:" if ar else "Rules:")
    lines += [f"- {r}" for r in g("rules")]
    if g("tools"):
        lines += ["", "الأدوات: " + "، ".join(g("tools")) if ar else "Tools: " + ", ".join(g("tools"))]
    lines += ["", g("assumptions_policy"), _AI_POLICY[brief.ai_use_policy][0 if ar else 1], "",
              ("طريقة التسليم: " if ar else "How to submit: ") + g("submission_format")]
    if brief.effort_minutes:
        lines.append(f"الجهد المتوقع نحو {brief.effort_minutes} دقيقة، وهو تقدير وليس مؤقتًا." if ar
                     else f"Expected effort: about {brief.effort_minutes} minutes. This is an estimate, not a timer.")
    return "\n".join(lines).strip()


def to_stored(draft: GeneratedAssessment) -> dict[str, Any]:
    """`draft` must be normalized. Returns {version, tasks, guide}; version and guide are None for a draft not under the standard."""
    tasks: list[dict[str, Any]] = []
    guidance: dict[str, dict[str, Any]] = {}
    for position, t in enumerate(draft.tasks, 1):
        config: dict[str, Any] = {}
        if t.deliverable_ids:
            config["deliverable_ids"] = t.deliverable_ids
        if t.material_ids:
            config["material_ids"] = t.material_ids
        if t.task_type == "objective_questions":
            config["questions"] = [{"id": q.id, "prompt_ar": q.prompt_ar, "prompt_en": q.prompt_en, "options": [o.model_dump() for o in q.options]}
                                   for q in t.questions]
            key = {q.id: q.answer for q in t.questions}
            criteria = [CriterionDraft(code="C1", description_ar="الإجابات الصحيحة", description_en="Correct answers", max_score=len(key),
                                       weight=t.weight if draft.standardized else 1, answer_key=key)]
        else:
            requirement = t.requirement_ids[0] if t.requirement_ids else None
            reference = t.reference_skill_ids[0] if t.reference_skill_ids else None
            criteria = []
            for i, c in enumerate(t.criteria, 1):
                criteria.append(CriterionDraft(code=f"C{i}", description_ar=c.description_ar, description_en=c.description_en,
                                               max_score=c.max_score, weight=c.weight, requirement_id=requirement,
                                               reference_skill_id=reference if i == 1 else None))
                if draft.standardized:
                    guidance[f"{position}:C{i}"] = {"levels_ar": c.levels_ar, "levels_en": c.levels_en,
                                                    "evidence_ar": c.evidence_ar, "evidence_en": c.evidence_en}
        tasks.append(TaskDraft(position=position, task_type=t.task_type, title_ar=t.title_ar, title_en=t.title_en,
                               instructions_ar=t.instructions_ar, instructions_en=t.instructions_en, weight=t.weight, config=config,
                               skill_ids=t.skill_ids, requirement_ids=t.requirement_ids, reference_skill_ids=t.reference_skill_ids,
                               criteria=criteria).model_dump())
    if not draft.standardized:
        return {"version": None, "tasks": tasks, "guide": None}
    brief = draft.candidate_brief
    assert brief and draft.assessor_guide
    version = {
        "scenario_ar": f"{brief.company_context_ar}\n\n{brief.scenario_ar}".strip(),
        "scenario_en": f"{brief.company_context_en}\n\n{brief.scenario_en}".strip(),
        "instructions_ar": instructions(brief, "ar"), "instructions_en": instructions(brief, "en"),
        "duration_minutes": brief.effort_minutes or None, "deadline_hours": brief.deadline_hours,
        "candidate_package": {"standard_version": STANDARD_VERSION, "candidate_brief": brief.model_dump(),
                              "materials": [m.model_dump(exclude_none=True) for m in draft.materials]},
    }
    guide = {"standard_version": STANDARD_VERSION, "job_family": draft.job_family, "secondary_families": list(draft.secondary_families),
             "assessor_guide": draft.assessor_guide.model_dump(), "criteria_guidance": guidance}
    return {"version": version, "tasks": tasks, "guide": guide}


def from_stored(stored: dict[str, Any]) -> GeneratedAssessment:
    """Rebuilds the package from what the database holds now, including people's edits since generation."""
    version, guide = stored.get("version") or {}, stored.get("guide")
    guidance = (guide or {}).get("criteria_guidance") or {}
    tasks = []
    for raw in sorted(stored["tasks"], key=lambda t: t["position"]):
        config = raw.get("config") or {}
        criteria = sorted(raw.get("criteria") or [], key=lambda c: c["code"])
        task: dict[str, Any] = {k: raw[k] for k in ("title_ar", "title_en", "instructions_ar", "instructions_en")}
        task.update(weight=float(raw["weight"]), requirement_ids=raw.get("requirement_ids") or [], skill_ids=raw.get("skill_ids") or [],
                    reference_skill_ids=raw.get("reference_skill_ids") or [], deliverable_ids=config.get("deliverable_ids") or [],
                    material_ids=config.get("material_ids") or [])
        if raw["task_type"] == "objective_questions":
            key = next((c.get("answer_key") for c in criteria if c.get("answer_key")), {}) or {}
            task["questions"] = [GeneratedQuestion(id=q["id"], prompt_ar=q["prompt_ar"], prompt_en=q["prompt_en"],
                                                   options=[GeneratedOption(**o) for o in q["options"]], answer=key.get(q["id"], ""))
                                 for q in config.get("questions") or []]
            task["task_type"] = "objective_questions"
        else:
            # data_analysis tasks made by hand or by the templates are written work for the standard's purposes.
            task["task_type"] = raw["task_type"] if raw["task_type"] in ("written_case_study", "file_submission") else "written_case_study"
            task["criteria"] = [GeneratedCriterion(description_ar=c["description_ar"] or c["description_en"], description_en=c["description_en"],
                                                   max_score=float(c["max_score"]), weight=float(c["weight"]),
                                                   points=float(c["weight"]) if guide else None,
                                                   **{k: v for k, v in guidance.get(f"{raw['position']}:{c['code']}", {}).items()})
                                for c in criteria]
        tasks.append(GeneratedTask(**task))
    package = version.get("candidate_package") or {}
    if not guide:
        return GeneratedAssessment(tasks=tasks)
    return GeneratedAssessment(tasks=tasks, job_family=guide.get("job_family"), secondary_families=guide.get("secondary_families") or [],
                               candidate_brief=package.get("candidate_brief"), materials=package.get("materials") or [],
                               assessor_guide=guide.get("assessor_guide"))
