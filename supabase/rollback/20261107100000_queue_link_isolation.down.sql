-- Rolls back 20261107100000_queue_link_isolation. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop function if exists public.enqueue_background_job(text, uuid, jsonb);
create or replace function private.claim_background_job(p_worker text, p_kinds text[], p_lease interval DEFAULT '00:05:00'::interval) RETURNS SETOF public.background_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.background_jobs set status = 'queued', locked_at = null, locked_by = null,
    last_error = coalesce(last_error, 'lease expired')
  where status = 'running' and locked_at < now() - p_lease;
  return query
  update public.background_jobs b set status = 'running', locked_at = now(), locked_by = left(p_worker, 100), attempts = b.attempts + 1
  where b.id = (
    select id from public.background_jobs where status = 'queued' and run_after <= now() and kind = any(p_kinds)
    order by run_after, created_at for update skip locked limit 1
  )
  returning b.*;
end $$;
create or replace function public.admin_retry_background_job(p_job uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  update public.background_jobs set status = 'queued', attempts = 0, run_after = now(), last_error = null, finished_at = null where id = p_job and status = 'failed';
  if not found then raise exception 'Only a failed job can be retried' using errcode = '23514'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), 'retry', 'background_jobs', p_job::text, '{}');
end $$;
create or replace function public.enqueue_background_job(p_kind text, p_subject uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_dedupe text DEFAULT NULL::text) RETURNS public.background_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  j public.background_jobs;
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_kind = 'cv_analysis' then
    if not exists (select 1 from public.cv_analyses a where a.id = p_subject and a.candidate_id = auth.uid()) then
      raise exception 'Analysis not available' using errcode = '42501';
    end if;
  elsif p_kind = 'job_analysis' then
    select org_id into v_org from public.jobs where id = p_subject;
    if v_org is null or not private.is_org_member(v_org, array['owner', 'admin', 'recruiter']::public.org_role[]) then
      raise exception 'Job not available' using errcode = '42501';
    end if;
  else
    raise exception 'This kind of job is not queued from here' using errcode = '22023';
  end if;
  insert into public.background_jobs (kind, acting_user_id, acting_email, org_id, subject_id, payload, dedupe_key)
  values (p_kind, auth.uid(), coalesce(auth.email(), (select email from public.users where id = auth.uid())), v_org, p_subject, coalesce(p_payload, '{}'),
    coalesce(p_dedupe, p_kind || ':' || p_subject))
  on conflict (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null do nothing
  returning * into j;
  if j.id is null then
    select * into j from public.background_jobs where dedupe_key = coalesce(p_dedupe, p_kind || ':' || p_subject) and status in ('queued', 'running');
  end if;
  return j;
end $$;
REVOKE ALL ON FUNCTION public.enqueue_background_job(p_kind text, p_subject uuid, p_payload jsonb, p_dedupe text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_background_job(p_kind text, p_subject uuid, p_payload jsonb, p_dedupe text) TO authenticated;
