"""Graph B: proposes an evaluation of submitted work. A person always reviews before anything is final."""

import re
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .providers import LLMError, Provider
from .schemas import CriterionProposal, EvaluationInput, TaskInput

LOW_CONFIDENCE = 0.7
MAX_RETRIES = 1
# Words only flag a case for human attention. They never change a score.
_INJECTION = re.compile(
    r"ignore (all |any |the |your )?(previous |above )?(instructions|rubric)|system prompt|full marks|give (me )?(the )?(maximum|highest|top) score"
    r"|تجاهل (كل )?(التعليمات|المعايير)|أعطني (الدرجة|العلامة) (الكاملة|النهائية)",
    re.IGNORECASE,
)


class State(TypedDict, total=False):
    input: dict[str, Any]
    answers: dict[str, str]
    proposals: list[dict[str, Any]]
    invalid: list[str]
    retries: int
    overall: float
    skill_levels: list[dict[str, Any]]
    review_reasons: list[str]
    review: dict[str, Any]
    report: dict[str, Any]
    outcome: str


def verify_attempt(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    if data.attempt_status != "submitted":
        return {"outcome": "not_submitted"}
    return {"retries": 0, "review_reasons": []}


def load_assessment_snapshot(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    missing = [t.id for t in data.tasks if not t.criteria]
    return {"outcome": "invalid_snapshot"} if missing or not data.tasks else {}


def collect_evidence(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    answers = {t.id: str(data.responses.get(t.id, {}).get("text", "") or "") for t in data.tasks}
    return {"answers": answers}


def grade_objective_tasks(state: State) -> State:
    """Plain code, no model."""
    data = EvaluationInput.model_validate(state["input"])
    proposals = []
    for task in data.tasks:
        if task.task_type != "objective_questions":
            continue
        chosen = data.responses.get(task.id, {}).get("choices", {}) or {}
        for c in task.criteria:
            key = c.answer_key or {}
            correct = [q for q, a in key.items() if chosen.get(q) == a]
            proposals.append(CriterionProposal(
                criterion_id=c.id, task_id=task.id, source="deterministic", confidence=1,
                score=round(c.max_score * len(correct) / max(len(key), 1), 2),
                explanation=f"{len(correct)} of {len(key)} correct.",
                evidence_ref=f"choices:{','.join(sorted(chosen)) or 'none'}",
            ).model_dump())
    return {"proposals": proposals}


def make_open_evaluator(provider: Provider):
    def evaluate_open_responses(state: State) -> State:
        data = EvaluationInput.model_validate(state["input"])
        kept = [p for p in state["proposals"] if p["source"] == "deterministic"]
        failed: list[str] = []
        for task in data.tasks:
            if task.task_type == "objective_questions":
                continue
            answer = state["answers"].get(task.id, "")
            for c in task.criteria:
                try:
                    scored = provider.score_open(task, c, answer)
                except LLMError:
                    failed.append(c.id)
                    continue
                kept.append(CriterionProposal(
                    criterion_id=c.id, task_id=task.id, source="ai_assisted",
                    score=scored.score, confidence=scored.confidence, explanation=scored.explanation,
                    evidence_ref=scored.evidence_quote or "no-evidence",
                ).model_dump())
        reasons = state["review_reasons"] + [f"model_failed:{c}" for c in failed]
        return {"proposals": kept, "review_reasons": reasons}

    return evaluate_open_responses


def validate_evaluation(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    limits = {c.id: c.max_score for t in data.tasks for c in t.criteria}
    invalid = []
    for p in state["proposals"]:
        if p["source"] != "ai_assisted":
            continue
        quote = p["evidence_ref"]
        made_up = quote != "no-evidence" and quote not in state["answers"].get(p["task_id"], "")
        if p["score"] > limits[p["criterion_id"]] or made_up:
            invalid.append(p["criterion_id"])
    return {"invalid": invalid}


def _after_validation(state: State) -> str:
    if state["invalid"] and state["retries"] < MAX_RETRIES:
        return "retry_invalid"
    return "discard_invalid"


def retry_invalid(state: State) -> State:
    return {"retries": state["retries"] + 1}


def discard_invalid(state: State) -> State:
    """Whatever still fails is dropped, never kept: a person scores those criteria."""
    invalid = set(state["invalid"])
    return {
        "proposals": [p for p in state["proposals"] if p["criterion_id"] not in invalid],
        "review_reasons": state["review_reasons"] + [f"invalid_output:{c}" for c in invalid],
    }


def _effective(state: State) -> dict[str, float]:
    scores = {p["criterion_id"]: p["score"] for p in state["proposals"]}
    scores.update((state.get("review") or {}).get("scores", {}))
    return scores


def compute_scores(data: EvaluationInput, scores: dict[str, float]) -> tuple[float, list[dict[str, Any]]]:
    """Weighted scoring in plain code. Criteria with no score count as zero."""
    task_ratio: dict[str, float] = {}
    for t in data.tasks:
        total = sum(c.weight for c in t.criteria)
        task_ratio[t.id] = sum(c.weight * min(scores.get(c.id, 0) / c.max_score, 1) for c in t.criteria) / total
    total_weight = sum(t.weight for t in data.tasks)
    overall = round(sum(t.weight * task_ratio[t.id] for t in data.tasks) / total_weight * 100, 2)

    levels = []
    for skill in data.skills:
        related = [t for t in data.tasks if skill.id in t.skill_ids]
        if not related:
            continue
        weights = [t.skill_weights.get(skill.id, 1) for t in related]
        ratio = sum(w * task_ratio[t.id] for w, t in zip(weights, related)) / sum(weights)
        levels.append({"skill_id": skill.id, "ratio": round(ratio, 4), "level": level_for(ratio)})
    return overall, levels


def level_for(ratio: float) -> int:
    if ratio <= 0:
        return 0
    for level, limit in ((1, 0.4), (2, 0.6), (3, 0.85)):
        if ratio < limit:
            return level
    return 4


def aggregate_scores(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    overall, levels = compute_scores(data, _effective(state))
    return {"overall": overall, "skill_levels": levels}


def make_review_check(provider: Provider):
    def check_review_requirement(state: State) -> State:
        reasons = list(state["review_reasons"])
        if provider.provenance.mode == "demo":
            reasons.append("demo_mode")
        if any(p["confidence"] < LOW_CONFIDENCE for p in state["proposals"]):
            reasons.append("low_confidence")
        if any(_INJECTION.search(a) for a in state["answers"].values()):
            reasons.append("possible_prompt_injection")
        if any(not a.strip() for t, a in state["answers"].items() if _is_open(state, t)):
            reasons.append("missing_response")
        return {"review_reasons": sorted(set(reasons))}

    return check_review_requirement


def _is_open(state: State, task_id: str) -> bool:
    data = EvaluationInput.model_validate(state["input"])
    return any(t.id == task_id and t.task_type != "objective_questions" for t in data.tasks)


def human_review(state: State) -> State:
    review = interrupt({
        "proposals": state["proposals"], "overall": state["overall"],
        "skill_levels": state["skill_levels"], "review_reasons": state["review_reasons"],
    })
    return {"review": review}


def persist_evaluation(state: State) -> State:
    """The Core API writes rows, as the reviewer, so RLS applies. This step fixes the final numbers."""
    return aggregate_scores(state)


def generate_report(state: State) -> State:
    data = EvaluationInput.model_validate(state["input"])
    names = {s.id: s for s in data.skills}
    strengths, improvements = [], []
    for item in state["skill_levels"]:
        skill = names[item["skill_id"]]
        entry = {"skill_id": skill.id, "name_ar": skill.name_ar, "name_en": skill.name_en, "level": item["level"]}
        (strengths if item["level"] >= 3 else improvements).append(entry)
    return {"report": {"strengths": strengths, "improvements": improvements}, "outcome": "reviewed"}


def _route_failure(state: State) -> str:
    return "stop" if state.get("outcome") else "continue"


def build_evaluation_graph(provider: Provider, checkpointer):
    graph = StateGraph(State)
    graph.add_node("verify_attempt", verify_attempt)
    graph.add_node("load_assessment_snapshot", load_assessment_snapshot)
    graph.add_node("collect_evidence", collect_evidence)
    graph.add_node("grade_objective_tasks", grade_objective_tasks)
    graph.add_node("evaluate_open_responses", make_open_evaluator(provider))
    graph.add_node("validate_evaluation", validate_evaluation)
    graph.add_node("retry_invalid", retry_invalid)
    graph.add_node("discard_invalid", discard_invalid)
    graph.add_node("aggregate_scores", aggregate_scores)
    graph.add_node("check_review_requirement", make_review_check(provider))
    graph.add_node("human_review", human_review)
    graph.add_node("persist_evaluation", persist_evaluation)
    graph.add_node("generate_report", generate_report)

    graph.add_edge(START, "verify_attempt")
    graph.add_conditional_edges("verify_attempt", _route_failure, {"stop": END, "continue": "load_assessment_snapshot"})
    graph.add_conditional_edges("load_assessment_snapshot", _route_failure, {"stop": END, "continue": "collect_evidence"})
    graph.add_edge("collect_evidence", "grade_objective_tasks")
    graph.add_edge("grade_objective_tasks", "evaluate_open_responses")
    graph.add_edge("evaluate_open_responses", "validate_evaluation")
    graph.add_conditional_edges("validate_evaluation", _after_validation)
    graph.add_edge("retry_invalid", "evaluate_open_responses")
    graph.add_edge("discard_invalid", "aggregate_scores")
    graph.add_edge("aggregate_scores", "check_review_requirement")
    graph.add_edge("check_review_requirement", "human_review")
    graph.add_edge("human_review", "persist_evaluation")
    graph.add_edge("persist_evaluation", "generate_report")
    graph.add_edge("generate_report", END)
    return graph.compile(checkpointer=checkpointer)
