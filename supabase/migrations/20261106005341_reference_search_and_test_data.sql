-- Arabic search that doesn't depend on exact spelling, the lists the workbooks state for each skill, and a real
-- separation between fixtures created by automated tests and everything else.

create function public.normalize_arabic(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(lower(coalesce(p, '')), '[ً-ٰٟـ]', '', 'g'),
        'أإآٱىؤئة', 'ااااييويه'
      ),
      '(^|\s)ال(?=\S{2,})', '\1', 'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;
grant execute on function public.normalize_arabic(text) to anon, authenticated;

alter table public.reference_skills
  add column listed_subsectors text[] not null default '{}',
  add column listed_job_families text[] not null default '{}',
  add column name_search text generated always as (public.normalize_arabic(name_ar)) stored;
create index on public.reference_skills (name_search);

create or replace function private.import_reference_data(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_skills integer := 0;
  v_contexts integer := 0;
  r jsonb;
  v_id uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'employers', '[]')) loop
    insert into public.employer_registry (source_company_id, name_ar, name_en, entity_type, sector, official_website, career_url, verification_source,
      verification_status, partnership_status, identity_status, usage_permission, notes, source_file)
    values (r ->> 'company_id', r ->> 'name_ar', r ->> 'name_en', r ->> 'entity_type', r ->> 'sector', r ->> 'official_website', r ->> 'career_url', r ->> 'verification_source',
      r ->> 'verification_status', r ->> 'partnership_status', r ->> 'identity_status', r ->> 'usage_permission', r ->> 'notes', r ->> 'source_file')
    on conflict (source_company_id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, entity_type = excluded.entity_type, sector = excluded.sector,
      official_website = excluded.official_website, career_url = excluded.career_url, verification_source = excluded.verification_source,
      verification_status = excluded.verification_status, partnership_status = excluded.partnership_status, identity_status = excluded.identity_status,
      usage_permission = excluded.usage_permission, notes = excluded.notes
    returning id into v_id;
    insert into public.employer_aliases select v_id, a ->> 'name_variant', a ->> 'language', a ->> 'alias_status' from jsonb_array_elements(r -> 'aliases') a
      on conflict (registry_id, name_variant) do update set alias_status = excluded.alias_status;
    insert into public.employer_sources select v_id, s ->> 'source_url', s ->> 'source_type', (s ->> 'checked_on')::date from jsonb_array_elements(r -> 'sources') s
      on conflict (registry_id, source_url) do update set source_type = excluded.source_type, checked_on = excluded.checked_on;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'skills', '[]')) loop
    insert into public.reference_skills (sector_code, skill_kind, name_ar, description_ar, is_priority, source_file, source_sheet, source_row, listed_subsectors, listed_job_families)
    values (r ->> 'sector_code', r ->> 'skill_kind', r ->> 'name_ar', r ->> 'description_ar', (r ->> 'is_priority')::boolean, r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer,
      array(select jsonb_array_elements_text(coalesce(r -> 'listed_subsectors', '[]'))), array(select jsonb_array_elements_text(coalesce(r -> 'listed_job_families', '[]'))))
    on conflict (sector_code, skill_kind, name_ar) do update set description_ar = excluded.description_ar, is_priority = excluded.is_priority,
      source_file = excluded.source_file, source_sheet = excluded.source_sheet, source_row = excluded.source_row,
      listed_subsectors = excluded.listed_subsectors, listed_job_families = excluded.listed_job_families
    returning id into v_id;
    v_skills := v_skills + 1;
    insert into public.reference_skill_contexts select v_id, c ->> 'subsector_ar', c ->> 'job_family_ar', c ->> 'source_sheet' from jsonb_array_elements(r -> 'contexts') c
      on conflict (skill_id, subsector_ar, job_family_ar) do nothing;
    v_contexts := v_contexts + jsonb_array_length(r -> 'contexts');
  end loop;
  return jsonb_build_object('skills', v_skills, 'contexts', v_contexts);
end $$;

-- Organizations created by the automated test accounts are marked when they're created, and nobody can change the mark.
alter table public.organizations add column is_test boolean not null default false;

create function private.mark_test_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.is_test := old.is_test;
    return new;
  end if;
  new.is_test := new.slug like 'midan-test-%' or exists (
    select 1 from public.users u where u.id = auth.uid() and u.email like 'midan.test.%@example.com'
  );
  return new;
end $$;
revoke all on function private.mark_test_organization() from public, anon, authenticated;
create trigger mark_test_organization before insert or update on public.organizations
  for each row execute function private.mark_test_organization();

-- Existing fixtures. The trigger keeps old values on update, so this runs with it switched off.
alter table public.organizations disable trigger mark_test_organization;
update public.organizations o set is_test = true
where o.slug like 'midan-test-%' or exists (
  select 1 from public.organization_members m join public.users u on u.id = m.user_id
  where m.org_id = o.id and m.role = 'owner' and u.email like 'midan.test.%@example.com'
);
alter table public.organizations enable trigger mark_test_organization;
