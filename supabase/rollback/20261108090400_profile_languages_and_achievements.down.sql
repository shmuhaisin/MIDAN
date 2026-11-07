-- Rolls back 20261108090400_profile_languages_and_achievements. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Saved languages and achievements are lost. Application snapshots taken meanwhile keep their copies.
alter table public.candidate_profiles drop column languages, drop column achievements;
