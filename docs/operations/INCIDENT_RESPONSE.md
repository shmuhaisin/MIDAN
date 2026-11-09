# Incident response plan

**For:** anything that threatens candidates' or organizations' data, the fairness of a hiring decision, or the
platform's availability. MIDAN handles personal data under Saudi Arabia's Personal Data Protection Law (PDPL). A
personal-data breach has a regulatory notification duty, which the owner confirms with legal counsel.

## 1. Roles

| Role | Who (to fill in before launch) | Does |
| --- | --- | --- |
| Incident lead | | Runs the response, decides severity, owns the timeline |
| Technical lead | | Contains, investigates, fixes |
| Communications | | Users, organizations, regulator, if needed |
| Data protection contact | | PDPL assessment and notifications |

## 2. Severity

| Level | Examples | Response |
| --- | --- | --- |
| **SEV1** | Personal data exposed to the wrong party (cross-organization access, public CV link); secret key leaked and used; production down | Immediately, around the clock |
| **SEV2** | Secret leaked but no sign of use; a hiring decision affected by a wrong evaluation; AI provider down for over an hour | Within 2 hours |
| **SEV3** | A feature broken for some users; elevated errors; rate-limit abuse | Next working day |

## 3. Steps

1. **Detect and record.** Open an incident log with the time, who noticed, and what. Sources:
   - user reports;
   - API and AI service logs;
   - Supabase logs and advisors;
   - the CSP report endpoint;
   - the admin console (failed jobs, failed imports);
   - provider status pages.
2. **Contain.** Pick the action that fits:
   - **A secret leaked:** rotate it in its console (Groq, Daily, Google, Supabase service role, AI service token). Redeploy with the new value, then revoke the old one.
   - **Cross-tenant exposure:** take the affected route offline (feature flag or deploy). Revoke sessions if accounts are involved (Supabase: sign out all sessions for the users).
   - **An AI problem affecting evaluations:** switch `AI_PROVIDER` to demo mode. Results already need human review, so no automatic decision can follow. Mark affected evaluations for re-review.
   - **Abuse:** tighten rate limits; block addresses at the edge.
3. **Investigate.** Use the audit logs (`audit_logs`), the API logs (by request and user id) and the Supabase auth logs to find the scope: which records, which tenants, which time window. Preserve evidence: export the logs before they rotate.
4. **Fix and recover:**
   - fix the cause;
   - add a test that would have caught it (security tests live in `supabase/tests/` and the API e2e suites);
   - restore data if needed (`BACKUP_AND_RECOVERY.md`).
5. **Notify** (SEV1 with personal data):
   - follow the PDPL requirements as advised by counsel;
   - tell affected organizations and candidates plainly what happened, what data, and what they should do.
6. **Review** within a week:
   - a blameless write-up with the timeline, the cause, what worked, and the follow-ups with owners.

## 4. Specific playbooks

- **The AI provider is down or rate-limited (Groq 429/413/5xx):**
  - Evaluations fail over to human review (`model_failed`). CV analysis falls back to the basic reading. Matching and the assistant fall back and say so.
  - Communicate only if it lasts over an hour.
- **A Daily room is reachable by a non-participant:**
  - delete the room through the Daily API;
  - check `can_join_interview` and the join route;
  - a SEV1 if anything was seen.
- **Calendar invitations sent to the wrong people:**
  - set `GOOGLE_CALENDAR_SEND_UPDATES=none`;
  - cancel the events;
  - tell the recipients.
- **A prompt-injection attempt found in a CV or job text:**
  - the matcher can't be instructed; the assistant and generation treat the text as data;
  - record the text, check that the output stayed grounded, and add it to the AI tests.

## 5. Contacts to keep current

- **Providers:** Supabase, Groq, Daily.co, Google Workspace, the hosting provider.
- **Internal:** the security contact address published to users and organizations.
