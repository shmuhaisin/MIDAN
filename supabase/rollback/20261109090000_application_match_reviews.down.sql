-- Reverses 20261109090000_application_match_reviews. Removes staff reviews of requirement matches; nothing else depends on them.
drop table if exists public.application_match_reviews;
drop function if exists private.guard_application_match_review();
