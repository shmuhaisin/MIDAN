-- Rolls back 20261108090100_interview_participants. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Participant lists are lost; the API before this migration lets any staff member join.
drop function public.can_join_interview(uuid);
drop trigger add_interview_scheduler on public.interviews;
drop function private.add_interview_scheduler();
drop table public.interview_participants;
drop function private.guard_interview_participant();
