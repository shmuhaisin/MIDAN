# Investor demo

An isolated, repeatable recruitment journey on the local platform. Every organization, job and person in it is
synthetic and labelled so. Nothing here claims customers, revenue, traction or prices.

## 1. Before the demo (once per machine)

1. Start the local stack:
   - database: `scripts/local-db.sh start`;
   - auth gateway: `node scripts/local-supabase.mjs`;
   - API, AI service and web app: `scripts/demo-up.sh` (or the preview servers).
2. The AI service mode:
   - **Demo mode** (`AI_PROVIDER` unset) uses MIDAN's templates for assessments and is fully repeatable.
   - **Live mode** (Groq) shows real generation and scoring, but a generated draft must pass the quality standard before it can be approved. The script stops and says so if it doesn't.
3. Build the showcase: `node scripts/investor-demo.mjs --reset`.
   - It clears and rebuilds only the candidates' side of the `midan-demo-showcase` organization. The organization, its job and the approved assessment keep their addresses, so open tabs and bookmarks keep working.
   - `--rebuild` removes the whole organization and builds it again. Everything then gets new addresses, and links to the old ones lead to the "page doesn't exist" screen.
   - Add `--with-interview` only when the API has no calendar keys or uses a test calendar.
4. Logins are in `.local/demo/ACCOUNTS.md`: fictional owner, recruiter and two candidates. Never show them on screen.

## 2. The 12-minute story

| Minute | Screen | What to show |
| --- | --- | --- |
| 0–1 | `/{ar,en}` | The landing journey: Humaidan in the car, five scenes. Switch language and theme |
| 1–2 | `/showcase` | Works today, real services, not built yet: the honesty is the point |
| 2–4 | Sign in as the owner → the showcase organization | The command center, the job, its requirements and the approved assessment. "People approve; nothing is published automatically" |
| 4–6 | Candidates → the strong applicant, then the other | Assessment scores with quotes from the work, then the **requirements match**: each requirement with the line that shows it. Confirm one proposal and correct another, live |
| 6–7 | Hiring | The pipeline. The decision on the second applicant was issued by a person |
| 7–8 | Ask MIDAN (organization) | "What needs our review?" The answer lists its records and links to the page, and doesn't act |
| 8–10 | Sign in as the first candidate | Applications, the released report, then **My career**: role, skills by evidence, practice, L0–L4 levels |
| 10–11 | Ask MIDAN (candidate) | "What should I work on next?" |
| 11–12 | Admin console | Queues, the platform at a glance, service status |

## 3. Honest limits to state if asked

- It runs locally, with no production hosting yet; see `docs/deployment.md`.
- **Semantic matching:** e5 is measured and running locally; BGE-M3 is not measured (no token). See `docs/ai/ATS_MATCHING.md`.
- No email notifications yet.
- Groq's free tier allows about 8,000 tokens a minute, so live generation can't run back to back.

## 4. Reset after the demo

`node scripts/investor-demo.mjs --reset` (the organization, job and assessment keep their addresses; application and evaluation pages get new ones)

It also updates the two test candidates' profiles to the showcase's synthetic ones.
