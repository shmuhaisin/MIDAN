import os
import tempfile

os.environ.setdefault("AI_SERVICE_TOKEN", "test-token")
os.environ.setdefault("CHECKPOINT_DB", os.path.join(tempfile.mkdtemp(), "c.sqlite"))

import pytest
from fastapi.testclient import TestClient

from midan_ai import main
from midan_ai.main import app

client = TestClient(app)
TOKEN = os.environ["AI_SERVICE_TOKEN"]
PROTECTED = ["/cv/analyze", "/graphs/assessment-builder/runs", "/graphs/evaluation/runs", "/graphs/evaluation/runs/t/resume"]


@pytest.mark.parametrize("path", PROTECTED)
@pytest.mark.parametrize("headers", [
    {},
    {"x-service-token": ""},
    {"x-service-token": "wrong"},
    {"x-service-token": TOKEN[:-1]},
    {"x-service-token": TOKEN + "x"},
    {"x-service-token": TOKEN.upper()},
    {"x-service-token": f" {TOKEN}"},
    # Not ASCII, sent as raw bytes: hmac on plain strings would raise instead of refusing.
    {"x-service-token": "tøken".encode("utf-8")},
], ids=["missing", "empty", "wrong", "short", "long", "case", "padded", "non-ascii"])
def test_every_route_refuses_anything_but_the_token(path, headers):
    assert client.post(path, json={}, headers=headers).status_code == 401


def test_the_right_token_gets_past_the_check():
    # The body is still invalid, so the request reaches validation instead of being refused.
    assert client.post("/graphs/evaluation/runs", json={}, headers={"x-service-token": TOKEN}).status_code == 422


def test_without_a_configured_token_nothing_gets_in(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "")
    assert client.post("/graphs/evaluation/runs", json={}, headers={"x-service-token": ""}).status_code == 401
    monkeypatch.delenv("AI_SERVICE_TOKEN")
    assert client.post("/graphs/evaluation/runs", json={}).status_code == 401


def test_the_comparison_is_constant_time(monkeypatch):
    calls = []
    real = main.hmac.compare_digest
    monkeypatch.setattr(main.hmac, "compare_digest", lambda a, b: calls.append((type(a), type(b))) or real(a, b))
    client.post("/graphs/evaluation/runs", json={}, headers={"x-service-token": "wrong"})
    assert calls == [(bytes, bytes)]


def test_health_stays_open_for_monitoring():
    assert client.get("/health").status_code == 200
