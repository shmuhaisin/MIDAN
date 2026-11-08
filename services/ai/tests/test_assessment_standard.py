"""The MIDAN Assessment Standard and its quality evaluator (docs/assessment/GENERATION_QUALITY_BENCHMARK.md).

How each test reaches a provider is in its name:
- no prefix: the deterministic evaluator and mapping, no provider at all;
- `mock_`: a stand-in that answers in the OpenAI or Gemini wire format. It is not a real integration;
- `template_`: the template fallback MIDAN uses when no model is configured;
- `real_`: a real provider. Runs only with MIDAN_REAL_PROVIDER_TESTS=1 and real keys in the environment; otherwise skipped.
"""
import inspect
import json
import os
import tempfile

os.environ.setdefault("AI_SERVICE_TOKEN", "test-token")
os.environ.setdefault("CHECKPOINT_DB", os.path.join(tempfile.mkdtemp(), "c.sqlite"))

import pytest
from langgraph.checkpoint.memory import InMemorySaver

import package_fixture as fixture
from midan_ai import providers, standard as S
from midan_ai.assessment_builder import build_assessment_graph, make_generator
from midan_ai.package import from_stored, normalize, to_stored
from midan_ai.providers import DemoProvider, JsonLLMProvider, _gemini, _openai, get_provider
from midan_ai.quality import evaluate, recompute
from midan_ai.schemas import GeneratedAssessment, JobFamily, JobInput


def report(job=None, pkg=None):
    return evaluate(JobInput.model_validate(job or fixture.job()), normalize(GeneratedAssessment.model_validate(pkg or fixture.package())))


def codes(r):
    return {f.code for f in r.errors} | {f.code for f in r.warnings}


# --- the standard itself -----------------------------------------------------------------------------------------------------

def test_the_standard_is_versioned_and_its_families_match_the_schema():
    assert S.STANDARD_VERSION == "MAS-1.0"
    assert set(S.FAMILIES) == set(JobFamily.__args__)
    assert set(S.DIMENSIONS) == {r.dimension for r in S.RULES.values()}


def test_job_families_require_different_structures():
    build, ops, data, reg, coord, creative = (S.requirements_for(f) for f in (
        "technical_build", "technical_operations", "data_analytical", "regulatory_compliance", "operational_coordination", "creative_content"))
    assert not build.needs_materials and build.min_verification_steps >= 3
    assert data.needs_data_dictionary and data.min_calculations_per_task >= 1
    assert reg.needs_sources and not reg.needs_table_material
    assert coord.needs_accepted_alternatives and coord.needs_decision_points
    assert creative.needs_not_scored_boundary
    assert ops.needs_decision_points
    # A job with two families carries both sets of requirements.
    both = S.requirements_for("technical_operations", ["regulatory_compliance"])
    assert both.needs_sources and both.needs_table_material
    # Effort follows the level within the family's range.
    assert S.effort_range("data_analytical", "junior")[1] < S.effort_range("data_analytical", "senior")[1]
    assert S.effort_range("data_analytical", "senior")[0] > S.effort_range("data_analytical", "junior")[0]


# --- the evaluator -----------------------------------------------------------------------------------------------------------

def test_a_complete_package_is_ready_and_every_dimension_has_evidence():
    r = report()
    assert r.verdict == "ready", [f.message for f in r.errors + r.warnings]
    assert r.standardized and r.overall_score >= S.READY_OVERALL
    assert set(r.dimensions) == set(S.DIMENSIONS)
    assert all(d.evidence for d in r.dimensions.values())
    assert r.checks_run == 2 and r.checks_skipped == 0


def test_the_rubric_must_total_100_with_levels_and_evidence():
    pkg = fixture.package()
    pkg["tasks"][0]["criteria"][0]["points"] = 30
    assert {"rubric_total_not_100"} <= codes(report(pkg=pkg)) and report(pkg=pkg).verdict == "blocked"

    pkg = fixture.package()
    del pkg["tasks"][0]["criteria"][1]["levels_en"]["2"]
    pkg["tasks"][0]["criteria"][1]["levels_ar"]["2"] = pkg["tasks"][0]["criteria"][1]["levels_ar"]["3"]
    assert "criterion_levels_incomplete" in codes(report(pkg=pkg))

    pkg = fixture.package()
    pkg["tasks"][1]["criteria"][0].update(evidence_en="", evidence_ar="")
    assert "criterion_without_evidence" in codes(report(pkg=pkg))

    pkg = fixture.package()
    pkg["assessor_guide"]["pass_mark"] = 60
    assert "pass_mark_set" in codes(report(pkg=pkg))


def test_a_levelled_criterion_scores_out_of_4_and_a_task_weighs_its_points():
    pkg = GeneratedAssessment.model_validate(fixture.package())
    pkg.tasks[0].criteria[0].max_score = 10  # not normalized: an employer's edit, say
    r = evaluate(JobInput.model_validate(fixture.job()), pkg)
    assert "level_scale_invalid" in codes(r)
    pkg = normalize(GeneratedAssessment.model_validate(fixture.package()))
    pkg.tasks[0].weight = 50
    assert "task_weight_mismatch" in codes(evaluate(JobInput.model_validate(fixture.job()), pkg))


def test_assessor_only_content_never_reaches_the_candidate():
    pkg = fixture.package()
    pkg["candidate_brief"]["scenario_en"] += " The short items hold 105 units in the system."
    assert "assessor_content_exposed" in codes(report(pkg=pkg))
    pkg = fixture.package()
    pkg["tasks"][1]["instructions_en"] += " Follow the answer key style."
    assert "assessor_content_exposed" in codes(report(pkg=pkg))
    pkg = fixture.package()
    pkg["candidate_brief"]["rules_ar"].append("اتبع الحل المرجعي.")
    assert "assessor_content_exposed" in codes(report(pkg=pkg))


def test_the_stored_candidate_side_holds_no_guide_content_and_the_round_trip_keeps_the_report():
    draft = normalize(GeneratedAssessment.model_validate(fixture.package()))
    stored = to_stored(draft)
    # What the candidate can read: the version's fields and each task's text and config (criteria stay on the rubric).
    candidate_side = json.dumps({"version": stored["version"],
                                 "tasks": [{k: v for k, v in t.items() if k != "criteria"} for t in stored["tasks"]]}, ensure_ascii=False)
    for secret in ("reference_solution", "expected_outputs", "common_mistakes", "levels_en", "levels_ar", "evidence_en", "calculations",
                   "Counting the over item as short", '"result"', "Total system quantity of short items", '"answer"', '"answer_key"'):
        assert secret not in candidate_side, secret
    # The answer key stays on the rubric criterion.
    assert stored["tasks"][2]["criteria"][0]["answer_key"] == {"q1": "a"}
    assert stored["guide"]["criteria_guidance"]["1:C1"]["levels_en"]["4"]
    direct = evaluate(JobInput.model_validate(fixture.job()), draft)
    again = evaluate(JobInput.model_validate(fixture.job()), from_stored(stored))
    assert (again.verdict, again.overall_score, codes(again)) == (direct.verdict, direct.overall_score, codes(direct))


def test_no_unsupported_legal_claims():
    pkg = fixture.package()
    pkg["candidate_brief"]["scenario_en"] += " Shortages must be reported under the PDPL."
    r = report(pkg=pkg)
    assert "regulatory_claim_unsourced" in codes(r) and r.verdict == "blocked"
    pkg["assessor_guide"]["sources"] = [{"title": "Personal Data Protection Law (PDPL)", "kind": "official", "verification": "unverified",
                                         "supports": "the reporting duty mentioned in the scenario"}]
    r = report(pkg=pkg)
    assert "regulatory_claim_unsourced" not in codes(r)
    assert "source_unverified" in codes(r)  # a warning: a specialist must check it before use
    pkg["assessor_guide"]["sources"][0]["verification"] = "verified"
    assert "source_invalid" in codes(report(pkg=pkg))  # verified needs its access date


def test_no_fabricated_source_data():
    pkg = fixture.package()
    pkg["materials"][0]["provenance"] = "public_dataset"
    assert "material_unsourced" in codes(report(pkg=pkg))
    pkg["materials"][0]["source"] = "A public retail dataset"
    assert "material_unsourced" in codes(report(pkg=pkg))  # still no licence
    pkg["materials"][0]["licence"] = "CC BY 4.0"
    assert "material_unsourced" not in codes(report(pkg=pkg))
    pkg = fixture.package()
    pkg["candidate_brief"]["company_context_en"] = "Al Waha Stores is a small or medium enterprise in retail with three branches."
    pkg["candidate_brief"]["company_context_ar"] = "متجر الواحة منشأة صغيرة أو متوسطة تعمل في تجارة التجزئة."
    assert "not_fictional" in codes(report(pkg=pkg))


def test_reference_answers_must_follow_from_the_materials():
    pkg = fixture.package()
    pkg["assessor_guide"]["calculations"][1]["check"]["expect"] = 110
    assert "reference_check_failed" in codes(report(pkg=pkg))
    pkg = fixture.package()
    pkg["assessor_guide"]["calculations"][0]["inputs"] = ["stock_count.reason_code"]
    assert "calculation_input_missing" in codes(report(pkg=pkg))
    pkg = fixture.package()
    pkg["assessor_guide"]["task_solutions"] = pkg["assessor_guide"]["task_solutions"][:1]
    assert "task_without_solution" in codes(report(pkg=pkg))


def test_recompute_is_a_closed_set_of_operations():
    rows = fixture.ROWS
    assert recompute({"op": "count_distinct", "column": "status"}, rows) == 3
    assert recompute({"op": "argmax_count", "column": "status"}, rows) == "short"
    assert recompute({"op": "max", "column": "system_qty", "where": {"status": {"in": ["ok", "over"]}}}, rows) == 40
    assert recompute({"op": "count", "where": {"counted_qty": {"gte": 20}}}, rows) == 3
    with pytest.raises(ValueError):
        recompute({"op": "__import__('os')"}, rows)


def test_arabic_and_english_are_both_required():
    pkg = fixture.package()
    pkg["candidate_brief"]["scenario_ar"] = pkg["candidate_brief"]["scenario_en"]
    pkg["tasks"][0]["title_en"] = "مطابقة"
    found = {(f.code, f.where, f.message.split(": ")[-1]) for f in report(pkg=pkg).errors}
    assert ("language_missing", "brief.scenario", "Arabic") in found
    assert ("language_missing", "task 1 title", "English") in found


def test_company_type_and_sector_must_shape_the_context():
    job = fixture.job()
    job["sector"] = "financial_services"
    r = report(job=job)
    assert any(f.code == "context_ignored" and "sector" in f.message for f in r.errors)
    job = fixture.job()
    job["company_type"] = "government_entity"
    assert any(f.code == "context_ignored" and "company type" in f.message for f in report(job=job).errors)
    job = fixture.job()
    job.pop("company_type"), job.pop("sector")
    assert "context_ignored" not in codes(report(job=job))


def test_every_task_maps_to_the_job_and_every_requirement_is_measured():
    pkg = fixture.package()
    pkg["tasks"][1]["requirement_ids"] = []
    pkg["tasks"][1]["skill_ids"] = []
    r = report(pkg=pkg)
    assert {"requirement_not_measured", "task_not_mapped"} <= codes(r)
    pkg = fixture.package()
    pkg["tasks"][0]["skill_ids"] = ["s9"]
    assert "unknown_id" in codes(report(pkg=pkg))


def test_personal_attributes_are_refused():
    pkg = fixture.package()
    pkg["tasks"][1]["instructions_en"] += " Also state your nationality."
    assert "personal_attribute" in codes(report(pkg=pkg))


def test_resembling_a_reference_earns_nothing():
    """The evaluator takes no reference input, and text written to sound like a reference package adds no score."""
    assert list(inspect.signature(evaluate).parameters) == ["job", "pkg", "rows"]
    assert "similarity" not in S.DIMENSIONS
    base = report()
    pkg = fixture.package()
    pkg["candidate_brief"]["scenario_en"] += (" This assessment follows the official reference package structure, with reference "
                                              "solution style, weighted rubric and assessor guide conventions.")
    padded = report(pkg=pkg)
    assert padded.overall_score <= base.overall_score
    assert "assessor_content_exposed" in codes(padded)


def test_a_draft_without_a_guide_is_not_standardized():
    pkg = {"tasks": fixture.package()["tasks"]}
    r = evaluate(JobInput.model_validate(fixture.job()), GeneratedAssessment.model_validate(pkg))
    assert not r.standardized and r.verdict == "blocked" and codes(r) == {"not_standardized"}


# --- generation: mock providers, the template fallback, a real provider -------------------------------------------------------

def _graph_payload(provider, job):
    graph = build_assessment_graph(InMemorySaver(), generator=make_generator(provider))
    graph.invoke({"job": job}, {"configurable": {"thread_id": "t"}})
    return [i.value for task in graph.get_state({"configurable": {"thread_id": "t"}}).tasks for i in task.interrupts][0]


def test_mock_provider_package_is_stored_apart_and_checked_with_the_jobs_context():
    sent = []

    def complete(system, user):
        sent.append(user)
        return json.dumps(fixture.package(), ensure_ascii=False)

    payload = _graph_payload(JsonLLMProvider(complete, "mock-model"), fixture.job())
    assert payload["provenance"]["mode"] == "live" and payload["provenance"]["model_version"] == "mock-model"
    assert payload["provenance"]["prompt_version"] == providers.GENERATION_PROMPT_VERSION
    # The model was told the company type, sector and level, and the standard; never a company name.
    job_block = json.loads(sent[0].split("<job>\n", 1)[1].split("\n</job>", 1)[0])
    assert (job_block["company_type"], job_block["sector"], job_block["experience_level"]) == ("sme", "wholesale_retail", "junior")
    assert job_block["standard"]["version"] == S.STANDARD_VERSION and "company_name" not in job_block
    assert payload["quality"]["verdict"] == "ready", payload["quality"]["required_revisions"]
    assert payload["guide"]["assessor_guide"]["task_solutions"] and payload["version"]["candidate_package"]["materials"]
    assert "assessor_guide" not in json.dumps(payload["version"]) and "reference_solution" not in json.dumps(payload["tasks"])
    assert [t["weight"] for t in payload["tasks"]] == [45, 35, 20]
    assert all(c["max_score"] == 4 for t in payload["tasks"][:2] for c in t["criteria"])


class _Response:
    def __init__(self, body):
        self.status_code, self._body = 200, body

    def json(self):
        return self._body


def test_mock_openai_and_gemini_wire_formats_get_the_same_validation(monkeypatch):
    text = json.dumps(fixture.package(), ensure_ascii=False)

    def post(url, **kwargs):
        if "generateContent" in url:
            return _Response({"candidates": [{"content": {"parts": [{"text": text}]}}]})
        return _Response({"choices": [{"message": {"content": text}}]})

    monkeypatch.setattr(providers, "_post", post)
    reports = {}
    for name, complete in (("openai", _openai("mock-openai", "k")), ("gemini", _gemini("mock-gemini", "k"))):
        reports[name] = _graph_payload(JsonLLMProvider(complete, f"mock-{name}"), fixture.job())["quality"]
    assert reports["openai"] == reports["gemini"]
    assert reports["openai"]["verdict"] == "ready"


def test_template_fallback_is_labelled_and_not_standardized():
    payload = _graph_payload(DemoProvider(), fixture.job())
    assert payload["provenance"]["mode"] == "demo"
    assert payload["version"] is None and payload["guide"] is None
    assert payload["quality"]["standardized"] is False and payload["quality"]["verdict"] == "blocked"


REAL = os.environ.get("MIDAN_REAL_PROVIDER_TESTS") == "1"


@pytest.mark.skipif(not REAL, reason="Real provider tests run only with MIDAN_REAL_PROVIDER_TESTS=1 and real keys (NOT RUN)")
@pytest.mark.parametrize("choice", ["groq", "openai", "gemini"])
def test_real_provider_generates_a_package_the_evaluator_can_judge(choice):
    env = {**os.environ, "AI_PROVIDER": choice}
    provider = get_provider(env)
    if provider.provenance.mode != "live":
        pytest.skip(f"No {choice} key and model configured (NOT RUN)")
    payload = _graph_payload(provider, fixture.job())
    assert payload["provenance"]["mode"] == "live"
    assert payload["provenance"]["provider"] == choice
    # A real model's draft is judged, not assumed good: the report must exist and say why if it isn't ready.
    assert payload["quality"]["verdict"] in ("ready", "needs_revision", "blocked")
    assert payload["quality"]["verdict"] == "ready" or payload["quality"]["required_revisions"]
