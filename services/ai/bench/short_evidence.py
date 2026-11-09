"""Short-evidence calibration for E5Local.brief_floor: labelled requirement x skill pairs (fictional), scored with MIDAN's e5.

Run from services/ai: PYTHONPATH=. uv run --extra matching python bench/short_evidence.py out.json (needs the local model)."""
import json, statistics, sys
sys.path.insert(0, "bench")
from embedding_bench import EVIDENCE, REQUIREMENTS
from midan_ai.matching import E5Local

SKILLS = {"s1": "Power BI", "s2": "SQL", "s3": "Python", "s4": "Excel", "s5": "تحليل البيانات", "s6": "إدارة المشاريع",
          "s7": "الأمن السيبراني", "s8": "SIEM", "s9": "التصميم الجرافيكي", "s10": "خدمة العملاء", "s11": "Machine learning",
          "s12": "تنظيم الفعاليات", "s13": "التسويق الرقمي", "s14": "المحاسبة", "s15": "مراجعة العقود", "s16": "إعداد الميزانيات",
          "s17": "نظام Excel التوظيف", "s18": "SAP SuccessFactors", "s19": "التوظيف", "s20": "تحليل بيانات الموارد البشرية",
          "s21": "Covenant monitoring", "s22": "Financial statement analysis", "s23": "Credit analysis", "s24": "Swift", "s25": "iOS development"}
SKILL_LABELS = {"r1": ["s1", "s4", "s5"], "r2": ["s2"], "r3": ["s3", "s11"], "r5": ["s6"], "r6": ["s7", "s8"], "r7": ["s7", "s8"],
                "r8": ["s9"], "r9": ["s10"], "r10": ["s11"], "r11": ["s12"], "r12": ["s13"], "r13": ["s14", "s22"], "r14": ["s15"],
                "r15": ["s4"], "r16": ["s16"]}
EXTRA = [  # today's real requirements, with what supports them
    ("x1", "برمجة تطبيقات الهاتف المحمول بلغة Swift", ["s24", "s25"]),
    ("x2", "Manage social media advertising campaigns and influencer partnerships", ["s13", "e14"]),
    ("x3", "إدارة عملية التوظيف كاملة من نشر الإعلان حتى تقديم العرض الوظيفي", ["s19", "s18"]),
    ("x4", "إعداد تقارير شهرية عن مؤشرات التوظيف", ["s20"]),
    ("x5", "Monitor covenant compliance and keep credit documentation up to date", ["s21"]),
    ("x6", "Analyse company financial statements and cash flows", ["s22", "s23", "e15"]),
    ("x7", "Prepare credit proposals for corporate lending facilities", ["s23"]),
]
reqs = [(r, t, EVIDENCE_L := l + SKILL_LABELS.get(r, [])) for r, t, l in REQUIREMENTS] + EXTRA
ev = {**EVIDENCE, **SKILLS}
ids = list(ev)
b = E5Local()
scores = b.scores([t for _, t, _ in reqs], [ev[i] for i in ids])
pairs = []
for (rid, rtext, good), row in zip(reqs, scores):
    for eid, s in zip(ids, row):
        pairs.append({"req": rid, "ev": eid, "short": eid.startswith("s"), "related": eid in good, "score": round(s, 4)})
def stats(sel):
    v = sorted(p["score"] for p in sel)
    return {"n": len(v), "p50": v[len(v) // 2], "p95": v[int(len(v) * 0.95) - 1], "max": v[-1]} if v else {}
out = {k: stats([p for p in pairs if p["short"] == short and p["related"] == rel])
       for k, (short, rel) in {"sentence_related": (False, True), "sentence_unrelated": (False, False),
                               "short_related": (True, True), "short_unrelated": (True, False)}.items()}
print(json.dumps(out, indent=1))
print("\nUnrelated short pairs at or above 0.80 (would be 'partial' or better today):")
for p in sorted((p for p in pairs if p["short"] and not p["related"] and p["score"] >= 0.80), key=lambda p: -p["score"])[:25]:
    print(f"  {p['score']:.3f}  {dict(reqs_t := {r: t for r, t, _ in reqs})[p['req']][:55]!r}  <-  {ev[p['ev']]!r}")
print("\nRelated short pairs (true skill matches):")
for p in sorted((p for p in pairs if p["short"] and p["related"]), key=lambda p: p["score"]):
    print(f"  {p['score']:.3f}  {reqs_t[p['req']][:55]!r}  <-  {ev[p['ev']]!r}")
json.dump(pairs, open(sys.argv[1], "w"), ensure_ascii=False)
