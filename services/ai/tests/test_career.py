"""Career readiness (career.py) with a fake model: grounded plans, catalog-only recommendations, the person's own quotes."""

import json

import pytest

from midan_ai.career import CareerUnavailable, EvaluateRequest, PlanRequest, evaluate, plan
from midan_ai.providers import DemoProvider, JsonLLMProvider


def _provider(replies, seen):
    def complete(system, user, schema=None, **_):
        seen.append(user)
        return replies.pop(0)
    complete.accepts_schema = True
    return JsonLLMProvider(complete, "fake", provider="groq", pause=0)


def _req(key, name, importance="core", category="technical"):
    return {"key": key, "name_ar": f"مهارة {name}", "name_en": name, "category": category, "importance": importance,
            "proficiency": "working", "why_ar": "لأنها أساسية في الدور", "why_en": "It is central to the role"}


def _q(qid, keys):
    return {"id": qid, "kind": "scenario", "requirement_keys": keys, "prompt_ar": "حلّل هذه البيانات الوهمية واكتب توصية واضحة للمدير",
            "prompt_en": "Analyse this invented data and write a clear recommendation for the manager", "rubric_ar": "يحسب ويبرر",
            "rubric_en": "Computes and justifies", "minutes": 10}


PLAN = {"title_ar": "محلل بيانات", "title_en": "Data Analyst", "summary_ar": "يحلل البيانات لدعم القرار.", "summary_en": "Analyses data to support decisions.",
        "requirements": [_req("R1", "SQL"), _req("R2", "Dashboards"), _req("R3", "Statistics", "important"), _req("R4", "Communication", "important", "soft"),
                         _req("R5", "Excel", "helpful", "tool")],
        "questions": [_q("Q1", ["R1"]), _q("Q2", ["R2", "R3"]), _q("Q3", ["R4"])]}


def test_a_plan_must_test_every_core_requirement():
    untested = {**PLAN, "questions": [_q("Q1", ["R1"]), _q("Q2", ["R3"]), _q("Q3", ["R4"])]}
    seen: list[str] = []
    out = plan(PlanRequest(target_title="محلل بيانات", profile=[{"id": "headline:0", "source": "headline", "text": "Analyst, call 0551234567"}]),
               _provider([json.dumps(untested), json.dumps(PLAN)], seen))
    assert "untested: ['R2']" in seen[1]
    assert [r.key for r in out.requirements] == ["R1", "R2", "R3", "R4", "R5"]
    assert out.provenance["mode"] == "live"
    assert "0551234567" not in seen[0]


def test_without_a_live_model_nothing_is_planned():
    with pytest.raises(CareerUnavailable):
        plan(PlanRequest(target_title="Data analyst"), DemoProvider())


def _evaluation(**over):
    base = {"questions": [{"question_id": "Q1", "score": 3, "quote": "I would join the tables on customer id", "strengths_ar": "جيد", "strengths_en": "Good",
                           "improve_ar": "أضف التحقق", "improve_en": "Add a check"},
                          {"question_id": "Q2", "score": 4, "quote": "invented", "improve_ar": "لا شيء", "improve_en": "Nothing"}],
            "readiness": "developing", "readiness_ar": "يظهر الملف SQL ولا تظهر اللوحات.", "readiness_en": "The profile shows SQL but not dashboards.",
            "roadmap": [{"title_ar": "بناء لوحة", "title_en": "Build a dashboard", "why_ar": "فجوة أساسية", "why_en": "A core gap", "requirement_keys": ["R2"],
                         "actions_ar": ["ابنِ لوحة"], "actions_en": ["Build one"], "weeks": 3, "resource_ids": ["c1"]}],
            "recommendations": [{"resource_id": "c1", "requirement_keys": ["R2"], "reason_ar": "يغطي اللوحات", "reason_en": "Covers dashboards"}]}
    base.update(over)
    return base


REQUEST = {"target_title": "Data Analyst",
           "requirements": [{"key": "R1", "name_en": "SQL", "name_ar": "SQL", "importance": "core", "status": "matched", "evidence_text": "Wrote SQL reports"},
                            {"key": "R2", "name_en": "Dashboards", "name_ar": "لوحات", "importance": "core", "status": "missing"}],
           "questions": [_q("Q1", ["R1"]), _q("Q2", ["R2"])],
           "answers": [{"question_id": "Q1", "text": "First, I would join the tables on customer id and then count churned users."}],
           "catalog": [{"id": "c1", "kind": "course", "title": "Dashboards course", "provider": "Provider", "skills": ["dashboards"]}]}


def test_recommendations_come_only_from_the_catalog_and_quotes_only_from_the_answer():
    invented = _evaluation(recommendations=[{"resource_id": "made-up", "requirement_keys": ["R2"], "reason_ar": "سبب مختلق هنا", "reason_en": "A reason"}])
    seen: list[str] = []
    out = evaluate(EvaluateRequest.model_validate(REQUEST), _provider([json.dumps(invented), json.dumps(_evaluation())], seen))
    assert "isn't in <catalog>" in seen[1]
    assert [r.resource_id for r in out.recommendations] == ["c1"]
    by = {q.question_id: q for q in out.questions}
    assert by["Q1"].quote == "I would join the tables on customer id" and by["Q1"].score == 3
    # Q2 wasn't answered: 0, and the quote the model made up is dropped.
    assert by["Q2"].score == 0 and by["Q2"].quote == ""


def test_with_no_fitting_catalog_item_nothing_is_recommended():
    request = {**REQUEST, "catalog": []}
    reply = _evaluation(recommendations=[], roadmap=[{**_evaluation()["roadmap"][0], "resource_ids": []}])
    out = evaluate(EvaluateRequest.model_validate(request), _provider([json.dumps(reply)], []))
    assert out.recommendations == [] and out.catalog_considered == 0
