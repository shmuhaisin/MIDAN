"""The MIDAN Assessment Standard in machine-readable form. docs/assessment/MIDAN_ASSESSMENT_STANDARD.md is the same standard in
prose; the two change together. Nothing here comes from a reference package's content: only the structure the packages share."""

from dataclasses import dataclass, field
from typing import Literal

STANDARD_VERSION = "MAS-1.0"

JobFamily = Literal[
    "technical_build", "technical_operations", "data_analytical", "financial", "regulatory_compliance",
    "operational_coordination", "creative_content", "customer_service", "engineering_quality",
]
Level = Literal["entry", "junior", "mid", "senior", "lead"]
LEVELS: tuple[str, ...] = ("entry", "junior", "mid", "senior", "lead")

COMPANY_TYPES: dict[str, tuple[str, str]] = {
    "private_company": ("شركة خاصة", "private company"),
    "startup": ("شركة ناشئة", "startup"),
    "sme": ("منشأة صغيرة أو متوسطة", "small or medium enterprise"),
    "large_enterprise": ("شركة كبيرة", "large enterprise"),
    "government_entity": ("جهة حكومية", "government entity"),
    "semi_government": ("جهة شبه حكومية", "semi-government entity"),
    "nonprofit": ("منظمة غير ربحية", "nonprofit organization"),
    "multinational": ("شركة متعددة الجنسيات", "multinational company"),
}

# The sector values jobs already use (20261105231005). The words are what a company context of that sector would mention;
# relevance looks for any of them, in either language.
SECTORS: dict[str, dict[str, tuple[str, ...]]] = {
    "digital": {"ar": ("تقني", "تقنية", "رقمي", "رقمية", "سحابي", "سحابية", "برمجيات", "منصة", "بيانات"),
                "en": ("technology", "tech", "digital", "cloud", "software", "platform", "saas", "data")},
    "culture_entertainment": {"ar": ("ثقاف", "ترفيه", "فعالي", "فنون", "إعلام"),
                              "en": ("culture", "entertainment", "event", "arts", "media")},
    "tourism_hospitality": {"ar": ("سياح", "ضياف", "فندق", "منتجع", "رحلات"),
                            "en": ("tourism", "hospitality", "hotel", "resort", "travel")},
    "manufacturing": {"ar": ("تصنيع", "مصنع", "إنتاج", "صناع"), "en": ("manufactur", "factory", "plant", "production", "industrial")},
    "construction_real_estate": {"ar": ("تشييد", "إنشاء", "مقاولات", "عقار", "بناء"),
                                 "en": ("construction", "real estate", "property", "contracting", "building")},
    "financial_services": {"ar": ("مالي", "مالية", "مصرف", "بنك", "تمويل", "تأمين", "استثمار"),
                           "en": ("financ", "bank", "lending", "insurance", "investment", "fintech")},
    "wholesale_retail": {"ar": ("تجزئة", "جملة", "متجر", "تجارة"), "en": ("retail", "wholesale", "store", "commerce", "e-commerce")},
    "other": {"ar": (), "en": ()},
}


@dataclass(frozen=True)
class FamilyProfile:
    effort_minutes: tuple[int, int]
    needs_materials: bool = True
    needs_table_material: bool = False
    needs_data_dictionary: bool = False
    min_calculations_per_task: int = 0
    min_verification_steps: int = 0
    needs_decision_points: bool = False
    needs_accepted_alternatives: bool = False
    needs_sources: bool = False
    needs_not_scored_boundary: bool = False
    deliverable_formats: tuple[str, ...] = ()
    summary_en: str = ""


FAMILIES: dict[str, FamilyProfile] = {
    "technical_build": FamilyProfile((180, 360), needs_materials=False, min_verification_steps=3, needs_accepted_alternatives=True,
                                     deliverable_formats=("code_repository", "md", "link"), summary_en="Build working software or models"),
    "technical_operations": FamilyProfile((90, 240), needs_table_material=True, needs_decision_points=True, min_verification_steps=2,
                                          deliverable_formats=("md", "pdf", "csv", "docx", "text"),
                                          summary_en="Operate, monitor, investigate or troubleshoot systems"),
    "data_analytical": FamilyProfile((90, 300), needs_table_material=True, needs_data_dictionary=True, min_calculations_per_task=1,
                                     deliverable_formats=("xlsx", "pdf", "csv", "md"), summary_en="Compute and interpret from data"),
    "financial": FamilyProfile((90, 180), needs_table_material=True, min_calculations_per_task=1,
                               deliverable_formats=("xlsx", "pdf", "docx"), summary_en="Financial analysis, accounting, credit"),
    "regulatory_compliance": FamilyProfile((90, 180), needs_sources=True, needs_decision_points=True,
                                           deliverable_formats=("pdf", "docx"), summary_en="Map findings to rules and corrective action"),
    "operational_coordination": FamilyProfile((60, 90), needs_table_material=True, needs_accepted_alternatives=True, needs_decision_points=True,
                                              deliverable_formats=("pdf", "docx", "xlsx"), summary_en="Plan, schedule and budget under constraints"),
    "creative_content": FamilyProfile((90, 240), needs_materials=False, needs_not_scored_boundary=True, needs_accepted_alternatives=True,
                                      deliverable_formats=("link", "pdf", "docx"), summary_en="Design or content with rationale"),
    "customer_service": FamilyProfile((45, 90), needs_decision_points=True, deliverable_formats=("text", "docx"),
                                      summary_en="Respond, resolve and follow up within a policy"),
    "engineering_quality": FamilyProfile((90, 180), needs_table_material=True, needs_data_dictionary=True, min_calculations_per_task=1,
                                         needs_decision_points=True, deliverable_formats=("xlsx", "pdf"),
                                         summary_en="Engineering calculations, quality and reliability analysis"),
}

DELIVERABLE_FORMATS = ("pdf", "docx", "xlsx", "csv", "md", "code_repository", "link", "text")
AI_USE_POLICIES = ("allowed_with_disclosure", "not_allowed", "company_decides")
MATERIAL_PROVENANCE = ("fictional", "public_dataset", "employer_provided")
SOURCE_KINDS = ("official", "press", "dataset", "internal_fictional")

RUBRIC_TOTAL = 100
CRITERIA_TOTAL = (3, 10)
CRITERIA_PER_WRITTEN_TASK = (2, 5)
CRITERION_POINTS = (5, 40)
LEVEL_KEYS = ("0", "1", "2", "3", "4")
WINDOW_HOURS = (24, 168)
MIN_SCENARIO_WORDS = 40
READY_OVERALL = 75
READY_DIMENSION = 50

DIMENSIONS = (
    "completeness", "relevance", "skill_coverage", "realism", "difficulty", "clarity", "data_sufficiency", "measurability",
    "rubric_quality", "scoring_consistency", "reference_consistency", "separation", "integrity", "language",
)


@dataclass(frozen=True)
class Rule:
    dimension: str
    severity: Literal["error", "warning"]
    en: str


RULES: dict[str, Rule] = {
    "brief_field_missing": Rule("completeness", "error", "A required field of the candidate brief is empty"),
    "guide_section_missing": Rule("completeness", "error", "A required section of the assessor guide is empty"),
    "no_tasks": Rule("completeness", "error", "The assessment has no tasks"),
    "no_materials": Rule("data_sufficiency", "error", "This job family needs materials and there are none"),
    "no_table_material": Rule("data_sufficiency", "error", "This job family needs at least one table of data"),
    "data_dictionary_missing": Rule("data_sufficiency", "error", "A table doesn't describe its columns with meaning and unit"),
    "material_unknown": Rule("data_sufficiency", "error", "A task or calculation names a material that doesn't exist"),
    "calculation_input_missing": Rule("data_sufficiency", "error", "A calculation's input isn't in the materials"),
    "calculations_missing": Rule("reference_consistency", "error", "An analysis task has no calculation behind its reference figures"),
    "reference_check_failed": Rule("reference_consistency", "error", "A reference figure recomputed from the materials doesn't match the guide"),
    "task_without_solution": Rule("reference_consistency", "error", "A task has no reference solution or expected outputs"),
    "objective_answer_invalid": Rule("reference_consistency", "error", "An objective question's answer isn't one of its options"),
    "task_without_deliverable": Rule("measurability", "error", "A task has no deliverable"),
    "deliverable_unused": Rule("measurability", "error", "A deliverable is answered by no task"),
    "deliverable_format_invalid": Rule("measurability", "error", "A deliverable's format isn't one MIDAN accepts"),
    "rubric_total_not_100": Rule("rubric_quality", "error", "The rubric's points don't sum to 100"),
    "criteria_count_out_of_range": Rule("rubric_quality", "error", "The number of criteria is outside the standard's range"),
    "criterion_points_out_of_range": Rule("rubric_quality", "error", "A criterion's points are outside 5–40"),
    "criterion_levels_incomplete": Rule("rubric_quality", "error", "A criterion lacks distinct descriptors for every level 0–4"),
    "criterion_without_evidence": Rule("rubric_quality", "error", "A criterion doesn't say what evidence the assessor must point to"),
    "written_task_few_criteria": Rule("rubric_quality", "error", "A written task has fewer than 2 criteria"),
    "duplicate_criterion": Rule("rubric_quality", "warning", "Two criteria have the same description"),
    "task_weight_mismatch": Rule("scoring_consistency", "error", "A task's weight isn't the sum of its criteria's points"),
    "level_scale_invalid": Rule("scoring_consistency", "error", "A levelled criterion's maximum isn't 4"),
    "pass_mark_set": Rule("scoring_consistency", "error", "The guide sets a pass mark; MIDAN sets none"),
    "requirement_not_measured": Rule("skill_coverage", "error", "A mandatory responsibility is measured by no task and criterion"),
    "skill_not_measured": Rule("skill_coverage", "error", "A required skill is measured by no task"),
    "task_not_mapped": Rule("skill_coverage", "error", "A task measures no stated responsibility or skill"),
    "unknown_id": Rule("skill_coverage", "error", "A task names a responsibility or skill the job doesn't state"),
    "context_ignored": Rule("relevance", "error", "The stated company type or sector isn't reflected in the company context"),
    "job_not_reflected": Rule("relevance", "warning", "The scenario doesn't mention the job or its responsibilities"),
    "not_fictional": Rule("realism", "error", "The company context doesn't say the company is fictional"),
    "scenario_too_short": Rule("realism", "error", "The scenario is too short to place the candidate in real work"),
    "window_out_of_range": Rule("realism", "error", "The window is outside 24–168 hours"),
    "placeholder_text": Rule("realism", "error", "Placeholder text is left in the assessment"),
    "effort_out_of_range": Rule("difficulty", "warning", "The effort is outside the family's range for this level"),
    "few_decision_points": Rule("difficulty", "warning", "A senior or lead assessment has fewer than two decision points"),
    "decision_points_missing": Rule("difficulty", "error", "This job family needs decision points in the guide"),
    "alternatives_missing": Rule("difficulty", "error", "This job family needs the accepted alternative solutions stated"),
    "verification_steps_missing": Rule("reference_consistency", "error", "The guide has fewer verification steps than this family needs"),
    "not_scored_boundary_missing": Rule("clarity", "error", "This job family needs the guide to say what is not scored"),
    "vague_instruction": Rule("clarity", "warning", "An instruction uses unbounded wording"),
    "instructions_unbalanced": Rule("clarity", "warning", "The Arabic and English instructions differ a lot in length"),
    "instruction_too_short": Rule("clarity", "error", "A task's instructions are too short to act on"),
    "assessor_content_exposed": Rule("separation", "error", "Assessor-only content appears in candidate-facing text"),
    "regulatory_claim_unsourced": Rule("integrity", "error", "A law, regulation or authority is referenced without a source"),
    "source_unverified": Rule("integrity", "warning", "A cited source hasn't been verified; a specialist must check it before use"),
    "source_invalid": Rule("integrity", "error", "A source lacks a kind, or a verified source lacks its access date"),
    "material_unsourced": Rule("integrity", "error", "Material presented as real has no source (or a public dataset no licence)"),
    "personal_attribute": Rule("integrity", "error", "A task asks about a personal attribute"),
    "language_missing": Rule("language", "error", "A candidate-facing field lacks its Arabic or English text"),
    "not_standardized": Rule("completeness", "error", "No assessor guide: this draft wasn't generated under the standard"),
}


def effort_range(family: str, level: str | None) -> tuple[int, int]:
    """The family's range, narrowed to the lower or upper part for the level: entry/junior lower 60%, senior/lead upper 60%."""
    low, high = FAMILIES[family].effort_minutes
    span = high - low
    if level in ("entry", "junior"):
        return low, round(low + span * 0.6)
    if level in ("senior", "lead"):
        return round(low + span * 0.4), high
    return low, high


@dataclass
class Requirements:
    """What a package must carry: the union over its primary and secondary families."""
    families: list[str] = field(default_factory=list)
    needs_materials: bool = False
    needs_table_material: bool = False
    needs_data_dictionary: bool = False
    min_calculations_per_task: int = 0
    min_verification_steps: int = 0
    needs_decision_points: bool = False
    needs_accepted_alternatives: bool = False
    needs_sources: bool = False
    needs_not_scored_boundary: bool = False


def requirements_for(primary: str, secondary: list[str] | None = None) -> Requirements:
    families = [primary, *[f for f in (secondary or []) if f != primary and f in FAMILIES]]
    out = Requirements(families=families)
    for name in families:
        p = FAMILIES[name]
        out.needs_materials |= p.needs_materials
        out.needs_table_material |= p.needs_table_material
        out.needs_data_dictionary |= p.needs_data_dictionary
        out.min_calculations_per_task = max(out.min_calculations_per_task, p.min_calculations_per_task)
        out.min_verification_steps = max(out.min_verification_steps, p.min_verification_steps)
        out.needs_decision_points |= p.needs_decision_points
        out.needs_accepted_alternatives |= p.needs_accepted_alternatives
        out.needs_sources |= p.needs_sources
        out.needs_not_scored_boundary |= p.needs_not_scored_boundary
    return out
