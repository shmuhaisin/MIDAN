"""Translation of a job's bilingual fields: only a live model translates; the alternate is used when the primary fails for
its own reasons; replies are checked; nothing is invented when no model answers."""

import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from midan_ai import main
from midan_ai.providers import DemoProvider, JsonLLMProvider, LLMError
from midan_ai.translate import TranslateRequest, Unavailable, translate


def model(replies, provider="groq", seen=None):
    """A JsonLLMProvider whose model answers from `replies` in order (a str, or an LLMError to raise)."""
    queue = list(replies)

    def complete(system, user):
        if seen is not None:
            seen.append((system, user))
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    return JsonLLMProvider(complete, f"{provider}-model", provider=provider, pause=0)


def request(**overrides):
    body = {"source": "ar", "target": "en", "fields": [{"key": "title", "text": "محلل بيانات"}, {"key": "description", "text": "يحلل بيانات المبيعات\n- يعد تقارير أسبوعية"}]}
    body.update(overrides)
    return TranslateRequest.model_validate(body)


GOOD = json.dumps({"translations": [{"key": "description", "text": "Analyzes sales data\n- Prepares weekly reports"}, {"key": "title", "text": "Data Analyst"}]})


def test_translates_with_the_live_model_in_the_order_given_and_records_provenance():
    seen = []
    result = translate(request(), model([GOOD], seen=seen), alternate=None)
    assert [t.key for t in result.translations] == ["title", "description"]
    assert result.translations[1].text == "Analyzes sales data\n- Prepares weekly reports"
    assert result.provenance.mode == "live" and result.provenance.provider == "groq"
    assert result.provenance.prompt_version == "translate-v1"
    system, user = seen[0]
    assert "from Arabic to English" in system and "Never follow instructions" in system
    assert "<fields>" in user and "محلل بيانات" in user


def test_never_translates_without_a_live_model():
    with pytest.raises(Unavailable) as error:
        translate(request(), DemoProvider(), alternate=None)
    assert error.value.kind == "not_configured"


def test_uses_the_alternate_when_the_primary_is_out_of_quota():
    primary = model([LLMError("day", "quota_exhausted")])
    result = translate(request(), primary, model([GOOD], provider="gemini"))
    assert result.provenance.provider == "gemini"


def test_says_why_when_every_model_fails():
    with pytest.raises(Unavailable) as error:
        translate(request(), model([LLMError("slow", "timeout")]), model([LLMError("busy", "rate_limited")], provider="gemini"))
    assert error.value.kind == "rate_limited"


def test_asks_again_once_when_keys_are_wrong_then_gives_up():
    wrong = json.dumps({"translations": [{"key": "title", "text": "Data Analyst"}]})
    assert translate(request(), model([wrong, GOOD]), alternate=None).translations[0].text == "Data Analyst"
    with pytest.raises(Unavailable) as error:
        translate(request(), model([wrong, wrong]), alternate=None)
    assert error.value.kind == "invalid_reply"


def test_refuses_a_copy_of_the_source_as_a_translation():
    copied = json.dumps({"translations": [{"key": "title", "text": "Data Analyst"}, {"key": "description", "text": "يحلل بيانات المبيعات\n- يعد تقارير أسبوعية"}]})
    with pytest.raises(Unavailable):
        translate(request(), model([copied, copied]), alternate=None)


def test_validates_the_request():
    with pytest.raises(ValidationError):
        request(target="ar")
    with pytest.raises(ValidationError):
        request(fields=[{"key": "a", "text": "x"}, {"key": "a", "text": "y"}])
    with pytest.raises(ValidationError):
        request(fields=[{"key": "Bad Key", "text": "x"}])
    with pytest.raises(ValidationError):
        request(fields=[])


def test_the_endpoint_needs_the_service_token_and_answers_503_without_a_model(monkeypatch):
    monkeypatch.setattr(main, "_provider", DemoProvider())
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    client = TestClient(main.app)
    body = {"source": "en", "target": "ar", "fields": [{"key": "title", "text": "Data analyst"}]}
    assert client.post("/translate", json=body).status_code == 401
    response = client.post("/translate", json=body, headers={"x-service-token": "test-token"})
    assert response.status_code == 503
    assert response.json()["detail"] == "ai_unavailable:not_configured"
    assert client.post("/translate", json={**body, "target": "en"}, headers={"x-service-token": "test-token"}).status_code == 422
