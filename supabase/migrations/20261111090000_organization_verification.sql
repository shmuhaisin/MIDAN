-- Employer brief, section 4: an organization is reviewed by a platform administrator before it may recruit.
--
--   draft             the organization exists (created at email verification); its representative completes the profile
--   pending_review    submitted with its documents; a platform administrator decides
--   changes_requested the administrator asked for corrections or documents; the organization edits and submits again
--   rejected          refused, with a reason; the organization may correct and submit a new application
--   approved          may publish jobs, receive applications and invite its team
--   suspended         an approved organization stopped by an administrator, with a reason; its jobs are hidden from the
--                     public and receive no applications; reactivation returns it to approved
--
-- Only these functions change the status (security definer): submit_organization_verification,
-- admin_decide_organization, admin_set_organization_suspension. A member can't write it, nor change the identity fields
-- (names, commercial registration) while the organization is under review, approved or suspended.
--
-- Existing organizations were already recruiting before this rule, so they're recorded as approved (one audit row each,
-- action 'approved_before_review'). On a hosted database, the owner decides whether that is right before deploying.

-- 1. Profile fields --------------------------------------------------------------------------------------------------
-- Existing rows get 'approved' through the column default, not an UPDATE, so no row trigger runs (no audit row of its
-- own, no new updated_at) and the rollback leaves every existing row exactly as it was. New rows then start as 'draft'.
alter table public.organizations
  add column verification_status text not null default 'approved'
    check (verification_status in ('draft', 'pending_review', 'changes_requested', 'rejected', 'approved', 'suspended')),
  add column verification_updated_at timestamptz default now(),
  add column commercial_registration text check (commercial_registration ~ '^[0-9]{10}$'),
  add column website text check (website ~ '^https?://[^\s]+$' and length(website) <= 300),
  add column business_email text check (business_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(business_email) <= 200),
  add column contact_phone text check (contact_phone ~ '^\+?[0-9 ]{7,20}$'),
  add column city text check (length(city) between 2 and 100),
  add column description_ar text check (length(description_ar) <= 4000),
  add column description_en text check (length(description_en) <= 4000),
  add column representative_name text check (length(representative_name) between 2 and 200),
  add column representative_title text check (length(representative_title) between 2 and 200);

alter table public.organizations alter column verification_status set default 'draft',
  alter column verification_updated_at drop default;
insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
select id, null, 'approved_before_review', 'organizations', id::text, jsonb_build_object('reason', 'Existed before organization review was required')
from public.organizations;

grant update (commercial_registration, website, business_email, contact_phone, city, description_ar, description_en,
  representative_name, representative_title) on public.organizations to authenticated;

create function private.org_is_active(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations where id = p_org and verification_status = 'approved')
$$;
revoke all on function private.org_is_active(uuid) from public, anon;
grant execute on function private.org_is_active(uuid) to authenticated;

-- Members can't set the status, and can't change what the administrator checked while it stands checked.
create function private.guard_organization_verification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'draft';
    new.verification_updated_at := null;
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status or new.verification_updated_at is distinct from old.verification_updated_at then
    raise exception 'The review status is not allowed to be changed here' using errcode = '42501';
  end if;
  if old.verification_status in ('pending_review', 'approved', 'suspended') and (
    new.name_ar is distinct from old.name_ar or new.name_en is distinct from old.name_en
    or new.commercial_registration is distinct from old.commercial_registration
  ) then
    raise exception 'The official names and commercial registration cannot be changed while the organization is under review or approved' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_organization_verification before insert or update on public.organizations
  for each row execute function private.guard_organization_verification();

-- 2. Documents (private) ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-documents', 'organization-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg']);

create table public.organization_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('commercial_registration', 'authorization_letter', 'tax_certificate', 'other')),
  path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (split_part(path, '/', 1) = org_id::text)
);
create index on public.organization_documents (org_id, created_at desc);
create index on public.organization_documents (uploaded_by);
alter table public.organization_documents enable row level security;

-- Documents change only while the organization can be edited for review (not while it's being reviewed or after).
create function private.org_documents_editable(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations where id = p_org and verification_status in ('draft', 'changes_requested', 'rejected'))
$$;
revoke all on function private.org_documents_editable(uuid) from public, anon;
grant execute on function private.org_documents_editable(uuid) to authenticated;

create policy "org admins read" on public.organization_documents for select to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));
create policy "platform admins read" on public.organization_documents for select to authenticated using (private.is_platform_admin());
create policy "org admins add while editable" on public.organization_documents for insert to authenticated with check (
  private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]) and private.org_documents_editable(org_id) and uploaded_by = (select auth.uid())
);
create policy "org admins remove while editable" on public.organization_documents for delete to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]) and private.org_documents_editable(org_id));
grant select, insert, delete on public.organization_documents to authenticated;

create function private.can_manage_org_document(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  v_org := (storage.foldername(p_name))[1]::uuid;
  return private.is_org_member(v_org, array['owner', 'admin']::public.org_role[]);
exception when invalid_text_representation then
  return false;
end $$;
revoke all on function private.can_manage_org_document(text) from public, anon;
grant execute on function private.can_manage_org_document(text) to authenticated;
create policy "org admins upload organization documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'organization-documents' and private.can_manage_org_document(name));
create policy "org admins and platform admins read organization documents" on storage.objects for select to authenticated
  using (bucket_id = 'organization-documents' and (private.can_manage_org_document(name) or private.is_platform_admin()));
create policy "org admins delete organization documents" on storage.objects for delete to authenticated
  using (bucket_id = 'organization-documents' and private.can_manage_org_document(name));

-- 3. Applications for review and their decisions ---------------------------------------------------------------------
create table public.organization_verification_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  submitted_by uuid references public.users (id) on delete set null,
  -- What the administrator reviewed: the profile and the documents as they were when submitted.
  snapshot jsonb not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'changes_requested')),
  decision_note text check (length(decision_note) <= 4000),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_verification_one_open on public.organization_verification_requests (org_id) where status = 'pending_review';
create index on public.organization_verification_requests (org_id, created_at desc);
create index on public.organization_verification_requests (submitted_by);
create index on public.organization_verification_requests (reviewed_by);
alter table public.organization_verification_requests enable row level security;
create policy "org admins read" on public.organization_verification_requests for select to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));
create policy "platform admins read" on public.organization_verification_requests for select to authenticated using (private.is_platform_admin());
grant select on public.organization_verification_requests to authenticated;

-- Owners and admins hear about decisions about their organization.
create function private.notify_org_admins(p_org uuid, p_kind text, p_dedupe text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, link, dedupe_key)
  select m.user_id, p_kind, '/organization/' || p_org || '/verification', p_dedupe || ':' || m.user_id
  from public.organization_members m where m.org_id = p_org and m.role in ('owner', 'admin')
  on conflict (user_id, dedupe_key) do nothing
$$;
revoke all on function private.notify_org_admins(uuid, text, text) from public, anon, authenticated;

create function public.submit_organization_verification(p_org uuid) returns public.organization_verification_requests
language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations;
  r public.organization_verification_requests;
  v_docs jsonb;
  v_missing text[] := '{}';
begin
  if not private.is_org_member(p_org, array['owner', 'admin']::public.org_role[]) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into o from public.organizations where id = p_org for update;
  if o.verification_status not in ('draft', 'changes_requested', 'rejected') then
    raise exception 'This organization is not open for a new application: it is %', o.verification_status using errcode = '23514';
  end if;
  if coalesce(trim(o.name_ar), '') = '' then v_missing := array_append(v_missing, 'name_ar'); end if;
  if coalesce(trim(o.name_en), '') = '' then v_missing := array_append(v_missing, 'name_en'); end if;
  if o.company_type is null then v_missing := array_append(v_missing, 'company_type'); end if;
  if o.commercial_registration is null then v_missing := array_append(v_missing, 'commercial_registration'); end if;
  if o.business_email is null then v_missing := array_append(v_missing, 'business_email'); end if;
  if o.contact_phone is null then v_missing := array_append(v_missing, 'contact_phone'); end if;
  if o.city is null then v_missing := array_append(v_missing, 'city'); end if;
  if o.representative_name is null then v_missing := array_append(v_missing, 'representative_name'); end if;
  if o.representative_title is null then v_missing := array_append(v_missing, 'representative_title'); end if;
  if not exists (select 1 from public.organization_documents d where d.org_id = p_org and d.kind = 'commercial_registration') then
    v_missing := array_append(v_missing, 'document_commercial_registration');
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'An application is not allowed until these are complete: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'created_at', d.created_at) order by d.created_at), '[]')
    into v_docs from public.organization_documents d where d.org_id = p_org;
  insert into public.organization_verification_requests (org_id, submitted_by, snapshot)
  values (p_org, auth.uid(), jsonb_build_object(
    'name_ar', o.name_ar, 'name_en', o.name_en, 'company_type', o.company_type,
    'industry', (select b.industry from public.organization_branding b where b.org_id = p_org),
    'commercial_registration', o.commercial_registration, 'website', o.website, 'business_email', o.business_email,
    'contact_phone', o.contact_phone, 'city', o.city, 'description_ar', o.description_ar, 'description_en', o.description_en,
    'representative_name', o.representative_name, 'representative_title', o.representative_title,
    'previous_status', o.verification_status, 'documents', v_docs))
  returning * into r;
  update public.organizations set verification_status = 'pending_review', verification_updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'submit', 'organization_verification', r.id::text, jsonb_build_object('from', o.verification_status, 'to', 'pending_review'));
  -- Platform administrators see it in their queue.
  insert into public.notifications (user_id, kind, link, dedupe_key)
  select a.user_id, 'organization_review_requested', '/admin/organizations/' || p_org, 'org-review:' || r.id
  from private.platform_admins a
  on conflict (user_id, dedupe_key) do nothing;
  return r;
end $$;

create function public.admin_decide_organization(p_org uuid, p_decision text, p_note text default null) returns public.organization_verification_requests
language plpgsql security definer set search_path = '' as $$
declare
  r public.organization_verification_requests;
  v_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  v_status := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'request_changes' then 'changes_requested' end;
  if v_status is null then raise exception 'Unknown action' using errcode = '22023'; end if;
  if v_status <> 'approved' and v_note is null then
    raise exception 'This decision is not allowed until a reason is given' using errcode = '23514';
  end if;
  select * into r from public.organization_verification_requests where org_id = p_org and status = 'pending_review' for update;
  if not found then raise exception 'No application waiting for review was found' using errcode = 'P0002'; end if;
  update public.organization_verification_requests
    set status = v_status, decision_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
    where id = r.id returning * into r;
  update public.organizations set verification_status = v_status, verification_updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), p_decision, 'organization_verification', r.id::text,
    jsonb_build_object('from', 'pending_review', 'to', v_status, 'reason', v_note));
  perform private.notify_org_admins(p_org, 'organization_' || v_status, 'org-decision:' || r.id);
  return r;
end $$;

create function public.admin_set_organization_suspension(p_org uuid, p_suspend boolean, p_reason text) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_to text := case when p_suspend then 'suspended' else 'approved' end;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'This change is not allowed until a reason is given' using errcode = '23514'; end if;
  select * into o from public.organizations where id = p_org for update;
  if not found then raise exception 'Organization not found' using errcode = 'P0002'; end if;
  if o.verification_status <> (case when p_suspend then 'approved' else 'suspended' end) then
    raise exception 'This organization is not open for that change: it is %', o.verification_status using errcode = '23514';
  end if;
  update public.organizations set verification_status = v_to, verification_updated_at = now() where id = p_org returning * into o;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), case when p_suspend then 'suspend' else 'reactivate' end, 'organizations', p_org::text,
    jsonb_build_object('from', case when p_suspend then 'approved' else 'suspended' end, 'to', v_to, 'reason', v_reason));
  perform private.notify_org_admins(p_org, case when p_suspend then 'organization_suspended' else 'organization_reactivated' end,
    'org-' || v_to || ':' || p_org || ':' || extract(epoch from now())::bigint);
  return o;
end $$;

revoke all on function public.submit_organization_verification(uuid), public.admin_decide_organization(uuid, text, text),
  public.admin_set_organization_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.submit_organization_verification(uuid), public.admin_decide_organization(uuid, text, text),
  public.admin_set_organization_suspension(uuid, boolean, text) to authenticated;

-- 4. What approval gates ---------------------------------------------------------------------------------------------
-- Publishing a job (every path: create, status change, listing conversion).
create function private.guard_job_publication_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') and not private.org_is_active(new.org_id) then
    raise exception 'Publishing is not allowed until the organization is approved' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_job_publication_org before insert or update of status on public.jobs
  for each row execute function private.guard_job_publication_org();

-- Receiving applications.
create function private.guard_application_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.org_is_active((select j.org_id from public.jobs j where j.id = new.job_id)) then
    raise exception 'This job is not open for applications: the organization is not active' using errcode = '23514';
  end if;
  return new;
end $$;
-- Name order: after guard_applicant and guard_applicant_deadline (candidate branch), before guard_application.
create trigger guard_applicant_org before insert on public.applications
  for each row execute function private.guard_application_org();

-- Inviting the team.
create function private.guard_invitation_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.org_is_active(new.org_id) then
    raise exception 'Inviting the team is not allowed until the organization is approved' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_invitation_org before insert on public.organization_invitations
  for each row execute function private.guard_invitation_org();

-- A suspended organization's published jobs leave the public listing. Members, platform administrators and candidates who
-- already applied still see them.
create function private.has_applied_to(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.applications a where a.job_id = p_job and a.candidate_id = (select auth.uid()))
$$;
revoke all on function private.has_applied_to(uuid) from public, anon;
grant execute on function private.has_applied_to(uuid) to authenticated;
grant execute on function private.org_is_active(uuid) to anon;
create policy "only active organizations are listed" on public.jobs as restrictive for select to anon
  using (status <> 'published' or private.org_is_active(org_id));
create policy "only active organizations are listed to others" on public.jobs as restrictive for select to authenticated using (
  status <> 'published' or private.org_is_active(org_id) or private.is_org_member(org_id) or private.is_platform_admin() or private.has_applied_to(id)
);
