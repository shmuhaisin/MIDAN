"""ATS stage 3 (cv_review.py) with a fake model: grounded in the submitted lines, never changing the matcher's status or score."""

import json

import pytest

from midan_ai.cv_review import CvReviewRequest, ReviewUnavailable, review_cv
from midan_ai.providers import DemoProvider, JsonLLMProvider, LLMError

REQUEST = {
    "title_en": "Data Analyst",
    "requirements": [
        {"key": "requirement:a", "text": "Analyse customer churn", "mandatory": True, "status": "matched", "evidence_id": "experience:0:1"},
        {"key": "requirement:b", "text": "Build dashboards", "mandatory": True, "status": "partial", "evidence_id": "skill:0"},
        {"key": "requirement:c", "text": "Experience in data analysis", "mandatory": False, "min_years": 2, "status": "missing"},
    ],
    "evidence": [
        {"id": "experience:0", "source": "experience", "text": "Data analyst, Fictional Telecom Co", "years": 4},
        {"id": "experience:0:1", "source": "experience", "text": "Built SQL reports on customer churn for monthly reviews"},
        {"id": "skill:0", "source": "skill", "text": "Power BI"},
        {"id": "summary:0", "source": "summary", "text": "Contact me at someone@example.com or 0551234567"},
    ],
}


def _review(key, reading, ids, confidence=0.9):
    return {"key": key, "reading": reading, "evidence_ids": ids, "relevant_experience_en": "x", "relevant_experience_ar": "س",
            "explanation_en": "Because the line says so.", "explanation_ar": "لأن السطر يذكر ذلك.", "missing_en": "", "missing_ar": "",
            "confidence": confidence}


def _provider(replies, seen):
    def complete(system, user, schema=None, **_):
        seen.append(user)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
    complete.accepts_schema = True
    return JsonLLMProvider(complete, "fake", provider="groq", pause=0)


def test_readings_are_grounded_and_a_disagreement_goes_to_a_person():
    seen: list[str] = []
    reply = {"reviews": [_review("requirement:a", "confirmed", ["experience:0:1"]),
                         _review("requirement:b", "insufficient_evidence", ["skill:0"], 0.8),
                         _review("requirement:c", "partial", ["experience:0"], 0.5)]}
    out = review_cv(CvReviewRequest.model_validate(REQUEST), _provider([json.dumps(reply)], seen))
    by = {r.key: r for r in out.reviews}
    assert by["requirement:a"].agrees and not by["requirement:a"].manual_review
    assert by["requirement:a"].evidence[0]["text"].startswith("Built SQL reports")
    # The matcher said partial and the model reads insufficient evidence: kept apart, flagged for a person.
    assert by["requirement:b"].matcher_status == "partial" and not by["requirement:b"].agrees and by["requirement:b"].manual_review
    assert by["requirement:c"].manual_review  # low confidence and a different reading
    assert out.counts["manual_review"] == 2
    # Nothing in the result is a score: the CV score stays the matcher's, computed with MIDAN's formula.
    assert "score" not in json.dumps(out.model_dump()).replace("score_", "")
    # Contact details never leave MIDAN.
    assert "someone@example.com" not in seen[0] and "0551234567" not in seen[0]


def test_an_invented_evidence_id_is_refused_and_asked_again():
    seen: list[str] = []
    bad = {"reviews": [_review("requirement:a", "confirmed", ["experience:9"]), _review("requirement:b", "partial", ["skill:0"]),
                       _review("requirement:c", "missing", [])]}
    good = {"reviews": [_review("requirement:a", "confirmed", ["experience:0:1"]), _review("requirement:b", "partial", ["skill:0"]),
                        _review("requirement:c", "missing", [])]}
    out = review_cv(CvReviewRequest.model_validate(REQUEST), _provider([json.dumps(bad), json.dumps(good)], seen))
    assert "aren't in <evidence>" in seen[1]
    assert all(r.agrees for r in out.reviews)


def test_a_confirmed_reading_without_evidence_is_refused():
    seen: list[str] = []
    bad = {"reviews": [_review("requirement:a", "confirmed", []), _review("requirement:b", "partial", ["skill:0"]), _review("requirement:c", "missing", [])]}
    with pytest.raises(ReviewUnavailable) as error:
        review_cv(CvReviewRequest.model_validate(REQUEST), _provider([json.dumps(bad), json.dumps(bad)], seen))
    assert error.value.kind == "invalid_reply"


def test_without_a_live_model_nothing_is_written():
    with pytest.raises(ReviewUnavailable) as error:
        review_cv(CvReviewRequest.model_validate(REQUEST), DemoProvider())
    assert error.value.kind == "not_configured"


def test_a_rate_limit_is_reported_as_such():
    with pytest.raises(ReviewUnavailable) as error:
        review_cv(CvReviewRequest.model_validate(REQUEST), _provider([LLMError("429", "rate_limited")], []))
    assert error.value.kind == "rate_limited"
