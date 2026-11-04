"""Graph A: turns a job into a practical assessment draft. It stops for a person and never publishes."""

import re
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .schemas import CriterionDraft, JobInput, SkillRef, TaskDraft
from .templates import DATA_SKILL_SLUGS, TEMPLATES

MAX_REPAIRS = 2
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


def parse_job_description(state: State) -> State:
    job = JobInput.model_validate(state["job"])
    return {
        "text_ar": "\n".join(filter(None, [job.description_ar, job.requirements_ar])),
        "text_en": "\n".join(filter(None, [job.description_en, job.requirements_en])),
        "warnings": [],
    }


def extract_responsibilities(state: State) -> State:
    split = lambda text: [line.strip(" -•\t") for line in _SPLIT.split(text) if len(line.strip()) > 8]
    ar, en = split(state["text_ar"]), split(state["text_en"])
    job = JobInput.model_validate(state["job"])
    pairs = [
        {"ar": ar[i] if i < len(ar) else job.title_ar, "en": en[i] if i < len(en) else job.title_en}
        for i in range(max(len(ar), len(en), 1))
    ][:2]
    warnings = state["warnings"] + ([] if ar or en else ["no_description"])
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
            weight=2, skill_ids=other_skills,
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
    return {"tasks": [task.model_dump() for task in tasks]}


def generate_rubrics(state: State) -> State:
    tasks = []
    for raw in state["tasks"]:
        task = TaskDraft.model_validate(raw)
        if task.task_type == "objective_questions":
            key = TEMPLATES["objective"]["answer_key"]
            task.criteria = [CriterionDraft(
                code="C1", description_ar="الإجابات الصحيحة", description_en="Correct answers",
                max_score=len(key), answer_key=key,
            )]
        else:
            task.criteria = [
                CriterionDraft(code="C1", description_ar="يحدد المشكلة أو النمط الصحيح ويدعمه بدليل",
                               description_en="Identifies the right problem or pattern and supports it with evidence",
                               max_score=10, weight=2),
                CriterionDraft(code="C2", description_ar="يقدم خطوات أو توصية عملية يمكن تنفيذها",
                               description_en="Gives practical steps or a recommendation that can be acted on",
                               max_score=10, weight=2),
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


def human_review(state: State) -> State:
    return {"review": interrupt({"tasks": state["tasks"], "warnings": state["warnings"], "skills": state["skills"]})}


def finish(state: State) -> State:
    return {"outcome": "approved" if state["review"].get("approved") else "rejected"}


def fail(state: State) -> State:
    return {"outcome": "failed"}


def _after_validation(state: State) -> str:
    if not state["errors"]:
        return "human_review"
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
    graph.add_node("human_review", human_review)
    graph.add_node("return_assessment_draft", finish)
    graph.add_node("fail", fail)
    graph.add_conditional_edges("validate_assessment", _after_validation)
    graph.add_edge("repair_assessment", "validate_assessment")
    graph.add_edge("human_review", "return_assessment_draft")
    graph.add_edge("return_assessment_draft", END)
    graph.add_edge("fail", END)
    return graph.compile(checkpointer=checkpointer)
