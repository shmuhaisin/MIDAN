-- Rolls back 20261107090200_clear_finished_job_links. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

create or replace function private.settle_background_job(p_job uuid, p_worker text, p_ok boolean, p_result jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text, p_retryable boolean DEFAULT true) RETURNS public.background_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j public.background_jobs;
begin
  select * into j from public.background_jobs where id = p_job and status = 'running' and locked_by = left(p_worker, 100) for update;
  -- Another worker took over after this one's lease ran out. Its result is the one that counts.
  if not found then return null; end if;
  if p_ok then
    update public.background_jobs set status = 'succeeded', result = p_result, last_error = null, locked_at = null, finished_at = now() where id = p_job returning * into j;
  elsif p_retryable and j.attempts < j.max_attempts then
    update public.background_jobs set status = 'queued', locked_at = null, locked_by = null, last_error = left(p_error, 300),
      run_after = now() + (interval '10 seconds' * power(3, j.attempts - 1)) where id = p_job returning * into j;
  else
    update public.background_jobs set status = 'failed', locked_at = null, last_error = left(p_error, 300), finished_at = now() where id = p_job returning * into j;
  end if;
  return j;
end $$;
