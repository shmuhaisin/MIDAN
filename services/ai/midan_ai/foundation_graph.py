"""Wiring check for LangGraph: typed state, a conditional edge and a checkpointer.

This is not an assessment or evaluation workflow. Graph A and Graph B arrive in
Milestones 6 and 7. The in-memory checkpointer here is for this check only.
"""

from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph


class FoundationState(TypedDict):
    attempts: int
    max_attempts: int


def attempt(state: FoundationState) -> FoundationState:
    return {**state, "attempts": state["attempts"] + 1}


def should_retry(state: FoundationState) -> str:
    return "attempt" if state["attempts"] < state["max_attempts"] else END


def build_foundation_graph():
    graph = StateGraph(FoundationState)
    graph.add_node("attempt", attempt)
    graph.add_edge(START, "attempt")
    graph.add_conditional_edges("attempt", should_retry)
    return graph.compile(checkpointer=InMemorySaver())
