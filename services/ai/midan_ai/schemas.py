"""Contracts between the Core API and the AI service. Everything is validated at the boundary."""

from typing import Any, Literal

from pydantic import BaseModel, Field

TaskType = Literal["written_case_study", "data_analysis", "objective_questions", "file_submission"]


class Provenance(BaseModel):
    mode: Literal["demo", "live"]
    # Who served the model: "groq", "openai" or "gemini" when live, "demo" for the labelled heuristic and templates.
    provider: str = "demo"
    # The provider's exact model ID, such as openai/gpt-oss-120b on Groq.
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


CompanyType = Literal["private_company", "startup", "sme", "large_enterprise", "government_entity", "semi_government", "nonprofit", "multinational"]
Sector = Literal["digital", "culture_entertainment", "tourism_hospitality", "manufacturing", "construction_real_estate", "financial_services", "wholesale_retail", "other"]
ExperienceLevel = Literal["entry", "junior", "mid", "senior", "lead"]
JobFamily = Literal["technical_build", "technical_operations", "data_analytical", "financial", "regulatory_compliance",
                    "operational_coordination", "creative_content", "customer_service", "engineering_quality"]


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
    # The employer's context. The company's name is never sent: the scenario's company is fictional, of this type and sector.
    company_type: CompanyType | None = None
    sector: Sector | None = None
    experience_level: ExperienceLevel | None = None


class CriterionDraft(BaseModel):
    code: str
    description_ar: str
    description_en: str
    max_score: float = Field(gt=0, le=100)
    weight: float = Field(default=1, gt=0)
    answer_key: dict[str, str] | None = None
    requirement_id: str | None = None
    reference_skill_id: str | None = None
    # Assessor-only, kept in the assessor guide, never in rubric_criteria or anything a candidate reads.
    levels_ar: dict[str, str] = {}
    levels_en: dict[str, str] = {}
    evidence_ar: str = ""
    evidence_en: str = ""


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


# --- The MIDAN Assessment Standard's package (docs/assessment/MIDAN_ASSESSMENT_STANDARD.md). Every part is optional here so a
# draft in the earlier, tasks-only shape still validates; such a draft is "not standardized" and the quality report says so.

class Column(BaseModel):
    name: str = Field(min_length=1)
    meaning_ar: str = ""
    meaning_en: str = ""
    unit: str = ""


class Material(BaseModel):
    """Something the candidate works from. Candidate-facing."""
    id: str = Field(pattern=r"^[a-z0-9_]{1,64}$")
    title_ar: str = Field(min_length=1)
    title_en: str = Field(min_length=1)
    kind: Literal["table", "log", "document", "policy"]
    provenance: Literal["fictional", "public_dataset", "employer_provided"] = "fictional"
    source: str | None = None
    licence: str | None = None
    description_ar: str = ""
    description_en: str = ""
    columns: list[Column] = []
    rows: list[dict[str, Any]] = Field(default=[], max_length=2000)
    file: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.-]{1,128}$")
    row_count: int | None = None
    content_ar: str | None = None
    content_en: str | None = None


class Deliverable(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_]{1,64}$")
    title_ar: str = Field(min_length=1)
    title_en: str = Field(min_length=1)
    format: str
    description_ar: str = ""
    description_en: str = ""


class CandidateBrief(BaseModel):
    company_context_ar: str = ""
    company_context_en: str = ""
    scenario_ar: str = ""
    scenario_en: str = ""
    objective_ar: str = ""
    objective_en: str = ""
    rules_ar: list[str] = []
    rules_en: list[str] = []
    tools_ar: list[str] = []
    tools_en: list[str] = []
    assumptions_policy_ar: str = ""
    assumptions_policy_en: str = ""
    ai_use_policy: Literal["allowed_with_disclosure", "not_allowed", "company_decides"] = "company_decides"
    submission_format_ar: str = ""
    submission_format_en: str = ""
    effort_minutes: int = Field(default=0, ge=0, le=2880)
    deadline_hours: int = Field(default=72, ge=0, le=720)
    deliverables: list[Deliverable] = []


class Calculation(BaseModel):
    """A figure the reference solution relies on, with what it's computed from. `check`, when given, lets MIDAN recompute it
    from the materials: {op, material, column?, where?, expect, tolerance?} (see quality.recompute)."""
    id: str = Field(min_length=1)
    task_ref: int = Field(gt=0)
    label: str = Field(min_length=1)
    formula: str = Field(min_length=1)
    inputs: list[str] = []
    result: str = Field(min_length=1)
    unit: str = ""
    check: dict[str, Any] | None = None


class DecisionPoint(BaseModel):
    task_ref: int = Field(gt=0)
    point: str = Field(min_length=1)
    accepted: str = Field(min_length=1)
    not_accepted: str = ""


class TaskSolution(BaseModel):
    task_ref: int = Field(gt=0)
    reference_solution: str = ""
    expected_outputs: list[str] = []
    accepted_alternatives: list[str] = []
    common_mistakes: list[str] = []


class Source(BaseModel):
    title: str = Field(min_length=1)
    url: str | None = None
    kind: Literal["official", "press", "dataset", "internal_fictional"]
    verification: Literal["verified", "unverified"] = "unverified"
    accessed: str | None = None
    supports: str = ""


class SkillMapEntry(BaseModel):
    task_ref: int = Field(gt=0)
    how_measured: str = Field(min_length=1)


class AssessorGuide(BaseModel):
    """Internal. Stored in assessment_assessor_guides, which no candidate can read."""
    language: Literal["ar", "en", "both"] = "en"
    scope_and_limits: str = ""
    task_solutions: list[TaskSolution] = []
    calculations: list[Calculation] = []
    decision_points: list[DecisionPoint] = []
    verification_steps: list[str] = []
    boundaries: list[str] = []
    not_scored: list[str] = []
    sources: list[Source] = []
    approval_notes: list[str] = []
    skill_map: list[SkillMapEntry] = []
    objective_rationale: dict[str, str] = {}
    pass_mark: float | None = None


class GeneratedCriterion(BaseModel):
    description_ar: str = Field(min_length=1)
    description_en: str = Field(min_length=1)
    max_score: float = Field(default=10, gt=0, le=100)
    weight: float = Field(default=1, gt=0)
    # Under the standard: points out of the assessment's 100, a descriptor per level 0–4, and the evidence to point to.
    points: float | None = Field(default=None, gt=0, le=100)
    levels_ar: dict[str, str] = {}
    levels_en: dict[str, str] = {}
    evidence_ar: str = ""
    evidence_en: str = ""


class GeneratedOption(BaseModel):
    id: str = Field(min_length=1)
    label_ar: str = Field(min_length=1)
    label_en: str = Field(min_length=1)


class GeneratedQuestion(BaseModel):
    id: str = Field(min_length=1)
    prompt_ar: str = Field(min_length=1)
    prompt_en: str = Field(min_length=1)
    options: list[GeneratedOption] = Field(min_length=2)
    answer: str


class GeneratedTask(BaseModel):
    task_type: Literal["written_case_study", "objective_questions", "file_submission"]
    title_ar: str = Field(min_length=1)
    title_en: str = Field(min_length=1)
    instructions_ar: str = Field(min_length=1)
    instructions_en: str = Field(min_length=1)
    weight: float = Field(default=2, gt=0)
    requirement_ids: list[str] = []
    reference_skill_ids: list[str] = []
    skill_ids: list[str] = []
    criteria: list[GeneratedCriterion] = []
    questions: list[GeneratedQuestion] = []
    deliverable_ids: list[str] = []
    material_ids: list[str] = []


class GeneratedAssessment(BaseModel):
    """What any model must return for an assessment. Gemini and OpenAI answer to this one contract. With a brief and a guide it
    is a package under the MIDAN Assessment Standard; without them it is the earlier tasks-only draft."""

    tasks: list[GeneratedTask] = Field(min_length=1, max_length=8)
    job_family: JobFamily | None = None
    secondary_families: list[JobFamily] = []
    candidate_brief: CandidateBrief | None = None
    materials: list[Material] = Field(default=[], max_length=12)
    assessor_guide: AssessorGuide | None = None

    @property
    def standardized(self) -> bool:
        return self.candidate_brief is not None and self.assessor_guide is not None and self.job_family is not None


class CriterionInput(BaseModel):
    id: str
    code: str
    description_en: str
    description_ar: str = ""
    max_score: float = Field(gt=0)
    weight: float = Field(default=1, gt=0)
    answer_key: dict[str, str] | None = None
    # From the assessor guide of the attempt's own assessment version, when it has one: what each level looks like, and the
    # evidence the criterion needs. Staff-only material; it is never part of anything a candidate receives.
    levels_ar: dict[str, str] = {}
    levels_en: dict[str, str] = {}
    evidence_ar: str = ""
    evidence_en: str = ""


class TaskInput(BaseModel):
    id: str
    task_type: TaskType
    title_en: str
    instructions_en: str = ""
    title_ar: str = ""
    instructions_ar: str = ""
    reference_skill_ids: list[str] = []
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
    # Skills from the official sector workbooks the tasks measure. They get a score, not a level: the workbooks define none.
    reference_skills: list[ReferenceSkillRef] = []
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
