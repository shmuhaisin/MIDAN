-- Reverses 20261110090000_job_skill_suggestions. Removes the employer's own job skills and the levels on linked workbook
-- skills (both are lost); job analyses recorded by the suggester stay as rows (their method names them).
drop function if exists public.accept_job_analysis(uuid, uuid[], uuid[], boolean, jsonb);
drop function if exists public.record_skill_suggestions(uuid, text, text, jsonb);
drop table if exists public.job_custom_skills;
alter table public.job_reference_skills drop column if exists required_level;
