-- A durable job queue for long-running work, a narrowly scoped worker role, a schema for persistent AI workflow
-- checkpoints, an administrator-managed learning catalog, and job analysis against the sector skills reference.

-- ---------------------------------------------------------------------------------------------------------------
-- Background jobs. Rows hold ids and short-lived links, never CV text or personal data.
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cv_analysis', 'job_analysis', 'assessment_generation', 'evaluation', 'learning_recommendations', 'data_import')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- Who the work is done for. The worker acts as this person, so their row security applies to the work itself.
  acting_user_id uuid not null references public.users (id) on delete cascade,
  acting_email text not null,
  org_id uuid references public.organizations (id) on delete cascade,
  subject_id uuid,
  payload jsonb not null default '{}',
  -- At most one active job per key, so a double click or a retry doesn't queue the same work twice.
  dedupe_key text,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index background_jobs_active_dedupe on public.background_jobs (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null;
create index background_jobs_ready on public.background_jobs (run_after) where status = 'queued';
create index on public.background_jobs (acting_user_id, created_at desc);
create index on public.background_jobs (org_id);
create trigger set_updated_at before update on public.background_jobs for each row execute function private.set_updated_at();

alter table public.background_jobs enable row level security;
create policy "own reads" on public.background_jobs for select to authenticated using (acting_user_id = auth.uid());
create policy "platform admins read" on public.background_jobs for select to authenticated using (private.is_platform_admin());
-- Payloads can hold a short-lived file link, so no one reads them through the Data API.
grant select (id, kind, status, acting_user_id, org_id, subject_id, attempts, max_attempts, run_after, locked_at, last_error, result, created_at, updated_at, finished_at)
  on public.background_jobs to authenticated;

/** Queues work for the caller. Each kind checks that the caller may ask for it. */
create function public.enqueue_background_job(p_kind text, p_subject uuid, p_payload jsonb default '{}', p_dedupe text default null)
returns public.background_jobs language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.enqueue_background_job(text, uuid, jsonb, text) from public, anon;
grant execute on function public.enqueue_background_job(text, uuid, jsonb, text) to authenticated;

-- The worker. midan_api assumes this role only to claim and settle jobs; it can read and write nothing else.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'midan_worker') then
    create role midan_worker nologin noinherit nobypassrls;
  end if;
end $$;
grant midan_worker to midan_api;
grant usage on schema private to midan_worker;

/** Claims one ready job. A job whose lease has run out (its worker died) is claimable again. */
create function private.claim_background_job(p_worker text, p_kinds text[], p_lease interval default interval '5 minutes')
returns setof public.background_jobs language plpgsql security definer set search_path = '' as $$
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

/** Records an outcome. A failure is retried with a growing delay until max_attempts, then it stays failed for a person. */
create function private.settle_background_job(p_job uuid, p_worker text, p_ok boolean, p_result jsonb default null, p_error text default null, p_retryable boolean default true)
returns public.background_jobs language plpgsql security definer set search_path = '' as $$
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
revoke all on function private.claim_background_job(text, text[], interval), private.settle_background_job(uuid, text, boolean, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.claim_background_job(text, text[], interval), private.settle_background_job(uuid, text, boolean, jsonb, text, boolean) to midan_worker;

create function public.admin_retry_background_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  update public.background_jobs set status = 'queued', attempts = 0, run_after = now(), last_error = null, finished_at = null where id = p_job and status = 'failed';
  if not found then raise exception 'Only a failed job can be retried' using errcode = '23514'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), 'retry', 'background_jobs', p_job::text, '{}');
end $$;
revoke all on function public.admin_retry_background_job(uuid) from public, anon;
grant execute on function public.admin_retry_background_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Persistent checkpoints for the AI service's LangGraph workflows, so an evaluation waiting for a reviewer survives a
-- restart. Only the AI service's own login reaches this schema, and it holds workflow state, not candidate identity.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'midan_ai') then
    create role midan_ai nologin noinherit nobypassrls;
  end if;
end $$;
create schema if not exists ai_checkpoints authorization midan_ai;
revoke all on schema ai_checkpoints from public;

-- ---------------------------------------------------------------------------------------------------------------
-- The learning catalog. Administrators add entries a person has checked; each carries the link and the date it was checked.
alter table public.learning_resources
  add column added_by uuid references public.users (id) on delete set null,
  add column notes text,
  add constraint learning_resources_provider_check check (length(trim(provider)) > 0);
create policy "platform admins write" on public.learning_resources for insert to authenticated with check (private.is_platform_admin());
create policy "platform admins update" on public.learning_resources for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "platform admins delete" on public.learning_resources for delete to authenticated using (private.is_platform_admin());
grant insert, update, delete on public.learning_resources to authenticated;
create function private.stamp_learning_resource() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.added_by := auth.uid();
  if new.verified_on > current_date then raise exception 'A check date cannot be in the future' using errcode = '23514'; end if;
  return new;
end $$;
create trigger stamp_learning_resource before insert on public.learning_resources for each row execute function private.stamp_learning_resource();
create trigger write_audit after insert or update or delete on public.learning_resources for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------------------------------------------
-- Job analysis. Finds what a job's own text and stated requirements name in the sector skills reference, and proposes
-- a sector, job family and skills. A proposal changes nothing until the organization accepts it.
create table public.job_analyses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  org_id uuid not null,
  method text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  sector_code text,
  confidence numeric(4, 3),
  subsector_ar text,
  job_family_ar text,
  -- Every proposed skill with the words in the job that matched it, or the reason it was suggested.
  proposals jsonb not null default '[]',
  -- Experience, education, certification and language requirements as the employer stated them, grouped.
  stated jsonb not null default '{}',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
create index on public.job_analyses (job_id, created_at desc);
create index on public.job_analyses (org_id);
alter table public.job_analyses enable row level security;
create policy "org members read" on public.job_analyses for select to authenticated using (private.is_org_member(org_id));
grant select on public.job_analyses to authenticated;

/**
 * Analyzes one job. Two kinds of proposals, kept apart:
 *   mentioned  the job's title, description or a requirement names this reference skill (the matched words are kept)
 *   family     a priority skill the workbooks pair with the proposed job family, which the job doesn't mention
 * Mentioned skills are proposed as required when they appear in a mandatory requirement, otherwise as preferred.
 * Family skills are never proposed as required. Nothing here is a judgement of any candidate.
 */
create function public.analyze_job(p_job uuid) returns public.job_analyses
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_text text;
  v_mandatory text;
  c jsonb;
  v_sector text;
  v_family text;
  v_proposals jsonb;
  v_stated jsonb;
  a public.job_analyses;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_org_member(j.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Job not available' using errcode = '42501';
  end if;
  select concat_ws(' ', j.title_ar, j.title_en, j.description_ar, j.description_en, j.requirements_ar, j.requirements_en,
      string_agg(concat_ws(' ', r.description_ar, r.description_en), ' ')),
    string_agg(concat_ws(' ', r.description_ar, r.description_en), ' ') filter (where r.is_mandatory)
  into v_text, v_mandatory
  from public.job_requirements r where r.job_id = j.id and r.retired_at is null;
  if v_text is null then
    v_text := concat_ws(' ', j.title_ar, j.title_en, j.description_ar, j.description_en, j.requirements_ar, j.requirements_en);
  end if;
  c := private.classify_text(v_text);
  -- An employer's own choice of sector wins over the mention count.
  v_sector := coalesce(nullif(j.sector, 'other'), c ->> 'sector_code');
  v_family := case when v_sector = c ->> 'sector_code' then c ->> 'job_family_ar' end;

  select coalesce(jsonb_agg(p order by (p ->> 'basis'), (p ->> 'required')::boolean desc, p ->> 'name_ar'), '[]') into v_proposals from (
    select jsonb_build_object('reference_skill_id', s.id, 'name_ar', s.name_ar, 'sector_code', s.sector_code, 'basis', 'mentioned',
      'evidence', trim(private.match_text(s.name_ar)), 'required', strpos(private.match_text(v_mandatory), private.match_text(s.name_ar)) > 0,
      'is_priority', s.is_priority, 'source', jsonb_build_object('file', s.source_file, 'sheet', s.source_sheet, 'row', s.source_row)) as p
    from public.reference_skills s
    where s.sector_code = v_sector and (strpos(s.name_search, ' ') > 0 or length(s.name_search) >= 8)
      and strpos(private.match_text(v_text), private.match_text(s.name_ar)) > 0
    union all
    select jsonb_build_object('reference_skill_id', s.id, 'name_ar', s.name_ar, 'sector_code', s.sector_code, 'basis', 'family',
      'evidence', v_family, 'required', false, 'is_priority', true,
      'source', jsonb_build_object('file', s.source_file, 'sheet', s.source_sheet, 'row', s.source_row)) as p
    from public.reference_skills s
    where v_family is not null and s.sector_code = v_sector and s.skill_kind = 'technical' and s.is_priority
      and exists (select 1 from public.reference_skill_contexts x where x.skill_id = s.id and x.job_family_ar = v_family)
      and not (strpos(private.match_text(v_text), private.match_text(s.name_ar)) > 0)
    limit 60
  ) x;

  select jsonb_object_agg(t, items) into v_stated from (
    select r.requirement_type::text as t, jsonb_agg(jsonb_build_object('id', r.id, 'description_ar', r.description_ar, 'description_en', r.description_en,
      'is_mandatory', r.is_mandatory, 'min_years', r.min_years) order by r.position) as items
    from public.job_requirements r where r.job_id = j.id and r.retired_at is null and r.review_status = 'approved'
    group by r.requirement_type
  ) y;

  insert into public.job_analyses (job_id, org_id, method, sector_code, confidence, subsector_ar, job_family_ar, proposals, stated, created_by)
  values (j.id, j.org_id, 'reference_skill_mentions_v1', v_sector,
    case when v_sector = c ->> 'sector_code' then (c ->> 'confidence')::numeric end,
    case when v_sector = c ->> 'sector_code' then c ->> 'subsector_ar' end, v_family, v_proposals, coalesce(v_stated, '{}'), auth.uid())
  returning * into a;
  return a;
end $$;

/** Accepts chosen proposals: they become the job's reference skills. The rest are left alone. */
create function public.accept_job_analysis(p_analysis uuid, p_skills uuid[], p_required uuid[], p_set_sector boolean) returns public.job_analyses
language plpgsql security definer set search_path = '' as $$
declare a public.job_analyses;
begin
  select * into a from public.job_analyses where id = p_analysis for update;
  if a.id is null or not private.is_org_member(a.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Analysis not available' using errcode = '42501';
  end if;
  if a.status <> 'proposed' then raise exception 'This analysis was already decided' using errcode = '23514'; end if;
  insert into public.job_reference_skills (job_id, org_id, reference_skill_id, is_required)
  select a.job_id, a.org_id, (p ->> 'reference_skill_id')::uuid, (p ->> 'reference_skill_id')::uuid = any(coalesce(p_required, '{}'))
  from jsonb_array_elements(a.proposals) p where (p ->> 'reference_skill_id')::uuid = any(coalesce(p_skills, '{}'))
  on conflict (job_id, reference_skill_id) do update set is_required = excluded.is_required;
  if p_set_sector and a.sector_code is not null then
    update public.jobs set sector = a.sector_code where id = a.job_id;
  end if;
  update public.job_analyses set status = 'accepted', decided_at = now() where id = a.id returning * into a;
  return a;
end $$;

create function public.dismiss_job_analysis(p_analysis uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_analyses set status = 'dismissed', decided_at = now()
  where id = p_analysis and status = 'proposed' and private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]);
  if not found then raise exception 'Analysis not available' using errcode = '42501'; end if;
end $$;
revoke all on function public.analyze_job(uuid), public.accept_job_analysis(uuid, uuid[], uuid[], boolean), public.dismiss_job_analysis(uuid) from public, anon;
grant execute on function public.analyze_job(uuid), public.accept_job_analysis(uuid, uuid[], uuid[], boolean), public.dismiss_job_analysis(uuid) to authenticated;
