-- Owner's rule (2026-11-10): MIDAN serves only the employers in the registry (the ten selected organizations), and nobody
-- gets employer access without a MIDAN platform administrator's approval.
--
-- A representative asks for access to one registry employer; a platform administrator approves or rejects. Approval
-- creates that employer's single workspace the first time (one per registry employer, never one per representative) and
-- adds the representative to it; revocation removes them. Every other way into an organization is closed for real
-- employers: creating an organization (fixtures and administrators only), the sign-up provisioning that created one from
-- free text, direct member inserts through the Data API, and invitations (they now open a request the administrator decides).
-- Test and demo organizations keep their own mechanisms, so the isolated test suites and the demo seed still work.
-- The registry records themselves (and their partnership status) are never changed.

-- 1. One employer workspace per registry employer, kept apart from test and demo organizations ------------------------
-- The link was unique across all organizations; a test administrator's approvals now create a test tenant, so the rule
-- is: one real workspace and at most one test workspace per registry employer.
alter table public.organizations drop constraint organizations_employer_registry_id_key;
create unique index organizations_one_real_workspace_per_employer on public.organizations (employer_registry_id)
  where employer_registry_id is not null and not is_test and not is_demo;
create unique index organizations_one_test_workspace_per_employer on public.organizations (employer_registry_id)
  where employer_registry_id is not null and is_test;

-- 2. Requests ----------------------------------------------------------------------------------------------------------
create table public.employer_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  registry_id uuid not null references public.employer_registry (id),
  representative_name text not null check (length(trim(representative_name)) between 2 and 200),
  job_title text not null check (length(trim(job_title)) between 2 and 200),
  work_email text not null check (length(work_email) <= 320),
  phone text check (phone is null or phone ~ '^\+?[0-9 ]{7,20}$'),
  verification_note text check (verification_note is null or length(verification_note) <= 2000),
  source text not null default 'registration' check (source in ('registration', 'application', 'invitation')),
  requested_role public.org_role not null default 'recruiter' check (requested_role <> 'owner'),
  invitation_id uuid references public.organization_invitations (id) on delete set null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'revoked')),
  org_id uuid references public.organizations (id) on delete set null,
  granted_role public.org_role,
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A person represents one employer at a time: one open request (pending or approved).
create unique index employer_access_one_open_request on public.employer_access_requests (user_id)
  where status in ('pending_approval', 'approved');
create index employer_access_requests_status on public.employer_access_requests (status, created_at desc);
alter table public.employer_access_requests enable row level security;
revoke all on public.employer_access_requests from public, anon, authenticated;
grant select on public.employer_access_requests to authenticated;
create policy "own requests" on public.employer_access_requests for select to authenticated using (user_id = auth.uid());
create policy "platform admins read" on public.employer_access_requests for select to authenticated using (private.is_platform_admin());

-- 3. Opening a request (sign-up provisioning, the app, and invitations) ----------------------------------------------
create function private.open_employer_access_request(p_user uuid, p_registry uuid, p_name text, p_title text, p_phone text,
  p_note text, p_source text, p_role public.org_role default 'recruiter', p_invitation uuid default null)
returns public.employer_access_requests
language plpgsql security definer set search_path = '' as $$
declare r public.employer_access_requests; v_email text;
begin
  if not exists (select 1 from public.employer_registry e where e.id = p_registry) then
    raise exception 'Choose one of the organizations MIDAN supports' using errcode = '23514';
  end if;
  if exists (select 1 from public.candidate_profiles c where c.user_id = p_user) then
    raise exception 'A candidate account can''t request employer access' using errcode = '42501';
  end if;
  select * into r from public.employer_access_requests where user_id = p_user and status in ('pending_approval', 'approved');
  if found then return r; end if;  -- idempotent: the open request stands
  select email into v_email from public.users where id = p_user;
  insert into public.employer_access_requests (user_id, registry_id, representative_name, job_title, work_email, phone,
    verification_note, source, requested_role, invitation_id)
  values (p_user, p_registry, trim(p_name), trim(p_title), v_email, nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''), p_source, case when p_role = 'owner' then 'admin' else p_role end, p_invitation)
  returning * into r;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (p_user, 'request', 'employer_access_requests', r.id::text, jsonb_build_object('registry_id', p_registry, 'source', p_source));
  return r;
end $$;
revoke all on function private.open_employer_access_request(uuid, uuid, text, text, text, text, text, public.org_role, uuid) from public, anon, authenticated;

-- A signed-in, email-verified person asks for access through the app.
create function public.request_employer_access(p_registry uuid, p_name text, p_title text, p_phone text default null, p_note text default null)
returns public.employer_access_requests
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'Verify your email first' using errcode = '42501';
  end if;
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
             where m.user_id = auth.uid() and not o.is_test and not o.is_demo) then
    raise exception 'This account already has employer access' using errcode = '23514';
  end if;
  return private.open_employer_access_request(auth.uid(), p_registry, p_name, p_title, p_phone, p_note, 'application');
end $$;
revoke all on function public.request_employer_access(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_employer_access(uuid, text, text, text, text) to authenticated;

-- 4. The administrator's decisions --------------------------------------------------------------------------------------
create function public.admin_decide_employer_access(p_request uuid, p_decision text, p_role public.org_role default null, p_note text default null)
returns public.employer_access_requests
language plpgsql security definer set search_path = '' as $$
declare
  r public.employer_access_requests;
  e public.employer_registry;
  v_org uuid;
  v_test boolean;
  v_role public.org_role;
  v_base text;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decide approve or reject' using errcode = '22023'; end if;
  select * into r from public.employer_access_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request was already decided: %', r.status using errcode = '23514'; end if;
  if r.user_id = auth.uid() then raise exception 'An administrator can''t decide their own request' using errcode = '42501'; end if;

  if p_decision = 'reject' then
    update public.employer_access_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = r.id returning * into r;
    insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values (auth.uid(), 'reject', 'employer_access_requests', r.id::text, jsonb_build_object('registry_id', r.registry_id, 'user_id', r.user_id));
    return r;
  end if;

  -- The employer's workspace: one per registry employer. A fixture administrator's approvals stay in a test workspace.
  select * into e from public.employer_registry where id = r.registry_id;
  v_test := exists (select 1 from public.users u where u.id = auth.uid() and u.email like 'midan.test.%@example.com');
  select o.id into v_org from public.organizations o
  where o.employer_registry_id = r.registry_id and o.is_test = v_test and not o.is_demo;
  if v_org is null then
    v_base := trim(both '-' from regexp_replace(lower(coalesce(e.name_en, 'employer')), '[^a-z0-9]+', '-', 'g'));
    insert into public.organizations (slug, name_ar, name_en, verification_status, verification_updated_at,
      employer_registry_id, employer_linked_by, employer_linked_at)
    values ((case when v_test then 'midan-test-employer-' else 'employer-' end) || left(coalesce(nullif(v_base, ''), 'employer'), 50)
              || '-' || substr(replace(e.id::text, '-', ''), 1, 6),
            coalesce(e.name_ar, e.name_en), coalesce(e.name_en, e.name_ar), 'approved', now(), e.id, auth.uid(), now())
    returning id into v_org;
    insert into public.organization_branding (org_id) values (v_org) on conflict do nothing;
  end if;
  -- The first representative owns the workspace; later ones get the role the administrator chooses (default recruiter).
  v_role := coalesce(p_role, case when exists (select 1 from public.organization_members m where m.org_id = v_org and m.role = 'owner')
                                  then r.requested_role else 'owner' end);
  insert into public.organization_members (org_id, user_id, role) values (v_org, r.user_id, v_role)
  on conflict (org_id, user_id) do update set role = excluded.role;
  if r.invitation_id is not null then
    update public.organization_invitations set accepted_at = now() where id = r.invitation_id and accepted_at is null;
  end if;
  update public.employer_access_requests set status = 'approved', org_id = v_org, granted_role = v_role, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = r.id returning * into r;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (v_org, auth.uid(), 'approve', 'employer_access_requests', r.id::text,
          jsonb_build_object('registry_id', r.registry_id, 'user_id', r.user_id, 'role', v_role));
  return r;
end $$;
revoke all on function public.admin_decide_employer_access(uuid, text, public.org_role, text) from public, anon;
grant execute on function public.admin_decide_employer_access(uuid, text, public.org_role, text) to authenticated;

create function public.admin_revoke_employer_access(p_request uuid, p_note text default null)
returns public.employer_access_requests
language plpgsql security definer set search_path = '' as $$
declare r public.employer_access_requests;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  select * into r from public.employer_access_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'approved' then raise exception 'Only approved access can be revoked' using errcode = '23514'; end if;
  delete from public.organization_members where org_id = r.org_id and user_id = r.user_id;
  update public.employer_access_requests set status = 'revoked', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = r.id returning * into r;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (r.org_id, auth.uid(), 'revoke', 'employer_access_requests', r.id::text, jsonb_build_object('registry_id', r.registry_id, 'user_id', r.user_id));
  return r;
end $$;
revoke all on function public.admin_revoke_employer_access(uuid, text) from public, anon;
grant execute on function public.admin_revoke_employer_access(uuid, text) to authenticated;

-- 5. Closing the other ways in ------------------------------------------------------------------------------------------
-- Creating an organization: platform administrators, and the fixture accounts (test organizations are marked is_test by
-- mark_test_organization; demo accounts' organizations are marked is_demo here).
create or replace function public.create_organization(p_slug text, p_name_ar text, p_name_en text)
returns public.organizations language plpgsql security definer set search_path = '' as $$
declare o public.organizations; v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an organization' using errcode = '42501';
  end if;
  select email into v_email from public.users where id = auth.uid();
  if not private.is_platform_admin() and v_email not like 'midan.test.%@example.com' and v_email not like 'midan.demo.%@example.com' then
    raise exception 'Organizations are set up by MIDAN. Request access to your organization instead.' using errcode = '42501';
  end if;
  insert into public.organizations (slug, name_ar, name_en, is_demo) values (p_slug, p_name_ar, p_name_en, v_email like 'midan.demo.%@example.com')
  returning * into o;
  insert into public.organization_members (org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  insert into public.organization_branding (org_id) values (o.id);
  return o;
end $$;

-- Sign-up: an organization account's verification opens a request for the employer it chose; it never creates one.
create or replace function private.provision_account(p_user uuid, p_email text, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  kind text := p_meta ->> 'account_type';
  display text := nullif(trim(p_meta ->> 'display_name'), '');
  registry uuid;
begin
  if kind = 'candidate' then
    insert into public.candidate_profiles (user_id, full_name)
    values (p_user, coalesce(display, split_part(p_email, '@', 1)))
    on conflict (user_id) do nothing;
  elsif kind = 'organization' then
    begin
      registry := (p_meta ->> 'registry_id')::uuid;
    exception when others then
      registry := null;
    end;
    if registry is not null then
      perform private.open_employer_access_request(p_user, registry, coalesce(display, split_part(p_email, '@', 1)),
        coalesce(nullif(trim(p_meta ->> 'job_title'), ''), 'Not given'), p_meta ->> 'phone', p_meta ->> 'verification_note', 'registration');
    end if;
  end if;
exception when others then
  raise warning 'Provisioning failed for %: %', p_user, sqlerrm;
end $$;

-- Invitations into a real employer workspace open a request; test and demo organizations keep direct joining.
create or replace function public.accept_organization_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.organization_invitations; o public.organizations; u public.users;
begin
  select v.* into i from public.organization_invitations v join public.users x on x.id = auth.uid() and lower(x.email) = v.email
  where v.id = p_invitation and v.accepted_at is null and v.expires_at > now() for update of v;
  -- Someone else's invitation looks the same as a missing one.
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  select * into o from public.organizations where id = i.org_id;
  if o.is_test or o.is_demo then
    insert into public.organization_members (org_id, user_id, role) values (i.org_id, auth.uid(), i.role) on conflict do nothing;
    update public.organization_invitations set accepted_at = now() where id = i.id;
    insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
    values (i.org_id, auth.uid(), 'accept', 'organization_invitations', i.id::text, jsonb_build_object('role', i.role));
    return i.org_id;
  end if;
  if o.employer_registry_id is null then
    raise exception 'This organization isn''t one MIDAN supports' using errcode = '42501';
  end if;
  select * into u from public.users where id = auth.uid();
  perform private.open_employer_access_request(auth.uid(), o.employer_registry_id, coalesce(u.display_name, split_part(u.email, '@', 1)),
    'Invited by the organization', null, null, 'invitation', i.role, i.id);
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (i.org_id, auth.uid(), 'accept_pending_approval', 'organization_invitations', i.id::text, jsonb_build_object('role', i.role));
  return i.org_id;
end $$;

-- Members: direct inserts only in test and demo organizations; updates change the role and nothing else.
drop policy "admins insert" on public.organization_members;
create policy "admins insert in test and demo organizations" on public.organization_members for insert to authenticated with check (
  exists (select 1 from public.organizations o where o.id = org_id and (o.is_test or o.is_demo))
  and (private.is_org_member(org_id, array['owner']::public.org_role[])
       or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[])))
);
revoke update on public.organization_members from authenticated;
grant update (role) on public.organization_members to authenticated;
