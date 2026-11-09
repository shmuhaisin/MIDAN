# MIDAN UI/UX audit (before the full redesign)

Branch `feature/midan-full-ui-redesign`, cut from `origin/midan-platform-p0` at `d8ea977`, 2026-11-08.
Everything here was read from the source in `apps/web`, not assumed.

## 1. Stack, as found

- Next.js 16 (App Router) with every route under `app/[locale]`, `ar` (RTL, default) and `en` (LTR) via next-intl 4.
- Tailwind 4 with semantic tokens in `src/app/globals.css`; next-themes sets `data-theme` (light, dark, system).
- Motion 14 (`motion/react`) is the only animation library. `MotionConfig reducedMotion="user"` wraps the app.
- Fonts: Noto Kufi Arabic (Arabic display), IBM Plex Sans Arabic (Arabic body), Bricolage Grotesque (English display), IBM Plex Sans (English body).
- Data: server components call the Core API (`lib/api.ts`) with the session cookie; mutations are server actions (`lib/*-actions.ts`).
- A per-request CSP (`lib/csp.ts`, `proxy.ts`): inline styles allowed, inline scripts only with the nonce.
- Brand assets: `public/assets/brand/midan-logo.png` (the approved architectural logo: Riyadh skyline, palms, fountain, and a gold-and-green road sweeping into a doorway) and seven Humaidan PNGs with strict usage rules (`docs/product/humaidan-assets-readme.txt`: whole body, upright, never cropped).

## 2. Route inventory (51 pages + 1 route handler)

| Area | Route | What it does today |
| --- | --- | --- |
| Public | `/` | Hero with Humaidan in a Najdi arch, two flow rails, field explorer (illustrative tasks and levels), audience split, trust list |
| Public | `/about`, `/for-candidates`, `/for-organizations` | `PageHero` + `PointList` |
| Public | `/how-it-works` | `PageHero`, steps, level-scale explorer |
| Public | `/faq` | Accordion |
| Public | `/opportunities` | Search, filters, job list and external listings (`JobsBrowser`) |
| Public | `/opportunities/[id]` | Job detail: requirements, skills, match, apply panel |
| Public | `/employers`, `/employers/[id]` | Employer registry and profile |
| Public | `/get-started` | Redirect |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/check-email`, `/auth/confirmed`, `/auth/callback` (route) | `AuthShell` with candidate (Humaidan) or organization (formal panel) variants |
| Candidate | `/onboarding` | Three steps: basics, CV, skills |
| Candidate | `/dashboard` | Next step, journey rail, deadlines, interviews, applications with withdraw, recommendations, notifications, development, profile completeness, organizations |
| Candidate | `/opportunities/[id]/apply` | Apply with CV check |
| Candidate | `/applications/[id]` | Application detail, attempts, interviews, CV sharing |
| Candidate | `/experience/[orgSlug]/[jobSlug]/[version]` | The branded assessment workspace (`Experience`) |
| Candidate | `/reports/[attemptId]` | Released evaluation report |
| Candidate | `/interviews/[id]` | Interview detail, confirm/reschedule, video room |
| Candidate | `/profile`, `/profile/cv/[id]` | Profile form, skills editor, CV panel and analysis review |
| Candidate | `/development` | Career target, gaps, plan and practice tasks |
| Candidate | `/notifications`, `/invitations`, `/settings` | Lists and settings forms |
| Employer | `/organization/new` | Create organization |
| Employer | `/organization/[orgId]` | Workspace: metrics, jobs with status buttons, listings, applicants with status control |
| Employer | `/organization/[orgId]/jobs/[jobId]` | Job workspace: details, requirements, assessments, versions, tasks, change review, publish |
| Employer | `/organization/[orgId]/applicants/[applicationId]` | Applicant profile, CV, attempts, hiring panel (interviews, outcomes) |
| Employer | `/organization/[orgId]/review/[attemptId]` | Submission review and scoring |
| Employer | `/organization/[orgId]/settings` | Branding (logo, colors, welcome), company type, team, employer claim |
| Admin | `/admin` + `accounts`, `audit`, `claims`, `employers`, `imports`, `imports/[id]`, `learning`, `listings`, `queue`, `reference`, `review` | Platform operations behind `admin/layout.tsx` with `AdminNav` |
| System | `[...rest]`, `not-found`, `error`, `loading` | Fallbacks |

There is no employer reports route: reporting lives inside the job and applicant pages. None will be invented.

## 3. Component inventory

`brand.tsx` (Humaidan, Logo, Parapet, TriangleField, Arrow, JourneyRail, Eyebrow), `ui.tsx` (PageHeader, EmptyState, Badge, statusTone), `page-kit.tsx` (PageHero, PointList), `interactive.tsx` (home sections, Faq, ScaleExplorer), `chrome.tsx` (Providers, Header, theme and locale switches), `candidate-nav.tsx`, `auth-shell.tsx`, `forms.tsx` (ActionForm, Submit, Field, all auth forms, JobForm, BrandingForm, status buttons), and feature modules: `candidate`, `profile`, `jobs-browser`, `requirements`, `experience`, `review`, `workspace`, `hiring-panel`, `applicant-review`, `change-review`, `assessment-intel`, `job-analysis`, `organization-team`, `admin`, `daily-room`.

## 4. Visual problems

1. **Palette**: tokens follow a 2026-11-08 palette with no gold; the owner's redesign brief sets the official palette `#0B3D2E / #1F7A4D / #A7E3C2 / #F7F4E9 / #D4AF37`.
2. **No component layer**: 29 primary buttons, 52 outline pills and 53 inputs are written inline with slightly different paddings, heights and hover states.
3. **Everything is a pill**: `rounded-full` on nearly every control reads as a generic SaaS kit, not as an architectural brand.
4. **The logo is shown at 36–40px**, where its skyline illustration turns to noise, and nowhere at a size that lets it carry the brand.
5. **Flat hierarchy** on working screens: a 1.75rem page title, then lists separated by hairlines. Nothing tells the eye what matters first.
6. **One-note surfaces**: ivory and one surface colour; the deep green appears only in a few bands.

## 5. UX problems

1. The candidate navigation is a thin text tab strip that scrolls sideways on phones; there is no thumb-reachable navigation.
2. The employer workspace has no shell: no persistent organization identity, no navigation between overview, jobs, applicants and settings; settings is reached by an inline link.
3. The organization's own branding (logo, colours) is configured but never shown in the employer's workspace.
4. The dashboard's "next step" competes with six other blocks of equal weight.
5. Status badges use colour alone for warning (a ring) and danger (red text): weak for colour-blind users.
6. The admin area is a text menu with no sense of place.

## 6. Missing or weak states

- One generic skeleton for every route (`loading.tsx`).
- Empty states are a bordered box with text; no guidance or visual.
- Error and not-found pages are centred text and a pill button.
- Disabled buttons are only `opacity-60`.

## 7. Inconsistent patterns

- Container widths: `max-w-5xl`, `6xl` and `7xl` mixed across sibling pages.
- Links styled four ways: underlined primary, plain hover-primary, bold underline, and pill.
- Section headings sometimes `section-title`, sometimes ad hoc `font-display text-2xl`.

## 8. User-facing AI wording (brief: no visible AI identity)

About forty strings name "AI", "model" or "generated" (home trust list, FAQ, review buttons, demo labels, CV privacy notes, admin service status). Several are **privacy and governance disclosures**. They are reworded to drop AI terminology while still saying what they disclose (for example, that personal data is removed before any external analysis service sees a CV, and that people make every decision). Nothing is deleted that tells a user where their data goes.

## 9. Responsive problems

- Header actions collapse into a menu, but the theme and language switches only appear inside it below 640px.
- Tables in the admin area overflow on phones.
- The home hero stacks Humaidan under the copy on phones, pushing the calls to action below the fold.

## 10. Opportunities

- A design layer of named classes (`btn`, `field`, `panel`, `chip`, `kpi`, `table-x`) so every screen speaks one language.
- Distinct shells: an editorial public site, a personal candidate space with a bottom bar on phones, an operational employer workspace with a sidebar that carries the organization's identity, and an admin console.
- The landing page as one continuous scroll journey through an original Saudi landscape, built in SVG (no new raster assets), with the official logo and Humaidan unchanged.
