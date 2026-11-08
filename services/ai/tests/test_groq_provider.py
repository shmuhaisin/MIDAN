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
