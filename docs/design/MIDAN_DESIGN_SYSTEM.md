# MIDAN design system

Branch `feature/midan-full-ui-redesign`. Source of truth: `apps/web/src/app/globals.css` (tokens and named classes) and the shared components listed below. `apps/web/src/lib/palette.test.ts` guards the palette.

## 1. Palette (owner decision, 2026-11-09)

| Token | Value | Use |
| --- | --- | --- |
| `--brand-deep` | `#0B3D2E` | Deep surfaces (destination, decision and admin panels), primary buttons (`--button`), headings on light |
| `--brand-green` | `#1F7A4D` | Primary actions and links on light, success, focus ring |
| `--brand-mint` | `#A7E3C2` | Accents; primary colour in the dark theme |
| `--brand-ivory` | `#F7F4E9` | Page background (light); text on deep surfaces |
| `--brand-gold` | `#D4AF37` | Restrained accent only: rules, markers, the current step, one call to action on a deep surface. Never body text on a light surface: use `--gold-text` (`#7A5F00`) there |

Supporting shades are tints and shades of these: ink `#0F2A20`, surfaces `#FFFDF6` / `#EFEBDC` / `#E5DFCA`, muted text `#4B6157`. The dark theme (`[data-theme='dark']`) keeps the brand: background `#071C15`, mint for action, gold for accents.

Semantic tokens: `--success`, `--warning`, `--error`, `--info`, each with a `-surface`. Status never relies on colour alone: badges carry a word, and the stage track carries a position.

## 2. Type

| Role | Arabic | English |
| --- | --- | --- |
| Display (`font-display`, `.display-xl`, `.display-lg`, `.section-title`) | Noto Kufi Arabic | Bricolage Grotesque |
| Body (`font-sans`) | IBM Plex Sans Arabic | IBM Plex Sans |

The stacks swap by `lang`, so mixed text (an Arabic job family in an English page) falls back to the right face. Numbers use `.num` (tabular). Arabic pages show Arabic-Indic digits through `number(locale, …)`; ICU plural arguments always get the raw number.

## 3. Named classes

`btn` (`btn-primary`, `btn-secondary`, `btn-gold`, `btn-mint`, `btn-ghost`, `btn-outline-light`, `btn-danger`, `btn-sm`, `btn-lg`, `btn-block`) · `input`, `field-label`, `field-hint` · `panel`, `panel-head`, `panel-body` · `card` · `chip` · `callout` · `label-caps` · `display-xl`, `display-lg`, `page-title`, `section-title`, `subsection-title` · `kpi-value` · `table-x` (scrolls on phones) · `skeleton` · `on-deep` (focus ring for deep surfaces) · `deep-grain` · `link`.

Radii are architectural rather than pill-shaped: `--radius-control` 6px, `--radius-panel` 8px.

## 4. Shared components

| Component | File | Purpose |
| --- | --- | --- |
| `Masthead`, `Panel`, `Segmented`, `StageBar`, `StageMeter`, `LaneTrack`, `DateTile` | `components/workspace-kit.tsx` | The vocabulary of the signed-in workspaces |
| `JourneyRoad`, `StageTrack` | `components/journey-track.tsx` | Progress as a road of stations (diamond markers, gold for the current one) |
| `Guide` | `components/guide.tsx` | Humaidan as a short, optional guide, for candidates only, never a chat |
| `Kpi`, `BarList`, `ColumnChart`, `StageStrip` | `components/charts.tsx`, `command-charts.tsx` | Charts with captions, built from counts only |
| `StatusScreen` | `components/status-screen.tsx` | Error, not-found and permission screens |
| `Badge`, `Stepper`, `Timeline`, `EmptyState`, `Skeleton`, `Meter` | `components/ui.tsx` | Primitives |
| `Field` (with a show/hide toggle for passwords), `ActionForm`, `Submit`, `ErrorText`, `useAction` | `components/forms.tsx` | Forms and server actions |
| `Destination`, `EvidenceSummary`, `SkillLine`, `Tally` | `components/career.tsx` | The career journey (server-rendered) |
| `CareerNav`, `ChooseRoleButton`, `LevelLadder` | `components/career-client.tsx` | The career journey (interactive) |
| `Icon` | `components/icons.tsx` | One stroke icon set. Direction-aware icons flip in RTL |

## 5. Shells

- **Public**: an editorial site, with the 3D landing journey (`components/journey/`), the official logo and Humaidan unchanged.
- **Candidate**: a personal space with the candidate bar on wide screens and a five-tab bar at the thumb on phones (Overview, My career, Opportunities, My applications, My profile). The rest is in the menu.
- **Career journey**: its own numbered sub-navigation (Journey, Roles, Skills and gaps, Learning, Practice and evidence, Skill levels) under the candidate bar.
- **Employer**: an operational workspace with a sidebar that carries the organization's logo and colours, scoped to its own workspace.
- **Admin**: a console behind `admin/layout.tsx`, separate from employer settings.

## 6. Rules the interface keeps

- RTL and LTR from the same markup: logical properties (`ms`, `me`, `ps`, `pe`, `start`, `end`), `<bdi>` around mixed-direction names, `dir="rtl"` on Arabic-only source text inside English pages.
- Light, dark and system themes through `next-themes` (`data-theme`).
- Motion through `motion/react`, with `reducedMotion="user"`.
- No user-facing AI wording. Privacy and governance disclosures keep their substance in plain terms.
- No invented numbers: every figure is a count of real records, and every missing capability is named, not faked (see `MIDAN_FRONTEND_BACKEND_HANDOFF.md`).
