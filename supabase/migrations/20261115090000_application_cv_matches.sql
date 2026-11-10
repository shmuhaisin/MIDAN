-- Stored CV matches (feature/midan-product-experience). Local only until the owner approves it for Cloud.
--
-- MIDAN's CV match of one application against its job's approved requirements, as the AI service returned it (statuses,
-- evidence, explanation, provenance). The hybrid matcher (e5 retrieval + cross-encoder rerank) takes tens of seconds per
-- application on a CPU, so the API computes it once in the background and keeps it here; ranking and the applicant page
-- read it. `fingerprint` identifies what it was computed from (the approved requirements, the application's snapshot and
-- the matcher): when any of them changes, it is computed again. People's reviews of a match stay in
-- application_match_reviews and are applied on top when it is read; the score formula is unchanged.
--
-- Staff of the application's organization read and write it, under row security. The candidate never reads it here (they
-- see their own requirement view from their own profile, computed live).

create table public.application_cv_matches (
  application_id uuid primary key references public.applications (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  fingerprint text not null check (length(fingerprint) between 16 and 128),
  result jsonb not null check (jsonb_typeof(result) = 'object' and result ? 'matches' and result ? 'summary'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object' and provenance ? 'provider'),
  computed_at timestamptz not null default now()
);

create function private.guard_application_cv_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.applications where id = new.application_id;
  if v_org is null then raise exception 'Application not found' using errcode = '23503'; end if;
  new.org_id := v_org;
  new.computed_at := now();
  return new;
end $$;
revoke all on function private.guard_application_cv_match() from public, anon, authenticated;
create trigger guard_application_cv_match before insert or update on public.application_cv_matches
  for each row execute function private.guard_application_cv_match();

alter table public.application_cv_matches enable row level security;
create policy "org staff read" on public.application_cv_matches for select to authenticated using (private.is_org_member(org_id));
create policy "org staff write" on public.application_cv_matches for insert to authenticated with check (private.is_org_member(org_id));
create policy "org staff refresh" on public.application_cv_matches for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
grant select, insert, update (fingerprint, result, provenance, computed_at) on public.application_cv_matches to authenticated;
