-- Rollback of 20261113110000_candidate_development_reports.sql: drafts and released reports are removed with the table.
drop table if exists public.candidate_development_reports;
drop function if exists private.guard_development_report();
