# Decisions

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
