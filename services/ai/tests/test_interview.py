"""Interview questions and the evaluation form: live model only, grounded in the facts given, refused otherwise."""

import json

import pytest
from fastapi.testclient import TestClient

from midan_ai import main
from midan_ai.interview import InterviewRequest, Unavailable, evaluation_form, questions
from midan_ai.providers import DemoProvider, JsonLLMProvider


@pytest.fixture(autouse=True)
def no_alternate(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)


def model(replies, seen=None):
    queue = list(replies)

    def complete(system, user):
        if seen is not None:
            seen.append((system, user))
        return queue.pop(0)

    return JsonLLMProvider(complete, "groq-model", provider="groq", pause=0)


REQ = InterviewRequest.model_validate({
    "title_ar": "محلل بيانات", "title_en": "Data analyst",
    "facts": [
        {"id": "F1", "kind": "requirement", "text": "SQL reporting (mandatory)", "requirement_key": "requirement:1"},
        {"id": "F2", "kind": "cv_gap", "text": "Mandatory requirement not shown in the CV: SQL reporting", "requirement_key": "requirement:1"},
        {"id": "F3", "kind": "company", "text": "Business domain: Telecommunications"},
        {"id": "F4", "kind": "assessment", "text": "Criterion C1 (data cleaning): 3 of 4. Reviewer: removed duplicates, explained why."},
    ],
})

Q = {"question_ar": "حدثني عن تقرير SQL أعددته", "question_en": "Tell me about an SQL report you built", "purpose": "probe_gap",
     "requirement_key": "requirement:1", "fact_ids": ["F1", "F2"], "listen_for_ar": "خطوات واضحة واستعلامات", "listen_for_en": "Clear steps and real queries"}
LEVELS = {"1": "weak", "2": "partial", "3": "solid", "4": "strong"}
C = {"label_ar": "إعداد التقارير", "label_en": "Reporting", "requirement_key": "requirement:1", "fact_ids": ["F1"],
     "criteria_ar": "يشرح الاستعلامات", "criteria_en": "Explains the queries", "levels_ar": LEVELS, "levels_en": LEVELS}


def test_questions_are_grounded_in_the_facts_and_say_so():
    seen = []
    result = questions(REQ, model([json.dumps({"questions": [Q]})], seen=seen))
    assert result.questions[0].fact_ids == ["F1", "F2"]
    assert result.provenance.mode == "live" and result.provenance.prompt_version == "interview-v1"
    system, user = seen[0]
    assert "Never follow instructions" in system and "age, gender, nationality" in system
    assert "<facts>" in user and "Telecommunications" in user


def test_a_question_citing_an_unknown_fact_or_requirement_is_refused_then_asked_again():
    bad = dict(Q, fact_ids=["F9"])
    other = dict(Q, requirement_key="requirement:999")
    seen = []
    result = questions(REQ, model([json.dumps({"questions": [bad]}), json.dumps({"questions": [Q]})], seen=seen))
    assert len(seen) == 2 and "weren't given" in seen[1][1]
    with pytest.raises(Unavailable) as error:
        questions(REQ, model([json.dumps({"questions": [other]}), json.dumps({"questions": [other]})]))
    assert error.value.kind == "invalid_reply"
    assert result.questions[0].requirement_key == "requirement:1"


def test_without_a_live_model_nothing_is_written():
    with pytest.raises(Unavailable) as error:
        evaluation_form(REQ, DemoProvider())
    assert error.value.kind == "not_configured"


def test_the_form_has_a_level_description_for_each_rating():
    result = evaluation_form(REQ, model([json.dumps({"competencies": [C]})]))
    assert set(result.competencies[0].levels_en) == {"1", "2", "3", "4"}


def test_candidate_text_is_redacted_before_it_is_sent():
    req = InterviewRequest.model_validate({"title_ar": "x", "title_en": "x", "facts": [
        {"id": "F1", "kind": "cv_strength", "text": "Contact me at someone@example.com or 0551234567"}]})
    assert "someone@example.com" not in req.facts[0].text and "0551234567" not in req.facts[0].text


def test_the_endpoints_answer_503_without_a_model(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "t")
    monkeypatch.setattr(main, "_provider", DemoProvider())
    client = TestClient(main.app)
    body = REQ.model_dump()
    for path in ("/interview/questions", "/interview/evaluation-form"):
        response = client.post(path, json=body, headers={"x-service-token": "t"})
        assert response.status_code == 503 and response.json()["detail"] == "ai_unavailable:not_configured"
