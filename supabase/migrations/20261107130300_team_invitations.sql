-- Phase 3: an organization's team. An owner or admin invites someone by email. That person accepts while signed in with the same verified
-- email, so holding the account is the proof and no link needs to be kept secret. Registration stays closed: without an account, the
-- invitation waits for one. Email delivery needs SMTP, so for now the invitation appears in the app and the inviter can share the address.
alter table public.organization_invitations alter column token_hash drop not null;
create unique index organization_invitations_one_open on public.organization_invitations (org_id, email) where accepted_at is null;

create function public.invite_organization_member(p_org uuid, p_email text, p_role public.org_role) returns public.organization_invitations
language plpgsql security definer set search_path = '' as $$
declare
  i public.organization_invitations;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.is_org_member(p_org, array['owner', 'admin']::public.org_role[]) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_role = 'owner' then raise exception 'An invitation is not allowed to grant ownership' using errcode = '23514'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Invalid email' using errcode = '22023'; end if;
  if exists (select 1 from public.organization_members m join public.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'This person is not open for an invitation: they are a member already' using errcode = '23514';
  end if;
  insert into public.organization_invitations (org_id, email, role, invited_by, expires_at)
  values (p_org, v_email, p_role, auth.uid(), now() + interval '14 days')
  on conflict (org_id, email) where accepted_at is null do update set role = excluded.role, invited_by = excluded.invited_by, expires_at = excluded.expires_at
  returning * into i;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'invite', 'organization_invitations', i.id::text, jsonb_build_object('role', p_role));
  insert into public.notifications (user_id, kind, link, dedupe_key)
  select u.id, 'organization_invitation', '/invitations', 'invitation:' || i.id from public.users u where lower(u.email) = v_email
  on conflict (user_id, dedupe_key) do nothing;
  return i;
end $$;

/** The people in an organization, for its members. Staff can't otherwise read each other's account details. */
create function public.organization_team(p_org uuid)
returns table (user_id uuid, email text, display_name text, role public.org_role, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_member(p_org) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select m.user_id, u.email::text, u.display_name::text, m.role, m.created_at
  from public.organization_members m join public.users u on u.id = m.user_id where m.org_id = p_org order by m.created_at;
end $$;

create function public.my_organization_invitations()
returns table (id uuid, org_id uuid, name_ar text, name_en text, role public.org_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.org_id, o.name_ar, o.name_en, i.role, i.expires_at
  from public.organization_invitations i join public.organizations o on o.id = i.org_id
  join public.users u on u.id = auth.uid() and lower(u.email) = i.email
  where i.accepted_at is null and i.expires_at > now() order by i.created_at desc
$$;

create function public.accept_organization_invitation(p_invitation uuid) returns uuid
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

create function public.decline_organization_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.organization_invitations;
begin
  select v.* into i from public.organization_invitations v join public.users u on u.id = auth.uid() and lower(u.email) = v.email
  where v.id = p_invitation and v.accepted_at is null for update of v;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  delete from public.organization_invitations where id = i.id;
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details) values (i.org_id, auth.uid(), 'decline', 'organization_invitations', i.id::text, '{}');
end $$;

revoke all on function public.invite_organization_member(uuid, text, public.org_role), public.organization_team(uuid), public.my_organization_invitations(),
  public.accept_organization_invitation(uuid), public.decline_organization_invitation(uuid) from public, anon;
grant execute on function public.invite_organization_member(uuid, text, public.org_role), public.organization_team(uuid), public.my_organization_invitations(),
  public.accept_organization_invitation(uuid), public.decline_organization_invitation(uuid) to authenticated;
