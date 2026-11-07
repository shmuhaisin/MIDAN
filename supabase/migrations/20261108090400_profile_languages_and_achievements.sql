-- P2: languages and achievements from an approved CV analysis have somewhere to go. Like every other profile field, they
-- reach the profile only when the candidate approves them, and an application's snapshot copies them (to_jsonb of the row).
alter table public.candidate_profiles
  add column languages jsonb not null default '[]' check (jsonb_typeof(languages) = 'array' and jsonb_array_length(languages) <= 20),
  add column achievements jsonb not null default '[]' check (jsonb_typeof(achievements) = 'array' and jsonb_array_length(achievements) <= 30);
