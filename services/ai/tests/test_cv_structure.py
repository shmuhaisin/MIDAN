"""CV structure: wrapped PDF lines, positions with their own responsibilities, names that are never job titles, skills
that are never sentences, and a model's answer held to the same rules. All text is fictional, written the way pypdf
returns a real PDF: one visual line at a time, often without bullet glyphs."""

import json
from collections import Counter

from midan_ai import cv
from midan_ai.cv_structure import find_dates, looks_like_name, normalize_text, top_fields

FINANCE_PDF_TEXT = """Corporate Banking Credit & Risk Specialist
Hessa Nasser Mutawa
Riyadh | hessa.test@example.com | +966 55 000 0005
Summary
Credit and risk specialist covering mid-market corporate clients, responsible for credit proposals,
covenant monitoring and the documentation of risk requirements.
Experience
Credit & Risk Specialist — Fictional Commercial Bank Sep 2019 – Present
Prepare credit proposals for corporate facilities up to SAR 50 million, assessing financial
statements, cash flows and collateral against the bank's credit risk requirements.
Monitor covenant compliance and maintain the documentation required by internal audit and the
regulator.
Credit Analyst — Fictional Finance House Jan 2017 – Aug 2019
Analysed SME loan applications and wrote risk memos for the credit committee.
Education
Master of Business Administration — Fictional Business School, 2016
Bachelor of Accounting in Finance — Fictional University for Women, 2014
Skills
Credit analysis, Financial statement analysis, Risk assessment, Covenant monitoring, Moody's
RiskCalc, credit analysis
Languages
Arabic (Native), English (Fluent)
"""


def local(text: str):
    sections = cv.split_sections(text, wrapped=True)
    return cv.normalize(cv.local_proposal(cv.local_sections(sections, []), None))


def test_a_job_title_is_never_taken_for_the_name():
    assert cv.extract_personal(FINANCE_PDF_TEXT)["full_name"] == "Hessa Nasser Mutawa"
    only_title = FINANCE_PDF_TEXT.replace("Hessa Nasser Mutawa\n", "")
    assert cv.extract_personal(only_title)["full_name"] is None  # Left for the candidate, not guessed.
    assert cv.extract_personal("Name: Senior Credit Analyst\nExperience\nAnalyst — Bank 2019")["full_name"] is None
    assert not looks_like_name("Corporate Banking Credit & Risk Specialist")
    assert not looks_like_name("Senior Financial Analyst")
    assert looks_like_name("سارة عبدالله الحربي") and not looks_like_name("أخصائية موارد بشرية")
    assert top_fields(FINANCE_PDF_TEXT.split("\n")[:3])["headline"] == "Corporate Banking Credit & Risk Specialist"


def test_a_title_saved_as_the_name_doesnt_erase_words_from_the_cv():
    data = cv.analyze(_docx(FINANCE_PDF_TEXT), ["Corporate Banking Credit & Risk Specialist"], None)
    assert data["counts"].get("name", 0) <= 2
    titles = [e["title"] for e in data["professional"]["experience"]]
    assert titles == ["Credit & Risk Specialist", "Credit Analyst"]


def test_wrapped_sentences_stay_whole_and_under_their_position():
    proposal = local(FINANCE_PDF_TEXT)
    first, second = proposal.experience
    assert (first.title, first.organization, first.start_year, first.end_year, first.current) == (
        "Credit & Risk Specialist", "Fictional Commercial Bank", 2019, None, True)
    assert first.responsibilities == [
        "Prepare credit proposals for corporate facilities up to SAR 50 million, assessing financial statements, cash flows and collateral against the bank's credit risk requirements.",
        "Monitor covenant compliance and maintain the documentation required by internal audit and the regulator.",
    ]
    assert (second.title, second.organization, second.start_year, second.end_year) == ("Credit Analyst", "Fictional Finance House", 2017, 2019)
    assert second.responsibilities == ["Analysed SME loan applications and wrote risk memos for the credit committee."]
    assert proposal.summary.endswith("the documentation of risk requirements.")


def test_fragments_never_become_positions():
    text = "Experience\nrequirements\ndocumentation\nregulator.\nData Analyst — Fictional Retail Co 2020 – 2022\nBuilt weekly sales reports in SQL.\n"
    proposal = local(text)
    assert [e.title for e in proposal.experience] == ["Data Analyst"]
    assert "experience" in proposal.uncertain  # What couldn't be placed is flagged for the candidate.


def test_skills_are_short_names_never_sentences_and_deduplicated():
    proposal = local(FINANCE_PDF_TEXT + "\nSkills\nResponsible for preparing credit proposals and monitoring covenants for corporate clients.\n")
    assert proposal.skills == ["Credit analysis", "Financial statement analysis", "Risk assessment", "Covenant monitoring", "Moody's RiskCalc"]


def test_education_has_degree_field_institution_and_year():
    first, second = local(FINANCE_PDF_TEXT).education
    assert (first.qualification, first.field, first.institution, first.end_year) == ("Master of Business Administration", None, "Fictional Business School", 2016)
    assert (second.qualification, second.field, second.institution, second.end_year) == ("Bachelor of Accounting", "Finance", "Fictional University for Women", 2014)
    arabic = local("التعليم\n2018 بكالوريوس إدارة أعمال — جامعة الملك الخيالية،\n").education[0]
    assert (arabic.qualification, arabic.field, arabic.institution, arabic.end_year) == ("بكالوريوس", "إدارة أعمال", "جامعة الملك الخيالية", 2018)


def test_missing_values_stay_empty():
    proposal = local("Experience\nCustomer Service Representative\nHandled customer enquiries by phone and chat.\n")
    entry = proposal.experience[0]
    assert (entry.title, entry.organization, entry.start_year, entry.end_year, entry.current) == ("Customer Service Representative", None, None, None, False)
    assert proposal.education == [] and proposal.headline is None


def test_arabic_presentation_forms_from_pdfs_are_read():
    pdf_like = "ﺍﻟﺨﺒﺮﺍﺕ ﺍﻟﻌﻤﻠﻴﺔ"  # presentation forms, as pypdf returns them
    assert cv.classify_heading(normalize_text(pdf_like)) == "experience"
    assert normalize_text("أﺧﺻﺎﺋﯾﺔ") == "أخصائية"
    assert normalize_text("حتى الآن2021") == "حتى الآن 2021"
    dates = find_dates("أخصائية موارد بشرية — شركة الأفق - حتى الآن 2021")
    assert (dates.start, dates.end, dates.current) == (2021, None, True)


def test_a_model_answer_is_held_to_the_same_rules():
    answer = {
        "headline": None,
        "experience": [
            {"title": "Credit & Risk Specialist", "organization": "[ORGANIZATION]", "start_year": None, "end_year": None,
             "current": False, "responsibilities": ["Prepare credit proposals for corporate facilities.", "documentation"]},
            {"title": "documentation", "responsibilities": []},
        ],
        "skills": ["Credit analysis", "Prepare credit proposals for corporate facilities up to SAR 50 million.", "credit analysis"],
        "uncertain": [],
    }
    data = cv.analyze(_docx(FINANCE_PDF_TEXT), [], lambda _s, _u: json.dumps(answer))
    assert data["mode"] == "external_ai"
    pro = data["professional"]
    assert [e["title"] for e in pro["experience"]] == ["Credit & Risk Specialist"]
    first = pro["experience"][0]
    # The employer and dates come from MIDAN's own reading: the model only ever saw a placeholder.
    assert (first["organization"], first["start_year"], first["current"]) == ("Fictional Commercial Bank", 2019, True)
    assert first["responsibilities"] == ["Prepare credit proposals for corporate facilities."]
    assert pro["skills"] == ["Credit analysis"]
    assert pro["headline"] == "Corporate Banking Credit & Risk Specialist"
    assert "experience" in pro["uncertain"]


def test_the_model_never_sees_the_name_contacts_or_employers():
    personal = cv.extract_personal(FINANCE_PDF_TEXT)
    sections = cv.split_sections(FINANCE_PDF_TEXT, wrapped=True)
    found = cv.local_proposal(cv.local_sections(sections, []))
    organizations = [e.organization for e in found.experience] + [e.institution for e in found.education]
    sent = json.dumps(cv.build_payload(sections, [personal["full_name"]], Counter(), "Corporate Banking Credit & Risk Specialist", organizations), ensure_ascii=False)
    for value in ("Hessa", "Mutawa", "hessa.test@example.com", "000 0005", "Fictional Commercial Bank", "Fictional Finance House",
                  "Fictional Business School", "Fictional University for Women"):
        assert value not in sent
    assert "Prepare credit proposals for corporate facilities up to SAR 50 million, assessing financial statements" in sent


def _docx(text: str) -> bytes:
    import io
    import zipfile
    from xml.sax.saxutils import escape

    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in text.split("\n"))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f"<w:document {ns}><w:body>{body}</w:body></w:document>")
    return buffer.getvalue()
