# Decisions

**2026-11-08: Groq is MIDAN's active AI provider (owner decision).** Groq Cloud serving OpenAI's GPT-OSS model, `openai/gpt-oss-120b`, through Groq's OpenAI-compatible API (`https://api.groq.com/openai/v1`), for CV analysis, assessment generation and candidate evaluation. Gemini and OpenAI stay supported behind the same contract; `AI_PROVIDER` chooses. Requests use JSON Object Mode, not strict JSON Schema (strict mode needs every field required and no additional properties, which the shared schemas don't follow); every reply is still validated by those schemas, and evidence, privacy filtering and human review are unchanged. Provenance records the provider (`groq`) and the exact model ID. Without a key the service runs in labelled demo mode and says which setting is missing; it never substitutes another provider.

**2026-11-08: The approved palette (owner decision).** Primary deep green `#0F5B46`, secondary green `#1F7A5C`, light mint `#DCEEE5`, warm off-white `#F7F4EE`, dark text `#1F2A26`. This replaces the values in the overnight brief and settles the 2026-11-06 entry below: no gold accent, and `#0B3D2E` is not the primary green. Applied through the shared tokens in `apps/web/src/app/globals.css`: the `gold` token keeps its name for existing classes but now draws in the palette's greens; borders and shadows are tinted with `#0F5B46`; dark mode keeps supporting dark surfaces, with text and accents from the palette. Logo, typography, layout and Humaidan assets are unchanged. `apps/web/src/lib/palette.test.ts` guards it.

**2026-11-08: What the stabilization brief settled (owner's brief).** Employers read an application's snapshot, never a candidate's live profile. Only an interview's candidate and its participants (whoever scheduled it, and the members they add) get a video token. A shortlist can be undone without rejecting. Candidates are told in the app when shortlisted, rejected, or an interview is cancelled. Interview feedback is each participant's own, kept apart from MIDAN's assessment, and never a decision. Practice tasks are simulated tasks or portfolio projects, never employment. A typed target job title is the candidate's own words, not an official title. Still open: whether an interview needs a shortlist, whether a manual hire needs one, and whether employers see practice tasks or edit assessor guides (`MIDAN_PLATFORM_STABILIZATION_HANDOFF.md` §7).

**2026-11-07: MIDAN generates assessments to the MIDAN Assessment Standard, MAS-1.0.** Every generated assessment is a package of three layers kept apart: what the candidate reads (brief, tasks, materials), the rubric (100 points, levels 0–4, evidence per criterion), and an assessor guide that only the organization's staff can read. The standard is derived from the structure of the owner's reference packages, never their content; generation and quality checks never use reference text, and similarity to a reference earns nothing. Generation receives the company's type, the job's sector and level, never the company's name. Quality reports are written only by MIDAN's service role. Specification: `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`; handoff: `docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md`.

**2026-11-07: Only generated versions must meet the MIDAN Assessment Standard (owner decision).** The quality gate applies to versions MIDAN generates under MAS-1.0 (those with an assessor guide) and to every later version of the same assessment. Approving one needs a `ready` quality report on its current content, written only by MIDAN's service role. Employer-authored versions, and drafts made by the template fallback when no model is configured, are not gated: they keep the editing policy's checks, and the quality report calls them not standardized. Implemented in `supabase/migrations/20261107160000_assessment_intelligence.sql`; the standard is `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`.

**2026-11-07: The assessment editing policy: employers may add, edit and delete; every change is recorded and reviewed (owner decision).** This settles the two entries below. Authorized employer roles (owners, admins and recruiters) may add, edit and delete a draft's tasks, questions, instructions, rubric criteria, objective options and answer keys. Every change is recorded in `audit_logs` with the assessment, draft version, task or criterion, actor, organization, action (create, update or delete), the state before and after, the time and any reason given. A deletion keeps the removed task with its rubric. Employers can read the record (owners and admins) but never write, change or delete it. Before approval, an owner or admin reviews every change, beside MIDAN's original and MIDAN's validation, and the review is recorded with who did it, up to which change and what the validation showed. A change after the review needs another review. MIDAN's validation errors (no tasks, a task without criteria, invalid objective questions or answer keys) block approval; its warnings (unmeasured responsibilities or required workbook skills, unmapped, thin or duplicate tasks, a criterion scoring a skill its task doesn't measure) are shown and recorded but don't block, because the owner chose to let a company decide. MIDAN keeps the generated draft, the edited draft, the approved version and the full history. An approved version never changes; to change an assessment candidates take, a new draft version is copied from it, and existing attempts stay on the version they started. MIDAN remains responsible for generation, skill mapping, validation and the assessment framework. Implemented in `supabase/migrations/20261107150000_assessment_editing_policy.sql`; details in `docs/handoffs/MIDAN_ASSESSMENT_EDITING_POLICY.md`.

**2026-11-07: Workbook skills are scored as a percentage, never a level.** The sector workbooks name skills but define no proficiency levels, so Midan reports how much of each skill the work showed, as a share of the marks on the tasks that measure it. The percentage is worked out in code from the criterion scores a person reviewed, not by the model. Skill levels stay for Midan's own skill framework, which defines them.

**2026-11-07: Phase 3: how jobs and employers come into Midan.** Job records come only from an authorized source, uploaded by a platform administrator, who names the source and what permits it. The preview saves nothing, and only the previewed file can be saved. An approved record becomes a draft job of the organization confirmed as its employer, never a published one. An organization becomes an employer's manager only when a platform administrator approves its evidence, and that never makes the employer a partner. Team members join by invitation to their verified email, and an invitation never grants ownership.

**2026-11-07: A company can edit and review a generated draft before approving it (owner decision).** MIDAN's engine still generates the draft from the job. Owners, admins and recruiters can change its tasks, rubric, objective questions and answer key, and owners and admins approve it. Edits are audited. If an edit leaves a mandatory responsibility or required workbook skill unmeasured, the screen says so before approval and doesn't block it. An approved version can't change. This refines the earlier decision that employers don't own assessment design, and is completed by the editing policy above, which also lets a company add and delete tasks and requires every change to be reviewed.

**2026-11-07: There is no permission to publish the source workbooks (owner's answer).** They were committed in `10068b0` and are public on three branches (`feature/midan-complete-data-jobs-assessment`, `feature/midan-phase-1-security`, `midan-security-completion`), though not on `main` or `candidate-portal`. As checked that day, the repository had no forks. Next: make the repository private, which needs its admin. They mustn't reach `main` by merge until their removal is decided. Deleting them or rewriting history needs separate approval. From `midan-phases-2-3-4` on, they're no longer tracked: they stay on disk and Git ignores them, but the earlier commits still hold them.

**2026-11-07: Assessment drafts can come from a model, through one contract for Gemini and OpenAI.** A draft is accepted only if it stays within what the job states and covers its responsibilities and required workbook skills. If no model is configured, or none gives a valid draft, the templates run and the draft is labeled demo. The stored record says which it was.

**2026-11-07: The external job platform is out of the code and the data (owner decision).** Job listings come only from authorized sources, through `--listings`. The employer workbook is read for identity only, and its job sheet and its note about collecting jobs aren't read. `20261106140000` was edited directly, with the owner's approval, because it hasn't reached hosted, so hosted never holds the value. The official workbook stays byte for byte, so the name remains inside that file.

**2026-11-07: Reopening, outcome hires and CV sharing (owner decisions).** A rejected application can be reopened only by an authorized hiring manager, which means the organization's owners and admins since MIDAN has no role by that name, and each reopening writes an audit record. Hiring through an interview outcome needs the application to be shortlisted already, and nothing shortlists it on the way; manual hiring keeps its rule. Without a CV snapshot, an employer sees no CV until the candidate explicitly shares a copy, which can't be replaced afterwards.

**2026-11-07: Every request is checked with Supabase Auth, with no cache (owner decision; an accepted trade-off).** A signed-out token stops working at once. The cost is one network call per request, and 503s while Auth is down. Revisit with real traffic data.

**2026-11-07: `TRUST_PROXY` stays unset until hosting is selected (owner decision).** Until then, signed-out visitors reaching the API through the web server share one rate limit.

**2026-11-07: The queue takes only a signed link to the caller's own file, and returns it to no one.** Keeping the 30-minute link (below) stays the owner's decision. `public.enqueue_background_job` no longer lets a caller name the deduplication key, which could return another candidate's link, and returns no payload, email or worker. A `cv_analysis` job accepts nothing but a signed link into the caller's folder, and the worker also checks the host and path, follows no redirect, and never fetches anything else. An administrator can't retry a failed CV job, which has lost its link; the candidate's retry makes a fresh one. A 4xx from Storage (an expired link) is final, a 429 or 5xx is retried.

**2026-11-07: An address that keeps sending rejected tokens stops reaching Supabase Auth.** The rate limiter must identify a caller before counting them, so tokens past the limit still cost an Auth call. After 60 rejections a minute from one address (per API process), the API answers 429 for tokens it hasn't checked, not 401, so a real session sharing the address isn't signed out. Until `TRUST_PROXY` is set, every visitor reaching the API through the web server shares one address, so someone flooding bad session cookies could slow sign-in checks for everyone for up to a minute.

**2026-11-07: Hired is final for hiring outcomes too.** Issuing another outcome on a hired application is refused; before this, "not selected" moved it to rejected. Whether a rejected application can be reopened, and whether an outcome's hire needs a shortlist, remain the owner's questions and are unchanged.

**2026-11-07: AI providers are Gemini and OpenAI, behind one provider interface (owner decision; for the AI integration phase).** Both are supported through a unified provider abstraction, chosen by configuration. Assessment generation and evaluation logic, rubrics, schemas and scoring stay independent of the provider. Every evaluation records its provider and model. Output validation, error handling, retries and evidence rules are the same for both. Neither provider may be described as working until it has passed integration tests with real credentials; as of this date neither has (no key is configured, and `services/ai/midan_ai/providers.py` has only been exercised with stand-ins).

**2026-11-07: Employer pages follow a hybrid management model (owner decision; for the employer phase).** MIDAN creates and manages the ten registry pages first. Employers may later receive management access to their page, through a claim and ownership-transfer workflow that never grants access automatically. MIDAN keeps platform-level administration and oversight. Employer users get role-based permissions for jobs, applicants, assessments and their team. Partnerships or employer authorization are never claimed without evidence of actual approval.

**2026-11-07: MIDAN owns assessment design; employers provide job context (owner decision; for the assessment phase).** MIDAN creates each job-specific assessment from the company type, sector, job description, requirements and relevant skills. Employers supply that job context; they don't own the assessment design. Assessment generation and candidate evaluation are separate engines. A company may review or approve a generated assessment, but MIDAN remains responsible for generating it. **Refined by the editing policy above:** employers may add, edit and delete content, under a recorded, reviewed and validated process. Still open from this entry: generation doesn't receive the job's sector or the company's type yet.

**2026-11-07: An organization reads only the CV submitted or shared with it.** Staff read the CV copy attached to their own organization's active application. Other files in the candidate's folder stay out of reach, including copies sent to other employers and the candidate's current CV.

**2026-11-07: Application status changes go through one function with fixed moves.** `public.set_application_status` allows: submitted → under review, shortlisted or rejected; under review → shortlisted or rejected; any assessment stage → shortlisted or rejected; evaluated → shortlisted, rejected or hired; shortlisted → rejected or hired; rejected → under review or shortlisted (reconsidering). Hired and withdrawn are final. Assessment stages and "evaluated" are set only by the system. Hiring, by hand or through a hiring outcome, needs every non-expired assessment of the application to have a reviewed evaluation. Staff no longer have a direct update grant on `applications`. Open for the owner, and implemented provisionally as stated until answered: whether rejection should be reversible (today: yes), and whether hiring through an interview outcome should also need a shortlist (today: no).

**2026-11-07: Rate limits key on verified accounts and trusted addresses only.** A token counts only once Supabase Auth accepts it; anything else is limited by address. The API believes a forwarded address only when `TRUST_PROXY` names the hops in front of it; otherwise all signed-out traffic through the web server shares its limit.

**2026-11-07: Pages get a nonce-based Content-Security-Policy; inline styles stay allowed.** Scripts need the request's nonce (`'strict-dynamic'` covers what they load). React renders style attributes, which a nonce can't cover, so `style-src` keeps `'unsafe-inline'`. The policy allows Supabase (logos, Google sign-in) and Daily (interviews), which the app uses.

**2026-11-07: CV analysis keeps its 30-minute signed link; no storage credential is added (owner decision, option a; an accepted trade-off, not an open issue).** Signing a link when the worker runs would need a credential that can sign for any candidate's files, which this design deliberately doesn't have (no service-role key). So:
- The existing 30-minute signed CV URL stays, and no new storage credential is introduced.
- The URL is in the queue job (`background_jobs.payload`) only while the job is waiting or running.
- It is deleted when the job finishes, whether it succeeded or failed (`private.settle_background_job`, migration `20261107090200`).
- It is never written to logs (`apps/api/src/jobs-queue/worker.ts`; tested in `worker.spec.ts`).
- It isn't readable through the Supabase Data API: the payload column isn't granted to `authenticated` (tested in `supabase/tests/security_phase1.sql`).
- A job that waits beyond 30 minutes fails with the clear error `file_unavailable` ("The file couldn't be reached." / «تعذر الوصول إلى الملف.»), and the candidate can retry, which makes a fresh link (`POST /v1/me/cv/analyses`).

**2026-11-06: The official source files are kept in the repository, in `data/source/`, at the owner's request.** This replaces the earlier decision to keep the workbooks out. The GitHub repository is public, so they become public when the branch is pushed. They are stored unmodified with SHA-256 checksums.

**2026-11-06: An organization account is linked to the employer registry only by a platform administrator.** A registry entry is an identity record. Letting any organization claim "I am the Ministry of Commerce" would put an official name on unverified jobs. Demo and test organizations can never be linked. Linking never sets partnership status, which changes only through a new import of the source workbook.

**2026-11-06: Employer brand assets are shown only with established permission.** The workbook marks every brand profile `permission_not_verified`, so all ten profiles use Midan's neutral identity, and the API doesn't return logo, color or font fields until the source says otherwise.

**2026-11-06: Aliases the source marks for review never match automatically.** "بوابة الدرعية" is marked ambiguous (the workbook warns not to confuse the authority with Diriyah Company), and "هيئة البحر الأحمر" is marked for review. An exact hit on either is an uncertain match that a person confirms.

**2026-11-06: Imports run as their own role and record every row.** `midan_importer` can only call the import functions. Runs, sheets, rows, raw values and issues are kept in `import_runs` and `import_records`, replacing the temporary grant the first import needed.

**2026-11-06: Long-running work goes through a Postgres queue, and the worker acts as the person who queued it.** `midan_worker` can only claim and settle jobs. The work runs through `asUser`, so row security applies. CV files reach the worker through a 30-minute signed link, never a stored session token.

**2026-11-06: The whole stack runs locally without Docker.** PostgreSQL 16 with a small Supabase compatibility layer, the real Supabase Auth and PostgREST binaries, and a local Storage implementation that writes rows as the caller so the storage policies decide. See docs/local-development.md.

**2026-11-06: Fixtures stay in the shared database, marked by it, and listings exclude them.** A separate test database would be cleaner, and should come before real users. Until then the mark is set by a trigger, not by name, and enforced in backend queries.

**2026-11-06: A direct link to a test job still opens.** Only listings filter. Tests use those links signed out, and a fixture's address can't be discovered from a normal view.

**2026-11-06: The product addresses candidates in the masculine form it already uses,** such as "راجع مهاراتك". The brief's feminine example was adapted to match, as it asked. Moving to neutral or chosen forms would be a separate copy change.

**2026-11-06: The palette values in the implementation brief replace the earlier ones.** The brief both asks to keep the existing palette and lists different values as approved. The listed values were applied at token level, with gold kept as a small accent. Changing back is a few lines in `globals.css`. The owner should confirm.

**2026-11-06: The employer workbook's external-jobs sheet is read as job listings.** (Superseded the earlier "not imported".) It holds a header and no rows, which is recorded as an empty source.

**2026-11-06: Applying assigns every published assessment, immediately.** A database trigger does it, whichever route creates the application. Assessments published later still use the organization's invite.

**2026-11-06: CV redaction runs in the private AI service, not the API.** It has the parsers and OCR, nothing else reaches it, and a failed check stops there. There is deliberately no path that sends a raw CV.

**2026-11-06: Match percentages are a stated calculation.** Required skills with evidence, divided by required skills. No model and no score from anywhere else.

**2026-11-06: No course or certification links until there's a verified catalog.** `learning_resources` is empty, and every row must carry a checked link and date. Gaps and practical project goals work without it.

**2026-11-06: Interview rooms are named from the interview id,** so a candidate joining first can create the room without write access to the interview. Rooms are private, and tokens are short-lived and scoped to one room.

**2026-11-05: An application's status comes from all of its attempts.** One function, `private.sync_application_status`, replaces the separate updates that each set a status. In progress wins, then invited. Evaluated needs every attempt reviewed, and expired attempts don't count. It only moves applications within the assessment stages, so a person's decision stays.

**2026-11-05: One attempt per assessment, not per version.** Publishing a new version doesn't invite anyone again. Retakes aren't a product decision yet, so a trigger refuses a second attempt until they are.

**2026-11-05: Assessment addresses use the version id.** Version numbers restart for each assessment, so a number alone became ambiguous. Old links redirect to the job's oldest assessment, which is the only one that could have existed when they were sent.

**2026-11-05: A published assessment can't be removed; a never-published one can.** Attempts and results point to published versions.

**2026-11-05: Requirements are their own rows, and `job_skills` stays the only source of structured skills.** A requirement can link to a skill, but skills aren't copied into requirements. The old free-text `requirements_ar` and `requirements_en` columns stay, so existing jobs and code keep working.

**2026-11-05: A published version keeps a snapshot, not live links alone.** Jobs stay editable after an assessment is published, so `assessment_versions.requirements_snapshot` records what the version was built against. Only the publish trigger writes it. Anything sent by a client is discarded.

**2026-11-05: Requirements entered through the API always count as stated by the employer.** The endpoint doesn't accept `origin`. Any other origin is forced to draft by a trigger, so AI output can't reach candidates or pass as an employer's statement, whichever route writes it.

**2026-11-05: Job data comes from organizations and permitted sources only.** Manual entry, CSV and JSON imports, authorized datasets, and public or licensed descriptions where permitted.

**2026-11-05: Development registration uses real email and a server-held access code.** The owner tests with a real address, so verification stays on. Public registration stays closed in two layers: the form needs `DEV_TEST_SIGNUP=true`, and a trigger on `auth.users` refuses any sign-up without the access code, whose hash is in `private.signup_access`. The code is stripped on every write to the account, because Supabase Auth writes user metadata again after creating a user. An earlier version only stripped it on insert, so the code stayed on the first real account and in its session token; that code was rotated. Opening public registration is a deliberate step for the owner, after the privacy and data residency review. Testers enter their own email only; candidate data stays fictional.

**2026-11-05: Profiles and organizations are created on verification, not at sign-up.** Unverified sign-ups can't claim organization names. A failure logs a warning and never blocks verification, and the person can finish setup in the app. `account_type` lives in user metadata, which a user can edit, so it only steers screens and first-time setup. It isn't a security boundary; RLS and memberships are.

**2026-11-05: The Humaidan AI chat is postponed by the owner** until knowledge is collected and its instructions are prepared. Don't build or suggest it. His visual character stays.

**2026-11-05: The API connects through the session pooler, port 5432.** The transaction pooler, port 6543, stopped answering from the development network: TCP connected, then the Postgres handshake got no reply, while 5432 on the same hosts answered in 0.4 seconds. That made every page needing data fail with "Can't reach database server". A filter on the network is the likely reason but isn't proven. Session mode holds one server connection per client connection, so a hosted API should revisit this and use port 6543 if its network allows it.

**2026-11-05: Self-reported skills are kept apart from assessed skills.** `candidate_skills` is what a candidate says; `skill_scores` is what their work showed. Every screen labels the first as self-reported, because mixing them would undercut the product's premise.

**2026-11-05: Original CV file names aren't stored.** They often contain a person's name, and nothing needs them. Files are saved under a random name.

**2026-11-05: An expired database transaction retries once.** Prisma error P2028 means it rolled back, so a retry can't double-apply. This depends on transaction callbacks doing only database work; calls to the AI service and Storage stay outside them. The stalls behind it were seen on the local connection to the Frankfurt transaction pooler, and their cause isn't established. Investigate if they appear in hosted use.

**2026-11-05: Humaidan's outfit follows a saved professional field, not a free image choice.** `assessments.professional_field`, then `organization_branding.industry`, then Original, resolved in `apps/web/src/lib/humaidan.ts`. Organizations choose a field, so a marketing assessment can't be given the events outfit, and media and marketing always resolve to Original as the approved rules require. The field sits on the assessment rather than the immutable version: it changes presentation, not what a candidate is evaluated on.

**2026-11-05: Candidate and employer auth share one route and one set of actions.** `?as=organization` selects a formal layout with no mascot. No auth logic is duplicated.


**2026-11-05: AI service gets the work, never the person.** The evaluation payload carries no name, email or other attribute, which also removes those as evaluation proxies. Scores are written by the Core API as the reviewer, so RLS applies, and no service-role key exists in the system.

**2026-11-05: Demo mode is a heuristic and says so.** With no key, open answers are estimated from length and structure, always at low confidence, and every screen and report says no AI model was involved. A reviewer who approves those numbers unchanged produces a report based on them, so demo output must never be used to judge a real person.

**2026-11-05: Sessions live in httpOnly cookies, and the browser never calls Supabase or the API directly.** Next.js server actions talk to Supabase Auth and the Core API, which keeps tokens out of browser JavaScript and matches the Browser -> Next.js -> NestJS architecture. Expiring sessions are renewed in `proxy.ts`.

**2026-11-05: The API must be hosted in the same region as the database.** Each transaction makes about 4 round trips. From a local machine to Frankfurt that's 1 to 1.5 seconds; next to the database it should be negligible. Saves feel slow in local development for this reason.

**2026-11-05: Withdrawing ends an organization's access to the candidate.** Their profile, CV and identity stop being visible, and the withdrawn application leaves the applicant list. The history rows stay. A candidate can't reapply to the same job after withdrawing, which may need revisiting.

**2026-11-05: Browser tests sign in by setting session cookies from a token.** The sign-in form with a real password is not exercised by automation; a person checks it.

**2026-11-05: Supabase region is eu-central-1 (Frankfurt).** The tool used to create the project offers no Middle East region. Frankfurt was chosen for its strong data protection regime. This does **not** satisfy any Saudi data residency requirement, and PDPL cross-border transfer rules need legal review before real candidate data is stored. Moving regions later means migrating the project.

**2026-11-05: The backend uses a restricted database role, not the service-role key.** `midan_api` can't bypass RLS and must assume `authenticated` or `anon` per transaction. This keeps the database as the real tenant boundary even if a controller check is missed. The password was generated locally; only a SCRAM verifier reached Supabase. Background jobs that must act without a user (for example AI evaluation) will need their own narrowly scoped path, decided in Milestone 7.

**2026-11-05: Supabase migrations own the schema; Prisma only reads it.** `prisma/schema.prisma` is generated by `db pull`. Prisma Migrate can't express RLS, triggers or the Auth and Storage objects.

**2026-11-05: Prisma 6, not 7.** Prisma 7 requires driver adapters and ESM changes this CommonJS NestJS setup doesn't need yet. Trade-off: Prisma's CLI carries a high-severity `npm audit` finding through `deepmerge-ts` (stack exhaustion on recursive objects). It's only reached by Prisma's config loading, not by request data. Revisit when upgrading.

**2026-11-05: `public.users` is kept in sync by triggers, with no foreign key to `auth.users`.** A cross-schema foreign key breaks `prisma db pull` on the public schema alone.

**2026-11-05: Deleting a candidate who has applications is blocked.** Applications reference users with no cascade, to preserve evaluation history. An erasure and anonymization process must be designed with PDPL review before launch.

**2026-11-05: NestJS 11, not 12.** NestJS 12 is ESM-only and fails under Jest's CommonJS runtime. Revisit once the test setup moves to ESM.

**2026-11-05: npm workspaces.** pnpm isn't installed and nothing yet needs it.

**2026-11-05: `main` as the working branch.** The project owner chose this over a feature branch for this stage.

**2026-11-05: Noto Kufi Arabic for Arabic headlines.** Reem Kufi was tried first and was hard to read at headline sizes. Long text uses IBM Plex Sans Arabic. English uses Bricolage Grotesque and IBM Plex Sans. All come from Google Fonts under the OFL.

**2026-11-05: No sign-up form until accounts work.** Both main calls to action lead to `/get-started`, which says plainly that registration isn't open. This follows the "no fake functionality" rule. Replace it in Milestone 3.

**2026-11-05: Nav only links to pages that exist.** Missing public pages (jobs, contact, legal) get added to the nav when built.
