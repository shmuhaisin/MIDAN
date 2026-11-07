"""A small, complete package that meets the MIDAN Assessment Standard, for tests only. Everything in it is invented for these
tests: it is not a reference package, not MIDAN output, and not an assessment to give anyone."""

import copy

JOB = {
    "title_ar": "محلل مخزون", "title_en": "Inventory Analyst",
    "description_en": "Reconciles stock counts and reports shortages.",
    "requirements": [
        {"id": "r1", "requirement_type": "responsibility", "description_en": "Reconcile counted stock with the system", "is_mandatory": True},
        {"id": "r2", "requirement_type": "daily_task", "description_en": "Report shortages to the store manager", "is_mandatory": True},
    ],
    "required_skills": [{"id": "s1", "slug": "spreadsheets", "name_ar": "الجداول", "name_en": "Spreadsheets"}],
    "company_type": "sme", "sector": "wholesale_retail", "experience_level": "junior",
}

ROWS = [
    {"sku": "A-100", "system_qty": 40, "counted_qty": 40, "status": "ok"},
    {"sku": "A-101", "system_qty": 25, "counted_qty": 19, "status": "short"},
    {"sku": "A-102", "system_qty": 12, "counted_qty": 12, "status": "ok"},
    {"sku": "A-103", "system_qty": 30, "counted_qty": 22, "status": "short"},
    {"sku": "A-104", "system_qty": 8, "counted_qty": 9, "status": "over"},
    {"sku": "A-105", "system_qty": 50, "counted_qty": 47, "status": "short"},
]


def _levels(lang: str, what: str) -> dict[str, str]:
    if lang == "en":
        return {"0": f"No evidence of {what}", "1": f"{what} attempted with major errors", "2": f"{what} partly correct",
                "3": f"{what} correct with minor gaps", "4": f"{what} complete and traceable"}
    return {"0": f"لا دليل على {what}", "1": f"{what} بأخطاء جوهرية", "2": f"{what} صحيح جزئيًا",
            "3": f"{what} صحيح مع نقص بسيط", "4": f"{what} كامل وقابل للتتبع"}


def _criterion(ar: str, en: str, points: float) -> dict:
    return {"description_ar": ar, "description_en": en, "max_score": 4, "weight": points, "points": points,
            "levels_ar": _levels("ar", ar), "levels_en": _levels("en", en),
            "evidence_en": f"The reconciliation file, section on: {en}", "evidence_ar": f"ملف المطابقة، الجزء الخاص بـ: {ar}"}


PACKAGE = {
    "job_family": "data_analytical",
    "candidate_brief": {
        "company_context_ar": "متجر الواحة منشأة صغيرة أو متوسطة افتراضية تعمل في تجارة التجزئة ولها ثلاثة فروع. الشركة خيالية لأغراض التقييم.",
        "company_context_en": "Al Waha Stores is a fictional small or medium enterprise in retail with three branches, invented for this assessment.",
        "scenario_ar": ("أنت محلل مخزون في متجر الواحة. أجرى فريق الفرع الأول جردًا فعليًا نهاية الأسبوع، ويريد مدير المتجر أن يعرف أين يختلف "
                        "الجرد عن رصيد النظام وما الذي يجب فعله قبل طلب البضاعة القادم. لديك جدول الجرد كاملًا وسياسة المتجر في التعامل مع "
                        "الفروقات. اكتب ما وجدته بطريقة يستطيع المدير أن يعمل بها مباشرة."),
        "scenario_en": ("You are the inventory analyst at Al Waha Stores. The first branch's team did a physical count at the end of the week, "
                        "and the store manager wants to know where the count differs from the system balance and what must happen before "
                        "the next stock order. You have the full count table and the store's policy for handling differences. Write up what "
                        "you find so the manager can act on it directly."),
        "objective_ar": "مطابقة الجرد مع النظام وتحديد النواقص وما يلزم بشأنها.",
        "objective_en": "Reconcile the count with the system, identify shortages and what to do about them.",
        "rules_ar": ["اعتمد على الجدول المرفق فقط.", "اذكر أي افتراض إضافي صراحة.", "اعرض خطوات الحساب."],
        "rules_en": ["Use only the attached table.", "State any extra assumption explicitly.", "Show how you calculated each figure."],
        "tools_ar": ["أي برنامج جداول بيانات"], "tools_en": ["Any spreadsheet program"],
        "assumptions_policy_ar": "إذا نقصت معلومة فاذكرها وما يلزم لتأكيدها، ولا تخترع قيمة.",
        "assumptions_policy_en": "If information is missing, say so and what would confirm it; don't invent a value.",
        "ai_use_policy": "company_decides",
        "submission_format_ar": "ملف جداول بيانات واحد مع ملخص قصير.",
        "submission_format_en": "One spreadsheet file with a short summary.",
        "effort_minutes": 120, "deadline_hours": 72,
        "deliverables": [{"id": "reconciliation", "title_ar": "ملف المطابقة", "title_en": "Reconciliation file", "format": "xlsx",
                          "description_ar": "جدول الفروقات وملخص للمدير", "description_en": "Table of differences and a summary for the manager"}],
    },
    "materials": [{
        "id": "stock_count", "title_ar": "جدول الجرد", "title_en": "Stock count", "kind": "table", "provenance": "fictional",
        "description_ar": "رصيد النظام والكمية المعدودة لكل صنف", "description_en": "System balance and counted quantity per item",
        "columns": [
            {"name": "sku", "meaning_en": "Item code", "meaning_ar": "رمز الصنف", "unit": "code"},
            {"name": "system_qty", "meaning_en": "Quantity in the system", "meaning_ar": "الكمية في النظام", "unit": "units"},
            {"name": "counted_qty", "meaning_en": "Quantity counted", "meaning_ar": "الكمية المعدودة", "unit": "units"},
            {"name": "status", "meaning_en": "Count status", "meaning_ar": "حالة الجرد", "unit": "label"},
        ],
        "rows": ROWS,
    }],
    "tasks": [
        {"task_type": "file_submission", "title_ar": "مطابقة الجرد", "title_en": "Reconcile the count",
         "instructions_ar": "١. احسب الفرق بين الكمية المعدودة ورصيد النظام لكل صنف. ٢. حدد الأصناف الناقصة ومجموع النقص بالوحدات.",
         "instructions_en": "1. Calculate the difference between counted and system quantity for each item. 2. List the short items and the total shortage in units.",
         "weight": 45, "requirement_ids": ["r1"], "skill_ids": ["s1"], "deliverable_ids": ["reconciliation"], "material_ids": ["stock_count"],
         "criteria": [_criterion("صحة حساب الفروقات", "Correct differences", 25), _criterion("تحديد الأصناف الناقصة", "Short items identified", 20)]},
        {"task_type": "written_case_study", "title_ar": "ملخص للمدير", "title_en": "Summary for the manager",
         "instructions_ar": "اكتب ملخصًا من خمسة أسطر للمدير: الأصناف الناقصة، أثرها على الطلب القادم، وما يجب تأكيده قبل الطلب.",
         "instructions_en": "Write a five-line summary for the manager: the short items, their effect on the next order, and what to confirm before ordering.",
         "weight": 35, "requirement_ids": ["r2"], "skill_ids": ["s1"], "deliverable_ids": ["reconciliation"],
         "criteria": [_criterion("وضوح التوصية", "Clear recommendation", 20), _criterion("تحديد ما يلزم تأكيده", "What to confirm is named", 15)]},
        {"task_type": "objective_questions", "title_ar": "أسئلة الجرد", "title_en": "Count questions",
         "instructions_ar": "اختر الإجابة الصحيحة لكل سؤال اعتمادًا على جدول الجرد المرفق فقط.",
         "instructions_en": "Choose the correct answer to each question using only the attached stock count table.",
         "weight": 20, "requirement_ids": ["r1"], "skill_ids": ["s1"],
         "questions": [{"id": "q1", "prompt_ar": "أي صنف كميته المعدودة أكبر من رصيد النظام؟", "prompt_en": "Which item was counted above its system balance?",
                        "options": [{"id": "a", "label_ar": "A-104", "label_en": "A-104"}, {"id": "b", "label_ar": "A-100", "label_en": "A-100"}], "answer": "a"}]},
    ],
    "assessor_guide": {
        "language": "both",
        "scope_and_limits": "Measures reconciliation of a small count. Not a stock audit; results are not used for a real store.",
        "task_solutions": [
            {"task_ref": 1, "reference_solution": "Three items are short; the total shortage is the sum of their differences.",
             "expected_outputs": ["Per-item difference", "List of short items", "Total shortage"],
             "accepted_alternatives": ["Differences computed as system minus counted, if the sign is explained"],
             "common_mistakes": ["Counting the over item as short"]},
            {"task_ref": 2, "reference_solution": "Recommends recounting short items before ordering and confirming open transfers.",
             "expected_outputs": ["Short items named", "Effect on order", "What to confirm"]},
        ],
        "calculations": [
            {"id": "c1", "task_ref": 1, "label": "Number of short items", "formula": "count where status = short",
             "inputs": ["stock_count.status"], "result": "3", "check": {"op": "count", "material": "stock_count", "where": {"status": "short"}, "expect": 3}},
            {"id": "c2", "task_ref": 1, "label": "Total system quantity of short items", "formula": "sum system_qty where status = short",
             "inputs": ["stock_count.system_qty", "stock_count.status"], "result": "105",
             "check": {"op": "sum", "material": "stock_count", "column": "system_qty", "where": {"status": "short"}, "expect": 105}},
        ],
        "decision_points": [{"task_ref": 2, "point": "Whether to order before recounting", "accepted": "Recount first, or order with a stated buffer"}],
        "verification_steps": ["Recompute the differences from the table", "Check the total against the guide"],
        "boundaries": ["The score supports a person's decision; it is not an automatic rejection."],
        "sources": [],
        "approval_notes": ["A retail operations specialist reviews the reference solution before use."],
        "skill_map": [{"task_ref": 1, "how_measured": "Spreadsheet formulas for differences"}, {"task_ref": 2, "how_measured": "Summary built from the table"}],
        "pass_mark": None,
    },
}


def job() -> dict:
    return copy.deepcopy(JOB)


def package() -> dict:
    return copy.deepcopy(PACKAGE)
