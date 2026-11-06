"""Graph A builds from what the employer stated: structured responsibilities and the workbook skills linked to the job."""
import os
import tempfile

os.environ.setdefault("AI_SERVICE_TOKEN", "test-token")
os.environ.setdefault("CHECKPOINT_DB", os.path.join(tempfile.mkdtemp(), "c.sqlite"))

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from midan_ai.assessment_builder import build_assessment_graph

REQUIREMENTS = [
    {"id": "r1", "requirement_type": "responsibility", "description_ar": "مراجعة عقود التوريد قبل توقيعها", "description_en": "Review supply contracts before signing"},
    {"id": "r2", "requirement_type": "daily_task", "description_ar": "متابعة مخاطر الموردين أسبوعيًا", "description_en": "Track supplier risk weekly"},
    {"id": "r3", "requirement_type": "education", "description_ar": "بكالوريوس في القانون", "description_en": "Bachelor's in law"},
    {"id": "r4", "requirement_type": "experience", "description_ar": "ثلاث سنوات خبرة", "description_en": "Three years"},
]
REFERENCE = [
    {"id": "k1", "name_ar": "إدارة مخاطر الموردين", "description_ar": "تقييم الموردين ومراقبة المخاطر المرتبطة بهم", "is_required": True},
    {"id": "k2", "name_ar": "صياغة العقود", "description_ar": None, "is_required": True},
    {"id": "k3", "name_ar": "التفاوض", "description_ar": "وصف", "is_required": False},
]
JOB = {"title_ar": "أخصائي مشتريات", "title_en": "Procurement specialist", "requirements": REQUIREMENTS, "reference_skills": REFERENCE}


def draft(job=JOB):
    graph = build_assessment_graph(InMemorySaver())
    graph.invoke({"job": job}, {"configurable": {"thread_id": "t"}})
    return [i.value for task in graph.get_state({"configurable": {"thread_id": "t"}}).tasks for i in task.interrupts][0]


def test_each_stated_responsibility_gets_its_own_linked_task():
    tasks = draft()["tasks"]
    linked = [t for t in tasks if t["requirement_ids"]]
    assert [t["requirement_ids"] for t in linked] == [["r1"], ["r2"]]
    assert "Review supply contracts before signing" in linked[0]["instructions_en"]
    assert "متابعة مخاطر الموردين" in linked[1]["instructions_ar"]
    # Qualifications are screened from the profile, not turned into tasks.
    assert not any(r in t["requirement_ids"] for t in tasks for r in ("r3", "r4"))
    # The rubric's evidence criteria point at the responsibility they measure.
    assert {c["requirement_id"] for c in linked[0]["criteria"] if c["requirement_id"]} == {"r1"}


def test_required_workbook_skills_get_tasks_with_the_workbook_description_as_criterion():
    tasks = draft()["tasks"]
    skill_tasks = [t for t in tasks if t["reference_skill_ids"]]
    assert [t["reference_skill_ids"] for t in skill_tasks] == [["k1"], ["k2"]]  # k3 is preferred, not required
    first = skill_tasks[0]
    assert "إدارة مخاطر الموردين" in first["title_ar"] and "إدارة مخاطر الموردين" in first["title_en"]
    assert first["criteria"][0]["reference_skill_id"] == "k1"
    assert "تقييم الموردين ومراقبة المخاطر" in first["criteria"][0]["description_ar"]
    # No description in the workbook: nothing is invented, and the criterion says where the meaning comes from.
    assert "كما تصفها مصنفات المهارات القطاعية" in skill_tasks[1]["criteria"][0]["description_ar"]


def test_two_jobs_with_different_requirements_get_different_drafts():
    other = {**JOB, "requirements": [{"id": "x1", "requirement_type": "responsibility", "description_ar": "تصميم واجهات تطبيقات الجوال", "description_en": "Design mobile app screens"}], "reference_skills": []}
    a, b = draft()["tasks"], draft(other)["tasks"]
    assert [t["instructions_en"] for t in a] != [t["instructions_en"] for t in b]
    assert "Design mobile app screens" in b[0]["instructions_en"]


def test_a_draft_still_waits_for_a_person():
    graph = build_assessment_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t"}}
    graph.invoke({"job": JOB}, config)
    assert graph.get_state(config).values.get("outcome") is None
    assert graph.invoke(Command(resume={"approved": True}), config)["outcome"] == "approved"


@pytest.mark.skipif(not os.environ.get("TEST_CHECKPOINT_DATABASE_URL"), reason="needs TEST_CHECKPOINT_DATABASE_URL (a Postgres the AI login can write)")
def test_postgres_checkpoints_survive_a_new_connection():
    from langgraph.checkpoint.postgres import PostgresSaver
    from psycopg import Connection
    from psycopg.rows import dict_row

    def saver():
        connection = Connection.connect(os.environ["TEST_CHECKPOINT_DATABASE_URL"], autocommit=True, prepare_threshold=0, row_factory=dict_row,
                                        options="-c search_path=ai_checkpoints")
        s = PostgresSaver(connection)
        s.setup()
        return s, connection

    thread = {"configurable": {"thread_id": f"pytest-{os.getpid()}"}}
    first, connection = saver()
    build_assessment_graph(first).invoke({"job": JOB}, thread)
    connection.close()
    # A new process would open a new connection; the draft is still waiting there.
    second, connection = saver()
    assert build_assessment_graph(second).invoke(Command(resume={"approved": True}), thread)["outcome"] == "approved"
    connection.close()
