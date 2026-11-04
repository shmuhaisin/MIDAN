Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `main`. The master build prompt from the project owner remains the source of truth; ask for it if it isn't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`. `.env` and `.env.test.local` are local only: regenerate them if missing. Run the web app and API together. After test runs, execute supabase/test-cleanup.sql, or test data shows up in the public job list.

The owner chose to continue without custom SMTP, so don't block on it.

Next:
1. Finish candidate profiles (education, experience, skills, CV upload to the existing private bucket) and job details (description, requirements, skills).
2. Organization branding and team invitations.
3. Milestone 5, the assessment engine: builder, preview, the branded candidate experience, responses, evidence upload and submission. The database rules for all of this already exist and are tested.
