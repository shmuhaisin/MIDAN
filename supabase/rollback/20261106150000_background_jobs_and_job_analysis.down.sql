-- Rolls back 20261106150000_background_jobs_and_job_analysis. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop trigger stamp_learning_resource on public.learning_resources;
drop trigger write_audit on public.learning_resources;
drop policy "platform admins delete" on public.learning_resources;
drop policy "platform admins update" on public.learning_resources;
drop policy "platform admins write" on public.learning_resources;
alter table public.learning_resources drop constraint learning_resources_added_by_fkey;
drop table public.background_jobs cascade;
drop table public.job_analyses cascade;
alter table public.learning_resources drop constraint learning_resources_provider_check;
alter table public.learning_resources drop column added_by;
alter table public.learning_resources drop column notes;
drop function if exists private.claim_background_job(text, text[], interval);
drop function if exists private.settle_background_job(uuid, text, boolean, jsonb, text, boolean);
drop function if exists private.stamp_learning_resource();
drop function if exists public.accept_job_analysis(uuid, uuid[], uuid[], boolean);
drop function if exists public.admin_retry_background_job(uuid);
drop function if exists public.analyze_job(uuid);
drop function if exists public.dismiss_job_analysis(uuid);
drop function if exists public.enqueue_background_job(text, uuid, jsonb, text);
REVOKE USAGE ON SCHEMA private FROM midan_worker;
REVOKE SELECT,INSERT,DELETE,UPDATE ON TABLE public.learning_resources FROM authenticated;
GRANT SELECT ON TABLE public.learning_resources TO authenticated;

-- Roles and the schema this migration created. Anything stored in them is lost: AI checkpoints and queued work.
drop schema ai_checkpoints cascade;
revoke midan_worker from midan_api;
drop role midan_worker;
drop role midan_ai;
