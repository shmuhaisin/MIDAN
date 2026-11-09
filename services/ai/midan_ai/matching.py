"""Evidence-based requirement matching: does an applicant's submitted profile show each of a job's requirements?

A proposal, never a decision. For each requirement it returns one of
  matched       the profile has evidence that clearly states it;
  partial       related evidence, but not clearly the same thing;
  missing       nothing in the profile relates to it (which is not proof the applicant lacks it);
  needs_review  MIDAN can't tell: a minimum of years with no dates to check it, or a requirement too short to compare;
with the evidence line it used, the similarity score and a plain explanation. People review and confirm or correct each
one (application_match_reviews), and nothing here changes an application's status.

No language model is called: requirements and evidence are compared by similarity only, so text inside a CV can't
instruct anything. The similarity backend is chosen by EMBEDDING_PROVIDER and recorded in the provenance:
  lexical        token overlap with Arabic normalization (always available, the fallback);
  e5-local       intfloat/multilingual-e5-base on this machine (needs sentence-transformers and the model files);
  bge-m3-hosted  BAAI/bge-m3 on Hugging Face hosted inference (needs HF_TOKEN; never downloaded here).
Thresholds per backend come from services/ai/bench (fictional labelled set); see docs/ai/ATS_MATCHING.md.
"""

from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, Field

Status = Literal["matched", "partial", "missing", "needs_review"]

AR_DIACRITICS = re.compile(r"[ً-ْـ]")
STOP = {"and", "the", "for", "with", "from", "into", "that", "this", "using", "في", "من", "على", "الى", "إلى", "عن", "مع", "او", "أو", "ثم"}


def tokens(text: str) -> set[str]:
    t = AR_DIACRITICS.sub("", text.lower())
    t = re.sub("[أإآ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    words = {w for w in re.findall(r"\w+", t) if len(w) > 2 and w not in STOP}
    # Arabic definite article: "البيانات" and "بيانات" are the same word for matching.
    return {w[2:] if w.startswith("ال") and len(w) > 4 else w for w in words}


# A capability stated in the negative ("no experience in Python", "ليس لدي خبرة في بايثون"). Narrow on purpose: it needs a
# negation followed shortly by a capability word, so "built dashboards without help" isn't read as a negation.
_NEG_EN = re.compile(r"\b(?:no|not|never|without|lack(?:s|ing)?|haven't|hasn't|didn't|don't|doesn't)\b\W+(?:\w+\W+){0,3}?"
                     r"(?:experience[ds]?|knowledge|familiar(?:ity)?|background|exposure|skills?|used|worked|work|proficien\w*|training)\b", re.I)
_NEG_AR = re.compile(r"(?:^|\s)(?:لا|ليس|ليست|لست|لم|لن|بدون|دون|عدم|بلا)\s+(?:\S+\s+){0,3}?"
                     r"(?:خبرة|الخبرة|خبرات|معرفة|المعرفة|خلفية|اطلاع|إلمام|الماما|أستخدم|استخدم|استخدمت|أعمل|اعمل|عملت|لدي|عندي|أجيد|اجيد|أعرف|اعرف|تدريب)")


def _brief(evidence: "EvidenceIn") -> bool:
    """A headline, or a line with fewer than four meaningful words: never enough on its own for "matched"."""
    return evidence.source == "headline" or len(tokens(evidence.text)) < 4


def negated(text: str) -> bool:
    """Whether the line states a capability in the negative. Such a line is never evidence for the requirement."""
    return bool(_NEG_EN.search(text) or _NEG_AR.search(text))


class Similarity(Protocol):
    name: str
    model_version: str
    thresholds: tuple[float, float]  # (partial, matched)
    review_floor: float | None  # scores in [review_floor, partial) go to a person instead of "missing"

    def scores(self, requirements: list[str], evidence: list[str]) -> list[list[float]]: ...


class Lexical:
    name = "lexical"
    model_version = "token-overlap-v1"
    # Coverage of the requirement's words: "matched" needs at least half of them, so one shared word ("sales") never
    # makes a match; "partial" needs a fifth.
    thresholds = (0.2, 0.5)
    review_floor = None

    def scores(self, requirements: list[str], evidence: list[str]) -> list[list[float]]:
        ev = [tokens(e) for e in evidence]
        out = []
        for r in requirements:
            rt = tokens(r)
            # Coverage: the share of the requirement's words the evidence contains. A long evidence line isn't penalized.
            out.append([len(rt & e) / (len(rt) or 1) for e in ev])
        return out


class E5Local:
    """intfloat/multilingual-e5-base, loaded once per process, on CPU."""

    name = "e5-local"
    model_version = "intfloat/multilingual-e5-base"
    # From services/ai/bench (results.json): unrelated pairs reach 0.823 at most, so "matched" starts above that; the
    # band between the 95th percentile of unrelated pairs (0.802) and 0.83 is "partial", which people review anyway.
    thresholds = (0.80, 0.83)
    # It ranks well but its scores are compressed (unrelated pairs average 0.767): between that and "partial", MIDAN
    # can't tell, so a person decides instead of a guessed "missing" (docs/ai/ATS_MATCHING.md).
    review_floor = 0.77
    _model = None
    _lock = threading.Lock()

    def _load(self):
        with self._lock:
            if E5Local._model is None:
                from sentence_transformers import SentenceTransformer  # optional dependency
                E5Local._model = SentenceTransformer(self.model_version, device="cpu")
        return E5Local._model

    _cache: dict[str, object] = {}
    CACHE_SIZE = 20_000

    def _encode(self, texts: list[str]):
        """Encodes with E5's prefixes ("query: " for requirements, "passage: " for evidence), reusing cached vectors."""
        import numpy as np
        missing = [t for t in dict.fromkeys(texts) if t not in self._cache]
        if missing:
            vectors = self._load().encode(missing, normalize_embeddings=True)
            if len(self._cache) + len(missing) > self.CACHE_SIZE:
                self._cache.clear()  # simple and bounded: the cache only saves time, never changes a result
            self._cache.update(zip(missing, vectors))
        return np.stack([self._cache[t] for t in texts])

    def scores(self, requirements: list[str], evidence: list[str]) -> list[list[float]]:
        rq = self._encode([f"query: {r}" for r in requirements])
        ev = self._encode([f"passage: {e}" for e in evidence])
        return (rq @ ev.T).tolist()


class BgeM3Hosted:
    """BAAI/bge-m3 through Hugging Face hosted inference, one call per requirement."""

    name = "bge-m3-hosted"
    model_version = "BAAI/bge-m3"
    thresholds = (0.55, 0.65)
    review_floor = None  # not calibrated until it can be measured (needs HF_TOKEN)
    URL = "https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/sentence-similarity"

    TIMEOUT = 15.0
    RETRIES = 2

    def __init__(self, token: str, sleep=None):
        self._token = token
        import time
        self._sleep = sleep or time.sleep

    def _post(self, payload: dict) -> list[float]:
        """One similarity call: a 15 s timeout, and at most two retries on 429 or 5xx, honouring a short retry-after."""
        for attempt in range(self.RETRIES + 1):
            try:
                res = httpx.post(self.URL, headers={"authorization": f"Bearer {self._token}"}, json=payload, timeout=self.TIMEOUT)
            except httpx.HTTPError as error:
                if attempt == self.RETRIES:
                    raise RuntimeError(f"Hugging Face unreachable: {type(error).__name__}") from None
                self._sleep(2 ** attempt)
                continue
            if res.status_code == 200:
                return [float(s) for s in res.json()]
            if res.status_code in (429, 500, 502, 503, 504) and attempt < self.RETRIES:
                wait = res.headers.get("retry-after")
                self._sleep(min(10.0, float(wait)) if wait and wait.replace(".", "", 1).isdigit() else 2 ** attempt)
                continue
            raise RuntimeError(f"Hugging Face responded {res.status_code}")
        raise RuntimeError("Hugging Face: no answer")

    def scores(self, requirements: list[str], evidence: list[str]) -> list[list[float]]:
        from .privacy import redact
        # Only what's needed leaves MIDAN: personal details are replaced before any text goes to the provider.
        safe = [redact(e) for e in evidence]
        return [self._post({"inputs": {"source_sentence": redact(r), "sentences": safe}}) for r in requirements]


def similarity_backend(env: dict | None = None) -> Similarity:
    """The configured backend, or the lexical fallback when the configured one isn't available."""
    env = env if env is not None else os.environ
    choice = (env.get("EMBEDDING_PROVIDER") or "lexical").strip()
    if choice == "e5-local":
        try:
            import sentence_transformers  # noqa: F401
            return E5Local()
        except ImportError:
            return Lexical()
    if choice == "bge-m3-hosted" and env.get("HF_TOKEN"):
        return BgeM3Hosted(env["HF_TOKEN"])
    return Lexical()


class RequirementIn(BaseModel):
    key: str = Field(max_length=80)
    text: str = Field(max_length=2000)
    mandatory: bool = True
    min_years: float | None = None
    skill_id: str | None = None


class EvidenceIn(BaseModel):
    id: str = Field(max_length=80)
    text: str = Field(max_length=2000)
    source: str = Field(max_length=40)  # experience, education, project, certification, skill, summary, headline
    skill_id: str | None = None
    years: float | None = None


class MatchRequest(BaseModel):
    requirements: list[RequirementIn] = Field(max_length=80)
    evidence: list[EvidenceIn] = Field(max_length=300)


class RequirementMatch(BaseModel):
    key: str
    status: Status
    score: float
    evidence_id: str | None
    evidence_text: str | None
    evidence_source: str | None
    # A line that states the opposite ("no experience in …"), shown beside the evidence when they conflict.
    counter_evidence_text: str | None = None
    reason: str
    # For the interface to explain it in the reader's language: matched, partial, missing, listed_skill, too_short,
    # years_undated or years_short, with reason_params (min_years, years).
    reason_code: str
    reason_params: dict = {}


class MatchResult(BaseModel):
    matches: list[RequirementMatch]
    summary: dict
    provenance: dict


@dataclass
class _Pick:
    score: float
    index: int | None


def _explain(status: Status, source: str | None, why: str = "") -> str:
    if why:
        return why
    return {
        "matched": f"The {source} line states this requirement.",
        "partial": f"The {source} line is related, but doesn't clearly state this requirement.",
        "missing": "Nothing in the submitted profile relates to this requirement. That isn't proof the applicant lacks it.",
        "needs_review": "MIDAN can't tell from the submitted profile.",
    }[status]


def match(request: MatchRequest, backend: Similarity | None = None) -> MatchResult:
    backend = backend or similarity_backend()
    fallback = None
    reqs, evs = request.requirements, request.evidence
    scored = [[0.0] * len(evs) for _ in reqs]
    if reqs and evs:
        try:
            scored = backend.scores([r.text for r in reqs], [e.text for e in evs])
        except Exception as error:  # noqa: BLE001 - a backend failure falls back, and says so
            fallback = f"{backend.name} failed ({type(error).__name__}); lexical similarity used instead"
            backend = Lexical()
            scored = backend.scores([r.text for r in reqs], [e.text for e in evs])
    low, high = backend.thresholds
    out: list[RequirementMatch] = []
    neg = [negated(x.text) for x in evs]
    related_floor = backend.review_floor if getattr(backend, "review_floor", None) is not None else low
    for i, r in enumerate(reqs):
        # Structured evidence first: a released assessment of the exact skill (the strongest), then the skill as listed.
        assessed = next((k for k, x in enumerate(evs) if r.skill_id and x.skill_id == r.skill_id and x.source == "assessed_skill"), None)
        listed = next((k for k, x in enumerate(evs) if r.skill_id and x.skill_id == r.skill_id and x.source != "assessed_skill"), None)
        best = lambda keep: max((_Pick(sc, k) for k, sc in enumerate(scored[i]) if keep(k)), key=lambda p: p.score, default=_Pick(0.0, None))  # noqa: E731
        positive = best(lambda k: not neg[k])  # a negated line is never support
        against = best(lambda k: neg[k])
        pick = _Pick(1.0, assessed) if assessed is not None else _Pick(1.0, listed) if listed is not None else positive
        e = evs[pick.index] if pick.index is not None else None
        why = ""
        code: str | None = None
        params: dict = {}
        counter: str | None = None
        if len(tokens(r.text)) == 0:
            status: Status = "needs_review"
            why, code = "The requirement is too short to compare with the profile.", "too_short"
        elif assessed is None and listed is None and e is not None and pick.score >= high and _brief(e):
            # A headline or a few words ("Sales coordinator") is a claim, not a description of the work: similarity to it
            # can show relevance, never a match. Measured on live data: a two-word headline scored 0.85.
            status = "partial"
            why, code = "Only a title or a few words relate to it, which isn't a description of the work.", "brief_evidence"
        elif assessed is not None:
            status = "matched"
            why, code = "A released assessment result shows this skill.", "assessed_skill"
        elif listed is not None:
            status = "matched"
            why, code = "The applicant listed this skill in the submitted profile.", "listed_skill"
        elif pick.score >= high:
            status = "matched"
        elif pick.score >= low:
            status = "partial"
        elif getattr(backend, "review_floor", None) is not None and pick.score >= backend.review_floor:
            status = "needs_review"
            why, code = "The comparison is uncertain: a person should check the line shown.", "uncertain"
        else:
            status = "missing"
        # A related line that states the opposite: a conflict goes to a person; on its own it explains the "not found".
        if against.index is not None and against.score >= related_floor and assessed is None and code != "too_short":
            if status in ("matched", "partial") or (status == "needs_review" and code == "uncertain"):
                status, code = "needs_review", "contradictory"
                why = "The profile both supports and contradicts this requirement: a person should check both lines."
                counter = evs[against.index].text
            else:
                status, code = "missing", "negated"
                why = "The profile states the opposite of this requirement."
                pick, e = against, evs[against.index]
        if r.min_years and status in ("matched", "partial"):
            years = sum(x.years or 0 for x in evs if x.source == "experience")
            if not any(x.years for x in evs if x.source == "experience"):
                status, why, code = "needs_review", f"Asks for {r.min_years:g} years; the submitted experience has no dates to check it.", "years_undated"
                params = {"min_years": r.min_years}
            elif years < r.min_years:
                status, why, code = "partial", f"Related experience found, about {years:g} of the {r.min_years:g} years asked for.", "years_short"
                params = {"min_years": r.min_years, "years": years}
        show = e is not None and (status != "missing" or code == "negated")
        out.append(RequirementMatch(key=r.key, status=status, score=round(float(pick.score), 3),
                                    evidence_id=e.id if show else None,
                                    evidence_text=e.text if show else None,
                                    evidence_source=e.source if show else None,
                                    counter_evidence_text=counter,
                                    reason=_explain(status, e.source if e else None, why),
                                    reason_code=code or status, reason_params=params))
    weight = {r.key: 2 if r.mandatory else 1 for r in reqs}
    value = {"matched": 1.0, "partial": 0.5, "missing": 0.0}
    counted = [m for m in out if m.status != "needs_review"]
    total = sum(weight[m.key] for m in counted)
    summary = {
        "counts": {s: sum(m.status == s for m in out) for s in ("matched", "partial", "missing", "needs_review")},
        # Weighted share of the requirements the profile shows (mandatory count twice). Requirements needing review are
        # left out of the score and counted above, so the score never guesses about them.
        "score": round(100 * sum(weight[m.key] * value[m.status] for m in counted) / total) if total else None,
        "mandatory_missing": sum(1 for m in out if m.status == "missing" and weight[m.key] == 2),
    }
    provenance = {"mode": "deterministic", "provider": backend.name, "model_version": backend.model_version,
                  "thresholds": {"partial": low, "matched": high}, **({"fallback": fallback} if fallback else {})}
    return MatchResult(matches=out, summary=summary, provenance=provenance)
