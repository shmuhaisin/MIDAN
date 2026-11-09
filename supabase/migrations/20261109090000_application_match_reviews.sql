-- Requirement matching: a person's review of each proposed match.
--
-- MIDAN proposes, for each of a job's requirements, whether an applicant's submitted profile shows it (matched, partially
-- matched, missing, or needs review), with the evidence it used. The proposal is computed on request and never stored as
-- a decision. This table keeps what the organization's staff decided about it: confirmed as proposed, or corrected to
-- another status, with an optional note. An append-only history, like application_notes: the latest entry for a
-- requirement is the current one, and nobody edits or deletes an entry. Organization staff only; never the candidate.
-- A review never changes an application's status: shortlisting, rejecting and hiring stay separate, deliberate actions.

create table public.application_match_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- 'requirement:<job_requirements.id>' or 'skill:<skills.id>'.
  requirement_key text not null check (requirement_key ~ '^(requirement|skill):[0-9a-f-]{36}$'),
  decision text not null check (decision in ('confirmed', 'corrected')),
  status text not null check (status in ('matched', 'partial', 'missing', 'needs_review')),
  proposed_status text not null check (proposed_status in ('matched', 'partial', 'missing', 'needs_review')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  reviewer_id uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade,
  -- Confirming keeps the proposal; correcting changes it.
  check ((decision = 'confirmed') = (status = proposed_status))
);
create index on public.application_match_reviews (application_id, org_id, requirement_key, created_at desc);
create index on public.application_match_reviews (org_id);
create index on public.application_match_reviews (reviewer_id);

create function private.guard_application_match_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.applications where id = new.application_id and status <> 'withdrawn';
  if v_org is null then raise exception 'Application is not available' using errcode = '23514'; end if;
  new.org_id := v_org;
  new.reviewer_id := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger guard_application_match_review before insert on public.application_match_reviews
  for each row execute function private.guard_application_match_review();
create trigger write_audit after insert on public.application_match_reviews for each row execute function private.write_audit();

alter table public.application_match_reviews enable row level security;
create policy "org members read" on public.application_match_reviews for select to authenticated using (private.is_org_member(org_id));
create policy "org members write" on public.application_match_reviews for insert to authenticated
  with check (private.is_org_member(org_id) and reviewer_id = auth.uid());
grant select, insert on public.application_match_reviews to authenticated;
