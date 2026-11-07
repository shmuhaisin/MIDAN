-- Phase 3: an administrator uploads authorized job records, sees what would happen before anything is saved, and saves them.
-- An approved record becomes a draft job of the organization that manages its employer.

/**
 * What importing these rows would do. Changes nothing. Uses the same employer matching and classification as the import, and says
 * for each row whether it's new, an update, unchanged, repeated in this file, or the same job already held from another source.
 */
create function public.admin_preview_listings(p_source_type text, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
  m record;
  c jsonb;
  v_key text;
  v_old public.external_job_listings;
  v_dup uuid;
  v_title text;
  v_employer text;
  v_status text;
  v_registry public.employer_registry;
  v_seen text[] := '{}';
  v_out jsonb := '[]';
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_source_type not in ('employer_career_site', 'employer_provided', 'other_authorized') then raise exception 'Unknown source type' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_title := nullif(trim(coalesce(r ->> 'job_title', '')), '');
    v_employer := coalesce(r ->> 'employer_name_raw', r ->> 'employer_name');
    v_key := p_source_type || ':' || coalesce(nullif(r ->> 'source_job_id', ''), r ->> 'job_url');
    select * into v_old from public.external_job_listings where dedupe_key = v_key;
    select * into m from private.match_employer(v_employer, nullif(r ->> 'company_id', ''));
    c := private.classify_text(concat_ws(' ', v_title, r ->> 'job_description', r ->> 'requirements'));
    select l.id into v_dup from public.external_job_listings l
    where m.registry_id is not null and l.employer_registry_id = m.registry_id and l.dedupe_key <> v_key and l.duplicate_of is null
      and public.normalize_arabic(coalesce(l.title_original, l.title_ar, l.title_en)) = public.normalize_arabic(v_title)
      and coalesce(l.collected_at, l.created_at) > now() - interval '60 days' limit 1;
    v_status := case
      when v_key = any(v_seen) then 'duplicate_in_file'
      when v_dup is not null then 'cross_source_duplicate'
      when v_old.id is null then 'new'
      when v_old.raw_record is not distinct from r then 'unchanged'
      else 'update' end;
    v_seen := v_seen || v_key;
    v_registry := null;
    select * into v_registry from public.employer_registry where id = m.registry_id;
    v_out := v_out || jsonb_build_object(
      'row', (r ->> 'source_row')::integer, 'title', v_title, 'employer', v_employer, 'status', v_status, 'duplicate_of', v_dup,
      'match_status', m.status, 'match_confidence', m.confidence, 'registry_name_ar', v_registry.name_ar, 'registry_name_en', v_registry.name_en,
      'sector_code', c ->> 'sector_code', 'skills', jsonb_array_length(coalesce(c -> 'skills', '[]')));
  end loop;
  return v_out;
end $$;

/** Saves what was previewed, as a recorded import run. Nothing is published here. */
create function public.admin_import_listings(p_source_type text, p_sources jsonb, p_rows jsonb, p_issues jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_run uuid;
  v_counts jsonb;
  v_by text;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_source_type not in ('employer_career_site', 'employer_provided', 'other_authorized') then raise exception 'Unknown source type' using errcode = '22023'; end if;
  select email into v_by from public.users where id = auth.uid();
  v_run := private.begin_import('job_listings', p_sources, 'admin:' || coalesce(v_by, auth.uid()::text));
  v_counts := private.import_listing_batch(v_run, p_source_type, p_rows);
  perform private.record_import_issues(v_run, p_issues);
  perform private.finish_import(v_run, jsonb_build_object('source_type', p_source_type, 'counts', v_counts), null);
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'import', 'import_runs', v_run::text, jsonb_build_object('source_type', p_source_type, 'rows', jsonb_array_length(coalesce(p_rows, '[]'))));
  return jsonb_build_object('run_id', v_run, 'counts', v_counts);
end $$;

revoke all on function public.admin_preview_listings(text, jsonb), public.admin_import_listings(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.admin_preview_listings(text, jsonb), public.admin_import_listings(text, jsonb, jsonb, jsonb) to authenticated;

-- Which record a job came from, so its source stays traceable.
alter table public.jobs add column source_listing_id uuid unique references public.external_job_listings (id) on delete set null;
grant select (source_listing_id) on public.jobs to anon, authenticated;

/**
 * Turns an approved record into a draft job of the organization confirmed as its employer. It's never published here: the organization
 * reviews it first. Only what the source states is copied, and the source's single language fills both title fields. Skills the
 * text mentions are linked as not required, for the organization to confirm.
 */
create function public.convert_listing_to_job(p_listing uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  l public.external_job_listings;
  v_org uuid;
  v_title text;
  v_arabic boolean;
  j public.jobs;
begin
  select * into l from public.external_job_listings where id = p_listing for update;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  select id into v_org from public.organizations where employer_registry_id = l.employer_registry_id;
  if not private.is_platform_admin() and (v_org is null or not private.is_org_member(v_org, array['owner', 'admin']::public.org_role[])) then
    raise exception 'Only a platform administrator or the employer''s organization can do this' using errcode = '42501';
  end if;
  if l.review_status <> 'approved' or l.match_status not in ('matched', 'confirmed') or l.duplicate_of is not null then
    raise exception 'A record is not allowed until it is approved, its employer is confirmed, and it is not a duplicate' using errcode = '23514';
  end if;
  if v_org is null then
    raise exception 'This is not allowed until an organization manages this employer' using errcode = '23514';
  end if;
  if exists (select 1 from public.jobs where source_listing_id = l.id) then
    raise exception 'This record is not open for another job: it has one already' using errcode = '23514';
  end if;
  v_title := coalesce(l.title_original, l.title_ar, l.title_en);
  v_arabic := concat_ws(' ', v_title, l.description_original, l.requirements_original) ~ '[؀-ۿ]';
  insert into public.jobs (org_id, slug, title_ar, title_en, description_ar, description_en, requirements_ar, requirements_en, location, employment_type, sector, status, source_listing_id)
  values (v_org, 'imported-' || left(l.id::text, 8), coalesce(l.title_ar, v_title), coalesce(l.title_en, v_title),
    case when v_arabic then l.description_original end, case when not v_arabic then l.description_original end,
    case when v_arabic then l.requirements_original end, case when not v_arabic then l.requirements_original end,
    l.location,
    case when l.employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'internship', 'flexible') then l.employment_type end,
    l.sector_code, 'draft', l.id)
  returning * into j;
  insert into public.job_reference_skills (job_id, org_id, reference_skill_id, is_required)
  select j.id, v_org, k.reference_skill_id, false from public.external_job_skills k where k.listing_id = l.id on conflict do nothing;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (v_org, auth.uid(), 'convert', 'external_job_listings', l.id::text, jsonb_build_object('job_id', j.id));
  return j;
end $$;
revoke all on function public.convert_listing_to_job(uuid) from public, anon;
grant execute on function public.convert_listing_to_job(uuid) to authenticated;

/** Approved records for the employer this organization is confirmed as, for its owners and admins. */
create function public.organization_listings(p_org uuid) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_member(p_org, array['owner', 'admin']::public.org_role[]) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select jsonb_build_object('id', l.id, 'title', coalesce(l.title_original, l.title_ar, l.title_en), 'location', l.location, 'source_name', l.source_name, 'source_url', l.source_url,
    'collected_at', l.collected_at, 'job_id', (select j.id from public.jobs j where j.source_listing_id = l.id))
  from public.external_job_listings l join public.organizations o on o.employer_registry_id = l.employer_registry_id
  where o.id = p_org and l.review_status = 'approved' and l.match_status in ('matched', 'confirmed') and l.duplicate_of is null
  order by l.created_at desc limit 200;
end $$;
revoke all on function public.organization_listings(uuid) from public, anon;
grant execute on function public.organization_listings(uuid) to authenticated;

-- Same function as in 20261106170000_employer_profiles_and_job_links.sql, apart from leaving out a record once its job is published.
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
    and not exists (select 1 from public.jobs j where j.source_listing_id = l.id and j.status = 'published')
  order by 10 desc nulls last
$$;
