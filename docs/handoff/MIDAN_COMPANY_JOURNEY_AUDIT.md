# MIDAN company journey: audit (2026-11-10)

Branch `feature/midan-company-journey`, from `integration/midan-email-cloud-fixes` at `b6d7c72`. This is a reading of the
code, checked against the machine it runs on. Nothing here was changed in Supabase Cloud. "Verified" in older handoffs is
not repeated here unless the code and this machine support it.

Legend: **WORKING** (built end to end, with tests in the repo) · **PARTIAL** (built, but a required part is missing or
not connected) · **BROKEN** (exists, does not do what it claims here) · **MISSING** (not built) · **MOCKED** (a stand-in or
illustration, not connected to real data or services).

## Findings that change what can be claimed

1. **The Hugging Face CV model does not run on this Windows machine.** The model is `intfloat/multilingual-e5-base`
   (`services/ai/midan_ai/matching.py`, `E5Local`, `EMBEDDING_PROVIDER=e5-local`). The shared venv
   (`MIDAN-feature-midan-employer-experience/MIDAN/.local/ai-venv`) has no `sentence-transformers` or `torch`. No model
   files exist on disk, and `EMBEDDING_PROVIDER` is not set in the demo `.env`. `similarity_backend()` therefore returns
   `Lexical`, so the demo's CV matching is the word-overlap fallback. Its provenance says so honestly (`provider: lexical`).
   The e5 verification in `MIDAN_INTEGRATED_PLATFORM.md` (2026-11-09) was done on a different machine.
   **Status: BROKEN here (the code is correct, but the dependency is absent).** Installing it needs a download (about 2 GB),
   which needs the owner's approval.
2. **No approved rule combines stage scores.** The repository defines three separate rules:
   - CV match (`matching.py`): mandatory requirements count twice; matched = 1, partial = 0.5, missing = 0; needs-review is
     left out; the result is a percentage.
   - Assessment (MAS-1.0, `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`): criterion = points × level ÷ 4, summed to 100.
   - Interview feedback: competency ratings from 1 to 4 and a recommendation, with no aggregate.

   Nothing in `docs/DECISIONS.md` weights them against each other. An "overall %" or a cumulative ranking that combines
   them would invent weights. **This needs an owner decision** (asked).
3. **Google Calendar cannot create a real event here.** The client exists, and so do its idempotent ids, retry and
   cancellation (`apps/api/src/interviews/video-and-calendar.ts`). But `GOOGLE_CALENDAR_REFRESH_TOKEN` is empty in the
   demo `.env`, so `configured` is false and every interview records `calendar_status = not_configured`.
4. **The homepage hiring metric.** The home page at `b6d7c72` (`app/[locale]/page.tsx`, `components/journey/*`,
   `components/interactive.tsx`, the `home` and `journey` messages) shows no hiring count or rate. The only figures are the
   labelled illustrative previews ("3 of 4 skills", "Due in 3 days", a sample calendar). The element the brief means is
   unidentified (asked).

## Phase map

### 1. Company identity and workspace: PARTIAL
| Part | Where | Status |
| --- | --- | --- |
| 10 registry employers | `employer_registry`, `employer_aliases`, `import_runs` (migration `20261105231005`, `20261106140000`) | WORKING (imported locally; read-only data) |
| One workspace per registry employer, created on platform-admin approval, shared by several approved representatives | `20261112090000_employer_access_requests.sql` (`admin_decide_employer_access`, unique index per employer) | WORKING locally. **Not applied in Cloud** (500 there, known) |
| Official name on the workspace | the approval copies `name_ar` and `name_en` from the registry | WORKING |
| Sector, entity type and website on the workspace | the registry holds `sector`, `entity_type` and `official_website`; the approval copies none of them. `organizations.company_type` and `organization_branding.industry` stay empty | **PARTIAL**: assessment generation then has no company type unless the employer sets one |
| Logo, colours, welcome | `organization_branding` + `PATCH /organizations/:id/branding`, `POST .../branding/logo`, settings page | WORKING (employer-entered). The registry holds no logos or colours, and none may be invented |
| Branding on the candidate's assessment | `experience/[orgSlug]/[jobSlug]/[version]` + `attempts.controller.ts` | WORKING |
| Branding on the public job posting | `GET /jobs/:id` (`PUBLIC_JOB`) returns no branding; `opportunities/[id]` shows none | **PARTIAL** |
| Branding on assessment documents (assessor guide, candidate brief) | the generation sends company type and sector only, and deliberately keeps the company's name out (`schemas.py:62`) | PARTIAL (by design: the scenario's company is fictional) |
| No mixing of identities | RLS on `org_id` everywhere, with `requireRole` per request | WORKING |
| Homepage metric | see finding 4 | unidentified |

### 2. Job creation and requirements: WORKING
| Part | Where | Status |
| --- | --- | --- |
| Job details, bilingual, with translation | `POST/PATCH /organizations/:id/jobs`, `translation.controller.ts`, `components/bilingual.tsx` | WORKING |
| Structured requirements; add, edit, retire | `requirements.controller.ts`, `job_requirements.review_status` | WORKING |
| Skill suggestions from the HR sector workbooks (reference skills) with a reason each | `POST jobs/:id/analyses/suggest` → AI `/skills/suggest` (e5 shortlist, then the model with reasons; without the model the shortlist is labelled) and `20261110090000_job_skill_suggestions.sql` | WORKING (with lexical similarity here, see finding 1) |
| Employer adds, edits, removes and accepts; custom skills | `job-skills.controller.ts`, `analysis.controller.ts` (accept, dismiss) | WORKING |
| Approved requirements are the source of truth | matching, generation and the public job all read `review_status = 'approved'` only | WORKING |

### 3. Company-contextualized assessment: PARTIAL
| Part | Where | Status |
| --- | --- | --- |
| Generation from approved requirements + reference skills + level | `assessments.controller.ts` `generate` → `loadJobInput` → AI Graph A `make_generator` (Groq) or templates labelled "Demo mode" | WORKING |
| Business domain | `company_type` + `sector` reach the prompt; the company's name doesn't. `company_type` is empty for registry workspaces (phase 1) | PARTIAL |
| Tasks, expected outputs, rubric, assessor guide; MAS-1.0 quality gate | `quality.py`, `assessment-quality.ts`, `20261107160000` | WORKING |
| Employer edits, reviews and approves before publishing; audit of edits | `20261107150000_assessment_editing_policy.sql`, change review page | WORKING |
| Company branding on the assessment | candidate experience is branded (phase 1) | WORKING |

### 4. Publish, apply, CV: PARTIAL
| Part | Where | Status |
| --- | --- | --- |
| Organization verification gates publishing | `guard_job_publication_org` | WORKING |
| **A job can be published while its assessment is still a draft** | `PATCH /organizations/:id/jobs/:jobId/status` checks nothing about assessments | **BROKEN** against "publish only after review" (gap 1 in `MIDAN_INTEGRATED_PLATFORM.md`) |
| An assessment approved after people applied isn't assigned to them | trigger `assign_published_assessments` runs only on application insert | **PARTIAL** (gap 2; staff can invite by hand) |
| Candidate views, applies with a CV snapshot, withdraws | `jobs.controller.ts` `apply`, storage copy, `applications` | WORKING |
| Job, candidate and workspace associations | `applications.org_id` from the job; RLS | WORKING |

### 5. ATS evaluation: PARTIAL
| Part | Where | Status |
| --- | --- | --- |
| CV against approved requirements with the HF model, explaining matches and gaps | `GET .../applications/:id/match` → AI `/match/requirements` (`matching.py`), evidence from the application snapshot; staff confirm or correct (`application_match_reviews`) | Code WORKING; **here it runs lexical** (finding 1) |
| CV analysis (extraction, structure, redaction) | AI `/cv/analyze` (Groq, local fallback) | WORKING; not the scoring model |
| Assessment scored against its rubric | Graph B (`evaluation.py`): model proposals, the person scores, approves and releases (`evaluations.controller.ts`) | WORKING |
| Combined score with existing rules | none exist (finding 2) | **MISSING, needs an owner decision** |
| Stage scores kept distinct, pending stages handled | CV and assessment are kept apart; no per-applicant summary holds both | PARTIAL |
| CV score persisted | computed on each request, never stored, so it can't be ranked or re-ranked without recomputing for every applicant | **MISSING** |

### 6. Ranking of all applicants: MISSING
The job page has a comparison table (`jobs/[jobId]/page.tsx`, "compare") of **reviewed assessments only**, unsorted, with no
CV score and no stage. The candidates page lists applications. There is no per-job ranking of all applicants with CV
score, assessment score, breakdown, strengths and gaps, rank and stage. Manual shortlisting exists
(`set_application_status`, undoable), and nothing auto-rejects or auto-hires: WORKING.

### 7. Interviews: PARTIAL
| Part | Where | Status |
| --- | --- | --- |
| Interview needs a shortlisted application | `guard_interview_shortlist` (`20261111100000`) | WORKING |
| Schedule, reschedule, cancel, candidate accept or decline, status history | `interviews.controller.ts`, `interview_events`, notifications | WORKING |
| Google Calendar event and invitations | `CalendarClient`: deterministic event id (no duplicates), 409 → update, `calendar_status`, retry endpoint, cancel | Code WORKING against a stand-in; **not configured here** (finding 3). Never run for real |
| Daily video | `DailyClient`, tokens scoped per room and participant | Key present in the demo `.env`; not part of this audit's test |

### 8. AI interview questions per candidate: MISSING
No endpoint, AI function, table or screen. (`MIDAN_EMPLOYER_CURRENT_STATE.md` §7 lists it as not built.)

### 9. Post-interview evaluation form: PARTIAL
`interview_feedback` (`20261108090300`) + `PUT .../interviews/:id/feedback` + `applicant-review.tsx`: participants only,
draft then submit, every competency rated 1–4 before submitting (database guard), audit trigger `write_audit`, immutable
once submitted. **The form starts empty**: the interviewer types the competencies. It isn't AI-generated or
candidate-specific, and a submission updates no cumulative evaluation.

### 10. Final cumulative evaluation and re-ranking: MISSING
It depends on phase 5's combination rule (finding 2) and on phase 6. The hiring decision is manual (`hiring_outcomes`,
`set_application_status`; hired is final; a hire needs a shortlist): WORKING.

### 11. Candidate development report: PARTIAL
The released assessment report (`reports/[attemptId]`), with skill levels and next-level descriptors and without reviewer
notes, and the career development pages exist. In-app notifications are the approved channel; there is no transactional
email sender (only Supabase Auth email). There is no report that brings CV evidence, the assessment and the interview
together, and nothing is sent after a decision.

## Cross-cutting
- Arabic and English: every screen uses next-intl, with `ar` and `en` messages. WORKING.
- Workspace isolation and authorization: RLS plus `requireRole`; `db.asUser` runs as `authenticated`. WORKING.
- Audit: `audit_logs`, `write_audit` triggers, assessment change log. WORKING.
- No fabricated AI: demo mode is labelled, the matching fallback is recorded in provenance, and translation refuses
  without a model. WORKING.

## Fix order (to do on this branch)
1. Publishing requires an approved and published assessment (phase 4). (Assigning later approvals automatically was
   tried and removed: it conflicts with the designed invitation to a chosen assessment, and the publish rule covers new
   jobs.)
2. Registry workspaces inherit the registry's sector, entity type and website (phase 1 → phase 3 context). The public job
   shows the organization's logo and colours (phase 1).
3. Per-job applicant ranking (phase 6): every non-withdrawn applicant, with the CV score from the matching model,
   assessment score, stage and strengths and gaps. The combined order waits for the owner's rule (finding 2).
4. AI interview questions (phase 8) and an AI-proposed, candidate-specific evaluation form (phase 9), built on the
   existing feedback table and its guards.
5. Development report (phase 11) through the in-app channel.
6. Installing the HF model locally (finding 1) and Calendar (finding 3) need the owner.

What was done, and the acceptance results: [MIDAN_COMPANY_JOURNEY_REPORT.md](MIDAN_COMPANY_JOURNEY_REPORT.md).
