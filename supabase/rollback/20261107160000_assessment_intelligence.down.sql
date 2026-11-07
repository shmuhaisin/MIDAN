-- Rolls back 20261107160000_assessment_intelligence.sql: restores the editing policy's functions as 20261107150000 defined them,
-- and drops the guide, quality reports, gate, candidate package and company type. Guides, reports and packages are lost; audit rows
-- stay. The three restored functions below are copied verbatim from 20261107150000 (create function → create or replace).

drop trigger quality_gate on public.assessment_versions;
drop trigger carry_standard_into_revision on public.assessment_version_snapshots;
drop function private.guard_quality_gate();
drop function private.is_under_standard(uuid);
drop function private.record_quality_report(uuid, text, jsonb);
drop table public.assessment_quality_reports;
drop function public.assessment_content_digest(uuid);
drop function private.assessment_content_digest(uuid);
drop function private.carry_standard_into_revision();

drop trigger write_assessment_audit on public.assessment_assessor_guides;
drop table public.assessment_assessor_guides;
drop function private.guard_assessor_guide();

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

create or replace function private.is_reviewable_change(a public.audit_logs) returns boolean
language sql immutable set search_path = '' as $$
  select a.entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions')
    and a.details ->> 'source' = 'edit' and coalesce(a.details ->> 'kind', 'content') = 'content'
$$;

drop index public.audit_logs_assessment_version;
create index audit_logs_assessment_version on public.audit_logs ((details ->> 'version_id'), id)
  where entity in ('assessment_tasks', 'rubric_criteria', 'task_requirement_mappings', 'assessment_versions');

create or replace function private.assessment_version_content(p_version uuid) returns jsonb
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

alter table public.assessment_versions drop column candidate_package;
revoke update (company_type) on public.organizations from authenticated;
alter table public.organizations drop column company_type;
