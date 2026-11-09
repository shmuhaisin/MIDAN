-- Reverses 20261111100000_interview_requires_shortlist.
drop trigger if exists guard_interview_shortlist on public.interviews;
drop function if exists private.guard_interview_shortlist();
