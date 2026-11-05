-- Organization -> Jobs -> Job Requirements & Skills -> Assessments -> Tasks -> Rubrics.
-- Additive: existing tables, data and code keep working.

create type public.requirement_type as enum (
  'qualification', 'education', 'experience', 'responsibility', 'daily_task', 'competency', 'certification', 'language', 'other'
);
create type public.requirement_origin as enum ('employer_stated', 'ai_explicit', 'ai_inferred');

create table public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  requirement_type public.requirement_type not null,
  description_ar text,
  description_en text,
  is_mandatory boolean not null default true,
  position integer not null default 1 check (position > 0),
  min_years numeric(4, 1) check (min_years >= 0),
  skill_id uuid references public.skills (id),
  source_reference text,
  origin public.requirement_origin not null default 'employer_stated',
  review_status public.content_review_status not null default 'approved',
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  check (coalesce(trim(description_ar), '') <> '' or coalesce(trim(description_en), '') <> ''),
  check (min_years is null or requirement_type = 'experience')
);
create index on public.job_requirements (job_id, org_id);
create index on public.job_requirements (org_id);
create index on public.job_requirements (skill_id);

create table public.task_requirement_mappings (
  task_id uuid not null,
  requirement_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  weight numeric(6, 3) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  primary key (task_id, requirement_id),
  foreign key (task_id, org_id) references public.assessment_tasks (id, org_id) on delete cascade,
  foreign key (requirement_id, org_id) references public.job_requirements (id, org_id)
);
create index on public.task_requirement_mappings (requirement_id, org_id);
create index on public.task_requirement_mappings (task_id, org_id);
create index on public.task_requirement_mappings (org_id);

alter table public.rubric_criteria add column requirement_id uuid;
alter table public.rubric_criteria add constraint rubric_criteria_requirement_id_org_id_fkey
  foreign key (requirement_id, org_id) references public.job_requirements (id, org_id);
create index on public.rubric_criteria (requirement_id, org_id);

-- job_skills stays the only source of structured skills.
alter table public.job_skills
  add column is_required boolean not null default true,
  add column origin public.requirement_origin not null default 'employer_stated',
  add column review_status public.content_review_status not null default 'approved';

alter table public.jobs
  add column employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'internship', 'flexible')),
  add column salary_min numeric(12, 2) check (salary_min >= 0),
  add column salary_max numeric(12, 2) check (salary_max >= 0),
  add column application_deadline date,
  add constraint jobs_salary_range_check check (salary_min is null or salary_max is null or salary_max >= salary_min);

alter table public.assessment_versions add column requirements_snapshot jsonb;

create trigger set_updated_at before update on public.job_requirements
  for each row execute function private.set_updated_at();
create trigger write_audit after insert or update or delete on public.job_requirements
  for each row execute function private.write_audit();
create trigger guard_content before insert or update or delete on public.task_requirement_mappings
  for each row execute function private.guard_version_content();

-- AI output is never treated as approved or as stated by the employer until a person reviews it.
create function private.guard_requirement_review() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.origin <> 'employer_stated' then
    new.review_status := 'draft';
  end if;
  return new;
end $$;

create trigger guard_requirement_review before insert on public.job_requirements
  for each row execute function private.guard_requirement_review();

-- Keys prove the same organization. This proves the same job, and a requirement still in use.
create function private.guard_requirement_link() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.requirement_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.job_requirements r
    join public.assessment_tasks t on t.id = new.task_id
    join public.assessment_versions v on v.id = t.version_id
    join public.assessments a on a.id = v.assessment_id
    where r.id = new.requirement_id and r.job_id = a.job_id and r.retired_at is null
  ) then
    raise exception 'A task can only measure an active requirement of its own job' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger guard_requirement_link before insert or update on public.task_requirement_mappings
  for each row execute function private.guard_requirement_link();
create trigger guard_requirement_link before insert or update of requirement_id on public.rubric_criteria
  for each row execute function private.guard_requirement_link();

create function private.build_requirements_snapshot(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'captured_at', now(),
    'job', jsonb_build_object(
      'id', j.id, 'title_ar', j.title_ar, 'title_en', j.title_en,
      'description_ar', j.description_ar, 'description_en', j.description_en,
      'requirements_ar', j.requirements_ar, 'requirements_en', j.requirements_en
    ),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requirement_type', r.requirement_type, 'description_ar', r.description_ar, 'description_en', r.description_en,
        'is_mandatory', r.is_mandatory, 'min_years', r.min_years, 'skill_id', r.skill_id, 'origin', r.origin, 'review_status', r.review_status,
        'task_ids', coalesce((
          select jsonb_agg(m.task_id) from public.task_requirement_mappings m
          join public.assessment_tasks t on t.id = m.task_id
          where m.requirement_id = r.id and t.version_id = p_version
        ), '[]'::jsonb)
      ) order by r.requirement_type, r.position)
      from public.job_requirements r where r.job_id = j.id and r.retired_at is null
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_id', s.skill_id, 'name_ar', k.name_ar, 'name_en', k.name_en, 'required_level', s.required_level, 'is_required', s.is_required
      ))
      from public.job_skills s join public.skills k on k.id = s.skill_id where s.job_id = j.id
    ), '[]'::jsonb)
  )
  from public.assessment_versions v
  join public.assessments a on a.id = v.assessment_id
  join public.jobs j on j.id = a.job_id
  where v.id = p_version
$$;

-- Same rules as before, plus: the snapshot is taken at publish and can't be supplied or changed by anyone.
create or replace function private.guard_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_by := null;
    new.published_at := null;
    new.requirements_snapshot := null;
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
  end if;
  return new;
end $$;

revoke all on function private.guard_requirement_review(), private.guard_requirement_link(), private.build_requirements_snapshot(uuid) from public, anon, authenticated;

-- Row security. Candidates and the public see only approved, active requirements of jobs they may see.
alter table public.job_requirements enable row level security;
alter table public.task_requirement_mappings enable row level security;

create policy "org members read" on public.job_requirements for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.job_requirements for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "public reads approved" on public.job_requirements for select to anon, authenticated using (
  review_status = 'approved' and retired_at is null
  and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
);
create policy "candidate reads applied" on public.job_requirements for select to authenticated using (
  review_status = 'approved' and retired_at is null and private.candidate_applied_job(job_id)
);

create policy "org members read" on public.task_requirement_mappings for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.task_requirement_mappings for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));

-- Skills an AI suggested stay out of public view until a person reviews them.
drop policy "public reads published" on public.job_skills;
create policy "public reads published" on public.job_skills for select to anon, authenticated using (
  review_status = 'approved' and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
);

grant select on public.job_requirements to anon;
grant select, insert, update, delete on public.job_requirements, public.task_requirement_mappings to authenticated;
