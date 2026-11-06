-- Employer profiles, search by official name and alias, and the link from MIDAN organizations and jobs to the official
-- employer registry. The registry stays an identity record: linking says "this account is that entity", nothing more.

-- An organization account can be confirmed as one registry entity. Only a platform administrator sets this, after
-- checking it; organization members have no update grant on the column. One entity, one account.
alter table public.organizations
  add column employer_registry_id uuid unique references public.employer_registry (id),
  add column employer_linked_by uuid references public.users (id) on delete set null,
  add column employer_linked_at timestamptz;

create function public.admin_link_organization_employer(p_org uuid, p_registry uuid) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare o public.organizations;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  update public.organizations set employer_registry_id = p_registry,
    employer_linked_by = case when p_registry is null then null else auth.uid() end,
    employer_linked_at = case when p_registry is null then null else now() end
  where id = p_org and not is_demo and not is_test returning * into o;
  if o.id is null then raise exception 'Only a real organization can be linked to an employer; demo and test organizations cannot' using errcode = '23514'; end if;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (o.id, auth.uid(), case when p_registry is null then 'unlink' else 'link' end, 'organization_employer', o.id::text,
    jsonb_strip_nulls(jsonb_build_object('registry_id', p_registry)));
  return o;
end $$;
revoke all on function public.admin_link_organization_employer(uuid, uuid) from public, anon;
grant execute on function public.admin_link_organization_employer(uuid, uuid) to authenticated;

/**
 * Searches the registry by official Arabic or English name, by any alias, or by the workbook's company ID.
 * Says how each result matched, so an alias is never shown as if it were the official name:
 *   official_name   the official Arabic or English name contains the search
 *   alias           an alias contains the search (with the alias text and the status the workbook gives it)
 *   company_id      the workbook's company ID
 * Arabic is compared after public.normalize_arabic; English case-insensitively.
 */
create function public.search_employers(p_q text)
returns table (registry_id uuid, matched_by text, matched_text text, alias_status text, exact boolean)
language sql stable security definer set search_path = '' as $$
  with q as (select nullif(trim(coalesce(p_q, '')), '') as raw, public.normalize_arabic(p_q) as norm),
  hits as (
    select e.id, 'official_name' as matched_by, e.name_ar as matched_text, null::text as alias_status,
      public.normalize_arabic(e.name_ar) = q.norm as exact
    from public.employer_registry e, q where q.raw is not null and strpos(public.normalize_arabic(e.name_ar), q.norm) > 0
    union all
    select e.id, 'official_name', e.name_en, null, lower(e.name_en) = lower(q.raw)
    from public.employer_registry e, q where q.raw is not null and strpos(lower(e.name_en), lower(q.raw)) > 0
    union all
    select a.registry_id, 'alias', a.name_variant, a.alias_status,
      public.normalize_arabic(a.name_variant) = q.norm or lower(a.name_variant) = lower(q.raw)
    from public.employer_aliases a, q
    where q.raw is not null and (strpos(public.normalize_arabic(a.name_variant), q.norm) > 0 or strpos(lower(a.name_variant), lower(q.raw)) > 0)
    union all
    select e.id, 'company_id', e.source_company_id, null, true
    from public.employer_registry e, q where q.raw is not null and upper(e.source_company_id) = upper(q.raw)
  )
  -- One row per employer: its best reason, official names before aliases, exact before partial.
  select distinct on (id) id, matched_by, matched_text, alias_status, exact from hits
  order by id, exact desc, (matched_by = 'company_id') desc, (matched_by = 'official_name') desc, length(matched_text)
$$;
grant execute on function public.search_employers(text) to anon, authenticated;

/**
 * Published opportunities connected to a registry employer, from both places a job can come from:
 *   midan        a published job of the organization account confirmed as this employer (never demo or test)
 *   external     a reviewed, published external listing whose employer was matched or confirmed as this employer
 */
create function public.employer_jobs(p_registry uuid)
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
grant execute on function public.employer_jobs(uuid) to anon, authenticated;
