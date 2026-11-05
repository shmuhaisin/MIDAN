Continue building Midan (الميدان يا حميدان) from https://github.com/shmuhaisin/MIDAN on branch `feat/job-requirements-foundation`, which isn't merged. Don't change `main`, push or merge without the owner's approval. The master build prompt and the product correction brief from the project owner remain the source of truth; ask for them if they aren't in this conversation.

Read HANDOFF.md, PROJECT_STATUS.md, docs/DECISIONS.md and docs/database/README.md first. Don't redo what's marked Tested.

Rules that stay in force:
- Never touch the `ALNADA` Supabase project. Midan is `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`.
- Keep real candidate data out until privacy and data residency are reviewed. Development registration works with real Auth; public registration stays closed until the owner approves.
- The Humaidan AI chat is postponed by the owner: don't build or suggest it. Keep his visual character.
- Original Humaidan files only, chosen only through `resolveHumaidan`. Specialized outfits appear only inside assessments.
- `.env` and `.env.test.local` are local only. Run web, API and AI together. The API dev server doesn't reload, so restart it after API changes. After test runs, execute supabase/test-cleanup.sql.

Next:
1. Assessment drafts built from a job's requirements, with task mappings in the output. Requirements nothing measures stay visible. Adding and removing tasks by hand belongs here too, since every draft now starts from the same templates.
2. Import pipeline: CSV and JSON validation, duplicate detection, a review queue, and external employers kept apart from verified organizations.
3. Requirement extraction with explicit and inferred labels and human review. Without a configured AI provider it reports that, and never returns made-up results.
4. Sample data for the seven domains, labeled synthetic. Healthcare is excluded from dataset collection.
5. Team invitations and role management; a persistent LangGraph checkpointer; expert review of skills and templates.
