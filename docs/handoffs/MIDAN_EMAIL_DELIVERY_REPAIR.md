# MIDAN email confirmation repair — 2026-11-10

## Diagnosis and evidence

Project: `al-midan-ya-hamidan` (`squpszwbrqkflezfltoj`, production).
This investigation made read-only Cloud queries. No Auth configuration, SMTP setting, email template,
user confirmation state, employer approval, project-team membership, or production privilege was changed.

| Observation | What it establishes |
| --- | --- |
| `/signup` at `2026-11-09T21:15:15Z` returned `429: email rate limit exceeded`, code `over_email_send_rate_limit`, request `01a1c22a-507e-75ab-9e16-4fd203e9db99` | Auth rejected an email-sending operation because its sending quota was exhausted. It does not prove a message reached a provider or inbox. |
| `/verify` at `2026-11-10T00:21:40Z` reported `One-time token not found` and `403: Email link is invalid or has expired`, request `01a1c2d4-fbee-7136-be40-b904b5c6b108` | That submitted token was not usable. It does not identify whether it was reused, replaced, expired, malformed, or consumed by a scanner. |
| The owner supplied the attempted address and approximate registration time, November 10 at 03:30 Riyadh time; an exact case-insensitive Auth lookup found no row for that address | That attempted address has no current Auth user. No confirmation state was changed to compensate. The private address is deliberately omitted from this public report. |
| Auth and edge logs in the surrounding 03:15–03:45 Riyadh window (`2026-11-10T00:15:00Z`–`00:45:00Z`) contain no signup/resend request for the attempt | No Cloud signup or email-send attempt was found in that window. The older November 9 quota error cannot be attributed to this registration. This does not establish where the browser's submission went. |
| This environment has database/log tools but no Auth configuration-read tool or Supabase Management API credential | The active SMTP host, custom-SMTP enablement, exact project send quota, templates and redirect allowlist could not be read directly. Do not present provider restrictions as verified current settings. |
| Public `GET /auth/v1/settings` returned `disable_signup=false`, `mailer_autoconfirm=false`, `external.email=true` | Email signup is enabled and confirmation is required. This endpoint exposes no SMTP configuration or redirect allowlist. |

An Auth email rate limit was directly observed on November 9, but is not the proven cause of the owner's later attempt.
The owner confirmed that custom SMTP is not configured and no sender domain is owned. This use of built-in SMTP
matches Supabase's documented restrictions: only organization-team recipient addresses, currently two
messages per hour project-wide, and no delivery SLA. A custom SMTP service is required for ordinary employer
addresses if the project still uses that service. Do not grant applicants project-team access to work around it.

No provider acceptance event or employer inbox receipt was available in this session. **Successful external
email delivery is not yet proved.** The application must not turn an API acceptance response into a claim
that a message was delivered: Auth can also return an intentionally generic success for an existing account.

The 429 log does not identify its recipient. There were 13 Auth users, one unconfirmed fixture, and no newly
created employer in the last hour at the earlier inspection. For the owner's supplied attempt, the exact-address
lookup and bounded logs show no current user or signup/resend record. Do not claim that this attempt created
a Cloud user or sent an email, or that the earlier rate limit explains it. A controlled browser submission must
be matched to the intended Cloud project before an external delivery test can establish the complete result.

The isolated development server in this Codex workspace currently targets `http://localhost:54321` and captures
mail locally; the supplied address is absent there too. This does not identify the configuration on the owner's
machine. Before the controlled external test, verify that the actual running web server targets
`https://squpszwbrqkflezfltoj.supabase.co`, uses the existing Cloud-backed API, and runs commit `a5bae13` or later.
Restart after changing environment selection; do not point the web app at Cloud while leaving its API on a local database.
The existing `scripts/with-env.mjs` can select the owner's already-configured Cloud environment without overwriting
the root `.env`. No Cloud database/runtime secrets are configured in this executor, so none were invented or copied.

Cloud still reports 57 migrations, two demo workspaces and no `employer_access_requests` table. The already-prepared,
rehearsed Employer Access migration requires separate explicit approval before the registry-representative Cloud flow
can run. SMTP configuration alone cannot create its missing table. Existing demo invitation access remains unchanged:
a matching verified account can join an unlinked demo workspace without Platform Admin approval. Ordinary public
employer signup currently selects a registry organization and requires approval; this repair does not silently turn
that selection into an automatic demo membership. No new screens, roles, schema or auto-confirmation were introduced.

## Application corrections

- Invalid, missing, expired or rejected email sessions render confirmation failure, never confirmed success.
  Tokens are cleared from the address bar; Auth validates the access token server-side before cookies are set.
- HTTP 429 is preserved even if the error body lacks a code. Recipient restrictions and SMTP failures have
  actionable messages; arbitrary SMTP/database failures are no longer mislabeled as registration closed.
- `/check-email?as=organization` offers signup-confirmation resend and preserves locale/employer redirects.
  It calls only Auth's resend endpoint: it does not recreate users, modify metadata, confirm email or grant access.
- Resend consumes a server-side 60-second cooldown per normalized email hash, including upstream failures,
  plus a 10-attempt/minute process-wide cap. Longer provider Retry-After values extend the cooldown (bounded to 24 hours). Storage is bounded and fails closed at capacity. These are process-local
  backstops; Supabase's recipient/project quotas remain authoritative across instances and process restarts.
  The visible countdown is supplementary, not the security boundary. No distributed limiter is claimed.
- Successful submission uses account-safe conditional wording; it is not delivery proof. Unknown/already-confirmed
  addresses receive the same generic resend result. Recipient restrictions never instruct applicants to join the team.
- Existing verification, signup gate, pending approval and tenant authorization stay enabled. No OTP or email-template
  change was activated without approval.

Verification: web unit/translation/helper tests **51/51 passed**; focused confirmation/resend browser tests **6/6 passed**;
existing signup/unverified-login/signup-gate/secret-canary browser regressions **5/5 passed**; Employer Access API/database
tests **10/10 passed**. The focused browser tests use a local Auth stub for controlled provider errors and cannot prove
external delivery. The separate real local Auth/SMTP browser test **1/1 passed** in 11.2 seconds:
registration form → unconfirmed Auth row → confirmation email captured by the real local SMTP sink → one browser
visit to its link → validated callback → Pending admin approval with zero memberships → administrator approval →
correct employer workspace. Reusing that same link rendered confirmation failure, preserved the existing valid
session, and granted no membership before Admin approval. This reproduces token reuse locally without claiming
Cloud prefetch was the cause. Its isolated account/workspace were removed afterward. TypeScript checks passed.

Reproduce with the existing local stack running:

```sh
npm test -w @midan/web
npm run lint -w @midan/web
CHROMIUM_PATH=/usr/bin/chromium npm run test:forms -w @midan/web -- email-confirmation.spec.ts
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -w @midan/web -- email-approval.spec.ts
npm run test:e2e -w @midan/api -- --testPathPatterns=employer-access
```

The browser binary override is optional on machines with Playwright's managed browser. Local workbooks are not
required for these tests, but the ten existing registry identities must be available. Use the existing verified
fixture accounts for the capstone demo; this local mail sink is not an external SMTP delivery solution.

## Read-only configuration check before approval

An authorized owner should inspect these existing project pages; do not change settings during inspection:

- [SMTP settings](https://supabase.com/dashboard/project/squpszwbrqkflezfltoj/auth/smtp): whether custom SMTP is enabled;
  host, port, sender address and name. Do not copy the password into chat or a report.
- [Rate limits](https://supabase.com/dashboard/project/squpszwbrqkflezfltoj/auth/rate-limits): project email quota and
  per-address send interval, compared with the provider's own quota.
- [URL configuration](https://supabase.com/dashboard/project/squpszwbrqkflezfltoj/auth/url-configuration): Site URL and
  additional redirect URLs. Check that these match the actual browser origin and running application port.
- [Email templates](https://supabase.com/dashboard/project/squpszwbrqkflezfltoj/auth/templates): confirmation template
  and whether it uses `{{ .ConfirmationURL }}`, a custom token-hash link, or `{{ .Token }}`.

The Management API equivalent is a **GET** to
`https://api.supabase.com/v1/projects/squpszwbrqkflezfltoj/config/auth` using an owner-authorized management credential.
Filter its response locally to nonsecret fields such as `site_url`, `uri_allow_list`, `mailer_autoconfirm`,
`smtp_host`, `smtp_port`, `smtp_admin_email`, `smtp_sender_name`, `smtp_max_frequency`,
`rate_limit_email_sent`, and `mailer_otp_exp`; do not print the complete response. Do not PATCH without approval.

## Selected immediate provider: Brevo Free with a verified owned mailbox

The owner has no custom domain and Google App Passwords is unavailable. Brevo is the selected practical
no-domain SMTP option, conditional on sender verification, transactional-account activation, and an actual
delivery test. Its Free plan documents 300 email sends/day. It is not a temporary email-testing service.
No Brevo account, key, sender or production configuration was created by this investigation.

Brevo explicitly documents a provider-managed fallback for free-email senders: it temporarily replaces the
From address with a compliant one, including for transactional mail and regardless of recipient provider.
Its example is `mycompany@gmail.com` → `mycompany@5000001.t-sender-sib.com` for transactional messages.
This is an authorized Brevo rewrite, not permission to configure an invented address on that domain. Configure
only the owner's verified mailbox. Brevo calls this basic-deliverability fallback a stopgap; it can affect sender
recognition/spam placement and is not a long-term guarantee. An owned authenticated domain remains preferable.

Minimum owner actions:

1. Create a Brevo Free account and complete the account's requested identity/account checks.
2. Open [Senders](https://app.brevo.com/senders), or **Settings → Senders, Domains, IPs → Senders → Add a sender**.
   Enter From name `MIDAN` and a Gmail or other mailbox the owner controls. Click **Save**, enter the six-digit
   code Brevo emails to that address, and click **Verify sender**. No Google App Password is used.
3. Open [SMTP settings](https://app.brevo.com/settings/keys/smtp), or **Settings → SMTP & API → SMTP**.
   Copy the exact displayed **SMTP login** and generate a standard **SMTP key** named `MIDAN Supabase`.
   Store the key securely. This must be an SMTP key, **not an API key**, Brevo account password or Gmail password.
4. Confirm transactional sending is activated. Brevo's troubleshooting guide says first-time transactional
   accounts may require a separate activation step: create a support ticket requesting activation for MIDAN's
   user-requested signup-confirmation emails. Do not claim that creating an account/key guarantees immediate sending.
5. After the owner approves the production change, enter the following values directly into
   [Supabase SMTP settings](https://supabase.com/dashboard/project/squpszwbrqkflezfltoj/auth/smtp).
   Never paste the SMTP key into chat, source code or a commit.

| Supabase custom SMTP field | Brevo value |
| --- | --- |
| Host | `smtp-relay.brevo.com` |
| Port | `465` with SSL/TLS |
| Username | Exact **SMTP login** shown by Brevo; it may be `[ID]@smtp-brevo.com`, not the account's login email |
| Password | Generated **SMTP key**, entered securely |
| Sender email | Owner's mailbox verified with Brevo's six-digit code |
| Sender name | `MIDAN` |
| Email confirmation | Enabled; `mailer_autoconfirm` stays `false` |

Disable provider link/click tracking for Auth mail. Keep a modest Supabase project quota and at least a
60-second per-recipient interval, respecting longer provider retry times. If SMTP returns `450 Your SMTP
account is not yet activated`, resolve activation with Brevo rather than retrying registrations. Inspect
[transactional activity](https://app.brevo.com/transactional/email/real-time) for acceptance, delivery, bounce or
suppression evidence. Only a controlled external inbox receipt and completed confirmation can prove success.

## Alternative if a sender domain is arranged: Resend

Resend is an alternative requiring an owned verified sender domain, not the immediate choice for the owner's
current no-domain situation. Merely creating a Resend API key does not enable unrestricted recipient delivery.
The owner must approve the provider and any cost.

Required inputs are:

1. An owner-controlled sender domain or subdomain, for example `auth.<owned-domain>`, with access to its DNS.
   This is the sending identity; it does not have to be the website domain. A Gmail address alone cannot verify
   ownership of `gmail.com` and is not a substitute for a sender domain.
2. The provider account with the domain marked **verified**. Publish the exact DKIM and SPF/return-path DNS
   records generated by that account; do not invent DNS record values. Keep one valid SPF record per hostname
   rather than adding conflicting SPF TXT records. Configure aligned DMARC and monitor delivery reports.
3. The approved From address on the verified domain, for example `no-reply@auth.<owned-domain>`, with display name `MIDAN`.
4. A sending-enabled Resend API key, scoped to that domain where supported. Enter it directly in the Supabase
   SMTP password field or an authorized secret store, never in chat, source code, `NEXT_PUBLIC_*`, or a commit.

| Supabase custom SMTP field | Proposed value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` (implicit TLS); use `587` with STARTTLS only if selected and supported by the configuration |
| Username | `resend` |
| Password | Owner-provided sending API key; secret, not shown here |
| Sender email | Approved address on the verified sender domain |
| Sender name | `MIDAN` |
| Email confirmation | Enabled; `mailer_autoconfirm` stays `false` |

Disable provider link/click tracking for Auth mail, because rewritten confirmation links can break verification.
Use a short transactional confirmation message rather than marketing content. After explicit approval, enable
custom SMTP and set a modest quota compatible with the provider plan. Supabase documents an initial custom-SMTP
quota of 30 messages/hour; inspect the actual project value rather than assuming it. Keep at least a 60-second
resend interval and honor any longer server/provider retry time. Increasing quotas does not fix an unverified sender.

## Confirmation callback and redirect URLs

MIDAN email signup currently returns to `/{locale}/auth/confirmed`; Google OAuth separately uses
`/{locale}/auth/callback`. Password reset uses `/{locale}/reset-password`. Email confirmation must not be sent
to the Google PKCE callback unless the flow is deliberately changed and tested.

For the existing localhost development site, `APP_URL` is `http://localhost:3100`. Preserve these exact email redirects:

```text
http://localhost:3100/ar/auth/confirmed
http://localhost:3100/en/auth/confirmed
http://localhost:3100/ar/auth/confirmed?as=organization
http://localhost:3100/en/auth/confirmed?as=organization
```

Retain the existing legitimate OAuth/reset entries as needed:

```text
http://localhost:3100/ar/auth/callback
http://localhost:3100/en/auth/callback
http://localhost:3100/ar/reset-password
http://localhost:3100/en/reset-password
```

For a production web deployment, replace the origin with its approved HTTPS origin and allowlist only the
needed paths, for example:

```text
https://<approved-web-host>/ar/auth/confirmed
https://<approved-web-host>/en/auth/confirmed
https://<approved-web-host>/ar/auth/confirmed?as=organization
https://<approved-web-host>/en/auth/confirmed?as=organization
```

Do not save the angle-bracket placeholders as literal settings. Include `127.0.0.1` only when it is an actual
supported browser origin; `localhost` and `127.0.0.1` are different hosts. Avoid broad production wildcards.
Supabase can fall back to Site URL when a redirect is not allowlisted, so check the emitted email's sanitized
`redirect_to` value and final browser URL. An email pointing to localhost opens the recipient's own machine,
not the Codex cloud machine; external recipients need a reachable approved HTTPS site or their own local server.

## One-time-token failure and prefetch investigation

The invalid-token log is separate from the send-quota error. Replaying the same email link, opening an older
link after a resend, expiration, malformed URLs, and security-scanner prefetch are all possible causes. Do not
declare scanner prefetch from this single log alone. Correlate one controlled signup's confirmation timestamp,
provider acceptance/delivery times, first verify request, user click time, and Auth confirmation state. Do not log
tokens or full confirmation URLs during correlation.

If controlled evidence shows prefetch consumption, propose one of these changes for approval:

- **Email OTP:** put `{{ .Token }}` in the confirmation template, display a manual code-entry form, and verify
  email/code with Supabase's POST `/auth/v1/verify` email flow. Never verify the code merely by loading a page.
  Keep expiry and attempt limits. It still requires working SMTP; OTP does not solve delivery failure.
- **Deliberate confirmation action:** make the email link open a neutral application page; require a user action
  before server-side POST verification of the token hash. Do not consume a token on the initial GET. Keep redirects
  constrained to the application, suppress sensitive referrers, and remove the token from the address bar.

Changing production email templates, OTP lifetime, redirect configuration, SMTP or rate limits remains an owner
approval step. This repair does not silently activate an OTP/template migration.

## Delivery and full workflow acceptance checklist

Use existing verified fixture accounts for the capstone demo while delivery is repaired. Never auto-confirm new
employer users, auto-approve representatives, add applicants to the Supabase team, or weaken workspace authorization.

After the owner approves and supplies SMTP configuration, perform one controlled external signup:

1. Use an owner-approved test inbox outside the project team and one of the ten supported employers. Record the
   request timestamp and sanitized request ID; do not expose password or tokens.
2. Confirm the Auth user exists with `email_confirmed_at IS NULL` and `confirmation_sent_at` set. A successful signup
   response alone is insufficient. Verify there is no employer workspace membership.
3. In the provider's email activity, record the provider message ID, accepted/sent event, recipient, timestamp and any
   delivery/bounce/suppression event. For the selected provider, inspect Brevo's transactional activity log.
4. Have the inbox owner confirm receipt (including spam/junk), timestamp and sender. An SMTP acceptance or provider
   “delivered” event means a mail server accepted the message; only inbox observation proves visible receipt.
5. Follow the newest valid link once, or enter the OTP if that flow was approved. Verify the callback reaches the right
   locale/audience, sets a valid session, and the Auth row gains `email_confirmed_at`.
6. Confirm the representative reaches **Pending admin approval** and still cannot open employer data. The separate
   Employer Access database migration must already be explicitly approved/applied before this Cloud flow is available.
7. With an existing authorized Platform Admin, approve only this controlled request. Confirm the correct registry
   workspace membership is created and the employer reaches that workspace. Check another organization's data is denied.
8. Test one safe resend after the cooldown and one repeat click during it. Verify useful rate-limit messaging, generic
   account-safe success copy, newest-link guidance, and no success claim for an invalid or expired callback.
9. Retain sanitized evidence of steps 2–7 in the release report. Delete or revoke test artifacts only with authorization;
   do not reset production data. Stop if email delivery fails rather than generating repeated registrations.

## References checked

- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): default team-recipient restrictions,
  two/hour built-in limit, SMTP fields and initial custom quota.
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits): quota enforcement and default
  per-user send intervals.
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates): prefetch consumption,
  OTP/manual-action alternatives and link-tracking warnings.
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- [Resend SMTP](https://resend.com/docs/send-with-smtp): verified domain/API key prerequisites, SMTP host,
  ports, username and provider email activity.
- [Brevo sender creation](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email):
  sender creation and six-digit mailbox verification without an authenticated domain.
- [Brevo sender requirements and free-email rewrite](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders):
  provider-authorized transactional rewrite, all-recipient scope, and temporary/basic-deliverability limitations.
- [Brevo SMTP configuration](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP)
  and [SMTP keys](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys):
  server, exact account-specific login, SMTP-key distinction and secure key handling.
- [Brevo SMTP troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP):
  transactional activation and sender-verification requirements.
- [Brevo Free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan):
  300 email sends/day.

These documentation values were checked on 2026-11-10; the active project values still require the configuration
inspection above. No successful external delivery is claimed until the acceptance checklist supplies evidence.
