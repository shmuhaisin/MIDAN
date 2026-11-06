-- Closes three gaps around the 30-minute CV link in public.background_jobs. The link itself stays, as the owner decided.
--
-- 1. enqueue_background_job took its deduplication key from the caller and returned the whole row. A candidate who knew
--    another candidate's analysis id could pass that job's key and receive its payload, signed link included, and the
--    other person's email. The key is now always derived from the job, and the function returns no private columns.
-- 2. It accepted any payload, so a candidate could queue their own analysis with a URL of their choosing for the worker
--    to fetch. A cv_analysis job now takes only a signed link into the caller's own folder. The worker checks the host.
-- 3. A job whose worker kept dying was reclaimed forever and kept its link. Past max_attempts it now fails like any other.
--
-- A failed cv_analysis job has lost its link, so retrying it could only ever report a missing file. An administrator's
-- retry now says so; the candidate's own retry makes a fresh link (POST /me/cv/analyses).

drop function public.enqueue_background_job(text, uuid, jsonb, text);

create function public.enqueue_background_job(p_kind text, p_subject uuid, p_payload jsonb default '{}')
returns public.background_jobs language plpgsql security definer set search_path = '' as $$
declare
  j public.background_jobs;
  v_org uuid;
  v_payload jsonb := coalesce(p_payload, '{}');
  v_key text := p_kind || ':' || p_subject;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if octet_length(v_payload::text) > 4096 then raise exception 'Payload too large' using errcode = '22023'; end if;
  if p_kind = 'cv_analysis' then
    if not exists (select 1 from public.cv_analyses a where a.id = p_subject and a.candidate_id = auth.uid()) then
      raise exception 'Analysis not available' using errcode = '42501';
    end if;
    if v_payload - 'file_url' <> '{}' or (v_payload ? 'file_url' and coalesce(v_payload ->> 'file_url', '')
      !~ ('^https?://[^/?#]+/storage/v1/object/sign/candidate-documents/' || auth.uid()::text || '/[^?#]+[?]token=')) then
      raise exception 'A CV job takes only a signed link to the caller''s own file' using errcode = '22023';
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
  values (p_kind, auth.uid(), coalesce(auth.email(), (select email from public.users where id = auth.uid())), v_org, p_subject, v_payload, v_key)
  on conflict (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null do nothing
  returning * into j;
  if j.id is null then
    select * into j from public.background_jobs where dedupe_key = v_key and status in ('queued', 'running');
  end if;
  -- Callers get the job's state. Payloads, and whose job or worker it is, stay out of what the Data API returns.
  j.payload := '{}';
  j.acting_email := null;
  j.locked_by := null;
  return j;
end $$;
revoke all on function public.enqueue_background_job(text, uuid, jsonb) from public, anon;
grant execute on function public.enqueue_background_job(text, uuid, jsonb) to authenticated;

/** Same function as in 20261106150000_background_jobs_and_job_analysis.sql, apart from jobs that have used every attempt. */
create or replace function private.claim_background_job(p_worker text, p_kinds text[], p_lease interval default interval '5 minutes')
returns setof public.background_jobs language plpgsql security definer set search_path = '' as $$
begin
  -- Its worker died on the last attempt too. It ends here, without its link, and the candidate sees a failure to retry.
  with spent as (
    update public.background_jobs set status = 'failed', locked_at = null, last_error = 'lease expired', finished_at = now(), payload = payload - 'file_url'
    where status = 'running' and locked_at < now() - p_lease and attempts >= max_attempts
    returning kind, subject_id
  )
  update public.cv_analyses a set status = 'failed', failure_code = 'analysis_unavailable', finished_at = now()
  from spent where spent.kind = 'cv_analysis' and a.id = spent.subject_id and a.status = 'pending';

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

create or replace function public.admin_retry_background_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if exists (select 1 from public.background_jobs where id = p_job and kind = 'cv_analysis') then
    raise exception 'This job cannot be retried: its file link is gone, and only the candidate can make a new one' using errcode = '23514';
  end if;
  update public.background_jobs set status = 'queued', attempts = 0, run_after = now(), last_error = null, finished_at = null where id = p_job and status = 'failed';
  if not found then raise exception 'Only a failed job can be retried' using errcode = '23514'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), 'retry', 'background_jobs', p_job::text, '{}');
end $$;
