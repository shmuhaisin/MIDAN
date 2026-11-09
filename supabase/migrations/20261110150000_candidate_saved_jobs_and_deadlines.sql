-- Candidate experience (owner's candidate brief, sections 9 and 11). Additive only.
--   1. Saved jobs: a candidate bookmarks published jobs; only they can see or change their list.
--   2. The application deadline is enforced by the database: before this, a job past jobs.application_deadline still
--      accepted applications (only "published" was checked). The deadline is a date in Riyadh time and is inclusive.

create table public.saved_jobs (
  candidate_id uuid not null references public.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_id, job_id)
);
create index on public.saved_jobs (job_id);
alter table public.saved_jobs enable row level security;
create policy "candidate reads own" on public.saved_jobs for select to authenticated using (candidate_id = (select auth.uid()));
create policy "candidate saves published jobs" on public.saved_jobs for insert to authenticated with check (
  candidate_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
);
create policy "candidate removes own" on public.saved_jobs for delete to authenticated using (candidate_id = (select auth.uid()));
grant select, insert, delete on public.saved_jobs to authenticated;

create function private.guard_application_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_deadline date;
begin
  select application_deadline into v_deadline from public.jobs where id = new.job_id;
  if v_deadline is not null and v_deadline < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'This job is not open for applications: the deadline has passed' using errcode = '23514';
  end if;
  return new;
end $$;

-- Fires after guard_applicant (a candidate account) and before guard_application (triggers run in name order).
create trigger guard_applicant_deadline before insert on public.applications
  for each row execute function private.guard_application_deadline();

revoke all on function private.guard_application_deadline() from public, anon, authenticated;
