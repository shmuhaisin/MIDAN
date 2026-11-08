-- Rolls back 20261108090700_ai_provider_provenance. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Recorded providers, and CV analysis model IDs, are lost; model versions on runs and scores stay.
alter table public.cv_analyses drop column provider, drop column model_version;
alter table public.criterion_scores drop column provider;
alter table public.ai_workflow_runs drop column provider;
