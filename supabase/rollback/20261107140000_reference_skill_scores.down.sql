-- Rolls back 20261107140000_reference_skill_scores. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Workbook skill scores are lost. Overall scores and criterion scores stay.
drop table public.reference_skill_scores;
