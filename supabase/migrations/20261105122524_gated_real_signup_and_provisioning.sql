-- Development registration with real email addresses and real verification, closed to the public.
-- A sign-up needs an access code known only to the development server, so calling Supabase directly fails.
-- Only a hash is stored here. Set it outside version control (see docs/database/README.md).
create table private.signup_access (
  code_hash text primary key,
  note text not null
);
revoke all on private.signup_access from public, anon, authenticated;

delete from private.allowed_signup_patterns where pattern = '%@example.com';

create or replace function private.guard_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  code text := new.raw_user_meta_data ->> 'midan_test_access';
begin
  -- The code never stays on the account.
  new.raw_user_meta_data := new.raw_user_meta_data - 'midan_test_access';
  if exists (select 1 from private.allowed_signup_patterns p where new.email ilike p.pattern) then
    return new;
  end if;
  if code is not null and exists (
    select 1 from private.signup_access a where a.code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex')
  ) then
    return new;
  end if;
  raise exception 'Registration is closed' using errcode = '42501';
end $$;

-- Once an email is verified, the account gets its candidate profile or its organization.
-- Waiting for verification stops unverified sign-ups from taking organization names.
-- It never blocks verification: if this fails, the person can still finish setup in the app.
create function private.provision_account(p_user uuid, p_email text, p_meta jsonb) returns void
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

create or replace function private.sync_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.users (id, email, display_name)
    values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
    if new.email_confirmed_at is not null then
      perform private.provision_account(new.id, new.email, new.raw_user_meta_data);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.email is distinct from old.email then
      update public.users set email = new.email where id = new.id;
    end if;
    if new.email_confirmed_at is not null and old.email_confirmed_at is null then
      perform private.provision_account(new.id, new.email, new.raw_user_meta_data);
    end if;
  else
    delete from public.users where id = old.id;
    return old;
  end if;
  return new;
end $$;

drop trigger sync_public_user_update on auth.users;
create trigger sync_public_user_update after update of email, email_confirmed_at on auth.users
  for each row execute function private.sync_auth_user();
