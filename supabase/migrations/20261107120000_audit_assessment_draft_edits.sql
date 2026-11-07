-- An organization reviews and edits a generated draft before approving it (owner decision, 2026-11-07). These records show what
-- people changed, and who, between the generated draft and the approved version.
create trigger write_audit after update or delete on public.assessment_tasks for each row execute function private.write_audit();
create trigger write_audit after update or delete on public.rubric_criteria for each row execute function private.write_audit();
