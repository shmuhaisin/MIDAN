-- AI requirement suggestions (feature/midan-product-experience). Local only until the owner approves it for Cloud.
--
-- MIDAN's live model suggests a job's requirements from its title, description, the company's industry and business
-- context, and the level. Each one is stored as an ordinary requirement with origin 'ai_inferred', which the existing
-- trigger (guard_requirement_review) keeps as a draft until a person at the organization approves it; only approved
-- requirements reach the ATS and the assessment. `suggestion` keeps what the model said about it: category, proficiency,
-- explanation in both languages, and its provenance.
alter table public.job_requirements
  add column suggestion jsonb check (suggestion is null or jsonb_typeof(suggestion) = 'object');

-- A suggestion is approved only by someone who could have written it, and approving never rewrites who suggested it.
create function private.guard_requirement_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.origin is distinct from old.origin then
    raise exception 'Where a requirement came from is kept as it was' using errcode = '42501';
  end if;
  if new.suggestion is distinct from old.suggestion and old.suggestion is not null then
    raise exception 'What MIDAN suggested is kept as it was' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_requirement_approval() from public, anon, authenticated;
create trigger guard_requirement_approval before update on public.job_requirements
  for each row execute function private.guard_requirement_approval();
