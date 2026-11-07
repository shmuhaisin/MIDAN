-- The MIDAN Assessment Standard (docs/assessment/MIDAN_ASSESSMENT_STANDARD.md), in the database:
--   1. the company's type, which generation receives with the job's sector and level;
--   2. the candidate's package (structured brief and materials) on the version, which candidates read;
--   3. the assessor guide, in its own table that only organization staff can read — never a candidate;
--   4. quality reports, written only by MIDAN's service role, and a gate: a version under the standard is approved only with a
--      report that says "ready" and was computed on the version's current content.
-- Builds on the assessment editing policy (20261107150000): guide and package edits are audited and reviewed like any other
-- change, published versions stay immutable, and a revision carries the guide forward.
-- Rollback: supabase/rollback/20261107160000_assessment_intelligence.down.sql

-- -------------------------------------------------------------------------------------------------------------------------
-- 1. Company type

alter table public.organizations
  add column company_type text check (company_type in (
    'private_company', 'startup', 'sme', 'large_enterprise', 'government_entity', 'semi_government', 'nonprofit', 'multinational'));
-- Owners and admins already update the organization's descriptive fields ("admins update" policy); this is one more.
grant update (company_type) on public.organizations to authenticated;

-- -------------------------------------------------------------------------------------------------------------------------
-- 2. What the candidate reads, structured: the brief and the materials. Candidate-facing by design.

alter table public.assessment_versions
  add column candidate_package jsonb check (candidate_package is null or jsonb_typeof(candidate_package) = 'object');

-- -------------------------------------------------------------------------------------------------------------------------
-- 3. The assessor guide. Organization staff only.

create table public.assessment_assessor_guides (
  version_id uuid primary key references public.assessment_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  standard_version text not null check (standard_version ~ '^MAS-[0-9]+\.[0-9]+$'),
  content jsonb not null check (jsonb_typeof(content -> 'assessor_guide') = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.assessment_assessor_guides (org_id);
alter table public.assessment_assessor_guides enable row level security;
-- The same people who read the rubric: members of the organization. Candidates are never members of the hiring organization.
create policy "org members read" on public.assessment_assessor_guides for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.assessment_assessor_guides for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
-- No delete: once a version is under the standard it keeps its guide (it goes only with its version).
grant select, insert, update on public.assessment_assessor_guides to authenticated;

create function private.guard_assessor_guide() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.assessment_versions;
begin
  select * into v from public.assessment_versions where id = coalesce(new.version_id, old.version_id);
  if tg_op = 'DELETE' then
    -- Only with its version (a cascade, when the version is already gone or being removed).
    if found and v.status in ('published', 'archived') then
      raise exception 'A published version is immutable' using errcode = '23514';
    end if;
    return old;
  end if;
  if not found then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v.status in ('published', 'archived') then
    raise exception 'A published version is immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'A guide belongs to its version' using errcode = '23514';
  end if;
  new.org_id := v.org_id;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_assessor_guide before insert or update or delete on public.assessment_assessor_guides
  for each row execute function private.guard_assessor_guide();

-- -------------------------------------------------------------------------------------------------------------------------
-- 4. The audit trail and the review cover the guide and the candidate's package.
-- Same function as in 20261107150000, apart from the two marked additions.

create or replace function private.write_assessment_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  v_source text := coalesce(nullif(current_setting('midan.assessment_change', true), ''), 'edit');
  v_reason text := nullif(left(current_setting('midan.change_reason', true), 1000), '');
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'created_at' - 'updated_at' end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'created_at' - 'updated_at' end;
  v_kind text := 'content';
  v_version uuid;
  v_task uuid;
  v_assessment uuid;
  v_number integer;
  v_entity_id text := r ->> 'id';
begin
  if v_source not in ('generation', 'revision') then
    v_source := 'edit';
  end if;

  if tg_table_name = 'assessment_versions' then
    v_version := (r ->> 'id')::uuid;
    -- (a) candidate_package added: it is what candidates read, so it is content.
    v_old := jsonb_build_object('instructions_ar', old.instructions_ar, 'instructions_en', old.instructions_en, 'scenario_ar', old.scenario_ar,
      'scenario_en', old.scenario_en, 'duration_minutes', old.duration_minutes, 'deadline_hours', old.deadline_hours, 'is_timed', old.is_timed,
      'rubric_shared', old.rubric_shared, 'candidate_package', old.candidate_package);
    v_new := jsonb_build_object('instructions_ar', new.instructions_ar, 'instructions_en', new.instructions_en, 'scenario_ar', new.scenario_ar,
      'scenario_en', new.scenario_en, 'duration_minutes', new.duration_minutes, 'deadline_hours', new.deadline_hours, 'is_timed', new.is_timed,
      'rubric_shared', new.rubric_shared, 'candidate_package', new.candidate_package);
    v_kind := case
      when (v_old - 'duration_minutes' - 'deadline_hours' - 'is_timed' - 'rubric_shared') = (v_new - 'duration_minutes' - 'deadline_hours' - 'is_timed' - 'rubric_shared')
      then 'settings' else 'content' end;
  elsif tg_table_name = 'assessment_assessor_guides' then
    -- (b) The assessor guide: content, reviewed before approval like the rubric.
    v_version := (r ->> 'version_id')::uuid;
    v_entity_id := r ->> 'version_id';
    if not exists (select 1 from public.assessment_versions x where x.id = v_version) then
      return null;
    end if;
  elsif tg_table_name = 'assessment_tasks' then
    v_task := (r ->> 'id')::uuid;
    v_version := (r ->> 'version_id')::uuid;
    if tg_op = 'DELETE' then
      v_old := v_old || jsonb_build_object(
        'rubric_criteria', coalesce((select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.code) from public.rubric_criteria c where c.task_id = v_task), '[]'),
        'requirement_ids', coalesce((select jsonb_agg(m.requirement_id order by m.requirement_id) from public.task_requirement_mappings m where m.task_id = v_task), '[]'));
    end if;
  else
    v_task := (r ->> 'task_id')::uuid;
    select t.version_id into v_version from public.assessment_tasks t where t.id = v_task;
    if tg_table_name = 'task_requirement_mappings' then
      v_entity_id := (r ->> 'task_id') || ':' || (r ->> 'requirement_id');
    end if;
    if v_version is null then
      return null;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;
  select v.assessment_id, v.version_number into v_assessment, v_number from public.assessment_versions v where v.id = v_version;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values ((r ->> 'org_id')::uuid, auth.uid(), case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    tg_table_name, v_entity_id,
    jsonb_strip_nulls(jsonb_build_object(
      'source', v_source, 'kind', v_kind, 'assessment_id', v_assessment, 'version_id', v_version, 'version_number', v_number,
      'task_id', v_task, 'criterion_id', case when tg_table_name = 'rubric_criteria' then r ->> 'id' end,
      'requirement_id', case when tg_table_name = 'task_requirement_mappings' then r ->> 'requirement_id' end,
      'reason', v_reason))
    || jsonb_build_object('old', v_old, 'new', v_new));
  return case when tg_op = 'DELETE' then old else null end;
end $$;

create trigger write_assessment_audit after insert or update or delete on public.assessment_assessor_guides
  for each row execute function private.write_assessment_audit();

create or replace function private.is_reviewable_change(a public.audit_logs) returns boolean
language sql immutable set search_path = '' as $$
  select a.entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions', 'assessment_assessor_guides')
    and a.details ->> 'source' = 'edit' and coalesce(a.details ->> 'kind', 'content') = 'content'
$$;

drop index public.audit_logs_assessment_version;
create index audit_logs_assessment_version on public.audit_logs ((details ->> 'version_id'), id)
  where entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions', 'assessment_assessor_guides');

-- What a version holds, now with the candidate's package, each task's skills and the assessor guide. Snapshots (generated,
-- revision base, approved) keep all of it; they are readable by organization members only, as before.
-- Same function as in 20261107150000, apart from the three marked additions.
create or replace function private.assessment_version_content(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('instructions_ar', v.instructions_ar, 'instructions_en', v.instructions_en, 'scenario_ar', v.scenario_ar,
        'scenario_en', v.scenario_en, 'duration_minutes', v.duration_minutes, 'deadline_hours', v.deadline_hours, 'is_timed', v.is_timed,
        'rubric_shared', v.rubric_shared,
        'candidate_package', v.candidate_package)                                                             -- (a)
      from public.assessment_versions v where v.id = p_version),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'position', t.position, 'task_type', t.task_type, 'title_ar', t.title_ar, 'title_en', t.title_en,
        'instructions_ar', t.instructions_ar, 'instructions_en', t.instructions_en, 'weight', t.weight, 'config', t.config,
        'reference_skill_ids', to_jsonb(t.reference_skill_ids),
        'requirement_ids', coalesce((select jsonb_agg(m.requirement_id order by m.requirement_id) from public.task_requirement_mappings m where m.task_id = t.id), '[]'),
        'skill_ids', coalesce((select jsonb_agg(s.skill_id order by s.skill_id) from public.task_skill_mappings s where s.task_id = t.id), '[]'),  -- (b)
        'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'description_ar', c.description_ar,
            'description_en', c.description_en, 'max_score', c.max_score, 'weight', c.weight, 'answer_key', c.answer_key,
            'requirement_id', c.requirement_id, 'reference_skill_id', c.reference_skill_id) order by c.code)
          from public.rubric_criteria c where c.task_id = t.id), '[]')
      ) order by t.position) from public.assessment_tasks t where t.version_id = p_version), '[]'),
    'guide', (select jsonb_build_object('standard_version', g.standard_version, 'content', g.content)        -- (c)
      from public.assessment_assessor_guides g where g.version_id = p_version))
$$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 5. A revision of a version under the standard starts with its guide and package. Done when the revision's base snapshot is
-- written (create_assessment_revision, unchanged), so the snapshot holds them too, and recorded as part of the revision.

create function private.carry_standard_into_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_previous text := current_setting('midan.assessment_change', true);
begin
  if new.kind <> 'revision_base' or new.based_on_version_id is null then
    return new;
  end if;
  perform set_config('midan.assessment_change', 'revision', true);
  update public.assessment_versions v set candidate_package = s.candidate_package
  from public.assessment_versions s where s.id = new.based_on_version_id and v.id = new.version_id and s.candidate_package is not null;
  insert into public.assessment_assessor_guides (version_id, org_id, standard_version, content)
  select new.version_id, new.org_id, g.standard_version, g.content from public.assessment_assessor_guides g where g.version_id = new.based_on_version_id;
  perform set_config('midan.assessment_change', coalesce(v_previous, ''), true);
  new.content := private.assessment_version_content(new.version_id);
  return new;
end $$;

create trigger carry_standard_into_revision before insert on public.assessment_version_snapshots
  for each row execute function private.carry_standard_into_revision();

-- -------------------------------------------------------------------------------------------------------------------------
-- 6. Quality reports and the gate.

-- A fingerprint of everything the standard judges. Any change to the version's content changes it.
create function private.assessment_content_digest(p_version uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(private.assessment_version_content(p_version)::text)
$$;

-- For the Core API, which reads a version and its digest in one transaction before asking MIDAN to check it.
create function public.assessment_content_digest(p_version uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assessment_versions v where v.id = p_version and private.is_org_member(v.org_id)) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  return private.assessment_content_digest(p_version);
end $$;

create table public.assessment_quality_reports (
  id bigint generated always as identity primary key,  -- the order reports were written in, even within one transaction
  version_id uuid not null references public.assessment_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  standard_version text not null,
  evaluator_version text not null,
  verdict text not null check (verdict in ('ready', 'needs_revision', 'blocked')),
  overall_score integer not null check (overall_score between 0 and 100),
  standardized boolean not null,
  content_digest text not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.assessment_quality_reports (version_id, id desc);
create index on public.assessment_quality_reports (org_id);
alter table public.assessment_quality_reports enable row level security;
create policy "org members read" on public.assessment_quality_reports for select to authenticated using (private.is_org_member(org_id));
-- Written only by private.record_quality_report, which only MIDAN's service role may run. An organization can't write its own.
grant select on public.assessment_quality_reports to authenticated;

create function private.record_quality_report(p_version uuid, p_digest text, p_report jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v public.assessment_versions; v_id bigint;
begin
  select * into v from public.assessment_versions where id = p_version for update;
  if not found then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v.status not in ('draft', 'in_review') then
    raise exception 'Only a draft is checked; an approved version cannot be changed' using errcode = '23514';
  end if;
  if p_digest is distinct from private.assessment_content_digest(p_version) then
    raise exception 'The version changed while it was being checked. Check it again' using errcode = '23514';
  end if;
  if p_report ->> 'verdict' not in ('ready', 'needs_revision', 'blocked') or jsonb_typeof(p_report -> 'dimensions') <> 'object' then
    raise exception 'Not a quality report' using errcode = '22023';
  end if;
  insert into public.assessment_quality_reports (version_id, org_id, standard_version, evaluator_version, verdict, overall_score, standardized,
    content_digest, report)
  values (p_version, v.org_id, p_report ->> 'standard_version', p_report ->> 'evaluator_version', p_report ->> 'verdict',
    (p_report ->> 'overall_score')::integer, (p_report ->> 'standardized')::boolean, p_digest, p_report)
  returning id into v_id;
  return v_id;
end $$;

-- An assessment that has ever had a version under the standard stays under it.
create function private.is_under_standard(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessment_versions v
    join public.assessment_versions x on x.assessment_id = v.assessment_id
    join public.assessment_assessor_guides g on g.version_id = x.id
    where v.id = p_version)
$$;

create function private.guard_quality_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.assessment_quality_reports;
begin
  if not private.is_under_standard(old.id) then
    return new;  -- Not standardized: today's checks only (guard_version).
  end if;
  if not exists (select 1 from public.assessment_assessor_guides g where g.version_id = old.id) then
    raise exception 'This version needs its assessor guide under the MIDAN Assessment Standard' using errcode = '23514';
  end if;
  select * into r from public.assessment_quality_reports q where q.version_id = old.id order by q.id desc limit 1;
  if not found or r.content_digest is distinct from private.assessment_content_digest(old.id) then
    raise exception 'Check this version against the MIDAN Assessment Standard before approving it' using errcode = '23514';
  end if;
  if r.verdict <> 'ready' then
    raise exception 'This version does not meet the MIDAN Assessment Standard yet' using errcode = '23514';
  end if;
  return new;
end $$;

-- Runs after guard_version (triggers fire in name order), which has already checked the role, validation and review.
create trigger quality_gate before update on public.assessment_versions
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function private.guard_quality_gate();

-- -------------------------------------------------------------------------------------------------------------------------

revoke all on function private.guard_assessor_guide(), private.carry_standard_into_revision(), private.assessment_content_digest(uuid),
  private.record_quality_report(uuid, text, jsonb), private.is_under_standard(uuid), private.guard_quality_gate()
  from public, anon, authenticated;
revoke all on function public.assessment_content_digest(uuid) from public, anon;
grant execute on function public.assessment_content_digest(uuid) to authenticated;
grant execute on function private.record_quality_report(uuid, text, jsonb) to midan_worker;
