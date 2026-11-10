-- Rollback of 20261116100000_requirement_suggestions.sql: the suggestions' explanations are lost; the requirements stay.
drop trigger if exists guard_requirement_approval on public.job_requirements;
drop function if exists private.guard_requirement_approval();
alter table public.job_requirements drop column if exists suggestion;
