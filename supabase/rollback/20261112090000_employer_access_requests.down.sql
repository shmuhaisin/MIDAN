-- Reverses 20261112090000_employer_access_requests. Requests are deleted; memberships granted by approvals stay (they are
-- ordinary memberships), and the audit trail of every request and decision stays (audit_logs has no foreign keys).
--
-- Preflight: the earlier schema allows one workspace per registry employer, this migration allows one real and one test
-- workspace. If both exist for an employer, the rollback stops here, before changing anything, and deletes neither
-- workspace. Manual recovery: docs/testing/MIDAN_EMPLOYER_ACCESS_ROLLBACK.md.
do $$
declare v_conflicts text;
begin
  select string_agg(employer_registry_id::text, ', ' order by employer_registry_id) into v_conflicts
  from (select employer_registry_id from public.organizations where employer_registry_id is not null
        group by employer_registry_id having count(*) > 1) d;
  if v_conflicts is not null then
    raise exception 'Rollback of 20261112090000 stopped: these registry employers have more than one linked workspace (a real and a test one): %', v_conflicts
      using errcode = '23505',
            hint = 'Nothing was changed. Unlink or remove the test workspace by hand first: docs/testing/MIDAN_EMPLOYER_ACCESS_ROLLBACK.md';
  end if;
end $$;

drop function if exists public.my_signup_employer_choice();
revoke update (role) on public.organization_members from authenticated;
grant update on public.organization_members to authenticated;
drop policy if exists "admins insert in test and demo organizations" on public.organization_members;
create policy "admins insert" on public.organization_members for insert to authenticated with check (
  private.is_org_member(org_id, array['owner']::public.org_role[])
  or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[]))
);

create or replace function public.accept_organization_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.organization_invitations;
begin
  select v.* into i from public.organization_invitations v join public.users u on u.id = auth.uid() and lower(u.email) = v.email
  where v.id = p_invitation and v.accepted_at is null and v.expires_at > now() for update of v;
  -- Someone else's invitation looks the same as a missing one.
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  insert into public.organization_members (org_id, user_id, role) values (i.org_id, auth.uid(), i.role) on conflict do nothing;
  update public.organization_invitations set accepted_at = now() where id = i.id;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (i.org_id, auth.uid(), 'accept', 'organization_invitations', i.id::text, jsonb_build_object('role', i.role));
  return i.org_id;
end $$;

create or replace function private.provision_account(p_user uuid, p_email text, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  kind text := p_meta ->> 'account_type';
  display text := nullif(trim(p_meta ->> 'display_name'), '');
  org_ar text := nullif(trim(p_meta ->> 'org_name_ar'), '');
  org_en text := nullif(trim(p_meta ->> 'org_name_en'), '');
  base text;
  org_id uuid;
begin
  if kind = 'candidate' then
    insert into public.candidate_profiles (user_id, full_name)
    values (p_user, coalesce(display, split_part(p_email, '@', 1)))
    on conflict (user_id) do nothing;
  elsif kind = 'organization' and org_ar is not null and org_en is not null then
    if exists (select 1 from public.organization_members m where m.user_id = p_user) then
      return;
    end if;
    base := trim(both '-' from regexp_replace(lower(org_en), '[^a-z0-9]+', '-', 'g'));
    insert into public.organizations (slug, name_ar, name_en)
    values (left(coalesce(nullif(base, ''), 'organization'), 60) || '-' || substr(replace(p_user::text, '-', ''), 1, 8), org_ar, org_en)
    returning id into org_id;
    insert into public.organization_members (org_id, user_id, role) values (org_id, p_user, 'owner');
    insert into public.organization_branding (org_id) values (org_id);
  end if;
exception when others then
  raise warning 'Provisioning failed for %: %', p_user, sqlerrm;
end $$;

create or replace function public.create_organization(p_slug text, p_name_ar text, p_name_en text)
returns public.organizations language plpgsql security definer set search_path = '' as $$
declare o public.organizations;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an organization' using errcode = '42501';
  end if;
  insert into public.organizations (slug, name_ar, name_en) values (p_slug, p_name_ar, p_name_en) returning * into o;
  insert into public.organization_members (org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  insert into public.organization_branding (org_id) values (o.id);
  return o;
end $$;

create or replace function private.guard_last_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
    and exists (select 1 from public.organizations o where o.id = old.org_id)
    and not exists (
      select 1 from public.organization_members m
      where m.org_id = old.org_id and m.role = 'owner' and m.id <> old.id
    )
  then
    raise exception 'An organization must keep at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

drop function if exists public.admin_revoke_employer_access(uuid, text);
drop function if exists public.admin_decide_employer_access(uuid, text, public.org_role, text);
drop function if exists public.request_employer_access(uuid, text, text, text, text);
drop function if exists private.open_employer_access_request(uuid, uuid, text, text, text, text, text, public.org_role, uuid);
drop table if exists public.employer_access_requests;

drop index if exists public.organizations_one_test_workspace_per_employer;
drop index if exists public.organizations_one_real_workspace_per_employer;
alter table public.organizations add constraint organizations_employer_registry_id_key unique (employer_registry_id);
