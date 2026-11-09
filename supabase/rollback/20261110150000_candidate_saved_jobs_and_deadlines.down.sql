-- Reverses 20261110150000_candidate_saved_jobs_and_deadlines. Candidates' saved jobs are lost; applications are unchanged.
drop trigger if exists guard_applicant_deadline on public.applications;
drop function if exists private.guard_application_deadline();
drop table if exists public.saved_jobs;
