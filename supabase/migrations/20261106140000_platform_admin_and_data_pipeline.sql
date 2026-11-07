-- Platform administration, a repeatable import pipeline with row-level lineage, and external job ingestion with
-- employer matching and classification against the sector skills reference. Additive: no existing row changes meaning.

-- ---------------------------------------------------------------------------------------------------------------
-- Platform administrators. Not an organization role: a separate, small list, granted only by SQL or by another admin.
create table private.platform_admins (
  user_id uuid primary key references public.users (id) on delete cascade,
  granted_by uuid references public.users (id) on delete set null,
  note text,
  granted_at timestamptz not null default now()
);
revoke all on private.platform_admins from public, anon, authenticated;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = auth.uid())
$$;
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

create function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_platform_admin() $$;
revoke all on function public.am_platform_admin() from public, anon;
grant execute on function public.am_platform_admin() to authenticated;

create function public.admin_list_platform_admins() returns table (user_id uuid, email text, display_name text, granted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  return query select a.user_id, u.email, u.display_name, a.granted_at from private.platform_admins a join public.users u on u.id = a.user_id order by a.granted_at;
end $$;

create function public.admin_set_platform_admin(p_email text, p_grant boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  select id into v_user from public.users where email = lower(trim(p_email));
  if v_user is null then raise exception 'No account with that email' using errcode = 'P0002'; end if;
  if p_grant then
    insert into private.platform_admins (user_id, granted_by) values (v_user, auth.uid()) on conflict do nothing;
  else
    if v_user = auth.uid() then raise exception 'You cannot remove yourself' using errcode = '23514'; end if;
    delete from private.platform_admins where user_id = v_user;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), case when p_grant then 'grant' else 'revoke' end, 'platform_admins', v_user::text, '{}');
end $$;
revoke all on function public.admin_list_platform_admins(), public.admin_set_platform_admin(text, boolean) from public, anon;
grant execute on function public.admin_list_platform_admins(), public.admin_set_platform_admin(text, boolean) to authenticated;

-- Administrators read what they manage. They get no access to CVs, responses, evidence or scores.
create policy "platform admins read" on public.organizations for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.organization_members for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.users for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.audit_logs for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.ai_workflow_runs for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.jobs for select to authenticated using (private.is_platform_admin());

-- ---------------------------------------------------------------------------------------------------------------
-- The import pipeline. Runs and per-record lineage. Only the importer role writes; administrators read.
-- The importer logs in only where an operator sets its password; it can do nothing but call the import functions.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'midan_importer') then
    create role midan_importer nologin noinherit nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sector_skills', 'employer_registry', 'job_listings')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  -- Each source file: name, sha256, and every sheet with how it was handled.
  sources jsonb not null default '[]',
  -- Counts by record status and by entity, computed from import_records when the run finishes.
  stats jsonb not null default '{}',
  -- The extractor's own report: stated totals against what was found, README notes, priority list checks.
  report jsonb not null default '{}',
  started_by text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure text
);
create index on public.import_runs (kind, started_at desc);

create table public.import_records (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.import_runs (id) on delete cascade,
  entity text not null,
  source_file text,
  source_sheet text,
  source_row integer,
  -- What the workbook cell or row held, before cleanup, and what was stored.
  original_value jsonb,
  normalized_value jsonb,
  status text not null check (status in ('imported', 'updated', 'unchanged', 'duplicate', 'rejected', 'ambiguous', 'warning')),
  issue_kind text,
  detail text,
  target_id uuid,
  review_status text check (review_status in ('open', 'accepted', 'dismissed')),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.import_records (run_id, status);
create index on public.import_records (target_id);
create index on public.import_records (review_status) where review_status = 'open';

alter table public.import_runs enable row level security;
alter table public.import_records enable row level security;
create policy "platform admins read" on public.import_runs for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.import_records for select to authenticated using (private.is_platform_admin());
grant select on public.import_runs, public.import_records to authenticated;

-- Lineage on the reference tables themselves.
alter table public.reference_skills
  add column source_value text,
  add column priority_listed boolean not null default false,
  add column last_import_run_id uuid references public.import_runs (id) on delete set null;
alter table public.employer_registry
  add column source_sheet text,
  add column source_row integer,
  add column source_value jsonb,
  -- Brand profile as the workbook states it. Screens use it only when usage_permission says permission is verified.
  add column brand_logo_asset_url text,
  add column brand_primary_hex text,
  add column brand_secondary_hex text,
  add column brand_official_font text,
  add column brand_notes text,
  add column brand_source_row integer,
  add column last_import_run_id uuid references public.import_runs (id) on delete set null,
  add column updated_at timestamptz not null default now();
alter table public.employer_aliases
  add column source_row integer,
  add column added_by uuid references public.users (id) on delete set null,
  add column created_at timestamptz not null default now();
alter table public.employer_sources add column source_row integer;
create index on public.employer_aliases (public.normalize_arabic(name_variant));

create function public.employer_brand_usable(r public.employer_registry) returns boolean
language sql immutable as $$ select r.usage_permission = 'permission_verified' and r.identity_status = 'verified' $$;

create function private.begin_import(p_kind text, p_sources jsonb, p_started_by text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.import_runs (kind, sources, started_by) values (p_kind, coalesce(p_sources, '[]'), coalesce(nullif(p_started_by, ''), 'cli')) returning id
$$;

create function private.record_import(p_run uuid, p_entity text, p_file text, p_sheet text, p_row integer, p_original jsonb, p_normalized jsonb,
  p_status text, p_target uuid, p_issue text default null, p_detail text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.import_records (run_id, entity, source_file, source_sheet, source_row, original_value, normalized_value, status, target_id, issue_kind, detail, review_status)
  values (p_run, p_entity, p_file, p_sheet, p_row, p_original, p_normalized, p_status, p_target, p_issue, p_detail,
    case when p_status in ('ambiguous', 'rejected') then 'open' end)
$$;

-- Skills: one record per skill, keyed by sector, kind and exact name. Same words in two sectors stay two skills.
create function private.import_skill_batch(p_run uuid, p_skills jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_old public.reference_skills;
  v_id uuid;
  v_status text;
  v_counts jsonb := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p_skills, '[]')) loop
    if coalesce(r ->> 'name_ar', '') = '' or r ->> 'skill_kind' not in ('technical', 'general') or coalesce(r ->> 'sector_code', '') = '' then
      perform private.record_import(p_run, 'reference_skill', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
        to_jsonb(r ->> 'source_value'), r - 'contexts', 'rejected', null, 'malformed_record', 'missing name, kind or sector');
      continue;
    end if;
    -- The same key twice in one run is a duplicate in the source. The first one stands.
    if exists (select 1 from public.import_records x join public.reference_skills s on s.id = x.target_id
               where x.run_id = p_run and x.entity = 'reference_skill' and x.status <> 'duplicate'
                 and s.sector_code = r ->> 'sector_code' and s.skill_kind = r ->> 'skill_kind' and s.name_ar = r ->> 'name_ar') then
      perform private.record_import(p_run, 'reference_skill', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
        to_jsonb(r ->> 'source_value'), r - 'contexts', 'duplicate', null, 'duplicate_in_run');
      continue;
    end if;
    select * into v_old from public.reference_skills where sector_code = r ->> 'sector_code' and skill_kind = r ->> 'skill_kind' and name_ar = r ->> 'name_ar';
    insert into public.reference_skills (sector_code, skill_kind, name_ar, description_ar, is_priority, priority_listed, source_file, source_sheet, source_row,
      source_value, listed_subsectors, listed_job_families, last_import_run_id)
    values (r ->> 'sector_code', r ->> 'skill_kind', r ->> 'name_ar', r ->> 'description_ar', (r ->> 'is_priority')::boolean, coalesce((r ->> 'priority_listed')::boolean, false),
      r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer, r ->> 'source_value',
      array(select jsonb_array_elements_text(coalesce(r -> 'listed_subsectors', '[]'))), array(select jsonb_array_elements_text(coalesce(r -> 'listed_job_families', '[]'))), p_run)
    on conflict (sector_code, skill_kind, name_ar) do update set description_ar = excluded.description_ar, is_priority = excluded.is_priority,
      priority_listed = excluded.priority_listed, source_file = excluded.source_file, source_sheet = excluded.source_sheet, source_row = excluded.source_row,
      source_value = excluded.source_value, listed_subsectors = excluded.listed_subsectors, listed_job_families = excluded.listed_job_families,
      last_import_run_id = excluded.last_import_run_id
    returning id into v_id;
    insert into public.reference_skill_contexts select v_id, c ->> 'subsector_ar', c ->> 'job_family_ar', c ->> 'source_sheet' from jsonb_array_elements(coalesce(r -> 'contexts', '[]')) c
      on conflict (skill_id, subsector_ar, job_family_ar) do nothing;
    v_status := case
      when v_old.id is null then 'imported'
      when v_old.description_ar is not distinct from r ->> 'description_ar' and v_old.is_priority is not distinct from (r ->> 'is_priority')::boolean
        and v_old.source_file = r ->> 'source_file' and v_old.source_sheet = r ->> 'source_sheet' and v_old.source_row = (r ->> 'source_row')::integer
        and v_old.listed_subsectors = array(select jsonb_array_elements_text(coalesce(r -> 'listed_subsectors', '[]')))
        and v_old.priority_listed = coalesce((r ->> 'priority_listed')::boolean, false) then 'unchanged'
      else 'updated' end;
    perform private.record_import(p_run, 'reference_skill', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
      to_jsonb(r ->> 'source_value'), jsonb_build_object('name_ar', r ->> 'name_ar', 'sector_code', r ->> 'sector_code', 'skill_kind', r ->> 'skill_kind',
        'contexts', jsonb_array_length(coalesce(r -> 'contexts', '[]'))), v_status, v_id);
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb(coalesce((v_counts ->> v_status)::integer, 0) + 1));
  end loop;
  return v_counts;
end $$;

-- Employers: keyed by the workbook's own company_id, which is kept unchanged.
create function private.import_employer_batch(p_run uuid, p_employers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  a jsonb;
  s jsonb;
  v_old public.employer_registry;
  v_id uuid;
  v_status text;
  v_counts jsonb := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p_employers, '[]')) loop
    if coalesce(r ->> 'company_id', '') = '' or coalesce(r ->> 'name_ar', '') = '' or coalesce(r ->> 'name_en', '') = '' or coalesce(r ->> 'verification_status', '') = '' then
      perform private.record_import(p_run, 'employer', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
        r -> 'source_value', null, 'rejected', null, 'malformed_record', 'missing company_id, a name or verification status');
      continue;
    end if;
    select * into v_old from public.employer_registry where source_company_id = r ->> 'company_id';
    insert into public.employer_registry (source_company_id, name_ar, name_en, entity_type, sector, official_website, career_url, verification_source,
      verification_status, partnership_status, identity_status, usage_permission, notes, source_file, source_sheet, source_row, source_value,
      brand_logo_asset_url, brand_primary_hex, brand_secondary_hex, brand_official_font, brand_notes, brand_source_row, last_import_run_id)
    values (r ->> 'company_id', r ->> 'name_ar', r ->> 'name_en', r ->> 'entity_type', r ->> 'sector', r ->> 'official_website', r ->> 'career_url', r ->> 'verification_source',
      r ->> 'verification_status', coalesce(r ->> 'partnership_status', 'not_partner'), r ->> 'identity_status', r ->> 'usage_permission', r ->> 'notes', r ->> 'source_file',
      r ->> 'source_sheet', (r ->> 'source_row')::integer, r -> 'source_value',
      r -> 'brand' ->> 'logo_asset_url', r -> 'brand' ->> 'primary_hex', r -> 'brand' ->> 'secondary_hex', r -> 'brand' ->> 'official_font', r -> 'brand' ->> 'notes',
      (r ->> 'brand_source_row')::integer, p_run)
    on conflict (source_company_id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, entity_type = excluded.entity_type, sector = excluded.sector,
      official_website = excluded.official_website, career_url = excluded.career_url, verification_source = excluded.verification_source,
      verification_status = excluded.verification_status, partnership_status = excluded.partnership_status, identity_status = excluded.identity_status,
      usage_permission = excluded.usage_permission, notes = excluded.notes, source_file = excluded.source_file, source_sheet = excluded.source_sheet,
      source_row = excluded.source_row, source_value = excluded.source_value, brand_logo_asset_url = excluded.brand_logo_asset_url,
      brand_primary_hex = excluded.brand_primary_hex, brand_secondary_hex = excluded.brand_secondary_hex, brand_official_font = excluded.brand_official_font,
      brand_notes = excluded.brand_notes, brand_source_row = excluded.brand_source_row, last_import_run_id = excluded.last_import_run_id, updated_at = now()
    returning id into v_id;
    v_status := case
      when v_old.id is null then 'imported'
      when v_old.source_value is not distinct from r -> 'source_value' and v_old.source_file = r ->> 'source_file' and v_old.identity_status is not distinct from r ->> 'identity_status'
        and v_old.usage_permission is not distinct from r ->> 'usage_permission' and v_old.brand_notes is not distinct from r -> 'brand' ->> 'notes' then 'unchanged'
      else 'updated' end;
    perform private.record_import(p_run, 'employer', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
      r -> 'source_value', jsonb_build_object('company_id', r ->> 'company_id', 'name_ar', r ->> 'name_ar', 'name_en', r ->> 'name_en',
        'verification_status', r ->> 'verification_status', 'partnership_status', r ->> 'partnership_status'), v_status, v_id);
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb(coalesce((v_counts ->> v_status)::integer, 0) + 1));

    for a in select * from jsonb_array_elements(coalesce(r -> 'aliases', '[]')) loop
      v_status := case when not exists (select 1 from public.employer_aliases x where x.registry_id = v_id and x.name_variant = a ->> 'name_variant') then 'imported'
        when exists (select 1 from public.employer_aliases x where x.registry_id = v_id and x.name_variant = a ->> 'name_variant'
          and x.alias_status = a ->> 'alias_status' and x.language = a ->> 'language') then 'unchanged' else 'updated' end;
      insert into public.employer_aliases (registry_id, name_variant, language, alias_status, source_row)
      values (v_id, a ->> 'name_variant', a ->> 'language', a ->> 'alias_status', (a ->> '_row')::integer)
      on conflict (registry_id, name_variant) do update set alias_status = excluded.alias_status, language = excluded.language, source_row = excluded.source_row;
      perform private.record_import(p_run, 'employer_alias', r ->> 'source_file', 'Employer Aliases', (a ->> '_row')::integer, a - '_row',
        jsonb_build_object('name_variant', a ->> 'name_variant'), v_status, v_id);
    end loop;
    for s in select * from jsonb_array_elements(coalesce(r -> 'sources', '[]')) loop
      v_status := case when not exists (select 1 from public.employer_sources x where x.registry_id = v_id and x.source_url = s ->> 'source_url') then 'imported'
        when exists (select 1 from public.employer_sources x where x.registry_id = v_id and x.source_url = s ->> 'source_url'
          and x.source_type = s ->> 'source_type' and x.checked_on is not distinct from (s ->> 'checked_on')::date) then 'unchanged' else 'updated' end;
      insert into public.employer_sources (registry_id, source_url, source_type, checked_on, source_row)
      values (v_id, s ->> 'source_url', s ->> 'source_type', (s ->> 'checked_on')::date, (s ->> '_row')::integer)
      on conflict (registry_id, source_url) do update set source_type = excluded.source_type, checked_on = excluded.checked_on, source_row = excluded.source_row;
      perform private.record_import(p_run, 'employer_source', r ->> 'source_file', 'Sources', (s ->> '_row')::integer, s - '_row',
        jsonb_build_object('source_url', s ->> 'source_url'), v_status, v_id);
    end loop;
  end loop;
  return v_counts;
end $$;

-- Issues the extractor found are recorded too, so nothing is dropped silently.
create function private.record_import_issues(p_run uuid, p_issues jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare i jsonb; n integer := 0;
begin
  for i in select * from jsonb_array_elements(coalesce(p_issues, '[]')) loop
    perform private.record_import(p_run, 'issue', i ->> 'source_file', i ->> 'source_sheet', (i ->> 'source_row')::integer, to_jsonb(i ->> 'value'), null,
      case
        when i ->> 'kind' in ('duplicate_row', 'duplicate_company_id') then 'duplicate'
        when i ->> 'kind' in ('unknown_company_id', 'malformed_record') then 'rejected'
        when i ->> 'kind' in ('matrix_only_skill', 'priority_flag_disagrees', 'priority_flag_not_on_priority_list', 'priority_skill_not_in_skill_list', 'description_without_listing', 'conflicting_description') then 'ambiguous'
        else 'warning' end,
      null, i ->> 'kind', i ->> 'detail');
    n := n + 1;
  end loop;
  return n;
end $$;

create function private.finish_import(p_run uuid, p_report jsonb, p_failure text default null) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare v public.import_runs; v_kind text;
begin
  select kind into v_kind from public.import_runs where id = p_run;
  if v_kind = 'sector_skills' and p_failure is null then
    -- Names that differ only in hamza, ta marbuta, diacritics or the article: kept apart, sent for review.
    insert into public.import_records (run_id, entity, source_file, source_sheet, source_row, original_value, status, target_id, issue_kind, detail, review_status)
    select p_run, 'reference_skill', s.source_file, s.source_sheet, s.source_row, to_jsonb(s.name_ar), 'ambiguous', s.id, 'near_duplicate_name',
      'spelled like ' || (select string_agg(o.name_ar, '، ') from public.reference_skills o where o.sector_code = s.sector_code and o.skill_kind = s.skill_kind
        and o.name_search = s.name_search and o.id <> s.id) || '; not merged', 'open'
    from public.reference_skills s
    where s.last_import_run_id = p_run and exists (
      select 1 from public.reference_skills o where o.sector_code = s.sector_code and o.skill_kind = s.skill_kind and o.name_search = s.name_search and o.id <> s.id);
  end if;
  update public.import_runs set
    status = case when p_failure is null then 'completed' else 'failed' end,
    failure = p_failure,
    report = coalesce(p_report, '{}'),
    finished_at = now(),
    stats = (select jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.import_records where run_id = p_run group by status) x), '{}'),
      'by_entity', coalesce((select jsonb_object_agg(entity, n) from (select entity, count(*) n from public.import_records where run_id = p_run and entity <> 'issue' group by entity) x), '{}'),
      'issues', coalesce((select jsonb_object_agg(issue_kind, n) from (select issue_kind, count(*) n from public.import_records where run_id = p_run and issue_kind is not null group by issue_kind) x), '{}')))
  where id = p_run returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- External job listings: collected from authorized sources, kept as collected, matched and classified, then reviewed.
alter table public.external_job_listings
  alter column title_ar drop not null,
  alter column title_en drop not null,
  add column title_original text,
  add column description_original text,
  add column requirements_original text,
  add column employer_name_raw text,
  add column source_type text not null default 'other_authorized'
    check (source_type in ('employer_career_site', 'employer_provided', 'other_authorized')),
  add column source_job_id text,
  add column collected_at timestamptz,
  add column raw_record jsonb,
  add column import_run_id uuid references public.import_runs (id) on delete set null,
  add column dedupe_key text,
  add column duplicate_of uuid references public.external_job_listings (id) on delete set null,
  add column match_status text not null default 'unmatched' check (match_status in ('matched', 'uncertain', 'unmatched', 'confirmed', 'rejected')),
  add column match_confidence numeric(4, 3),
  add column match_evidence jsonb,
  add column sector_code text,
  add column subsector_ar text,
  add column job_family_ar text,
  add column classification jsonb,
  add column review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  add column reviewed_by uuid references public.users (id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_note text,
  add column updated_at timestamptz not null default now();
alter table public.external_job_listings add constraint external_listing_has_title check (coalesce(title_original, title_ar, title_en) is not null);
create unique index external_job_listings_dedupe on public.external_job_listings (dedupe_key) where dedupe_key is not null;
create index on public.external_job_listings (review_status);
create index on public.external_job_listings (employer_registry_id);

create table public.external_job_skills (
  listing_id uuid not null references public.external_job_listings (id) on delete cascade,
  reference_skill_id uuid not null references public.reference_skills (id),
  evidence text not null,
  primary key (listing_id, reference_skill_id)
);
alter table public.external_job_skills enable row level security;
create policy "anyone reads for published listings" on public.external_job_skills for select to anon, authenticated using (
  exists (select 1 from public.external_job_listings l where l.id = listing_id and l.published)
);
create policy "platform admins read" on public.external_job_skills for select to authenticated using (private.is_platform_admin());
create policy "platform admins read" on public.external_job_listings for select to authenticated using (private.is_platform_admin());
grant select on public.external_job_skills to anon, authenticated;

-- Nothing is published without an approved review, and a published listing must link to its employer.
create function private.guard_external_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published and (new.review_status <> 'approved' or new.match_status not in ('matched', 'confirmed') or new.duplicate_of is not null) then
    raise exception 'A listing is published only after review, with a confirmed employer, and when it is not a duplicate' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_external_listing before insert or update on public.external_job_listings for each row execute function private.guard_external_listing();

/**
 * Matches a collected employer name against the registry. Every rule and its confidence is fixed here:
 *   1.000  the source gave a company_id that exists, and the name agrees with that entity
 *   1.000  exact name, or an alias the workbook marks official
 *   0.900  an alias the workbook marks common, or one an administrator confirmed
 *   0.600  an alias the workbook marks for manual review or as ambiguous (uncertain: a person decides)
 *   0.600  one entity whose name contains, or is contained in, the collected name (uncertain)
 *   0.400  several entities match that way (uncertain)
 * Names are compared after public.normalize_arabic, and English names case-insensitively.
 * Matched means at least 0.9. Anything uncertain goes to an administrator.
 */
create function private.match_employer(p_name text, p_company_id text default null)
returns table (registry_id uuid, confidence numeric, status text, evidence jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  n text := public.normalize_arabic(p_name);
  v_hit record;
  v_count integer;
begin
  if p_company_id is not null then
    select e.id, e.name_ar, e.name_en into v_hit from public.employer_registry e where e.source_company_id = p_company_id;
    if v_hit.id is not null then
      if p_name is null or public.normalize_arabic(v_hit.name_ar) = n or lower(v_hit.name_en) = lower(trim(p_name))
         or exists (select 1 from public.employer_aliases a where a.registry_id = v_hit.id and public.normalize_arabic(a.name_variant) = n) then
        return query select v_hit.id, 1.000::numeric, 'matched', jsonb_build_object('rule', 'source_company_id', 'company_id', p_company_id);
      else
        return query select v_hit.id, 0.600::numeric, 'uncertain', jsonb_build_object('rule', 'source_company_id_name_disagrees', 'company_id', p_company_id, 'collected_name', p_name);
      end if;
      return;
    end if;
  end if;
  if coalesce(n, '') = '' then
    return query select null::uuid, 0::numeric, 'unmatched', jsonb_build_object('rule', 'no_name');
    return;
  end if;

  select e.id, 'official_name' as rule, e.name_ar as matched into v_hit from public.employer_registry e
  where public.normalize_arabic(e.name_ar) = n or lower(e.name_en) = lower(trim(p_name)) limit 1;
  if v_hit.id is null then
    select a.registry_id as id, 'alias_' || a.alias_status as rule, a.name_variant as matched into v_hit from public.employer_aliases a
    where public.normalize_arabic(a.name_variant) = n or lower(a.name_variant) = lower(trim(p_name))
    order by (a.alias_status = 'official') desc, (a.alias_status in ('common', 'admin_confirmed')) desc limit 1;
  end if;
  if v_hit.id is not null then
    if v_hit.rule in ('official_name', 'alias_official', 'alias_common', 'alias_admin_confirmed') then
      return query select v_hit.id, (case when v_hit.rule in ('official_name', 'alias_official') then 1.000 else 0.900 end)::numeric, 'matched',
        jsonb_build_object('rule', v_hit.rule, 'matched_text', v_hit.matched);
    else
      -- The source itself says this name needs a person, for example a name two different entities share.
      return query select v_hit.id, 0.600::numeric, 'uncertain',
        jsonb_build_object('rule', 'alias_needs_review', 'alias_status', substr(v_hit.rule, 7), 'matched_text', v_hit.matched,
          'candidates', (select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en)) from public.employer_registry c where c.id = v_hit.id));
    end if;
    return;
  end if;

  select count(*) into v_count from public.employer_registry e
  where length(n) >= 4 and (strpos(public.normalize_arabic(e.name_ar), n) > 0 or strpos(n, public.normalize_arabic(e.name_ar)) > 0
    or exists (select 1 from public.employer_aliases a where a.registry_id = e.id and length(a.name_variant) >= 4
      and (strpos(public.normalize_arabic(a.name_variant), n) > 0 or strpos(n, public.normalize_arabic(a.name_variant)) > 0)));
  if v_count >= 1 then
    return query select (case when v_count = 1 then e.id end), (case when v_count = 1 then 0.600 else 0.400 end)::numeric, 'uncertain',
      jsonb_build_object('rule', 'partial_name', 'candidates', (select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en))
        from public.employer_registry c where strpos(public.normalize_arabic(c.name_ar), n) > 0 or strpos(n, public.normalize_arabic(c.name_ar)) > 0
          or exists (select 1 from public.employer_aliases a where a.registry_id = c.id and length(a.name_variant) >= 4
            and (strpos(public.normalize_arabic(a.name_variant), n) > 0 or strpos(n, public.normalize_arabic(a.name_variant)) > 0))))
    from public.employer_registry e
    where strpos(public.normalize_arabic(e.name_ar), n) > 0 or strpos(n, public.normalize_arabic(e.name_ar)) > 0
       or exists (select 1 from public.employer_aliases a where a.registry_id = e.id and length(a.name_variant) >= 4
         and (strpos(public.normalize_arabic(a.name_variant), n) > 0 or strpos(n, public.normalize_arabic(a.name_variant)) > 0))
    limit 1;
    return;
  end if;
  return query select null::uuid, 0::numeric, 'unmatched', jsonb_build_object('rule', 'no_registry_match', 'collected_name', p_name);
end $$;

/** Text prepared for whole-word matching: punctuation becomes space, then Arabic is normalized, padded with spaces. */
create function private.match_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select ' ' || public.normalize_arabic(regexp_replace(coalesce(p, ''), '[.,;:!?()\[\]{}"''«»،؛؟/\\|_+=*&^%$#@~`<>\-]+', ' ', 'g')) || ' '
$$;

/** True when prepared text (from private.match_text) names the skill as whole words, alone or after the conjunction «و»
 * (also «وال», since the article is removed from names but not after «و»). Other attached letters aren't treated as prefixes:
 * «ب» or «ل» begin too many ordinary words. */
create function private.mentions(p_body text, p_name text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  with n as (select trim(private.match_text(p_name)) as v)
  -- The «و» forms only for names long enough that «و» + name can't be an ordinary word (as «وصف» is not «و» + «صف»).
  select n.v <> '' and (strpos(p_body, ' ' || n.v || ' ') > 0
    or ((strpos(n.v, ' ') > 0 or length(n.v) >= 6) and (strpos(p_body, ' و' || n.v || ' ') > 0 or strpos(p_body, ' وال' || n.v || ' ') > 0))) from n
$$;

/**
 * Classifies text against the sector skills reference by literal mentions, after public.normalize_arabic.
 * Only skill names of at least two words or eight letters count, so short common words don't match everything.
 * The sector is the one with the most mentioned skills; confidence is its share of all mentions. The job family and
 * sub-sector are the ones most often paired with those skills in the workbooks. Fewer than two mentions: unclassified.
 * This finds what a listing names; it doesn't infer skills a listing doesn't mention.
 */
create function private.classify_text(p_text text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with t as (select private.match_text(p_text) as body),
  hits as (
    select s.id, s.sector_code, s.name_ar, trim(private.match_text(s.name_ar)) as name_search from public.reference_skills s, t
    where (strpos(s.name_search, ' ') > 0 or length(s.name_search) >= 8)
      and private.mentions(t.body, s.name_ar)
  ),
  by_sector as (select sector_code, count(*) n from hits group by sector_code),
  best as (select sector_code, n from by_sector order by n desc, sector_code limit 1),
  family as (
    select c.job_family_ar, c.subsector_ar, count(*) n from hits h join best b on b.sector_code = h.sector_code
    join public.reference_skill_contexts c on c.skill_id = h.id group by 1, 2 order by n desc, 1 limit 1
  )
  select jsonb_build_object(
    'method', 'reference_skill_mentions_v1',
    'mentions', (select count(*) from hits),
    'by_sector', coalesce((select jsonb_object_agg(sector_code, n) from by_sector), '{}'),
    'sector_code', case when (select count(*) from hits) >= 2 then (select sector_code from best) end,
    'confidence', case when (select count(*) from hits) >= 2 then round((select n from best)::numeric / (select count(*) from hits), 3) end,
    'job_family_ar', case when (select count(*) from hits) >= 2 then (select job_family_ar from family) end,
    'subsector_ar', case when (select count(*) from hits) >= 2 then (select subsector_ar from family) end,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name_ar', h.name_ar, 'evidence', h.name_search))
      from hits h join best b on b.sector_code = h.sector_code), '[]')
  )
$$;

/** Imports collected listings. Re-importing the same source job updates it in place. Nothing is published here. */
create function private.import_listing_batch(p_run uuid, p_source_type text, p_listings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  m record;
  c jsonb;
  v_key text;
  v_old public.external_job_listings;
  v_id uuid;
  v_title text;
  v_url text;
  v_dup uuid;
  v_status text;
  v_counts jsonb := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p_listings, '[]')) loop
    v_title := nullif(trim(coalesce(r ->> 'job_title', r ->> 'title')), '');
    v_url := nullif(trim(coalesce(r ->> 'job_url', r ->> 'source_url')), '');
    if v_title is null or v_url is null or v_url !~ '^https://' then
      perform private.record_import(p_run, 'job_listing', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer, r, null, 'rejected', null,
        'malformed_record', 'needs a title and an https source link');
      v_counts := jsonb_set(v_counts, '{rejected}', to_jsonb(coalesce((v_counts ->> 'rejected')::integer, 0) + 1));
      continue;
    end if;
    v_key := p_source_type || ':' || coalesce(nullif(r ->> 'source_job_id', ''), v_url);
    select * into v_old from public.external_job_listings where dedupe_key = v_key;
    select * into m from private.match_employer(coalesce(r ->> 'employer_name_raw', r ->> 'employer_name'), nullif(r ->> 'company_id', ''));
    c := private.classify_text(concat_ws(' ', v_title, r ->> 'job_description', r ->> 'requirements'));
    -- The same job from another source: same employer and the same title, collected within 60 days.
    select l.id into v_dup from public.external_job_listings l
    where m.registry_id is not null and l.employer_registry_id = m.registry_id and l.dedupe_key <> v_key and l.duplicate_of is null
      and public.normalize_arabic(coalesce(l.title_original, l.title_ar, l.title_en)) = public.normalize_arabic(v_title)
      and coalesce(l.collected_at, l.created_at) > now() - interval '60 days' limit 1;

    insert into public.external_job_listings (employer_registry_id, employer_name_raw, title_original, description_original, requirements_original,
      source_type, source_name, source_url, source_job_id, collected_at, raw_record, import_run_id, dedupe_key, duplicate_of,
      match_status, match_confidence, match_evidence, sector_code, subsector_ar, job_family_ar, classification, location, employment_type)
    values (m.registry_id, coalesce(r ->> 'employer_name_raw', r ->> 'employer_name'), v_title, r ->> 'job_description', r ->> 'requirements',
      p_source_type, coalesce(r ->> 'source_name', p_source_type), v_url, r ->> 'source_job_id',
      coalesce((r ->> 'scraped_at')::timestamptz, (r ->> 'collected_at')::timestamptz), r, p_run, v_key, v_dup,
      m.status, m.confidence, m.evidence, c ->> 'sector_code', c ->> 'subsector_ar', c ->> 'job_family_ar', c,
      -- Only what the source states. Nothing is filled in.
      nullif(r ->> 'location', ''), nullif(r ->> 'employment_type', ''))
    on conflict (dedupe_key) where dedupe_key is not null do update set employer_registry_id = case when public.external_job_listings.match_status in ('confirmed', 'rejected')
        then public.external_job_listings.employer_registry_id else excluded.employer_registry_id end,
      employer_name_raw = excluded.employer_name_raw, title_original = excluded.title_original, description_original = excluded.description_original,
      requirements_original = excluded.requirements_original, source_url = excluded.source_url, collected_at = excluded.collected_at, raw_record = excluded.raw_record,
      import_run_id = excluded.import_run_id,
      match_status = case when public.external_job_listings.match_status in ('confirmed', 'rejected') then public.external_job_listings.match_status else excluded.match_status end,
      match_confidence = excluded.match_confidence, match_evidence = excluded.match_evidence, sector_code = excluded.sector_code, subsector_ar = excluded.subsector_ar,
      job_family_ar = excluded.job_family_ar, classification = excluded.classification, location = excluded.location, employment_type = excluded.employment_type
    returning id into v_id;
    delete from public.external_job_skills where listing_id = v_id;
    insert into public.external_job_skills (listing_id, reference_skill_id, evidence)
    select v_id, (s ->> 'id')::uuid, s ->> 'evidence' from jsonb_array_elements(c -> 'skills') s on conflict do nothing;

    v_status := case when v_old.id is null then 'imported' when v_old.raw_record is not distinct from r then 'unchanged' else 'updated' end;
    perform private.record_import(p_run, 'job_listing', r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer, r,
      jsonb_build_object('match_status', m.status, 'match_confidence', m.confidence, 'sector_code', c ->> 'sector_code', 'duplicate_of', v_dup),
      case when v_dup is not null then 'duplicate' when m.status <> 'matched' then 'ambiguous' else v_status end, v_id,
      case when v_dup is not null then 'cross_source_duplicate' when m.status = 'uncertain' then 'uncertain_employer_match' when m.status = 'unmatched' then 'employer_not_in_registry' end);
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb(coalesce((v_counts ->> v_status)::integer, 0) + 1));
  end loop;
  return v_counts;
end $$;

-- Administrators review: confirm or change the employer, reject the match, approve or reject the listing, publish.
create function public.admin_review_listing(p_listing uuid, p_action text, p_registry uuid default null, p_note text default null)
returns public.external_job_listings language plpgsql security definer set search_path = '' as $$
declare l public.external_job_listings;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  select * into l from public.external_job_listings where id = p_listing for update;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  if p_action = 'confirm_employer' then
    if coalesce(p_registry, l.employer_registry_id) is null then raise exception 'Choose an employer' using errcode = '23514'; end if;
    update public.external_job_listings set employer_registry_id = coalesce(p_registry, l.employer_registry_id), match_status = 'confirmed',
      match_evidence = coalesce(match_evidence, '{}') || jsonb_build_object('confirmed_by_admin', true) where id = l.id returning * into l;
  elsif p_action = 'reject_employer' then
    update public.external_job_listings set employer_registry_id = null, match_status = 'rejected', published = false where id = l.id returning * into l;
  elsif p_action = 'approve' then
    update public.external_job_listings set review_status = 'approved' where id = l.id returning * into l;
  elsif p_action = 'reject' then
    update public.external_job_listings set review_status = 'rejected', published = false where id = l.id returning * into l;
  elsif p_action = 'publish' then
    update public.external_job_listings set published = true where id = l.id returning * into l;
  elsif p_action = 'unpublish' then
    update public.external_job_listings set published = false where id = l.id returning * into l;
  elsif p_action = 'not_duplicate' then
    update public.external_job_listings set duplicate_of = null where id = l.id returning * into l;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  update public.external_job_listings set reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(left(p_note, 1000), review_note) where id = l.id returning * into l;
  update public.import_records set review_status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
  where target_id = l.id and review_status = 'open' and p_action in ('confirm_employer', 'approve', 'not_duplicate');
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, 'external_job_listings', l.id::text, jsonb_strip_nulls(jsonb_build_object('registry_id', p_registry, 'note', left(p_note, 200))));
  return l;
end $$;

create function public.admin_resolve_import_record(p_record bigint, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_resolution not in ('accepted', 'dismissed') then raise exception 'Unknown resolution' using errcode = '22023'; end if;
  update public.import_records set review_status = p_resolution, reviewed_by = auth.uid(), reviewed_at = now() where id = p_record and review_status = 'open';
  if not found then raise exception 'Nothing open to resolve' using errcode = 'P0002'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), p_resolution, 'import_records', p_record::text, '{}');
end $$;

-- An alias an administrator confirms. It never changes the workbook's own identity fields or partnership status.
create function public.admin_add_employer_alias(p_registry uuid, p_name text, p_language text) returns public.employer_aliases
language plpgsql security definer set search_path = '' as $$
declare a public.employer_aliases;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' or p_language not in ('ar', 'en') then raise exception 'A name and a language are needed' using errcode = '22023'; end if;
  insert into public.employer_aliases (registry_id, name_variant, language, alias_status, added_by)
  values (p_registry, trim(p_name), p_language, 'admin_confirmed', auth.uid()) returning * into a;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), 'insert', 'employer_aliases', p_registry::text, jsonb_build_object('name', trim(p_name)));
  return a;
end $$;

revoke all on function private.begin_import(text, jsonb, text), private.record_import(uuid, text, text, text, integer, jsonb, jsonb, text, uuid, text, text),
  private.import_skill_batch(uuid, jsonb), private.import_employer_batch(uuid, jsonb), private.record_import_issues(uuid, jsonb),
  private.finish_import(uuid, jsonb, text), private.import_listing_batch(uuid, text, jsonb), private.match_employer(text, text), private.classify_text(text)
  from public, anon, authenticated;
grant usage on schema private to midan_importer;
grant execute on function private.begin_import(text, jsonb, text), private.import_skill_batch(uuid, jsonb), private.import_employer_batch(uuid, jsonb),
  private.record_import_issues(uuid, jsonb), private.finish_import(uuid, jsonb, text), private.import_listing_batch(uuid, text, jsonb) to midan_importer;
revoke all on function public.admin_review_listing(uuid, text, uuid, text), public.admin_resolve_import_record(bigint, text),
  public.admin_add_employer_alias(uuid, text, text) from public, anon;
grant execute on function public.admin_review_listing(uuid, text, uuid, text), public.admin_resolve_import_record(bigint, text),
  public.admin_add_employer_alias(uuid, text, text) to authenticated;

-- The old one-shot import stays callable for compatibility, but new imports go through the pipeline above.
comment on function private.import_reference_data(jsonb) is 'Superseded by private.begin_import and the batch functions, which record lineage.';
