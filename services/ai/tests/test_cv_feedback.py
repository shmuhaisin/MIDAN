"""CV analysis beyond sections: languages, achievements, skill kinds with evidence quoted from the CV, and MIDAN's
rule-based suggestions kept apart from the facts. Fictional CV text only."""

import json

from midan_ai.cv import external_proposal, feedback, ground, local_proposal, split_sections

CV = """الملخص
محلل بيانات يركز على التقارير الشهرية
الخبرات
محلل تقارير في شركة وهمية 2020 - 2024، بنيت لوحات Excel للإدارة
قدت فريقًا من ثلاثة محللين ورفعت دقة التقارير 30%
التعليم
بكالوريوس نظم معلومات 2019
المهارات
Excel، التواصل، القيادة، SQL
اللغات
العربية
الإنجليزية
الإنجازات
جائزة أفضل تقرير ربعي 2023
"""


def test_local_reading_keeps_languages_and_achievements():
    sections = split_sections(CV)
    proposal = ground(local_proposal(sections), sections)
    assert [lang.name for lang in proposal.languages] == ["العربية", "الإنجليزية"]
    assert [a.title for a in proposal.achievements] == ["جائزة أفضل تقرير ربعي 2023"]


def test_each_skill_points_to_a_line_of_the_cv_or_to_nothing():
    sections = split_sections(CV)
    details = {d.name: d for d in ground(local_proposal(sections), sections).skill_details}
    assert details["Excel"].evidence == "محلل تقارير في شركة وهمية 2020 - 2024، بنيت لوحات Excel للإدارة"
    # Nothing in the experience shows SQL being used, so there is no evidence rather than an invented one.
    assert details["SQL"].evidence is None
    # Transferable skills are told apart; the rest isn't guessed.
    assert details["التواصل"].kind == "general"
    assert details["Excel"].kind == "unclassified"
    assert set(details) == {"Excel", "التواصل", "القيادة", "SQL"}


def test_a_model_cannot_add_evidence_the_cv_does_not_contain():
    sections = split_sections(CV)
    answer = {
        "skills": ["Excel", "SQL"],
        "skill_details": [
            {"name": "Excel", "kind": "technical", "evidence": "بنيت لوحات Excel للإدارة"},
            {"name": "SQL", "kind": "technical", "evidence": "Wrote SQL pipelines for ten years"},
        ],
        "languages": [{"name": "العربية", "level": "اللغة الأم"}],
    }
    proposal = ground(external_proposal(lambda _s, _u: json.dumps(answer, ensure_ascii=False), sections), sections)
    details = {d.name: d for d in proposal.skill_details}
    assert details["Excel"].evidence == "بنيت لوحات Excel للإدارة"
    assert details["Excel"].kind == "technical"
    assert details["SQL"].evidence is None
    assert proposal.languages[0].level == "اللغة الأم"


def test_suggestions_come_from_rules_and_are_not_a_score():
    sections = split_sections(CV)
    proposal = ground(local_proposal(sections), sections)
    items = feedback(proposal, sections)
    codes = {(i["type"], i["code"]) for i in items}
    assert ("strength", "dated_experience") in codes
    assert ("strength", "measurable_results") in codes
    assert ("gap", "skills_without_evidence") in codes
    # Matching is literal: "قدت فريقًا" doesn't name "القيادة", so no line is claimed for it.
    assert next(i for i in items if i["code"] == "skills_without_evidence")["values"] == ["التواصل", "القيادة", "SQL"]
    assert next(i for i in items if i["code"] == "skills_with_evidence")["values"] == ["Excel"]
    assert all(set(i) == {"type", "code", "values"} for i in items)
    assert not any("score" in json.dumps(i) for i in items)


def test_missing_sections_and_results_are_suggestions():
    sections = split_sections("المهارات\nExcel\n")
    items = feedback(ground(local_proposal(sections), sections), sections)
    missing = [i["values"][0] for i in items if i["code"] == "missing_section"]
    assert missing == ["summary", "experience", "education"]
    assert any(i["code"] == "no_languages" for i in items)
