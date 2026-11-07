-- The assessment editing policy (owner decision, 2026-11-07). Employers may add, edit and delete a draft's tasks, questions,
-- instructions, rubric criteria, options and answer keys. Every change is recorded with its state before and after, an owner or
-- admin reviews the changes before approving, and MIDAN's validation says what the edited draft no longer measures. MIDAN keeps
-- the draft it generated, the approved version and the whole history. A version candidates take is never changed: a new
-- version starts from it instead.
--
-- Built on the existing audit trail: rows go to public.audit_logs, which employers can read (owners and admins) but never write,
-- change or delete. private.write_audit() stays as it is for other tables: it deliberately records no content, and widening it
-- would copy candidate data into the log. Content is recorded only for assessment drafts, by private.write_assessment_audit().
--
-- Who made a change is the signed-in caller. Where it came from is set per transaction by the Core API:
--   midan.assessment_change = 'generation' (MIDAN's engine writing a new draft) or 'revision' (a copy of an approved version);
--   anything else, including direct Data API writes, counts as a person's edit.
--   midan.change_reason = the reason the person gave, if any.

-- -------------------------------------------------------------------------------------------------------------------------
-- 1. Content audit for drafts.

create function private.write_assessment_audit() returns trigger
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
    -- What people edit on a draft. Status changes have their own audit row, from private.write_audit().
    v_old := jsonb_build_object('instructions_ar', old.instructions_ar, 'instructions_en', old.instructions_en, 'scenario_ar', old.scenario_ar,
      'scenario_en', old.scenario_en, 'duration_minutes', old.duration_minutes, 'deadline_hours', old.deadline_hours, 'is_timed', old.is_timed,
      'rubric_shared', old.rubric_shared);
    v_new := jsonb_build_object('instructions_ar', new.instructions_ar, 'instructions_en', new.instructions_en, 'scenario_ar', new.scenario_ar,
      'scenario_en', new.scenario_en, 'duration_minutes', new.duration_minutes, 'deadline_hours', new.deadline_hours, 'is_timed', new.is_timed,
      'rubric_shared', new.rubric_shared);
    -- Only what candidates read is content to review; the deadline, timer and rubric sharing are settings, recorded all the same.
    v_kind := case
      when (v_old - 'duration_minutes' - 'deadline_hours' - 'is_timed' - 'rubric_shared') = (v_new - 'duration_minutes' - 'deadline_hours' - 'is_timed' - 'rubric_shared')
      then 'settings' else 'content' end;
  elsif tg_table_name = 'assessment_tasks' then
    v_task := (r ->> 'id')::uuid;
    v_version := (r ->> 'version_id')::uuid;
    if tg_op = 'DELETE' then
      -- The task's rubric and links go with it, by cascade. Kept here so the deletion keeps the whole previous state.
      v_old := v_old || jsonb_build_object(
        'rubric_criteria', coalesce((select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.code) from public.rubric_criteria c where c.task_id = v_task), '[]'),
        'requirement_ids', coalesce((select jsonb_agg(m.requirement_id order by m.requirement_id) from public.task_requirement_mappings m where m.task_id = v_task), '[]'));
    end if;
  else
    -- rubric_criteria and task_requirement_mappings name their task.
    v_task := (r ->> 'task_id')::uuid;
    select t.version_id into v_version from public.assessment_tasks t where t.id = v_task;
    if tg_table_name = 'task_requirement_mappings' then
      v_entity_id := (r ->> 'task_id') || ':' || (r ->> 'requirement_id');
    end if;
    -- Gone with its task: the task's deletion already holds this row.
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

-- Replaces the update-and-delete triggers of 20261107120000, which recorded no content and missed additions.
drop trigger write_audit on public.assessment_tasks;
drop trigger write_audit on public.rubric_criteria;

create trigger write_assessment_audit after insert or update on public.assessment_tasks
  for each row execute function private.write_assessment_audit();
-- Before, so the task's rubric and links are still there to record. An error later in the statement rolls the row back too.
create trigger write_assessment_audit_delete before delete on public.assessment_tasks
  for each row execute function private.write_assessment_audit();
create trigger write_assessment_audit after insert or update or delete on public.rubric_criteria
  for each row execute function private.write_assessment_audit();
create trigger write_assessment_audit after insert or update or delete on public.task_requirement_mappings
  for each row execute function private.write_assessment_audit();
create trigger write_assessment_audit after update on public.assessment_versions
  for each row execute function private.write_assessment_audit();

create index audit_logs_assessment_version on public.audit_logs ((details ->> 'version_id'), id)
  where entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions');

-- A person's change that the review before approval has to cover.
create function private.is_reviewable_change(a public.audit_logs) returns boolean
language sql immutable set search_path = '' as $$
  select a.entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions')
    and a.details ->> 'source' = 'edit' and coalesce(a.details ->> 'kind', 'content') = 'content'
$$;

create function private.latest_reviewable_change(p_version uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select max(a.id) from public.audit_logs a where a.details ->> 'version_id' = p_version::text and private.is_reviewable_change(a)
$$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 2. What a version holds, and the copies MIDAN keeps: the generated draft, the version a revision started from, the approved one.

create function private.assessment_version_content(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('instructions_ar', v.instructions_ar, 'instructions_en', v.instructions_en, 'scenario_ar', v.scenario_ar,
        'scenario_en', v.scenario_en, 'duration_minutes', v.duration_minutes, 'deadline_hours', v.deadline_hours, 'is_timed', v.is_timed,
        'rubric_shared', v.rubric_shared)
      from public.assessment_versions v where v.id = p_version),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'position', t.position, 'task_type', t.task_type, 'title_ar', t.title_ar, 'title_en', t.title_en,
        'instructions_ar', t.instructions_ar, 'instructions_en', t.instructions_en, 'weight', t.weight, 'config', t.config,
        'reference_skill_ids', to_jsonb(t.reference_skill_ids),
        'requirement_ids', coalesce((select jsonb_agg(m.requirement_id order by m.requirement_id) from public.task_requirement_mappings m where m.task_id = t.id), '[]'),
        'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'description_ar', c.description_ar,
            'description_en', c.description_en, 'max_score', c.max_score, 'weight', c.weight, 'answer_key', c.answer_key,
            'requirement_id', c.requirement_id, 'reference_skill_id', c.reference_skill_id) order by c.code)
          from public.rubric_criteria c where c.task_id = t.id), '[]')
      ) order by t.position) from public.assessment_tasks t where t.version_id = p_version), '[]'))
$$;

create table public.assessment_version_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.assessment_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('generated', 'revision_base', 'approved')),
  based_on_version_id uuid references public.assessment_versions (id),
  content jsonb not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (version_id, kind)
);
create index on public.assessment_version_snapshots (org_id);
alter table public.assessment_version_snapshots enable row level security;
create policy "org members read" on public.assessment_version_snapshots for select to authenticated using (private.is_org_member(org_id));
-- Written only by the functions below. Nobody can change or delete one.
grant select on public.assessment_version_snapshots to authenticated;

-- Called by the Core API in the transaction that writes a generated draft. It is the generated draft only if nobody has changed
-- the version yet, so a person can't record their own work as MIDAN's.
create function public.record_generated_draft(p_version uuid) returns public.assessment_version_snapshots
language plpgsql security definer set search_path = '' as $$
declare v public.assessment_versions; s public.assessment_version_snapshots;
begin
  select * into v from public.assessment_versions where id = p_version for update;
  if not found or not private.is_org_member(v.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' or exists (select 1 from public.assessment_version_snapshots x where x.version_id = p_version) then
    raise exception 'Only a new draft can be recorded as generated' using errcode = '23514';
  end if;
  if exists (select 1 from public.audit_logs a where a.details ->> 'version_id' = p_version::text and a.details ->> 'source' <> 'generation') then
    raise exception 'This draft was already changed, so it cannot be recorded as generated' using errcode = '23514';
  end if;
  insert into public.assessment_version_snapshots (version_id, org_id, kind, content, created_by)
  values (p_version, v.org_id, 'generated', private.assessment_version_content(p_version), auth.uid())
  returning * into s;
  return s;
end $$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 3. MIDAN's validation of an edited version. Errors stop approval; warnings are shown, never hidden, and don't.

create function private.validate_assessment_version(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with v as (
    select v.id, s.job_id from public.assessment_versions v join public.assessments s on s.id = v.assessment_id where v.id = p_version
  ),
  tasks as (select t.* from public.assessment_tasks t where t.version_id = p_version),
  -- Objective questions and answer keys, read defensively: a malformed one is a finding, never an error in this check.
  objective as (
    select t.id, t.title_ar, t.title_en,
      case when jsonb_typeof(t.config -> 'questions') = 'array' then t.config -> 'questions' else '[]'::jsonb end as questions
    from tasks t where t.task_type = 'objective_questions'
  ),
  questions as (
    select o.id as task_id, q ->> 'id' as question_id,
      case when jsonb_typeof(q -> 'options') = 'array' then q -> 'options' else '[]'::jsonb end as options
    from objective o, jsonb_array_elements(o.questions) q
  ),
  answer_keys as (
    select c.task_id, c.answer_key as key from public.rubric_criteria c join objective o on o.id = c.task_id where jsonb_typeof(c.answer_key) = 'object'
  ),
  findings as (
    -- Mandatory responsibilities and daily tasks the job states, measured by no task and no criterion.
    select jsonb_build_object('code', 'requirement_not_measured', 'severity', 'warning', 'requirement_id', r.id,
      'text_ar', r.description_ar, 'text_en', r.description_en) as f
    from v join public.job_requirements r on r.job_id = v.job_id
    where r.retired_at is null and r.review_status = 'approved' and r.is_mandatory and r.requirement_type in ('responsibility', 'daily_task')
      and not exists (select 1 from tasks t join public.task_requirement_mappings m on m.task_id = t.id where m.requirement_id = r.id)
      and not exists (select 1 from tasks t join public.rubric_criteria c on c.task_id = t.id where c.requirement_id = r.id)
    union all
    -- Required workbook skills no task measures.
    select jsonb_build_object('code', 'required_skill_not_measured', 'severity', 'warning', 'reference_skill_id', j.reference_skill_id, 'text_ar', k.name_ar)
    from v join public.job_reference_skills j on j.job_id = v.job_id join public.reference_skills k on k.id = j.reference_skill_id
    where j.is_required and not exists (select 1 from tasks t where j.reference_skill_id = any (t.reference_skill_ids))
    union all
    select jsonb_build_object('code', 'no_tasks', 'severity', 'error') where not exists (select 1 from tasks)
    union all
    -- Rubric completeness.
    select jsonb_build_object('code', 'task_without_criteria', 'severity', 'error', 'task_id', t.id, 'text_ar', t.title_ar, 'text_en', t.title_en)
    from tasks t where not exists (select 1 from public.rubric_criteria c where c.task_id = t.id)
    union all
    select jsonb_build_object('code', 'written_task_single_criterion', 'severity', 'warning', 'task_id', t.id, 'text_ar', t.title_ar, 'text_en', t.title_en)
    from tasks t where t.task_type <> 'objective_questions' and (select count(*) from public.rubric_criteria c where c.task_id = t.id) = 1
    union all
    -- Task-to-skill mapping: a task tied to nothing the job states measures nothing anyone can trace.
    select jsonb_build_object('code', 'task_not_mapped', 'severity', 'warning', 'task_id', t.id, 'text_ar', t.title_ar, 'text_en', t.title_en)
    from tasks t
    where cardinality(t.reference_skill_ids) = 0
      and not exists (select 1 from public.task_requirement_mappings m where m.task_id = t.id)
      and not exists (select 1 from public.rubric_criteria c where c.task_id = t.id and c.requirement_id is not null)
      and not exists (select 1 from public.task_skill_mappings s where s.task_id = t.id)
    union all
    -- Scoring consistency: a criterion scoring a workbook skill its task doesn't measure would never count towards that skill.
    select jsonb_build_object('code', 'criterion_skill_not_on_task', 'severity', 'warning', 'task_id', t.id, 'criterion_id', c.id,
      'reference_skill_id', c.reference_skill_id, 'text_ar', c.description_ar, 'text_en', c.description_en)
    from tasks t join public.rubric_criteria c on c.task_id = t.id
    where c.reference_skill_id is not null and not (c.reference_skill_id = any (t.reference_skill_ids))
    union all
    -- Objective questions: questions present, each with distinct options, and an answer key that matches them exactly.
    select jsonb_build_object('code', 'objective_without_questions', 'severity', 'error', 'task_id', o.id, 'text_ar', o.title_ar, 'text_en', o.title_en)
    from objective o where jsonb_array_length(o.questions) = 0
    union all
    select jsonb_build_object('code', 'objective_answer_invalid', 'severity', 'error', 'task_id', o.id, 'text_ar', o.title_ar, 'text_en', o.title_en)
    from objective o
    where jsonb_array_length(o.questions) > 0
      and (
        -- Exactly one answer key...
        (select count(*) from answer_keys k where k.task_id = o.id) <> 1
        -- ...whose every answer is one of its question's options...
        or exists (
          select 1 from questions q join answer_keys k on k.task_id = q.task_id
          where q.task_id = o.id
            and not exists (select 1 from jsonb_array_elements(q.options) x where x ->> 'id' = k.key ->> q.question_id)
        )
        -- ...and which names no question that doesn't exist.
        or exists (
          select 1 from answer_keys k, jsonb_object_keys(k.key) name
          where k.task_id = o.id and not exists (select 1 from questions q where q.task_id = o.id and q.question_id = name)
        )
        -- Every question has at least two options, with distinct ids.
        or exists (
          select 1 from questions q
          where q.task_id = o.id
            and (jsonb_array_length(q.options) < 2
              or (select count(distinct x ->> 'id') from jsonb_array_elements(q.options) x) <> jsonb_array_length(q.options))
        )
      )
    union all
    -- Duplicates: two tasks with the same title or the same instructions, after Arabic normalization.
    select jsonb_build_object('code', 'duplicate_task', 'severity', 'warning', 'task_id', b.id, 'duplicate_of', a.id, 'text_ar', b.title_ar, 'text_en', b.title_en)
    from tasks a join tasks b on a.position < b.position
    where public.normalize_arabic(a.title_ar) = public.normalize_arabic(b.title_ar)
      or lower(trim(a.title_en)) = lower(trim(b.title_en))
      or public.normalize_arabic(a.instructions_ar) = public.normalize_arabic(b.instructions_ar)
  )
  select coalesce(jsonb_agg(f), '[]') from findings
$$;

create function public.assessment_validation(p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assessment_versions v where v.id = p_version and private.is_org_member(v.org_id)) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  return private.validate_assessment_version(p_version);
end $$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 4. The review before approval: an owner or admin inspects every change up to a given one, with MIDAN's validation as it stood.

create table public.assessment_change_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.assessment_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  reviewed_by uuid not null references public.users (id),
  reviewed_at timestamptz not null default now(),
  reviewed_through bigint not null default 0,
  change_count integer not null,
  validation jsonb not null,
  note text check (length(note) <= 2000)
);
create index on public.assessment_change_reviews (version_id, reviewed_at desc);
create index on public.assessment_change_reviews (org_id);
alter table public.assessment_change_reviews enable row level security;
create policy "org members read" on public.assessment_change_reviews for select to authenticated using (private.is_org_member(org_id));
grant select on public.assessment_change_reviews to authenticated;

create function public.review_assessment_changes(p_version uuid, p_through bigint, p_note text default null)
returns public.assessment_change_reviews
language plpgsql security definer set search_path = '' as $$
declare v public.assessment_versions; r public.assessment_change_reviews; v_latest bigint;
begin
  select * into v from public.assessment_versions where id = p_version for update;
  if not found or not private.is_org_member(v.org_id) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if not private.is_org_member(v.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Reviewing changes is for an organization owner or admin' using errcode = '42501';
  end if;
  if v.status not in ('draft', 'in_review') then
    raise exception 'Only a draft is reviewed; an approved version cannot be changed' using errcode = '23514';
  end if;
  v_latest := coalesce(private.latest_reviewable_change(p_version), 0);
  -- The reviewer saw the draft up to p_through. A later change means they haven't seen it all.
  if coalesce(p_through, 0) <> v_latest then
    raise exception 'The draft changed since it was reviewed: it cannot be changed under a stale review. Look again' using errcode = '23514';
  end if;
  insert into public.assessment_change_reviews (version_id, org_id, reviewed_by, reviewed_through, change_count, validation, note)
  values (p_version, v.org_id, auth.uid(), v_latest,
    (select count(*) from public.audit_logs a where a.details ->> 'version_id' = p_version::text and private.is_reviewable_change(a)),
    private.validate_assessment_version(p_version), nullif(trim(p_note), ''))
  returning * into r;
  return r;
end $$;

-- What changed in a draft, for the people who build and approve it. Owners and admins can also read audit_logs directly.
create function public.assessment_version_changes(p_version uuid) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.assessment_versions v
    where v.id = p_version and private.is_org_member(v.org_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  return query
    select jsonb_build_object('id', a.id, 'action', a.action, 'entity', a.entity, 'entity_id', a.entity_id, 'actor_id', a.actor_id,
      'actor_name', coalesce(u.display_name, u.email), 'created_at', a.created_at, 'details', a.details,
      'needs_review', private.is_reviewable_change(a))
    from public.audit_logs a left join public.users u on u.id = a.actor_id
    where a.details ->> 'version_id' = p_version::text and a.details ->> 'source' = 'edit'
    order by a.id;
end $$;

-- Everything the review screen shows, in one answer: MIDAN's original (the generated draft, or the approved version a revision
-- started from) beside the draft as it is now, every change, earlier reviews, and the validation.
create function public.assessment_review_state(p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.assessment_versions; v_latest bigint; v_reviewed bigint;
begin
  select * into v from public.assessment_versions where id = p_version;
  if not found or not private.is_org_member(v.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  v_latest := coalesce(private.latest_reviewable_change(p_version), 0);
  v_reviewed := coalesce((select max(r.reviewed_through) from public.assessment_change_reviews r where r.version_id = p_version), 0);
  return jsonb_build_object(
    'version', jsonb_build_object('id', v.id, 'assessment_id', v.assessment_id, 'version_number', v.version_number, 'status', v.status,
      'published_by', v.published_by, 'published_at', v.published_at),
    'original', (select jsonb_build_object('kind', s.kind, 'based_on_version_id', s.based_on_version_id, 'created_at', s.created_at, 'content', s.content)
      from public.assessment_version_snapshots s where s.version_id = p_version and s.kind in ('generated', 'revision_base')),
    'approved', (select s.content from public.assessment_version_snapshots s where s.version_id = p_version and s.kind = 'approved'),
    'current', private.assessment_version_content(p_version),
    'changes', coalesce((select jsonb_agg(c order by (c ->> 'id')::bigint) from public.assessment_version_changes(p_version) c), '[]'),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reviewed_by', r.reviewed_by, 'reviewer_name', coalesce(u.display_name, u.email),
        'reviewed_at', r.reviewed_at, 'reviewed_through', r.reviewed_through, 'change_count', r.change_count, 'note', r.note,
        'warnings', (select count(*) from jsonb_array_elements(r.validation) f where f ->> 'severity' = 'warning')) order by r.reviewed_at)
      from public.assessment_change_reviews r left join public.users u on u.id = r.reviewed_by where r.version_id = p_version), '[]'),
    'validation', private.validate_assessment_version(p_version),
    'latest_change_id', v_latest,
    'unreviewed', v_latest > v_reviewed
  );
end $$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 5. Approval checks: no errors, every change reviewed, and the approved version kept.
-- Same function as in 20261105231005_candidate_experience.sql, apart from the three marked steps.

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
    -- (1) MIDAN's validation: errors stop approval. Warnings were shown to the reviewer and don't.
    if exists (select 1 from jsonb_array_elements(private.validate_assessment_version(old.id)) f where f ->> 'severity' = 'error') then
      raise exception 'This version has errors to fix before approval' using errcode = '23514';
    end if;
    -- (2) Every change people made since the draft was generated or copied has been reviewed by an owner or admin.
    if coalesce(private.latest_reviewable_change(old.id), 0) > coalesce(
      (select max(r.reviewed_through) from public.assessment_change_reviews r where r.version_id = old.id), 0) then
      raise exception 'Review the changes to this draft before approving it' using errcode = '23514';
    end if;
    new.published_by := auth.uid();
    new.published_at := now();
    new.requirements_snapshot := private.build_requirements_snapshot(old.id);
    if new.rubric_shared then
      new.candidate_rubric := private.build_candidate_rubric(old.id);
    end if;
    -- (3) The approved version, as approved.
    insert into public.assessment_version_snapshots (version_id, org_id, kind, content, created_by)
    values (old.id, old.org_id, 'approved', private.assessment_version_content(old.id), auth.uid())
    on conflict (version_id, kind) do nothing;
  end if;
  return new;
end $$;

-- -------------------------------------------------------------------------------------------------------------------------
-- 6. Changing an assessment candidates already take: a new draft version, copied from an approved one. The approved version,
-- and every attempt on it, stay exactly as they are. New applicants get the newest approved version
-- (private.assign_published_assessments).

create function public.create_assessment_revision(p_version uuid) returns public.assessment_versions
language plpgsql security definer set search_path = '' as $$
declare
  src public.assessment_versions;
  nv public.assessment_versions;
  t public.assessment_tasks;
  v_job uuid;
  v_task uuid;
begin
  select * into src from public.assessment_versions where id = p_version;
  if not found or not private.is_org_member(src.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if src.status <> 'published' then
    raise exception 'A new version starts from an approved one' using errcode = '23514';
  end if;
  if exists (select 1 from public.assessment_versions x where x.assessment_id = src.assessment_id and x.status in ('draft', 'in_review')) then
    raise exception 'This assessment already has a draft' using errcode = '23514';
  end if;
  select job_id into v_job from public.assessments where id = src.assessment_id;

  perform set_config('midan.assessment_change', 'revision', true);
  insert into public.assessment_versions (assessment_id, org_id, version_number, duration_minutes, instructions_ar, instructions_en,
    scenario_ar, scenario_en, deadline_hours, is_timed, rubric_shared)
  values (src.assessment_id, src.org_id, (select max(version_number) + 1 from public.assessment_versions where assessment_id = src.assessment_id),
    src.duration_minutes, src.instructions_ar, src.instructions_en, src.scenario_ar, src.scenario_en, src.deadline_hours, src.is_timed, src.rubric_shared)
  returning * into nv;

  for t in select * from public.assessment_tasks where version_id = src.id order by position loop
    -- Links the job no longer has (a retired requirement, an unlinked workbook skill) aren't copied; validation then shows the gap.
    insert into public.assessment_tasks (version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en, weight, config, reference_skill_ids)
    values (nv.id, nv.org_id, t.position, t.task_type, t.title_ar, t.title_en, t.instructions_ar, t.instructions_en, t.weight, t.config,
      array(select s from unnest(t.reference_skill_ids) s
            where exists (select 1 from public.job_reference_skills j where j.job_id = v_job and j.reference_skill_id = s)))
    returning id into v_task;
    insert into public.rubric_criteria (task_id, org_id, code, description_ar, description_en, max_score, weight, answer_key, requirement_id, reference_skill_id)
    select v_task, c.org_id, c.code, c.description_ar, c.description_en, c.max_score, c.weight, c.answer_key,
      (select r.id from public.job_requirements r where r.id = c.requirement_id and r.job_id = v_job and r.retired_at is null),
      c.reference_skill_id
    from public.rubric_criteria c where c.task_id = t.id;
    insert into public.task_requirement_mappings (task_id, requirement_id, org_id, weight)
    select v_task, m.requirement_id, m.org_id, m.weight from public.task_requirement_mappings m
    join public.job_requirements r on r.id = m.requirement_id and r.job_id = v_job and r.retired_at is null
    where m.task_id = t.id;
    insert into public.task_skill_mappings (task_id, org_id, skill_id, weight)
    select v_task, s.org_id, s.skill_id, s.weight from public.task_skill_mappings s where s.task_id = t.id;
  end loop;
  perform set_config('midan.assessment_change', '', true);

  insert into public.assessment_version_snapshots (version_id, org_id, kind, based_on_version_id, content, created_by)
  values (nv.id, nv.org_id, 'revision_base', src.id, private.assessment_version_content(nv.id), auth.uid());
  return nv;
end $$;

-- -------------------------------------------------------------------------------------------------------------------------

revoke all on function private.write_assessment_audit(), private.is_reviewable_change(public.audit_logs), private.latest_reviewable_change(uuid),
  private.assessment_version_content(uuid), private.validate_assessment_version(uuid) from public, anon, authenticated;
revoke all on function public.record_generated_draft(uuid), public.assessment_validation(uuid),
  public.review_assessment_changes(uuid, bigint, text), public.assessment_version_changes(uuid), public.assessment_review_state(uuid),
  public.create_assessment_revision(uuid) from public, anon;
grant execute on function public.record_generated_draft(uuid), public.assessment_validation(uuid),
  public.review_assessment_changes(uuid, bigint, text), public.assessment_version_changes(uuid), public.assessment_review_state(uuid),
  public.create_assessment_revision(uuid) to authenticated;
