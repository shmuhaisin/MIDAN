"""The unseen-job benchmark: Cybersecurity Analyst at a fictional Saudi technology startup (docs/assessment/GENERATION_QUALITY_BENCHMARK.md).

The candidate-facing files are in the repository. The full package with its assessor guide is not (the repository is public): it
lives in the git-ignored .local/assessment-benchmarks/cybersecurity-analyst/. Tests that need it are skipped without it and say so.
Nothing here names an answer; the tests recompute from the data and compare with what the guide says.

`mock_` in a name: the package reaches Graph A through a stand-in provider, not a real model."""
import csv
import ipaddress
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CANDIDATE = os.path.join(ROOT, "docs", "assessment", "benchmarks", "cybersecurity-analyst", "candidate")
LOCAL = os.path.join(ROOT, ".local", "assessment-benchmarks", "cybersecurity-analyst")
HAS_GUIDE = os.path.exists(os.path.join(LOCAL, "package.json"))
needs_guide = pytest.mark.skipif(not HAS_GUIDE, reason="The assessor guide is kept out of the public repository; NOT RUN without .local/")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "benchmarks"))


def rows(name):
    with open(os.path.join(CANDIDATE, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def view():
    return json.load(open(os.path.join(CANDIDATE, "assessment.json"), encoding="utf-8"))


def test_the_candidate_view_holds_no_assessor_content():
    text = json.dumps(view(), ensure_ascii=False)
    for secret in ('"answer"', '"answer_key"', "reference_solution", "expected_outputs", "common_mistakes", "levels_en", "levels_ar",
                   "evidence_en", "calculations", "decision_points", "assessor_guide", "criteria"):
        assert secret not in text, secret
    v = view()
    assert v["version"]["candidate_package"]["standard_version"] == "MAS-1.0"
    assert all(t["config"].get("questions") is None or all("answer" not in q for q in t["config"]["questions"]) for t in v["tasks"])


def test_the_materials_match_their_declared_columns_and_are_fictional():
    materials = {m["id"]: m for m in view()["version"]["candidate_package"]["materials"]}
    for m in materials.values():
        assert m["provenance"] == "fictional"
        if m.get("file", "").endswith(".csv"):
            data = rows(m["file"])
            assert list(data[0]) == [c["name"] for c in m["columns"]], m["id"]
            assert len(data) == m["row_count"]
            assert all(c["unit"] and (c["meaning_en"] and c["meaning_ar"]) for c in m["columns"])
    # Every address is from a documentation range (RFC 5737) or a private network: nothing real is named.
    documentation = [ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")]
    for r in rows("auth_events.csv"):
        ip = ipaddress.ip_address(r["src_ip"])
        assert ip.is_private and (ip in ipaddress.ip_network("10.0.0.0/8") or any(ip in n for n in documentation)), r["src_ip"]
    assert "fictional" in view()["version"]["candidate_package"]["candidate_brief"]["company_context_en"]


def test_the_scenario_needs_a_narrow_detection_rule():
    """The data really poses the task 3 problem: a distinct-accounts rule catches two sources, one of them the approved scanner
    named in the asset inventory, and never the office or internal addresses."""
    failed = defaultdict(list)
    for r in rows("auth_events.csv"):
        if r["result"] == "failure":
            failed[r["src_ip"]].append((datetime.fromisoformat(r["timestamp"]), r["user"]))
    flagged = set()
    for ip, events in failed.items():
        events.sort()
        for start, _ in events:
            if len({u for t, u in events if start <= t <= start + timedelta(minutes=30)}) >= 10:
                flagged.add(ip)
    scanner = next(r for r in rows("asset_inventory.csv") if r["type"] == "scanner")
    assert len(flagged) == 2 and any(ip in scanner["notes"] for ip in flagged)
    assert not any(ipaddress.ip_address(ip) in ipaddress.ip_network("10.0.0.0/8") or ip.endswith(".10") for ip in flagged)


@needs_guide
def test_mock_the_benchmark_goes_through_graph_a_and_is_ready_with_every_figure_recomputed():
    from run_benchmark import candidate_view, run

    package = json.load(open(os.path.join(LOCAL, "package.json"), encoding="utf-8"))
    job = json.load(open(os.path.join(LOCAL, "job.json"), encoding="utf-8"))
    payload, report = run(package, job, CANDIDATE)
    assert payload["provenance"]["mode"] == "live" and payload["provenance"]["model_version"] == "mock-benchmark-provider"
    assert report["verdict"] == "ready", report["required_revisions"]
    assert report["checks_run"] == len(package["assessor_guide"]["calculations"]) and report["checks_skipped"] == 0
    assert not report["errors"]
    assert {w["code"] for w in report["warnings"]} <= {"source_unverified"}
    # The committed candidate view is exactly what the pipeline makes candidate-readable.
    assert candidate_view(payload) == view()
    # The rubric: 100 points, levels 0-4 in both languages, evidence for every criterion.
    points = sum(c["points"] for t in package["tasks"] for c in t.get("criteria", [])) + sum(t["weight"] for t in package["tasks"] if t["task_type"] == "objective_questions")
    assert points == 100
    assert all(set(c["levels_en"]) == set(c["levels_ar"]) == set("01234") and c["evidence_en"] and c["evidence_ar"]
               for t in package["tasks"] for c in t.get("criteria", []))
    # The job's context reached the brief: a startup in the digital sector, mid level.
    assert (job["company_type"], job["sector"], job["experience_level"]) == ("startup", "digital", "mid")


@needs_guide
def test_the_guide_never_appears_in_the_repository_files():
    package = json.load(open(os.path.join(LOCAL, "package.json"), encoding="utf-8"))
    solutions = [s["reference_solution"] for s in package["assessor_guide"]["task_solutions"]]
    for name in os.listdir(CANDIDATE):
        text = open(os.path.join(CANDIDATE, name), encoding="utf-8").read()
        for solution in solutions:
            assert solution[:60] not in text, name
