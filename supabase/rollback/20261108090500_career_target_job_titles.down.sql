-- Rolls back 20261108090500_career_target_job_titles. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Targets set by title alone are removed; the others lose their title.
delete from public.career_targets where job_family_ar is null;
alter table public.career_targets
  drop constraint career_targets_has_target,
  drop constraint career_targets_family_pair,
  alter column sector_code set not null,
  alter column job_family_ar set not null,
  drop column job_title;
