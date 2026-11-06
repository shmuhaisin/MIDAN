"""Approved task templates. In this version they are Midan drafts awaiting domain expert review."""

SAMPLE_CSV = "month,region,orders,returns,revenue\nJan,Riyadh,420,21,126000\nJan,Jeddah,310,40,89900\nFeb,Riyadh,455,18,138775\nFeb,Jeddah,298,52,83440\nMar,Riyadh,470,23,145700\nMar,Jeddah,280,61,75600\n"

TEMPLATES = {
    "case_study": {
        "task_type": "written_case_study",
        "review_status": "draft",
        "title_ar": "دراسة حالة من صلب الدور",
        "title_en": "A case study from the role",
        "instructions_ar": "المسؤولية: {responsibility_ar}\n\nتخيّل أنك استلمت هذه المسؤولية في أول أسبوع لك، وظهرت مشكلة تعطل سير العمل. اشرح كيف تحدد السبب، وماذا تفعل أولًا، وكيف تعرف أن الحل نجح.",
        "instructions_en": "The responsibility: {responsibility_en}\n\nImagine you took on this responsibility in your first week, and a problem is blocking the work. Explain how you would find the cause, what you would do first, and how you would know the fix worked.",
    },
    "data_analysis": {
        "task_type": "data_analysis",
        "review_status": "draft",
        "title_ar": "تحليل بيانات مرفقة",
        "title_en": "Analyze the supplied data",
        "instructions_ar": "هذه بيانات خيالية لربع سنة. اذكر أهم نمط تلاحظه، وادعمه بالأرقام، وقدّم توصية واحدة للإدارة.",
        "instructions_en": "This is fictional data for one quarter. State the most important pattern you see, back it with numbers, and give management one recommendation.",
        "config": {"dataset_csv": SAMPLE_CSV, "dataset_name": "quarterly-orders.csv"},
    },
    "objective": {
        "task_type": "objective_questions",
        "review_status": "draft",
        "title_ar": "أسئلة قصيرة في طريقة العمل",
        "title_en": "Short questions on how you work",
        "instructions_ar": "اختر الإجابة الأنسب لكل سؤال.",
        "instructions_en": "Choose the best answer for each question.",
        "config": {
            "questions": [
                {
                    "id": "q1",
                    "prompt_ar": "وجدت خطأ في بيانات سلّمها زميلك قبل موعد مهم. ما الخطوة الأولى؟",
                    "prompt_en": "You find an error in data a colleague delivered before an important deadline. What comes first?",
                    "options": [
                        {"id": "a", "label_ar": "أتجاهله حتى ينتهي الموعد", "label_en": "Ignore it until the deadline passes"},
                        {"id": "b", "label_ar": "أتحقق من أثره وأبلغ زميلي والمعنيين", "label_en": "Check its impact and tell my colleague and those affected"},
                        {"id": "c", "label_ar": "أعدّله بصمت دون إبلاغ أحد", "label_en": "Quietly change it without telling anyone"},
                    ],
                },
                {
                    "id": "q2",
                    "prompt_ar": "طُلب منك رأي في قرار دون بيانات كافية. ماذا تفعل؟",
                    "prompt_en": "You're asked for a view on a decision without enough data. What do you do?",
                    "options": [
                        {"id": "a", "label_ar": "أوضح ما أعرفه وما ينقصني، وأقترح طريقة لجمعه", "label_en": "Say what I know and what's missing, and suggest how to get it"},
                        {"id": "b", "label_ar": "أعطي إجابة واثقة حتى لا أبدو مترددًا", "label_en": "Give a confident answer so I don't look unsure"},
                        {"id": "c", "label_ar": "أرفض الإجابة", "label_en": "Refuse to answer"},
                    ],
                },
            ]
        },
        "answer_key": {"q1": "b", "q2": "a"},
    },
}

DATA_SKILL_SLUGS = {"data-analysis", "sql", "spreadsheets"}

# A written task built around one skill from the official sector workbooks. The skill name stays in Arabic in both
# languages, because the workbooks hold no English names and none is invented.
SKILL_TASK = {
    "task_type": "written_case_study",
    "title_ar": "تطبيق مهارة: {skill_ar}",
    "title_en": "Apply a skill: {skill_ar}",
    "instructions_ar": "المهارة: {skill_ar}\n{context_ar}\n\nصف موقفًا عمليًا من هذا الدور تحتاج فيه هذه المهارة، ثم اشرح خطواتك بالتفصيل، والأدوات أو المعايير التي تعتمد عليها، وكيف تتحقق من جودة النتيجة.",
    "instructions_en": "The skill: {skill_ar}\n{context_en}\n\nDescribe a practical situation in this role that calls for this skill, then explain your steps in detail, the tools or standards you would rely on, and how you would check the quality of the result.",
}
