# Changelog

## 2026-11-06: The candidate experience
- Approved logo, with real transparency, in `apps/web/public/assets/brand` and the reusable `Logo` component. Palette values from the implementation brief.
- Sector skills reference and employer registry imported, with their sources. Registry entries are identity records only, and none is a partner.
- Password recovery and change, Google sign-in (shown only when switched on in Supabase), returning to the page someone wanted, and onboarding with saved progress.
- Private CV pipeline: local extraction and OCR, personal data kept apart, layered redaction, a second check that can block any external request, and review before anything is saved. See docs/privacy/cv-data-flow.md.
- The same protection for assessment answers before AI evaluation.
- Job filters, match explanations from a defined calculation, external listings kept apart, and a review step before applying.
- Applying now assigns the approved assessment immediately, and keeps a snapshot of the profile and CV. Repeated clicks reach the same application.
- A page for each application. Assessment deadlines and server-held timers, drafts, receipts, resubmission only when the organization allows it, and released results by criterion.
- Interviews with Daily Prebuilt and Google Calendar, tested against local stand-ins. Outcomes issued by the organization. Career development, notifications and settings.
- Small organization-side additions the journey depends on: scheduling, decisions, assessment deadlines and timers, job sector and level.

## 2026-11-05: Several assessments for one job
- A job can now have several assessments, each with its own title, field, drafts and versions. The job screen switches between them, adds another, renames, and removes a draft that was never published.
- Organizations choose which assessment to invite a candidate to. A candidate takes each assessment once, whichever version is current.
- An application counts as evaluated only after every invited assessment is reviewed. Being invited to another assessment moves it back to invited or in progress.
- Automatic status changes no longer overwrite shortlisted, rejected or hired. Withdrawn applications still refuse new work.
- Candidates see each assessment separately on their dashboard, and the assessment address now uses the version id. Old addresses with a version number redirect to the job's first assessment.
- Comparisons are now per assessment version, because only those share criteria. Earlier they mixed versions together.
- Requirement coverage counts the latest version of every assessment on the job.

## 2026-11-05: Structured job requirements
- New `job_requirements` table: responsibilities, daily duties, qualifications, education, experience, competencies, certifications, languages and other, each with a required or preferred flag. Either language may be left empty.
- Tasks can be linked to the requirements they measure (`task_requirement_mappings`), and rubric criteria to one requirement. Links must stay inside the same job and organization.
- The job screen shows how many required items a task measures, and marks the ones nothing measures yet.
- Publishing a version stores a snapshot of the job, its requirements and skills. Later job edits don't change what that version was built against.
- A requirement in use is retired rather than deleted, so history stays traceable.
- AI-origin requirements are forced to draft and stay out of public view until a person reviews them. Nothing generates them yet.
- Jobs gained employment type, salary range and application deadline. The public job page shows requirements by type.

## 2026-11-05: Real development registration
- Sign-up accepts any valid email through real Supabase Auth, with email verification on.
- Public registration stays closed: the database refuses sign-ups without an access code held only by the development server, and the form doesn't exist unless `DEV_TEST_SIGNUP=true`.
- On verification, candidates get a profile, and organizations get an organization, owner membership and branding record.
- New verification landing page, role-based redirects after sign-in, organization names on organization sign-up.
- Fixed: forms lost everything typed after any error.
- Copy no longer promises the Humaidan chat, which is postponed.

## 2026-11-05: Complete candidate profiles
- Profiles now hold a summary, experience, education, self-reported skills and a CV, with a completeness indicator on the dashboard.
- CVs: PDF or Word only, checked by file signature as well as declared type. The original file name isn't kept. Candidates can replace or permanently remove them.
- Organizations get an applicant profile screen, with skills labeled self-reported. Access ends when the candidate withdraws.
- Fixed: clearing a profile field didn't save, and consent time changed on every save.
- Fixed: file links could be blocked as popups, because the tab opened after the server answered.
- Fixed: the red error badge in development, caused by the theme script re-rendering on the client.
- Fixed: a stalled database connection could show the error page. An expired transaction now retries once.

## 2026-11-05: Product experience correction and Humaidan rules
- Humaidan's outfit now follows a saved professional field: assessment, then organization, then Original.
- Removed outfit swapping from the homepage, and the Finance, Legal, Healthcare and Engineering figures from general pages, the assessment builder and reports.
- Candidate login and sign-up feature Original Humaidan; employer pages are formal with no mascot, on the same auth logic.
- Organization branding screen: logo, colors, welcome message, field, with a live preview.
- Branded assessment intro with logo, colors, welcome message, field and the right variant.
- Homepage now explains both journeys; progress rails on the candidate dashboard and job workspace use real state.

## 2026-11-05: Core MVP workflows
- LangGraph assessment builder and evaluation graphs with human-review interrupts, labeled demo mode and a provider abstraction.
- Job details, draft editing, human-approved publishing, candidate preview.
- Candidate experience: task navigation, autosave, CSV data, evidence upload, submission.
- AI-assisted evaluation with mandatory human review, release, candidate report and candidate comparison.
- Sign-up refused at the database outside an allowlist, keeping real candidate data out.
- Fixed: a closed job broke the dashboard of candidates who had applied.
- Fixed: autosave could lose an edit when moving between tasks quickly or submitting right after typing.

## 2026-11-05: Milestone 3 and part of 4, accounts and first product screens
- Sign-in, registration and sign-out with httpOnly session cookies and automatic renewal.
- Opportunities list with search and city filter, job details, apply.
- Candidate dashboard with a next step, application tracking, withdraw, and profile.
- Organization creation and dashboard: real counts, jobs with draft and publish, applicants with status changes.
- API rate limiting per signed-in user, or per IP when signed out.
- Evaluations now require a submitted attempt.
- Fixed: an organization could still read a candidate's profile and CV after they withdrew. Found by the tests.
- Browser journey suite with Playwright, including the four language and theme combinations.

## 2026-11-05: Milestone 2, database foundation
- 27 tables with RLS, 72 policies, triggers and versioned migrations in `supabase/migrations`.
- Private storage buckets for CVs and evidence, with path-based policies.
- Restricted `midan_api` database role; NestJS connected through Prisma.
- Endpoints for profile, organizations, jobs and applications; all under real auth.
- End-to-end suite of 31 tests against the live project, covering auth and tenant isolation with and without the backend.
- Fixed: a policy with an unqualified `id` hid every organization from public view. Found by the tests.
- Web dev server moved to port 3100, as 3000 is in use on this machine.

## 2026-11-05: Milestone 1, brand and foundation
- Monorepo with `apps/web`, `apps/api`, `services/ai`.
- Design tokens for the official palette, designed light and dark themes, system preference.
- Arabic (RTL) and English (LTR) routing with a persisted language choice.
- Original Najdi-inspired parapet, arch and triangle motifs.
- Public pages, including an interactive field and skill-level explorer using the original Humaidan outfits.
- NestJS and FastAPI services with health endpoints; LangGraph wiring check.
- Supabase project `al-midan-ya-hamidan` created (no schema yet).
