-- Real candidate data stays out until privacy and data residency are reviewed.
-- Sign-up is refused at the database unless the address matches an allowed pattern, however it's attempted.
create table private.allowed_signup_patterns (
  pattern text primary key,
  note text not null
);
revoke all on private.allowed_signup_patterns from public, anon, authenticated;
insert into private.allowed_signup_patterns (pattern, note)
values ('midan.test.%@example.com', 'Automated test accounts');

create function private.guard_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_signup_patterns p where new.email ilike p.pattern) then
    raise exception 'Registration is closed during the demo stage' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_signup before insert on auth.users for each row execute function private.guard_signup();

-- A candidate can always read the job and organization they applied to, even after it stops being public.
create function private.candidate_applied_job(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.applications a where a.job_id = p_job and a.candidate_id = auth.uid())
$$;

create function private.candidate_applied_org(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.applications a where a.org_id = p_org and a.candidate_id = auth.uid())
$$;

revoke all on function private.candidate_applied_job(uuid), private.candidate_applied_org(uuid) from public, anon;
grant execute on function private.candidate_applied_job(uuid), private.candidate_applied_org(uuid) to authenticated;

create policy "candidate reads applied job" on public.jobs for select to authenticated
  using (private.candidate_applied_job(id));
create policy "candidate reads applied organization" on public.organizations for select to authenticated
  using (private.candidate_applied_org(id));

alter table public.jobs add column requirements_ar text, add column requirements_en text;

alter table public.assessment_versions add column ai_thread_id text;

alter table public.evaluation_results
  add column ai_thread_id text,
  add column ai_mode text check (ai_mode in ('demo', 'live')),
  add column review_reasons jsonb not null default '[]',
  add column report jsonb;

-- Every AI run is recorded, including whether a real model was involved.
create table public.ai_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow text not null check (workflow in ('assessment_builder', 'evaluation')),
  thread_id text not null unique,
  status text not null,
  mode text not null check (mode in ('demo', 'live')),
  model_version text not null,
  prompt_version text not null,
  started_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_workflow_runs (org_id);
create index on public.ai_workflow_runs (started_by);
create trigger set_updated_at before update on public.ai_workflow_runs for each row execute function private.set_updated_at();

alter table public.ai_workflow_runs enable row level security;
create policy "org members read" on public.ai_workflow_runs for select to authenticated
  using (private.is_org_member(org_id));
create policy "org staff record" on public.ai_workflow_runs for insert to authenticated
  with check (started_by = (select auth.uid()) and private.is_org_member(org_id));
create policy "org staff update" on public.ai_workflow_runs for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
grant select, insert, update on public.ai_workflow_runs to authenticated;

-- A human-reviewed result moves the application on, whichever staff role did the review.
create function private.mark_application_evaluated() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'reviewed' and old.status <> 'reviewed' then
    update public.applications a set status = 'evaluated'
    from public.assessment_attempts t
    where t.id = new.attempt_id and a.id = t.application_id and a.status <> 'withdrawn';
  end if;
  return null;
end $$;

create trigger mark_application_evaluated after update of status on public.evaluation_results
  for each row execute function private.mark_application_evaluated();
