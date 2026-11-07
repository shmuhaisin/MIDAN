-- Rolls back 20261108090600_practice_tasks. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Practice tasks and submissions are lost.
drop table public.practice_tasks;
drop function private.guard_practice_task();
