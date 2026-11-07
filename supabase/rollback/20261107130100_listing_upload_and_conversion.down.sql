-- Rolls back 20261107130100_listing_upload_and_conversion. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Jobs already made from records stay, without the link back to their record.
set local check_function_bodies = off;
drop function public.organization_listings(uuid);
drop function public.convert_listing_to_job(uuid);
drop function public.admin_import_listings(text, jsonb, jsonb, jsonb);
drop function public.admin_preview_listings(text, jsonb);
alter table public.jobs drop column source_listing_id;

create or replace function public.employer_jobs(p_registry uuid)
returns table (kind text, id uuid, title_ar text, title_en text, title_original text, location text, sector text,
  source_name text, source_url text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'midan', j.id, j.title_ar, j.title_en, null, j.location, j.sector, null, null, j.published_at
  from public.jobs j join public.organizations o on o.id = j.org_id
  where o.employer_registry_id = p_registry and j.status = 'published' and not j.is_demo and not o.is_demo and not o.is_test
  union all
  select 'external', l.id, l.title_ar, l.title_en, l.title_original, l.location, l.sector_code, l.source_name, l.source_url, coalesce(l.collected_at, l.created_at)
  from public.external_job_listings l
  where l.employer_registry_id = p_registry and l.published and l.match_status in ('matched', 'confirmed') and l.duplicate_of is null
  order by 10 desc nulls last
$$;
