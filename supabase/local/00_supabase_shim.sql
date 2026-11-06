-- LOCAL DEVELOPMENT ONLY. Never apply this to a Supabase project: Supabase already provides all of it.
--
-- A plain PostgreSQL 16 server doesn't have the roles, schemas and helper functions that Supabase
-- provides and that supabase/migrations depend on. This file recreates the small subset they use, with
-- the same names and behaviour, so the real migrations can run unchanged on a local server.
-- See docs/local-development.md.



do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  -- Supabase Auth (GoTrue) runs as this role and owns the auth schema, as on Supabase.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login password 'local-auth' createrole;
  end if;
  -- The local Storage stand-in logs in as this role. It bypasses RLS only to read bucket limits and blobs;
  -- object rows are written with the caller's role so storage policies decide, as Supabase Storage does.
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login password 'local-storage' bypassrls;
  end if;
  -- PostgREST logs in as this role and switches to anon or authenticated per request, as on Supabase.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'local-authenticator' noinherit;
  end if;
end $$;

create schema if not exists auth authorization supabase_auth_admin;
grant all on schema auth to postgres;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated to supabase_storage_admin;
grant create on database midan to supabase_auth_admin;
create schema if not exists storage;
create schema if not exists extensions;
alter database midan set search_path = "$user", public, extensions;
create extension if not exists pgcrypto schema extensions;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
-- Supabase lets the request roles reach the table and leaves the decision to policies.
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
drop policy if exists "buckets are readable" on storage.buckets;
create policy "buckets are readable" on storage.buckets for select using (true);

grant all on storage.objects, storage.buckets to supabase_storage_admin;
grant usage on schema storage to supabase_storage_admin;

-- Local only: file bytes live next to the row. Supabase keeps them in object storage.
create table if not exists storage.local_blobs (
  object_id uuid primary key references storage.objects (id) on delete cascade,
  content bytea not null
);

create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1 : array_length(parts, 1) - 1];
end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[array_length(parts, 1)];
end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare parts text[];
begin
  select string_to_array(storage.filename(name), '.') into parts;
  return parts[array_length(parts, 1)];
end $$;
grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text) to anon, authenticated, service_role;

-- Supabase's migration history table, so applied migrations can be listed the same way locally.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements_md5 text,
  applied_at timestamptz not null default now()
);
grant all on storage.local_blobs to supabase_storage_admin;
