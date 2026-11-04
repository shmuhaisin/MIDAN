# Decisions

**2026-11-05: Supabase region is eu-central-1 (Frankfurt).** The tool used to create the project offers no Middle East region. Frankfurt was chosen for its strong data protection regime. This does **not** satisfy any Saudi data residency requirement, and PDPL cross-border transfer rules need legal review before real candidate data is stored. Moving regions later means migrating the project.

**2026-11-05: NestJS 11, not 12.** NestJS 12 is ESM-only and fails under Jest's CommonJS runtime. Revisit once the test setup moves to ESM.

**2026-11-05: npm workspaces.** pnpm isn't installed and nothing yet needs it.

**2026-11-05: `main` as the working branch.** The project owner chose this over a feature branch for this stage.

**2026-11-05: Noto Kufi Arabic for Arabic headlines.** Reem Kufi was tried first and was hard to read at headline sizes. Long text uses IBM Plex Sans Arabic. English uses Bricolage Grotesque and IBM Plex Sans. All come from Google Fonts under the OFL.

**2026-11-05: No sign-up form until accounts work.** Both main calls to action lead to `/get-started`, which says plainly that registration isn't open. This follows the "no fake functionality" rule. Replace it in Milestone 3.

**2026-11-05: Nav only links to pages that exist.** Missing public pages (jobs, contact, legal) get added to the nav when built.
