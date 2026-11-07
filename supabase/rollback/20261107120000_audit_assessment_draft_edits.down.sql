-- Rolls back 20261107120000_audit_assessment_draft_edits. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
drop trigger write_audit on public.assessment_tasks;
drop trigger write_audit on public.rubric_criteria;
