-- Which Humaidan a candidate sees comes from a saved professional field, never from a free choice of image.
-- Assessment field first, then the organization's industry, then Original (resolved in apps/web/src/lib/humaidan.ts).
-- Media and marketing are fields of their own, and they always resolve to Original.
alter table public.organization_branding
  add column industry text check (industry in (
    'general', 'finance', 'legal', 'engineering', 'technology', 'events', 'healthcare', 'media', 'marketing'
  ));

alter table public.assessments
  add column professional_field text check (professional_field in (
    'general', 'finance', 'legal', 'engineering', 'technology', 'events', 'healthcare', 'media', 'marketing'
  ));
