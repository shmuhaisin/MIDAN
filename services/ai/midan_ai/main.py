"""Private service. Only the Core API calls it, with a shared token. It never touches the database."""

import base64
import binascii
import hmac
import os
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from pydantic import BaseModel

from .assessment_builder import build_assessment_graph
from .cv import analyze as analyze_cv
from .evaluation import build_evaluation_graph
from .providers import PROMPT_VERSION, get_provider
from .schemas import EvaluationInput, JobInput, Provenance

app = FastAPI(title="Midan AI Service", version="0.2.0")

def _checkpointer():
    """Postgres when CHECKPOINT_DATABASE_URL is set, so a workflow waiting for a reviewer survives restarts and runs on
    several instances. Otherwise a local SQLite file, which is for development only."""
    url = os.environ.get("CHECKPOINT_DATABASE_URL")
    if url:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg import Connection
        from psycopg.rows import dict_row

        # Tables live in the ai_checkpoints schema, which only the AI service's own login reaches.
        connection = Connection.connect(url, autocommit=True, prepare_threshold=0, row_factory=dict_row,
                                        options="-c search_path=ai_checkpoints")
        saver = PostgresSaver(connection)
        saver.setup()
        return saver, "postgres"
    path = Path(os.environ.get("CHECKPOINT_DB", Path(__file__).parent.parent / ".checkpoints.sqlite"))
    saver = SqliteSaver(sqlite3.connect(path, check_same_thread=False))
    saver.setup()
    return saver, "sqlite"


_saver, CHECKPOINTER = _checkpointer()

_provider = get_provider()
_builder = build_assessment_graph(_saver)
_evaluator = build_evaluation_graph(_provider, _saver)

BUILDER_PROVENANCE = Provenance(mode="demo", model_version="templates-v2-requirements", prompt_version="none")


def require_token(x_service_token: str = Header(default="")) -> None:
    """Constant-time, so response timing says nothing about how much of a guess was right. Compared as bytes, which
    also handles a header that isn't ASCII. With no token configured, every call is refused."""
    expected = os.environ.get("AI_SERVICE_TOKEN", "")
    if not expected or not hmac.compare_digest(x_service_token.encode(), expected.encode()):
        raise HTTPException(status_code=401)


class AssessmentRun(BaseModel):
    thread_id: str
    job: JobInput


class EvaluationRun(BaseModel):
    thread_id: str
    input: EvaluationInput


class CvRun(BaseModel):
    file_base64: str
    known_names: list[str] = []


class Resume(BaseModel):
    value: dict[str, Any]


def _config(thread_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread_id}}


def _result(graph, thread_id: str, state: dict[str, Any]) -> dict[str, Any]:
    pending = graph.get_state(_config(thread_id)).tasks
    interrupts = [i.value for task in pending for i in task.interrupts]
    if interrupts:
        return {"status": "awaiting_human_review", "payload": interrupts[0]}
    return {"status": state.get("outcome", "unknown"), "payload": state}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "midan-ai", "mode": _provider.provenance.mode, "checkpointer": CHECKPOINTER}


@app.post("/cv/analyze", dependencies=[Depends(require_token)])
def run_cv(run: CvRun) -> dict[str, Any]:
    """Answers with a status and a code. File contents never appear in an error, a log or a trace."""
    try:
        data = base64.b64decode(run.file_base64, validate=True)
    except (binascii.Error, ValueError):
        return {"status": "failed", "code": "unreadable", "counts": {}}
    try:
        return analyze_cv(data, run.known_names, getattr(_provider, "complete", None))
    except Exception:
        return {"status": "failed", "code": "analysis_failed", "counts": {}}


@app.post("/graphs/assessment-builder/runs", dependencies=[Depends(require_token)])
def run_builder(run: AssessmentRun) -> dict[str, Any]:
    state = _builder.invoke({"job": run.job.model_dump()}, _config(run.thread_id))
    return {**_result(_builder, run.thread_id, state), "provenance": BUILDER_PROVENANCE.model_dump()}


@app.post("/graphs/assessment-builder/runs/{thread_id}/resume", dependencies=[Depends(require_token)])
def resume_builder(thread_id: str, resume: Resume) -> dict[str, Any]:
    return _result(_builder, thread_id, _builder.invoke(Command(resume=resume.value), _config(thread_id)))


@app.post("/graphs/evaluation/runs", dependencies=[Depends(require_token)])
def run_evaluation(run: EvaluationRun) -> dict[str, Any]:
    state = _evaluator.invoke({"input": run.input.model_dump()}, _config(run.thread_id))
    return {**_result(_evaluator, run.thread_id, state), "provenance": _provider.provenance.model_dump()}


@app.post("/graphs/evaluation/runs/{thread_id}/resume", dependencies=[Depends(require_token)])
def resume_evaluation(thread_id: str, resume: Resume) -> dict[str, Any]:
    if not _evaluator.get_state(_config(thread_id)).tasks:
        raise HTTPException(status_code=409, detail="No evaluation is waiting for review on this thread")
    return _result(_evaluator, thread_id, _evaluator.invoke(Command(resume=resume.value), _config(thread_id)))
