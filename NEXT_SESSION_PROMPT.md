Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `main`. The master build prompt and the product correction brief from the project owner remain the source of truth; ask for them if they aren't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Rules that stay in force:
- Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`.
- Keep real candidate data out until privacy and data residency are reviewed. Development registration works with real Auth; public registration stays closed until the owner approves.
- The Humaidan AI chat is postponed by the owner: don't build or suggest it. Keep his visual character.
- Original Humaidan files only, chosen only through `resolveHumaidan`. Specialized outfits appear only inside assessments.
- `.env` and `.env.test.local` are local only. Run web, API and AI together. After test runs, execute supabase/test-cleanup.sql.

Next:
1. Team invitations and role management.
2. A persistent LangGraph checkpointer for production, and Graph A generation through a real provider once a key is available.
3. Expert review of the skills taxonomy and task templates.
