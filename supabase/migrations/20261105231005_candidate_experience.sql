-- The candidate journey: reference data, CV analysis, application snapshots, assessment timing, interviews,
-- outcomes, career development and notifications. Additive, except that applying now assigns published assessments.

-- Reference data. An entry here is an identity record: not a partner, not an account, not a source of vacancies.
create table public.employer_registry (
  id uuid primary key default gen_random_uuid(),
  source_company_id text not null unique,
  name_ar text not null,
  name_en text not null,
  entity_type text,
  sector text,
  official_website text,
  career_url text,
  verification_source text,
  verification_status text not null,
  partnership_status text not null default 'not_partner',
  identity_status text,
  usage_permission text,
  notes text,
  source_file text not null,
  created_at timestamptz not null default now()
);
create table public.employer_aliases (
  registry_id uuid not null references public.employer_registry (id) on delete cascade,
  name_variant text not null,
  language text not null,
  alias_status text not null,
  primary key (registry_id, name_variant)
);
create table public.employer_sources (
  registry_id uuid not null references public.employer_registry (id) on delete cascade,
  source_url text not null,
  source_type text not null,
  checked_on date,
  primary key (registry_id, source_url)
);

create table public.reference_skills (
  id uuid primary key default gen_random_uuid(),
  sector_code text not null,
  skill_kind text not null check (skill_kind in ('technical', 'general')),
  name_ar text not null,
  description_ar text,
  is_priority boolean,
  source_file text not null,
  source_sheet text not null,
  source_row integer not null,
  source_skill_id text,
  proficiency_scale jsonb,
  created_at timestamptz not null default now(),
  unique (sector_code, skill_kind, name_ar)
);
create table public.reference_skill_contexts (
  skill_id uuid not null references public.reference_skills (id) on delete cascade,
  subsector_ar text not null,
  job_family_ar text not null,
  source_sheet text not null,
  primary key (skill_id, subsector_ar, job_family_ar)
);
create index on public.reference_skill_contexts (job_family_ar);
create index on public.reference_skills (sector_code);

-- Only the import procedure writes these. Its execute grant exists for the length of an import.
create function private.import_reference_data(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_skills integer := 0;
  v_contexts integer := 0;
  r jsonb;
  v_id uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'employers', '[]')) loop
    insert into public.employer_registry (source_company_id, name_ar, name_en, entity_type, sector, official_website, career_url, verification_source,
      verification_status, partnership_status, identity_status, usage_permission, notes, source_file)
    values (r ->> 'company_id', r ->> 'name_ar', r ->> 'name_en', r ->> 'entity_type', r ->> 'sector', r ->> 'official_website', r ->> 'career_url', r ->> 'verification_source',
      r ->> 'verification_status', r ->> 'partnership_status', r ->> 'identity_status', r ->> 'usage_permission', r ->> 'notes', r ->> 'source_file')
    on conflict (source_company_id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, entity_type = excluded.entity_type, sector = excluded.sector,
      official_website = excluded.official_website, career_url = excluded.career_url, verification_source = excluded.verification_source,
      verification_status = excluded.verification_status, partnership_status = excluded.partnership_status, identity_status = excluded.identity_status,
      usage_permission = excluded.usage_permission, notes = excluded.notes
    returning id into v_id;
    insert into public.employer_aliases select v_id, a ->> 'name_variant', a ->> 'language', a ->> 'alias_status' from jsonb_array_elements(r -> 'aliases') a
      on conflict (registry_id, name_variant) do update set alias_status = excluded.alias_status;
    insert into public.employer_sources select v_id, s ->> 'source_url', s ->> 'source_type', (s ->> 'checked_on')::date from jsonb_array_elements(r -> 'sources') s
      on conflict (registry_id, source_url) do update set source_type = excluded.source_type, checked_on = excluded.checked_on;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'skills', '[]')) loop
    insert into public.reference_skills (sector_code, skill_kind, name_ar, description_ar, is_priority, source_file, source_sheet, source_row)
    values (r ->> 'sector_code', r ->> 'skill_kind', r ->> 'name_ar', r ->> 'description_ar', (r ->> 'is_priority')::boolean, r ->> 'source_file', r ->> 'source_sheet', (r ->> 'source_row')::integer)
    on conflict (sector_code, skill_kind, name_ar) do update set description_ar = excluded.description_ar, is_priority = excluded.is_priority,
      source_file = excluded.source_file, source_sheet = excluded.source_sheet, source_row = excluded.source_row
    returning id into v_id;
    v_skills := v_skills + 1;
    insert into public.reference_skill_contexts select v_id, c ->> 'subsector_ar', c ->> 'job_family_ar', c ->> 'source_sheet' from jsonb_array_elements(r -> 'contexts') c
      on conflict (skill_id, subsector_ar, job_family_ar) do nothing;
    v_contexts := v_contexts + jsonb_array_length(r -> 'contexts');
  end loop;
  return jsonb_build_object('skills', v_skills, 'contexts', v_contexts);
end $$;
revoke all on function private.import_reference_data(jsonb) from public, anon, authenticated;

-- External listings link to their source and never enter the internal recruitment workflow.
create table public.external_job_listings (
  id uuid primary key default gen_random_uuid(),
  employer_registry_id uuid references public.employer_registry (id),
  employer_name_ar text,
  employer_name_en text,
  title_ar text not null,
  title_en text not null,
  location text,
  sector text,
  employment_type text,
  source_name text not null,
  source_url text not null check (source_url ~ '^https://'),
  published boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.jobs
  add column sector text check (sector in ('digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail', 'other')),
  add column experience_level text check (experience_level in ('entry', 'junior', 'mid', 'senior', 'lead'));

create table public.job_reference_skills (
  job_id uuid not null,
  org_id uuid not null,
  reference_skill_id uuid not null references public.reference_skills (id),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (job_id, reference_skill_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
create index on public.job_reference_skills (org_id);
create index on public.job_reference_skills (reference_skill_id);

-- Profile
alter table public.candidate_profiles
  add column phone text,
  add column projects jsonb not null default '[]',
  add column courses jsonb not null default '[]',
  add column certifications jsonb not null default '[]',
  add column onboarding_step integer not null default 0,
  add column onboarding_completed_at timestamptz,
  add column time_zone text not null default 'Asia/Riyadh',
  add column notification_prefs jsonb not null default '{"deadline_reminders": true}';

create table public.candidate_reference_skills (
  candidate_id uuid not null references public.users (id) on delete cascade,
  reference_skill_id uuid not null references public.reference_skills (id),
  created_at timestamptz not null default now(),
  primary key (candidate_id, reference_skill_id)
);
create index on public.candidate_reference_skills (reference_skill_id);

-- CV analysis. Readable only by the candidate: personal fields and proposals are never shared with organizations.
create table public.cv_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index on public.cv_documents (candidate_id) where is_current;

create table public.cv_analyses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cv_documents (id) on delete cascade,
  candidate_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'awaiting_review', 'applied', 'dismissed', 'blocked', 'failed')),
  failure_code text,
  mode text check (mode in ('external_ai', 'local_only')),
  personal jsonb,
  professional jsonb,
  redaction_counts jsonb,
  finished_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.cv_analyses (candidate_id, created_at desc);
create index on public.cv_analyses (document_id);
create trigger set_updated_at before update on public.cv_analyses for each row execute function private.set_updated_at();

-- Applications keep what was submitted, so later profile edits don't change them.
alter table public.applications
  add column profile_snapshot jsonb,
  add column cv_snapshot_path text;

create or replace function private.guard_application() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  if tg_op = 'INSERT' then
    select org_id, status into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'published' then
      raise exception 'This job is not open for applications' using errcode = '23514';
    end if;
    new.org_id := j.org_id;
    new.status := 'submitted';
    if new.cv_snapshot_path is not null and new.cv_snapshot_path not like new.candidate_id::text || '/applications/%' then
      raise exception 'This file does not belong to the application' using errcode = '23514';
    end if;
    select to_jsonb(p) - 'user_id' - 'cv_path' - 'onboarding_step' - 'onboarding_completed_at' - 'notification_prefs' - 'time_zone' - 'created_at' - 'updated_at'
      || jsonb_build_object('email', (select u.email from public.users u where u.id = new.candidate_id), 'captured_at', now())
      into new.profile_snapshot from public.candidate_profiles p where p.user_id = new.candidate_id;
    return new;
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if new.status = 'withdrawn' and old.status <> 'withdrawn' and auth.uid() is distinct from old.candidate_id then
    raise exception 'Only the candidate can withdraw an application' using errcode = '42501';
  end if;
  new.profile_snapshot := old.profile_snapshot;
  new.cv_snapshot_path := old.cv_snapshot_path;
  return new;
end $$;

-- Assessment rules a company approves, and timing the server keeps.
alter table public.assessment_versions
  add column scenario_ar text,
  add column scenario_en text,
  add column deadline_hours integer check (deadline_hours > 0),
  add column is_timed boolean not null default false,
  add column rubric_shared boolean not null default false,
  add column candidate_rubric jsonb;

alter table public.assessment_attempts
  add column deadline_at timestamptz,
  add column expires_at timestamptz,
  add column receipt_code text unique,
  add column reopened_at timestamptz,
  add column reopened_by uuid references public.users (id);

create function private.build_candidate_rubric(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'title_ar', t.title_ar, 'title_en', t.title_en,
    'criteria', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'description_ar', c.description_ar, 'description_en', c.description_en, 'max_score', c.max_score) order by c.code), '[]'::jsonb)
                 from public.rubric_criteria c where c.task_id = t.id)
  ) order by t.position), '[]'::jsonb)
  from public.assessment_tasks t where t.version_id = p_version
$$;
revoke all on function private.build_candidate_rubric(uuid) from public, anon, authenticated;

create or replace function private.guard_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_by := null;
    new.published_at := null;
    new.requirements_snapshot := null;
    new.candidate_rubric := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'in_review') and exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'A published version cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if old.status in ('published', 'archived') then
    if new.status = 'archived' and old.status = 'published'
      and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;
    raise exception 'A published version is immutable' using errcode = '23514';
  end if;

  if new.status = 'archived' then
    raise exception 'Only a published version can be archived' using errcode = '23514';
  end if;

  new.requirements_snapshot := null;
  new.candidate_rubric := null;
  if new.status = 'published' then
    if not private.is_org_member(old.org_id, array['owner', 'admin']::public.org_role[]) then
      raise exception 'Publishing requires approval by an organization owner or admin' using errcode = '42501';
    end if;
    if not exists (select 1 from public.assessment_tasks t where t.version_id = old.id)
      or exists (
        select 1 from public.assessment_tasks t
        where t.version_id = old.id
          and not exists (select 1 from public.rubric_criteria c where c.task_id = t.id)
      ) then
      raise exception 'Every version needs tasks, and every task needs rubric criteria' using errcode = '23514';
    end if;
    new.published_by := auth.uid();
    new.published_at := now();
    new.requirements_snapshot := private.build_requirements_snapshot(old.id);
    if new.rubric_shared then
      new.candidate_rubric := private.build_candidate_rubric(old.id);
    end if;
  end if;
  return new;
end $$;

create or replace function private.guard_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record; v_hours integer;
begin
  select job_id, org_id, candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  select v.deadline_hours into v_hours from public.assessment_versions v
    join public.assessments s on s.id = v.assessment_id
    where v.id = new.version_id and v.status = 'published' and s.job_id = a.job_id;
  if not found then
    raise exception 'Candidates can only be invited to a published version for this job' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.assessment_attempts t
    join public.assessment_versions taken on taken.id = t.version_id
    join public.assessment_versions wanted on wanted.id = new.version_id
    where t.application_id = new.application_id and taken.assessment_id = wanted.assessment_id
  ) then
    raise exception 'A candidate takes each assessment once' using errcode = '23514';
  end if;
  new.org_id := a.org_id;
  new.candidate_id := a.candidate_id;
  new.status := 'invited';
  new.invited_by := nullif(auth.uid(), a.candidate_id);
  new.deadline_at := case when v_hours is not null then now() + make_interval(hours => v_hours) end;
  return new;
end $$;

-- Applying assigns the latest approved version of each published assessment, without a CV screening step.
create function private.assign_published_assessments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in
    select distinct on (s.id) x.id from public.assessments s
    join public.assessment_versions x on x.assessment_id = s.id and x.status = 'published'
    where s.job_id = new.job_id
    order by s.id, x.version_number desc
  loop
    insert into public.assessment_attempts (application_id, version_id, org_id, candidate_id) values (new.id, v.id, new.org_id, new.candidate_id);
  end loop;
  return null;
end $$;
create trigger assign_published_assessments after insert on public.applications
  for each row execute function private.assign_published_assessments();

-- A short grace period, because a network round trip shouldn't lose finished work.
create function private.is_overdue(t public.assessment_attempts) returns boolean
language sql stable set search_path = '' as $$
  select now() > least(t.deadline_at, t.expires_at) + interval '1 minute'
$$;

create or replace function private.guard_attempt_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  select * into t from public.assessment_attempts where id = new.attempt_id;
  if not found or t.status <> 'in_progress' then
    raise exception 'This attempt is not open for changes' using errcode = '23514';
  end if;
  if coalesce(private.is_overdue(t), false) then
    raise exception 'This attempt is not open for changes: the time has passed' using errcode = '23514';
  end if;
  if not exists (select 1 from public.assessment_tasks x where x.id = new.task_id and x.version_id = t.version_id) then
    raise exception 'This task is not part of the attempt' using errcode = '23514';
  end if;
  new.org_id := t.org_id;
  new.candidate_id := t.candidate_id;
  return new;
end $$;

create or replace function public.expire_my_overdue_attempts() returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts; v_count integer := 0;
begin
  for t in select * from public.assessment_attempts where candidate_id = auth.uid() and status in ('invited', 'in_progress') and coalesce(private.is_overdue(assessment_attempts), false) for update loop
    update public.assessment_attempts set status = 'expired' where id = t.id;
    perform private.sync_application_status(t.application_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.start_attempt(p_attempt uuid) returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts; v record;
begin
  select * into t from public.assessment_attempts where id = p_attempt and candidate_id = auth.uid() and status = 'invited' for update;
  if not found then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  if exists (select 1 from public.applications a where a.id = t.application_id and a.status = 'withdrawn') then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if coalesce(private.is_overdue(t), false) then
    update public.assessment_attempts set status = 'expired' where id = t.id returning * into t;
    perform private.sync_application_status(t.application_id);
    return t;
  end if;
  select duration_minutes, is_timed into v from public.assessment_versions where id = t.version_id;
  update public.assessment_attempts set status = 'in_progress', started_at = now(),
    expires_at = case when v.is_timed and v.duration_minutes is not null then now() + make_interval(mins => v.duration_minutes) end
  where id = t.id returning * into t;
  perform private.sync_application_status(t.application_id);
  return t;
end $$;

create or replace function public.submit_attempt(p_attempt uuid) returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  select * into t from public.assessment_attempts where id = p_attempt and candidate_id = auth.uid() for update;
  if not found or t.status not in ('in_progress', 'submitted') then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  -- A repeated click returns the same receipt.
  if t.status = 'submitted' then
    return t;
  end if;
  if exists (select 1 from public.applications a where a.id = t.application_id and a.status = 'withdrawn') then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if coalesce(private.is_overdue(t), false) then
    update public.assessment_attempts set status = 'expired' where id = t.id returning * into t;
  else
    update public.assessment_attempts set status = 'submitted', submitted_at = now(), receipt_code = 'MDN-' || upper(substr(md5(t.id::text || now()::text), 1, 10))
    where id = t.id returning * into t;
  end if;
  perform private.sync_application_status(t.application_id);
  return t;
end $$;

-- Resubmission is the organization's decision, and only before evaluation starts.
create function public.reopen_attempt(p_attempt uuid, p_hours integer) returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  select * into t from public.assessment_attempts where id = p_attempt for update;
  if not found or not private.is_org_member(t.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  if t.status not in ('submitted', 'expired') or exists (select 1 from public.evaluation_results r where r.attempt_id = t.id) then
    raise exception 'This attempt cannot be changed: it is not open for changes' using errcode = '23514';
  end if;
  update public.assessment_attempts set status = 'in_progress', started_at = coalesce(started_at, now()), submitted_at = null, receipt_code = null, expires_at = null,
    deadline_at = now() + make_interval(hours => greatest(p_hours, 1)), reopened_at = now(), reopened_by = auth.uid()
  where id = t.id returning * into t;
  perform private.sync_application_status(t.application_id);
  return t;
end $$;

-- What a candidate may see of a released result: the rubric's wording and final scores. Never answer keys or reviewer notes.
create function public.released_result_details(p_attempt uuid) returns table (
  task_title_ar text, task_title_en text, code text, description_ar text, description_en text, max_score numeric, score numeric, explanation text, reviewed boolean
) language sql stable security definer set search_path = '' as $$
  select t.title_ar, t.title_en, c.code, c.description_ar, c.description_en, c.max_score, s.score, s.explanation, s.source = 'human_reviewed'
  from public.assessment_attempts a
  join public.evaluation_results r on r.attempt_id = a.id and r.released_to_candidate
  join public.assessment_tasks t on t.version_id = a.version_id
  join public.rubric_criteria c on c.task_id = t.id
  left join lateral (
    select x.score, x.explanation, x.source from public.criterion_scores x where x.result_id = r.id and x.criterion_id = c.id
    order by (x.source = 'human_reviewed') desc, x.created_at desc limit 1
  ) s on true
  where a.id = p_attempt and a.candidate_id = auth.uid()
  order by t.position, c.code
$$;

-- Interviews happen between people. Nothing here records a call or adds an automated interviewer.
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  org_id uuid not null,
  candidate_id uuid not null references public.users (id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  time_zone text not null default 'Asia/Riyadh',
  instructions_ar text,
  instructions_en text,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'reschedule_requested', 'cancelled', 'completed', 'no_show')),
  reschedule_note text,
  daily_room_name text,
  daily_room_url text,
  calendar_status text not null default 'not_configured' check (calendar_status in ('not_configured', 'pending', 'sent', 'failed')),
  calendar_event_id text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade
);
create index on public.interviews (application_id, org_id);
create index on public.interviews (org_id);
create index on public.interviews (candidate_id, scheduled_at);
create index on public.interviews (created_by);

create table public.interview_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id),
  kind text not null,
  scheduled_at timestamptz,
  note text,
  actor uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index on public.interview_events (interview_id);
create index on public.interview_events (org_id);
create index on public.interview_events (candidate_id);
create index on public.interview_events (actor);

create function private.guard_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if tg_op = 'INSERT' then
    select candidate_id, org_id, status into a from public.applications where id = new.application_id;
    if not found or a.status = 'withdrawn' or a.org_id <> new.org_id then
      raise exception 'Application is not available' using errcode = '23514';
    end if;
    new.candidate_id := a.candidate_id;
    new.status := 'invited';
    new.created_by := auth.uid();
  else
    new.candidate_id := old.candidate_id;
    new.application_id := old.application_id;
    -- A new time needs the candidate's answer again.
    if new.scheduled_at is distinct from old.scheduled_at and new.status not in ('cancelled', 'completed', 'no_show') then
      new.status := 'invited';
      new.reschedule_note := null;
    end if;
  end if;
  return new;
end $$;
create trigger guard_interview before insert or update on public.interviews for each row execute function private.guard_interview();
create trigger set_updated_at before update on public.interviews for each row execute function private.set_updated_at();
create trigger write_audit after insert or update or delete on public.interviews for each row execute function private.write_audit();

create function private.log_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.scheduled_at is distinct from old.scheduled_at then
    insert into public.interview_events (interview_id, org_id, candidate_id, kind, scheduled_at, note, actor)
    values (new.id, new.org_id, new.candidate_id,
      case when tg_op = 'UPDATE' and new.scheduled_at is distinct from old.scheduled_at then 'rescheduled' else new.status end,
      new.scheduled_at, new.reschedule_note, auth.uid());
  end if;
  return null;
end $$;
create trigger log_interview after insert or update on public.interviews for each row execute function private.log_interview();

create function public.respond_to_interview(p_interview uuid, p_action text, p_note text default null) returns public.interviews
language plpgsql security definer set search_path = '' as $$
declare i public.interviews;
begin
  select * into i from public.interviews where id = p_interview and candidate_id = auth.uid() for update;
  if not found then
    raise exception 'Interview not available' using errcode = '42501';
  end if;
  if p_action = 'accept' and i.status = 'invited' then
    update public.interviews set status = 'accepted' where id = i.id returning * into i;
  elsif p_action = 'accept' and i.status = 'accepted' then
    return i;
  elsif p_action = 'request_reschedule' and i.status in ('invited', 'accepted') then
    -- The appointment stands until the organization sets a new one.
    update public.interviews set status = 'reschedule_requested', reschedule_note = left(p_note, 1000) where id = i.id returning * into i;
  else
    raise exception 'This interview is not open for changes' using errcode = '23514';
  end if;
  return i;
end $$;

-- A decision made by the organization.
create table public.hiring_outcomes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  org_id uuid not null,
  candidate_id uuid not null references public.users (id),
  outcome text not null check (outcome in ('hired', 'not_selected', 'on_hold', 'additional_interview')),
  message_ar text,
  message_en text,
  issued_by uuid references public.users (id),
  issued_at timestamptz not null default now(),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade
);
create index on public.hiring_outcomes (application_id, org_id);
create index on public.hiring_outcomes (org_id);
create index on public.hiring_outcomes (candidate_id);
create index on public.hiring_outcomes (issued_by);

create function private.guard_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;
create trigger guard_outcome before insert on public.hiring_outcomes for each row execute function private.guard_outcome();
create trigger write_audit after insert or update or delete on public.hiring_outcomes for each row execute function private.write_audit();

create function private.apply_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.outcome in ('hired', 'not_selected') then
    update public.applications set status = (case new.outcome when 'hired' then 'hired' else 'rejected' end)::public.application_status where id = new.application_id;
  end if;
  return null;
end $$;
create trigger apply_outcome after insert on public.hiring_outcomes for each row execute function private.apply_outcome();

-- Career development. Available whatever happens with any application.
create table public.career_targets (
  candidate_id uuid primary key references public.users (id) on delete cascade,
  sector_code text not null,
  job_family_ar text not null,
  updated_at timestamptz not null default now()
);

-- Empty until a verified catalog exists. Nothing is added here without a checked link.
create table public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('course', 'certification')),
  title_ar text,
  title_en text,
  provider text not null,
  url text not null check (url ~ '^https://'),
  verified_on date not null,
  reference_skill_id uuid references public.reference_skills (id),
  created_at timestamptz not null default now(),
  check (coalesce(title_ar, title_en) is not null)
);
create index on public.learning_resources (reference_skill_id);

create table public.career_plan_items (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.users (id) on delete cascade,
  reference_skill_id uuid not null references public.reference_skills (id),
  kind text not null check (kind in ('skill_goal', 'project', 'course', 'certification')),
  resource_id uuid references public.learning_resources (id),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (candidate_id, reference_skill_id, kind, resource_id)
);
create index on public.career_plan_items (reference_skill_id);
create index on public.career_plan_items (resource_id);
create trigger set_updated_at before update on public.career_plan_items for each row execute function private.set_updated_at();

-- Notifications, written by triggers so that one exists whichever route made the change.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}',
  link text not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on public.notifications (user_id, created_at desc);

create function private.notify(p_user uuid, p_kind text, p_job uuid, p_link text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, kind, params, link, dedupe_key)
  select p_user, p_kind, jsonb_build_object('job_ar', j.title_ar, 'job_en', j.title_en), p_link, p_key from public.jobs j where j.id = p_job
  on conflict (user_id, dedupe_key) do nothing;
end $$;

create function private.notify_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.candidate_id, 'application_received', new.job_id, '/applications/' || new.id, 'application:' || new.id);
  return null;
end $$;
create trigger notify_application after insert on public.applications for each row execute function private.notify_application();

create function private.notify_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  if tg_op = 'INSERT' then
    perform private.notify(new.candidate_id, 'assessment_assigned', v_job, '/applications/' || new.application_id, 'assigned:' || new.id);
  elsif new.status = 'submitted' and old.status <> 'submitted' then
    perform private.notify(new.candidate_id, 'submission_received', v_job, '/applications/' || new.application_id, 'submitted:' || new.id || ':' || new.receipt_code);
  end if;
  return null;
end $$;
create trigger notify_attempt after insert or update of status on public.assessment_attempts for each row execute function private.notify_attempt();

create function private.notify_result() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if new.released_to_candidate and not coalesce(old.released_to_candidate, false) then
    select t.candidate_id, x.job_id into a from public.assessment_attempts t join public.applications x on x.id = t.application_id where t.id = new.attempt_id;
    perform private.notify(a.candidate_id, 'results_released', a.job_id, '/reports/' || new.attempt_id, 'released:' || new.id);
  end if;
  return null;
end $$;
create trigger notify_result after update on public.evaluation_results for each row execute function private.notify_result();

create function private.notify_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  if tg_op = 'INSERT' then
    perform private.notify(new.candidate_id, 'interview_invited', v_job, '/interviews/' || new.id, 'interview:' || new.id);
  elsif (new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status) and auth.uid() is distinct from new.candidate_id then
    perform private.notify(new.candidate_id, 'interview_changed', v_job, '/interviews/' || new.id, 'interview:' || new.id || ':' || extract(epoch from new.updated_at));
  end if;
  return null;
end $$;
create trigger notify_interview after insert or update on public.interviews for each row execute function private.notify_interview();

create function private.notify_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  perform private.notify(new.candidate_id, 'hiring_decision', v_job, '/applications/' || new.application_id, 'outcome:' || new.id);
  return null;
end $$;
create trigger notify_outcome after insert on public.hiring_outcomes for each row execute function private.notify_outcome();

-- Deadline reminders are created when the candidate next loads their data, once per attempt.
create function public.create_my_deadline_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if not coalesce((select (p.notification_prefs ->> 'deadline_reminders')::boolean from public.candidate_profiles p where p.user_id = auth.uid()), true) then
    return;
  end if;
  for t in
    select a.id, a.application_id, x.job_id from public.assessment_attempts a join public.applications x on x.id = a.application_id
    where a.candidate_id = auth.uid() and a.status in ('invited', 'in_progress') and a.deadline_at between now() and now() + interval '24 hours' and x.status <> 'withdrawn'
  loop
    perform private.notify(auth.uid(), 'deadline_soon', t.job_id, '/applications/' || t.application_id, 'deadline:' || t.id);
  end loop;
end $$;

revoke all on function private.sync_application_status(uuid), private.is_overdue(public.assessment_attempts), private.notify(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.expire_my_overdue_attempts(), public.reopen_attempt(uuid, integer), public.released_result_details(uuid), public.respond_to_interview(uuid, text, text), public.create_my_deadline_reminders() from public, anon;
grant execute on function public.expire_my_overdue_attempts(), public.reopen_attempt(uuid, integer), public.released_result_details(uuid), public.respond_to_interview(uuid, text, text), public.create_my_deadline_reminders() to authenticated;

-- Row security
alter table public.employer_registry enable row level security;
alter table public.employer_aliases enable row level security;
alter table public.employer_sources enable row level security;
alter table public.reference_skills enable row level security;
alter table public.reference_skill_contexts enable row level security;
alter table public.external_job_listings enable row level security;
alter table public.job_reference_skills enable row level security;
alter table public.candidate_reference_skills enable row level security;
alter table public.cv_documents enable row level security;
alter table public.cv_analyses enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_events enable row level security;
alter table public.hiring_outcomes enable row level security;
alter table public.career_targets enable row level security;
alter table public.learning_resources enable row level security;
alter table public.career_plan_items enable row level security;
alter table public.notifications enable row level security;

create policy "anyone reads" on public.employer_registry for select to anon, authenticated using (true);
create policy "anyone reads" on public.employer_aliases for select to anon, authenticated using (true);
create policy "anyone reads" on public.employer_sources for select to anon, authenticated using (true);
create policy "anyone reads" on public.reference_skills for select to anon, authenticated using (true);
create policy "anyone reads" on public.reference_skill_contexts for select to anon, authenticated using (true);
create policy "anyone reads" on public.learning_resources for select to anon, authenticated using (true);
create policy "anyone reads published" on public.external_job_listings for select to anon, authenticated using (published);

create policy "org members read" on public.job_reference_skills for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.job_reference_skills for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "public reads published" on public.job_reference_skills for select to anon, authenticated using (
  exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
);

create policy "own" on public.candidate_reference_skills for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
create policy "own" on public.cv_documents for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
create policy "own" on public.cv_analyses for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
create policy "own" on public.career_targets for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
create policy "own" on public.career_plan_items for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());

create policy "org members read" on public.interviews for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.interviews for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "candidate reads own" on public.interviews for select to authenticated using (candidate_id = auth.uid());

create policy "org members read" on public.interview_events for select to authenticated using (private.is_org_member(org_id));
create policy "candidate reads own" on public.interview_events for select to authenticated using (candidate_id = auth.uid());

create policy "org members read" on public.hiring_outcomes for select to authenticated using (private.is_org_member(org_id));
create policy "org builders issue" on public.hiring_outcomes for insert to authenticated
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "candidate reads own" on public.hiring_outcomes for select to authenticated using (candidate_id = auth.uid());

create policy "own reads" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own marks read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.employer_registry, public.employer_aliases, public.employer_sources, public.reference_skills, public.reference_skill_contexts,
  public.learning_resources, public.external_job_listings, public.job_reference_skills to anon, authenticated;
grant insert, update, delete on public.job_reference_skills, public.interviews to authenticated;
grant select on public.interviews, public.interview_events, public.hiring_outcomes, public.notifications to authenticated;
grant insert on public.hiring_outcomes to authenticated;
grant select, insert, update, delete on public.candidate_reference_skills, public.cv_documents, public.cv_analyses, public.career_targets, public.career_plan_items to authenticated;
grant update (read_at) on public.notifications to authenticated;
