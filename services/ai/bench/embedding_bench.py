"""Compare embedding models for MIDAN's requirement-to-evidence matching, on a fictional labelled set.

Measures, per model: relevance (top-1 accuracy, mean reciprocal rank, and separation between matching and unrelated
pairs), latency (load, and encoding the whole set), peak memory (RSS) and CPU time. A lexical baseline (token overlap,
which is how matching works today) runs on the same set.

    python bench/embedding_bench.py                  # local intfloat/multilingual-e5-base and the lexical baseline
    HF_TOKEN=... python bench/embedding_bench.py     # also BAAI/bge-m3 through Hugging Face hosted inference

It never downloads BGE-M3: with no token, BGE-M3 is reported as not measured. Writes bench/results.json.
"""

from __future__ import annotations

import json
import os
import re
import resource
import sys
import time
from pathlib import Path

import httpx

# Each requirement lists the evidence lines that support it (by id). Evidence ids not listed are unrelated to it.
# Mixed on purpose: Arabic requirement with English evidence, paraphrases with no shared words, near misses.
EVIDENCE = {
    "e1": "Built weekly sales dashboards in Power BI for the regional retail team",
    "e2": "أعددت تقارير شهرية عن المبيعات باستخدام إكسل والجداول المحورية",
    "e3": "Wrote SQL queries to join orders and returns tables and find the cause of a drop in revenue",
    "e4": "حللت بيانات العملاء بلغة بايثون ومكتبة pandas لتقسيم الشرائح",
    "e5": "Presented findings to management in Arabic and English",
    "e6": "قدت فريقًا من خمسة أشخاص لتسليم مشروع تحول رقمي في الموعد",
    "e7": "Monitored security alerts in a SIEM and wrote incident reports",
    "e8": "صممت هويات بصرية وشعارات لعلامات تجارية محلية",
    "e9": "Managed a project budget of 2 million riyals and tracked spending against plan",
    "e10": "تواصلت مع العملاء لحل الشكاوى عبر الهاتف والبريد",
    "e11": "Configured firewalls and reviewed network logs for intrusions",
    "e12": "دربت نموذج تعلم آلي لتوقع الطلب على المنتجات",
    "e13": "Organized a conference for 400 attendees, including vendors and schedules",
    "e14": "كتبت محتوى تسويقيًا لحملات وسائل التواصل الاجتماعي",
    "e15": "Prepared financial statements and reconciled bank accounts monthly",
    "e16": "راجعت العقود مع الموردين وتأكدت من مطابقتها للأنظمة",
}
REQUIREMENTS = [
    ("r1", "تحليل البيانات وإعداد لوحات معلومات تفاعلية", ["e1", "e2"]),
    ("r2", "Querying relational databases to investigate business questions", ["e3"]),
    ("r3", "البرمجة بلغة Python لتحليل البيانات", ["e4", "e12"]),
    ("r4", "Communicating results clearly to stakeholders", ["e5"]),
    ("r5", "قيادة الفرق وإدارة المشاريع", ["e6", "e9"]),
    ("r6", "Incident detection and response in a security operations center", ["e7", "e11"]),
    ("r7", "الأمن السيبراني ومراقبة الشبكات", ["e11", "e7"]),
    ("r8", "Graphic design and brand identity", ["e8"]),
    ("r9", "خدمة العملاء ومعالجة الشكاوى", ["e10"]),
    ("r10", "Machine learning for demand forecasting", ["e12"]),
    ("r11", "تنظيم الفعاليات والمؤتمرات", ["e13"]),
    ("r12", "Content writing for social media marketing", ["e14"]),
    ("r13", "المحاسبة وإعداد القوائم المالية", ["e15"]),
    ("r14", "Contract review and regulatory compliance", ["e16"]),
    ("r15", "Excel reporting with pivot tables", ["e2"]),
    ("r16", "إدارة الميزانيات ومتابعة الصرف", ["e9"]),
]

AR_DIACRITICS = re.compile(r"[ً-ْـ]")


STOP = {"and", "the", "for", "with", "from", "into", "that", "this", "using", "في", "من", "على", "الى", "إلى", "عن", "مع", "او", "أو", "ثم"}


def normalize(text: str) -> set[str]:
    """The same tokens as midan_ai.matching.tokens, so the lexical thresholds carry over."""
    t = AR_DIACRITICS.sub("", text.lower())
    t = re.sub("[أإآ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    words = {w for w in re.findall(r"\w+", t) if len(w) > 2 and w not in STOP}
    return {w[2:] if w.startswith("ال") and len(w) > 4 else w for w in words}


def cosine(a, b) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1.0)


def evaluate(scores: dict[tuple[str, str], float]) -> dict:
    """Top-1 accuracy, MRR and the gap between the mean matching and mean unrelated score."""
    top1 = mrr = 0.0
    pos, neg = [], []
    for rid, _, gold in REQUIREMENTS:
        ranked = sorted(EVIDENCE, key=lambda e: scores[(rid, e)], reverse=True)
        top1 += ranked[0] in gold
        mrr += 1 / (1 + min(ranked.index(g) for g in gold))
        for e in EVIDENCE:
            (pos if e in gold else neg).append(scores[(rid, e)])
    # Separation: the share of (matching, unrelated) pairs where the matching pair scores higher (an AUC).
    auc = sum(p > n for p in pos for n in neg) / (len(pos) * len(neg))
    n = len(REQUIREMENTS)
    q = lambda xs, f: round(sorted(xs)[min(len(xs) - 1, int(f * len(xs)))], 3)  # noqa: E731
    return {"top1": round(top1 / n, 3), "mrr": round(mrr / n, 3), "auc": round(auc, 3),
            "mean_match": round(sum(pos) / len(pos), 3), "mean_unrelated": round(sum(neg) / len(neg), 3),
            # For choosing thresholds: where most matching pairs sit, and where the unrelated pairs top out.
            "match_p25": q(pos, 0.25), "match_p50": q(pos, 0.5), "unrelated_p95": q(neg, 0.95), "unrelated_max": round(max(neg), 3)}


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024, 1)


def cpu_seconds() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


def lexical() -> dict:
    t0 = time.perf_counter()
    scores = {}
    for rid, req, _ in REQUIREMENTS:
        rq = set(normalize(req))
        for eid, ev in EVIDENCE.items():
            ew = set(normalize(ev))
            scores[(rid, eid)] = len(rq & ew) / (len(rq) or 1)
    return {"model": "lexical baseline (token coverage, as matching.Lexical)", "where": "in process", **evaluate(scores),
            "encode_seconds": round(time.perf_counter() - t0, 4)}


def e5_local(name: str = "intfloat/multilingual-e5-base") -> dict:
    cpu0, t0 = cpu_seconds(), time.perf_counter()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(name, device="cpu")
    load = time.perf_counter() - t0
    # E5 expects "query: " for what's searched for and "passage: " for what's searched.
    t1 = time.perf_counter()
    req_vec = model.encode([f"query: {r}" for _, r, _ in REQUIREMENTS], normalize_embeddings=True)
    ev_ids = list(EVIDENCE)
    ev_vec = model.encode([f"passage: {EVIDENCE[e]}" for e in ev_ids], normalize_embeddings=True)
    encode = time.perf_counter() - t1
    # One requirement against one CV's evidence, as the API would ask it: the per-request latency.
    t2 = time.perf_counter()
    model.encode(["query: " + REQUIREMENTS[0][1]] + [f"passage: {EVIDENCE[e]}" for e in ev_ids[:8]], normalize_embeddings=True)
    single = time.perf_counter() - t2
    scores = {(rid, e): float(req_vec[i] @ ev_vec[j]) for i, (rid, _, _) in enumerate(REQUIREMENTS) for j, e in enumerate(ev_ids)}
    return {"model": name, "where": "local CPU", **evaluate(scores), "load_seconds": round(load, 2), "encode_seconds": round(encode, 3),
            "one_request_seconds": round(single, 3), "texts_encoded": len(REQUIREMENTS) + len(EVIDENCE),
            "peak_rss_mb": peak_rss_mb(), "cpu_seconds": round(cpu_seconds() - cpu0, 2), "dimensions": int(req_vec.shape[1])}


def bge_m3_hosted(token: str) -> dict:
    """BAAI/bge-m3 through Hugging Face's hosted sentence-similarity endpoint: one call per requirement."""
    url = "https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/sentence-similarity"
    ev_ids = list(EVIDENCE)
    scores, latencies = {}, []
    for rid, req, _ in REQUIREMENTS:
        t0 = time.perf_counter()
        res = httpx.post(url, headers={"authorization": f"Bearer {token}"}, json={"inputs": {"source_sentence": req, "sentences": [EVIDENCE[e] for e in ev_ids]}}, timeout=60)
        latencies.append(time.perf_counter() - t0)
        if res.status_code != 200:
            return {"model": "BAAI/bge-m3", "where": "Hugging Face hosted inference", "error": f"HTTP {res.status_code}: {res.text[:160]}"}
        for e, s in zip(ev_ids, res.json()):
            scores[(rid, e)] = float(s)
    latencies.sort()
    return {"model": "BAAI/bge-m3", "where": "Hugging Face hosted inference", **evaluate(scores),
            "one_request_seconds_median": round(latencies[len(latencies) // 2], 3), "one_request_seconds_max": round(latencies[-1], 3)}


def main() -> None:
    results = [lexical()]
    try:
        results.append(e5_local())
    except Exception as error:  # noqa: BLE001 - reported, not hidden
        results.append({"model": "intfloat/multilingual-e5-base", "where": "local CPU", "error": f"{type(error).__name__}: {error}"[:300]})
    token = os.environ.get("HF_TOKEN", "").strip()
    results.append(bge_m3_hosted(token) if token else {"model": "BAAI/bge-m3", "where": "Hugging Face hosted inference",
                                                        "error": "not measured: HF_TOKEN is not set (the hosted endpoint answers 401 without one)"})
    out = Path(__file__).with_name("results.json")
    out.write_text(json.dumps({"set": {"requirements": len(REQUIREMENTS), "evidence": len(EVIDENCE)}, "results": results}, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
