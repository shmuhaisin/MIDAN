# Auth email templates (Supabase Cloud)

Bilingual (Arabic first, then English) templates for the emails Supabase Auth sends. They contain no provider-specific
code: paste each into Supabase Dashboard > Authentication > Emails > Templates, with its subject. The project's own
configured sender (built-in or custom SMTP) sends them.

| File | Dashboard template | Subject |
| --- | --- | --- |
| `confirmation.html` | Confirm signup (also used when a new confirmation link is requested) | تأكيد بريدك في ميدان \| Confirm your MIDAN email |
| `recovery.html` | Reset password | إعادة تعيين كلمة المرور في ميدان \| Reset your MIDAN password |

They use Supabase Auth's template variable `{{ .ConfirmationURL }}`. Table layout and inline styles only, for email
clients; no images, scripts or internal details. Brand colours: deep green #0B3D2E, green #1F7A4D, mint #A7E3C2,
off-white #F7F4E9, gold #D4AF37. See `docs/supabase-cloud.md`.
