-- An account is a candidate account or an organization account, never both, and the database decides which.
-- The account type a person chose at sign-up lives in Auth user metadata, which the person can edit, so it is never
-- used for authorization. What counts is the records: a candidate profile makes a candidate account, an organization
-- membership makes an organization account. Before this, a staff member could create a candidate profile through the
-- API and then apply to jobs, and a candidate could create an organization.
-- Additive only: no existing row changes. On 2026-11-09 no local account had both.

create function private.guard_account_type() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'candidate_profiles'
     and exists (select 1 from public.organization_members m where m.user_id = new.user_id) then
    raise exception 'Organization accounts cannot have a candidate profile' using errcode = '42501';
  end if;
  if tg_table_name = 'organization_members'
     and exists (select 1 from public.candidate_profiles p where p.user_id = new.user_id) then
    raise exception 'Candidate accounts cannot join an organization' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_account_type before insert on public.candidate_profiles
  for each row execute function private.guard_account_type();
create trigger guard_account_type before insert or update of user_id on public.organization_members
  for each row execute function private.guard_account_type();

-- Only candidate accounts apply. The candidate profile is also what the organization's snapshot is taken from.
create function private.guard_applicant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.candidate_profiles p where p.user_id = new.candidate_id) then
    raise exception 'Only candidate accounts can apply' using errcode = '42501';
  end if;
  return new;
end $$;

-- Named to run before guard_application (triggers fire in name order), so nothing is copied for a refused insert.
create trigger guard_applicant before insert on public.applications
  for each row execute function private.guard_applicant();

-- The functions run only from their triggers.
revoke all on function private.guard_account_type(), private.guard_applicant() from public, anon, authenticated;
