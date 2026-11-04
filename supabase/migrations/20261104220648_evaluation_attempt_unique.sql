-- Matches the composite foreign key to assessment_attempts, so the one-to-one is explicit.
alter table public.evaluation_results add constraint evaluation_results_attempt_id_org_id_key unique (attempt_id, org_id);
