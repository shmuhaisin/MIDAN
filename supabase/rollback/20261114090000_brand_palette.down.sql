-- Rollback of 20261114090000_brand_palette.sql: extracted palettes are dropped; logos and the two original colours stay.
alter table public.organization_branding
  drop column if exists palette_approved_by,
  drop column if exists palette_approved_at,
  drop column if exists palette_logo_path,
  drop column if exists applied_palette,
  drop column if exists palette_status,
  drop column if exists palette,
  drop column if exists secondary_color;
