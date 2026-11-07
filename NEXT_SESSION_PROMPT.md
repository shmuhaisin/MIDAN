Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on `feat/company-workflow` (baseline `c5cb1af`). Preserve the existing uncommitted members/invitations implementation; inspect Git before editing. The master build prompt and the product correction brief from the project owner remain the source of truth; ask for them if they aren't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Rules that stay in force:
- Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`.
- Keep real candidate data out until privacy and data residency are reviewed. Development registration works with real Auth; public registration stays closed until the owner approves.
- The Humaidan AI chat is postponed by the owner: don't build or suggest it. Keep his visual character.
- Original Humaidan files only, chosen only through `resolveHumaidan`. Specialized outfits appear only inside assessments.
- `.env` and `.env.test.local` are local only. Run web, API and AI together. Do not run hosted tests or cleanup against team/production databases without explicit permission. Use the isolated members test instructions in docs/organization-members.md.

Next:
1. Repeat the implemented team invitations and role management journey with the standard native Prisma engine once network access permits; the full local Auth/Prisma-JS/SMTP journey already passed. Read docs/organization-members.md first. Do not rebuild the feature.
2. A persistent LangGraph checkpointer for production, and Graph A generation through a real provider once a key is available.
3. Expert review of the skills taxonomy and task templates.

The approval findings on pre-accepted INSERTs and new-invitee signup are resolved; read docs/organization-invitation-fixes.md before changing this flow. Context now uses an expiring HttpOnly cookie and actual server verification; no organization is created for invited staff signup. Preserve the uncommitted work and use isolated local tests only.
