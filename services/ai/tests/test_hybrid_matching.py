"""The hybrid backend (e5 retrieval + cross-encoder rerank): only e5's top lines are reranked, the status rule and score
formula are the existing ones, and a reranker failure falls back to e5 and says so."""

from midan_ai.matching import E5Reranker, EvidenceIn, MatchRequest, RequirementIn, match


class FakeE5:
    name, model_version = "e5-local", "intfloat/multilingual-e5-base"
    thresholds, review_floor = (0.80, 0.83), 0.77

    def scores(self, requirements, evidence):
        # Prefers lines that share a word with the requirement, so the top-k pick is predictable.
        return [[0.9 if set(r.lower().split()) & set(e.lower().split()) else 0.1 for e in evidence] for r in requirements]


class Hybrid(E5Reranker):
    def __init__(self, relevance, fail=False):
        super().__init__(e5=FakeE5())
        self.relevance, self.fail, self.seen = relevance, fail, []
        self._cache = {}

    def _rerank(self, pairs):
        if self.fail:
            raise RuntimeError("reranker unavailable")
        self.seen.extend(pairs)
        return [self.relevance.get(e, 0.0) for _, e in pairs]


LINES = ["Built SQL reports on customer churn for managers", "Planned social media campaigns", "SQL",
         "Organized a conference for 400 attendees", "Wrote SQL queries joining usage tables"]


def request():
    return MatchRequest(requirements=[RequirementIn(key="r1", text="SQL reporting on churn", mandatory=True)],
                        evidence=[EvidenceIn(id=f"e{i}", text=t, source="skill" if t == "SQL" else "experience") for i, t in enumerate(LINES)])


def test_only_the_top_lines_e5_retrieved_are_reranked():
    b = Hybrid({LINES[0]: 0.4})
    match(request(), b)
    lines = [e for _, e in b.seen]
    # The top TOP_K sentences and the top TOP_K brief lines, each kind on its own: 4 sentences and 1 skill name here.
    assert len(lines) == E5Reranker.TOP_K + 1 and "SQL" in lines and all(r == "SQL reporting on churn" for r, _ in b.seen)


def test_sentences_are_reranked_even_when_skill_names_fill_e5s_top_lines():
    # Measured on the real models: e5 put a headline and skill names above the sentence that describes the work, and the
    # sentence never reached the reranker.
    lines = ["presenting", "presenting skills", "presenting reports", "Gave monthly findings to commercial managers"]
    req = MatchRequest(requirements=[RequirementIn(key="r1", text="presenting to managers")],
                       evidence=[EvidenceIn(id=f"e{i}", text=t, source="skill" if i < 3 else "experience") for i, t in enumerate(lines)])
    b = Hybrid({lines[3]: 0.1, lines[0]: 0.9})
    m = match(req, b).matches[0]
    assert lines[3] in [e for _, e in b.seen]
    assert m.status == "matched" and m.evidence_text == lines[3]


def test_a_related_sentence_is_used_over_a_higher_scoring_skill_name():
    # The real case: "churn analysis" in the skills list scored 0.947 and "Built SQL reports on customer churn ..." 0.119.
    # The skill name alone is capped at "partial"; the sentence above the "matched" threshold confirms it.
    m = match(request(), Hybrid({LINES[2]: 0.95, LINES[0]: 0.1})).matches[0]
    assert m.status == "matched" and m.evidence_text == LINES[0]


def test_a_sentence_below_the_partial_threshold_never_replaces_a_related_skill_name():
    m = match(request(), Hybrid({LINES[2]: 0.5, LINES[0]: 0.003})).matches[0]
    assert m.status == "partial" and m.evidence_text == "SQL" and m.reason_code == "brief_evidence"


def test_status_thresholds_follow_the_reranker_and_the_formula_is_unchanged():
    result = match(request(), Hybrid({LINES[0]: 0.4}))
    m = result.matches[0]
    assert m.status == "matched" and m.evidence_text == LINES[0]
    assert result.summary["score"] == 100  # the existing rule: a matched mandatory requirement is 100%
    assert result.provenance["provider"] == "e5-rerank" and "bge-reranker-v2-m3" in result.provenance["model_version"]


def test_uncertain_relevance_goes_to_a_person_and_is_left_out_of_the_score():
    result = match(request(), Hybrid({LINES[0]: 0.002}))
    assert result.matches[0].status == "needs_review"
    assert result.summary["score"] is None  # never a zero for what can't be told


def test_a_bare_skill_name_never_matches_and_needs_the_brief_floor_for_partial():
    only_skill = {LINES[2]: 0.05}
    assert match(request(), Hybrid(only_skill)).matches[0].status == "needs_review"
    assert match(request(), Hybrid({LINES[2]: 0.5})).matches[0].status == "partial"


def test_a_reranker_failure_falls_back_to_e5_and_says_so():
    result = match(request(), Hybrid({}, fail=True))
    assert result.provenance["provider"] == "e5-local"
    assert "e5-rerank failed" in result.provenance["fallback"]


def test_fast_mode_uses_e5_alone_for_screens_a_person_waits_on():
    b = Hybrid({LINES[0]: 0.4})
    req = request().model_copy(update={"mode": "fast"})
    result = match(req, b)
    assert b.seen == [] and result.provenance["provider"] == "e5-local"


def test_a_reranker_over_its_time_budget_fails_over_to_e5_and_says_so():
    class Slow(Hybrid):
        def _rerank(self, pairs):
            raise TimeoutError("reranking exceeded 0.01 s")
    result = match(request(), Slow({}))
    assert result.provenance["provider"] == "e5-local" and "TimeoutError" in result.provenance["fallback"]


def test_the_real_budget_check_raises_when_time_runs_out(monkeypatch):
    import time as t
    b = E5Reranker(e5=FakeE5())
    b._cache, b.budget_s = {}, 0.0
    monkeypatch.setattr(t, "monotonic", iter([0.0, 5.0, 5.0]).__next__)
    import pytest
    with pytest.raises(TimeoutError):
        b._rerank([("a", "b")])
