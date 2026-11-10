-- Company identity read from the logo (feature/midan-product-experience). Local only until the owner approves it for Cloud.
--
-- When a representative uploads the logo, the API reads its colours (apps/api/src/organizations/brand-palette.ts) and
-- stores them in `palette` as a suggestion: the logo's primary, secondary and accent colours, the swatches they came
-- from, and light and dark themes derived from them that meet WCAG AA. Nothing changes in the workspace until an owner
-- or admin approves it; the approved palette is then copied to `applied_palette`, which is what themes the workspace,
-- and its colours fill primary_color, secondary_color and accent_color, which the public job posting and the
-- assessment screens already read. A later logo makes a new suggestion without unbranding the workspace: the applied
-- palette stays until the new one is approved. Colours can be chosen only from the logo's own swatches, never typed.
alter table public.organization_branding
  add column secondary_color text check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column palette jsonb check (palette is null or (jsonb_typeof(palette) = 'object' and palette ? 'version' and palette ? 'light' and palette ? 'dark')),
  add column palette_status text check (palette_status in ('suggested', 'approved')),
  add column applied_palette jsonb check (applied_palette is null or (jsonb_typeof(applied_palette) = 'object' and applied_palette ? 'light' and applied_palette ? 'dark')),
  -- The logo the palette was read from: a new logo makes the old palette a suggestion to review again.
  add column palette_logo_path text,
  add column palette_approved_at timestamptz,
  add column palette_approved_by uuid references public.users (id) on delete set null;
