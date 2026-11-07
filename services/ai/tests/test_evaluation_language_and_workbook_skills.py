"""Graph B in Arabic and against the sector workbook skills, and what happens when a provider can't be reached."""
import json
import os
import tempfile

os.environ.setdefault("AI_SERVICE_TOKEN", "test-token")
os.environ.setdefault("CHECKPOINT_DB", os.path.join(tempfile.mkdtemp(), "c.sqlite"))

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from midan_ai.evaluation import build_evaluation_graph
from midan_ai.providers import DemoProvider, JsonLLMProvider, LLMError, PROMPT_VERSION, get_provider
from midan_ai.schemas import CriterionInput, EvaluationInput, ReferenceSkillRef, TaskInput

ANSWER = "ارتفعت المرتجعات في جدة من 40 إلى 61. سأراجع تلك المنطقة أولًا ثم أقيس المرتجعات شهريًا."


def snapshot():
    return EvaluationInput(
        attempt_id="a1", attempt_status="submitted", rubric_version=1,
        reference_skills=[ReferenceSkillRef(id="k1", name_ar="تحليل البيانات"), ReferenceSkillRef(id="k2", name_ar="إدارة المخاطر"), ReferenceSkillRef(id="k3", name_ar="مهارة لا تقيسها مهمة")],
        tasks=[
            TaskInput(id="t1", task_type="written_case_study", title_en="Case", title_ar="دراسة حالة", instructions_ar="حلّل البيانات", weight=2, reference_skill_ids=["k1"], criteria=[
                CriterionInput(id="c1", code="C1", description_en="Finds the pattern", description_ar="يحدد النمط", max_score=10, weight=2),
                CriterionInput(id="c2", code="C2", description_en="Recommends", description_ar="يقترح", max_score=10),
            ]),
            TaskInput(id="t2", task_type="objective_questions", title_en="Quiz", weight=1, reference_skill_ids=["k1", "k2"], criteria=[
                CriterionInput(id="c3", code="C1", description_en="Correct", max_score=2, answer_key={"q1": "b", "q2": "a"}),
            ]),
        ],
        responses={"t1": {"text": ANSWER}, "t2": {"choices": {"q1": "b", "q2": "c"}}},
    ).model_dump()


def cfg():
    return {"configurable": {"thread_id": "t"}}


def test_the_model_sees_the_task_and_criterion_in_arabic_as_well_as_english():
    seen = []

    def fake(system, user):
        seen.append(user)
        return json.dumps({"score": 7, "evidence_quote": "سأراجع تلك المنطقة أولًا", "explanation": "e", "confidence": 0.8})

    graph = build_evaluation_graph(JsonLLMProvider(fake, "m", pause=0), InMemorySaver())
    graph.invoke({"input": snapshot()}, cfg())
    assert "Task (Arabic): دراسة حالة" in seen[0] and "Instructions (Arabic): حلّل البيانات" in seen[0]
    assert "(Arabic): يحدد النمط" in seen[0] and "(English): Finds the pattern" in seen[0]
    assert PROMPT_VERSION == "eval-v2"
    # An Arabic quote copied from an Arabic answer counts as real evidence.
    payload = graph.get_state(cfg()).tasks[0].interrupts[0].value
    assert all(p["evidence_ref"] == "سأراجع تلك المنطقة أولًا" for p in payload["proposals"] if p["source"] == "ai_assisted")


def test_workbook_skills_get_a_score_from_the_tasks_that_measure_them_and_no_invented_level():
    graph = build_evaluation_graph(DemoProvider(), InMemorySaver())
    graph.invoke({"input": snapshot()}, cfg())
    state = graph.invoke(Command(resume={"scores": {"c1": 10, "c2": 5}}), cfg())
    scores = {s["reference_skill_id"]: s for s in state["reference_skills"]}
    # Task 1 ratio (10/10*2 + 5/10*1) / 3 = .8333, task 2 ratio 1/2. k1: (.8333*2 + .5*1) / 3. k2: task 2 only.
    assert scores["k1"]["score_pct"] == pytest.approx(72.22, abs=0.01)
    assert scores["k2"]["score_pct"] == pytest.approx(50.0)
    assert "k3" not in scores
    assert all("level" not in s for s in state["reference_skills"])
    assert state["report"]["reference_skills"] == state["reference_skills"]


def test_the_reviewer_sees_the_workbook_skill_scores_before_deciding():
    graph = build_evaluation_graph(DemoProvider(), InMemorySaver())
    graph.invoke({"input": snapshot()}, cfg())
    payload = graph.get_state(cfg()).tasks[0].interrupts[0].value
    assert {s["reference_skill_id"] for s in payload["reference_skills"]} == {"k1", "k2"}


@pytest.mark.parametrize("failure", [httpx.ConnectTimeout("timed out"), httpx.ReadTimeout("timed out"), httpx.ConnectError("refused")])
def test_an_unreachable_provider_is_retried_then_sent_to_a_person_without_crashing(monkeypatch, failure):
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        raise failure

    monkeypatch.setattr(httpx, "post", post)
    provider = get_provider({"AI_PROVIDER": "openai", "OPENAI_API_KEY": "k", "OPENAI_MODEL": "m"})
    provider._pause = 0
    with pytest.raises(LLMError) as raised:
        provider.score_open(TaskInput(id="t", task_type="written_case_study", title_en="T", criteria=[]), CriterionInput(id="c", code="C1", description_en="d", max_score=10), "answer")
    # The error carries a class name, never what was sent.
    assert "answer" not in str(raised.value) and "k" not in str(raised.value).replace("No valid response from the model: LLMError", "")
    assert len(calls) == 2
    graph = build_evaluation_graph(provider, InMemorySaver())
    graph.invoke({"input": snapshot()}, cfg())
    reasons = graph.get_state(cfg()).tasks[0].interrupts[0].value["review_reasons"]
    assert {"model_failed:c1", "model_failed:c2"} <= set(reasons)
