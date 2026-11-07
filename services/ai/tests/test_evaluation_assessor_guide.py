"""Scoring with the assessor guide of the attempt's own assessment version. Fictional content only."""

import json

from midan_ai.providers import PROMPT_VERSION, JsonLLMProvider, assessor_guidance
from midan_ai.schemas import CriterionInput, TaskInput

TASK = TaskInput(id="t1", task_type="written_case_study", title_en="Monthly report", title_ar="التقرير الشهري", instructions_en="Explain the change.",
                 instructions_ar="اشرحوا التغير.", weight=1, criteria=[])


def criterion(**guide):
    return CriterionInput(id="c1", code="C1", description_en="Explains the cause", description_ar="يشرح السبب", max_score=4, **guide)


def test_the_guide_reaches_the_scorer_when_the_version_has_one():
    seen = []

    def complete(system, user):
        seen.append(user)
        return json.dumps({"score": 3, "evidence_quote": "returns rose", "explanation": "Names the cause.", "confidence": 0.8})

    guided = criterion(levels_en={"0": "No cause", "4": "Cause with figures"}, levels_ar={"4": "السبب مع الأرقام"}, evidence_en="Quotes a figure from the table")
    JsonLLMProvider(complete, "stub", attempts=1, pause=0).score_open(TASK, guided, "Sales fell because returns rose.")
    assert "Score against the assessor guide below. It belongs to this assessment version." in seen[0]
    assert "Assessor guide levels (English): 0: No cause; 4: Cause with figures" in seen[0]
    assert "Assessor guide levels (Arabic): 4: السبب مع الأرقام" in seen[0]
    assert "Evidence this criterion needs (English): Quotes a figure from the table" in seen[0]
    assert PROMPT_VERSION == "eval-v3-guide"


def test_without_a_guide_nothing_is_invented():
    assert assessor_guidance(criterion()) == ""
