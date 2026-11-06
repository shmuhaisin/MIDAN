"""Contracts between the Core API and the AI service. Everything is validated at the boundary."""

from typing import Any, Literal

from pydantic import BaseModel, Field

TaskType = Literal["written_case_study", "data_analysis", "objective_questions", "file_submission"]


class Provenance(BaseModel):
    mode: Literal["demo", "live"]
    model_version: str
    prompt_version: str


class SkillRef(BaseModel):
    id: str
    slug: str
    name_ar: str
    name_en: str
    synonyms: list[str] = []


class RequirementRef(BaseModel):
    """A requirement the employer stated or approved. Only these shape the tasks."""
    id: str
    requirement_type: str
    description_ar: str | None = None
    description_en: str | None = None
    is_mandatory: bool = True


class ReferenceSkillRef(BaseModel):
    """A skill from the official sector workbooks that the organization linked to the job. Names are Arabic only."""
    id: str
    name_ar: str
    description_ar: str | None = None
    is_required: bool = True


class JobInput(BaseModel):
    title_ar: str
    title_en: str
    description_ar: str | None = None
    description_en: str | None = None
    requirements_ar: str | None = None
    requirements_en: str | None = None
    required_skills: list[SkillRef] = []
    taxonomy: list[SkillRef] = []
    requirements: list[RequirementRef] = []
    reference_skills: list[ReferenceSkillRef] = []


class CriterionDraft(BaseModel):
    code: str
    description_ar: str
    description_en: str
    max_score: float = Field(gt=0, le=100)
    weight: float = Field(default=1, gt=0)
    answer_key: dict[str, str] | None = None
    requirement_id: str | None = None
    reference_skill_id: str | None = None


class TaskDraft(BaseModel):
    position: int = Field(gt=0)
    task_type: TaskType
    title_ar: str = Field(min_length=1)
    title_en: str = Field(min_length=1)
    instructions_ar: str = Field(min_length=1)
    instructions_en: str = Field(min_length=1)
    weight: float = Field(default=1, gt=0)
    config: dict[str, Any] = {}
    skill_ids: list[str] = []
    requirement_ids: list[str] = []
    reference_skill_ids: list[str] = []
    criteria: list[CriterionDraft] = []


class CriterionInput(BaseModel):
    id: str
    code: str
    description_en: str
    max_score: float = Field(gt=0)
    weight: float = Field(default=1, gt=0)
    answer_key: dict[str, str] | None = None


class TaskInput(BaseModel):
    id: str
    task_type: TaskType
    title_en: str
    instructions_en: str = ""
    weight: float = Field(default=1, gt=0)
    skill_ids: list[str] = []
    skill_weights: dict[str, float] = {}
    criteria: list[CriterionInput]


class EvaluationInput(BaseModel):
    """Carries nothing about the candidate except names to remove, so that a name written in an answer stays here."""
    known_names: list[str] = []  # Used only to remove these names from answers. Never sent to a provider.

    attempt_id: str
    attempt_status: str
    rubric_version: int
    tasks: list[TaskInput]
    skills: list[SkillRef] = []
    responses: dict[str, dict[str, Any]] = {}
    evidence: dict[str, list[str]] = {}


class CriterionProposal(BaseModel):
    criterion_id: str
    task_id: str
    score: float = Field(ge=0)
    source: Literal["deterministic", "ai_assisted"]
    evidence_ref: str | None = None
    explanation: str
    confidence: float = Field(ge=0, le=1)


class OpenScore(BaseModel):
    """What a provider must return for one criterion on an open response."""

    score: float = Field(ge=0)
    evidence_quote: str
    explanation: str
    confidence: float = Field(ge=0, le=1)
