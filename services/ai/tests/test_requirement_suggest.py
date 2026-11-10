"""Requirement suggestions (requirement_suggest.py) with a fake model: specific, never repeating, live model only."""

import json

import pytest

from midan_ai.providers import DemoProvider, JsonLLMProvider, LLMError
from midan_ai.requirement_suggest import SuggestRequest, SuggestUnavailable, suggest


def _s(en, ar, kind="competency", category="technical", **over):
    return {"requirement_type": kind, "category": category, "description_ar": ar, "description_en": en, "mandatory": True,
            "proficiency": "working", "min_years": None, "explanation_ar": "لأن العمل اليومي يعتمد عليها", "explanation_en": "The daily work depends on it.", **over}


GOOD = {"suggestions": [_s("SQL for joining and aggregating subscriber data", "SQL لربط بيانات المشتركين وتجميعها"),
                        _s("Building Power BI dashboards for commercial teams", "بناء لوحات Power BI للفرق التجارية", category="tool"),
                        _s("Explaining churn findings to non-technical managers", "شرح نتائج فقدان العملاء للمديرين غير التقنيين", category="soft"),
                        _s("Customer segmentation and cohort analysis", "تقسيم العملاء وتحليل الأفواج", category="knowledge"),
                        _s("Experience analysing customer data", "خبرة في تحليل بيانات العملاء", kind="experience", category="experience", min_years=2)]}


def _provider(replies, seen):
    def complete(system, user, schema=None, **_):
        seen.append(user)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
    complete.accepts_schema = True
    return JsonLLMProvider(complete, "fake", provider="groq", pause=0)


REQUEST = SuggestRequest(title_en="Data Analyst", title_ar="محلل بيانات", industry="technology", business_domain="Telecommunications",
                         existing=[{"requirement_type": "competency", "text": "Build SQL reports and dashboards for the commercial team"}])


def test_a_suggestion_that_repeats_an_existing_requirement_is_asked_again():
    repeat = {"suggestions": [_s("Build SQL reports and dashboards for the commercial team", "إعداد تقارير SQL"), *GOOD["suggestions"][1:]]}
    seen: list[str] = []
    out = suggest(REQUEST, _provider([json.dumps(repeat), json.dumps(GOOD)], seen))
    assert "repeats the existing requirement" in seen[1]
    assert len(out.suggestions) == 5 and out.provenance["mode"] == "live"
    assert "Telecommunications" in seen[0]


def test_min_years_only_on_experience_and_required_there():
    no_years = {"suggestions": [*GOOD["suggestions"][:4], _s("Experience analysing customer data", "خبرة", kind="experience", category="experience")]}
    seen: list[str] = []
    out = suggest(REQUEST, _provider([json.dumps(no_years), json.dumps(GOOD)], seen))
    assert "needs min_years" in seen[1]
    assert [s.min_years for s in out.suggestions if s.requirement_type != "experience"] == [None] * 4


def test_without_a_live_model_nothing_is_suggested():
    with pytest.raises(SuggestUnavailable) as error:
        suggest(REQUEST, DemoProvider())
    assert error.value.kind == "not_configured"


def test_a_quota_is_reported_as_such():
    with pytest.raises(SuggestUnavailable) as error:
        suggest(REQUEST, _provider([LLMError("429", "quota_exhausted")], []))
    assert error.value.kind == "quota_exhausted"
