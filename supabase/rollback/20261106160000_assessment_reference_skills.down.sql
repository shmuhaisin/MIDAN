-- Rolls back 20261106160000_assessment_reference_skills. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop trigger guard_task_reference_skills on public.assessment_tasks;
alter table public.rubric_criteria drop constraint rubric_criteria_reference_skill_id_fkey;
drop index public.rubric_criteria_reference_skill_id_idx;
alter table public.assessment_tasks drop column reference_skill_ids;
alter table public.rubric_criteria drop column reference_skill_id;
drop function if exists private.guard_task_reference_skills();
