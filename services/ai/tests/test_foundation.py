from fastapi.testclient import TestClient

from midan_ai.foundation_graph import build_foundation_graph
from midan_ai.main import app


def test_health():
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "midan-ai"}


def test_graph_loop_is_bounded_and_checkpointed():
    graph = build_foundation_graph()
    config = {"configurable": {"thread_id": "t1"}}
    result = graph.invoke({"attempts": 0, "max_attempts": 3}, config)
    assert result["attempts"] == 3
    assert graph.get_state(config).values["attempts"] == 3
