# Requirement matching (ATS) and the embedding model decision

2026-11-09, branch `feature/midan-full-ui-redesign`.

## 1. What it does

For each of a job's requirements, MIDAN proposes whether the profile an applicant **submitted with the application**
shows it:

| Status | Meaning |
| --- | --- |
| `matched` | An evidence line clearly states it, or the applicant listed the exact required skill |
| `partial` | Related evidence, not clearly the same thing; or related experience with fewer years than asked |
| `needs_review` | MIDAN can't tell: years asked with no dates to check, a requirement too short to compare, or (with e5) an uncertain comparison |
| `missing` | Nothing in the submitted profile relates to it. That isn't proof the applicant lacks it |

- **Shown with each proposal:** the evidence line (with its source: experience, education, project, course, certification, listed skill, summary, headline), the similarity, and a reason code. The interface renders the reason in Arabic or English.
- **Score:** the weighted share of requirements shown (mandatory requirements count twice). `needs_review` items are left out of the score and counted separately, so the score never guesses about them.

Staff (owner, admin, recruiter) **confirm or correct** each proposal, with an optional note. Reviews are an append-only history in `application_match_reviews`, and the latest entry for a requirement counts. Reviewers with the `reviewer` role can read but not record. A proposal or a review never changes an application's status.

**Where:**
- engine: `services/ai/midan_ai/matching.py` (`POST /match/requirements`);
- API: `apps/api/src/applications/match.controller.ts` (`GET`, plus `POST …/match/reviews`);
- migration: `supabase/migrations/20261109090000_application_match_reviews.sql` (rollback in `supabase/rollback/`);
- interface: `apps/web/src/components/requirement-match.tsx` on the applicant page.

**Safety:**
- No language model is called, so text in a CV can't instruct the matcher. It's compared, never executed.
- Evidence comes only from the application snapshot, never the live profile. Contact details aren't evidence.
- Every route checks the organization role, and the review table has RLS: org members may read and insert their own reviews only.

### Rules beyond similarity (similarity is never treated as proof of competence)

Applied in this order:

1. **Structured evidence first.**
   - A released assessment result for the exact required skill (`assessed_skill`) means matched. It outranks everything.
   - Otherwise, the skill as the applicant listed it means matched (`listed_skill`).
2. **Negation.**
   - A line that states a capability in the negative is never counted as support. Examples: "No experience in Python", "never used SQL", "not familiar with…", "ليس لدي خبرة في…", "لم أستخدم…", "بدون خبرة…".
   - The pattern is narrow on purpose: "built dashboards without help" is not a negation.
   - If such a line relates to the requirement and nothing supports it, the status is `missing` with reason `negated`, and the line is shown.
3. **Contradiction.** Support and a related negation together give `needs_review` with reason `contradictory`, showing both lines.
4. **Years.** Years asked for with no dates in the experience give `needs_review`. Fewer years than asked give `partial`.
5. **Similarity bands** per backend: see section 4.

### Candidate side

`GET /me/jobs/:id/match` returns the existing `calculateMatch` result **unchanged**, as the safe fallback, plus a `semantic` section:
- the same per-requirement proposals for the candidate's own live profile;
- the candidate's listed skills and released assessment results, as structured evidence.

If the analysis service is slow or down, `semantic` is `{ "error": "unavailable" }` and the skills match still answers. The job page shows it as "How your profile meets each requirement", with a note that it's a guide and not proof.

### Resilience and privacy

| Concern | What happens |
| --- | --- |
| Slow analysis service | The API waits at most 20 s for matching (45 s for the assistant), then answers without the semantic part |
| Hosted BGE-M3 rate limit or 5xx | 15 s timeout, at most 2 retries with backoff (honouring a short `retry-after`), then the lexical fallback, recorded in the provenance |
| Personal data and external providers | Before any text goes to Hugging Face, `privacy.redact` replaces names, emails, phones, IDs and organization identities. The local e5 model sends nothing anywhere |
| Repeated work | e5 vectors are cached per text (bounded at 20,000), so the same CV lines and requirements aren't encoded twice |
| Isolation | The candidate endpoint reads only the caller's own profile and evidence, for published jobs. The organization endpoint reads only the application snapshot, under the organization's RLS and role checks |

## 2. CV extraction

These already existed and are unchanged:
- PDF and Word reading, OCR-free: `services/ai/midan_ai/cv.py`;
- privacy filtering before any external call: `privacy.py`;
- Arabic, English and mixed text.

Matching uses what the candidate approved into their profile, as captured in the application snapshot.

## 3. Model comparison (measured, not assumed)

**Benchmark:** `services/ai/bench/embedding_bench.py`. Results: `services/ai/bench/results.json`.
- **Set:** 16 job requirements and 16 CV evidence lines, all fictional and labelled, in Arabic, English and mixed text. About half are cross-language or paraphrased pairs with no shared words.
- **Metrics:** top-1 evidence accuracy, mean reciprocal rank (MRR), and the AUC between matching and unrelated pairs.
- **Machine:** CPU, Apple silicon. The run shared the CPU with a browser test suite, so latencies are pessimistic.

| | Lexical (token coverage) | `intfloat/multilingual-e5-base`, local | `BAAI/bge-m3`, Hugging Face hosted |
| --- | --- | --- | --- |
| Top-1 evidence | 0.188 | **0.688** | not measured |
| MRR | 0.33 | **0.783** | not measured |
| AUC (matching vs unrelated) | 0.143 | **0.922** | not measured |
| Mean score, matching / unrelated | 0.059 / 0.003 | 0.814 / 0.767 | — |
| Highest unrelated pair | 0.25 | 0.823 | — |
| Cold load | none | 8.8 s | none locally |
| One request (1 requirement × 8 lines) | < 1 ms | 0.067 s | network round trip per requirement |
| Peak memory | ~0 | 767 MB | none locally |
| Install size | none | PyTorch ~0.8 GB + model 1.1 GB | none locally |

**BGE-M3, from Hugging Face's own documentation (read on 2026-11-09; the provider page says "as of July 2025"):**
- **Billing:** `hf-inference` bills past included credits by "compute time × price of the underlying hardware". No per-request or hourly price is published for it.
- **Credits:** free accounts get no monthly credits; PRO gets $2.00 a month. The PRO subscription price isn't on that page.
- **Tasks:** `hf-inference` lists **feature extraction** (embeddings), not sentence similarity. The model's metadata maps it to `hf-inference` with task sentence-similarity. Which one works for BGE-M3 can only be confirmed with a token.
- **Rate limits:** not stated.

**BGE-M3, checked directly:**
- Hugging Face lists `BAAI/bge-m3` as **live** on `hf-inference` (task sentence-similarity), checked on 2026-11-09 through the public model API.
- A call without a token returns **401**. No token is configured, so it wasn't measured. It was **not downloaded or self-hosted**, as instructed.
- To measure it: set `HF_TOKEN` (read-only) and run `python bench/embedding_bench.py`. The `bge-m3-hosted` backend is implemented, but its thresholds stay uncalibrated until then.

## 4. Decision

1. **`intfloat/multilingual-e5-base`, local, is the selected backend** where the machine can hold it (`EMBEDDING_PROVIDER=e5-local`).
   - It finds the right evidence line far more often than word comparison: 69% vs 19% top-1, and an MRR of 0.78 vs 0.33.
   - It runs offline with no per-call cost, which keeps CV text on MIDAN's servers.
2. **Its scores are compressed**, so classification is calibrated conservatively:
   - `matched` ≥ 0.83, above every unrelated pair measured (0.823);
   - `partial` from 0.80;
   - `needs_review` from 0.77 (the unrelated mean), with the line shown and the reason "uncertain";
   - `missing` below that.

   Per-requirement margins were tried too: AUC 0.89, no better. The conservative bands send uncertain cases to people instead of guessing.
3. **Lexical stays the fallback**, used automatically and recorded in the provenance when e5 isn't installed or fails. The automated end-to-end tests pin it, so their statuses are deterministic.
4. **BGE-M3 is the candidate to compare next.** It is multilingual and reportedly stronger on Arabic, but no claim is made until it's measured on the same set. If hosted, CV text would leave MIDAN for Hugging Face. That needs a privacy decision (the CV analysis already removes personal details before external calls; matching evidence lines could follow the same rule).

## 5. Operating requirements and estimated costs

| | e5-base local (selected) | BGE-M3 hosted (if chosen later) |
| --- | --- | --- |
| Hardware | The AI service host needs about 1 GB more RAM (767 MB peak measured) and 2 GB disk (PyTorch and the model). CPU only | None locally |
| Latency | Under 0.1 s per requirement set once warm; about 9 s cold start, paid once per process | One network round trip per requirement; not measured (no token) |
| Cost | No per-call cost: it runs on the service's own CPU. A larger instance if the host is under 2 GB of RAM | Compute time × hardware price on Hugging Face; free accounts have no credits, PRO $2 a month included; no per-request price published |
| Privacy | Nothing leaves MIDAN | Redacted evidence goes to Hugging Face: needs a privacy decision |
| Failure mode | Falls back to lexical, recorded | Retries, then lexical, recorded |

## 5b. Operating it

| Setting | Values |
| --- | --- |
| `EMBEDDING_PROVIDER` | `lexical` (default) \| `e5-local` \| `bge-m3-hosted` |
| `HF_HOME` | Where the model files are. The demo keeps them in `.local/hf` (git-ignored) |
| `HF_HUB_OFFLINE=1` | Never download at runtime |
| `HF_TOKEN` | Only for `bge-m3-hosted` and the benchmark |

- **Install the extra:** `uv sync --extra matching` in `services/ai`.
- **The model files** (about 1.1 GB, once): `huggingface_hub.snapshot_download('intfloat/multilingual-e5-base')` with `HF_HOME` set.
- **Health:** the AI service's `/health` reports `matching` with the active backend's name.

## 6. Tests

| Test | What it covers | Result |
| --- | --- | --- |
| `services/ai/tests/test_matching.py` | Statuses, evidence, years, the score's rules, fallbacks, Arabic normalization, CV text can't instruct it; negation (English and Arabic, without false positives); contradiction; assessed beats listed; strong, partial and weak; invalid and empty input; hosted BGE-M3 rate limit, retry, timeout and fallback; personal data never sent | 17 passed |
| `services/ai/tests/test_matching_e5.py` | The real e5 model: Arabic CV vs English job, English CV vs Arabic job, mixed language, paraphrases, negation | 5 passed (skipped where the extra or model isn't installed) |
| `apps/api/src/match.e2e-spec.ts` | Proposal and evidence, staff-only access, other organizations and the candidate refused, review roles and history, RLS on direct writes, withdrawal | See the final test report |
