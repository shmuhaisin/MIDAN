Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on branch `candidate-portal`, which isn't merged. Don't change `main`, push or merge without the owner's approval. The master build prompt and the product correction brief from the project owner remain the source of truth; ask for them if they aren't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Rules that stay in force:
- Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`.
- Keep real candidate data out until privacy and data residency are reviewed. Development registration works with real Auth; public registration stays closed until the owner approves.
- The Humaidan AI chat is postponed by the owner: don't build or suggest it. Keep his visual character.
- Original Humaidan files only, chosen only through `resolveHumaidan`. Specialized outfits appear only inside assessments.
- `.env` and `.env.test.local` are local only. Run web, API and AI together. The API dev server doesn't reload, so restart it after API changes. After test runs, execute supabase/test-cleanup.sql.

Next:
1. Credentials from the owner: Daily, Google Calendar, Google sign-in, an AI key, SMTP. Then test each one for real, following docs/deployment.md.
2. Deploy, then run the checklist at the end of docs/deployment.md. Nothing has been deployed yet.
3. Privacy review, using docs/privacy/cv-data-flow.md. Keep real candidate data out until it's done.
4. Assessment drafts built from a job's requirements, and adding and removing tasks by hand.
5. Import pipeline: CSV and JSON validation, duplicate detection, a review queue, and external employers kept apart from verified organizations.
6. A verified course and certification catalog for `learning_resources`.
7. Company-side picker for sector reference skills on a job: the API table exists, and matching uses it.
8. Team invitations and role management; a persistent LangGraph checkpointer; a job queue for CV analysis.
