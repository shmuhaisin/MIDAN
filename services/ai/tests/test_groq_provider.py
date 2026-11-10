"""Groq as the provider: the request it receives, rate limits, truncation, provenance and honest status. No network here:
httpx.post is replaced, and every payload is fictional. Real calls are in test_assessment_standard.py's real_ tests."""

import json

import httpx
import pytest

from midan_ai import providers
from midan_ai.providers import GROQ_BASE, DemoProvider, JsonLLMProvider, LLMError, _groq, get_provider, provider_status

ENV = {"AI_PROVIDER": "groq", "GROQ_API_KEY": "fictional-test-key", "GROQ_MODEL": "openai/gpt-oss-120b"}


class Reply:
    def __init__(self, status: int, body: dict | None = None, headers: dict | None = None):
        self.status_code = status
        self._body = body or {}
        self.headers = headers or {}

    def json(self):
        return self._body


def ok(content: str, finish: str = "stop") -> Reply:
    return Reply(200, {"choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}]})


@pytest.fixture
def calls(monkeypatch):
    seen: list[dict] = []
    queue: list[Reply] = []

    def post(url, **kwargs):
        seen.append({"url": url, **kwargs})
        return queue.pop(0)

    monkeypatch.setattr(providers.httpx, "post", post)
    return seen, queue


def test_groq_is_chosen_and_recorded_with_its_exact_model():
    provider = get_provider(ENV)
    assert isinstance(provider, JsonLLMProvider)
    assert provider.provenance.model_dump() == {"mode": "live", "provider": "groq", "model_version": "openai/gpt-oss-120b", "prompt_version": providers.PROMPT_VERSION}


def test_the_request_uses_only_what_groq_supports(calls):
    seen, queue = calls
    queue.append(ok('{"a": 1}'))
    assert _groq("openai/gpt-oss-120b", "fictional-test-key")("Reply in JSON.", "Hello") == '{"a": 1}'
    request = seen[0]
    assert request["url"] == f"{GROQ_BASE}/chat/completions" == "https://api.groq.com/openai/v1/chat/completions"
    assert request["headers"] == {"authorization": "Bearer fictional-test-key"}
    body = request["json"]
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["response_format"] == {"type": "json_object"}
    assert body["include_reasoning"] is False
    for unsupported in ("logprobs", "logit_bias", "top_logprobs", "n", "stream", "tools"):
        assert unsupported not in body
    assert all("name" not in m for m in body["messages"])
    assert request["timeout"] == 120


def test_optional_reasoning_effort_and_output_limit(calls):
    seen, queue = calls
    queue.append(ok("{}"))
    _groq("openai/gpt-oss-120b", "k", reasoning_effort="low", max_tokens=4096)("s", "u")
    assert seen[0]["json"]["reasoning_effort"] == "low"
    assert seen[0]["json"]["max_completion_tokens"] == 4096


def test_a_rate_limit_waits_for_retry_after_then_succeeds(calls):
    seen, queue = calls
    slept: list[float] = []
    queue.extend([Reply(429, headers={"retry-after": "3"}), ok('{"done": true}')])
    assert _groq("m", "k", sleep=slept.append)("s", "u") == '{"done": true}'
    assert slept == [3.0]
    assert len(seen) == 2


def test_a_long_or_repeated_rate_limit_fails_instead_of_hanging(calls):
    _, queue = calls
    slept: list[float] = []
    queue.append(Reply(429, headers={"retry-after": "120"}))
    with pytest.raises(LLMError, match="rate limit"):
        _groq("m", "k", sleep=slept.append)("s", "u")
    assert slept == []
    queue.extend([Reply(429), Reply(429), Reply(429)])
    with pytest.raises(LLMError, match="rate limit"):
        _groq("m", "k", sleep=slept.append)("s", "u")
    assert slept == [2.0, 4.0]


@pytest.mark.parametrize("reply, message", [
    (Reply(400, {"error": {"message": "fictional"}}), "Groq responded 400"),
    (Reply(413), "Groq responded 413"),
    (Reply(503), "Groq responded 503"),
    (ok('{"cut', finish="length"), "output limit"),
    (ok(""), "no content"),
])
def test_refusals_and_truncation_are_errors_never_mock_results(calls, reply, message):
    _, queue = calls
    queue.append(reply)
    with pytest.raises(LLMError, match=message) as error:
        _groq("m", "fictional-test-key")("s", "u")
    assert "fictional-test-key" not in str(error.value)


def test_a_timeout_is_the_provider_being_unavailable(monkeypatch):
    def post(url, **kwargs):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(providers.httpx, "post", post)
    with pytest.raises(LLMError, match="Provider unreachable: ReadTimeout"):
        _groq("m", "k")("s", "u")


def test_evaluation_with_groq_goes_to_a_person_when_groq_keeps_failing(calls):
    from midan_ai.schemas import CriterionInput, TaskInput

    _, queue = calls
    queue.extend([Reply(503), Reply(503)])
    provider = JsonLLMProvider(_groq("openai/gpt-oss-120b", "k"), "openai/gpt-oss-120b", provider="groq", pause=0)
    task = TaskInput(id="t", task_type="written_case_study", title_en="x", instructions_en="x", weight=1, criteria=[])
    criterion = CriterionInput(id="c", code="C1", description_en="x", max_score=10)
    with pytest.raises(LLMError, match="No valid response"):
        provider.score_open(task, criterion, "A fictional answer.")


def test_a_missing_key_is_reported_by_name_and_nothing_pretends_to_be_groq():
    env = {"AI_PROVIDER": "groq", "GROQ_MODEL": "openai/gpt-oss-120b"}
    assert isinstance(get_provider(env), DemoProvider)
    assert DemoProvider.provenance.provider == "demo"
    assert provider_status(env) == {"requested_provider": "groq", "missing_settings": ["GROQ_API_KEY"]}
    assert provider_status(ENV) == {"requested_provider": "groq", "missing_settings": []}
    assert "fictional-test-key" not in json.dumps(provider_status(ENV))


def test_a_schema_is_sent_in_best_effort_json_schema_mode_and_the_default_output_limit_applies(calls):
    from midan_ai.providers import GROQ_DEFAULT_MAX_COMPLETION_TOKENS
    from midan_ai.schemas import OpenScore

    seen, queue = calls
    queue.append(ok(json.dumps({"score": 7, "evidence_quote": "", "explanation": "Fictional.", "confidence": 0.5})))
    provider = get_provider(ENV)
    provider._call("s", "u", OpenScore)
    body = seen[0]["json"]
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["name"] == "OpenScore"
    assert body["response_format"]["json_schema"]["strict"] is False
    assert body["response_format"]["json_schema"]["schema"]["properties"]["score"]
    assert body["max_completion_tokens"] == GROQ_DEFAULT_MAX_COMPLETION_TOKENS == 3300
    # Scoring keeps the model's default reasoning; only generation asks for less.
    assert "reasoning_effort" not in body


def test_a_refused_draft_is_retried_with_the_fields_that_were_wrong(calls):
    _, queue = calls
    queue.extend([ok(json.dumps({"job_family": "invented_family", "tasks": "not a list"})), ok("{}")])
    seen_users = []
    provider = get_provider(ENV)
    original = provider._complete

    def spy(system, user, schema=None, **kwargs):
        seen_users.append(user)
        return original(system, user, schema=schema, **kwargs)

    spy.accepts_schema = True
    provider._complete = spy
    with pytest.raises(Exception):
        provider.generate_assessment({"title_en": "Fictional analyst"})
    assert "these fields don't match the required JSON" in seen_users[1]
    assert "job_family" in seen_users[1]


def test_generation_asks_for_low_reasoning_and_a_refused_draft_is_judged_by_our_schema(calls):
    seen, queue = calls
    draft = json.dumps({"job_family": "data_analytical", "tasks": []})
    queue.append(Reply(400, {"error": {"code": "json_validate_failed", "message": "fictional", "failed_generation": draft}}))
    out = _groq("openai/gpt-oss-120b", "k")("s", "u", schema=("GeneratedAssessment", {"type": "object"}))
    assert out == draft
    assert seen[0]["json"]["reasoning_effort"] == "low"


def test_a_too_large_request_says_why(calls):
    _, queue = calls
    queue.append(Reply(413))
    with pytest.raises(LLMError, match="tokens-per-minute"):
        _groq("m", "k")("s", "u")


def test_whole_package_generation_sends_no_schema_and_gets_a_larger_output_budget(calls):
    seen, queue = calls
    queue.append(Reply(200, {"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]}))
    _groq("openai/gpt-oss-120b", "k", max_tokens=3300)("s", "u", schema=("GeneratedAssessment", {"type": "object"}))
    body = seen[0]["json"]
    assert body["response_format"] == {"type": "json_object"} and body["max_completion_tokens"] == 5200


def test_a_string_where_a_list_of_strings_belongs_is_mended_and_nothing_else():
    from midan_ai.providers import _lists_as_lists
    from midan_ai.schemas import GeneratedAssessment
    raw = {"tasks": [{"task_type": "written_case_study", "title_ar": "أ", "title_en": "a", "instructions_ar": "ب", "instructions_en": "b",
                      "requirement_ids": "r1"}],
           "assessor_guide": {"verification_steps": "1. Check the totals\n2. Check the units", "boundaries": "Fictional data only"}}
    out = _lists_as_lists(GeneratedAssessment, raw)
    assert out["tasks"][0]["requirement_ids"] == ["r1"]
    assert out["assessor_guide"]["verification_steps"] == ["1. Check the totals", "2. Check the units"]
    assert out["assessor_guide"]["boundaries"] == ["Fictional data only"]
    assert out["tasks"][0]["title_en"] == "a"  # strings stay strings


# --- Why a call failed, so the reviewer can be told (FAILURE_KINDS). Every payload is fictional.

def _kind(calls_fixture, *replies: Reply) -> str:
    _, queue = calls_fixture
    queue.extend(replies)
    with pytest.raises(LLMError) as error:
        _groq("m", "k", sleep=lambda _: None)("s", "u")
    return error.value.kind


def test_a_short_rate_limit_that_persists_is_a_rate_limit(calls):
    assert _kind(calls, Reply(429), Reply(429), Reply(429)) == "rate_limited"


def test_groqs_daily_limit_is_a_used_up_quota_not_a_rate_limit(calls):
    daily = {"error": {"message": "Rate limit reached for model `m` on tokens per day (TPD): Limit 200000, Used 199990. Please try again in 7m12s."}}
    assert _kind(calls, Reply(429, daily, {"retry-after": "432"})) == "quota_exhausted"


def test_a_retry_after_of_hours_is_a_used_up_quota(calls):
    assert _kind(calls, Reply(429, headers={"retry-after": "7200"})) == "quota_exhausted"


@pytest.mark.parametrize("reply, kind", [
    (Reply(503), "unavailable"),
    (Reply(401), "unavailable"),
    (Reply(413), "rate_limited"),
    (ok('{"cut', finish="length"), "invalid_reply"),
    (ok(""), "invalid_reply"),
])
def test_each_refusal_says_what_kind_it_is(calls, reply, kind):
    assert _kind(calls, reply) == kind


def test_a_timeout_and_a_dropped_connection_are_told_apart(monkeypatch):
    for failure, kind in ((httpx.ReadTimeout("slow"), "timeout"), (httpx.ConnectError("refused"), "unavailable")):
        def post(url, _failure=failure, **kwargs):
            raise _failure

        monkeypatch.setattr(providers.httpx, "post", post)
        with pytest.raises(LLMError) as error:
            _groq("m", "k")("s", "u")
        assert error.value.kind == kind


def test_the_kind_survives_the_scorers_retries(calls):
    from midan_ai.schemas import CriterionInput, TaskInput

    daily = {"error": {"message": "Rate limit reached on requests per day (RPD)."}}
    _, queue = calls
    queue.extend([Reply(429, daily, {"retry-after": "900"}), Reply(429, daily, {"retry-after": "900"})])
    provider = JsonLLMProvider(_groq("openai/gpt-oss-120b", "k", sleep=lambda _: None), "openai/gpt-oss-120b", provider="groq", pause=0)
    task = TaskInput(id="t", task_type="written_case_study", title_en="x", instructions_en="x", weight=1, criteria=[])
    with pytest.raises(LLMError) as error:
        provider.score_open(task, CriterionInput(id="c", code="C1", description_en="x", max_score=10), "A fictional answer.")
    assert error.value.kind == "quota_exhausted"


def test_an_unknown_kind_is_reported_as_unavailable():
    assert LLMError("x", "something else").kind == "unavailable"
    assert LLMError("x").kind == "unavailable"
