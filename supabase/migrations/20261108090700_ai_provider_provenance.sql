-- Provenance names who served a model as well as the model: "groq" with openai/gpt-oss-120b is not OpenAI's own API.
-- ai_workflow_runs and criterion_scores gain the provider; cv_analyses gain the provider and the exact model ID, for
-- analyses a model structured (mode external_ai). Rows written before this keep null: their provider wasn't recorded.
alter table public.ai_workflow_runs add column provider text check (provider is null or length(provider) <= 40);
alter table public.criterion_scores add column provider text check (provider is null or length(provider) <= 40);
alter table public.cv_analyses
  add column provider text check (provider is null or length(provider) <= 40),
  add column model_version text check (model_version is null or length(model_version) <= 200);
