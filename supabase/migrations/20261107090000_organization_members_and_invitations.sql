-- Existing roles and invitation columns only. No remote application is part of this change.
-- Serialize member changes on the organization row, including direct Data API writes.
create or replace function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.user_id <> old.user_id) then
    raise exception 'Membership identity cannot be changed' using errcode = '23514';
  end if;
  perform 1 from public.organizations where id = old.org_id for update;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
    and exists (select 1 from public.organizations where id = old.org_id)
    and not exists (select 1 from public.organization_members where org_id = old.org_id and role = 'owner' and id <> old.id)
  then
    raise exception 'An organization must keep at least one owner' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Project only the identity fields needed by the members screen. Do not widen users RLS.
create function public.list_organization_members(p_org uuid)
returns table(id uuid, user_id uuid, role public.org_role, created_at timestamptz, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_member(p_org) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select m.id, m.user_id, m.role, m.created_at, u.display_name, u.email
    from public.organization_members m join public.users u on u.id = m.user_id
    where m.org_id = p_org order by m.created_at, m.id;
end $$;
revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;

-- Acceptance is the only privileged write path for a non-member. Verify the CURRENT
-- confirmed Auth email in the DB too, never an email/user ID supplied by the caller.
create function public.accept_organization_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.organization_invitations;
  actor uuid := auth.uid();
  actor_email text;
  target_org uuid;
begin
  select lower(email) into actor_email from auth.users
    where id = actor and email_confirmed_at is not null;
  if actor is null or actor_email is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;
  -- Lock organization before invitation, matching creation/cancellation/member mutations.
  select org_id into target_org from public.organization_invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  perform 1 from public.organizations where id = target_org for update;
  select * into invitation from public.organization_invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or invitation.email <> actor_email or invitation.accepted_at is not null
    or invitation.expires_at <= clock_timestamp() or invitation.role = 'owner'
  then
    raise exception 'Invitation is not available' using errcode = '42501';
  end if;
  -- Never silently change an existing member's role.
  insert into public.organization_members (org_id, user_id, role)
    values (invitation.org_id, actor, invitation.role);
  update public.organization_invitations set accepted_at = clock_timestamp() where id = invitation.id;
  return invitation.org_id;
end $$;
revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;
-- accepted_at may only be written by the controlled function; admins cancel by deletion.
revoke update on public.organization_invitations from authenticated;

-- UPDATE revocation alone does not protect INSERT. A new invitation must never
-- arrive pre-accepted, even when inserted directly through the Data API.
create function private.guard_invitation_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.accepted_at is not null then
    raise exception 'New invitations cannot be accepted' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_invitation_insert() from public, anon, authenticated;
create trigger guard_invitation_insert before insert on public.organization_invitations
  for each row execute function private.guard_invitation_insert();

-- Token-only inspection for onboarding. No email/organization identity is exposed;
-- the optional email lets the web server bind signup to the invited address.
create function public.inspect_organization_invitation(p_token text, p_email text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare invitation public.organization_invitations;
begin
  select * into invitation from public.organization_invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or invitation.accepted_at is not null or invitation.expires_at <= clock_timestamp()
    or (p_email is not null and invitation.email <> lower(trim(p_email))) then
    raise exception 'Invitation is not available' using errcode = '42501';
  end if;
  return invitation.expires_at;
end $$;
revoke all on function public.inspect_organization_invitation(text, text) from public, authenticated;
grant execute on function public.inspect_organization_invitation(text, text) to anon;
