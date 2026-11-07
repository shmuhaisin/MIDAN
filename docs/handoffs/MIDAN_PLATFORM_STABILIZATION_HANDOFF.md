# MIDAN — Platform Stabilization: Handoff

Written 2026-11-08. Branch **`midan-platform-p0`**, cut from `midan-platform-audit` (`f1dc1b1`, the audit report on top of
`4487597`). It has no upstream, so a plain `git push` goes nowhere by accident.

**Nothing was pushed, merged, deployed or applied to hosted Supabase.** Every test ran on the local stack with fictional data.

## 1. What changed, in the order the work was done

### P0 security

| Finding (audit) | Fix | Where |
| --- | --- | --- |
| F.1-1: employers read the candidate's **live** profile | Every employer view reads the application's **snapshot**. The three policies that let staff read live `candidate_profiles`, `candidate_skills` and `candidate_reference_skills` are dropped. The snapshot now also copies the skills listed at application time, and leaves out consent settings. Evaluation name redaction reads the snapshot too, so it doesn't lose the candidate's name | `20261108090000_employers_read_application_snapshots`; `apps/api/src/common/applicant.ts`; `applications.controller.ts`, `organizations.controller.ts`, `evaluations.controller.ts` |
| F.1-2: any staff member could get a video token | Only the candidate (after accepting, inside the window) and the interview's **participants** (whoever scheduled it, and the members they add) get a token. `public.can_join_interview` decides and rechecks membership. Interviewers own the room; the candidate never does. Calendar attendees are the candidate and the participants, no longer whoever saved last | `20261108090100_interview_participants`; `interviews.controller.ts`, `video-and-calendar.ts` |

### The seven failing tests

Each was checked against the product first.

| Test | Finding | Change |
| --- | --- | --- |
| 4 editing-policy API tests | Test fault: a request started inside another request's chain closed the shared test server | The review state is fetched before the request is built |
| `pipeline.e2e-spec.ts:399` | Test fault, product correct: the "change" set the template's own answer key, so nothing changed and nothing was recorded | Now makes a **real** change and checks the audit row holds the key before and after, then saves the same content again and checks **nothing** is recorded |
| `journeys.spec.ts:887` | Product noise: the approval panel repeated a warning that MIDAN's checks already show | The panel lists it only without a change review; the test checks MIDAN's warning and that the duplicate is gone |
| Rehearsal post-check | Stale: it looked for the trigger the editing policy replaced | Checks the five `write_assessment_audit` triggers, and that the old ones are gone. Two checks added, for the privacy and interview changes |

Also found and fixed on the way:
- **Phase 3 flake:** the listing test took the first listing, and the list has no fixed order.
- **Job update bug:** updating a job's skills alone returned 404, because the DTO's undefined fields made the update empty.
- **Stale web test:** the status-rule test read an old migration. It now reads the latest definition.
- **Lost notice in my own migration:** the rehearsal's rollback check caught that my first draft based the interview notification on an older definition, dropping the "candidate answered" notice. Rebuilt from the latest definition.

### Core recruitment

- **One applicant review page** (`/organization/:org/applicants/:application`, API `GET /v1/organizations/:org/applications/:id/review`):
  - the snapshot profile, with the date it was taken, and the cover note;
  - evidence for the job's required skills, marked "listed by the candidate" or "shown in a reviewed assessment", stated as not a score, ranking or prediction;
  - each assessment's status, overall score only once reviewed, criterion breakdown with evidence and explanation, skill levels, workbook-skill percentages and the reviewer's note;
  - experience, education, projects, courses, certifications, achievements and languages, and the CV copy;
  - interviews with participants, interview feedback, notes, and the full status history with who changed it.
- **Statuses:**
  - a shortlist can now be undone (shortlisted → under review) without rejecting;
  - every move still goes through `public.set_application_status` and is kept in `application_status_history`.
  - Interview invitation, scheduling and completion are the interview's own states (`interviews`, `interview_events`), shown on the page. They aren't new application statuses: adding enum values can't be rolled back cleanly.
- **In-app notifications**, written by the database:
  - new: shortlisted, rejected (by a staff move) and interview cancelled;
  - existing: application received, interview invited or changed, hiring decision.
  - A rejection issued through a decision says it once, as the decision. Undoing a shortlist sends nothing. Each status change has its own key.
  - **No email is sent:** none is configured, and nothing claims otherwise.
- **Employer notes:** append-only, staff only, never the candidate.

Migrations: `20261108090200_status_changes_and_notifications`, `20261108090300_application_notes_and_interview_feedback`.

### Interview feedback

- One record per interviewer per interview: competencies rated 1–4 with evidence, a recommendation, and notes.
- A **draft** is visible to its author alone. **Submitted** feedback can't change, and the organization's staff read it.
- Only the interview's participants write it, and never on a cancelled interview.
- It is kept apart from MIDAN's assessment and never changes it. The candidate never sees it.
- The recommendation is labelled as the interviewer's view: the decision is still a hiring outcome a person issues.

API: `PUT /v1/organizations/:org/applications/:id/interviews/:interview/feedback`. Screen: the review page. The form starts from the job's required skills.

### Career intelligence

- **CV analysis** (`services/ai/midan_ai/cv.py`):
  - it now extracts languages and achievements, and each skill with its kind (technical, general, or left unclassified rather than guessed);
  - each skill carries the CV line that shows it, **quoted as written**. Any quote the CV doesn't contain is dropped, so a model can't invent evidence.
  - Rule-based suggestions (what's clear, what could be clearer, and how) are shown apart from the facts, labelled as fixed rules and not a score, and never saved to the profile.
  - The candidate still approves every fact before it reaches the profile. Languages and achievements are now profile fields (`20261108090400`), copied into application snapshots.
- **Target job title:**
  - typed in the candidate's own words and shown as theirs, optionally linked to a workbook job family (`20261108090500`);
  - skills come only from that family and from **published jobs with a similar title**, each with how many jobs ask for it, plus the candidate's evidence;
  - no official title list exists, and none is invented.
- **Courses and certifications:**
  - each recommendation shows its name, provider, skill, reason, source link and verification date, from the admin-curated catalogue;
  - **the catalogue is still empty**, so the screen shows the empty state that says no verified recommendations exist.
- **Practice tasks** (`20261108090600`):
  - a simulated task or a portfolio project for a target-role skill, from fixed templates: brief, instructions, what to include, submission, link (portfolio), status, completion;
  - MIDAN's **checklist** on the submission's shape is labelled as not an assessment;
  - the screens and the texts never call either one employment or work experience;
  - only the API writes template content and the checklist (a database guard), and no organization reads them.

### Assessment experience

- **Job page:**
  - MIDAN's quality report: verdict, score, whether it's current, blocking errors, required revisions, warnings and dimensions, with "Run MIDAN's quality check";
  - the **assessor guide**, read-only, marked as for assessors only.
- **Organization settings:** company type.
- **Candidate assessment page:** the brief and materials from `candidate_package` (tables with their columns and rows, documents), labelled as fictional data.
- The editing policy, publishing and versioning are unchanged and still enforced by the database.

### Integrations

- **Google Calendar:**
  - one event per interview, with an ID derived from the interview, so a retry after a lost answer updates the event instead of adding a second one (409 → update);
  - the event links to the interview page, where both sides join signed in;
  - time zones are validated as IANA names, defaulting to Asia/Riyadh;
  - attendees are the participants.
  - **Not verified against Google:** no credentials (section 4).
- **Daily.co:** private rooms, per-person tokens for one room ending with the join window, participant-only access, interviewers as room owners. **Not verified against Daily:** no key.
- **AI providers:** unchanged contract. Errors are mapped, retried after a pause, and become "model failed" for a person to review. No key is in the browser. **No real provider was called.**

## 2. Migrations created (local only, rehearsed)

| # | File | Rollback |
| --- | --- | --- |
| 19 | `20261108090000_employers_read_application_snapshots` | Restores the earlier snapshot function and the three policies |
| 20 | `20261108090100_interview_participants` | Drops participants and `can_join_interview` |
| 21 | `20261108090200_status_changes_and_notifications` | Restores the previous rule and notification functions |
| 22 | `20261108090300_application_notes_and_interview_feedback` | Drops both tables |
| 23 | `20261108090400_profile_languages_and_achievements` | Drops the two columns |
| 24 | `20261108090500_career_target_job_titles` | Removes title-only targets, restores the constraints |
| 25 | `20261108090600_practice_tasks` | Drops the table |

Hosted has 23 migrations, so **25 wait for approval** (`20261106140000` onwards). `MIDAN_PHASE_2_PREPARATION.md` still describes
16 of them: update its table before any window.

## 3. Test results

Final run on the committed code (`20e5315`), 2026-11-08: macOS, Node 22, PostgreSQL 16 local stack, AI service in demo mode
unless stated.

| Check | Result |
| --- | --- |
| Type checks and lint (`npm run lint`) | **Passed** |
| API unit (`npm test -w @midan/api`) | **75 / 75** |
| Web unit (`npm test -w @midan/web`) | **23 / 23** |
| AI service (`uv run pytest`, Postgres checkpointer) | **177 passed, 5 skipped**: 2 real-provider tests (no keys), 2 needing the private benchmark guide in `.local/`, 1 needing Arabic OCR |
| Database suites: Phase 1 security, editing policy, assessment intelligence | **All passed** |
| API end-to-end (`npm run test:e2e -w @midan/api`) | **165 / 165**, including the new `recruitment` (8) and `career` (3) specs |
| Production builds, web and API | **Succeeded** |
| Bundle secret scan (canary build) | **Clean**, 1,041 files |
| Browser, production build with CSP reporting (`npx playwright test`) | **40 / 40**, including the new `recruitment.spec.ts`. CSP reports: only the 2 deliberate controls |
| Forms (`npm run test:forms -w @midan/web`) | **9 / 9** |
| Live journey with a **stand-in** OpenAI (`npm run test:live -w @midan/api`) | **4 / 4**. Proves the plumbing, not a real model |
| PostgreSQL 17 rehearsal, non-superuser (`scripts/rehearse-migrations.sh`) | **All 25 migrations** applied, rolled back to an identical schema, roles and data, and applied again; **28 / 28** post-change checks; full rollback to hosted's fingerprint |

Remaining failures: **none**. External integrations verified for real: **none**: no keys or credentials exist here (section 4).

## 4. Credentials and setup still needed

| What | For | Where it goes |
| --- | --- | --- |
| Gemini or OpenAI key and model name | Real CV structuring, generation, scoring; `MIDAN_REAL_PROVIDER_TESTS=1` | The owner's own `.env`, never chat |
| Google Cloud OAuth client, refresh token and calendar ID | Real calendar events (one MIDAN calendar today) | `GOOGLE_CALENDAR_*` in `.env` |
| Daily.co API key | Real private rooms | `DAILY_API_KEY` |
| SMTP or an email provider | Any email beyond Supabase Auth's own | Not wired: notifications are in-app only |
| Authorized job data and a verified course catalogue | Real listings and real recommendations | `scripts/import-data.mjs --listings`; the admin learning screen |
| `tesseract` Arabic pack | Arabic scanned CVs (1 test skipped) | `brew install tesseract-lang` on the machine running the AI service |
| Hosted approval | Applying the 25 migrations | Owner |

## 5. Running it locally

Once: `scripts/local-setup.sh`. Then, each in its own terminal, from the repository root:

```bash
scripts/local-db.sh start && scripts/local-db.sh migrate
```

```bash
node scripts/local-supabase.mjs
```

```bash
cd services/ai && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:3100/ar. Test accounts and their passwords are in `.env.test.local` (fictional, local only).

### The demo, step by step

1. **Candidate** (`midan.test.candidate-two@example.com`) registers, or uses the test account. Development sign-up needs the access code in `.env`; the verification email is at http://localhost:54321/__mail.
2. **Profile → upload a CV** (PDF or Word, fictional). Review what was extracted, the evidence lines and MIDAN's suggestions, and approve what's right.
3. **Career development:**
   - type a target job title, such as "Data analyst", and optionally link a workbook job family;
   - see what similar published jobs ask for, the verified-catalogue empty state, and start a practice task.
4. **Opportunities → apply** to a job published by the organization below, then complete the assessment and submit.
5. **Organization owner** (`midan.test.org-a-owner@example.com`): start and review the evaluation from the job page.
6. Open the **applicant**:
   - look over the snapshot, the evidence, the assessment breakdown and the CV copy;
   - set the status to **Shortlisted**.
7. **Candidate:** the notification "You've been shortlisted…".
8. **Owner:** schedule an interview and tick a colleague (`midan.test.org-a-recruiter@example.com`) as interviewer.
   - **Calendar:** shows "not configured" without credentials.
   - **Video:** joining says video isn't configured without a Daily key. It never pretends to create a room.
9. Each participant **submits feedback** on the review page. Mark the interview completed.
10. **Owner:** issue the decision (Hired). **Candidate:** the application shows Hired, with the history and the decision notice.

The automated version of this journey runs in:
- `recruitment.e2e-spec.ts` and `career.e2e-spec.ts` (API);
- `recruitment.spec.ts` and `candidate-journey.spec.ts` (browser);
- the live journey (stand-in model).

## 6. Known limitations

- **Real external services:** none was called: no AI provider, Google, Daily or email. Every "works" above is against a stand-in or local code.
- **Arabic CVs:** suggestions and skill evidence match text literally. A paraphrase ("قدت فريقًا" for "القيادة") isn't found, which errs on the side of no evidence.
- **Quality report:** its messages come from the evaluator in English only.
- **Assessor guide:** can be read on screen, not edited there. Whether employers may edit guides is an open owner decision.
- **Practice tasks:**
  - their feedback is a shape checklist, not an evaluation (no model);
  - employers can't see them (open decision);
  - courses stay empty until real verified entries exist.
- **Applications made before `20261108090000`** have snapshots without skill lists. Hosted has no applications, so this only affects local data.
- **Palette:** the brief lists Deep green #0B3D2E, Green #1F7A4D, Mint #A7E3C2 and Off-white #F7F4E9 as approved. The light theme uses the logo palette from `a53b984` ("approved logo, palette"): #0F5B46, #1F7A5C, #DCEEE5, #F7F4EE. The dark theme uses the brief's values. **Not changed tonight:** the owner should say which is current.

## 7. Open decisions (not reopened, still open)

1. Must an interview require a shortlist? The code allows any active application.
2. Should a manual "hired" status need a shortlist, as an outcome-hire does?
3. May employers see a candidate's completed practice tasks?
4. May employers edit assessor guides?
5. The rejection notice's wording (currently neutral).
6. Retention periods, with counsel.

## 8. Next steps

1. **Before any hosted window:** update the Phase 2 document to 25 migrations, then rehearse on PostgreSQL 17 (already passing locally).
2. **With a model key:** run the real provider tests, and the live journey against the real provider.
3. **With Google and Daily credentials:** a real interview, end to end, on a test calendar with fictional attendees.
4. **Then:** an email provider for notifications, and the open decisions above.
