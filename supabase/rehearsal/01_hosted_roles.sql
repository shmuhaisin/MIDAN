-- LOCAL REHEARSAL ONLY. Run as the cluster's superuser, named supabase_admin as on Supabase. Makes postgres what it is on
-- hosted, as read from pg_roles and pg_auth_members on 2026-11-07: not a superuser, and able to create roles and databases.
create role postgres login nosuperuser createdb createrole replication bypassrls inherit;
create database midan owner postgres;
