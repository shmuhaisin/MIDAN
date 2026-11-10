-- Rollback of 20261116090000_career_readiness.sql: readiness checks are lost; the catalog keeps its original columns.
drop table if exists public.career_readiness;
drop function if exists private.guard_career_readiness();
alter table public.learning_resources
  drop column if exists skills_en, drop column if exists skills_ar, drop column if exists level, drop column if exists duration,
  drop column if exists cost, drop column if exists prerequisites, drop column if exists target_roles, drop column if exists verification;
