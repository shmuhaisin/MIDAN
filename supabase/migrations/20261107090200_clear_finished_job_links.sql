-- A CV analysis job carries a signed link to the file, valid for 30 minutes so the queue can retry. Once the job has
-- finished, nothing needs it, so it's removed instead of staying readable in the job's payload.
-- Same function as in 20261106150000_background_jobs_and_job_analysis.sql, apart from the payload.

create or replace function private.settle_background_job(p_job uuid, p_worker text, p_ok boolean, p_result jsonb default null, p_error text default null, p_retryable boolean default true)
returns public.background_jobs language plpgsql security definer set search_path = '' as $$
declare j public.background_jobs;
begin
  select * into j from public.background_jobs where id = p_job and status = 'running' and locked_by = left(p_worker, 100) for update;
  -- Another worker took over after this one's lease ran out. Its result is the one that counts.
  if not found then return null; end if;
  if p_ok then
    update public.background_jobs set status = 'succeeded', result = p_result, last_error = null, locked_at = null, finished_at = now(),
      payload = payload - 'file_url' where id = p_job returning * into j;
  elsif p_retryable and j.attempts < j.max_attempts then
    update public.background_jobs set status = 'queued', locked_at = null, locked_by = null, last_error = left(p_error, 300),
      run_after = now() + (interval '10 seconds' * power(3, j.attempts - 1)) where id = p_job returning * into j;
  else
    update public.background_jobs set status = 'failed', locked_at = null, last_error = left(p_error, 300), finished_at = now(),
      payload = payload - 'file_url' where id = p_job returning * into j;
  end if;
  return j;
end $$;

-- Jobs that finished before this migration.
update public.background_jobs set payload = payload - 'file_url' where status in ('succeeded', 'failed') and payload ? 'file_url';
