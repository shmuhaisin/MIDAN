Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `main`. The master build prompt and the product correction brief from the project owner remain the source of truth; ask for them if they aren't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Rules that stay in force:
- Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`.
- Keep real candidate data out until privacy and data residency are reviewed. The sign-up gate stays.
- Original Humaidan files only, chosen only through `resolveHumaidan`. Specialized outfits appear only inside assessments.
- `.env` and `.env.test.local` are local only. Run web, API and AI together. After test runs, execute supabase/test-cleanup.sql.

Next:
1. Build the Humaidan assistant: authenticated API endpoint, role and page context from authorized data, conversation persistence, floating panel, full-screen on mobile, labeled demo mode. It must not solve live assessments or reveal rubrics, and permissions must be enforced by the backend, not the model.
2. Team invitations and role management.
3. A persistent LangGraph checkpointer for production, and Graph A generation through a real provider once a key is available.
