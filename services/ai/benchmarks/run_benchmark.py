"""Runs one benchmark package through MIDAN's generation pipeline and the quality evaluator.

The package is given to Graph A as a model's reply, through the same JsonLLMProvider every provider uses (a MOCK provider: no
model is called). Graph A normalizes it, maps it to what the database stores and checks it; the evaluator then checks the stored
form again with the rows of the attached files, so every reference figure is recomputed from the candidate's own data.

    python benchmarks/run_benchmark.py <package.json> <job.json> <materials dir> <out dir>

Writes <out dir>/quality_report.json (assessor-only: it quotes the guide's findings) and prints a summary. With --candidate-view
<path>, also writes what a candidate would receive (version fields and tasks, no rubric, no guide)."""

import argparse
import csv
import json
import os
import sys
import tempfile

os.environ.setdefault("AI_SERVICE_TOKEN", "benchmark")
os.environ.setdefault("CHECKPOINT_DB", os.path.join(tempfile.mkdtemp(), "c.sqlite"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

from midan_ai.assessment_builder import build_assessment_graph, make_generator  # noqa: E402
from midan_ai.package import from_stored  # noqa: E402
from midan_ai.providers import JsonLLMProvider  # noqa: E402
from midan_ai.quality import evaluate  # noqa: E402
from midan_ai.schemas import JobInput  # noqa: E402


def load_rows(package: dict, materials_dir: str) -> dict[str, list[dict]]:
    rows = {}
    for m in package.get("materials", []):
        if m.get("file", "").endswith(".csv") and m.get("kind") in ("table", "log"):
            with open(os.path.join(materials_dir, m["file"]), encoding="utf-8", newline="") as f:
                rows[m["id"]] = list(csv.DictReader(f))
    return rows


def candidate_view(payload: dict) -> dict:
    """Exactly what the API stores in candidate-readable places: the version's fields and each task's text and config."""
    return {"version": payload["version"],
            "tasks": [{k: t[k] for k in ("position", "task_type", "title_ar", "title_en", "instructions_ar", "instructions_en", "weight", "config")}
                      for t in payload["tasks"]]}


def run(package: dict, job: dict, materials_dir: str) -> tuple[dict, dict]:
    reply = json.dumps(package, ensure_ascii=False)
    provider = JsonLLMProvider(lambda system, user: reply, "mock-benchmark-provider")
    graph = build_assessment_graph(InMemorySaver(), generator=make_generator(provider))
    config = {"configurable": {"thread_id": "benchmark"}}
    graph.invoke({"job": job}, config)
    payload = [i.value for task in graph.get_state(config).tasks for i in task.interrupts][0]
    stored = {"version": payload["version"], "tasks": payload["tasks"], "guide": payload["guide"]}
    report = evaluate(JobInput.model_validate(job), from_stored(stored), load_rows(package, materials_dir))
    return payload, report.model_dump()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package")
    parser.add_argument("job")
    parser.add_argument("materials_dir")
    parser.add_argument("out_dir")
    parser.add_argument("--candidate-view")
    args = parser.parse_args()
    package = json.load(open(args.package, encoding="utf-8"))
    job = json.load(open(args.job, encoding="utf-8"))
    payload, report = run(package, job, args.materials_dir)
    os.makedirs(args.out_dir, exist_ok=True)
    json.dump(report, open(os.path.join(args.out_dir, "quality_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if args.candidate_view:
        json.dump(candidate_view(payload), open(args.candidate_view, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"provenance: {payload['provenance']['mode']} via {payload['provenance']['model_version']} (mock provider: no model was called)")
    print(f"graph check (inline rows only): {payload['quality']['verdict']} {payload['quality']['overall_score']}")
    print(f"full check: {report['verdict']} overall {report['overall_score']}; reference figures recomputed {report['checks_run']}, "
          f"not run {report['checks_skipped']}")
    for name, d in report["dimensions"].items():
        print(f"  {name:22s} {d['score']:3d}  errors {len(d['errors'])}  warnings {len(d['warnings'])}")
    for f in report["errors"] + report["warnings"]:
        print(f"  {f['severity']:7s} {f['code']}: {f['message']} [{f['where']}]")


if __name__ == "__main__":
    main()
