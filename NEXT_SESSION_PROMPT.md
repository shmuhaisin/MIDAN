Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `main`. The master build prompt from the project owner remains the source of truth; ask for it if it isn't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Milestones 1 and 2 are done apart from the gaps listed there; don't redo them.

Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`. `.env` and `.env.test.local` are local only: regenerate them if missing.

Next is Milestone 3:
1. Have the owner set up custom SMTP and Auth redirect URLs in the Supabase dashboard; real sign-up depends on them.
2. Connect the web app to Supabase Auth with real login and registration pages, replacing `/get-started`.
3. Build the candidate profile and organization setup screens on the existing API, in both languages and themes.
4. Add rate limiting to the API.
5. Require a submitted attempt before an evaluation result can be created.

Then Milestone 4: expand the taxonomy (30 to 50 reviewed skills, occupations) and build job browsing.
