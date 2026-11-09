-- Reverses 20261109120000_account_type_separation. Removes the triggers only; no data changes.
drop trigger if exists guard_applicant on public.applications;
drop trigger if exists guard_account_type on public.organization_members;
drop trigger if exists guard_account_type on public.candidate_profiles;
drop function if exists private.guard_applicant();
drop function if exists private.guard_account_type();
