"""Real Groq calls, separately for CV analysis and for evaluation (generation is test_assessment_standard.py's real test).
Run only with MIDAN_REAL_PROVIDER_TESTS=1 and AI_PROVIDER=groq, GROQ_API_KEY and GROQ_MODEL set; otherwise skipped and
reported as NOT RUN. Every input is fictional. Nothing here falls back to a stand-in: without Groq it doesn't run."""

import os

import pytest

from midan_ai.cv import analyze
from midan_ai.providers import get_provider
from midan_ai.schemas import CriterionInput, TaskInput
from test_cv_privacy import docx

REAL = os.environ.get("MIDAN_REAL_PROVIDER_TESTS") == "1"
pytestmark = pytest.mark.skipif(not REAL, reason="Real provider tests run only with MIDAN_REAL_PROVIDER_TESTS=1 and real keys (NOT RUN)")


@pytest.fixture(scope="module")
def groq():
    provider = get_provider({**os.environ, "AI_PROVIDER": "groq"})
    if provider.provenance.mode != "live" or provider.provenance.provider != "groq":
        pytest.skip("No Groq key and model configured (NOT RUN)")
    return provider


CV = """الملخص
محلل بيانات خيالي يعمل على تقارير المبيعات الشهرية.
الخبرات
محلل تقارير في شركة خيالية 2021 - 2024، أعددت تقارير Excel شهرية للإدارة وخفضت وقت إعدادها 30%
التعليم
بكالوريوس نظم معلومات 2020
المهارات
Excel، تحليل البيانات، التواصل
اللغات
العربية
الإنجليزية
الإنجازات
جائزة خيالية لأفضل تقرير ربعي 2023"""


def test_groq_structures_a_fictional_cv_within_the_privacy_pipeline(groq):
    result = analyze(docx(CV), [], groq.complete)
    assert result["status"] == "ok", result
    assert result["mode"] == "external_ai"
    pro = result["professional"]
    assert pro["experience"] and pro["skills"]
    assert any("Excel" in s for s in pro["skills"])
    # Evidence is quoted from the CV or dropped; the model can't add a line the CV doesn't have.
    flat = " ".join(CV.split())
    for d in pro["skill_details"]:
        assert d["evidence"] is None or " ".join(d["evidence"].split()) in flat
    assert all(set(f) == {"type", "code", "values"} for f in pro["feedback"])


TASK = TaskInput(
    id="t1", task_type="written_case_study", weight=1, criteria=[],
    title_ar="تفسير تراجع المبيعات", instructions_ar="بيّنوا سبب تراجع مبيعات شهر خيالي واقترحوا خطوة واحدة.",
    title_en="Explaining a sales drop", instructions_en="Explain why a fictional month's sales fell and propose one next step.",
)
CRITERION = CriterionInput(
    id="c1", code="C1", max_score=10, description_en="Identifies the cause from the stated figures and proposes a fitting next step",
    description_ar="يحدد السبب من الأرقام المذكورة ويقترح خطوة مناسبة",
)
STRONG = ("Sales fell 12% in the fictional month because returns doubled from 40 to 80 orders, all in one product line. "
          "I would check that line's supplier batch first, and pause promotions on it until the cause is confirmed.")
WEAK = "Sales go up and down."


def test_groq_scores_against_the_rubric_and_quotes_its_evidence(groq):
    strong = groq.score_open(TASK, CRITERION, STRONG)
    weak = groq.score_open(TASK, CRITERION, WEAK)
    assert 0 <= weak.score <= 10 and 0 <= strong.score <= 10
    assert strong.score > weak.score, (strong, weak)
    for scored, answer in ((strong, STRONG), (weak, WEAK)):
        assert scored.explanation
        assert not scored.evidence_quote or scored.evidence_quote in answer
    assert groq.provenance.provider == "groq" and groq.provenance.model_version == os.environ["GROQ_MODEL"]
