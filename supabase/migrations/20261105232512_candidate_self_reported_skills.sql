-- Skills a CV or the candidate names in their own words, when they aren't in the reference. Always self-reported.
alter table public.candidate_profiles add column self_reported_skills jsonb not null default '[]';
