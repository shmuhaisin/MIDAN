-- Rolls back 20261108090300_application_notes_and_interview_feedback. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Notes and interview feedback are lost; their audit rows stay.
drop table public.interview_feedback;
drop function private.guard_interview_feedback();
drop function private.valid_competencies(jsonb);
drop table public.application_notes;
drop function private.guard_application_note();
