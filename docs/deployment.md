# Deployment checklist

Nothing has been deployed. Nothing here is verified in production until the last section is done with real authorized accounts.

## Services

| Service | Runs | Needs |
| --- | --- | --- |
| `apps/web` | `npm run build -w @midan/web`, then `npm run start -w @midan/web` | Public HTTPS |
| `apps/api` | `npm run build -w @midan/api`, then `node dist/main.js` | Reachable only from the web server |
| `services/ai` | `services/ai/Dockerfile`, which includes tesseract with Arabic | Reachable only from the API. A persistent checkpoint store |

## Environment

Secrets go in the host's secret manager, never in the repository or a `NEXT_PUBLIC_` variable.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web, API | Public by design |
| `DATABASE_URL` | API | The restricted `midan_api` role. Secret |
| `API_URL`, `APP_URL` | web, API | `APP_URL` must be the public HTTPS address |
| `AI_SERVICE_URL`, `AI_SERVICE_TOKEN` | API, AI | Secret token |
| `AI_PROVIDER`, `GEMINI_API_KEY` + `GEMINI_MODEL`, or `OPENAI_API_KEY` + `OPENAI_MODEL` | AI | Without these, CVs get a labeled local reading and evaluation stays in demo mode. Secret |
| `DAILY_API_KEY` | API | Without it, interview pages say video isn't switched on. Secret |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | API | Without them, interviews show the invitation wasn't sent. Secret |
| `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE` | web | Development only. Leave unset in production |

`DAILY_API_URL`, `GOOGLE_API_URL` and `GOOGLE_TOKEN_URL` exist for tests. Leave them unset in production.

**CORS.** The API has no CORS enabled, because browsers never call it directly: they go through the web server. Keep it that way, and keep the API off the public internet where the host allows.

## Supabase dashboard

These need the owner's dashboard access:

1. Auth, URL configuration: set Site URL to `APP_URL`, and add `APP_URL/*/auth/confirmed`, `APP_URL/*/reset-password` and `APP_URL/*/auth/callback` as redirect URLs. Until this is done, verification and reset links won't land on the app.
2. Auth, providers, Google: enable it with an OAuth client. Add `https://<project>.supabase.co/auth/v1/callback` as the redirect URI in Google Cloud. The button appears by itself once this is on.
3. Auth, SMTP: set a custom sender. The built-in one only reaches project team members, a few per hour, so password reset can't reach real users without this.
4. Auth, password security: turn on leaked password protection.

**Registration gate.** `private.guard_signup` refuses new accounts without the development access code, and that includes new Google accounts. Existing accounts can sign in with Google. Opening registration is a separate launch decision.

## Migrations

All files in `supabase/migrations` are applied to `al-midan-ya-hamidan`. A new environment applies them in order. Reference data is then loaded as described in `docs/database/README.md`.

## Before calling it production ready

Against the deployed address, with real authorized accounts:

- [ ] Web, API and AI services are healthy (`/v1/health/db`, AI `/health`)
- [ ] HTTPS, secure cookies and CORS work
- [ ] Sign-up, verification, sign-in, reset and Google sign-in work
- [ ] A secret scan of the built browser bundle finds nothing
- [ ] CV upload, analysis with the real provider, review and approval work, with an outbound payload inspected
- [ ] A real Daily interview between two people, including camera, screen share, leaving and rejoining
- [ ] A real Google Calendar invitation arrives, and a rescheduling updates it
- [ ] The full candidate journey and the organization's side both pass
- [ ] Privacy review from `docs/privacy/cv-data-flow.md` is finished
