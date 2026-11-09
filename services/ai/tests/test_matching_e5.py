"""The real intfloat/multilingual-e5-base backend on known pairs, including across Arabic and English. Skipped, with the
reason, when the optional `matching` extra or the model files aren't on this machine (it never downloads them)."""

import os

import pytest

pytest.importorskip("sentence_transformers", reason="optional extra not installed: uv sync --extra matching")
if os.environ.get("HF_HUB_OFFLINE") != "1" or not os.environ.get("HF_HOME"):
    pytest.skip("set HF_HOME to the model files and HF_HUB_OFFLINE=1 (no silent downloads)", allow_module_level=True)

from midan_ai.matching import E5Local, EvidenceIn, MatchRequest, RequirementIn, match  # noqa: E402

EVIDENCE = [
    EvidenceIn(id="experience:0", text="Built weekly sales dashboards in Power BI for the regional retail team", source="experience"),
    EvidenceIn(id="experience:1", text="صممت هويات بصرية وشعارات لعلامات تجارية محلية", source="experience"),
    EvidenceIn(id="experience:2", text="Monitored security alerts in a SIEM and wrote incident reports", source="experience"),
]


def test_the_right_evidence_wins_across_languages():
    result = match(MatchRequest(requirements=[
        RequirementIn(key="requirement:dash", text="تحليل البيانات وإعداد لوحات معلومات تفاعلية"),
        RequirementIn(key="requirement:design", text="Graphic design and brand identity"),
        RequirementIn(key="requirement:soc", text="الأمن السيبراني ومراقبة التنبيهات الأمنية"),
    ], evidence=EVIDENCE), E5Local())
    # Every requirement shows the line that best supports it: even an uncertain one goes to a person with that line.
    picked = {m.key: m.evidence_id for m in result.matches if m.evidence_id}
    assert all(m.status != "missing" for m in result.matches)
    assert picked.get("requirement:dash") == "experience:0"
    assert picked.get("requirement:design") == "experience:1"
    assert picked.get("requirement:soc") == "experience:2"
    assert result.provenance["model_version"] == "intfloat/multilingual-e5-base"


def test_unrelated_requirements_are_not_called_matched():
    result = match(MatchRequest(requirements=[RequirementIn(key="requirement:x", text="Operating heavy cranes on construction sites")], evidence=EVIDENCE), E5Local())
    assert result.matches[0].status != "matched"


def _status(requirement: str, evidence: list[str]):
    result = match(MatchRequest(requirements=[RequirementIn(key="requirement:x", text=requirement)],
                                evidence=[EvidenceIn(id=f"experience:{i}", text=t, source="experience") for i, t in enumerate(evidence)]), E5Local())
    return result.matches[0]


def test_arabic_cv_against_an_english_job_and_english_cv_against_an_arabic_job():
    ar_cv = ["حللت بيانات العملاء بلغة بايثون ومكتبة pandas", "نظمت مؤتمرًا لأربعمئة مشارك"]
    assert _status("Python data analysis", ar_cv).evidence_id == "experience:0"
    en_cv = ["Organized a conference for 400 attendees", "Reviewed supplier contracts for regulatory compliance"]
    assert _status("مراجعة العقود والامتثال للأنظمة", en_cv).evidence_id == "experience:1"


def test_mixed_language_lines_and_paraphrases_find_their_evidence():
    cv = ["Built dashboards في Power BI للمبيعات الشهرية", "Answered customer complaints by phone and email"]
    assert _status("Customer service and handling complaints", cv).evidence_id == "experience:1"
    assert _status("إعداد لوحات معلومات المبيعات", cv).evidence_id == "experience:0"


def test_negation_holds_with_the_semantic_model_too():
    m = _status("Python programming", ["No experience in Python", "Organized a conference for 400 attendees"])
    assert m.status != "matched" and m.reason_code in ("negated", "missing")
    assert m.reason_code != "negated" or m.evidence_text == "No experience in Python"
