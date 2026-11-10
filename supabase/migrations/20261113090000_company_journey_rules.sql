-- Company journey rules (feature/midan-company-journey). Local only until the owner approves it for Cloud.
--
-- 1. A job is published only after its assessments are reviewed: a job that has an assessment with no approved
--    (published) version can't be published. A job with no assessment at all can still be published (CV-only hiring).
-- 2. An assessment approved after people applied reaches them: when an assessment's first version is published, every
--    applicant to that job who is still at the start (submitted or under review) and holds no attempt of it is assigned
--    it, exactly as the application trigger would have done (private.assign_published_assessments).
-- 3. A registry employer's workspace carries the registry's verified identity: the official website, and the company
--    type where the registry's entity type states it unambiguously (a government ministry, authority or fund). Nothing is
--    guessed: other entity types stay empty for the employer to choose. Branding (logo, colours) stays the employer's.

-- 1 ---------------------------------------------------------------------------------------------------------------------
create function private.guard_job_publication_assessment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') and exists (
    select 1 from public.assessments s
    where s.job_id = new.id
      and not exists (select 1 from public.assessment_versions v where v.assessment_id = s.id and v.status = 'published')
  ) then
    raise exception 'Approve and publish the job''s assessment before publishing the job' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_job_publication_assessment() from public, anon, authenticated;
create trigger guard_job_publication_assessment before insert or update of status on public.jobs
  for each row execute function private.guard_job_publication_assessment();

-- 2 ---------------------------------------------------------------------------------------------------------------------
create function private.assign_late_published_assessment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  if new.status <> 'published' or old.status = 'published' then return null; end if;
  -- A revision of an assessment that was already published goes to new applicants only (editing policy, section 6).
  if exists (select 1 from public.assessment_versions x where x.assessment_id = new.assessment_id and x.id <> new.id and x.status = 'published') then
    return null;
  end if;
  select s.job_id into v_job from public.assessments s where s.id = new.assessment_id;
  insert into public.assessment_attempts (application_id, version_id, org_id, candidate_id)
  select a.id, new.id, a.org_id, a.candidate_id
  from public.applications a
  where a.job_id = v_job and a.status in ('submitted', 'under_review')
    and not exists (
      select 1 from public.assessment_attempts t join public.assessment_versions x on x.id = t.version_id
      where t.application_id = a.id and x.assessment_id = new.assessment_id
    )
  on conflict (application_id, version_id) do nothing;
  return null;
end $$;
revoke all on function private.assign_late_published_assessment() from public, anon, authenticated;
create trigger assign_late_published_assessment after update of status on public.assessment_versions
  for each row execute function private.assign_late_published_assessment();

-- 3 ---------------------------------------------------------------------------------------------------------------------
create function private.registry_company_type(p_entity_type text) returns text
language sql immutable set search_path = '' as $$
  select case when p_entity_type ~* '^government (ministry|authority|development fund)$' then 'government_entity' end
$$;

create function private.fill_registry_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.employer_registry;
begin
  if new.employer_registry_id is null then return new; end if;
  select * into e from public.employer_registry where id = new.employer_registry_id;
  if not found then return new; end if;
  if new.website is null and e.official_website ~ '^https?://[^\s]+$' and length(e.official_website) <= 300 then
    new.website := e.official_website;
  end if;
  if new.company_type is null then new.company_type := private.registry_company_type(e.entity_type); end if;
  return new;
end $$;
revoke all on function private.fill_registry_identity() from public, anon, authenticated;
create trigger fill_registry_identity before insert or update of employer_registry_id on public.organizations
  for each row execute function private.fill_registry_identity();

-- Workspaces created before this migration.
update public.organizations o
set website = coalesce(o.website, case when e.official_website ~ '^https?://[^\s]+$' and length(e.official_website) <= 300 then e.official_website end),
    company_type = coalesce(o.company_type, private.registry_company_type(e.entity_type))
from public.employer_registry e
where e.id = o.employer_registry_id and (o.website is null or o.company_type is null);

-- The registry's business domain, for assessment context: readable to the workspace's own members (the registry is
-- already public reference data; this only joins it to the member's organization).
create function public.organization_business_domain(p_org uuid) returns table (sector text, entity_type text)
language sql stable security definer set search_path = '' as $$
  select e.sector, e.entity_type from public.organizations o join public.employer_registry e on e.id = o.employer_registry_id
  where o.id = p_org and private.is_org_member(p_org)
$$;
revoke all on function public.organization_business_domain(uuid) from public, anon;
grant execute on function public.organization_business_domain(uuid) to authenticated;
