-- Rolls back 20261106170000_employer_profiles_and_job_links. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

alter table public.organizations drop constraint organizations_employer_registry_id_key;
alter table public.organizations drop constraint organizations_employer_linked_by_fkey;
alter table public.organizations drop constraint organizations_employer_registry_id_fkey;
alter table public.organizations drop column employer_registry_id;
alter table public.organizations drop column employer_linked_by;
alter table public.organizations drop column employer_linked_at;
drop function if exists public.admin_link_organization_employer(uuid, uuid);
drop function if exists public.employer_jobs(uuid);
drop function if exists public.search_employers(text);
