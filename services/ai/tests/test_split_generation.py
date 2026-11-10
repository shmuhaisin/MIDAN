"""The package written in three parts for a provider with a small tokens-per-minute limit (Groq): the case, the assessor guide,
then each criterion's levels. Fake completions only; the live run is scripts/stc-assessment-live.mjs."""

import copy
import json

import pytest

from midan_ai.providers import CASE_PROMPT, GUIDE_WRITE_PROMPT, LEVELS_PROMPT, MATERIALS_PROMPT, JsonLLMProvider, LLMError
from tests.package_fixture import package


def _parts():
    full = package()
    case = copy.deepcopy(full)
    guide = case.pop("assessor_guide")
    levels = []
    for i, task in enumerate(case["tasks"]):
        for k, c in enumerate(task.get("criteria", [])):
            levels.append({"task_ref": i + 1, "criterion": k + 1, "levels_ar": c.pop("levels_ar"), "levels_en": c.pop("levels_en")})
    filled = {"materials": [{k: m[k] for k in ("id", "columns", "rows", "content_ar", "content_en") if k in m} for m in case["materials"]]}
    for m in case["materials"]:
        for k in ("columns", "rows", "content_ar", "content_en"):
            m.pop(k, None)
    return full, case, guide, levels and {"levels": levels}, filled


def _provider(replies, seen):
    def complete(system, user, schema=None, budget=None):
        seen.append({"system": system, "user": user, "schema": schema, "budget": budget})
        return replies.pop(0)
    complete.accepts_schema = True
    return JsonLLMProvider(complete, "fake-model", provider="groq", pause=0, split_generation=True)


def test_three_parts_make_one_complete_package():
    full, case, guide, levels, filled = _parts()
    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(filled), json.dumps(guide), json.dumps(levels)], seen)
    draft = provider.generate_assessment({"title_en": "Inventory Analyst"})
    assert [s["schema"][0] for s in seen] == ["AssessmentCase", "AssessmentMaterials", "AssessorGuideDraft", "CriterionLevels"]
    assert seen[0]["system"] == CASE_PROMPT and seen[1]["system"] == MATERIALS_PROMPT
    assert seen[2]["system"] == GUIDE_WRITE_PROMPT and seen[3]["system"] == LEVELS_PROMPT
    # The materials come back whole: the stubs' columns and rows as part 2 wrote them.
    assert [m.model_dump(exclude_none=True)["rows"] for m in draft.materials if m.rows] == [m["rows"] for m in full["materials"] if m.get("rows")]
    # Each call's output budget is what the minute leaves after its input.
    assert all(s["budget"] and s["budget"] < 8000 for s in seen)
    assert draft.standardized
    assert draft.assessor_guide.model_dump(exclude_none=True)["verification_steps"] == guide["verification_steps"]
    criteria = [c for t in draft.tasks for c in t.criteria]
    expected = [c for t in full["tasks"] for c in t.get("criteria", [])]
    assert [c.levels_en for c in criteria] == [c["levels_en"] for c in expected]
    assert [c.levels_ar for c in criteria] == [c["levels_ar"] for c in expected]


def test_the_guide_never_sees_the_arabic_rubric_twice_and_the_case_carries_no_guide():
    _, case, guide, levels, filled = _parts()
    case["assessor_guide"] = guide  # a model that ignores the note: its guide is dropped and written in part 3
    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(filled), json.dumps(guide), json.dumps(levels)], seen)
    provider.generate_assessment({"title_en": "Inventory Analyst"})
    assert "<assessor_guide>" not in seen[2]["user"]
    assert "<materials>" in seen[2]["user"] and "<tasks>" in seen[2]["user"] and '"rows"' in seen[2]["user"]


def test_missing_levels_are_asked_for_again_with_the_reason():
    _, case, guide, levels, filled = _parts()
    incomplete = {"levels": levels["levels"][:-1]}
    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(filled), json.dumps(guide), json.dumps(incomplete), json.dumps(levels)], seen)
    draft = provider.generate_assessment({"title_en": "Inventory Analyst"})
    assert "levels 0 to 4 in both languages are missing" in seen[4]["user"]
    assert all(set(c.levels_en) == set("01234") for t in draft.tasks for c in t.criteria)


def test_a_part_that_never_validates_fails_the_generation():
    _, case, _, _, filled = _parts()
    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(filled), "not json", "{\"scope_and_limits\": []}"], seen)
    with pytest.raises(LLMError) as error:
        provider.generate_assessment({"title_en": "Inventory Analyst"})
    assert error.value.kind == "invalid_reply"


def test_a_check_failure_on_the_case_is_retried_before_the_other_parts():
    _, case, guide, levels, filled = _parts()
    calls = {"n": 0}

    def check(draft):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError('task title "Case study" is generic')

    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(case), json.dumps(filled), json.dumps(guide), json.dumps(levels)], seen)
    provider.generate_assessment({"title_en": "Inventory Analyst"}, check)
    assert [s["schema"][0] for s in seen] == ["AssessmentCase", "AssessmentCase", "AssessmentMaterials", "AssessorGuideDraft", "CriterionLevels"]
    assert "is generic" in seen[1]["user"]


def test_ids_are_mended_the_same_way_everywhere_they_are_used():
    from midan_ai.providers import _mend_ids
    data = {"materials": [{"id": "M-1"}], "candidate_brief": {"deliverables": [{"id": "D1"}]},
            "tasks": [{"deliverable_ids": ["D1"], "material_ids": ["M-1"]}],
            "assessor_guide": {"calculations": [{"inputs": ["M-1.revenue"], "check": {"material": "M-1"}}]}}
    out = _mend_ids(data)
    assert out["materials"][0]["id"] == "m_1" and out["candidate_brief"]["deliverables"][0]["id"] == "d1"
    assert out["tasks"][0] == {"deliverable_ids": ["d1"], "material_ids": ["m_1"]}
    calc = out["assessor_guide"]["calculations"][0]
    assert calc["inputs"] == ["m_1.revenue"] and calc["check"]["material"] == "m_1"


def test_a_table_without_rows_is_asked_for_again():
    _, case, guide, levels, filled = _parts()
    empty = {"materials": [{"id": m["id"], "columns": [], "rows": []} for m in case["materials"]]}
    seen: list[dict] = []
    provider = _provider([json.dumps(case), json.dumps(empty), json.dumps(filled), json.dumps(guide), json.dumps(levels)], seen)
    provider.generate_assessment({"title_en": "Inventory Analyst"})
    assert "needs columns and at least 4 rows" in seen[2]["user"]


def test_token_estimate_counts_arabic_as_heavier():
    from midan_ai.providers import estimate_tokens
    assert estimate_tokens("a" * 400) == 101
    assert estimate_tokens("ب" * 250) == 101


def test_a_retry_reuses_the_parts_already_written():
    _, case, guide, levels, filled = _parts()
    seen: list[dict] = []
    replies = [json.dumps(case), json.dumps(filled), LLMError("429", "quota_exhausted"), LLMError("429", "quota_exhausted"),
               json.dumps(guide), json.dumps(levels)]

    def complete(system, user, schema=None, budget=None):
        seen.append(schema[0])
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
    complete.accepts_schema = True
    provider = JsonLLMProvider(complete, "fake-model", provider="groq", pause=0, split_generation=True)
    with pytest.raises(LLMError):
        provider.generate_assessment({"title_en": "Inventory Analyst"})
    draft = provider.generate_assessment({"title_en": "Inventory Analyst"})
    # The second run asked only for the guide and the levels: the case and the materials came from the first.
    assert seen == ["AssessmentCase", "AssessmentMaterials", "AssessorGuideDraft", "AssessorGuideDraft", "AssessorGuideDraft", "CriterionLevels"]
    assert draft.standardized
