-- Tasks and rubric criteria can name the official reference skill they measure, so an assessment traces back through
-- Job -> Requirements -> Sector -> Job family -> Skills -> Tasks -> Rubric. Locked with the version like the rest.
alter table public.assessment_tasks add column reference_skill_ids uuid[] not null default '{}';
alter table public.rubric_criteria add column reference_skill_id uuid references public.reference_skills (id);
create index on public.rubric_criteria (reference_skill_id);

-- A reference skill on a task must be one the organization linked to the job.
create function private.guard_task_reference_skills() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  if coalesce(array_length(new.reference_skill_ids, 1), 0) = 0 then return new; end if;
  select a.job_id into v_job from public.assessment_versions v join public.assessments a on a.id = v.assessment_id where v.id = new.version_id;
  if exists (select 1 from unnest(new.reference_skill_ids) s where not exists (
    select 1 from public.job_reference_skills j where j.job_id = v_job and j.reference_skill_id = s)) then
    raise exception 'A task can only name reference skills linked to its job' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_task_reference_skills before insert or update of reference_skill_ids on public.assessment_tasks
  for each row execute function private.guard_task_reference_skills();
