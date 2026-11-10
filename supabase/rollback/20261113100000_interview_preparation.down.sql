-- Rollback of 20261113100000_interview_preparation.sql: the generated questions and forms are removed with the table.
drop table if exists public.interview_preparations;
drop function if exists private.guard_interview_preparation();
