"""Cross-encoder rerankers against MIDAN's E5 matching, on the same fictional labelled set (embedding_bench + short_evidence).

For each model, every requirement x evidence pair is scored. Reported per model:
  relevance   top-1 evidence and MRR over sentence evidence; AUC between related and unrelated pairs (all, sentences only,
              short skill names only, and cross-language pairs only);
  errors      at the threshold that maximises F1 on this set, the false positives and false negatives (and the threshold);
  cost        cold load, one request (1 requirement x 8 lines) warm, process memory after loading.
The set is small (23 requirements x 41 lines) and fictional: it ranks models, it does not calibrate production thresholds.

    HF_HOME=... HF_HUB_OFFLINE=1 python bench/reranker_bench.py bench/reranker_results.json
Models must already be in HF_HOME (nothing is downloaded here).
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _data(name: str, stop: str) -> dict:
    """The labelled data of a sibling bench script, without running it: its source up to `stop`, imports removed."""
    src = open(os.path.join(HERE, name), encoding="utf-8").read().split(stop, 1)[0]
    src = chr(10).join(line for line in src.splitlines() if not line.startswith(("import ", "from ", "sys.path")))
    scope: dict = {}
    exec(compile(src, name, "exec"), scope)  # noqa: S102 - our own repository's data
    return scope


_e = _data("embedding_bench.py", "AR_DIACRITICS =")
_s = _data("short_evidence.py", "reqs = ")
EVIDENCE, REQUIREMENTS = _e["EVIDENCE"], _e["REQUIREMENTS"]
SKILLS, SKILL_LABELS, EXTRA = _s["SKILLS"], _s["SKILL_LABELS"], _s["EXTRA"]

MODELS = {
    "e5": "intfloat/multilingual-e5-base",
    "mminilm": "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    "bge-reranker-v2-m3": "BAAI/bge-reranker-v2-m3",
}
LICENSES = {"e5": "MIT", "mminilm": "Apache-2.0", "bge-reranker-v2-m3": "Apache-2.0"}
ARABIC = re.compile(r"[؀-ۿ]")


def rss_mb() -> float | None:
    """Resident memory of this process (Windows: GetProcessMemoryInfo; elsewhere /proc or resource)."""
    try:
        if os.name == "nt":
            class PMC(ctypes.Structure):
                _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t),
                            ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PMC(); pmc.cb = ctypes.sizeof(PMC)
            ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
            return round(pmc.WorkingSetSize / 2**20)
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
    except Exception:  # noqa: BLE001
        return None


def dataset():
    reqs = [(r, t, set(good) | set(SKILL_LABELS.get(r, []))) for r, t, good in REQUIREMENTS] + [(r, t, set(g)) for r, t, g in EXTRA]
    ev = {**EVIDENCE, **SKILLS}
    return reqs, ev


def auc(pos: list[float], neg: list[float]) -> float | None:
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return round(wins / (len(pos) * len(neg)), 3)


def best_f1(pairs):
    best = None
    for t in sorted({p["score"] for p in pairs}):
        tp = sum(p["related"] and p["score"] >= t for p in pairs)
        fp = sum(not p["related"] and p["score"] >= t for p in pairs)
        fn = sum(p["related"] and p["score"] < t for p in pairs)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0
        if best is None or f1 > best["f1"]:
            best = {"threshold": round(t, 4), "f1": round(f1, 3), "true_positives": tp, "false_positives": fp, "false_negatives": fn}
    return best


def scorer(key: str):
    if key == "e5":
        from midan_ai.matching import E5Local
        model = E5Local()
        model._load()
        return lambda rq, evs: model.scores([rq], evs)[0]
    from sentence_transformers import CrossEncoder
    model = CrossEncoder(MODELS[key], device="cpu", max_length=256)
    def run(rq: str, evs: list[str]) -> list[float]:
        # Single-label rerankers: CrossEncoder already applies the sigmoid, so this is a 0-1 relevance.
        return [float(x) for x in model.predict([(rq, e) for e in evs], batch_size=32, show_progress_bar=False)]
    return run


def measure(key: str):
    reqs, ev = dataset()
    ids = list(ev)
    before = rss_mb()
    t0 = time.perf_counter()
    score = scorer(key)
    score("warm up", ["warm up"])
    load = time.perf_counter() - t0
    after = rss_mb()
    t1 = time.perf_counter()
    pairs = []
    for rid, rtext, good in reqs:
        for eid, s in zip(ids, score(rtext, [ev[i] for i in ids])):
            pairs.append({"req": rid, "ev": eid, "short": eid.startswith("s"), "related": eid in good, "score": round(float(s), 4),
                          "cross_language": bool(ARABIC.search(rtext)) != bool(ARABIC.search(ev[eid]))})
    total = time.perf_counter() - t1
    t2 = time.perf_counter()
    score(reqs[0][1], [ev[i] for i in ids[:8]])
    one = time.perf_counter() - t2
    # Ranking quality over sentence evidence (the lines a CV gives), for requirements that have a sentence answer.
    top1 = rr = n = 0
    for rid, _, good in reqs:
        sent = sorted((p for p in pairs if p["req"] == rid and not p["short"]), key=lambda p: -p["score"])
        good_sent = [g for g in good if not g.startswith("s")]
        if not good_sent:
            continue
        n += 1
        top1 += sent[0]["ev"] in good
        rank = next(i for i, p in enumerate(sent, 1) if p["ev"] in good)
        rr += 1 / rank
    sel = lambda f: (lambda ps: auc([p["score"] for p in ps if p["related"]], [p["score"] for p in ps if not p["related"]]))([p for p in pairs if f(p)])  # noqa: E731
    pos = [p["score"] for p in pairs if p["related"]]
    neg = [p["score"] for p in pairs if not p["related"]]
    return {
        "model": MODELS[key], "license": LICENSES[key],
        "top1": round(top1 / n, 3), "mrr": round(rr / n, 3),
        "auc_all": sel(lambda p: True), "auc_sentences": sel(lambda p: not p["short"]), "auc_short": sel(lambda p: p["short"]),
        "auc_cross_language": sel(lambda p: p["cross_language"]),
        "mean_related": round(sum(pos) / len(pos), 3), "mean_unrelated": round(sum(neg) / len(neg), 3),
        "max_unrelated": round(max(neg), 3), "best_f1": best_f1(pairs),
        "cold_load_s": round(load, 2), "all_pairs_s": round(total, 2), "one_request_s": round(one, 3),
        "memory_mb_after_load": after, "memory_mb_added": (after - before) if after and before else None,
        "pairs": len(pairs),
        **({"pair_scores": pairs} if os.environ.get("SAVE_PAIRS") else {}),
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "reranker_results.json")
    keys = sys.argv[2:] or list(MODELS)
    results = {}
    for k in keys:
        results[k] = measure(k)
        print(k, json.dumps({x: results[k][x] for x in ("top1", "mrr", "auc_all", "auc_sentences", "auc_short", "auc_cross_language", "best_f1", "cold_load_s", "one_request_s", "memory_mb_added")}))
    json.dump(results, open(out, "w", encoding="utf-8"), indent=2)
