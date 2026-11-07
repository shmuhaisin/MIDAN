-- P2: a target role can be a job title in the candidate's own words. The sector workbooks name job families, not titles,
-- and MIDAN has no official title list, so a typed title is stored as the candidate wrote it and shown as theirs. It can
-- also be linked to a workbook job family; skills come only from that family and from published jobs with a similar title.
alter table public.career_targets
  add column job_title text check (job_title is null or length(btrim(job_title)) between 2 and 120),
  alter column sector_code drop not null,
  alter column job_family_ar drop not null,
  add constraint career_targets_has_target check (job_title is not null or job_family_ar is not null),
  add constraint career_targets_family_pair check ((sector_code is null) = (job_family_ar is null));
