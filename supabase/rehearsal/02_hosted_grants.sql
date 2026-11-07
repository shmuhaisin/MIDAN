-- LOCAL REHEARSAL ONLY. Run as supabase_admin after the shim and Auth's own migrations. The memberships below are hosted's.
grant anon, authenticated, authenticator, service_role to postgres with admin true, inherit true, set true;
grant pg_read_all_data, pg_monitor, pg_signal_backend to postgres with admin true, inherit true, set true;
grant create on database midan to postgres;

-- An approximation. Supabase lets postgres manage triggers and policies on auth and storage tables it doesn't own, through its
-- supautils extension, which a plain server doesn't have. Inheriting from the owners, without being able to become them, is
-- the nearest equivalent.
grant supabase_auth_admin, supabase_storage_admin to postgres with inherit true, set false;
grant all on schema auth, storage to postgres;
grant all on all tables in schema auth, storage to postgres;
grant all on all functions in schema auth, storage to postgres;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
grant usage, create on schema storage to supabase_storage_admin;
