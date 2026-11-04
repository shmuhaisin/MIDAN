Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `main`. The master build prompt from the project owner remains the source of truth; ask for it if it isn't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md and docs/DECISIONS.md first. Milestone 1 is done apart from the gaps listed there; don't redo it.

Next is Milestone 2 on Supabase project `al-midan-ya-hamidan` (ref `squpszwbrqkflezfltoj`; never touch the `ALNADA` project):
1. Write version-controlled migrations in `supabase/migrations` for the identity, organization, taxonomy, jobs and assessment domains, validating each relationship against a real use case.
2. Add RLS on every tenant-owned table and private storage buckets for CVs and evidence.
3. Seed clearly labeled fictional demo data.
4. Test cross-tenant isolation and run the Supabase security advisors.

Then Milestone 3: wire Supabase Auth through NestJS and replace `/get-started` with real registration.
