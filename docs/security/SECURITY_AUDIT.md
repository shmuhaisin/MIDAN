# MIDAN security audit

2026-11-09, branch `feature/midan-full-ui-redesign`, local stack. Every "in place" row names the code that does it and
the test that checks it. Open items are listed at the end, not hidden.

## 1. Controls

| Area | Control | Where | Tested by |
| --- | --- | --- | --- |
| **Authentication** | Every API route behind `AuthGuard`. Supabase access tokens are verified server-side; expired tokens are refused | `apps/api/src/auth/auth.guard.ts` | API e2e (signed-out → 401), browser "sessions" test |
| | Private web routes redirect to sign-in | `apps/web/src/proxy.ts` (`PRIVATE`, now including `/assistant`) | Browser "signed-out visitors" test |
| | Public registration closed in the demo; fictional accounts only | Owner decision (memory: synthetic data) | Browser sign-up test |
| **Authorization / tenancy** | Row-level security on **all 63 public tables**, 138 policies | `supabase/migrations/*` | Query on 2026-11-09: `relrowsecurity` true for 63 of 63 |
| | Organization roles checked per route (`requireRole`, `BUILDERS`) | `apps/api/src/common/roles.ts` | API e2e (other organization → 403/404) |
| | The anonymous role has no write grants on public tables | grants | Query on 2026-11-09: none |
| **IDOR** | Records are looked up with `org_id` and run under the caller's RLS (`db.asUser`), so another tenant's id answers 404 | All org controllers, the new match and assistant controllers | `match.e2e-spec.ts`, `recruitment`, `foundation` and `candidate-journey` specs |
| **Privilege escalation** | Status changes only through `private.manual_status_change_allowed`. Hiring needs reviewed assessments. Interviews need a shortlist | Database functions | `supabase/tests/security_phase1.sql` |
| | Match reviews: `reviewer` role may read but not record. Direct REST inserts refused by RLS | `application_match_reviews` policies | `match.e2e-spec.ts` |
| **CV and file security** | CV ≤ 10 MB; type checked by file signature (`%PDF`, zip header), not by name | `apps/api/src/me/me.controller.ts` | API e2e (broken PDF explains itself) |
| | Attempt evidence ≤ 25 MB, private bucket, signed URLs | `apps/api/src/attempts/attempts.controller.ts` | API e2e |
| | Personal data removed before any external analysis; organizations see the application snapshot only | `services/ai/midan_ai/privacy.py`, `apps/api/src/common/applicant.ts` | AI `test_cv_privacy.py`; e2e |
| **API validation** | DTOs with class-validator on every body (whitelisted); UUID pipes on ids | Controllers | e2e 400 cases (e.g. bad match-review key) |
| **Rate limiting** | 300 requests a minute per user (by token) or per address; the assistant routes 20 a minute | `apps/api/src/app.module.ts`, `token-throttler.guard.ts`, `assistant.controller.ts` | `throttle.spec.ts` (see the test report for its run) |
| **Secrets** | Keys only on the server. The production bundle is scanned for secret values and names | `apps/web` `check:bundle` | Bundle scan on every build: 1,326 files, no secrets |
| | `.env`, `.env.test.local` and `.local/` are git-ignored; `.env.example` has empty placeholders | `.gitignore` | Checked before every commit |
| | Test runners refuse non-local addresses | `apps/api/test/local-only.setup.ts`, `apps/web/e2e/local-only.ts` | Runner guard |
| | Tests blank real Daily and Google keys | `local-only.setup.ts` | No real room or event created by tests (checked 2026-11-08) |
| **Prompt injection** | Generation: the job is sent as a closed data block | `providers.py` | AI tests |
| | Matching: no model at all, so CV text is compared, never followed | `matching.py` | `test_matching.py::test_cv_text_cannot_instruct_the_matcher` |
| | Assistant: facts in closed blocks, marked as data; reply schema-validated; only supplied fact ids and allow-listed in-app links survive; it can't act | `assistant.py`, `assistant.controller.ts` | `test_assistant.py` (hostile fact, invented ids and links, external links refused) |
| **AI provider failure** | Groq: 429 waits for `retry-after`; timeouts and 5xx retried, then the result goes to a person (`model_failed`). A 413 is named. Provenance records the provider | `providers.py` | `test_groq_provider.py` (17 tests) |
| | Matching falls back to word comparison and says so; the assistant falls back to retrieved facts and says so | `matching.py`, `assistant.py` | AI tests |
| **Web** | Per-request CSP with nonce, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, referrer policy, HSTS in production | `apps/web/src/lib/csp.ts`, `next.config.ts` | `security-headers.spec.ts`; CSP reports collected during browser runs |
| **Human control** | No automatic rejection or hiring. Generated assessments are never auto-published (quality gate). Every evaluation waits for review | API and database | API e2e, live journey |
| **Audit** | `write_audit` trigger on sensitive tables, including the new `application_match_reviews` | migrations | Database tests |

## 2. Open items

| # | Item | Risk | Next step |
| --- | --- | --- | --- |
| 1 | Rate limiting is per process, in memory | Several API instances would each allow 300 a minute | Shared store (Redis) for the throttler before scaling out |
| 2 | No malware scanning of uploaded files | A malicious file could be stored, though it's never executed or served inline | A scanning step (for example ClamAV) before files become downloadable |
| 3 | Hosted inference for BGE-M3 would send evidence text to Hugging Face | Third-party processing of CV-derived text | A privacy decision first (see `docs/ai/ATS_MATCHING.md`) |
| 4 | No external penetration test | Unknown unknowns | A test before launch |
| 5 | Email isn't configured | Sign-up and recovery emails depend on the auth provider's mailer | Configure a provider with SPF, DKIM and DMARC |

Recovery and incident handling: `docs/operations/BACKUP_AND_RECOVERY.md` and `docs/operations/INCIDENT_RESPONSE.md`.
