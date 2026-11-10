-- Rollback of 20261115090000_application_cv_matches.sql: stored matches are recomputed on demand without it.
drop table if exists public.application_cv_matches;
drop function if exists private.guard_application_cv_match();
