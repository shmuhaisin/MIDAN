# MIDAN — Reference Assessment Library: Inventory

Written 2026-11-07 on branch `midan-assessment-intelligence`. This inventory records the **structure** of the reference packages
the owner provided: which kinds of document each package holds, how its rubric is built, and what it does well or leaves out.

**What this file deliberately does not contain.** The repository is public. Nothing here reproduces a reference package's text,
reference solution, answer key, expected figures, data rows or rubric descriptors. Criterion names are short English paraphrases,
weights are given because they are structure, not answers. The packages themselves are not in the repository and must not be
added to it: they stay with the owner (see `.gitignore` and `docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md`).

## 1. How the packages were read

- 23 reference archives were found; two of them (`SWE_Assessment_Simple.zip` and `SWE_Assessment_Simple (1).zip`) have the same
  SHA-256, so 22 distinct packages were extracted, each into its own new directory outside the repository (path-traversal entries
  refused, `__MACOSX` skipped). Nothing inside an archive was executed.
- PDFs were converted to text with `pypdf`; Arabic came out in visual order with presentation forms and was normalized (NFKC,
  run reversal) for reading. Arabic-Indic digits inside some lines stay digit-reversed after normalization, so figures were read
  with care and are not quoted here anyway.
- Workbooks were read with `openpyxl`; CSV files were profiled (rows, columns, header) only.
- The six Group 3 engineering PDFs contain no extractable text (they are page images). Their pages were viewed as images:
  Civil Engineer (candidate brief pages 1–2, assessor guide pages 1 and 3) and Maintenance Engineer (candidate brief page 1,
  assessor guide page 2) were read in full; the other four were read through their workbooks and README files, and their PDFs
  were checked for page count and template only.

## 2. Packages provided

The brief listed 16 packages in three groups. Six more arrived that the brief didn't list: the Group 3 engineering and real
estate packages. All 22 distinct packages are inventoried.

Document types: **C** candidate instructions · **D** data or reference material for the candidate · **A** assessor guide or answer
key (internal) · **R** assessor scoring workbook · **M** package README with distribution rules.

### 2.1 Technical (4)

| Package | Files (type) | Effort / window | Deliverable | Rubric | Scale |
| --- | --- | --- | --- | --- | --- |
| Software Engineer | Task and deliverables PDF (C), support guide Markdown (C), assessor-only PDF (A) | 6 h suggested, within 72 h of invitation (Riyadh time) | Repository link plus short written notes | 5 criteria: 20 / 25 / 25 / 20 / 10 | 0–4, `weight × level ÷ 4` |
| Data Analyst | Task PDF (C), sales CSV 20,281 rows × 28 columns (D), assessor-only PDF (A) | 5 h suggested, within 72 h | Analysis file plus management summary | 5 criteria: 20 / 25 / 20 / 20 / 15 | 0–4 |
| UI/UX Designer | Task PDF (C), assessor-only PDF (A) — no data file; the brief carries the scenario's constraints | 4 h suggested, within 72 h | Design file link plus rationale | 5 criteria: 25 / 25 / 20 / 20 / 10 | 0–4 |
| ML Engineer | Task PDF (C), public spam dataset CSV 4,601 rows × 59 columns (D), assessor-only PDF (A) | stated in the brief, within 72 h | Notebook or code plus written comparison | 6 criteria: 15 / 25 / 20 / 20 / 10 / 10 | 0–4 |

Traits worth keeping: a realistic product scenario with explicit constraints; required work numbered and each item observable;
mandatory rules stated as rules (for example a contrast ratio, a data-leakage prohibition); "different valid solutions are accepted"
written into the guide; numbered verification steps for the assessor; common mistakes listed; dataset licence and source noted
where the data is public.

### 2.2 Financial and regulatory (6 assessor guides)

| Package | Files | Rubric (4 criteria) | What the guide itself says is missing |
| --- | --- | --- | --- |
| Accountant | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | The input file it refers to is not attached; several figures can't be re-derived; one adjustment entry is left incomplete |
| Credit Analyst | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | No statements or balances to reproduce the ratios; thresholds need a credit expert's approval |
| Financial Analyst | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | Not all model inputs shown; results not fully reproducible |
| Trade Compliance | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | Cited regulations not linked to articles; every legal attribution needs specialist review |
| Consumer Protection | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | Regulatory references and penalties carried from the source without article or link |
| Data Analyst (commerce) | Assessor guide PDF (A), 3 pages | 40 / 25 / 20 / 15 | The source data file is not attached; reference patterns can't be checked |

These are guides only: no candidate brief and no data package arrived for any of them. Each one is honest about this — it lists
its own gaps, says no unified pass mark is set and that the result must not become an automatic rejection, and says what must
happen "before approval". The common rubric shape is: technical accuracy (40) · reading data and applicable rules (25) ·
detecting issues or risks (20) · documentation and clarity (15).

### 2.3 Tourism, events and guest services (6)

| Package | Files | Effort / window | Rubric (4 criteria) |
| --- | --- | --- | --- |
| Event Coordinator | Task instructions (C), data and references (D), assessor guide with answer key (A) — all PDF | 90 min suggested, within 72 h | 30 / 25 / 25 / 20 |
| Event Marketing Specialist | C, D, A | 90 min, 72 h | 25 / 30 / 25 / 20 |
| Content Producer | C, D, A | 90 min, 72 h | 30 / 30 / 25 / 15 |
| Reservations Agent | C, D, A | 60 min, 72 h | 40 / 25 / 20 / 15 |
| Tour Coordinator | C, D, A | 90 min, 72 h | 30 / 30 / 25 / 15 |
| Guest Experience Specialist | C, D, A | 60 min, 72 h | 35 / 25 / 25 / 15 |

The most complete set. Every package separates the three audiences into three files. The candidate file states the scenario,
the skills measured, effort as an estimate rather than a timer, the window, level, autosave and lock behaviour, one deliverable
file (PDF or Word, spreadsheet allowed for calculations), the attached files, and general rules: rely on the attached data, state
any extra assumption explicitly, show working, no extension without the company's approval, and the AI-use policy announced by
the company before the attempt. The data file holds every number the task needs, with explicit constraints (caps, minimums,
fixed fees, ratios). The guide restates the inputs, gives a reference solution with a comparison of options, a reference
schedule or log where relevant, supporting totals, scoring formulas, expected limits, "any other correct choice that meets every
constraint is accepted", the weighted rubric, the 0–4 scale, "no approved pass mark", and a sources section: each source dated
(accessed 7 November 2026), classified as an official text or a press report to be replaced by the official text, with the
article it supports and what it was used for — and a note when a policy is MIDAN's training policy rather than a regulation.

### 2.4 Group 3 engineering and real estate (6, not listed in the brief)

| Package | Version on file | Files | Rubric | Scale |
| --- | --- | --- | --- | --- |
| Civil Engineer | archive v0.2, README says 0.1 | Candidate brief PDF (C), input workbook: elements, review notes, data dictionary (D), assessor guide PDF (A), scoring workbook (R), README (M) | 40 / 25 / 20 / 15 (as fractions) | 0–4 |
| Project Planner | 0.1 | C, D (activities, delay scenario, dictionary), A, R, M | 25 / 35 / 25 / 15 | 0–4 |
| Real Estate Analyst | 0.1 | C, D (transactions, quarterly summary, dictionary), A, R, M | 30 / 25 / 25 / 20 | 0–4 |
| Production Engineer | 0.1 | C, D (daily production, KPI calculations, downtime notes, dictionary), A, R, M | 30 / 25 / 20 / 25 | 0–4 |
| Quality Engineer | 0.1 | C, D (dimension samples, lot inspection, defect definitions, dictionary), A, R, M | 25 / 25 / 30 / 20 | 0–4 |
| Maintenance Engineer | 0.1 | C, D (failure log, asset context, dictionary), A, R, M | 25 / 25 / 30 / 20 (as points) | **1–4** with per-level descriptors |

Traits worth keeping: a **data dictionary** sheet with units; **review notes** that deliberately leave information out and ask the
candidate what must be confirmed rather than invented ("don't assume a dimension that isn't given"); a separate **scoring
workbook** for the assessor (criterion, weight, level, weighted score, evidence notes); a README that says which file may be
shared with candidates and when, that the case is fictional and not issued by any named authority, that no pass mark is set, and
that the task needs a specialist review and a small pilot before use.

## 3. Cross-package observations

### 3.1 What every complete package has

1. A candidate-facing document that is self-sufficient: scenario, objective, required work as numbered observable outputs,
   effort, window, deliverable format, rules and assumptions policy.
2. A data package that holds every input the task needs, marked as fictional, with units and constraints.
3. An internal guide marked "not to be sent to the candidate", holding: scope and limits; the reference solution; the
   calculations (formula and inputs) behind it; decision points and accepted alternatives; expected warnings or common mistakes;
   the weighted rubric; the scale; approval notes; sources.
4. Weights that sum to 100, a 0–4 level scale (one exception), and the score formula `weight × level ÷ 4`.
5. No pass mark, and an explicit statement that the score must not drive an automatic rejection.

### 3.2 Inconsistencies found (to avoid in MIDAN's standard)

- **Scale:** one package scores 1–4 with no "no evidence" level; all others use 0–4. A criterion with no evidence must be able to
  score 0.
- **Weight notation:** fractions (0.4) in some workbooks, percentages or points elsewhere. MIDAN uses integer points summing to 100.
- **Versioning:** an archive labelled v0.2 contains a README that says 0.1.
- **Missing parts:** six financial guides arrived without candidate briefs or data, and three of them say their own figures can't
  be reproduced. A guide whose reference answers can't be re-derived from the data package fails MIDAN's data-sufficiency rule.
- **Level descriptors:** most packages give one shared scale for all criteria; only the scoring workbooks of one package give
  criterion-specific descriptors per level. Criterion-specific descriptors make scoring more consistent between assessors.
- **Evidence:** the scoring workbooks have an "evidence notes" column, but no package says, per criterion, which evidence in the
  submission an assessor must point to. MIDAN requires it.
- **Legal and regulatory claims:** the strongest packages cite an official text, article and access date and separate MIDAN's
  training policy from regulation; the weakest carry regulatory attributions and penalties with no article or link and say so.

### 3.3 Variation by job family (why one format can't fit all)

| Family | Typical work product | Effort | What the guide must carry |
| --- | --- | --- | --- |
| Technical build (SWE, ML) | Working code or model plus a short rationale | 4–6 h within 72 h | Verification steps that can be run, acceptance of different valid designs, leakage and security checks |
| Analytical (data, real estate, financial analysis) | Computed indicators, interpretation, recommendation | 1.5–5 h | Formulas with inputs, reference figures re-derivable from the data, data-quality traps |
| Financial and credit | Ratios, entries, a recommendation or decision memo | 1.5–3 h | Calculations, thresholds as assumptions needing expert approval, no real-entity data |
| Regulatory and compliance | Findings mapped to rules, corrective actions | 1.5–3 h | Every rule cited with an official source and its verification status; no legal advice |
| Operational coordination (events, tours, reservations) | Plan, schedule, budget, risk log under explicit constraints | 60–90 min | A reference solution satisfying every constraint, plus "any other solution meeting all constraints is accepted" |
| Creative and content (UI/UX, content, marketing) | Design or content pieces with rationale | 90 min – 4 h | Mandatory constraints (accessibility, brand, rights), what is *not* scored (visual polish where irrelevant) |
| Customer-facing service (guest experience) | Response, actions, follow-up | 60 min | Policy facts the response must respect, tone and accuracy descriptors |
| Engineering and quality (civil, planning, production, quality, maintenance) | Calculations, analysis, plan, safety awareness | 90 min | Data dictionary, deliberate gaps to be flagged not invented, safety limits |

## 4. How this inventory was used

The standard in `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md` was derived from section 3: the common skeleton becomes the
mandatory sections, the inconsistencies become validation rules, and the family table becomes the job-family profiles in
`services/ai/midan_ai/standard.py`. No reference package's content was copied into the standard, the code, the tests or the
benchmark; the quality evaluator never compares a draft with a reference package (see
`docs/assessment/GENERATION_QUALITY_BENCHMARK.md`).
