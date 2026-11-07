-- Phase 3: how an organization proves it may manage an employer's profile and jobs. Nothing is granted automatically: an owner or admin
-- submits evidence, and a platform administrator decides. Approval links the account to the registry entity, as an administrator
-- could already do by hand. It never changes the entity's identity fields or partnership status.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employer-claims', 'employer-claims', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg']);

create table public.employer_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  registry_id uuid not null references public.employer_registry (id),
  requested_by uuid references public.users (id) on delete set null,
  role_title text not null check (length(role_title) between 2 and 200),
  evidence_note text not null check (length(evidence_note) between 10 and 4000),
  evidence_path text,
  -- A fact for the reviewer, not proof: the requester's email domain is the employer's official website domain.
  email_domain_matches boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_note text,
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index employer_claims_one_pending on public.employer_claims (org_id) where status = 'pending';
create index on public.employer_claims (registry_id);
create index on public.employer_claims (requested_by);
create index on public.employer_claims (reviewed_by);
alter table public.employer_claims enable row level security;
create policy "org admins read" on public.employer_claims for select to authenticated using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));
create policy "platform admins read" on public.employer_claims for select to authenticated using (private.is_platform_admin());
grant select on public.employer_claims to authenticated;

-- Evidence is private: the organization's owners and admins, and platform administrators.
create function private.can_manage_claim_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  v_org := (storage.foldername(p_name))[1]::uuid;
  return private.is_org_member(v_org, array['owner', 'admin']::public.org_role[]);
exception when invalid_text_representation then
  return false;
end $$;
revoke all on function private.can_manage_claim_file(text) from public, anon;
grant execute on function private.can_manage_claim_file(text) to authenticated;
create policy "org admins upload claim evidence" on storage.objects for insert to authenticated
  with check (bucket_id = 'employer-claims' and private.can_manage_claim_file(name));
create policy "org admins read claim evidence" on storage.objects for select to authenticated
  using (bucket_id = 'employer-claims' and (private.can_manage_claim_file(name) or private.is_platform_admin()));

create function public.submit_employer_claim(p_org uuid, p_registry uuid, p_role_title text, p_note text, p_evidence_path text default null)
returns public.employer_claims language plpgsql security definer set search_path = '' as $$
declare
  c public.employer_claims;
  v_email text;
  v_site text;
  v_host text;
  v_domain text;
begin
  if not private.is_org_member(p_org, array['owner', 'admin']::public.org_role[]) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.organizations where id = p_org and is_demo) then
    raise exception 'A demo organization is not allowed to claim an employer' using errcode = '23514';
  end if;
  if exists (select 1 from public.organizations where id = p_org and employer_registry_id is not null) then
    raise exception 'This organization is not open for another claim: it manages an employer already' using errcode = '23514';
  end if;
  if exists (select 1 from public.organizations where employer_registry_id = p_registry) then
    raise exception 'This employer is not open for a claim: an organization manages it already' using errcode = '23514';
  end if;
  if exists (select 1 from public.employer_claims where org_id = p_org and status = 'pending') then
    raise exception 'This organization is not open for another claim until the current one is decided' using errcode = '23514';
  end if;
  if p_evidence_path is not null and split_part(p_evidence_path, '/', 1) <> p_org::text then
    raise exception 'This file is not allowed: it belongs to another organization' using errcode = '23514';
  end if;
  select official_website into v_site from public.employer_registry where id = p_registry;
  if not found then raise exception 'Employer not found' using errcode = 'P0002'; end if;
  select lower(email) into v_email from public.users where id = auth.uid();
  v_host := regexp_replace(lower(coalesce(v_site, '')), '^https?://(www\.)?([^/:?#]+).*$', '\2');
  v_domain := split_part(coalesce(v_email, ''), '@', 2);
  insert into public.employer_claims (org_id, registry_id, requested_by, role_title, evidence_note, evidence_path, email_domain_matches)
  values (p_org, p_registry, auth.uid(), trim(p_role_title), trim(p_note), p_evidence_path,
    v_host <> '' and v_domain <> '' and (v_domain = v_host or v_domain like '%.' || v_host))
  returning * into c;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'submit', 'employer_claims', c.id::text, jsonb_build_object('registry_id', p_registry));
  return c;
end $$;

create function public.withdraw_employer_claim(p_claim uuid) returns public.employer_claims
language plpgsql security definer set search_path = '' as $$
declare c public.employer_claims;
begin
  select * into c from public.employer_claims where id = p_claim for update;
  if not found or not private.is_org_member(c.org_id, array['owner', 'admin']::public.org_role[]) then raise exception 'Claim not found' using errcode = 'P0002'; end if;
  if c.status <> 'pending' then raise exception 'A decided claim cannot be changed' using errcode = '23514'; end if;
  update public.employer_claims set status = 'withdrawn' where id = p_claim returning * into c;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details) values (c.org_id, auth.uid(), 'withdraw', 'employer_claims', c.id::text, '{}');
  return c;
end $$;

create function public.admin_review_employer_claim(p_claim uuid, p_decision text, p_note text default null) returns public.employer_claims
language plpgsql security definer set search_path = '' as $$
declare c public.employer_claims;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Unknown resolution' using errcode = '22023'; end if;
  select * into c from public.employer_claims where id = p_claim for update;
  if not found then raise exception 'Claim not found' using errcode = 'P0002'; end if;
  if c.status <> 'pending' then raise exception 'A decided claim cannot be changed' using errcode = '23514'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'A rejection is not allowed until a reason is given' using errcode = '23514'; end if;
  if p_decision = 'approved' then
    perform public.admin_link_organization_employer(c.org_id, c.registry_id);
  end if;
  update public.employer_claims set status = p_decision, review_note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_claim returning * into c;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (c.org_id, auth.uid(), p_decision, 'employer_claims', c.id::text, jsonb_build_object('registry_id', c.registry_id));
  if c.requested_by is not null then
    insert into public.notifications (user_id, kind, link, dedupe_key)
    values (c.requested_by, 'employer_claim_' || p_decision, '/organization/' || c.org_id || '/settings', 'claim:' || c.id || ':' || p_decision)
    on conflict (user_id, dedupe_key) do nothing;
  end if;
  return c;
end $$;

revoke all on function public.submit_employer_claim(uuid, uuid, text, text, text), public.withdraw_employer_claim(uuid), public.admin_review_employer_claim(uuid, text, text) from public, anon;
grant execute on function public.submit_employer_claim(uuid, uuid, text, text, text), public.withdraw_employer_claim(uuid), public.admin_review_employer_claim(uuid, text, text) to authenticated;
