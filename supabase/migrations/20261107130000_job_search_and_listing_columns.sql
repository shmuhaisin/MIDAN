-- Phase 3: search across a job's title, description and requirements, in either language. Arabic is compared after
-- public.normalize_arabic, so spellings of hamza and ta marbuta and the article don't hide a result.
alter table public.jobs add column search_text text generated always as (public.normalize_arabic(
  coalesce(title_ar, '') || ' ' || coalesce(title_en, '') || ' ' || coalesce(description_ar, '') || ' ' || coalesce(description_en, '') || ' ' || coalesce(requirements_ar, '') || ' ' || coalesce(requirements_en, '')
)) stored;
alter table public.job_requirements add column search_text text generated always as (public.normalize_arabic(
  coalesce(description_ar, '') || ' ' || coalesce(description_en, '')
)) stored;
alter table public.external_job_listings add column search_text text generated always as (public.normalize_arabic(
  coalesce(title_original, '') || ' ' || coalesce(title_ar, '') || ' ' || coalesce(title_en, '') || ' ' || coalesce(description_original, '') || ' ' || coalesce(requirements_original, '')
)) stored;
grant select (search_text) on public.jobs, public.job_requirements to anon, authenticated;

-- A published listing was readable column by column, including the raw source record, internal review notes and who reviewed
-- it. The public gets what a visitor needs. Administrators read everything through public.admin_listings.
revoke select on public.external_job_listings from anon, authenticated;
grant select (id, employer_registry_id, employer_name_ar, employer_name_en, title_ar, title_en, title_original, description_original, requirements_original,
  location, sector, sector_code, employment_type, source_name, source_url, source_type, published, is_demo, collected_at, created_at, match_status, review_status, search_text)
  on public.external_job_listings to anon, authenticated;

create function public.admin_listings(p_review text default null) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  return query
  select jsonb_build_object(
    'id', l.id, 'title_original', l.title_original, 'title_ar', l.title_ar, 'title_en', l.title_en, 'employer_name_raw', l.employer_name_raw, 'source_type', l.source_type,
    'source_name', l.source_name, 'source_url', l.source_url, 'source_job_id', l.source_job_id, 'collected_at', l.collected_at, 'match_status', l.match_status,
    'match_confidence', l.match_confidence, 'match_evidence', l.match_evidence, 'sector_code', l.sector_code, 'subsector_ar', l.subsector_ar, 'job_family_ar', l.job_family_ar,
    'classification_confidence', l.classification -> 'confidence', 'mentions', l.classification -> 'mentions', 'review_status', l.review_status, 'published', l.published,
    'duplicate_of', l.duplicate_of, 'reviewed_at', l.reviewed_at, 'review_note', l.review_note, 'location', l.location, 'employment_type', l.employment_type,
    'registry_id', e.id, 'registry_name_ar', e.name_ar, 'registry_name_en', e.name_en, 'source_company_id', e.source_company_id,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('name_ar', s.name_ar, 'evidence', k.evidence)) from public.external_job_skills k
      join public.reference_skills s on s.id = k.reference_skill_id where k.listing_id = l.id), '[]')
  )
  from public.external_job_listings l left join public.employer_registry e on e.id = l.employer_registry_id
  where p_review is null or l.review_status = p_review order by l.created_at desc limit 300;
end $$;
revoke all on function public.admin_listings(text) from public, anon;
grant execute on function public.admin_listings(text) to authenticated;
