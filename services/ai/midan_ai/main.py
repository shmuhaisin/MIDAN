"""Private service. Only the Core API calls it, with a shared token. It never touches the database."""

import os
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from pydantic import BaseModel

from .assessment_builder import build_assessment_graph
from .evaluation import build_evaluation_graph
from .providers import PROMPT_VERSION, get_provider
from .schemas import EvaluationInput, JobInput, Provenance

app = FastAPI(title="Midan AI Service", version="0.2.0")

_path = Path(os.environ.get("CHECKPOINT_DB", Path(__file__).parent.parent / ".checkpoints.sqlite"))
_connection = sqlite3.connect(_path, check_same_thread=False)
_saver = SqliteSaver(_connection)
_saver.setup()

_provider = get_provider()
_builder = build_assessment_graph(_saver)
_evaluator = build_evaluation_graph(_provider, _saver)

BUILDER_PROVENANCE = Provenance(mode="demo", model_version="templates-v1", prompt_version="none")


def require_token(x_service_token: str = Header(default="")) -> None:
    expected = os.environ.get("AI_SERVICE_TOKEN")
    if not expected or x_service_token != expected:
        raise HTTPException(status_code=401)


class AssessmentRun(BaseModel):
    thread_id: str
    job: JobInput


class EvaluationRun(BaseModel):
    thread_id: str
    input: EvaluationInput


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
    return {"status": "ok", "service": "midan-ai", "mode": _provider.provenance.mode}


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
